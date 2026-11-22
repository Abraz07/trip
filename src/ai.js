// One place for Gemini calls (plan suggestions, plan chat, bill-split chat).
// Uses the shared key from VITE_GEMINI_API_KEY (restricted to this site in Google Cloud),
// or a key the person pasted earlier in the scan screen.
import { getGeminiApiKey } from './gemini'

// The free tier allows only ~20 requests per day *per model*, so we fall through a list of models:
// when one is out of quota (429), the next one is used. Override the first with VITE_GEMINI_MODEL.
// (gemini-2.5-flash is closed to new API keys.)
const MODELS = [...new Set([
  import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-flash-lite-latest',
])]
const SKIP_KEY = 'yatra:ai:exhausted' // { model: untilEpochMs } — models known to be out of quota

const readSkips = () => { try { return JSON.parse(localStorage.getItem(SKIP_KEY) || '{}') } catch { return {} } }
function markExhausted(model, retryDelay) {
  const secs = parseInt(retryDelay, 10)
  const until = Date.now() + (Number.isFinite(secs) && secs > 0 ? secs * 1000 : 60 * 60 * 1000)
  try { localStorage.setItem(SKIP_KEY, JSON.stringify({ ...readSkips(), [model]: until })) } catch {}
}

export const aiAvailable = () => Boolean(getGeminiApiKey())

export class AIError extends Error {}

// Ask Gemini for JSON matching `schema` (OpenAPI-style schema object). `parts` are text or {inlineData}.
// thinking: 'minimal' is ~7x faster (≈3–4 s vs 23–37 s measured) with the same quality for simple
// planning lists; leave undefined for tasks where accuracy matters more than speed (bill splitting).
export function askJSON(opts) {
  return run({ ...opts, json: true })
}

// Plain-text answer. urlContext: let Gemini open URLs in the prompt; returns { text, urlStatus: { url: status } }.
export function askText(opts) {
  return run({ ...opts, json: false, thinking: opts.thinking || 'minimal' })
}

async function run({ system, parts, schema, temperature = 0.3, thinking, json, urlContext }) {
  const key = getGeminiApiKey()
  if (!key) throw new AIError('AI isn’t set up for this app yet.')
  const skips = readSkips()
  const models = MODELS.filter((m) => !(skips[m] > Date.now()))
  if (!models.length) models.push(MODELS[0]) // all marked exhausted — try the main one anyway
  let last
  for (const model of models) {
    // Gemini sometimes answers 503 "high demand" for a moment — retry the same model once.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callOnce({ key, model, system, parts, schema, temperature, thinking, json, urlContext })
      } catch (e) {
        last = e
        if (e.retryable && attempt === 0) { await new Promise((r) => setTimeout(r, 1200)); continue }
        break
      }
    }
    if (last?.quota) { markExhausted(model, last.retryDelay); continue }
    if (last?.badModel || last?.retryable) continue // model unavailable/overloaded → next one
    throw last
  }
  throw last?.quota ? new AIError('AI’s free daily limit is used up for now. Try again later today.') : last
}

async function callOnce({ key, model, system, parts, schema, temperature, thinking, json, urlContext }) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: parts.map((p) => (typeof p === 'string' ? { text: p } : p)) }],
      ...(urlContext ? { tools: [{ url_context: {} }] } : {}),
      generationConfig: {
        ...(json ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
        temperature,
        ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
      },
    }),
  }).catch(() => { throw new AIError('No internet — AI needs a connection.') })

  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = j.error?.message || ''
    if (res.status === 429) {
      const retryDelay = (j.error?.details || []).find((d) => d.retryDelay)?.retryDelay
      throw Object.assign(new AIError('AI is busy (free limit reached). Try again in a bit.'), { quota: true, retryDelay })
    }
    if (res.status === 503 || res.status === 500) throw Object.assign(new AIError('AI is overloaded right now — try again in a moment.'), { retryable: true })
    if (res.status === 403) throw new AIError('AI isn’t allowed from this address.')
    // Model retired/unknown, or it doesn't support a setting we sent (e.g. thinking level) → try the next model.
    if (res.status === 404 || (res.status === 400 && /thinking|not supported|model/i.test(msg))) throw Object.assign(new AIError(msg || 'Model unavailable.'), { badModel: true })
    throw new AIError(msg || `AI request failed (${res.status}).`)
  }
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
  if (!json) {
    const urlStatus = Object.fromEntries((j.candidates?.[0]?.urlContextMetadata?.urlMetadata || []).map((m) => [m.retrievedUrl, m.urlRetrievalStatus]))
    return { text, urlStatus }
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new AIError('AI gave an unreadable answer — try again.')
  }
}
