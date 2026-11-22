import { useState } from 'react'
import { useCol, add, update, remove } from '../data'
import { tripDays, ymd } from './Trip'
import { MapLink } from './Today'
import ConfirmDialog from '../components/ConfirmDialog'
import { geocodePlace } from '../geocode'
import { askJSON, aiAvailable } from '../ai'
import { inr } from '../settle'

export const KINDS = [
  ['place', '📍', 'Sightseeing'],
  ['activity', '🎯', 'Activity'],
  ['food', '🍽️', 'Food'],
  ['stay', '🏨', 'Stay'],
  ['travel', '🚗', 'Travel'],
]
const kindOf = (k) => KINDS.find(([v]) => v === k) || KINDS[0]
const PACK_CATS = ['clothes', 'electronics', 'toiletries', 'medical', 'docs', 'gear']

export default function Plan({ tripId, trip, uid, setTab }) {
  const items = useCol(tripId, 'plan', 'time')
  const places = useCol(tripId, 'places')
  const packing = useCol(tripId, 'packing')
  const days = tripDays(trip)
  const [editing, setEditing] = useState(null) // { date } for new, or an item
  const [deletingItem, setDeletingItem] = useState(null)
  const [marking, setMarking] = useState({})
  const [ai, setAi] = useState({}) // date -> { mode, busy, err, data }

  const visited = Object.fromEntries(places.filter((p) => p.planId).map((p) => [p.planId, p]))
  const packed = new Set(packing.map((p) => (p.text || '').toLowerCase()))
  const totalCost = items.reduce((s, i) => s + (Number(i.cost) || 0), 0)

  async function markVisited(i) {
    setMarking((m) => ({ ...m, [i.id]: 'busy' }))
    let lat = i.lat, lng = i.lng
    if (typeof lat !== 'number' || typeof lng !== 'number') {
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
            parts: [`${ctx}\n\nWhat should the group carry, prepare or book for this day? Give packing essentials tied to specific stops, things to book or check in advance (permits, tickets, tide/opening times, cash-only places), and short practical tips.`],
            schema: {
              type: 'OBJECT',
              properties: {
                essentials: { type: 'ARRAY', items: { type: 'OBJECT', properties: { item: { type: 'STRING' }, why: { type: 'STRING' }, category: { type: 'STRING', enum: PACK_CATS } }, required: ['item', 'why', 'category'] } },
                prepare: { type: 'ARRAY', items: { type: 'STRING' } },
                tips: { type: 'ARRAY', items: { type: 'STRING' } },
              },
              required: ['essentials', 'prepare', 'tips'],
            },
          })
        : await askJSON({
            system: 'You are a local Indian travel expert. Suggest real, specific, well-known places only. Never invent places.',
            parts: [`${ctx}\n\nSuggest up to 5 stops that fit around the existing plan (good timing, nearby, mix of food and sights). Use real place names with the town so they can be found on a map.`],
            schema: {
              type: 'OBJECT',
              properties: {
                stops: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, place: { type: 'STRING' }, kind: { type: 'STRING', enum: KINDS.map(([k]) => k) }, time: { type: 'STRING', description: 'HH:MM 24h' }, why: { type: 'STRING' }, cost: { type: 'NUMBER', description: 'rough cost per person in INR, 0 if free' } }, required: ['title', 'place', 'kind', 'time', 'why'] } },
              },
              required: ['stops'],
            },
            temperature: 0.6,
          })
      setAi((a) => ({ ...a, [day.date]: { mode, data } }))
    } catch (e) {
      setAi((a) => ({ ...a, [day.date]: { mode, err: e.message } }))
    }
  }

  const addToPacking = (e) => add(tripId, 'packing', { text: e.item, category: e.category, owner: null, bringer: null, done: false })

  return (
    <>
      <section className="card flex items-center justify-between">
        <div>
          <p className="font-semibold">{items.length} stops over {days.length} days</p>
          <p className="text-xs text-slate-500">{totalCost ? `≈ ${inr(totalCost)} per person in planned costs` : 'Add stops, activities, food and stays to each day'}</p>
        </div>
        {setTab && items.length > 0 && <button className="btn-ghost text-xs py-1.5" onClick={() => setTab('map')}>🗺️ Map</button>}
      </section>

      {days.map((d) => {
        const list = items.filter((i) => i.date === d.date).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'))
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

            <ol className="mt-3 relative">
              {list.map((i, idx) => {
                const [, icon, label] = kindOf(i.kind)
                if (editing?.id === i.id) return <li key={i.id}><StopForm initial={i} onCancel={() => setEditing(null)} onSave={(v) => { update(tripId, 'plan', i.id, v); setEditing(null) }} /></li>
                return (
                  <li key={i.id} className="flex gap-3 pb-4 last:pb-0 relative">
                    {idx < list.length - 1 && <span aria-hidden className="absolute left-[19px] top-10 bottom-0 w-px bg-slate-200" />}
                    <span className="size-10 shrink-0 rounded-full bg-teal-50 border border-teal-200 grid place-items-center text-lg" title={label}>{icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-mono text-teal-700">{i.time || 'Anytime'}{i.duration ? ` · ${i.duration}` : ''}</p>
                          <p className="font-medium text-slate-900">{i.title}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button aria-label={`Edit ${i.title}`} className="text-slate-400 px-1 hover:text-teal-700" onClick={() => setEditing(i)}>✎</button>
                          <button aria-label={`Delete ${i.title}`} className="text-slate-400 px-1 hover:text-red-500" onClick={() => setDeletingItem(i)}>✕</button>
                        </div>
                      </div>
                      {i.place && <MapLink place={i.place} />}
                      {i.notes && <p className="text-xs text-slate-500 whitespace-pre-wrap mt-0.5">{i.notes}</p>}
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        {Number(i.cost) > 0 && <span className="text-[11px] bg-slate-100 rounded-full px-2 py-0.5">≈ {inr(i.cost)}/person</span>}
                        {visited[i.id]
                          ? <span className="text-[11px] font-semibold text-teal-700">✓ Visited{visited[i.id].rating ? ` · ${'★'.repeat(visited[i.id].rating)}` : ''}</span>
                          : <button type="button" disabled={marking[i.id] === 'busy'} onClick={() => markVisited(i)} className="text-[11px] border border-slate-300 rounded-full px-2 py-0.5 font-medium text-slate-600 hover:border-teal-600 hover:text-teal-700">{marking[i.id] === 'busy' ? 'Saving…' : '✓ Mark visited'}</button>}
                        {setTab && i.place && <button type="button" onClick={() => { sessionStorage.setItem('yatra:map_focus', i.id); setTab('map') }} className="text-[11px] text-teal-700 underline">Show on map</button>}
                      </div>
                      {marking[i.id] && marking[i.id] !== 'busy' && <p className="text-[11px] text-red-600 mt-0.5">{marking[i.id]}</p>}
                    </div>
                  </li>
                )
              })}
            </ol>

            {editing?.date === d.date && !editing.id && <StopForm initial={{}} onCancel={() => setEditing(null)} onSave={(v) => { add(tripId, 'plan', { ...v, date: d.date }); setEditing(null) }} />}

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
                    onAdd={(s) => add(tripId, 'plan', { title: s.title, place: s.place, kind: s.kind, time: /^\d{2}:\d{2}$/.test(s.time) ? s.time : '', notes: s.why, cost: Number(s.cost) || 0, date: d.date })}
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

function StopForm({ initial, onSave, onCancel }) {
  const [v, setV] = useState({ kind: 'place', time: '', duration: '', title: '', place: '', notes: '', cost: '', ...initial })
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  function submit(e) {
    e.preventDefault()
    const { id, createdAt, date, lat, lng, ...rest } = v
    const out = { ...rest, title: rest.title.trim(), cost: Number(rest.cost) || 0 }
    // Place changed → drop old coordinates so the map looks it up again.
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
      <textarea className="input" rows="2" placeholder="Notes — booking ID, contact, what to order…" value={v.notes} onChange={set('notes')} />
      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={onCancel}>Cancel</button>
        <button className="btn flex-1">{initial.id ? 'Save' : 'Add stop'}</button>
      </div>
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
              <p className="text-xs text-slate-500">{s.why}{s.cost ? ` · ≈ ${inr(s.cost)}` : ''}</p>
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
