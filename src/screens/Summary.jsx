import { useCol } from '../data'
import { balances, inr } from '../settle'
import { WhatsAppButton, tripLink } from '../share'
import { fmtRange } from './Trip'

export default function Summary({ tripId, trip, uid, members, byId }) {
  const expenses = useCol(tripId, 'expenses')
  const planItems = useCol(tripId, 'plan')
  const photos = useCol(tripId, 'photos')
  const polls = useCol(tripId, 'polls')

  const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)
  const avg = total / (members.length || 1)

  // Find biggest single expense
  const biggestExpense = [...expenses].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0]

  // Find who paid the most overall
  const paidTotals = {}
  expenses.forEach((e) => {
    paidTotals[e.paidBy] = (paidTotals[e.paidBy] || 0) + Number(e.amount || 0)
  })
  const topPayerEntry = Object.entries(paidTotals).sort((a, b) => b[1] - a[1])[0]
  const topPayerName = topPayerEntry ? byId[topPayerEntry[0]]?.name || 'Someone' : null

  // User's own balance
  const bal = balances(expenses, members)
  const myBal = bal[uid] || 0

  const shareText = `🎉 *${trip.name} — Trip Wrapped!* 🏔️
📅 ${fmtRange(trip.start, trip.end)}
💰 Total Spent: ${inr(total)} (${inr(avg)} / person)
👑 Top Spender: ${topPayerName ? `${topPayerName} (${inr(topPayerEntry[1])})` : '—'}
📍 Planned Stops: ${planItems.length}
📸 Photos Shared: ${photos.length}

Check the trip highlights on Yatra 👉 ${tripLink(tripId)}`

  return (
    <div className="space-y-4">
      {/* Hero Banner */}
      <section className="card bg-gradient-to-br from-teal-800 via-teal-700 to-slate-900 text-white border-0 shadow-md">
        <span className="text-3xl">🎉</span>
        <h2 className="text-xl font-bold mt-1">{trip.name} Highlights</h2>
        <p className="text-xs text-teal-200 mt-0.5">{fmtRange(trip.start, trip.end)} · {members.length} friends</p>
        <p className="text-sm mt-3 pt-3 border-t border-teal-600/50">
          {myBal > 0.5 ? `You're owed ${inr(myBal)} net` : myBal < -0.5 ? `You owe ${inr(-myBal)} net` : 'All square! 👌'}
        </p>
      </section>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-3 space-y-1">
          <p className="text-xs text-slate-500">Total Group Spend</p>
          <p className="text-xl font-bold text-slate-900">{inr(total)}</p>
          <p className="text-[11px] text-teal-700 font-medium">{inr(avg)} avg / person</p>
        </div>

        <div className="card p-3 space-y-1">
          <p className="text-xs text-slate-500">Top Spender 👑</p>
          <p className="text-base font-bold text-slate-900 truncate">{topPayerName || '—'}</p>
          <p className="text-[11px] text-slate-500">{topPayerEntry ? inr(topPayerEntry[1]) : '—'}</p>
        </div>

        <div className="card p-3 space-y-1">
          <p className="text-xs text-slate-500">Planned Stops 📍</p>
          <p className="text-xl font-bold text-slate-900">{planItems.length}</p>
          <p className="text-[11px] text-slate-500">places visited</p>
        </div>

        <div className="card p-3 space-y-1">
          <p className="text-xs text-slate-500">Shared Photos 📸</p>
          <p className="text-xl font-bold text-slate-900">{photos.length}</p>
          <p className="text-[11px] text-slate-500">memories captured</p>
        </div>
      </div>

      {/* Biggest Expense Card */}
      {biggestExpense && (
        <section className="card p-3 flex items-center justify-between gap-3 bg-amber-50/50 border-amber-200">
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Biggest Single Expense</span>
            <p className="font-bold text-sm text-slate-900 truncate mt-0.5">{biggestExpense.title}</p>
            <p className="text-xs text-slate-500">paid by {byId[biggestExpense.paidBy]?.name || 'Someone'}</p>
          </div>
          <span className="text-base font-bold text-slate-900">{inr(biggestExpense.amount)}</span>
        </section>
      )}

      {/* WhatsApp Share Action */}
      <WhatsAppButton
        className="w-full py-3 shadow-sm"
        label="Share Trip Highlights on WhatsApp"
        text={shareText}
      />
    </div>
  )
}
