import { useEffect, useState } from 'react'
import { useCol, add, update, remove } from '../data'
import { tripDays, ymd } from './Trip'
import { MapLink } from './Today'
import ConfirmDialog from '../components/ConfirmDialog'
import { geocodePlace } from '../geocode'
import { askJSON, aiAvailable } from '../ai'
import { inr } from '../settle'
import { driveTime, parseDuration, toMin, fmtMin } from '../routing'

export const KINDS = [
  ['place', '📍', 'Sightseeing'],
  ['activity', '🎯', 'Activity'],
  ['food', '🍽️', 'Food'],
  ['stay', '🏨', 'Stay'],
  ['travel', '🚗', 'Travel'],
]
const kindOf = (k) => KINDS.find(([v]) => v === k) || KINDS[0]
const PACK_CATS = ['clothes', 'electronics', 'toiletries', 'medical', 'docs', 'gear']
const hasCoords = (i) => typeof i?.lat === 'number' && typeof i?.lng === 'number'
const dayLabel = (d) => `Day ${d.n} · ${new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`
const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99')

export default function Plan({ tripId, trip, uid, setTab }) {
  const items = useCol(tripId, 'plan', 'time')
  const places = useCol(tripId, 'places')
  const packing = useCol(tripId, 'packing')
  const days = tripDays(trip)
  const [editing, setEditing] = useState(null) // { date } for new, or an item
  const [deletingItem, setDeletingItem] = useState(null)
  const [marking, setMarking] = useState({})
  const [ai, setAi] = useState({}) // date -> { mode, busy, err, data }
  const [planner, setPlanner] = useState(false)
  const [showToBook, setShowToBook] = useState(false)

  const visited = Object.fromEntries(places.filter((p) => p.planId).map((p) => [p.planId, p]))
  const packed = new Set(packing.map((p) => (p.text || '').toLowerCase()))
  const totalCost = items.reduce((s, i) => s + (Number(i.cost) || 0), 0)
  const toBook = items.filter((i) => i.booking === 'todo').sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))

  // Look up coordinates for stops with a place but no lat/lng yet (needed for travel times and the map).
  useEffect(() => {
    for (const i of items) {
      if (i.place && !hasCoords(i) && i.lat !== false) {
        geocodePlace(i.place).then((g) => {
          if (g?.lat) update(tripId, 'plan', i.id, { lat: g.lat, lng: g.lng }).catch(() => {})
        })
      }
    }
  }, [items, tripId])

  async function markVisited(i) {
    setMarking((m) => ({ ...m, [i.id]: 'busy' }))
    let lat = i.lat, lng = i.lng
    if (!hasCoords(i)) {
      const g = await geocodePlace(i.place || i.title)
      lat = g?.lat; lng = g?.lng
    }
    if (typeof lat !== 'number') {
      setMarking((m) => ({ ...m, [i.id]: "Couldn't find it on the map — mark it from More → Places instead." }))
      return
    }
    await add(tripId, 'places', { name: i.title, lat, lng, category: i.kind === 'food' ? 'food' : i.kind === 'stay' ? 'stay' : 'other', rating: 0, note: '', planId: i.id, by: uid, date: ymd(new Date()) })
    setMarking((m) => ({ ...m, [i.id]: null }))
  }

  async function runAI(day, list, mode) {
    setAi((a) => ({ ...a, [day.date]: { mode, busy: true } }))
    try {
      const stops = list.map((i) => `- ${i.time || 'anytime'} [${kindOf(i.kind)[2]}] ${i.title}${i.place ? ` @ ${i.place}` : ''}${i.notes ? ` (${i.notes})` : ''}`).join('\n') || '(nothing planned yet)'
      const ctx = `Trip: "${trip.name}", ${trip.start} to ${trip.end}. Day ${day.n} (${day.date}). Group trip of friends from India.\nPlanned stops:\n${stops}`
      const data = mode === 'needs'
        ? await askJSON({
            system: 'You are a practical Indian travel planner. Be specific to the planned stops, concise, no generic filler.',
            parts: [`${ctx}\n\nWhat should the group carry, prepare or book for this day? Give up to 6 packing essentials tied to specific stops, things to book or check in advance (permits, tickets, tide/opening times, cash-only places), and short practical tips.`],
            schema: {
              type: 'OBJECT',
              properties: {
                essentials: { type: 'ARRAY', items: { type: 'OBJECT', properties: { item: { type: 'STRING' }, why: { type: 'STRING' }, category: { type: 'STRING', enum: PACK_CATS } }, required: ['item', 'why', 'category'] } },
                prepare: { type: 'ARRAY', items: { type: 'STRING' } },
                tips: { type: 'ARRAY', items: { type: 'STRING' } },
              },
              required: ['essentials', 'prepare', 'tips'],
            },
            thinking: 'minimal',
          })
        : await askJSON({
            system: 'You are a local Indian travel expert. Suggest real, specific, well-known places only. Never invent places.',
            parts: [`${ctx}\n\nSuggest up to 5 stops that fit around the existing plan (good timing, nearby, mix of food and sights). Use real place names with the town so they can be found on a map.`],
            schema: { type: 'OBJECT', properties: { stops: { type: 'ARRAY', items: STOP_SCHEMA } }, required: ['stops'] },
            temperature: 0.6,
            thinking: 'minimal',
          })
      setAi((a) => ({ ...a, [day.date]: { mode, data } }))
    } catch (e) {
      setAi((a) => ({ ...a, [day.date]: { mode, err: e.message } }))
    }
  }

  const addToPacking = (e) => add(tripId, 'packing', { text: e.item, category: e.category, owner: null, bringer: null, done: false })
  const addStop = (s, date) => add(tripId, 'plan', {
    title: s.title, place: s.place || '', kind: KINDS.some(([k]) => k === s.kind) ? s.kind : 'place',
    time: /^\d{2}:\d{2}$/.test(s.time || '') ? s.time : '', duration: s.duration || '', notes: s.why || s.notes || '',
    cost: Number(s.cost) || 0, booking: s.needsBooking ? 'todo' : 'none', date,
  })

  return (
    <>
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold">{items.length} stops over {days.length} days</p>
            <p className="text-xs text-slate-500">{totalCost ? `≈ ${inr(totalCost)} per person in planned costs` : 'Add stops, activities, food and stays to each day'}</p>
          </div>
          {setTab && items.length > 0 && <button className="btn-ghost text-xs py-1.5" onClick={() => setTab('map')}>🗺️ Map</button>}
        </div>
        <div className="flex gap-2">
          {aiAvailable() && <button onClick={() => setPlanner(!planner)} className="flex-1 text-xs font-semibold rounded-xl border border-violet-200 bg-violet-50 text-violet-800 py-2">{planner ? 'Close planner' : '✨ Plan the whole trip'}</button>}
          {toBook.length > 0 && <button onClick={() => setShowToBook(!showToBook)} className="flex-1 text-xs font-semibold rounded-xl border border-amber-300 bg-amber-50 text-amber-800 py-2">🎟️ {toBook.length} still to book</button>}
        </div>
        {showToBook && toBook.length > 0 && (
          <ul className="text-sm divide-y divide-slate-100 border border-amber-200 rounded-xl px-3">
            {toBook.map((i) => {
              const d = days.find((x) => x.date === i.date)
              return (
                <li key={i.id} className="py-2 flex items-center gap-2">
                  <span className="flex-1 min-w-0"><span className="font-medium">{i.title}</span><span className="block text-xs text-slate-500">{d ? dayLabel(d) : i.date}{i.time ? ` · ${i.time}` : ''}</span></span>
                  <button className="text-xs rounded-full border border-teal-700 text-teal-700 px-2 py-0.5 shrink-0" onClick={() => setEditing(i)}>Mark booked</button>
                </li>
              )
            })}
          </ul>
        )}
        {planner && <TripPlanner trip={trip} days={days} items={items} onAdd={addStop} onDone={() => setPlanner(false)} />}
      </section>

      {days.map((d) => {
        const list = items.filter((i) => i.date === d.date).sort(byTime)
        const dayCost = list.reduce((s, i) => s + (Number(i.cost) || 0), 0)
        const a = ai[d.date]
        return (
          <section key={d.date} className="card">
            <div className="flex justify-between items-start gap-2">
              <div>
                <h2 className="font-semibold">Day {d.n} <span className="text-slate-500 font-normal text-sm">· {new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span></h2>
                {list.length > 0 && <p className="text-xs text-slate-500">{list.length} stop{list.length > 1 ? 's' : ''}{dayCost ? ` · ≈ ${inr(dayCost)}/person` : ''}</p>}
              </div>
              <button className="text-teal-700 text-sm font-semibold shrink-0" onClick={() => setEditing({ date: d.date })}>+ Add stop</button>
            </div>

            {list.length === 0 && editing?.date !== d.date && <p className="text-sm text-slate-400 mt-2">Free day 🌴</p>}

            <ol className="mt-3">
              {list.map((i, idx) => {
                const [, icon, label] = kindOf(i.kind)
                const next = list[idx + 1]
                if (editing?.id === i.id) {
                  return <li key={i.id}><StopForm initial={i} days={days} onCancel={() => setEditing(null)} onSave={(v) => { update(tripId, 'plan', i.id, v); setEditing(null) }} /></li>
                }
                return (
                  <li key={i.id}>
                    <div className="flex gap-3">
                      <span className="size-10 shrink-0 rounded-full bg-teal-50 border border-teal-200 grid place-items-center text-lg" title={label}>{icon}</span>
                      <div className="flex-1 min-w-0 pb-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-mono text-teal-700">{i.time || 'Anytime'}{i.duration ? ` · ${i.duration}` : ''}</p>
                            <p className="font-medium text-slate-900">{i.title}</p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button aria-label={`Edit or move ${i.title}`} className="text-slate-400 px-1 hover:text-teal-700" onClick={() => setEditing(i)}>✎</button>
                            <button aria-label={`Delete ${i.title}`} className="text-slate-400 px-1 hover:text-red-500" onClick={() => setDeletingItem(i)}>✕</button>
                          </div>
                        </div>
                        {i.place && <MapLink place={i.place} />}
                        {i.notes && <p className="text-xs text-slate-500 whitespace-pre-wrap mt-0.5">{i.notes}</p>}
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          {i.booking === 'todo' && <span className="text-[11px] font-semibold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">🎟️ To book</span>}
                          {i.booking === 'booked' && <span className="text-[11px] font-semibold bg-teal-100 text-teal-800 rounded-full px-2 py-0.5">✅ Booked{i.bookingRef ? ` · ${i.bookingRef}` : ''}</span>}
                          {Number(i.cost) > 0 && <span className="text-[11px] bg-slate-100 rounded-full px-2 py-0.5">≈ {inr(i.cost)}/person</span>}
                          {visited[i.id]
                            ? <span className="text-[11px] font-semibold text-teal-700">✓ Visited{visited[i.id].rating ? ` · ${'★'.repeat(visited[i.id].rating)}` : ''}</span>
                            : <button type="button" disabled={marking[i.id] === 'busy'} onClick={() => markVisited(i)} className="text-[11px] border border-slate-300 rounded-full px-2 py-0.5 font-medium text-slate-600 hover:border-teal-600 hover:text-teal-700">{marking[i.id] === 'busy' ? 'Saving…' : '✓ Mark visited'}</button>}
                          {setTab && i.place && <button type="button" onClick={() => { sessionStorage.setItem('yatra:map_focus', i.id); setTab('map') }} className="text-[11px] text-teal-700 underline">Show on map</button>}
                        </div>
                        {marking[i.id] && marking[i.id] !== 'busy' && <p className="text-[11px] text-red-600 mt-0.5">{marking[i.id]}</p>}
                      </div>
                    </div>
                    {next ? <Leg from={i} to={next} /> : null}
                  </li>
                )
              })}
            </ol>

            {editing?.date === d.date && !editing.id && <StopForm initial={{ date: d.date }} days={days} onCancel={() => setEditing(null)} onSave={(v) => { add(tripId, 'plan', v); setEditing(null) }} />}

            {aiAvailable() && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="flex gap-2">
                  <button disabled={a?.busy} onClick={() => runAI(d, list, 'needs')} className="flex-1 text-xs font-semibold rounded-xl border border-violet-200 bg-violet-50 text-violet-800 py-2">{a?.busy && a.mode === 'needs' ? 'Thinking…' : '✨ What do we need?'}</button>
                  <button disabled={a?.busy} onClick={() => runAI(d, list, 'stops')} className="flex-1 text-xs font-semibold rounded-xl border border-violet-200 bg-violet-50 text-violet-800 py-2">{a?.busy && a.mode === 'stops' ? 'Thinking…' : '✨ Suggest stops'}</button>
                </div>
                {a?.err && <p className="text-xs text-red-600 mt-2">{a.err}</p>}
                {a?.data && a.mode === 'needs' && <Needs data={a.data} packed={packed} onAdd={addToPacking} onClose={() => setAi((x) => ({ ...x, [d.date]: null }))} />}
                {a?.data && a.mode === 'stops' && (
                  <Suggestions stops={a.data.stops || []} existing={new Set(list.map((i) => i.title.toLowerCase()))}
                    onAdd={(s) => addStop(s, d.date)}
                    onClose={() => setAi((x) => ({ ...x, [d.date]: null }))} />
                )}
              </div>
            )}
          </section>
        )
      })}

      <ConfirmDialog
        isOpen={!!deletingItem}
        title="Delete stop?"
        message={`Delete "${deletingItem?.title}" from the plan?`}
        onConfirm={() => { remove(tripId, 'plan', deletingItem.id); setDeletingItem(null) }}
        onCancel={() => setDeletingItem(null)}
      />
    </>
  )
}

