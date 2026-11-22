import { useMemo, useState } from 'react'
import { useCol, update, updateTrip, recordUserTrip } from '../data'
import { tripDays, ymd } from '../screens/Trip'

// Edit trip name and dates. Stops are kept sensibly when dates change:
// - "Shift" (default when the start moves): every stop keeps its day number, e.g. a postponed trip.
// - Stops that land outside a shortened trip move to its nearest remaining day.
const DAY = 864e5
const toDate = (s) => new Date(s + 'T00:00')
const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return ymd(d) }
const fmt = (s) => toDate(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

export default function TripSettings({ tripId, trip, uid, onClose, onOpenTheme }) {
  const items = useCol(tripId, 'plan')
  const ideas = useCol(tripId, 'ideas')
  const [name, setName] = useState(trip.name || '')
  const [start, setStart] = useState(trip.start)
  const [end, setEnd] = useState(trip.end)
  const [shift, setShift] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const length = start && end ? Math.round((toDate(end) - toDate(start)) / DAY) + 1 : 0
  const startMoved = start !== trip.start
  const valid = name.trim() && start && end && length >= 1 && length <= 60

  // Where each dated stop/idea goes under the new dates.
  const remap = useMemo(() => {
    if (!valid) return { moves: [], clamped: 0, titles: null }
    const offset = shift && startMoved ? Math.round((toDate(start) - toDate(trip.start)) / DAY) : 0
    const map = (date) => {
      if (!date) return date
      let d = offset ? addDays(date, offset) : date
      if (d < start) d = start
      if (d > end) d = end
      return d
    }
    let clamped = 0
    const moves = []
    for (const i of items) {
      const shifted = offset ? addDays(i.date, offset) : i.date
      const next = map(i.date)
      if (next !== shifted) clamped++
      if (next !== i.date) moves.push(['plan', i.id, { date: next }])
    }
    for (const x of ideas) if (x.plannedOn && map(x.plannedOn) !== x.plannedOn) moves.push(['ideas', x.id, { plannedOn: map(x.plannedOn) }])
    // Day titles are keyed by date, so they move with their day too (first title wins if two days merge).
    const titles = {}
    for (const [date, t] of Object.entries(trip.dayTitles || {})) {
      if (!t) continue
      const k = map(date)
      if (!titles[k]) titles[k] = t
    }
    return { moves, clamped, titles }
  }, [valid, shift, startMoved, start, end, items, ideas, trip.start, trip.dayTitles])

  async function save(e) {
    e.preventDefault()
    if (!valid) return
    setSaving(true); setErr('')
    try {
      await updateTrip(tripId, { name: name.trim(), start, end, ...(trip.dayTitles ? { dayTitles: remap.titles || {} } : {}) })
      for (const [col, id, patch] of remap.moves) await update(tripId, col, id, patch)
      recordUserTrip(uid, tripId, { name: name.trim(), start, end })
      onClose()
    } catch (e2) {
      setErr(`Couldn't save: ${e2.message}`)
      setSaving(false)
    }
  }

  const days = valid ? tripDays({ start, end }) : []
  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 pb-[max(env(safe-area-inset-bottom),20px)] space-y-4 shadow-2xl max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Trip settings</h2>
          <button type="button" aria-label="Close" className="size-8 grid place-items-center rounded-full hover:bg-slate-100 text-slate-500" onClick={onClose}>✕</button>
        </div>

        <label className="block text-sm font-medium text-slate-700">Trip name
          <input required className="input mt-1" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-700">Starts
            <input required type="date" className="input mt-1" value={start} onChange={(e) => { const v = e.target.value; setStart(v); if (shift && v && trip.end) { const len = Math.round((toDate(trip.end) - toDate(trip.start)) / DAY); setEnd(addDays(v, len)) } }} />
          </label>
          <label className="block text-sm font-medium text-slate-700">Ends
            <input required type="date" className="input mt-1" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        {valid && (
          <p className="text-xs text-slate-500 -mt-2">{length} day{length > 1 ? 's' : ''} · {fmt(start)} – {fmt(end)}</p>
        )}
        {length > 60 && <p className="text-xs text-red-600 -mt-2">Trips can be up to 60 days.</p>}
        {start && end && length < 1 && <p className="text-xs text-red-600 -mt-2">The end date must be on or after the start date.</p>}

        {items.length > 0 && valid && (startMoved || end !== trip.end) && (
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2 text-sm">
            <p className="font-semibold text-slate-800">Your {items.length} planned stop{items.length > 1 ? 's' : ''}</p>
            {startMoved && (
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <button type="button" onClick={() => setShift(true)} className={`rounded-lg px-2 py-2 border ${shift ? 'bg-teal-700 text-white border-teal-700' : 'bg-white border-slate-300'}`}>Move with the trip<span className="block opacity-80">Day 1 stays Day 1</span></button>
                <button type="button" onClick={() => setShift(false)} className={`rounded-lg px-2 py-2 border ${!shift ? 'bg-teal-700 text-white border-teal-700' : 'bg-white border-slate-300'}`}>Keep their dates<span className="block opacity-80">only the range changes</span></button>
              </div>
            )}
            <p className="text-xs text-slate-600">
              {remap.moves.filter(([c]) => c === 'plan').length === 0 ? 'No stops need to move.' : `${remap.moves.filter(([c]) => c === 'plan').length} stop${remap.moves.filter(([c]) => c === 'plan').length > 1 ? 's' : ''} will move to new dates.`}
              {remap.clamped > 0 && <b className="text-amber-700"> {remap.clamped} fall outside the new dates and will go to {days.length > 1 ? `Day 1 or Day ${days.length}` : 'Day 1'} — check them after saving.</b>}
            </p>
          </div>
        )}

        {onOpenTheme && (
          <button type="button" onClick={onOpenTheme} className="w-full flex items-center justify-between rounded-xl border border-slate-200 px-3 py-3 text-sm hover:bg-slate-50">
            <span>🎨 Theme & cover photo</span><span className="text-slate-400">›</span>
          </button>
        )}

        {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
          <button disabled={!valid || saving} className="btn flex-1">{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  )
}
