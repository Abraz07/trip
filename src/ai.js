// One place for Gemini calls (plan suggestions, bill-split chat).
// Uses the shared key from VITE_GEMINI_API_KEY (restricted to this site in Google Cloud),
// or a key the person pasted earlier in the scan screen.
import { getGeminiApiKey } from './gemini'

// gemini-2.5-flash is closed to new API keys; override with VITE_GEMINI_MODEL if Google changes this again.
const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.5-flash'

export const aiAvailable = () => Boolean(getGeminiApiKey())

export class AIError extends Error {}

// Ask Gemini for JSON matching `schema` (OpenAPI-style schema object). `parts` are text or {inlineData}.
export async function askJSON({ system, parts, schema, temperature = 0.3 }) {
  const key = getGeminiApiKey()
  if (!key) throw new AIError('AI isn’t set up for this app yet.')
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: parts.map((p) => (typeof p === 'string' ? { text: p } : p)) }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
    }),
  }).catch(() => { throw new AIError('No internet — AI needs a connection.') })

  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 429) throw new AIError('AI is busy (free daily limit reached). Try again in a bit.')
    if (res.status === 403) throw new AIError('AI isn’t allowed from this address.')
    throw new AIError(j.error?.message || `AI request failed (${res.status}).`)
  }
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
  try {
    return JSON.parse(text)
  } catch {
    throw new AIError('AI gave an unreadable answer — try again.')
  }
}
