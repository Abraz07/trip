import { parseMapsUrl } from './links'
// Geocoding and Location Parsing Utility for Itinerary Items

const CACHE_PREFIX = 'yatra:geo:'

// Extracts lat/lng if place string contains coordinates or google maps url
export function extractCoordsFromText(text) {
  if (!text || typeof text !== 'string') return null

  // 1. Check for decimal coordinates like "15.4989, 73.8278" or "15.4989,73.8278"
  const coordMatch = text.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/)
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1])
    const lng = parseFloat(coordMatch[2])
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng }
    }
  }

  // 2. Check for google maps @lat,lng or query=lat,lng
  const urlCoordMatch = text.match(/[@?&](?:query|q|ll)?=?(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/)
  if (urlCoordMatch) {
    const lat = parseFloat(urlCoordMatch[1])
    const lng = parseFloat(urlCoordMatch[2])
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng }
    }
  }

  return null
}

// Nominatim's usage policy allows at most 1 request per second, so lookups run one at a time.
// Places that can't be found are remembered too (as 'none'), so they aren't retried on every update.
const MISS = 'none'
const inflight = new Map()
let queue = Promise.resolve()
const throttle = (fn) => {
  const run = queue.then(fn)
  queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)))
  return run
}

export function geocodePlace(placeName) {
  const key = typeof placeName === 'string' ? placeName.trim().toLowerCase() : ''
  if (!key) return Promise.resolve(null)
  if (!inflight.has(key)) inflight.set(key, lookup(placeName))
  return inflight.get(key)
}

async function lookup(placeName) {
  if (!placeName || typeof placeName !== 'string') return null
  const query = placeName.trim()
  if (!query) return null

  // 0. Links are never searched as text (that once put a Dandeli stay in Iran). Full Google Maps
  //    links are decoded; short links are expanded explicitly elsewhere (resolvePlaceLink).
  if (/^https?:\/\//i.test(query)) {
    const m = parseMapsUrl(query)
    if (m?.lat != null) return { lat: m.lat, lng: m.lng, displayName: m.name || '' }
    if (m?.name) return geocodePlace(m.name)
    return null
  }

  // 1. Direct coordinate check
  const direct = extractCoordsFromText(query)
  if (direct) return direct

  // 2. Check local storage cache
  const cacheKey = CACHE_PREFIX + query.toLowerCase()
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached === MISS) return null
    if (cached) {
      return JSON.parse(cached)
    }
  } catch {}

  // 3. Clean up query if it's a URL
  let searchQuery = query
  if (/^https?:/i.test(query)) {
    try {
      const url = new URL(query)
      const qParam = url.searchParams.get('q') || url.searchParams.get('query')
      if (qParam) searchQuery = qParam
    } catch {}
  }

  // OpenStreetMap often misses "Place, Town" (e.g. "Mirjan Fort, Kumta") but finds "Mirjan Fort Kumta"
  // or "Mirjan Fort", so try progressively simpler versions before giving up.
  const parts = searchQuery.split(',').map((p) => p.trim()).filter(Boolean)
  const candidates = [...new Set([searchQuery, parts.join(' '), parts[0]].filter(Boolean))]

  try {
    for (const q of candidates) {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`
      const res = await throttle(() => fetch(url, { headers: { 'Accept-Language': 'en' } }))
      if (!res.ok) return null // server trouble: don't cache a miss, try again next time
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        const point = {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          displayName: data[0].display_name,
        }
        try {
          localStorage.setItem(cacheKey, JSON.stringify(point))
        } catch {}
        return point
      }
    }
    try {
      localStorage.setItem(cacheKey, MISS)
    } catch {}
  } catch (e) {
    console.warn(`Geocoding failed for "${placeName}":`, e)
  }

  return null
}

// Turn GPS coordinates into a readable place name (e.g. "Om Beach, Gokarna"). Same 1 req/s queue as search.
export async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=${lat}&lon=${lng}`
    const res = await throttle(() => fetch(url, { headers: { 'Accept-Language': 'en' } }))
    if (!res.ok) return null
    const d = await res.json()
    const a = d.address || {}
    const main = d.name || a.tourism || a.amenity || a.leisure || a.natural || a.road || ''
    const area = a.village || a.town || a.city || a.suburb || a.county || ''
    return { name: [main, area].filter(Boolean).join(', ') || d.display_name || '', address: d.display_name || '' }
  } catch {
    return null
  }
}
