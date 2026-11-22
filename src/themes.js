// Trip Cover Themes & Destination Branding

export const DESTINATION_THEMES = [
  {
    id: 'beach',
    name: 'Beach & Coastal',
    icon: '🏖️',
    gradient: 'from-amber-500 via-teal-700 to-teal-950',
    headerBg: 'bg-gradient-to-r from-amber-600 to-teal-800',
    badgeBg: 'bg-teal-500/20 text-teal-200 border-teal-400/30',
    accent: '#0f766e',
  },
  {
    id: 'mountains',
    name: 'Mountains & Snow',
    icon: '🏔️',
    gradient: 'from-slate-900 via-blue-950 to-teal-900',
    headerBg: 'bg-gradient-to-r from-slate-900 via-slate-800 to-teal-900',
    badgeBg: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/30',
    accent: '#0e7490',
  },
  {
    id: 'heritage',
    name: 'Royal Heritage',
    icon: '🏰',
    gradient: 'from-amber-700 via-orange-800 to-stone-900',
    headerBg: 'bg-gradient-to-r from-orange-800 to-amber-900',
    badgeBg: 'bg-amber-500/20 text-amber-200 border-amber-400/30',
    accent: '#c2410c',
  },
  {
    id: 'city',
    name: 'City & Metro',
    icon: '🏛️',
    gradient: 'from-indigo-900 via-purple-950 to-slate-900',
    headerBg: 'bg-gradient-to-r from-indigo-900 to-purple-900',
    badgeBg: 'bg-purple-500/20 text-purple-200 border-purple-400/30',
    accent: '#4338ca',
  },
  {
    id: 'nature',
    name: 'Forest & Jungle',
    icon: '🌿',
    gradient: 'from-emerald-800 via-teal-900 to-slate-900',
    headerBg: 'bg-gradient-to-r from-emerald-800 to-teal-900',
    badgeBg: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30',
    accent: '#047857',
  },
  {
    id: 'desert',
    name: 'Desert Safari',
    icon: '🐪',
    gradient: 'from-yellow-700 via-amber-800 to-stone-900',
    headerBg: 'bg-gradient-to-r from-amber-700 to-yellow-800',
    badgeBg: 'bg-yellow-500/20 text-yellow-200 border-yellow-400/30',
    accent: '#b45309',
  },
  {
    id: 'party',
    name: 'Nightlife & Island',
    icon: '🪩',
    gradient: 'from-fuchsia-800 via-purple-900 to-indigo-950',
    headerBg: 'bg-gradient-to-r from-fuchsia-900 to-purple-900',
    badgeBg: 'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/30',
    accent: '#86198f',
  },
]

export function getTheme(themeId) {
  return DESTINATION_THEMES.find((t) => t.id === themeId) || DESTINATION_THEMES[0]
}

export function detectThemeFromName(name = '') {
  const n = name.toLowerCase()
  if (/goa|beach|bali|maldives|phuket|pondicherry|gokarna|sea|coast|andaman|island/i.test(n)) return 'beach'
  if (/manali|shimla|ladakh|kashmir|snow|himalaya|alps|trek|mountain|hill|rishikesh|mcleod|leh/i.test(n)) return 'mountains'
  if (/jaipur|udaipur|rajasthan|hampi|varanasi|agra|heritage|fort|palace|jodhpur/i.test(n)) return 'heritage'
  if (/dubai|singapore|tokyo|london|paris|york|city|bangkok|kuala|metro|amsterdam/i.test(n)) return 'city'
  if (/coorg|wayanad|jungle|forest|safari|kabini|national|green|nature/i.test(n)) return 'nature'
  if (/desert|jaisalmer|safari|dune/i.test(n)) return 'desert'
  if (/party|rave|club|bachelor|bachelorette|night|festival|sunburn|new year/i.test(n)) return 'party'
  return 'beach'
}
