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

export const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')

export const upiLink = ({ vpa, name, amount, note }) =>
  `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(name)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`
