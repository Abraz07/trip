import { useState } from 'react'
import { parseDuration } from '../routing'

// Pick day + time (+ duration) before a place goes into the plan.
// Used by Destinations ideas and AI suggestions so nothing lands at a time you didn't choose.
const HHMM = /^\d{2}:\d{2}$/
const dayChip = (d) => new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })

// First free slot on a day: after the last timed stop (+ its duration, + 30 min travel buffer),
// rounded up to the next half hour. Empty day → 09:00.
export function nextFreeTime(items, date) {
  const timed = items.filter((i) => i.date === date && HHMM.test(i.time || ''))
  if (!timed.length) return '09:00'
  const ends = timed.map((i) => +i.time.slice(0, 2) * 60 + +i.time.slice(3) + (parseDuration(i.duration) || 60))
  let m = Math.max(...ends) + 30
  m = Math.ceil(m / 30) * 30
  if (m >= 23 * 60) return ''
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export default function AddToPlan({ title, days, initialDate, initialTime, initialDuration, suggestTime, onConfirm, onCancel }) {
  const [date, setDate] = useState(initialDate || days[0]?.date)
  const [time, setTime] = useState(HHMM.test(initialTime || '') ? initialTime : (suggestTime?.(initialDate || days[0]?.date) || ''))
  const [timeTouched, setTimeTouched] = useState(HHMM.test(initialTime || ''))
  const [duration, setDuration] = useState(initialDuration || '')
  const [saving, setSaving] = useState(false)

  function pickDay(d) {
    setDate(d)
    if (!timeTouched && suggestTime) setTime(suggestTime(d) || '')
  }

  return (
    <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50/50 p-3 space-y-2.5 text-left" role="group" aria-label={`Add ${title} to the plan`}>
      <p className="text-xs font-semibold text-slate-700">When? <span className="font-normal text-slate-500">— {title}</span></p>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5" role="radiogroup" aria-label="Day">
        {days.map((d) => (
          <button key={d.date} type="button" role="radio" aria-checked={date === d.date} onClick={() => pickDay(d.date)}
            className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-center leading-tight ${date === d.date ? 'bg-teal-700 text-white border-teal-700' : 'bg-white border-slate-300'}`}>
            <span className="block text-[11px] font-bold">Day {d.n}</span>
            <span className="block text-[10px] opacity-80">{dayChip(d)}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-medium text-slate-600">Time
          <input type="time" className="input mt-0.5 py-1.5 text-sm" value={time} onChange={(e) => { setTime(e.target.value); setTimeTouched(true) }} />
        </label>
        <label className="text-[11px] font-medium text-slate-600">Duration
          <input className="input mt-0.5 py-1.5 text-sm" placeholder="e.g. 2h" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </label>
      </div>
      {!timeTouched && time && <p className="text-[10px] text-slate-500">Suggested: the first free slot that day. Change it if you like.</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1 text-xs py-2" onClick={onCancel}>Cancel</button>
        <button type="button" disabled={!date || saving} className="btn flex-1 text-xs py-2"
          onClick={async () => { setSaving(true); await onConfirm({ date, time, duration }); setSaving(false) }}>
          {saving ? 'Adding…' : `Add to Day ${days.find((d) => d.date === date)?.n ?? ''}`}
        </button>
      </div>
    </div>
  )
}
