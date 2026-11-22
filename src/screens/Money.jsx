import { useState } from 'react'
import { useCol, add, remove } from '../data'
import { balances, settleUp, equalSplit, inr, upiLink } from '../settle'
import { WhatsAppButton, tripLink } from '../share'
import ScanBill from './ScanBill'
import { scanAvailable } from '../scan'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Money({ tripId, trip, uid, members, byId }) {
  const expenses = useCol(tripId, 'expenses')
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [deletingExpense, setDeletingExpense] = useState(null)

  const bal = balances(expenses, members)
  const txns = settleUp(bal)
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const name = (id) => (id === uid ? 'You' : byId[id]?.name || '?')

  function exportCSV() {
    if (expenses.length === 0) {
      alert('No expenses to export yet.')
      return
    }
    const headers = ['Title', 'Amount (INR)', 'Paid By', 'Split Ways', 'Your Share (INR)', 'Type']
    const rows = expenses.map((e) => [
      `"${(e.title || '').replace(/"/g, '""')}"`,
      e.amount,
      `"${(byId[e.paidBy]?.name || 'Unknown').replace(/"/g, '""')}"`,
      Object.keys(e.splits || {}).length,
      e.splits?.[uid] || 0,
      e.scanned ? 'AI Scanned' : 'Manual',
    ])
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `yatra-${(trip.name || 'trip').toLowerCase().replace(/[^\w-]/g, '_')}-expenses.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <section className="grid grid-cols-2 gap-3">
        <div className="card"><p className="text-xs text-slate-500">Trip total</p><p className="text-xl font-bold">{inr(total)}</p></div>
        <div className="card"><p className="text-xs text-slate-500">Per person (avg)</p><p className="text-xl font-bold">{inr(total / (members.length || 1))}</p></div>
      </section>

      {open === 'manual' && <AddExpense uid={uid} members={members} onCancel={() => setOpen(false)} onAdd={(e) => { add(tripId, 'expenses', e); setOpen(false) }} />}
      {open === 'scan' && <ScanBill uid={uid} members={members} onCancel={() => setOpen(false)} onSave={(e) => { add(tripId, 'expenses', e); setOpen(false) }} />}
      {!open && (
        <div className="flex gap-2">
          <button className="btn flex-1" onClick={() => setOpen('manual')}>+ Add expense</button>
          <button className="btn flex-1 bg-gradient-to-r from-teal-800 to-slate-900 shadow-sm flex items-center justify-center gap-1.5" onClick={() => setOpen('scan')}>
            <span>📷</span> Scan bill (AI)
          </button>
        </div>
      )}

      <section className="card">
        <h2 className="font-semibold">Settle up</h2>
        {txns.length === 0 && <p className="text-sm text-slate-500 mt-1">Everyone's square 👌</p>}
        <ul className="mt-2 space-y-2">
          {txns.map((t, i) => {
            const payee = byId[t.to]
            return (
              <li key={i} className={`flex items-center gap-2 rounded-xl p-2 ${t.from === uid ? 'bg-amber-50' : ''}`}>
                <span className="flex-1 text-sm"><b>{name(t.from)}</b> → <b>{name(t.to)}</b></span>
                <span className="font-semibold">{inr(t.amount)}</span>
                {t.from === uid && (payee?.upi
                  ? <a className="btn py-1.5 text-sm" href={upiLink({ vpa: payee.upi, name: payee.name, amount: t.amount, note: 'Yatra trip settle-up' })}>Pay</a>
                  : <span className="text-xs text-slate-400 w-16 text-right">no UPI ID yet</span>)}
              </li>
            )
          })}
        </ul>
        {txns.length > 0 && (
          <WhatsAppButton className="w-full mt-3" label="Send settle-up to group"
            text={`💸 *${trip.name} — settle up*\nTotal spent: ${inr(total)}\n\n${txns.map((t) => `${byId[t.from]?.name} → ${byId[t.to]?.name}: ${inr(t.amount)}`).join('\n')}\n\nPay with one tap in Yatra 👉 ${tripLink(tripId)}`} />
        )}
      </section>

      <section className="card">
        <h2 className="font-semibold">Balances</h2>
        <ul className="mt-2 space-y-1">
          {members.map((m) => (
            <li key={m.id} className="flex justify-between text-sm">
              <span>{name(m.id)}</span>
              <span className={bal[m.id] > 0.5 ? 'text-teal-700' : bal[m.id] < -0.5 ? 'text-red-600' : 'text-slate-400'}>
                {bal[m.id] > 0.5 ? `gets ${inr(bal[m.id])}` : bal[m.id] < -0.5 ? `owes ${inr(-bal[m.id])}` : 'settled'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-0">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="font-semibold">All expenses</h2>
          {expenses.length > 0 && (
            <button
              type="button"
              onClick={exportCSV}
              className="text-xs text-teal-700 font-semibold hover:text-teal-900 flex items-center gap-1"
            >
              <span>📊</span> Export CSV
            </button>
          )}
        </div>
        {expenses.length === 0 && <p className="px-4 pb-4 pt-2 text-sm text-slate-400">None yet.</p>}
        <ul className="divide-y divide-slate-100 mt-2">
          {[...expenses].reverse().map((e) => {
            const hasItems = e.items && e.items.length > 0
            const isExpanded = expandedId === e.id
            return (
              <li key={e.id} className="px-4 py-3">
                <div className="flex gap-3 items-center">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate flex items-center gap-1.5">
                      {e.title}
                      {e.scanned && <span className="text-[10px] bg-teal-100 text-teal-800 rounded px-1.5 py-0.5 font-semibold">AI Scanned</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {name(e.paidBy)} paid · {hasItems ? `${e.items.length} items` : `split ${Object.keys(e.splits || {}).length} ways`}
                    </p>
                    {e.splits?.[uid] > 0 && <p className="text-xs text-teal-700 font-medium">Your share: {inr(e.splits[uid])}</p>}
                  </div>
                  <span className="font-semibold">{inr(e.amount)}</span>
                  {hasItems && (
                    <button
                      type="button"
                      aria-label="Toggle details"
                      className="text-xs text-teal-700 px-1 font-semibold"
                      onClick={() => setExpandedId(isExpanded ? null : e.id)}
                    >
                      {isExpanded ? '▲' : '▼'}
                    </button>
                  )}
                  <button
                    aria-label="Delete"
                    className="text-slate-400 hover:text-red-500 transition px-1"
                    onClick={() => setDeletingExpense(e)}
                  >
                    ✕
                  </button>
                </div>

                {isExpanded && hasItems && (
                  <div className="mt-2.5 pt-2 border-t border-slate-100 bg-slate-50 rounded-xl p-3 text-xs space-y-1.5">
                    <p className="font-semibold text-slate-700">Receipt Breakdown:</p>
                    <div className="space-y-1 divide-y divide-slate-200/60">
                      {e.items.map((it, idx) => (
                        <div key={idx} className="flex justify-between pt-1 first:pt-0">
                          <div>
                            <span className="font-medium text-slate-800">{it.name}</span>
                            {it.who && it.who.length > 0 && (
                              <span className="text-slate-400 block text-[11px]">
                                for {it.who.map((w) => (w === uid ? 'You' : byId[w]?.name || '?')).join(', ')}
                              </span>
                            )}
                          </div>
                          <span className="font-semibold text-slate-900">{inr(it.price)}</span>
                        </div>
                      ))}
                    </div>
                    {e.extras !== undefined && Number(e.extras) !== 0 && (
                      <div className="flex justify-between pt-1 border-t border-slate-200 font-medium text-slate-500">
                        <span>Taxes & Charges</span>
                        <span>{inr(e.extras)}</span>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deletingExpense}
        title="Delete Expense?"
        message={`Are you sure you want to delete "${deletingExpense?.title}" (${inr(deletingExpense?.amount)})? This will update balances for everyone.`}
        onConfirm={() => {
          remove(tripId, 'expenses', deletingExpense.id)
          setDeletingExpense(null)
        }}
        onCancel={() => setDeletingExpense(null)}
      />
    </>
  )
}

function AddExpense({ uid, members, onAdd, onCancel }) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState(uid)
  const [among, setAmong] = useState(() => new Set(members.map((m) => m.id)))
  const toggle = (id) => { const s = new Set(among); s.has(id) ? s.delete(id) : s.add(id); setAmong(s) }
  const amt = Number(amount)
  const valid = title.trim() && amt > 0 && among.size > 0

  return (
    <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) onAdd({ title: title.trim(), amount: amt, paidBy, splits: equalSplit(amt, [...among]), by: uid }) }}>
      <div className="flex gap-2">
        <input required autoFocus className="input" placeholder="What for? (Dinner, Cab…)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input required inputMode="decimal" className="input w-28" placeholder="₹" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
      </div>
      <label className="block text-sm font-medium">Paid by
        <select className="input mt-1" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {members.map((m) => <option key={m.id} value={m.id}>{m.id === uid ? `${m.name} (you)` : m.name}</option>)}
        </select>
      </label>
      <div>
        <div className="flex justify-between text-sm font-medium">
          <span>Split equally between</span>
          {amt > 0 && among.size > 0 && <span className="text-slate-500">{inr(amt / among.size)} each</span>}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {members.map((m) => (
            <button type="button" key={m.id} onClick={() => toggle(m.id)} className={`rounded-full px-3 py-1.5 text-sm border ${among.has(m.id) ? 'bg-teal-700 text-white border-teal-700' : 'border-slate-300'}`}>{m.name}</button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={onCancel}>Cancel</button>
        <button disabled={!valid} className="btn flex-1">Save</button>
      </div>
    </form>
  )
}
