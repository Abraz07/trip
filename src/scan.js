import { app } from './firebase'
import { getGeminiApiKey, scanReceiptWithGemini } from './gemini'

export const scanAvailable = true

// Firebase AI Logic is only a fallback when no Gemini key is set, so it's loaded on demand.
const buildSchema = (Schema) => Schema.object({
  properties: {
    merchant: Schema.string({ description: 'Restaurant or shop name, empty if unreadable' }),
    items: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string({ description: 'Item name as printed, cleaned up' }),
          qty: Schema.number({ description: 'Quantity, 1 if not shown' }),
          price: Schema.number({ description: 'Line total in rupees for this item (qty × unit price)' }),
        },
      }),
    }),
    extras: Schema.number({ description: 'Sum of tax, GST, CGST, SGST, service charge and other charges, minus any discount' }),
    total: Schema.number({ description: 'Final amount payable (grand total) in rupees' }),
  },
})

let model
const getModel = async () => {
  if (model) return model
  const { getAI, getGenerativeModel, GoogleAIBackend, Schema } = await import('firebase/ai')
  model = getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), {
    model: import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.5-flash',
    generationConfig: { responseMimeType: 'application/json', responseSchema: buildSchema(Schema), temperature: 0 },
  })
  return model
}

const PROMPT = `This is a photo of a restaurant/shop bill, most likely from India (₹).
Extract every purchased line item with its line total. Do not list tax, GST, service charge, round-off or discount as items — put their net sum in "extras".
"total" is the final grand total payable. If the photo is not a bill, return an empty items list and total 0.`

export async function readBill(dataUrl, apiKeyOverride) {
  // If user provided a direct Gemini API key or set one in env/localStorage, prefer/fallback to direct Gemini API
  const directKey = apiKeyOverride || getGeminiApiKey()

  // First try Firebase AI Logic if no direct key specified
  if (!directKey) {
    try {
      const base64 = dataUrl.split(',')[1]
      const res = await (await getModel()).generateContent([PROMPT, { inlineData: { mimeType: 'image/jpeg', data: base64 } }])
      const out = JSON.parse(res.response.text())
      const items = (out.items || []).filter((i) => i.name && Number(i.price) > 0).map((i) => ({
        name: i.name,
        qty: i.qty || 1,
        price: Math.round(Number(i.price) * 100) / 100,
      }))
      const itemSum = items.reduce((s, i) => s + i.price, 0)
      let total = Number(out.total) || 0
      if (!total) total = itemSum + (Number(out.extras) || 0)
      return {
        merchant: out.merchant || '',
        items,
        total: Math.round(total * 100) / 100,
        extras: Math.round((total - itemSum) * 100) / 100,
      }
    } catch (firebaseAiErr) {
      console.warn('Firebase AI Logic error, checking for direct Gemini fallback...', firebaseAiErr)
      throw firebaseAiErr
    }
  }

  // Use direct Gemini Vision API
  // Convert dataUrl to blob/file for scanReceiptWithGemini
  const blob = await (await fetch(dataUrl)).blob()
  const res = await scanReceiptWithGemini(blob, directKey)
  const items = (res.items || []).map((it) => ({
    name: it.name,
    qty: it.qty || 1,
    price: Math.round(Number(it.price) * 100) / 100,
  }))
  const itemSum = items.reduce((s, i) => s + i.price, 0)
  const total = Math.round(Number(res.total) * 100) / 100
  const extras = Math.round((total - itemSum) * 100) / 100

  return {
    merchant: res.merchant || '',
    items,
    total,
    extras,
  }
}

// Each item is split equally among the people who had it; tax/service/round-off is spread in proportion.
export function itemSplits(items, assign, total) {
  const itemSum = items.reduce((s, i) => s + i.price, 0)
  const factor = itemSum > 0 ? total / itemSum : 1
  const splits = {}
  items.forEach((it, idx) => {
    const who = assign[idx] || []
    if (!who.length) return
    const share = (it.price * factor) / who.length
    for (const u of who) splits[u] = (splits[u] || 0) + share
  })
  // Round to paise and push the rounding remainder onto the biggest share so it sums exactly.
  const uids = Object.keys(splits)
  for (const u of uids) splits[u] = Math.round(splits[u] * 100) / 100
  const diff = Math.round((total - uids.reduce((s, u) => s + splits[u], 0)) * 100) / 100
  if (uids.length && diff) {
    const big = uids.reduce((a, b) => (splits[a] >= splits[b] ? a : b))
    splits[big] = Math.round((splits[big] + diff) * 100) / 100
  }
  return splits
}
