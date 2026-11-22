export function fmtRange(a, b) {
  const f = (d) => new Date(d + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return a && b ? `${f(a)} – ${f(b)}` : ''
}

export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function tripDays(trip) {
  const out = []
  if (!trip?.start) return out
  const d = new Date(trip.start + 'T00:00'),
    end = new Date((trip.end || trip.start) + 'T00:00')
  for (let i = 1; d <= end && i < 60; i++, d.setDate(d.getDate() + 1)) out.push({ n: i, date: ymd(d) })
  return out
}
