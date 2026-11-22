// One place for Gemini calls (plan suggestions, bill-split chat).
// Uses the shared key from VITE_GEMINI_API_KEY (restricted to this site in Google Cloud),
// or a key the person pasted earlier in the scan screen.
import { getGeminiApiKey } from './gemini'

// gemini-2.5-flash is closed to new API keys; override with VITE_GEMINI_MODEL if Google changes this again.
const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.5-flash'

export const aiAvailable = () => Boolean(getGeminiApiKey())

export class AIError extends Error {}

// Ask Gemini for JSON matching `schema` (OpenAPI-style schema object). `parts` are text or {inlineData}.
// thinking: 'minimal' is ~7x faster (≈3–4 s vs 23–37 s measured) with the same quality for simple
// planning lists; leave undefined for tasks where accuracy matters more than speed (bill splitting).
export async function askJSON({ system, parts, schema, temperature = 0.3, thinking }) {
  const key = getGeminiApiKey()
  if (!key) throw new AIError('AI isn’t set up for this app yet.')
  // Gemini sometimes answers 503 "high demand" for a moment — retry once before giving up.
  for (let attempt = 0; ; attempt++) {
    try {
      return await callOnce({ key, system, parts, schema, temperature, thinking })
    } catch (e) {
      if (attempt === 0 && e.retryable) { await new Promise((r) => setTimeout(r, 1200)); continue }
      throw e
    }
  }
}

async function callOnce({ key, system, parts, schema, temperature, thinking }) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: parts.map((p) => (typeof p === 'string' ? { text: p } : p)) }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature,
        ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
      },
    }),
  }).catch(() => { throw new AIError('No internet — AI needs a connection.') })

  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 429) throw new AIError('AI is busy (free daily limit reached). Try again in a bit.')
    if (res.status === 503 || res.status === 500) throw Object.assign(new AIError('AI is overloaded right now — try again in a moment.'), { retryable: true })
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
