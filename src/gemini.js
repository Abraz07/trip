// Gemini AI Receipt & Bill Scanner

const STORAGE_KEY = 'yatra:gemini_api_key'

export function getGeminiApiKey() {
  const envKey = import.meta.env.VITE_GEMINI_API_KEY
  if (envKey && envKey.trim()) return envKey.trim()
  try {
    return localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveGeminiApiKey(key) {
  try {
    if (!key) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, key.trim())
  } catch {}
}

export function hasGeminiApiKey() {
  return Boolean(getGeminiApiKey())
}

// Client-side image compression for fast upload & sharp OCR
async function prepareImageForOCR(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const maxDim = 1600
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)

  const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
  const base64Data = dataUrl.split(',')[1]
  return { base64Data, previewUrl: dataUrl }
}

const SYSTEM_PROMPT = `You are an expert travel receipt auditor.
Analyze the provided receipt, bill, or invoice image thoroughly.
Extract the transaction details into valid JSON with this exact structure:
{
  "merchant": "Store, restaurant, cab, hotel, or vendor name",
  "date": "YYYY-MM-DD or empty string",
  "currency": "INR",
  "subtotal": 0,
  "tax": 0,
  "serviceCharge": 0,
  "tip": 0,
  "total": 0,
  "category": "Food & Dining",
  "items": [
    {
      "name": "Item description",
      "qty": 1,
      "price": 0
    }
  ]
}

Important Instructions:
1. Ensure 'total', 'subtotal', 'tax', 'serviceCharge', and item 'price' are pure numeric values (e.g. 450.50, not "Rs 450").
2. Convert all prices to standard numbers. If multiple quantities are listed, 'price' should be the TOTAL price for that line item (price * qty).
3. If line items cannot be individually read (e.g., blurry or simple card swipe slip), extract at least one item representing the merchant charge and total.
4. Set 'category' to one of: "Food & Dining", "Transport", "Stay", "Activities", "Groceries", "Shopping", "Other".
5. Return strictly the JSON object.`

export async function scanReceiptWithGemini(file, apiKeyOverride) {
  const key = apiKeyOverride || getGeminiApiKey()
  if (!key) {
    throw new Error('Gemini API key is required. Please provide a key from Google AI Studio.')
  }

  const { base64Data, previewUrl } = await prepareImageForOCR(file)

  // Try the configured model first (gemini-2.5 is closed to new keys), then a fallback
  const models = [import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.5-flash', 'gemini-3-flash-preview']
  let lastError = null

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`
      const payload = {
        contents: [
          {
            parts: [
              { text: SYSTEM_PROMPT },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        const msg = errJson.error?.message || `HTTP ${res.status}: ${res.statusText}`
        // If model not found (e.g. 404), try next model
        if (res.status === 404) {
          lastError = new Error(msg)
          continue
        }
        throw new Error(msg)
      }

      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) {
        throw new Error('No data extracted from receipt image.')
      }

      let parsed
      try {
        parsed = JSON.parse(text)
      } catch (jsonErr) {
        // Strip any markdown codeblock markers if present
        const cleaned = text.replace(/```json\n?|\n?```/g, '').trim()
        parsed = JSON.parse(cleaned)
      }

      // Sanitize parsed results
      const total = Number(parsed.total) || 0
      const items = Array.isArray(parsed.items)
        ? parsed.items.map((it, idx) => ({
            id: `item-${idx + 1}`,
            name: String(it.name || `Item #${idx + 1}`).trim(),
            qty: Number(it.qty) || 1,
            price: Number(it.price) || 0,
          }))
        : []

      return {
        merchant: parsed.merchant || 'Receipt Expense',
        date: parsed.date || '',
        currency: parsed.currency || 'INR',
        subtotal: Number(parsed.subtotal) || total,
        tax: Number(parsed.tax) || 0,
        serviceCharge: Number(parsed.serviceCharge) || 0,
        tip: Number(parsed.tip) || 0,
        total: total || items.reduce((s, it) => s + it.price, 0),
        category: parsed.category || 'Food & Dining',
        items,
        previewUrl,
      }
    } catch (e) {
      lastError = e
    }
  }

  throw lastError || new Error('Failed to analyze receipt with Gemini.')
}
