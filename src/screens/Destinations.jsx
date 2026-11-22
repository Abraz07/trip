import { useState } from 'react'
import { useCol, add, update, remove, updateTrip } from '../data'
import { askJSON, aiAvailable } from '../ai'
import { inr } from '../settle'

// Trip destinations (e.g. Dandeli → Gokarna → Murudeshwar) with a shared wishlist of things to do in each.
// Ideas live in trips/{id}/ideas until someone schedules one onto a day ("+ Day"), which creates a plan stop.
const KIND_ICON = { place: '📍', activity: '🎯', food: '🍽️', stay: '🏨', travel: '🚗' }
const dayShort = (d) => `Day ${d.n} · ${new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}`

export default function Destinations({ tripId, trip, uid, days, onSchedule, planIds }) {
  const dests = trip.destinations || []
  const ideas = useCol(tripId, 'ideas')
  const [name, setName] = useState('')
  const [open, setOpen] = useState(null)

  function addDest(e) {
    e.preventDefault()
    const n = name.trim().replace(/\s+/g, ' ')
    if (!n || dests.some((d) => d.toLowerCase() === n.toLowerCase())) return setName('')
    updateTrip(tripId, { destinations: [...dests, n] })
    setName('')
    setOpen(n)
  }
  const removeDest = (d) => updateTrip(tripId, { destinations: dests.filter((x) => x !== d) })
  const move = (i, dir) => {
    const next = [...dests]; const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    updateTrip(tripId, { destinations: next })
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-600">📍 Destinations {dests.length > 1 && <span className="font-normal text-slate-400">· in travel order</span>}</p>
      {dests.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {dests.map((d, i) => {
            const n = ideas.filter((x) => x.dest === d).length
            return (
              <span key={d} className={`inline-flex items-center gap-1 rounded-full border text-xs ${open === d ? 'bg-teal-700 text-white border-teal-700' : 'bg-white border-slate-300'}`}>
                {i > 0 && <button type="button" aria-label={`Move ${d} earlier`} className="pl-2 opacity-60" onClick={() => move(i, -1)}>‹</button>}
                <button type="button" className={`py-1.5 ${i > 0 ? 'pl-1' : 'pl-3'} pr-1 font-medium`} onClick={() => setOpen(open === d ? null : d)}>{i + 1}. {d}{n ? ` (${n})` : ''}</button>
                {i < dests.length - 1 && <button type="button" aria-label={`Move ${d} later`} className="opacity-60" onClick={() => move(i, 1)}>›</button>}
                <button type="button" aria-label={`Remove ${d}`} className="pr-2.5 pl-1 opacity-60" onClick={() => { removeDest(d); if (open === d) setOpen(null) }}>✕</button>
              </span>
            )
          })}
        </div>
      )}
      <form onSubmit={addDest} className="flex gap-2">
        <input className="input text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder={dests.length ? 'Add another place' : 'Where are you going? e.g. Dandeli'} />
        <button disabled={!name.trim()} className="btn-ghost shrink-0 text-sm">Add</button>
      </form>
      {open && dests.includes(open) && (
        <DestinationIdeas key={open} dest={open} tripId={tripId} trip={trip} uid={uid} days={days}
          ideas={ideas.filter((x) => x.dest === open).map((x) => (x.planId && !planIds.has(x.planId) ? { ...x, plannedOn: null } : x))} onSchedule={onSchedule} />
      )}
    </div>
  )
}

