import { useState, useMemo } from 'react'
import { useCol, add, update, remove, updateTrip } from '../data'
import {
  balances,
  settleUp,
  equalSplit,
  exactSplit,
  shareSplit,
  percentSplit,
  inr,
  upiLink,
  EXPENSE_CATEGORIES,
  getCategory,
  detectCategory,
} from '../settle'
import { WhatsAppButton, tripLink } from '../share'
import ScanBill from './ScanBill'
import ConfirmDialog from '../components/ConfirmDialog'
import { ymd } from './Trip'

export default function Money({ tripId, trip, uid, members, byId }) {
  const expenses = useCol(tripId, 'expenses')

  // Screen state
  const [open, setOpen] = useState(false) // false | 'manual' | 'scan'
  const [editingExpense, setEditingExpense] = useState(null)
  const [deletingExpense, setDeletingExpense] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [settlingModal, setSettlingModal] = useState(null) // { from, to, amount }
  const [budgetModal, setBudgetModal] = useState(false)
  const [tripBudgetInput, setTripBudgetInput] = useState(trip?.budget || '')

  // Filter & Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('all') // 'all' | 'you-paid' | 'your-share' | 'settlements'
  const [selectedCategory, setSelectedCategory] = useState('all') // 'all' | cat.id

  const name = (id) => (id === uid ? 'You' : byId[id]?.name || 'Traveler')

  // 1. Balances & Settle-up transfers
  const bal = useMemo(() => balances(expenses, members), [expenses, members])
  const txns = useMemo(() => settleUp(bal), [bal])

  // 2. Personal stats
  const userNet = bal[uid] || 0
  const userPaid = useMemo(() => {
    return expenses
      .filter((e) => e.paidBy === uid && e.type !== 'settlement')
      .reduce((s, e) => s + (Number(e.amount) || 0), 0)
  }, [expenses, uid])

  const userShare = useMemo(() => {
    return expenses
      .filter((e) => e.type !== 'settlement')
      .reduce((s, e) => s + (Number(e.splits?.[uid]) || 0), 0)
  }, [expenses, uid])

  // 3. Trip totals & Category breakdown (excluding settlements)
  const actualExpenses = useMemo(() => expenses.filter((e) => e.type !== 'settlement'), [expenses])
  const tripTotal = useMemo(() => actualExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0), [actualExpenses])
  const avgPerPerson = tripTotal / (members.length || 1)

  const categoryTotals = useMemo(() => {
    const map = {}
    EXPENSE_CATEGORIES.forEach((c) => { map[c.id] = 0 })
    actualExpenses.forEach((e) => {
      const cat = e.category || detectCategory(e.title)
      map[cat] = (map[cat] || 0) + (Number(e.amount) || 0)
    })
    return map
  }, [actualExpenses])

  // 4. Filtered expenses list
  const filteredExpenses = useMemo(() => {
    let list = [...expenses].reverse()

    // Type filter
    if (filterType === 'you-paid') {
      list = list.filter((e) => e.paidBy === uid)
    } else if (filterType === 'your-share') {
      list = list.filter((e) => Number(e.splits?.[uid]) > 0 && e.paidBy !== uid)
    } else if (filterType === 'settlements') {
      list = list.filter((e) => e.type === 'settlement')
    }

    // Category filter
    if (selectedCategory !== 'all') {
      list = list.filter((e) => (e.category || detectCategory(e.title)) === selectedCategory)
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter((e) => {
        const titleMatch = (e.title || '').toLowerCase().includes(q)
        const payerMatch = (byId[e.paidBy]?.name || '').toLowerCase().includes(q)
        const notesMatch = (e.notes || '').toLowerCase().includes(q)
        return titleMatch || payerMatch || notesMatch
      })
    }

    return list
  }, [expenses, filterType, selectedCategory, searchQuery, uid, byId])

  // Record a settlement payment directly
  async function handleRecordSettlement({ from, to, amount }) {
    await add(tripId, 'expenses', {
      type: 'settlement',
      title: `Settlement: ${name(from)} → ${name(to)}`,
      amount: Number(amount),
      paidBy: from,
      splits: { [to]: Number(amount) },
      category: 'other',
      by: uid,
      settledAt: new Date().toISOString(),
    })
    setSettlingModal(null)
  }

  // Export clean CSV
  function exportCSV() {
    if (expenses.length === 0) return alert('No expenses to export yet.')
    const headers = ['Date', 'Type', 'Category', 'Title', 'Amount (INR)', 'Paid By', 'Your Share (INR)', 'Splits Count', 'Notes']
    const rows = expenses.map((e) => [
      `"${e.date || ''}"`,
      `"${e.type === 'settlement' ? 'Settlement' : 'Expense'}"`,
      `"${getCategory(e.category || detectCategory(e.title)).name}"`,
      `"${(e.title || '').replace(/"/g, '""')}"`,
      e.amount,
      `"${(byId[e.paidBy]?.name || 'Unknown').replace(/"/g, '""')}"`,
      e.splits?.[uid] || 0,
      Object.keys(e.splits || {}).length,
      `"${(e.notes || '').replace(/"/g, '""')}"`,
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

  // Handle Trip Budget save
  async function handleSaveBudget(e) {
    e.preventDefault()
    const budgetNum = Number(tripBudgetInput)
    await updateTrip(tripId, { budget: budgetNum > 0 ? budgetNum : null })
    setBudgetModal(false)
  }

  const budgetNum = Number(trip?.budget) || 0
  const budgetPercent = budgetNum > 0 ? Math.min(Math.round((tripTotal / budgetNum) * 100), 100) : 0

  return (
    <div className="space-y-4">
      {/* 1. PERSONAL BALANCE HERO BANNER */}
      <section
        className={`rounded-3xl p-5 text-white shadow-xl relative overflow-hidden transition-all ${
          userNet > 0.5
            ? 'bg-gradient-to-br from-emerald-800 via-teal-900 to-slate-950 shadow-emerald-950/20'
            : userNet < -0.5
            ? 'bg-gradient-to-br from-rose-900 via-slate-900 to-zinc-950 shadow-rose-950/20'
            : 'bg-gradient-to-br from-teal-900 via-slate-900 to-slate-950'
        }`}
      >
        <div className="relative z-10 space-y-2">
          <div className="flex items-center justify-between">
            <span
              className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider backdrop-blur-xs ${
                userNet > 0.5
                  ? 'bg-emerald-400/20 text-emerald-200 border border-emerald-400/30'
                  : userNet < -0.5
                  ? 'bg-rose-400/20 text-rose-200 border border-rose-400/30'
                  : 'bg-teal-400/20 text-teal-200 border border-teal-400/30'
              }`}
            >
              {userNet > 0.5 ? '🟢 You Are Owed' : userNet < -0.5 ? '🔴 You Owe' : '✓ All Settled'}
            </span>

            <span className="text-xs text-white/70">
              Trip total: {inr(tripTotal)}
            </span>
          </div>

          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">
              {userNet > 0.5
                ? `+${inr(userNet)}`
                : userNet < -0.5
                ? `-${inr(-userNet)}`
                : '₹0'}
            </h2>
            <p className="text-xs text-white/80 mt-0.5">
              {userNet > 0.5
                ? `Your friends owe you ${inr(userNet)} in total.`
                : userNet < -0.5
                ? `You owe ${inr(-userNet)} to settle your share.`
                : `You're all square! No pending balances.`}
            </p>
          </div>

          <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs text-white/70">
            <div>
              <span>You paid: </span>
              <span className="font-semibold text-white">{inr(userPaid)}</span>
            </div>
            <div>
              <span>Your actual share: </span>
              <span className="font-semibold text-white">{inr(userShare)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. TRIP OVERVIEW & BUDGET BAR */}
      <section className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">Trip Expenditure</p>
            <p className="text-xl font-bold text-slate-900">{inr(tripTotal)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500 font-medium">Per Person (Avg)</p>
            <p className="text-xl font-bold text-slate-900">{inr(avgPerPerson)}</p>
          </div>
        </div>

        {/* Optional Trip Budget Gauge */}
        {budgetNum > 0 ? (
          <div className="space-y-1.5 pt-2 border-t border-slate-100">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500 font-medium">
                Budget: {inr(tripTotal)} of {inr(budgetNum)}
              </span>
              <button
                type="button"
                onClick={() => setBudgetModal(true)}
                className="text-teal-700 font-semibold hover:underline"
              >
                {budgetPercent}% spent · Edit
              </button>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                style={{ width: `${budgetPercent}%` }}
                className={`h-full rounded-full transition-all ${
                  budgetPercent > 90
                    ? 'bg-rose-500'
                    : budgetPercent > 75
                    ? 'bg-amber-500'
                    : 'bg-teal-600'
                }`}
              />
            </div>
          </div>
        ) : (
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400">Want to track a spending limit?</span>
            <button
              type="button"
              onClick={() => setBudgetModal(true)}
              className="text-xs text-teal-700 font-semibold hover:underline"
            >
              + Set Trip Budget
            </button>
          </div>
        )}
      </section>

      {/* ACTION BAR: Add Expense / Scan Bill */}
      {open === 'manual' && (
        <ExpenseModal
          uid={uid}
          members={members}
          existing={editingExpense}
          onCancel={() => { setOpen(false); setEditingExpense(null) }}
          onSave={async (data) => {
            if (editingExpense) {
              await update(tripId, 'expenses', editingExpense.id, data)
            } else {
              await add(tripId, 'expenses', data)
            }
            setOpen(false)
            setEditingExpense(null)
          }}
        />
      )}

      {open === 'scan' && (
        <ScanBill
          uid={uid}
          members={members}
          onCancel={() => setOpen(false)}
          onSave={async (e) => {
            await add(tripId, 'expenses', {
              ...e,
              category: e.category || detectCategory(e.title),
            })
            setOpen(false)
          }}
        />
      )}

      {!open && (
        <div className="flex gap-2">
          <button
            onClick={() => { setEditingExpense(null); setOpen('manual') }}
            className="btn flex-1 py-3 text-sm font-bold shadow-md shadow-teal-700/10 flex items-center justify-center gap-1.5"
          >
            <span>+</span> Add Expense
          </button>
          <button
            onClick={() => setOpen('scan')}
            className="btn flex-1 py-3 text-sm font-bold bg-gradient-to-r from-teal-900 to-slate-900 shadow-md shadow-slate-900/10 flex items-center justify-center gap-1.5 text-white"
          >
            <span>📷</span> Scan Bill (AI)
          </button>
        </div>
      )}

      {/* 3. VISUAL SPEND CATEGORY BREAKDOWN */}
      {tripTotal > 0 && (
        <section className="card p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-xs text-slate-700 uppercase tracking-wider">
              Spending by Category
            </h3>
            {selectedCategory !== 'all' && (
              <button
                onClick={() => setSelectedCategory('all')}
                className="text-xs text-teal-700 font-semibold hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>

          {/* Segmented Color Bar */}
          <div className="flex h-3 w-full rounded-full overflow-hidden bg-slate-100 shadow-inner">
            {EXPENSE_CATEGORIES.map((c) => {
              const amount = categoryTotals[c.id] || 0
              if (amount === 0) return null
              const pct = (amount / tripTotal) * 100
              return (
                <div
                  key={c.id}
                  style={{ width: `${pct}%`, backgroundColor: c.color }}
                  title={`${c.name}: ${inr(amount)} (${Math.round(pct)}%)`}
                  className="h-full hover:opacity-80 transition cursor-pointer first:rounded-l-full last:rounded-r-full"
                  onClick={() => setSelectedCategory(selectedCategory === c.id ? 'all' : c.id)}
                />
              )
            })}
          </div>

          {/* Category Filter Pills */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pt-1">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                selectedCategory === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All ({inr(tripTotal)})
            </button>
            {EXPENSE_CATEGORIES.map((c) => {
              const amount = categoryTotals[c.id] || 0
              if (amount === 0) return null
              const isSelected = selectedCategory === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedCategory(isSelected ? 'all' : c.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap flex items-center gap-1 transition ${
                    isSelected
                      ? 'bg-slate-900 text-white shadow-sm'
                      : `${c.bg} border hover:opacity-90`
                  }`}
                >
                  <span>{c.icon}</span>
                  <span>{c.name}</span>
                  <span className="opacity-75 font-normal">({inr(amount)})</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* 4. SETTLE UP (DEBT MINIMIZATION & DIRECT RECORD PAYMENT) */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-base">⚡</span>
            <h3 className="font-bold text-sm text-slate-900">Settle Up</h3>
          </div>
          <span className="text-xs text-slate-400">
            {txns.length} transfer{txns.length === 1 ? '' : 's'} needed
          </span>
        </div>

        {txns.length === 0 ? (
          <div className="text-center py-4 text-slate-500 text-sm">
            <span className="text-2xl block mb-1">🎉</span>
            Everyone is completely square! No debts pending.
          </div>
        ) : (
          <ul className="space-y-2">
            {txns.map((t, idx) => {
              const payee = byId[t.to]
              const payer = byId[t.from]
              const isPayerMe = t.from === uid
              const isPayeeMe = t.to === uid

              return (
                <li
                  key={idx}
                  className={`rounded-2xl p-3 border transition ${
                    isPayerMe
                      ? 'bg-rose-50/70 border-rose-200'
                      : isPayeeMe
                      ? 'bg-emerald-50/70 border-emerald-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="size-8 rounded-full bg-white border border-slate-200 shadow-xs font-bold text-xs text-slate-700 grid place-items-center shrink-0">
                        {payer?.name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          <span className={isPayerMe ? 'text-rose-700 font-bold' : ''}>
                            {name(t.from)}
                          </span>
                          <span className="text-slate-400 font-normal"> owes </span>
                          <span className={isPayeeMe ? 'text-emerald-700 font-bold' : ''}>
                            {name(t.to)}
                          </span>
                        </p>
                        <p className="text-base font-extrabold text-slate-900 leading-tight">
                          {inr(t.amount)}
                        </p>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isPayerMe && payee?.upi && (
                        <a
                          href={upiLink({
                            vpa: payee.upi,
                            name: payee.name,
                            amount: t.amount,
                            note: `${trip.name || 'Yatra'} Settle-Up`,
                          })}
                          className="btn py-1 px-2.5 text-xs font-bold shadow-xs flex items-center gap-1"
                        >
                          <span>💸</span> Pay UPI
                        </a>
                      )}

                      {/* 1-Tap Record Settlement */}
                      <button
                        type="button"
                        onClick={() => setSettlingModal(t)}
                        title="Record payment as settled"
                        className="btn-ghost py-1 px-2.5 text-xs font-semibold hover:border-teal-600 hover:text-teal-800"
                      >
                        {isPayerMe ? 'Mark Paid ✓' : isPayeeMe ? 'Received ✓' : 'Settle ✓'}
                      </button>

                      {isPayeeMe && (
                        <WhatsAppButton
                          className="py-1 px-2 text-xs"
                          label="Remind"
                          text={`Hey ${payer?.name || 'friend'}! Please settle up *${inr(t.amount)}* for our trip *${trip.name}* 👉 ${tripLink(tripId)}`}
                        />
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {txns.length > 0 && (
          <WhatsAppButton
            className="w-full mt-2"
            label="Send Settle-Up Summary to Group"
            text={`💸 *${trip.name} — Settle-Up Summary*\nTotal trip spend: ${inr(tripTotal)}\n\n${txns.map((t) => `• ${byId[t.from]?.name || 'Traveler'} → ${byId[t.to]?.name || 'Traveler'}: ${inr(t.amount)}`).join('\n')}\n\nPay or settle with one tap in Yatra 👉 ${tripLink(tripId)}`}
          />
        )}
      </section>

      {/* 5. BALANCES SUMMARY ACCORDION */}
      <section className="card p-3 space-y-2">
        <h3 className="font-bold text-xs text-slate-700 uppercase tracking-wider">
          Individual Balances
        </h3>
        <ul className="space-y-1.5 divide-y divide-slate-100">
          {members.map((m) => {
            const b = bal[m.id] || 0
            const isMe = m.id === uid
            return (
              <li key={m.id} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs">
                <span className={`flex items-center gap-1.5 ${isMe ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
                  <span className="size-2 rounded-full bg-slate-300" />
                  {name(m.id)}
                </span>
                <span
                  className={`font-semibold ${
                    b > 0.5 ? 'text-emerald-700' : b < -0.5 ? 'text-rose-600' : 'text-slate-400'
                  }`}
                >
                  {b > 0.5 ? `gets ${inr(b)}` : b < -0.5 ? `owes ${inr(-b)}` : 'settled'}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      {/* 6. EXPENSE FEED & LIVE SEARCH / FILTERS */}
      <section className="card p-0 overflow-hidden shadow-sm">
        {/* Header with Search & CSV export */}
        <div className="p-3.5 bg-slate-50 border-b border-slate-100 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900">
              All Transactions ({filteredExpenses.length})
            </h3>
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

          {/* Search Bar */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 Search title, payer, or notes…"
              className="w-full bg-white rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-teal-600 pr-7"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 size-4 grid place-items-center text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filter Chips */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar text-xs">
            {[
              ['all', 'All'],
              ['you-paid', 'You Paid'],
              ['your-share', 'Your Share'],
              ['settlements', 'Settlements'],
            ].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilterType(k)}
                className={`px-2.5 py-1 rounded-full font-semibold whitespace-nowrap transition ${
                  filterType === k
                    ? 'bg-teal-700 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Expenses List */}
        {filteredExpenses.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs">
            No matching transactions found.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filteredExpenses.map((e) => {
              const isSettlement = e.type === 'settlement'
              const category = getCategory(e.category || detectCategory(e.title))
              const isExpanded = expandedId === e.id
              const hasItems = e.items && e.items.length > 0
              const isPayerMe = e.paidBy === uid
              const userShareAmt = Number(e.splits?.[uid]) || 0
              const splitCount = Object.keys(e.splits || {}).length

              if (isSettlement) {
                return (
                  <li key={e.id} className="p-3.5 bg-emerald-50/30 hover:bg-emerald-50/50 transition flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-9 rounded-2xl bg-emerald-100 text-emerald-800 grid place-items-center text-base shrink-0 shadow-xs">
                        🤝
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 uppercase">
                            Settle-Up
                          </span>
                          <span className="text-xs text-slate-400">
                            {e.date || ''}
                          </span>
                        </div>
                        <p className="font-semibold text-xs text-slate-900 truncate mt-0.5">
                          {e.title}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-bold text-sm text-emerald-700">
                        {inr(e.amount)}
                      </span>
                      <button
                        type="button"
                        aria-label="Delete settlement"
                        onClick={() => setDeletingExpense(e)}
                        className="text-slate-300 hover:text-rose-600 size-6 grid place-items-center text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                )
              }

              return (
                <li key={e.id} className="p-3.5 hover:bg-slate-50/50 transition space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0">
                      {/* Category Icon Badge */}
                      <div
                        style={{ backgroundColor: `${category.color}15`, color: category.color }}
                        className="size-9 rounded-2xl grid place-items-center text-lg shrink-0 shadow-xs mt-0.5"
                      >
                        {category.icon}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-sm text-slate-900 truncate">
                            {e.title}
                          </span>
                          {e.scanned && (
                            <span className="text-[10px] bg-teal-100 text-teal-800 rounded px-1.5 py-0.2 font-semibold">
                              AI Scanned
                            </span>
                          )}
                        </div>

                        {/* Splitwise-style contextual description */}
                        <p className="text-xs text-slate-500 mt-0.5">
                          {isPayerMe ? (
                            <span className="text-emerald-700 font-semibold">
                              You paid {inr(e.amount)}
                              {e.amount - userShareAmt > 0 && ` (lent ${inr(e.amount - userShareAmt)})`}
                            </span>
                          ) : userShareAmt > 0 ? (
                            <span className="text-rose-600 font-medium">
                              {name(e.paidBy)} paid · You owe {inr(userShareAmt)}
                            </span>
                          ) : (
                            <span className="text-slate-400">
                              {name(e.paidBy)} paid · Not involved
                            </span>
                          )}
                          <span className="text-slate-400 font-normal"> · {splitCount} ways</span>
                        </p>

                        {e.notes && (
                          <p className="text-[11px] text-slate-500 bg-slate-100/70 rounded px-1.5 py-0.5 mt-1 inline-block">
                            💡 {e.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Amount & Actions */}
                    <div className="text-right shrink-0">
                      <p className="font-extrabold text-sm text-slate-900">
                        {inr(e.amount)}
                      </p>

                      <div className="flex items-center justify-end gap-1 mt-1">
                        {hasItems && (
                          <button
                            type="button"
                            aria-label="Toggle receipt items"
                            onClick={() => setExpandedId(isExpanded ? null : e.id)}
                            className="text-xs text-teal-700 font-semibold px-1"
                          >
                            {isExpanded ? '▲' : '▼'}
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Edit expense"
                          onClick={() => { setEditingExpense(e); setOpen('manual') }}
                          className="text-slate-400 hover:text-teal-700 size-6 grid place-items-center text-xs"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          aria-label="Delete expense"
                          onClick={() => setDeletingExpense(e)}
                          className="text-slate-400 hover:text-rose-600 size-6 grid place-items-center text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Scanned Receipt Items Accordion */}
                  {isExpanded && hasItems && (
                    <div className="pt-2 border-t border-slate-100 bg-slate-50 rounded-xl p-3 text-xs space-y-1.5">
                      <p className="font-semibold text-slate-700">Receipt Breakdown:</p>
                      <div className="space-y-1 divide-y divide-slate-200/60">
                        {e.items.map((it, idx) => (
                          <div key={idx} className="flex justify-between pt-1 first:pt-0">
                            <div>
                              <span className="font-medium text-slate-800">{it.name}</span>
                              {it.who && it.who.length > 0 && (
                                <span className="text-slate-400 block text-[11px]">
                                  for {it.who.map((w) => name(w)).join(', ')}
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
        )}
      </section>

      {/* MODAL: Record Settle-Up Confirmation */}
      {settlingModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setSettlingModal(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-sm w-full p-5 space-y-3.5 shadow-2xl text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="size-16 rounded-2xl bg-emerald-100 text-emerald-800 grid place-items-center text-3xl mx-auto shadow-xs">
              🤝
            </div>
            <div className="space-y-1">
              <h3 className="font-extrabold text-base text-slate-900">
                Record Settlement
              </h3>
              <p className="text-xs text-slate-500">
                Confirm payment of <b>{inr(settlingModal.amount)}</b> from{' '}
                <b>{name(settlingModal.from)}</b> to <b>{name(settlingModal.to)}</b>?
              </p>
              <p className="text-[11px] text-slate-400 pt-1">
                This will record a settlement entry and immediately adjust everyone's balance.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                className="btn-ghost flex-1 py-2 text-xs"
                onClick={() => setSettlingModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn flex-1 py-2 text-xs font-bold bg-emerald-700 hover:bg-emerald-800"
                onClick={() => handleRecordSettlement(settlingModal)}
              >
                Confirm Paid ✓
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Set Trip Budget */}
      {budgetModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setBudgetModal(false)}
        >
          <form
            onSubmit={handleSaveBudget}
            className="bg-white rounded-3xl max-w-sm w-full p-5 space-y-3.5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-extrabold text-base text-slate-900">
              Trip Budget Target
            </h3>
            <p className="text-xs text-slate-500">
              Set a total budget for this trip to keep the group's spending on track.
            </p>
            <div className="relative">
              <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold">₹</span>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={tripBudgetInput}
                onChange={(e) => setTripBudgetInput(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="e.g. 50000"
                className="input pl-8 text-sm font-bold"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                className="btn-ghost flex-1 py-2 text-xs"
                onClick={() => setBudgetModal(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn flex-1 py-2 text-xs font-bold"
              >
                Save Budget
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: Delete Expense Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingExpense}
        title="Delete Transaction?"
        message={`Are you sure you want to delete "${deletingExpense?.title}" (${inr(deletingExpense?.amount)})? This will recalculate everyone's balance.`}
        onConfirm={async () => {
          await remove(tripId, 'expenses', deletingExpense.id)
          setDeletingExpense(null)
        }}
        onCancel={() => setDeletingExpense(null)}
      />
    </div>
  )
}

// 7. COMPREHENSIVE ADD / EDIT EXPENSE FORM (Equal, Exact, Shares, Percent)
function ExpenseModal({ uid, members, existing, onSave, onCancel }) {
  const isEditing = Boolean(existing)

  const [title, setTitle] = useState(existing?.title || '')
  const [amount, setAmount] = useState(existing?.amount ? String(existing.amount) : '')
  const [paidBy, setPaidBy] = useState(existing?.paidBy || uid)
  const [category, setCategory] = useState(existing?.category || detectCategory(existing?.title || ''))
  const [date, setDate] = useState(existing?.date || ymd(new Date()))
  const [notes, setNotes] = useState(existing?.notes || '')

  // Split Mode: 'equal' | 'exact' | 'shares' | 'percent'
  const [splitMode, setSplitMode] = useState(() => {
    if (existing?.splitMode) return existing.splitMode
    return 'equal'
  })

  // Equal split members
  const [equalMembers, setEqualMembers] = useState(() => {
    if (existing?.splits) return new Set(Object.keys(existing.splits))
    return new Set(members.map((m) => m.id))
  })

  // Exact custom amounts: { [uid]: '450' }
  const [exactMap, setExactMap] = useState(() => {
    if (existing?.splits) {
      return Object.fromEntries(Object.entries(existing.splits).map(([k, v]) => [k, String(v)]))
    }
    return {}
  })

  // Shares: { [uid]: 1 }
  const [sharesMap, setSharesMap] = useState(() => {
    if (existing?.shares) return existing.shares
    return Object.fromEntries(members.map((m) => [m.id, 1]))
  })

  // Percentages: { [uid]: 50 }
  const [percentMap, setPercentMap] = useState(() => {
    if (existing?.percentages) return existing.percentages
    const equalPct = Math.floor(100 / members.length)
    return Object.fromEntries(members.map((m) => [m.id, equalPct]))
  })

  const numAmount = Number(amount) || 0

  // Auto-detect category on title change if not explicitly chosen
  function handleTitleChange(val) {
    setTitle(val)
    if (!existing) {
      setCategory(detectCategory(val))
    }
  }

  function toggleEqualMember(id) {
    const s = new Set(equalMembers)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setEqualMembers(s)
  }

  // Calculate live validation for splits
  const splitCalculations = useMemo(() => {
    if (splitMode === 'equal') {
      const uids = [...equalMembers]
      const valid = numAmount > 0 && uids.length > 0
      const splits = valid ? equalSplit(numAmount, uids) : {}
      return { valid, splits, remaining: 0 }
    }

    if (splitMode === 'exact') {
      const totalAllocated = Object.values(exactMap).reduce((s, v) => s + (Number(v) || 0), 0)
      const diff = Math.round((numAmount - totalAllocated) * 100) / 100
      const valid = numAmount > 0 && Math.abs(diff) < 0.5
      const splits = exactSplit(exactMap)
      return { valid, splits, remaining: diff }
    }

    if (splitMode === 'shares') {
      const splits = shareSplit(numAmount, sharesMap)
      const hasShares = Object.values(sharesMap).some((s) => Number(s) > 0)
      const valid = numAmount > 0 && hasShares
      return { valid, splits, remaining: 0 }
    }

    if (splitMode === 'percent') {
      const totalPct = Object.values(percentMap).reduce((s, p) => s + (Number(p) || 0), 0)
      const diff = Math.round((100 - totalPct) * 100) / 100
      const valid = numAmount > 0 && Math.abs(diff) < 0.5
      const splits = percentSplit(numAmount, percentMap)
      return { valid, splits, remaining: diff }
    }

    return { valid: false, splits: {}, remaining: 0 }
  }, [splitMode, numAmount, equalMembers, exactMap, sharesMap, percentMap])

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim() || numAmount <= 0 || !splitCalculations.valid) return

    onSave({
      title: title.trim(),
      amount: numAmount,
      paidBy,
      category,
      date,
      notes: notes.trim(),
      splitMode,
      splits: splitCalculations.splits,
      shares: splitMode === 'shares' ? sharesMap : null,
      percentages: splitMode === 'percent' ? percentMap : null,
      by: uid,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 animate-fade-in"
      onClick={onCancel}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div>
            <h3 className="font-extrabold text-base text-slate-900">
              {isEditing ? 'Edit Expense' : 'Add Expense'}
            </h3>
            <p className="text-xs text-slate-500">Record a shared trip expenditure</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-700 size-7 grid place-items-center rounded-full hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        {/* Title & Amount */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              required
              autoFocus
              className="input flex-1 text-sm font-semibold"
              placeholder="What was this for? (Dinner, Uber, Fuel…)"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
            />
            <div className="relative w-32 shrink-0">
              <span className="absolute left-3 top-2.5 text-slate-400 font-bold">₹</span>
              <input
                required
                inputMode="decimal"
                className="input pl-7 text-sm font-bold text-right"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              />
            </div>
          </div>

          {/* Category Chips */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-600">Category:</label>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              {EXPENSE_CATEGORIES.map((c) => {
                const isSelected = category === c.id
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={`px-2.5 py-1 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-1 transition ${
                      isSelected
                        ? 'bg-slate-900 text-white shadow-xs scale-102'
                        : `${c.bg} border hover:opacity-90`
                    }`}
                  >
                    <span>{c.icon}</span>
                    <span>{c.name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Paid By & Date row */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="block font-semibold text-slate-700">
              Paid by:
              <select
                className="input mt-1 text-xs font-medium"
                value={paidBy}
                onChange={(e) => setPaidBy(e.target.value)}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === uid ? `${m.name} (You)` : m.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block font-semibold text-slate-700">
              Date:
              <input
                type="date"
                className="input mt-1 text-xs font-medium"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
        </div>

        {/* Split Methods Selector Tabs */}
        <div className="space-y-2 pt-1 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Split Options
            </label>
            {splitMode === 'exact' && (
              <span className={`text-xs font-bold ${Math.abs(splitCalculations.remaining) < 0.5 ? 'text-emerald-700' : 'text-rose-600'}`}>
                {Math.abs(splitCalculations.remaining) < 0.5
                  ? '✓ Exact match'
                  : splitCalculations.remaining > 0
                  ? `₹${splitCalculations.remaining} left to allocate`
                  : `Exceeds by ₹${-splitCalculations.remaining}`}
              </span>
            )}
            {splitMode === 'percent' && (
              <span className={`text-xs font-bold ${Math.abs(splitCalculations.remaining) < 0.5 ? 'text-emerald-700' : 'text-rose-600'}`}>
                {Math.abs(splitCalculations.remaining) < 0.5
                  ? '✓ 100% matched'
                  : `${splitCalculations.remaining}% remaining`}
              </span>
            )}
          </div>

          {/* Mode Switcher */}
          <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl text-xs font-semibold text-slate-600">
            {[
              ['equal', '= Equal'],
              ['exact', '123 Exact'],
              ['shares', '2:1 Shares'],
              ['percent', '% Percent'],
            ].map(([k, label]) => (
              <button
                type="button"
                key={k}
                onClick={() => setSplitMode(k)}
                className={`py-1 rounded-lg transition ${
                  splitMode === k
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Equal Split Mode Content */}
          {splitMode === 'equal' && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Select who was included:</span>
                {equalMembers.size > 0 && numAmount > 0 && (
                  <span className="font-semibold text-slate-700">
                    {inr(numAmount / equalMembers.size)} each
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => {
                  const isIncluded = equalMembers.has(m.id)
                  return (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => toggleEqualMember(m.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                        isIncluded
                          ? 'bg-teal-700 text-white border-teal-700 shadow-xs'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {m.name} {m.id === uid && '(You)'}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Exact Amounts Split Mode Content */}
          {splitMode === 'exact' && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto divide-y divide-slate-100 text-xs">
              {members.map((m) => (
                <div key={m.id} className="pt-1.5 first:pt-0 flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-800 truncate">
                    {m.name} {m.id === uid && '(You)'}
                  </span>
                  <div className="relative w-28 shrink-0">
                    <span className="absolute left-2.5 top-2 text-slate-400 font-bold">₹</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={exactMap[m.id] || ''}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^\d.]/g, '')
                        setExactMap({ ...exactMap, [m.id]: val })
                      }}
                      placeholder="0"
                      className="input pl-6 py-1 text-right text-xs font-semibold"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Shares / Parts Split Mode Content */}
          {splitMode === 'shares' && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto divide-y divide-slate-100 text-xs">
              {members.map((m) => {
                const s = Number(sharesMap[m.id]) || 0
                const shareAmt = splitCalculations.splits[m.id] || 0
                return (
                  <div key={m.id} className="pt-1.5 first:pt-0 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-800">
                        {m.name} {m.id === uid && '(You)'}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {inr(shareAmt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSharesMap({ ...sharesMap, [m.id]: Math.max(0, s - 1) })}
                        className="size-6 rounded-lg bg-slate-100 font-bold text-slate-700 grid place-items-center hover:bg-slate-200"
                      >
                        -
                      </button>
                      <span className="w-6 text-center font-bold text-xs">{s}</span>
                      <button
                        type="button"
                        onClick={() => setSharesMap({ ...sharesMap, [m.id]: s + 1 })}
                        className="size-6 rounded-lg bg-slate-100 font-bold text-slate-700 grid place-items-center hover:bg-slate-200"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Percentage Split Mode Content */}
          {splitMode === 'percent' && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto divide-y divide-slate-100 text-xs">
              {members.map((m) => {
                const pct = percentMap[m.id] ?? ''
                const shareAmt = splitCalculations.splits[m.id] || 0
                return (
                  <div key={m.id} className="pt-1.5 first:pt-0 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-800">
                        {m.name} {m.id === uid && '(You)'}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {inr(shareAmt)}
                      </p>
                    </div>
                    <div className="relative w-20 shrink-0">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={pct}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.]/g, '')
                          setPercentMap({ ...percentMap, [m.id]: val })
                        }}
                        placeholder="0"
                        className="input pr-6 py-1 text-right text-xs font-semibold"
                      />
                      <span className="absolute right-2 top-2 text-slate-400 font-bold">%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Optional Notes */}
        <div>
          <input
            type="text"
            className="input text-xs"
            placeholder="Add optional notes (e.g. Google Pay ref, cash)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* Submit Actions */}
        <div className="flex gap-2 pt-1 border-t border-slate-100">
          <button
            type="button"
            className="btn-ghost flex-1 py-2 text-xs font-semibold"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || numAmount <= 0 || !splitCalculations.valid}
            className="btn flex-1 py-2 text-xs font-bold shadow-sm"
          >
            {isEditing ? 'Save Changes' : `Save ${inr(numAmount)}`}
          </button>
        </div>
      </form>
    </div>
  )
}
