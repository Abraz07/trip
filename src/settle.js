// Each expense: { amount, paidBy, splits: { uid: share } }
export function balances(expenses, members) {
  const bal = Object.fromEntries(members.map((m) => [m.id, 0]))
  for (const e of expenses) {
    bal[e.paidBy] = (bal[e.paidBy] || 0) + Number(e.amount)
    for (const [uid, share] of Object.entries(e.splits || {})) bal[uid] = (bal[uid] || 0) - Number(share)
  }
  return bal
}

// Greedy: biggest debtor pays biggest creditor → at most n-1 transfers.
export function settleUp(bal) {
  const debt = [], cred = []
  for (const [uid, v] of Object.entries(bal)) {
    const r = Math.round(v * 100) / 100
    if (r < -0.5) debt.push([uid, -r])
    else if (r > 0.5) cred.push([uid, r])
  }
  debt.sort((a, b) => b[1] - a[1]); cred.sort((a, b) => b[1] - a[1])
  const out = []
  let i = 0, j = 0
  while (i < debt.length && j < cred.length) {
    const amt = Math.min(debt[i][1], cred[j][1])
    out.push({ from: debt[i][0], to: cred[j][0], amount: Math.round(amt) })
    debt[i][1] -= amt; cred[j][1] -= amt
    if (debt[i][1] < 0.5) i++
    if (cred[j][1] < 0.5) j++
  }
  return out
}

export function equalSplit(amount, uids) {
  const n = uids.length
  const base = Math.floor((amount * 100) / n) / 100
  const splits = Object.fromEntries(uids.map((u) => [u, base]))
  splits[uids[0]] = Math.round((amount - base * (n - 1)) * 100) / 100 // remainder to first
  return splits
}

export const EXPENSE_CATEGORIES = [
  { id: 'food', name: 'Food & Dining', icon: '🍽️', color: '#ea580c', bg: 'bg-orange-50 text-orange-700 border-orange-200' },
  { id: 'transport', name: 'Transport & Fuel', icon: '🚕', color: '#0284c7', bg: 'bg-sky-50 text-sky-700 border-sky-200' },
  { id: 'stay', name: 'Stay & Hotels', icon: '🏨', color: '#7c3aed', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
  { id: 'activity', name: 'Activities & Sights', icon: '🎯', color: '#db2777', bg: 'bg-pink-50 text-pink-700 border-pink-200' },
  { id: 'groceries', name: 'Groceries & Snacks', icon: '🛒', color: '#16a34a', bg: 'bg-green-50 text-green-700 border-green-200' },
  { id: 'shopping', name: 'Shopping & Gear', icon: '🛍️', color: '#ca8a04', bg: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'other', name: 'Other / Misc', icon: '🏷️', color: '#475569', bg: 'bg-slate-50 text-slate-700 border-slate-200' },
]

export function getCategory(id) {
  return EXPENSE_CATEGORIES.find((c) => c.id === id) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]
}

export function detectCategory(title = '') {
  const t = title.toLowerCase()
  if (/supermarket|grocery|groceries|mart|convenience|kirana|supplies/i.test(t)) return 'groceries'
  if (/hotel|resort|villa|airbnb|homestay|cottage|hostel|stay|lodge|camp/i.test(t)) return 'stay'
  if (/scuba|diving|trek|guide|safari|boat|kayak|entry|museum|monument|fort|palace|show|club/i.test(t)) return 'activity'
  if (/cab|uber|ola|taxi|auto|rickshaw|metro|train|flight|toll|fuel|petrol|diesel|gas|bus|rental|scooter/i.test(t)) return 'transport'
  if (/dinner|lunch|breakfast|food|cafe|restaurant|bistro|bar|beer|cocktail|drinks|tea|coffee|maggi|shack|burger|pizza/i.test(t)) return 'food'
  if (/chips|water bottle|snacks|milk/i.test(t)) return 'groceries'
  if (/shop|souvenir|clothes|tshirt|dress|hat|sunglass|medicine|pharmacy/i.test(t)) return 'shopping'
  return 'other'
}

// Split by exact custom amounts
export function exactSplit(exactMap) {
  const splits = {}
  for (const [uid, val] of Object.entries(exactMap)) {
    const num = Math.round(Number(val) * 100) / 100
    if (num > 0) splits[uid] = num
  }
  return splits
}

// Split by shares/parts (e.g. { alice: 2, bob: 1 })
export function shareSplit(amount, shareMap) {
  const entries = Object.entries(shareMap).filter(([, s]) => Number(s) > 0)
  const totalShares = entries.reduce((acc, [, s]) => acc + Number(s), 0)
  if (totalShares === 0) return {}

  let allocated = 0
  const splits = {}
  entries.forEach(([uid, s], idx) => {
    if (idx === entries.length - 1) {
      splits[uid] = Math.round((amount - allocated) * 100) / 100
    } else {
      const share = Math.floor(((amount * Number(s)) / totalShares) * 100) / 100
      splits[uid] = share
      allocated += share
    }
  })
  return splits
}

// Split by percentages (e.g. { alice: 60, bob: 40 })
export function percentSplit(amount, percentMap) {
  const entries = Object.entries(percentMap).filter(([, p]) => Number(p) > 0)
  let allocated = 0
  const splits = {}
  entries.forEach(([uid, p], idx) => {
    if (idx === entries.length - 1) {
      splits[uid] = Math.round((amount - allocated) * 100) / 100
    } else {
      const share = Math.floor((amount * (Number(p) / 100)) * 100) / 100
      splits[uid] = share
      allocated += share
    }
  })
  return splits
}

export const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')

export const upiLink = ({ vpa, name, amount, note }) =>
  `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(name)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`
