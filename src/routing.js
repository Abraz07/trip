// Driving distance/time between two points via the public OSRM demo server (OpenStreetMap data).
// Results are cached per coordinate pair in localStorage, and requests run one at a time to stay polite.
const CACHE = 'yatra:route:'
const key = (a, b) => CACHE + [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(4)).join(',')
const inflight = new Map()
let queue = Promise.resolve()
const throttle = (fn) => {
  const run = queue.then(fn)
  queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 400)))
  return run
}

// → { km, min } or null if no road route.
export function driveTime(a, b) {
  if (!a || !b || typeof a.lat !== 'number' || typeof b.lat !== 'number') return Promise.resolve(null)
  const k = key(a, b)
  try {
    const c = localStorage.getItem(k)
    if (c) return Promise.resolve(c === 'none' ? null : JSON.parse(c))
  } catch {}
  if (!inflight.has(k)) {
    inflight.set(k, throttle(async () => {
      try {
        const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`)
        if (!r.ok) return null // don't cache server errors; try again next time
        const j = await r.json()
        const route = j.routes?.[0]
        const out = route ? { km: Math.round(route.distance / 100) / 10, min: Math.round(route.duration / 60) } : null
        try { localStorage.setItem(k, out ? JSON.stringify(out) : 'none') } catch {}
        return out
      } catch {
        return null
      } finally {
        inflight.delete(k)
      }
    }))
  }
  return inflight.get(k)
}

// Fetch full turn-by-turn road geometry (array of [lat, lng]) for a sequence of stops
export async function fetchFullRoadRoute(points) {
  if (!Array.isArray(points) || points.length < 2) return null
  const coordsStr = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';')
  const cacheKey = `yatra:roadgeom:${coordsStr}`
  try {
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) return JSON.parse(cached)
  } catch {}

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`
    const res = await throttle(() => fetch(url))
    if (!res.ok) return null
    const data = await res.json()
    const route = data.routes?.[0]
    if (!route?.geometry?.coordinates) return null
    // OSRM returns [lng, lat], Leaflet polyline expects [lat, lng]
    const latLngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng])
    const result = {
      latLngs,
      distanceKm: Math.round(route.distance / 100) / 10,
      durationMin: Math.round(route.duration / 60),
    }
    try { sessionStorage.setItem(cacheKey, JSON.stringify(result)) } catch {}
    return result
  } catch {
    return null
  }
}

// "2h", "1.5h", "90m", "1h 30m", "45 min" → minutes (0 if unreadable).
export function parseDuration(s) {
  if (!s) return 0
  const t = String(s).toLowerCase()
  let m = 0
  const h = t.match(/(\d+(?:\.\d+)?)\s*h/)
  const mm = t.match(/(\d+)\s*m/)
  if (h) m += parseFloat(h[1]) * 60
  if (mm) m += parseInt(mm[1], 10)
  if (!h && !mm && /^\d+(\.\d+)?$/.test(t.trim())) m = parseFloat(t) * 60 // bare "2" = 2 hours
  return Math.round(m)
}

export const toMin = (hhmm) => (/^\d{2}:\d{2}$/.test(hhmm || '') ? +hhmm.slice(0, 2) * 60 + +hhmm.slice(3) : null)
export const fmtMin = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`)
