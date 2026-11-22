// Shared bits for visited places (trip screen + public share page).
export const CATEGORIES = [
  ['food', '🍽️', 'Food'],
  ['stay', '🏨', 'Stay'],
  ['beach', '🏖️', 'Beach'],
  ['view', '🌄', 'Viewpoint'],
  ['activity', '🎯', 'Activity'],
  ['culture', '🛕', 'Culture'],
  ['shop', '🛍️', 'Shopping'],
  ['other', '📍', 'Other'],
]
export const catOf = (k) => CATEGORIES.find(([c]) => c === k) || CATEGORIES[CATEGORIES.length - 1]
export const mapsLink = (p) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat},${p.lng}`)}`
export const stars = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '')

export function shareText(tripName, places) {
  const sorted = [...places].sort((a, b) => (b.rating || 0) - (a.rating || 0))
  const lines = sorted.map((p) => {
    const [, icon] = catOf(p.category)
    return `${icon} *${p.name}*${p.rating ? ` ${stars(p.rating)}` : ''}${p.note ? `\n   ${p.note}` : ''}\n   ${mapsLink(p)}`
  })
  return `📍 *Places we loved — ${tripName}*\n\n${lines.join('\n\n')}`
}