const STOP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    place: { type: 'STRING', description: 'real place name with town, findable on a map' },
    kind: { type: 'STRING', enum: KINDS.map(([k]) => k) },
    time: { type: 'STRING', description: 'HH:MM 24h' },
    duration: { type: 'STRING', description: 'e.g. 2h or 45m' },
    why: { type: 'STRING' },
    cost: { type: 'NUMBER', description: 'rough cost per person in INR, 0 if free' },
    needsBooking: { type: 'BOOLEAN', description: 'true if tickets, a table, a room or a permit should be booked ahead' },
  },
  required: ['title', 'place', 'kind', 'time', 'why'],
}

// Drive time between two consecutive stops, with a warning when the gap is shorter than the drive.
function Leg({ from, to }) {
  const [r, setR] = useState(undefined)
  const ready = hasCoords(from) && hasCoords(to)
  useEffect(() => {
    let live = true
    if (ready) driveTime(from, to).then((v) => live && setR(v))
    return () => { live = false }
  }, [ready, from.lat, from.lng, to.lat, to.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <div className="ml-5 border-l border-dashed border-slate-200 h-4" aria-hidden />
  const start = toMin(from.time), end = toMin(to.time)
  const free = start != null && end != null ? end - (start + parseDuration(from.duration)) : null
  const tight = r && free != null && free < r.min
  return (
    <div className="ml-5 border-l border-dashed border-slate-300 pl-6 py-1.5 text-[11px]">
      {r === undefined && <span className="text-slate-400">Checking drive time…</span>}
      {r === null && <span className="text-slate-400">No driving route found</span>}
      {r && (
        <span className={tight ? 'text-amber-700 font-semibold' : 'text-slate-500'}>
          🚗 {r.km < 1 ? `${Math.round(r.km * 1000)} m` : `${r.km} km`} · {fmtMin(r.min)}
          {tight && ` — ⚠️ only ${free <= 0 ? 'no time' : fmtMin(free)} to get there`}
        </span>
      )}
    </div>
  )
}

function StopForm({ initial, days, onSave, onCancel }) {
  const [v, setV] = useState({ kind: 'place', time: '', duration: '', title: '', place: '', notes: '', cost: '', booking: 'none', bookingRef: '', ...initial })
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  function submit(e) {
    e.preventDefault()
    const { id, createdAt, lat, lng, ...rest } = v
    const out = { ...rest, title: rest.title.trim(), cost: Number(rest.cost) || 0, bookingRef: rest.booking === 'booked' ? (rest.bookingRef || '').trim() : '' }
    // Place changed → drop old coordinates so they're looked up again.
    if (initial.place && initial.place !== rest.place) { out.lat = null; out.lng = null }
    onSave(out)
  }
  return (
    <form className="mt-2 mb-3 space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-200" onSubmit={submit}>
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map(([k, icon, label]) => (
          <button type="button" key={k} onClick={() => setV({ ...v, kind: k })} className={`rounded-full px-2.5 py-1 text-xs border ${v.kind === k ? 'bg-teal-700 text-white border-teal-700' : 'bg-white border-slate-300'}`}>{icon} {label}</button>
        ))}
      </div>
      <input required autoFocus className="input" placeholder="What? (Om Beach, Scuba diving, Dinner at Namaste…)" value={v.title} onChange={set('title')} />
      <div className="grid grid-cols-3 gap-2">
        <input type="time" aria-label="Time" className="input" value={v.time} onChange={set('time')} />
        <input className="input" aria-label="Duration" placeholder="2h" value={v.duration} onChange={set('duration')} />
        <input className="input" aria-label="Cost per person" inputMode="numeric" placeholder="₹/person" value={v.cost || ''} onChange={(e) => setV({ ...v, cost: e.target.value.replace(/[^\d]/g, '') })} />
      </div>
      <input className="input" placeholder="Place or Google Maps link" value={v.place} onChange={set('place')} />
      {initial.id && (
        <label className="block text-xs font-medium text-slate-600">Day
          <select className="input mt-1" value={v.date} onChange={set('date')}>
            {days.map((d) => <option key={d.date} value={d.date}>{dayLabel(d)}</option>)}
          </select>
        </label>
      )}
      <div>
        <p className="text-xs font-medium text-slate-600 mb-1">Booking</p>
        <div className="grid grid-cols-3 bg-slate-200 rounded-xl p-1 text-xs font-medium">
          {[['none', 'Not needed'], ['todo', '🎟️ To book'], ['booked', '✅ Booked']].map(([k, l]) => (
            <button type="button" key={k} onClick={() => setV({ ...v, booking: k })} className={`py-1.5 rounded-lg ${v.booking === k ? 'bg-white shadow-sm' : 'text-slate-600'}`}>{l}</button>
          ))}
        </div>
        {v.booking === 'booked' && <input className="input mt-2" placeholder="Booking ID / PNR (optional)" value={v.bookingRef || ''} onChange={set('bookingRef')} />}
      </div>
      <textarea className="input" rows="2" placeholder="Notes — contact, what to order…" value={v.notes} onChange={set('notes')} />
      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={onCancel}>Cancel</button>
        <button className="btn flex-1">{initial.id ? 'Save' : 'Add stop'}</button>
      </div>
    </form>
  )
}

const PACES = [['relaxed', '🌿 Relaxed', '2–3 stops a day, late starts'], ['balanced', '⚖️ Balanced', '3–4 stops a day'], ['packed', '⚡ Packed', '5+ stops, early starts']]
const INTERESTS = ['Beaches', 'Food', 'Heritage', 'Nature', 'Adventure', 'Nightlife', 'Shopping', 'Temples', 'Photography']

// AI drafts every day; nothing is saved until the group taps "Add".
function TripPlanner({ trip, days, items, onAdd, onDone }) {
  const [f, setF] = useState({ where: trip.name || '', from: '', pace: 'balanced', interests: ['Food', 'Beaches'], notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState(null) // [{ date, n, stops: [{...s, keep}] }]
  const [saving, setSaving] = useState(false)
  const toggleInterest = (x) => setF({ ...f, interests: f.interests.includes(x) ? f.interests.filter((i) => i !== x) : [...f.interests, x] })

  async function generate(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const existing = days.map((d) => {
      const l = items.filter((i) => i.date === d.date).sort(byTime)
      return `Day ${d.n} (${d.date}): ${l.length ? l.map((i) => `${i.time || 'anytime'} ${i.title}`).join('; ') : 'nothing yet'}`
    }).join('\n')
    try {
      const out = await askJSON({
        system: 'You are an expert Indian travel planner. Build realistic day-by-day itineraries with real, well-known places only (never invent places), sensible travel times between stops, meal stops, and an overnight stay each night. Keep existing stops and plan around them; do not repeat them.',
        parts: [`Destination / region: ${f.where}
Dates: ${trip.start} to ${trip.end} (${days.length} days)${f.from ? `\nStarting from: ${f.from}` : ''}
Pace: ${f.pace} (${PACES.find(([k]) => k === f.pace)[2]})
Interests: ${f.interests.join(', ') || 'a good mix'}${f.notes ? `\nNotes from the group: ${f.notes}` : ''}
Already planned (keep these, add around them):
${existing}

Return new stops for each day number 1..${days.length}. Include where to stay each night unless already planned. Group of friends from India; costs in INR per person.`],
        schema: {
          type: 'OBJECT',
          properties: { days: { type: 'ARRAY', items: { type: 'OBJECT', properties: { day: { type: 'INTEGER' }, theme: { type: 'STRING' }, stops: { type: 'ARRAY', items: STOP_SCHEMA } }, required: ['day', 'stops'] } } },
          required: ['days'],
        },
        temperature: 0.5,
        thinking: 'low',
      })
      // Drop AI stops that repeat something already planned ("Om Beach Visit & Relax" vs "Om Beach").
      const taken = items.map((i) => i.title.toLowerCase().trim()).filter((t) => t.length >= 4)
      const isDup = (title) => { const t = title.toLowerCase(); return taken.some((x) => t.includes(x) || x.includes(t)) }
      setDraft(days.map((d) => {
        const got = (out.days || []).find((x) => x.day === d.n)
        return { ...d, theme: got?.theme || '', stops: (got?.stops || []).filter((s) => s.title && !isDup(s.title)).sort(byTime).map((s) => ({ ...s, keep: true })) }
      }))
    } catch (e2) { setErr(e2.message) }
    setBusy(false)
  }

  const count = draft ? draft.reduce((n, d) => n + d.stops.filter((s) => s.keep).length, 0) : 0
  const toggle = (di, si) => setDraft(draft.map((d, i) => (i !== di ? d : { ...d, stops: d.stops.map((s, j) => (j !== si ? s : { ...s, keep: !s.keep })) })))

  async function addAll() {
    setSaving(true)
    for (const d of draft) for (const s of d.stops) if (s.keep) await onAdd(s, d.date)
    setSaving(false); onDone()
  }

  if (draft) {
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-3 text-sm">
        <div className="flex justify-between items-center"><p className="font-semibold text-violet-900">✨ Draft itinerary</p><button className="text-xs text-violet-800 underline" onClick={() => setDraft(null)}>Change preferences</button></div>
        <p className="text-xs text-slate-500">Untick anything you don't want, then add the rest to the plan.</p>
        {draft.map((d, di) => (
          <div key={d.date}>
            <p className="text-xs font-semibold text-slate-700">{dayLabel(d)}{d.theme ? ` — ${d.theme}` : ''}</p>
            {d.stops.length === 0 && <p className="text-xs text-slate-400">No new stops.</p>}
            <ul className="mt-1 space-y-1.5">
              {d.stops.map((s, si) => (
                <li key={si}>
                  <label className="flex gap-2 items-start cursor-pointer">
                    <input type="checkbox" className="mt-1 size-4 accent-teal-700" checked={s.keep} onChange={() => toggle(di, si)} />
                    <span className="text-lg leading-none">{kindOf(s.kind)[1]}</span>
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{s.title}</span> <span className="text-xs font-mono text-slate-500">{s.time}{s.duration ? ` · ${s.duration}` : ''}</span>
                      <span className="block text-xs text-slate-500">{s.why}{s.cost ? ` · ≈ ${inr(s.cost)}` : ''}{s.needsBooking ? ' · 🎟️ book ahead' : ''}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <button disabled={!count || saving} onClick={addAll} className="btn w-full">{saving ? 'Adding…' : `Add ${count} stop${count === 1 ? '' : 's'} to the plan`}</button>
        <p className="text-[10px] text-slate-400">AI draft — check timings, opening hours and distances before you go.</p>
      </div>
    )
  }

  return (
    <form onSubmit={generate} className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-3 text-sm">
      <p className="font-semibold text-violet-900">✨ Plan the whole trip</p>
      <label className="block text-xs font-medium text-slate-600">Where are you going?
        <input required className="input mt-1" value={f.where} onChange={(e) => setF({ ...f, where: e.target.value })} placeholder="Gokarna, Murudeshwar and Hampi" />
      </label>
      <label className="block text-xs font-medium text-slate-600">Starting from (optional)
        <input className="input mt-1" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder="Bangalore, by car" />
      </label>
      <div>
        <p className="text-xs font-medium text-slate-600 mb-1">Pace</p>
        <div className="grid grid-cols-3 gap-1.5">
          {PACES.map(([k, l, hint]) => (
            <button type="button" key={k} onClick={() => setF({ ...f, pace: k })} title={hint} className={`rounded-xl px-2 py-2 text-xs border ${f.pace === k ? 'bg-teal-700 text-white border-teal-700' : 'bg-white border-slate-300'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-slate-600 mb-1">Interests</p>
        <div className="flex flex-wrap gap-1.5">
          {INTERESTS.map((x) => (
            <button type="button" key={x} onClick={() => toggleInterest(x)} className={`rounded-full px-2.5 py-1 text-xs border ${f.interests.includes(x) ? 'bg-teal-700 text-white border-teal-700' : 'bg-white border-slate-300'}`}>{x}</button>
          ))}
        </div>
      </div>
      <textarea className="input" rows="2" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Anything else? Budget, vegetarians in the group, must-see places…" />
      {err && <p className="text-xs text-red-600">{err}</p>}
      <button disabled={busy} className="btn w-full">{busy ? 'Planning your trip… (about 10 seconds)' : `✨ Draft ${days.length} days`}</button>
    </form>
  )
}

function Needs({ data, packed, onAdd, onClose }) {
  return (
    <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-3 text-sm">
      <div className="flex justify-between"><p className="font-semibold text-violet-900">✨ For this day</p><button aria-label="Close suggestions" className="text-slate-400" onClick={onClose}>✕</button></div>
      {data.essentials?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-1">Carry</p>
          <ul className="space-y-1.5">
            {data.essentials.map((e, i) => {
              const done = packed.has(e.item.toLowerCase())
              return (
                <li key={i} className="flex gap-2 items-start">
                  <div className="flex-1"><p className="font-medium">{e.item}</p><p className="text-xs text-slate-500">{e.why}</p></div>
                  <button disabled={done} onClick={() => onAdd(e)} className="text-[11px] shrink-0 rounded-full border border-teal-700 text-teal-700 px-2 py-0.5 disabled:border-slate-300 disabled:text-slate-400">{done ? 'In packing ✓' : '+ Packing'}</button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {data.prepare?.length > 0 && <List title="Book / check before" items={data.prepare} />}
      {data.tips?.length > 0 && <List title="Tips" items={data.tips} />}
      <p className="text-[10px] text-slate-400">AI suggestions — double-check timings and bookings.</p>
    </div>
  )
}

function Suggestions({ stops, existing, onAdd, onClose }) {
  const [added, setAdded] = useState(new Set())
  return (
    <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-2 text-sm">
      <div className="flex justify-between"><p className="font-semibold text-violet-900">✨ Ideas for this day</p><button aria-label="Close suggestions" className="text-slate-400" onClick={onClose}>✕</button></div>
      {stops.length === 0 && <p className="text-xs text-slate-500">No ideas this time — try again.</p>}
      {stops.map((s, i) => {
        const done = added.has(i) || existing.has(s.title.toLowerCase())
        return (
          <div key={i} className="flex gap-2 items-start">
            <span className="text-lg">{kindOf(s.kind)[1]}</span>
            <div className="flex-1 min-w-0">
              <p className="font-medium">{s.title} <span className="text-xs text-slate-500 font-mono">{s.time}</span></p>
              <p className="text-xs text-slate-500">{s.why}{s.cost ? ` · ≈ ${inr(s.cost)}` : ''}{s.needsBooking ? ' · 🎟️ book ahead' : ''}</p>
            </div>
            <button disabled={done} onClick={() => { onAdd(s); setAdded(new Set(added).add(i)) }} className="text-[11px] shrink-0 rounded-full border border-teal-700 text-teal-700 px-2 py-0.5 disabled:border-slate-300 disabled:text-slate-400">{done ? 'Added ✓' : '+ Add'}</button>
          </div>
        )
      })}
      <p className="text-[10px] text-slate-400">AI suggestions — check opening hours before you go.</p>
    </div>
  )
}

const List = ({ title, items }) => (
  <div>
    <p className="text-xs font-semibold text-slate-600 mb-1">{title}</p>
    <ul className="list-disc pl-4 space-y-0.5">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
  </div>
)
