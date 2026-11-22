import { useEffect, useState } from 'react'
import { useCol, add, update, remove, updateTrip } from '../data'
import { tripDays, ymd } from './Trip'
import { MapLink } from './Today'
import ConfirmDialog from '../components/ConfirmDialog'
import { geocodePlace } from '../geocode'
import { askJSON, aiAvailable } from '../ai'
import { inr } from '../settle'
import { driveTime, parseDuration, toMin, fmtMin } from '../routing'
import Destinations from './Destinations'
import PlanChat from './PlanChat'
import { WhatsAppButton } from '../share'

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
  const [chatOpen, setChatOpen] = useState(false)
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
    cost: Number(s.cost) || 0, date,
    booking: ['todo', 'booked'].includes(s.booking) ? s.booking : s.needsBooking ? 'todo' : 'none',
    bookingRef: s.booking === 'booked' ? (s.bookingRef || '') : '',
    ...(typeof s.lat === 'number' && typeof s.lng === 'number' && Math.abs(s.lat) <= 90 && Math.abs(s.lng) <= 180 ? { lat: s.lat, lng: s.lng } : {}),
  })

  const [collapsed, setCollapsed] = useState(() => new Set())
  const [titleEdit, setTitleEdit] = useState(null)
  const [shareOpen, setShareOpen] = useState(false)
  const today = ymd(new Date())
  const plannedDays = days.filter((d) => items.some((i) => i.date === d.date)).length
  const route = (trip.destinations || []).length ? trip.destinations : []
  const toggleDay = (date) => setCollapsed((c) => { const n = new Set(c); n.has(date) ? n.delete(date) : n.add(date); return n })
  const jump = (date) => {
    setCollapsed((c) => { const n = new Set(c); n.delete(date); return n })
    setTimeout(() => document.getElementById(`day-${date}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }
  const saveTitle = (date, title) => updateTrip(tripId, { [`dayTitles.${date}`]: title.trim() || null })

  return (
    <>
      {/* Itinerary overview */}
      <section className="rounded-3xl overflow-hidden shadow-sm ring-1 ring-slate-200 bg-white">
        <div className="bg-gradient-to-br from-slate-900 via-teal-900 to-teal-700 text-white p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-teal-200">Itinerary</p>
              {route.length > 0
                ? <p className="mt-1 font-semibold leading-snug">{route.join('  →  ')}</p>
                : <p className="mt-1 font-semibold">{days.length}-day trip</p>}
            </div>
            <button onClick={() => setShareOpen(!shareOpen)} className="shrink-0 rounded-full bg-white/15 hover:bg-white/25 px-3 py-1.5 text-xs font-semibold">📤 Share</button>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[[`${plannedDays}/${days.length}`, 'days planned'], [items.length, 'stops'], [totalCost ? inr(totalCost) : '—', 'per person'], [toBook.length, 'to book']].map(([v, l]) => (
              <div key={l} className="rounded-xl bg-white/10 py-2"><p className="font-bold text-sm">{v}</p><p className="text-[10px] text-teal-100">{l}</p></div>
            ))}
          </div>
          <div className="h-1.5 rounded-full bg-white/15 overflow-hidden" role="progressbar" aria-valuenow={plannedDays} aria-valuemax={days.length} aria-label="Days planned">
            <div className="h-full bg-amber-300 rounded-full transition-all" style={{ width: `${days.length ? (plannedDays / days.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {aiAvailable() && <button onClick={() => { setChatOpen(!chatOpen); setPlanner(false) }} className={`text-xs font-semibold rounded-xl py-2.5 border ${chatOpen ? 'bg-violet-700 text-white border-violet-700' : 'border-violet-200 bg-violet-50 text-violet-800'}`}>💬 Chat to plan</button>}
            {aiAvailable() && <button onClick={() => { setPlanner(!planner); setChatOpen(false) }} className={`text-xs font-semibold rounded-xl py-2.5 border ${planner ? 'bg-violet-700 text-white border-violet-700' : 'border-violet-200 bg-violet-50 text-violet-800'}`}>✨ Plan whole trip</button>}
            {toBook.length > 0 && <button onClick={() => setShowToBook(!showToBook)} className="text-xs font-semibold rounded-xl border border-amber-300 bg-amber-50 text-amber-800 py-2.5">🎟️ {toBook.length} still to book</button>}
            {setTab && items.length > 0 && <button className="text-xs font-semibold rounded-xl border border-slate-200 bg-white py-2.5" onClick={() => setTab('map')}>🗺️ See on map</button>}
          </div>
          {shareOpen && <ShareItinerary trip={trip} days={days} items={items} onClose={() => setShareOpen(false)} />}
          {showToBook && toBook.length > 0 && (
            <ul className="text-sm divide-y divide-slate-100 border border-amber-200 rounded-xl px-3">
              {toBook.map((i) => {
                const d = days.find((x) => x.date === i.date)
                return (
                  <li key={i.id} className="py-2 flex items-center gap-2">
                    <span className="flex-1 min-w-0"><span className="font-medium">{i.title}</span><span className="block text-xs text-slate-500">{d ? dayLabel(d) : i.date}{i.time ? ` · ${i.time}` : ''}</span></span>
                    <button className="text-xs rounded-full border border-teal-700 text-teal-700 px-2 py-0.5 shrink-0" onClick={() => { jump(i.date); setEditing(i) }}>Mark booked</button>
                  </li>
                )
              })}
            </ul>
          )}
          {chatOpen && (
            <PlanChat trip={trip} days={days} items={items}
              onAdd={addStop}
              onUpdate={(id, patch) => update(tripId, 'plan', id, patch)}
              onRemove={(id) => remove(tripId, 'plan', id)}
              onAddDestinations={(list) => updateTrip(tripId, { destinations: [...(trip.destinations || []), ...list] })}
              onClose={() => setChatOpen(false)} />
          )}
          {planner && <TripPlanner trip={trip} days={days} items={items} onAdd={addStop} onDone={() => setPlanner(false)} />}
          <Destinations tripId={tripId} trip={trip} uid={uid} days={days} onSchedule={addStop} planIds={new Set(items.map((i) => i.id))} />
        </div>
      </section>

      {/* Day navigator */}
      <nav aria-label="Jump to day" className="sticky top-[56px] z-10 -mx-4 px-4 py-2 bg-slate-50/90 backdrop-blur border-b border-slate-200/60">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {days.map((d) => {
            const n = items.filter((i) => i.date === d.date).length
            const isToday = d.date === today
            return (
              <button key={d.date} onClick={() => jump(d.date)}
                className={`shrink-0 rounded-xl px-2.5 py-1.5 text-center border transition ${isToday ? 'bg-amber-400 border-amber-400 text-slate-900' : 'bg-white border-slate-200 hover:border-teal-600'}`}>
                <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short' })}</p>
                <p className="text-sm font-bold leading-tight">Day {d.n}</p>
                <p className={`text-[10px] ${n ? 'text-teal-700' : 'text-slate-400'} ${isToday ? '!text-slate-800' : ''}`}>{n ? `${n} stop${n > 1 ? 's' : ''}` : 'free'}</p>
              </button>
            )
          })}
        </div>
      </nav>

      {days.map((d) => {
        const list = items.filter((i) => i.date === d.date).sort(byTime)
        const dayCost = list.reduce((s, i) => s + (Number(i.cost) || 0), 0)
        const a = ai[d.date]
        const isCollapsed = collapsed.has(d.date)
        const title = trip.dayTitles?.[d.date]
        const isToday = d.date === today
        return (
          <section key={d.date} id={`day-${d.date}`} className={`scroll-mt-32 rounded-3xl bg-white ring-1 shadow-sm overflow-hidden ${isToday ? 'ring-amber-400' : 'ring-slate-200'}`}>
            <header className="flex items-start gap-3 p-4 pb-3">
              <div className="size-12 shrink-0 rounded-2xl bg-gradient-to-br from-teal-700 to-teal-900 text-white grid place-items-center leading-none shadow">
                <span className="text-[9px] uppercase tracking-wider opacity-80">Day</span><span className="text-lg font-bold -mt-1">{d.n}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-500">{new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}{isToday && <span className="ml-1.5 rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-bold">TODAY</span>}</p>
                {titleEdit === d.date ? (
                  <form className="flex gap-1 mt-0.5" onSubmit={(e) => { e.preventDefault(); saveTitle(d.date, e.target.t.value); setTitleEdit(null) }}>
                    <input name="t" autoFocus defaultValue={title || ''} maxLength={50} placeholder="e.g. Jungle day in Dandeli" className="input py-1 text-sm" />
                    <button className="btn py-1 px-2 text-xs">Save</button>
                  </form>
                ) : (
                  <button className="text-left font-semibold text-slate-900 hover:underline decoration-dotted" onClick={() => setTitleEdit(d.date)}>
                    {title || <span className="text-slate-400 font-normal">+ Add a title for this day</span>}
                  </button>
                )}
                {list.length > 0 && <DaySummary list={list} cost={dayCost} />}
              </div>
              <button aria-label={isCollapsed ? `Expand day ${d.n}` : `Collapse day ${d.n}`} aria-expanded={!isCollapsed} onClick={() => toggleDay(d.date)}
                className="size-8 shrink-0 grid place-items-center rounded-full hover:bg-slate-100 text-slate-500">{isCollapsed ? '▾' : '▴'}</button>
            </header>

            {!isCollapsed && (
              <div className="px-4 pb-4">
                {list.length === 0 && editing?.date !== d.date && (
                  <div className="rounded-2xl border-2 border-dashed border-slate-200 p-4 text-center">
                    <p className="text-sm text-slate-500">Nothing planned yet 🌴</p>
                    <div className="mt-2 flex justify-center gap-2">
                      <button className="btn text-xs py-1.5 px-3" onClick={() => setEditing({ date: d.date })}>+ Add stop</button>
                      {aiAvailable() && <button className="text-xs font-semibold rounded-xl border border-violet-200 bg-violet-50 text-violet-800 px-3" disabled={a?.busy} onClick={() => runAI(d, list, 'stops')}>{a?.busy ? 'Thinking…' : '✨ Ideas'}</button>}
                    </div>
                  </div>
                )}

                <ol>
                  {list.map((i, idx) => {
                    const [, icon, label] = kindOf(i.kind)
                    const next = list[idx + 1]
                    if (editing?.id === i.id) {
                      return <li key={i.id}><StopForm initial={i} days={days} onCancel={() => setEditing(null)} onSave={(v) => { update(tripId, 'plan', i.id, v); setEditing(null) }} /></li>
                    }
                    return (
                      <li key={i.id}>
                        <div className="flex gap-2.5">
                          <div className="w-11 shrink-0 pt-2.5 text-right">
                            <p className="text-xs font-bold text-slate-800 tabular-nums">{i.time || '—'}</p>
                            {i.duration && <p className="text-[10px] text-slate-400">{i.duration}</p>}
                          </div>
                          <span className={`size-9 mt-1 shrink-0 rounded-full grid place-items-center text-base ring-4 ring-white ${KIND_STYLE[i.kind] || KIND_STYLE.place}`} title={label}>{icon}</span>
                          <div className="flex-1 min-w-0 rounded-2xl bg-slate-50 hover:bg-slate-100/80 transition px-3 py-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-slate-900 leading-snug">{i.title}</p>
                              <div className="flex shrink-0 -mr-1 -mt-0.5">
                                <button aria-label={`Edit or move ${i.title}`} className="size-7 grid place-items-center rounded-full text-slate-400 hover:text-teal-700 hover:bg-white" onClick={() => setEditing(i)}>✎</button>
                                <button aria-label={`Delete ${i.title}`} className="size-7 grid place-items-center rounded-full text-slate-400 hover:text-red-500 hover:bg-white" onClick={() => setDeletingItem(i)}>✕</button>
                              </div>
                            </div>
                            {i.place && <MapLink place={i.place} />}
                            {i.notes && <p className="text-xs text-slate-500 whitespace-pre-wrap mt-0.5">{i.notes}</p>}
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              {i.booking === 'todo' && <span className="text-[11px] font-semibold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">🎟️ To book</span>}
                              {i.booking === 'booked' && <span className="text-[11px] font-semibold bg-teal-100 text-teal-800 rounded-full px-2 py-0.5">✅ Booked{i.bookingRef ? ` · ${i.bookingRef}` : ''}</span>}
                              {Number(i.cost) > 0 && <span className="text-[11px] bg-white ring-1 ring-slate-200 rounded-full px-2 py-0.5">≈ {inr(i.cost)}/person</span>}
                              {visited[i.id]
                                ? <span className="text-[11px] font-semibold text-teal-700">✓ Visited{visited[i.id].rating ? ` · ${'★'.repeat(visited[i.id].rating)}` : ''}</span>
                                : <button type="button" disabled={marking[i.id] === 'busy'} onClick={() => markVisited(i)} className="text-[11px] bg-white ring-1 ring-slate-200 rounded-full px-2 py-0.5 font-medium text-slate-600 hover:ring-teal-600 hover:text-teal-700">{marking[i.id] === 'busy' ? 'Saving…' : '✓ Mark visited'}</button>}
                              {setTab && i.place && <button type="button" onClick={() => { sessionStorage.setItem('yatra:map_focus', i.id); setTab('map') }} className="text-[11px] text-teal-700 underline">Map</button>}
                            </div>
                            {marking[i.id] && marking[i.id] !== 'busy' && <p className="text-[11px] text-red-600 mt-0.5">{marking[i.id]}</p>}
                          </div>
                        </div>
                        {next ? <div className="pl-[52px]"><Leg from={i} to={next} /></div> : null}
                      </li>
                    )
                  })}
                </ol>

                {editing?.date === d.date && !editing.id && <StopForm initial={{ date: d.date }} days={days} onCancel={() => setEditing(null)} onSave={(v) => { add(tripId, 'plan', v); setEditing(null) }} />}

                {list.length > 0 && (
                  <div className="mt-3 flex gap-2">
                    <button className="flex-1 text-xs font-semibold rounded-xl border border-slate-200 bg-white py-2 hover:border-teal-600" onClick={() => setEditing({ date: d.date })}>+ Add stop</button>
                    {aiAvailable() && <button disabled={a?.busy} onClick={() => runAI(d, list, 'needs')} className="flex-1 text-xs font-semibold rounded-xl border border-violet-200 bg-violet-50 text-violet-800 py-2">{a?.busy && a.mode === 'needs' ? 'Thinking…' : '✨ What we need'}</button>}
                    {aiAvailable() && <button disabled={a?.busy} onClick={() => runAI(d, list, 'stops')} className="flex-1 text-xs font-semibold rounded-xl border border-violet-200 bg-violet-50 text-violet-800 py-2">{a?.busy && a.mode === 'stops' ? 'Thinking…' : '✨ More ideas'}</button>}
                  </div>
                )}
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

const KIND_STYLE = {
  place: 'bg-teal-100 text-teal-800',
  activity: 'bg-orange-100 text-orange-800',
  food: 'bg-rose-100 text-rose-800',
  stay: 'bg-indigo-100 text-indigo-800',
  travel: 'bg-slate-200 text-slate-800',
}

// "4 stops · 🚗 62 km · 1 h 40 min · ≈ ₹2,100/person" — driving totals come from the cached route lookups.
function DaySummary({ list, cost }) {
  const [drive, setDrive] = useState(null)
  const key = list.map((i) => `${i.lat},${i.lng}`).join('|')
  useEffect(() => {
    let live = true
    const pairs = list.slice(0, -1).map((a, k) => [a, list[k + 1]]).filter(([a, b]) => hasCoords(a) && hasCoords(b))
    if (!pairs.length) { setDrive(null); return }
    Promise.all(pairs.map(([a, b]) => driveTime(a, b))).then((rs) => {
      if (!live) return
      const ok = rs.filter(Boolean)
      setDrive(ok.length ? { km: Math.round(ok.reduce((s, r) => s + r.km, 0)), min: ok.reduce((s, r) => s + r.min, 0) } : null)
    })
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const bits = [`${list.length} stop${list.length > 1 ? 's' : ''}`]
  if (drive?.km) bits.push(`🚗 ${drive.km} km · ${fmtMin(drive.min)}`)
  if (cost) bits.push(`≈ ${inr(cost)}/person`)
  return <p className="mt-0.5 text-xs text-slate-500">{bits.join(' · ')}</p>
}

// Whole itinerary as text: send to the WhatsApp group or copy anywhere.
function ShareItinerary({ trip, days, items, onClose }) {
  const [copied, setCopied] = useState(false)
  const lines = [`🗓️ *${trip.name}* — itinerary`]
  if (trip.destinations?.length) lines.push(trip.destinations.join(' → '))
  for (const d of days) {
    const list = items.filter((i) => i.date === d.date).sort(byTime)
    const title = trip.dayTitles?.[d.date]
    lines.push('', `*Day ${d.n} · ${new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}*${title ? ` — ${title}` : ''}`)
    if (!list.length) lines.push('Free day 🌴')
    for (const i of list) lines.push(`${i.time || '•'} ${kindOf(i.kind)[1]} ${i.title}${i.booking === 'todo' ? ' (🎟️ to book)' : i.booking === 'booked' ? ' ✅' : ''}`)
  }
  lines.push('', `Plan together on Yatra 👉 ${location.origin}/#/t/${trip.id}`)
  const text = lines.join('\n')
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
      <div className="flex justify-between items-center"><p className="text-sm font-semibold">Share the itinerary</p><button aria-label="Close" className="text-slate-400" onClick={onClose}>✕</button></div>
      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-slate-600 bg-white rounded-lg p-2 ring-1 ring-slate-200">{text}</pre>
      <div className="flex gap-2">
        <WhatsAppButton className="flex-1" label="Send on WhatsApp" text={text} />
        <button className="btn-ghost flex-1 text-sm" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {} }}>{copied ? 'Copied ✓' : 'Copy text'}</button>
      </div>
    </div>
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
  const [f, setF] = useState({ where: trip.destinations?.length ? trip.destinations.join(', then ') : trip.name || '', from: '', pace: 'balanced', interests: ['Food', 'Beaches'], notes: '' })
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
