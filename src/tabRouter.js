export const VALID_TABS = ['today', 'plan', 'map', 'money', 'photos', 'more']

export function getActiveTab(
  tripId,
  hash = (typeof location !== 'undefined' ? location.hash : ''),
  storage = (typeof sessionStorage !== 'undefined' ? sessionStorage : null)
) {
  // 1. Check URL hash: #/t/:tripId/:tab
  const match = (hash || '').match(/^#\/t\/[\w-]+\/(\w+)/)
  if (match && VALID_TABS.includes(match[1])) {
    return match[1]
  }
  // 2. Check sessionStorage for this trip
  try {
    if (storage) {
      const saved = storage.getItem(`yatra:tab:${tripId}`)
      if (saved && VALID_TABS.includes(saved)) {
        return saved
      }
    }
  } catch {}
  // 3. Fallback to 'today'
  return 'today'
}

export function saveActiveTab(
  tripId,
  tab,
  storage = (typeof sessionStorage !== 'undefined' ? sessionStorage : null)
) {
  if (!VALID_TABS.includes(tab)) return
  try {
    if (storage) {
      storage.setItem(`yatra:tab:${tripId}`, tab)
    }
  } catch {}
}