function DestinationIdeas({ dest, tripId, trip, uid, days, ideas, onSchedule }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [own, setOwn] = useState('')
  const sorted = [...ideas].sort((a, b) => (b.mustSee ? 1 : 0) - (a.mustSee ? 1 : 0) || (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))

  async function suggest() {
    setBusy(true); setErr('')
    try {
      const have = ideas.map((i) => i.title).join('; ') || 'none'
      const out = await askJSON({
        system: 'You are a local Indian travel expert. Only suggest real, well-known places and experiences that exist. Never invent places.',
        parts: [`A group of friends from India is visiting ${dest} (part of a trip called "${trip.name}", ${trip.start} to ${trip.end}).
List the best things to see and do in and right around ${dest}: sights, activities, food spots and a good area to stay. Mark the true must-visits.
Already on their list (don't repeat): ${have}.
Give 8 to 10 ideas.`],
        schema: {
          type: 'OBJECT',
          properties: {
            ideas: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  title: { type: 'STRING' },
                  place: { type: 'STRING', description: 'place name plus town, findable on a map' },
                  kind: { type: 'STRING', enum: Object.keys(KIND_ICON) },
                  why: { type: 'STRING', description: 'one line on why it is worth it' },
                  bestTime: { type: 'STRING', description: 'e.g. Early morning, Sunset, Oct–Feb' },
                  duration: { type: 'STRING', description: 'e.g. 2h' },
                  cost: { type: 'NUMBER', description: 'rough INR per person, 0 if free' },
                  needsBooking: { type: 'BOOLEAN' },
                  mustSee: { type: 'BOOLEAN' },
                },
                required: ['title', 'place', 'kind', 'why', 'mustSee'],
              },
            },
          },
          required: ['ideas'],
        },
        temperature: 0.4,
        thinking: 'minimal',
      })
      const taken = ideas.map((i) => i.title.toLowerCase())
      const fresh = (out.ideas || []).filter((x) => x.title && !taken.some((t) => t.includes(x.title.toLowerCase()) || x.title.toLowerCase().includes(t)))
      for (const x of fresh) {
        await add(tripId, 'ideas', {
          dest, title: x.title, place: x.place || `${x.title}, ${dest}`, kind: KIND_ICON[x.kind] ? x.kind : 'place',
          why: x.why || '', bestTime: x.bestTime || '', duration: x.duration || '', cost: Number(x.cost) || 0,
          needsBooking: !!x.needsBooking, mustSee: !!x.mustSee, source: 'ai', by: uid,
        })
      }
      if (!fresh.length) setErr('No new ideas this time — you already have the highlights.')
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  function addOwn(e) {
    e.preventDefault()
    const t = own.trim()
    if (!t) return
    add(tripId, 'ideas', { dest, title: t, place: `${t}, ${dest}`, kind: 'place', why: '', source: 'manual', mustSee: false, by: uid })
    setOwn('')
  }

  async function schedule(idea, date) {
    if (!date) return
    const id = await onSchedule({ title: idea.title, place: idea.place, kind: idea.kind, duration: idea.duration, cost: idea.cost, why: idea.why, needsBooking: idea.needsBooking }, date)
    update(tripId, 'ideas', idea.id, { plannedOn: date, planId: id?.id || null })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Things to do in {dest}</p>
        {aiAvailable() && <button disabled={busy} onClick={suggest} className="text-xs font-semibold rounded-full border border-violet-200 bg-violet-50 text-violet-800 px-3 py-1.5 shrink-0">{busy ? 'Finding…' : ideas.some((i) => i.source === 'ai') ? '✨ More ideas' : '✨ Must-sees'}</button>}
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {ideas.length === 0 && !busy && <p className="text-xs text-slate-500">Tap ✨ Must-sees for the highlights, or add your own below.</p>}
      <ul className="space-y-2">
        {sorted.map((x) => (
          <li key={x.id} className="bg-white rounded-xl border border-slate-200 p-2.5 flex gap-2 items-start">
            <span className="text-lg leading-none pt-0.5">{KIND_ICON[x.kind] || '📍'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{x.mustSee && <span className="text-amber-600" title="Must-see">⭐ </span>}{x.title}</p>
              {x.why && <p className="text-xs text-slate-500">{x.why}</p>}
              <p className="text-[11px] text-slate-400">
                {[x.bestTime, x.duration, x.cost ? `≈ ${inr(x.cost)}` : '', x.needsBooking ? '🎟️ book ahead' : ''].filter(Boolean).join(' · ')}
              </p>
              {x.plannedOn
                ? <p className="text-[11px] font-semibold text-teal-700 mt-1">✓ In plan · {dayShort(days.find((d) => d.date === x.plannedOn) || { n: '?', date: x.plannedOn })}</p>
                : (
                  <select aria-label={`Schedule ${x.title}`} className="mt-1.5 text-xs border border-teal-700 text-teal-700 rounded-full px-2 py-1 bg-white" value="" onChange={(e) => schedule(x, e.target.value)}>
                    <option value="">+ Add to a day…</option>
                    {days.map((d) => <option key={d.date} value={d.date}>{dayShort(d)}</option>)}
                  </select>
                )}
            </div>
            <button aria-label={`Remove ${x.title}`} className="text-slate-300 hover:text-red-500 text-sm px-1" onClick={() => remove(tripId, 'ideas', x.id)}>✕</button>
          </li>
        ))}
      </ul>
      <form onSubmit={addOwn} className="flex gap-2">
        <input className="input text-sm" value={own} onChange={(e) => setOwn(e.target.value)} placeholder={`Add your own place in ${dest}`} />
        <button disabled={!own.trim()} className="btn-ghost shrink-0 text-sm">Add</button>
      </form>
      <p className="text-[10px] text-slate-400">AI ideas — check opening hours and seasons before you go.</p>
    </div>
  )
}
