// Understand links pasted into the plan chat (Google Maps, websites, blogs).
// Google Maps links that contain the place are decoded locally (exact, instant, no AI).
// Other links are opened by Gemini's URL tool; if it can't read a page we say so instead of guessing.
import { askText } from './ai'

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi
export const extractUrls = (text) => [...new Set((text.match(URL_RE) || []).map((u) => u.replace(/[.,;!?]+$/, '')))]

const clean = (s) => decodeURIComponent(s.replace(/\+/g, ' ')).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
const isCoord = (s) => /^-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(s || '')

// google.com/maps/place/Om+Beach/@14.51,74.32,17z  ·  ?q=Om+Beach  ·  ?q=14.5,74.3  ·  /maps/search/Om+Beach
export function parseMapsUrl(u) {
  let url
  try { url = new URL(u) } catch { return null }
  const host = url.hostname.replace(/^www\./, '')
  const isMaps = /^maps\.google\./.test(host) || (/^google\.[a-z.]+$/.test(host) && url.pathname.startsWith('/maps'))
  if (!isMaps) return null
  const out = {}
  const at = url.pathname.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/)
  const bang = u.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/) // exact pin, preferred over the map centre
  const ll = bang || at
  if (ll) { out.lat = +ll[1]; out.lng = +ll[2] }
  const named = url.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/)
  if (named) out.name = clean(named[1])
  const q = url.searchParams.get('q') || url.searchParams.get('query') || url.searchParams.get('destination')
  if (q) {
    if (isCoord(q)) { const [a, b] = q.split(',').map(Number); out.lat ??= a; out.lng ??= b }
    else out.name ??= clean(q)
  }
  return out.name || out.lat != null ? out : null
}

// Last meaningful path segment, e.g. /wiki/Murudeshwar_Temple → "Murudeshwar Temple" (ignores IDs like /p/C9xYz).
function slugName(u) {
  try {
    const segs = new URL(u).pathname.split('/').filter(Boolean).reverse()
    for (const s of segs) {
      const c = clean(s).replace(/\.(html?|php|aspx?)$/i, '')
      if (/[a-z]{3,}/i.test(c) && c.split(' ').length <= 8 && !/^\w{6,12}$/.test(s)) return c
    }
  } catch {}
  return ''
}

// → [{ url, name, town, lat, lng, note, ok }]
export async function resolveLinks(urls) {
  const out = []
  const rest = []
  for (const u of urls) {
    const m = parseMapsUrl(u)
    if (m?.name || m?.lat != null) out.push({ url: u, name: m.name || '', lat: m.lat, lng: m.lng, ok: true, how: 'maps' })
    else rest.push(u)
  }
  if (!rest.length) return out

  let lines = [], statuses = {}
  try {
    const r = await askText({
      parts: [`For each URL below, open it and say which real place it is about (a sight, restaurant, hotel, beach, activity…).
Answer one line per URL in exactly this format:
URL | place name | town/city | one short line about it
If you could NOT open the page, write: URL | UNKNOWN
Never guess from the URL text.

${rest.join('\n')}`],
      urlContext: true,
    })
    lines = r.text.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p.length >= 2)
    statuses = r.urlStatus
  } catch {}

  for (const u of rest) {
    const row = lines.find((p) => p[0] && (p[0] === u || u.startsWith(p[0]) || p[0].startsWith(u)))
    const fetched = statuses[u] === 'URL_RETRIEVAL_STATUS_SUCCESS'
    if (row && fetched && row[1] && row[1] !== 'UNKNOWN') {
      out.push({ url: u, name: row[1], town: row[2] || '', note: row[3] || '', ok: true, how: 'read' })
    } else {
      const slug = slugName(u)
      out.push(slug ? { url: u, name: slug, ok: true, how: 'slug' } : { url: u, ok: false })
    }
  }
  return out
}

export const describeResolved = (r) => r.ok
  ? `${r.url} → ${[r.name, r.town].filter(Boolean).join(', ')}${r.lat != null ? ` (exact location ${r.lat.toFixed(5)},${r.lng.toFixed(5)})` : ''}${r.note ? ` — ${r.note}` : ''}`
  : `${r.url} → could not be opened (ask the user which place it is; do not guess)`
