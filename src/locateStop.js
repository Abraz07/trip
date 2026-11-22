// Find a plan stop on the map even when it has no clean place name.
// Stop titles are often actions ("Arrival at Alnavar Station", "Lunch at Namaste Cafe"), which map
// search can't match, so we strip the action words and also try the name with the trip's destinations.
import { geocodePlace, extractCoordsFromText } from './geocode'
import { resolvePlaceLink } from './links'

const isUrl = (q) => /^https?:\/\//i.test(q || '')

const LEADING = /^(arrival|arrive|arriving|reach|reaching|departure|depart|leave|leaving|drive|driving|travel|transfer|head|heading|go|going|visit|visiting|explore|exploring|check[- ]?in|check[- ]?out|stay|lunch|breakfast|dinner|brunch|snacks?|coffee|tea|sunset|sunrise|trek|hike|walk|pickup|pick up|drop|drop off|back|return|returning)\b(\s+(at|to|in|from|near|by|around|the|of|for))*\s+/i
const TRAILING = /\s+(visit|trip|tour|stop|sunset|sunrise|darshan|walk)$/i

export function cleanTitle(title = '') {
  let t = String(title).trim()
  for (let k = 0; k < 3 && LEADING.test(t); k++) t = t.replace(LEADING, '')
  return t.replace(TRAILING, '').replace(/[()]/g, '').trim()
}

function candidates(stop, destinations = []) {
  const out = []
  const push = (q) => { const v = (q || '').trim(); if (v.length >= 3 && !out.includes(v)) out.push(v) }
  const base = [stop.place, cleanTitle(stop.place || ''), cleanTitle(stop.title)].filter((q) => q && !isUrl(q))
  for (const b of base) {
    // With destinations known, search "name, destination" only: a short bare title like "Nadi teera"
    // can match somewhere in another country (it once landed in Tehran).
    const hasDest = destinations.some((d) => b.toLowerCase().includes(d.toLowerCase()))
    if (!destinations.length || hasDest || b.includes(',')) push(b)
    for (const d of destinations) if (!b.toLowerCase().includes(d.toLowerCase())) push(`${b}, ${d}`)
  }
  return out.slice(0, 6) // each lookup is ~1 s (OpenStreetMap allows 1 request/second)
}

// → { lat, lng, query } or null
export async function locateStop(stop, destinations = []) {
  for (const q of [stop.place, stop.title]) {
    const c = q && extractCoordsFromText(q)
    if (c) return { ...c, query: q }
  }
  // A Google Maps link (full or short) as the place: decode/expand it instead of searching its text.
  for (const q of [stop.place, stop.title]) {
    if (!isUrl(q)) continue
    const r = await resolvePlaceLink(q)
    if (r?.lat != null) return { lat: r.lat, lng: r.lng, query: r.name || q, name: r.name }
    if (r?.name) {
      // Small places (homestays, cafes) often aren't on OpenStreetMap, so widen the address step by step:
      // "Nadi Teera Cottages, Badgund, Ganeshgudi, Dandeli, Karnataka" → "Badgund, Ganeshgudi, …" → …
      // An approximate pin in the right village beats a wrong one; we never fall back to the bare title.
      const parts = r.name.split(',').map((x) => x.trim()).filter(Boolean)
      for (let k = 0; k < Math.max(1, parts.length - 1); k++) {
        const q2 = parts.slice(k).join(', ')
        const g = await geocodePlace(q2)
        if (g?.lat) return { lat: g.lat, lng: g.lng, query: q2, name: r.name, approximate: k > 0 }
      }
      return null
    }
  }
  for (const q of candidates(stop, destinations)) {
    const g = await geocodePlace(q)
    if (g?.lat) return { lat: g.lat, lng: g.lng, query: q }
  }
  return null
}
