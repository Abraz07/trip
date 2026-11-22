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
import AddToPlan, { nextFreeTime } from '../components/AddToPlan'
import PlanChat from './PlanChat'
import { WhatsAppButton } from '../share'

export const KINDS = [
  ['place', '📍', 'Sight'],
  ['food', '🍽️', 'Food'],
  ['activity', '🎯', 'Activity'],
  ['stay', '🏨', 'Stay'],
  ['travel', '🚗', 'Travel'],
]

const KIND_STYLE = {
  place: { label: 'Sight', badge: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  food: { label: 'Food', badge: 'bg-rose-50 text-rose-800 border-rose-200', dot: 'bg-rose-100 text-rose-800 ring-rose-200' },
  activity: { label: 'Activity', badge: 'bg-amber-50 text-amber-900 border-amber-200', dot: 'bg-amber-100 text-amber-800 ring-amber-200' },
  stay: { label: 'Stay', badge: 'bg-indigo-50 text-indigo-800 border-indigo-200', dot: 'bg-indigo-100 text-indigo-800 ring-indigo-200' },
  travel: { label: 'Travel', badge: 'bg-slate-100 text-slate-800 border-slate-200', dot: 'bg-slate-200 text-slate-800 ring-slate-300' },
}

const kindOf = (k) => KINDS.find(([v]) => v === k) || KINDS[0]
const PACK_CATS = ['clothes', 'electronics', 'toiletries', 'medical', 'docs', 'gear']
const hasCoords = (i) => typeof i?.lat === 'number' && typeof i?.lng === 'number'
const dayLabel = (d) => `Day ${d.n} · ${new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`
// Stops run in time order; `order` (set by Reorder) breaks ties, e.g. between stops with no time.
const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99') || (a.order ?? 0) - (b.order ?? 0)

export default function Plan({ tripId, trip, uid, setTab }) {
  const items = useCol(tripId, 'plan', 'time')
  const places = useCol(tripId, 'places')
  const packing = useCol(tripId, 'packing')
  const days = tripDays(trip)

  const [editing, setEditing] = useState(null)
  const [deletingItem, setDeletingItem] = useState(null)
  const [marking, setMarking] = useState({})
  const [ai, setAi] = useState({})
  const [planner, setPlanner] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [showToBook, setShowToBook] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [titleEdit, setTitleEdit] = useState(null)
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [reordering, setReordering] = useState(null) // date of the day being rearranged

  // Save a new order: the day's time slots stay where they are and the stops move between them,
  // so moving the 16:00 fort to the top makes it the 09:00 stop. Durations travel with their stop.
  async function saveOrder(ordered) {
    const slots = ordered.map((i) => i.time || '').sort((a, b) => (a || '99').localeCompare(b || '99'))
    await Promise.all(ordered.map((i, k) => ((i.time || '') === slots[k] && i.order === k
      ? null
      : update(tripId, 'plan', i.id, { time: slots[k], order: k }))))
    setReordering(null)
  }

  const visited = Object.fromEntries(places.filter((p) => p.planId).map((p) => [p.planId, p]))
  const packed = new Set(packing.map((p) => (p.text || '').toLowerCase()))
  const totalCost = items.reduce((s, i) => s + (Number(i.cost) || 0), 0)
  const toBook = items.filter((i) => i.booking === 'todo').sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
  const today = ymd(new Date())
  const plannedDays = days.filter((d) => items.some((i) => i.date === d.date)).length
  const route = (trip.destinations || []).length ? trip.destinations : []

  // Look up coordinates for stops without lat/lng for route computation and map view
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
      setMarking((m) => ({ ...m, [i.id]: "Couldn't locate on map — mark via More → Places" }))
      return
    }
    await add(tripId, 'places', {
      name: i.title,
      lat,
      lng,
      category: i.kind === 'food' ? 'food' : i.kind === 'stay' ? 'stay' : 'other',
      rating: 0,
      note: '',
      planId: i.id,
      by: uid,
      date: ymd(new Date()),
    })
    setMarking((m) => ({ ...m, [i.id]: null }))
  }

  async function runAI(day, list, mode) {
    setAi((a) => ({ ...a, [day.date]: { mode, busy: true, err: null } }))
    try {
      const stops = list.map((i) => `- ${i.time || 'anytime'} [${kindOf(i.kind)[2]}] ${i.title}${i.place ? ` @ ${i.place}` : ''}${i.notes ? ` (${i.notes})` : ''}`).join('\n') || '(nothing planned yet)'
      const ctx = `Trip: "${trip.name}", ${trip.start} to ${trip.end}. Day ${day.n} (${day.date}). Group of friends from India.\nPlanned stops:\n${stops}`
      const data = mode === 'needs'
        ? await askJSON({
            system: 'You are a practical Indian travel advisor. Provide direct, actionable packing and preparation guidance tied directly to the stops planned. No generic filler.',
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
            system: 'You are a local Indian travel expert. Suggest real, specific places only with towns.',
            parts: [`${ctx}\n\nSuggest up to 5 stops that fit around the existing plan (good timing, nearby, mix of food and sights). Use real place names.`],
            schema: { type: 'OBJECT', properties: { stops: { type: 'ARRAY', items: STOP_SCHEMA } }, required: ['stops'] },
            temperature: 0.6,
            thinking: 'minimal',
          })
      setAi((a) => ({ ...a, [day.date]: { mode, data, busy: false } }))
    } catch (e) {
      setAi((a) => ({ ...a, [day.date]: { mode, err: e.message, busy: false } }))
    }
  }

  const addToPacking = (e) => add(tripId, 'packing', { text: e.item, category: e.category, owner: null, bringer: null, done: false })
  const addStop = (s, date) => add(tripId, 'plan', {
    title: s.title,
    place: s.place || '',
    kind: KINDS.some(([k]) => k === s.kind) ? s.kind : 'place',
    time: /^\d{2}:\d{2}$/.test(s.time || '') ? s.time : '',
    duration: s.duration || '',
    notes: s.why || s.notes || '',
    cost: Number(s.cost) || 0,
    date,
    booking: ['todo', 'booked'].includes(s.booking) ? s.booking : s.needsBooking ? 'todo' : 'none',
    bookingRef: s.booking === 'booked' ? (s.bookingRef || '') : '',
    ...(typeof s.lat === 'number' && typeof s.lng === 'number' && Math.abs(s.lat) <= 90 && Math.abs(s.lng) <= 180 ? { lat: s.lat, lng: s.lng } : {}),
  })

  const toggleDay = (date) => setCollapsed((c) => {
    const n = new Set(c)
    n.has(date) ? n.delete(date) : n.add(date)
    return n
  })

  const jump = (date) => {
    setCollapsed((c) => { const n = new Set(c); n.delete(date); return n })
    setTimeout(() => {
      const el = document.getElementById(`day-${date}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 40)
  }

  const saveTitle = (date, title) => updateTrip(tripId, { [`dayTitles.${date}`]: title.trim() || null })

  return (
    <div className="space-y-4">

      {/* 1. OVERVIEW & ITINERARY HERO */}
      <section className="rounded-3xl bg-white border border-slate-200/90 shadow-sm overflow-hidden">
        {/* Top Gradient Banner */}
        <div className="bg-gradient-to-br from-slate-900 via-teal-950 to-teal-800 text-white p-4 sm:p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-teal-300">
                Itinerary · {days.length} Days
              </span>
              {route.length > 0 ? (
                <p className="mt-0.5 font-bold text-sm sm:text-base leading-snug break-words">
                  {route.join('  →  ')}
                </p>
              ) : (
                <p className="mt-0.5 font-bold text-sm sm:text-base leading-snug">
                  {trip.name || `${days.length}-Day Trip`}
                </p>
              )}
            </div>

            <button
              onClick={() => setShareOpen(true)}
              className="shrink-0 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 px-3 py-1.5 text-xs font-semibold text-white transition flex items-center gap-1"
            >
              <span>↗</span>
              <span>Share</span>
            </button>
          </div>

          {/* 4 Stat Boxes: Evenly spaced with min-w-0 to prevent overlapping */}
          <div className="grid grid-cols-4 gap-2 text-center pt-1">
            <div className="rounded-xl bg-white/10 py-2 px-1 min-w-0">
              <p className="font-bold text-xs sm:text-sm tabular-nums truncate">{plannedDays}/{days.length}</p>
              <p className="text-[10px] text-teal-100/80 leading-none mt-0.5">Days set</p>
            </div>
            <div className="rounded-xl bg-white/10 py-2 px-1 min-w-0">
              <p className="font-bold text-xs sm:text-sm tabular-nums truncate">{items.length}</p>
              <p className="text-[10px] text-teal-100/80 leading-none mt-0.5">Stops</p>
            </div>
            <div className="rounded-xl bg-white/10 py-2 px-1 min-w-0">
              <p className="font-bold text-xs sm:text-sm tabular-nums truncate">{totalCost ? inr(totalCost) : '—'}</p>
              <p className="text-[10px] text-teal-100/80 leading-none mt-0.5">/ person</p>
            </div>
            <div className={`rounded-xl py-2 px-1 min-w-0 ${toBook.length > 0 ? 'bg-amber-400 text-slate-950 font-bold' : 'bg-white/10 text-white'}`}>
              <p className="font-bold text-xs sm:text-sm tabular-nums truncate">{toBook.length}</p>
              <p className={`text-[10px] leading-none mt-0.5 ${toBook.length > 0 ? 'text-slate-900 font-semibold' : 'text-teal-100/80'}`}>To book</p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="h-1.5 rounded-full bg-white/15 overflow-hidden" role="progressbar" aria-valuenow={plannedDays} aria-valuemax={days.length}>
            <div
              className="h-full bg-amber-400 rounded-full transition-all duration-300"
              style={{ width: `${days.length ? (plannedDays / days.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Action Controls & Sub-Panels */}
        <div className="p-4 space-y-3">
          {/* Action Grid: 2 clean columns, fully responsive */}
          <div className="grid grid-cols-2 gap-2">
            {aiAvailable() && (
              <button
                onClick={() => { setChatOpen(!chatOpen); setPlanner(false) }}
                className={`text-xs font-semibold rounded-xl py-2.5 px-2 border text-center transition active:scale-95 truncate ${
                  chatOpen ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                }`}
              >
                💬 Chat to plan
              </button>
            )}

            {aiAvailable() && (
              <button
                onClick={() => { setPlanner(!planner); setChatOpen(false) }}
                className={`text-xs font-semibold rounded-xl py-2.5 px-2 border text-center transition active:scale-95 truncate ${
                  planner ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                }`}
              >
                ✨ Plan whole trip
              </button>
            )}

            {toBook.length > 0 && (
              <button
                onClick={() => setShowToBook(!showToBook)}
                className={`text-xs font-semibold rounded-xl py-2.5 px-2 border text-center transition active:scale-95 truncate ${
                  showToBook ? 'bg-amber-500 text-white border-amber-500' : 'border-amber-300 bg-amber-50 text-amber-900'
                }`}
              >
                🎟️ {toBook.length} to book {showToBook ? '▲' : '▼'}
              </button>
            )}

            {setTab && items.length > 0 && (
              <button
                onClick={() => setTab('map')}
                className="text-xs font-semibold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 py-2.5 px-2 text-center transition active:scale-95 truncate"
              >
                🗺️ See on map
              </button>
            )}
          </div>

          {/* Inline Bookings Checklist */}
          {showToBook && toBook.length > 0 && (
            <div className="p-3 bg-amber-50/60 rounded-2xl border border-amber-200 space-y-2">
              <div className="flex items-center justify-between pb-1 border-b border-amber-200/60 text-xs">
                <span className="font-bold text-amber-950">Pending Reservations ({toBook.length})</span>
                <button onClick={() => setShowToBook(false)} className="text-amber-800 hover:text-amber-950 font-bold">✕</button>
              </div>
              <ul className="divide-y divide-amber-200/50 text-xs">
                {toBook.map((i) => {
                  const d = days.find((x) => x.date === i.date)
                  return (
                    <li key={i.id} className="py-2 flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 truncate">{i.title}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {d ? dayLabel(d) : i.date}{i.time ? ` · ${i.time}` : ''}{i.cost ? ` · ≈ ${inr(i.cost)}/ea` : ''}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          jump(i.date)
                          setEditing(i)
                        }}
                        className="shrink-0 text-xs rounded-lg border border-teal-700 bg-white hover:bg-teal-50 text-teal-700 font-semibold px-2.5 py-1 active:scale-95 transition"
                      >
                        Mark booked
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* Embedded Natural Chat Planner */}
          {chatOpen && (
            <div className="pt-2 border-t border-slate-100">
              <PlanChat
                trip={trip}
                days={days}
                items={items}
                onAdd={addStop}
                onUpdate={(id, patch) => update(tripId, 'plan', id, patch)}
                onRemove={(id) => remove(tripId, 'plan', id)}
                onAddDestinations={(list) => updateTrip(tripId, { destinations: [...(trip.destinations || []), ...list] })}
                onClose={() => setChatOpen(false)}
              />
            </div>
          )}

          {/* Embedded Trip Planner Wizard */}
          {planner && (
            <div className="pt-2 border-t border-slate-100">
              <TripPlanner trip={trip} days={days} items={items} onAdd={addStop} onDone={() => setPlanner(false)} />
            </div>
          )}

          {/* Destinations Wishlist & Manager */}
          <div className="pt-2 border-t border-slate-100">
            <Destinations
              tripId={tripId}
              trip={trip}
              uid={uid}
              days={days}
              onSchedule={addStop}
              suggestTime={(date) => nextFreeTime(items, date)}
              planIds={new Set(items.map((i) => i.id))}
            />
          </div>
        </div>
      </section>

      {/* 2. CALENDAR DAY NAVIGATOR (HORIZONTAL SCROLL, ZERO OVERLAP) */}
      <nav aria-label="Jump to day" className="bg-slate-100/90 rounded-2xl p-1.5 border border-slate-200">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {days.map((d) => {
            const count = items.filter((i) => i.date === d.date).length
            const isToday = d.date === today
            const hasTodo = items.some((i) => i.date === d.date && i.booking === 'todo')

            return (
              <button
                key={d.date}
                onClick={() => jump(d.date)}
                className={`shrink-0 w-[84px] py-1.5 px-2 rounded-xl border text-center transition active:scale-95 ${
                  isToday
                    ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                    : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono leading-none mb-0.5">
                  <span className={isToday ? 'text-slate-300' : 'text-slate-400'}>
                    {new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short' })}
                  </span>
                  {isToday ? (
                    <span className="size-1.5 rounded-full bg-amber-400"></span>
                  ) : hasTodo ? (
                    <span className="size-1.5 rounded-full bg-amber-500"></span>
                  ) : null}
                </div>
                <p className="text-xs font-bold leading-tight">Day {d.n}</p>
                <p className={`text-[10px] mt-0.5 leading-none ${isToday ? 'text-slate-300' : count ? 'text-slate-600' : 'text-slate-400'}`}>
                  {count ? `${count} stop${count > 1 ? 's' : ''}` : 'free'}
                </p>
              </button>
            )
          })}
        </div>
      </nav>

      {/* 3. DAY-BY-DAY SECTIONS */}
      {days.map((d) => {
        const list = items.filter((i) => i.date === d.date).sort(byTime)
        const dayCost = list.reduce((s, i) => s + (Number(i.cost) || 0), 0)
        const isCollapsed = collapsed.has(d.date)
        const title = trip.dayTitles?.[d.date]
        const isToday = d.date === today
        const a = ai[d.date]

        return (
          <section
            key={d.date}
            id={`day-${d.date}`}
            className={`scroll-mt-20 rounded-3xl bg-white border shadow-sm overflow-hidden transition ${
              isToday ? 'border-amber-400 ring-2 ring-amber-400/20' : 'border-slate-200'
            }`}
          >
            {/* Day Header */}
            <header className="flex items-start gap-3 p-4 pb-3">
              {/* Day Badge */}
              <div
                className={`size-11 shrink-0 rounded-2xl grid place-items-center text-center leading-none ${
                  isToday ? 'bg-amber-400 text-slate-950 font-black shadow-xs' : 'bg-slate-900 text-white font-bold'
                }`}
              >
                <span className="text-[9px] font-mono uppercase tracking-wider opacity-75">Day</span>
                <span className="text-base font-extrabold -mt-0.5">{d.n}</span>
              </div>

              {/* Title & Metadata */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span className="font-medium">
                    {new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
                  </span>
                  {isToday && (
                    <span className="rounded bg-amber-100 text-amber-900 px-1.5 py-0.5 text-[10px] font-extrabold font-mono">
                      TODAY
                    </span>
                  )}
                </div>

                {/* Inline Title Editor */}
                {titleEdit === d.date ? (
                  <form
                    className="flex items-center gap-1.5 mt-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      saveTitle(d.date, e.target.t.value)
                      setTitleEdit(null)
                    }}
                  >
                    <input
                      name="t"
                      autoFocus
                      defaultValue={title || ''}
                      maxLength={50}
                      placeholder="e.g. Jungle day in Dandeli"
                      className="input flex-1 min-w-0 py-1 text-xs"
                    />
                    <button type="submit" className="btn shrink-0 py-1 px-3 text-xs">Save</button>
                    <button type="button" onClick={() => setTitleEdit(null)} className="btn-ghost shrink-0 py-1 px-2 text-xs">✕</button>
                  </form>
                ) : (
                  <button
                    className="text-left font-bold text-slate-900 hover:text-slate-700 text-sm mt-0.5 break-words block w-full leading-snug"
                    onClick={() => setTitleEdit(d.date)}
                  >
                    {title || <span className="text-slate-400 font-normal">+ Add a title for Day {d.n}</span>}
                  </button>
                )}

                {list.length > 0 && <DaySummary list={list} cost={dayCost} />}
              </div>

              {/* Collapse/Expand */}
              <button
                aria-label={isCollapsed ? `Expand day ${d.n}` : `Collapse day ${d.n}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggleDay(d.date)}
                className="size-8 shrink-0 grid place-items-center rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 text-xs font-bold transition"
              >
                {isCollapsed ? '▾' : '▴'}
              </button>
            </header>

            {/* Day Stops Content */}
            {!isCollapsed && (
              <div className="px-4 pb-4 pt-1 space-y-3">
                {/* Empty State */}
                {list.length === 0 && editing?.date !== d.date && (
                  <div className="rounded-2xl border-2 border-dashed border-slate-200 p-4 text-center space-y-2">
                    <p className="text-xs text-slate-500 font-medium">Nothing planned yet 🌴</p>
                    <div className="flex justify-center gap-2">
                      <button
                        className="btn text-xs py-1.5 px-3.5"
                        onClick={() => setEditing({ date: d.date })}
                      >
                        + Add stop
                      </button>
                      {aiAvailable() && (
                        <button
                          disabled={a?.busy}
                          onClick={() => runAI(d, list, 'stops')}
                          className="btn-ghost text-xs py-1.5 px-3"
                        >
                          {a?.busy ? 'Checking…' : 'Suggest stops'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {reordering === d.date && (
                  <ReorderList list={list} onCancel={() => setReordering(null)} onSave={saveOrder} />
                )}

                {/* Stops Timeline */}
                <ol className={`relative space-y-1 ${reordering === d.date ? 'hidden' : ''}`}>
                  {list.map((i, idx) => {
                    const [, icon, label] = kindOf(i.kind)
                    const next = list[idx + 1]
                    const meta = KIND_STYLE[i.kind] || KIND_STYLE.place

                    if (editing?.id === i.id) {
                      return (
                        <li key={i.id} className="py-1">
                          <StopForm
                            initial={i}
                            days={days}
                            onCancel={() => setEditing(null)}
                            onSave={(v) => {
                              update(tripId, 'plan', i.id, v)
                              setEditing(null)
                            }}
                          />
                        </li>
                      )
                    }

                    return (
                      <li key={i.id} className="relative">
                        <div className="flex items-start gap-2.5">
                          {/* Left Rail: Time & Duration */}
                          <div className="w-12 shrink-0 pt-2 text-right font-mono">
                            <p className="text-xs font-bold text-slate-800 leading-tight tabular-nums">
                              {i.time || '—'}
                            </p>
                            {i.duration && (
                              <p className="text-[10px] text-slate-400 leading-none mt-0.5">{i.duration}</p>
                            )}
                          </div>

                          {/* Center Node Icon */}
                          <div className="flex flex-col items-center shrink-0 pt-0.5">
                            <div className={`size-8 rounded-xl flex items-center justify-center text-sm shadow-xs ${meta.dot}`} title={label}>
                              {icon}
                            </div>
                            {next && <div className="w-0.5 bg-slate-200 flex-1 my-1 min-h-[16px]" aria-hidden />}
                          </div>

                          {/* Stop Card */}
                          <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200/90 shadow-xs p-3.5 mb-2 hover:border-slate-300 transition-all">
                            {/* Card Header */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                  <span className={`text-[10px] uppercase font-mono font-semibold px-1.5 py-0.5 rounded border ${meta.badge}`}>
                                    {label}
                                  </span>
                                  {i.booking === 'todo' && (
                                    <span className="text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200 px-1.5 py-0.5 rounded">
                                      🎟️ To book
                                    </span>
                                  )}
                                  {i.booking === 'booked' && (
                                    <span className="text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded font-mono truncate max-w-[140px]">
                                      ✓ Booked{i.bookingRef ? ` #${i.bookingRef}` : ''}
                                    </span>
                                  )}
                                </div>
                                <h4 className="font-bold text-slate-900 text-sm leading-snug break-words">
                                  {i.title}
                                </h4>
                              </div>

                              {/* Actions */}
                              <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                  aria-label={`Edit ${i.title}`}
                                  className="size-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center text-xs transition"
                                  onClick={() => setEditing(i)}
                                >
                                  ✎
                                </button>
                                <button
                                  aria-label={`Delete ${i.title}`}
                                  className="size-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center text-xs transition"
                                  onClick={() => setDeletingItem(i)}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>

                            {/* Location Link */}
                            {i.place && (
                              <div className="mt-1 text-xs text-slate-500 break-words flex items-center gap-1">
                                <MapLink place={i.place} />
                              </div>
                            )}

                            {/* Notes */}
                            {i.notes && (
                              <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100 mt-2 whitespace-pre-wrap break-words leading-relaxed">
                                {i.notes}
                              </p>
                            )}

                            {/* Footer Badges & Actions */}
                            <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5 pt-2 border-t border-slate-100 text-xs">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {Number(i.cost) > 0 ? (
                                  <span className="font-mono text-slate-600 text-[11px] bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                                    ≈ {inr(i.cost)}/ea
                                  </span>
                                ) : (
                                  <span className="text-slate-400 text-[11px] px-1">Free</span>
                                )}

                                {setTab && i.place && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      sessionStorage.setItem('yatra:map_focus', i.id)
                                      setTab('map')
                                    }}
                                    className="text-[11px] text-teal-700 font-semibold hover:underline"
                                  >
                                    Map pin →
                                  </button>
                                )}
                              </div>

                              <div className="flex items-center gap-1">
                                {visited[i.id] ? (
                                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                    ✓ Visited {visited[i.id].rating ? '★'.repeat(visited[i.id].rating) : ''}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={marking[i.id] === 'busy'}
                                    onClick={() => markVisited(i)}
                                    className="text-[11px] font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-2 py-0.5 rounded-full transition active:scale-95"
                                  >
                                    {marking[i.id] === 'busy' ? 'Saving…' : '✓ Mark visited'}
                                  </button>
                                )}
                              </div>
                            </div>

                            {marking[i.id] && marking[i.id] !== 'busy' && (
                              <p className="text-[11px] text-rose-600 mt-1">{marking[i.id]}</p>
                            )}
                          </div>
                        </div>

                        {/* Transit Leg */}
                        {next && (
                          <div className="ml-14 pl-4 py-1 -mt-1 mb-1">
                            <Leg from={i} to={next} />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>

                {/* Inline Add Stop Form */}
                {editing?.date === d.date && !editing.id && (
                  <div className="pt-2">
                    <StopForm
                      initial={{ date: d.date }}
                      days={days}
                      onCancel={() => setEditing(null)}
                      onSave={(v) => {
                        add(tripId, 'plan', v)
                        setEditing(null)
                      }}
                    />
                  </div>
                )}

                {/* Bottom Day Actions */}
                {list.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-slate-100 flex items-center gap-2">
                    <button
                      className="btn flex-1 text-xs py-2 shadow-xs font-semibold"
                      onClick={() => setEditing({ date: d.date })}
                    >
                      + Add stop
                    </button>
                    {list.length > 1 && reordering !== d.date && (
                      <button
                        className="btn-ghost text-xs py-2 px-3 font-medium shrink-0"
                        onClick={() => { setEditing(null); setReordering(d.date) }}
                        title="Rearrange the order of stops"
                      >
                        ⇅ Reorder
                      </button>
                    )}
                    {aiAvailable() && (
                      <button
                        disabled={a?.busy}
                        onClick={() => runAI(d, list, 'needs')}
                        className="btn-ghost text-xs py-2 px-3 font-medium shrink-0"
                      >
                        {a?.busy && a.mode === 'needs' ? 'Checking…' : '🎒 Carry & prep'}
                      </button>
                    )}
                    {aiAvailable() && (
                      <button
                        disabled={a?.busy}
                        onClick={() => runAI(d, list, 'stops')}
                        className="btn-ghost text-xs py-2 px-3 font-medium shrink-0"
                      >
                        {a?.busy && a.mode === 'stops' ? 'Thinking…' : '💡 Ideas'}
                      </button>
                    )}
                  </div>
                )}

                {/* Practical Day Checklist & Tips */}
                {a?.err && <p className="text-xs text-rose-600 mt-2">{a.err}</p>}
                {a?.data && a.mode === 'needs' && (
                  <Needs data={a.data} packed={packed} onAdd={addToPacking} onClose={() => setAi((x) => ({ ...x, [d.date]: null }))} />
                )}
                {a?.data && a.mode === 'stops' && (
                  <Suggestions
                    stops={a.data.stops || []}
                    existing={new Set(list.map((i) => i.title.toLowerCase()))}
                    onAdd={(s, when) => addStop({ ...s, time: when.time, duration: when.duration || s.duration }, when.date)}
                    days={days}
                    date={d.date}
                    suggestTime={(date) => nextFreeTime(items, date)}
                    onClose={() => setAi((x) => ({ ...x, [d.date]: null }))}
                  />
                )}
              </div>
            )}
          </section>
        )
      })}

      {/* 4. SHARE ITINERARY MODAL */}
      {shareOpen && (
        <ShareItinerary
          trip={trip}
          days={days}
          items={items}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* 5. DELETE STOP CONFIRMATION */}
      <ConfirmDialog
        isOpen={!!deletingItem}
        title="Delete stop?"
        message={`Delete "${deletingItem?.title}" from the plan?`}
        onConfirm={() => {
          remove(tripId, 'plan', deletingItem.id)
          setDeletingItem(null)
        }}
        onCancel={() => setDeletingItem(null)}
      />
    </div>
  )
}

// Day Summary: e.g. "4 stops · 🚗 62 km · 1 h 40 min · ≈ ₹2,100/person"
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

  const parts = [`${list.length} stop${list.length > 1 ? 's' : ''}`]
  if (drive?.km) parts.push(`🚗 ${drive.km} km (${fmtMin(drive.min)})`)
  if (cost) parts.push(`≈ ${inr(cost)}/ea`)

  return (
    <p className="mt-1 text-xs text-slate-500 leading-relaxed">
      {parts.join(' · ')}
    </p>
  )
}

// Transit Leg between consecutive stops
function Leg({ from, to }) {
  const [r, setR] = useState(undefined)
  const ready = hasCoords(from) && hasCoords(to)

  useEffect(() => {
    let live = true
    if (ready) driveTime(from, to).then((v) => live && setR(v))
    return () => { live = false }
  }, [ready, from.lat, from.lng, to.lat, to.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return <div className="border-l-2 border-dashed border-slate-200 h-3 ml-0.5" aria-hidden />
  }

  const start = toMin(from.time)
  const end = toMin(to.time)
  const free = start != null && end != null ? end - (start + parseDuration(from.duration)) : null
  const tight = r && free != null && free < r.min

  return (
    <div className="border-l-2 border-dashed border-slate-300 pl-3 py-1">
      {r === undefined && <span className="text-slate-400 font-mono text-[11px]">Checking drive time…</span>}
      {r === null && <span className="text-slate-400 font-mono text-[11px]">No driving route mapped</span>}
      {r && (
        <span className={`inline-flex flex-wrap items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded-lg ${
          tight ? 'bg-amber-100 text-amber-950 font-bold border border-amber-300' : 'text-slate-500 bg-slate-50 border border-slate-200'
        }`}>
          <span>🚗 {r.km < 1 ? `${Math.round(r.km * 1000)} m` : `${r.km} km`} · {fmtMin(r.min)}</span>
          {tight && (
            <span className="text-amber-800 font-bold">
              (⚠️ {free <= 0 ? 'no buffer' : `${fmtMin(free)} buffer`})
            </span>
          )}
        </span>
      )}
    </div>
  )
}

// Stop Form: 2-column layout preventing iOS time-picker squashing
// Rearrange a day's stops with up/down buttons (more reliable than dragging on phones). Shows the
// time each stop will get, since time slots stay put and the stops move between them.
function ReorderList({ list, onSave, onCancel }) {
  const [order, setOrder] = useState(list)
  const [saving, setSaving] = useState(false)
  const slots = list.map((i) => i.time || '').sort((a, b) => (a || '99').localeCompare(b || '99'))
  const move = (k, dir) => {
    const j = k + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    const tmp = next[k]
    next[k] = next[j]
    next[j] = tmp
    setOrder(next)
  }
  const changed = order.some((i, k) => i.id !== list[k].id)
  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-3 space-y-2">
      <div>
        <p className="text-sm font-semibold text-slate-900">⇅ Rearrange stops</p>
        <p className="text-[11px] text-slate-500">Times stay in place — stops move between them.</p>
      </div>
      <ol className="space-y-1.5">
        {order.map((i, k) => {
          const [, icon] = kindOf(i.kind)
          return (
            <li key={i.id} className="flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-2 py-1.5">
              <span className="w-11 shrink-0 text-xs font-mono font-semibold text-teal-800 tabular-nums">{slots[k] || '—'}</span>
              <span aria-hidden className="text-base">{icon}</span>
              <span className="flex-1 min-w-0 truncate text-sm">{i.title}</span>
              <button type="button" aria-label={`Move ${i.title} up`} disabled={k === 0} onClick={() => move(k, -1)}
                className="size-9 grid place-items-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-30 active:bg-slate-100">▲</button>
              <button type="button" aria-label={`Move ${i.title} down`} disabled={k === order.length - 1} onClick={() => move(k, 1)}
                className="size-9 grid place-items-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-30 active:bg-slate-100">▼</button>
            </li>
          )
        })}
      </ol>
      <div className="flex gap-2 pt-1">
        <button type="button" className="btn-ghost flex-1 text-xs py-2" onClick={onCancel}>Cancel</button>
        <button type="button" disabled={!changed || saving} className="btn flex-1 text-xs py-2"
          onClick={async () => { setSaving(true); await onSave(order) }}>{saving ? 'Saving…' : 'Save order'}</button>
      </div>
    </div>
  )
}

function StopForm({ initial, days, onSave, onCancel }) {
  const [v, setV] = useState({
    kind: 'place',
    time: '',
    duration: '',
    title: '',
    place: '',
    notes: '',
    cost: '',
    booking: 'none',
    bookingRef: '',
    ...initial,
  })

  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })

  function submit(e) {
    e.preventDefault()
    const { id, createdAt, lat, lng, ...rest } = v
    const out = {
      ...rest,
      title: rest.title.trim(),
      cost: Number(rest.cost) || 0,
      bookingRef: rest.booking === 'booked' ? (rest.bookingRef || '').trim() : '',
    }
    if (initial.place && initial.place !== rest.place) {
      out.lat = null
      out.lng = null
    }
    onSave(out)
  }

  return (
    <form className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200" onSubmit={submit}>
      <div className="flex items-center justify-between pb-1 border-b border-slate-200">
        <h4 className="font-bold text-xs text-slate-800">
          {initial.id ? 'Edit Stop' : 'Add New Stop'}
        </h4>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700 text-xs font-bold">✕</button>
      </div>

      {/* Category Selection */}
      <div className="flex flex-wrap gap-1">
        {KINDS.map(([k, icon, label]) => (
          <button
            type="button"
            key={k}
            onClick={() => setV({ ...v, kind: k })}
            className={`rounded-xl px-2.5 py-1 text-xs font-medium border transition ${
              v.kind === k
                ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      <input
        required
        autoFocus
        className="input text-xs"
        placeholder="Stop title (e.g. Om Beach, Scuba diving, Namaste Cafe…)"
        value={v.title}
        onChange={set('title')}
      />

      {/* Time & Duration: 2 spacious columns */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[11px] font-medium text-slate-600">
          Time
          <input
            type="time"
            className="input mt-1 text-xs font-mono"
            value={v.time}
            onChange={set('time')}
          />
        </label>
        <label className="block text-[11px] font-medium text-slate-600">
          Duration
          <input
            className="input mt-1 text-xs"
            placeholder="e.g. 2h"
            value={v.duration}
            onChange={set('duration')}
          />
        </label>
      </div>

      {/* Cost & Location */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[11px] font-medium text-slate-600">
          Cost / person
          <input
            className="input mt-1 text-xs font-mono"
            inputMode="numeric"
            placeholder="₹ per person"
            value={v.cost || ''}
            onChange={(e) => setV({ ...v, cost: e.target.value.replace(/[^\d]/g, '') })}
          />
        </label>
        <label className="block text-[11px] font-medium text-slate-600">
          Location
          <input
            className="input mt-1 text-xs"
            placeholder="Place or Maps link"
            value={v.place}
            onChange={set('place')}
          />
        </label>
      </div>

      {initial.id && (
        <label className="block text-xs font-medium text-slate-600">
          Day
          <select className="input mt-1 text-xs" value={v.date} onChange={set('date')}>
            {days.map((d) => (
              <option key={d.date} value={d.date}>
                {dayLabel(d)}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Booking Status */}
      <div>
        <p className="text-xs font-medium text-slate-600 mb-1">Booking</p>
        <div className="grid grid-cols-3 bg-slate-200/70 rounded-xl p-1 text-xs font-medium gap-0.5">
          {[
            ['none', 'Not needed'],
            ['todo', '🎟️ To book'],
            ['booked', '✓ Booked'],
          ].map(([k, l]) => (
            <button
              type="button"
              key={k}
              onClick={() => setV({ ...v, booking: k })}
              className={`py-1.5 rounded-lg transition ${
                v.booking === k ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        {v.booking === 'booked' && (
          <input
            className="input mt-2 text-xs font-mono"
            placeholder="Booking ID / PNR (optional)"
            value={v.bookingRef || ''}
            onChange={set('bookingRef')}
          />
        )}
      </div>

      <textarea
        className="input text-xs"
        rows="2"
        placeholder="Notes (contacts, what to bring, cash-only...)"
        value={v.notes}
        onChange={set('notes')}
      />

      <div className="flex gap-2 pt-1">
        <button type="button" className="btn-ghost flex-1 text-xs py-2" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn flex-1 text-xs py-2">
          {initial.id ? 'Save changes' : 'Add stop'}
        </button>
      </div>
    </form>
  )
}

// Share Itinerary Modal
function ShareItinerary({ trip, days, items, onClose }) {
  const [copied, setCopied] = useState(false)
  const lines = [`🗓️ *${trip.name}* — itinerary`]
  if (trip.destinations?.length) lines.push(trip.destinations.join(' → '))

  for (const d of days) {
    const list = items.filter((i) => i.date === d.date).sort(byTime)
    const title = trip.dayTitles?.[d.date]
    lines.push('', `*Day ${d.n} · ${new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}*${title ? ` — ${title}` : ''}`)
    if (!list.length) lines.push('Free day 🌴')
    for (const i of list) {
      lines.push(`${i.time || '•'} ${kindOf(i.kind)[1]} ${i.title}${i.booking === 'todo' ? ' (🎟️ to book)' : i.booking === 'booked' ? ' ✓' : ''}`)
    }
  }
  lines.push('', `Plan together on Yatra 👉 ${location.origin}/#/t/${trip.id}`)
  const text = lines.join('\n')

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-sm w-full p-4 space-y-3 shadow-2xl">
        <div className="flex justify-between items-center pb-1 border-b border-slate-100">
          <p className="text-sm font-bold text-slate-900">Share Itinerary</p>
          <button aria-label="Close" className="text-slate-400 hover:text-slate-700 font-bold" onClick={onClose}>✕</button>
        </div>
        <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap text-xs text-slate-600 bg-slate-50 rounded-2xl p-3 border border-slate-200 font-mono">
          {text}
        </pre>
        <div className="flex gap-2 pt-1">
          <WhatsAppButton className="flex-1 text-xs py-2" label="WhatsApp" text={text} />
          <button
            className="btn-ghost flex-1 text-xs py-2"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              } catch {}
            }}
          >
            {copied ? 'Copied ✓' : 'Copy text'}
          </button>
        </div>
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

const PACES = [
  ['relaxed', 'Relaxed', '2–3 stops/day, late starts'],
  ['balanced', 'Balanced', '3–4 stops/day'],
  ['packed', 'Packed', '5+ stops, early starts'],
]
const INTERESTS = ['Beaches', 'Food', 'Heritage', 'Nature', 'Adventure', 'Nightlife', 'Shopping', 'Temples']

function TripPlanner({ trip, days, items, onAdd, onDone }) {
  const [f, setF] = useState({
    where: trip.destinations?.length ? trip.destinations.join(', then ') : trip.name || '',
    from: '',
    pace: 'balanced',
    interests: ['Food', 'Beaches'],
    notes: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)

  const toggleInterest = (x) => setF({
    ...f,
    interests: f.interests.includes(x) ? f.interests.filter((i) => i !== x) : [...f.interests, x],
  })

  async function generate(e) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const existing = days.map((d) => {
      const l = items.filter((i) => i.date === d.date).sort(byTime)
      return `Day ${d.n} (${d.date}): ${l.length ? l.map((i) => `${i.time || 'anytime'} ${i.title}`).join('; ') : 'nothing yet'}`
    }).join('\n')

    try {
      const out = await askJSON({
        system: 'You are an expert Indian travel planner. Build realistic day-by-day itineraries with real, well-known places only (never invent places), sensible travel times between stops, meal stops, and an overnight stay each night. Keep existing stops and plan around them; do not repeat them.',
        parts: [`Destination: ${f.where}
Dates: ${trip.start} to ${trip.end} (${days.length} days)${f.from ? `\nStarting from: ${f.from}` : ''}
Pace: ${f.pace}
Interests: ${f.interests.join(', ') || 'a good mix'}${f.notes ? `\nNotes: ${f.notes}` : ''}
Already planned:
${existing}

Return new stops for each day 1..${days.length}. Costs in INR per person.`],
        schema: {
          type: 'OBJECT',
          properties: { days: { type: 'ARRAY', items: { type: 'OBJECT', properties: { day: { type: 'INTEGER' }, theme: { type: 'STRING' }, stops: { type: 'ARRAY', items: STOP_SCHEMA } }, required: ['day', 'stops'] } } },
          required: ['days'],
        },
        temperature: 0.5,
        thinking: 'low',
      })

      const taken = items.map((i) => i.title.toLowerCase().trim()).filter((t) => t.length >= 4)
      const isDup = (title) => {
        const t = title.toLowerCase()
        return taken.some((x) => t.includes(x) || x.includes(t))
      }

      setDraft(days.map((d) => {
        const got = (out.days || []).find((x) => x.day === d.n)
        return {
          ...d,
          theme: got?.theme || '',
          stops: (got?.stops || []).filter((s) => s.title && !isDup(s.title)).sort(byTime).map((s) => ({ ...s, keep: true })),
        }
      }))
    } catch (e2) {
      setErr(e2.message)
    }
    setBusy(false)
  }

  const count = draft ? draft.reduce((n, d) => n + d.stops.filter((s) => s.keep).length, 0) : 0
  const toggle = (di, si) => setDraft(draft.map((d, i) => (i !== di ? d : { ...d, stops: d.stops.map((s, j) => (j !== si ? s : { ...s, keep: !s.keep })) })))

  async function addAll() {
    setSaving(true)
    for (const d of draft) for (const s of d.stops) if (s.keep) await onAdd(s, d.date)
    setSaving(false)
    onDone()
  }

  if (draft) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-xs">
        <div className="flex justify-between items-center pb-1 border-b border-slate-200">
          <p className="font-bold text-slate-900">Draft Itinerary</p>
          <button className="text-teal-700 underline font-semibold" onClick={() => setDraft(null)}>
            Change preferences
          </button>
        </div>
        <p className="text-slate-500">Uncheck any stops you don't want, then add the rest.</p>

        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {draft.map((d, di) => (
            <div key={d.date} className="bg-white p-3 rounded-xl border border-slate-200">
              <p className="font-bold text-slate-800">{dayLabel(d)}{d.theme ? ` — ${d.theme}` : ''}</p>
              {d.stops.length === 0 ? (
                <p className="text-slate-400 mt-1">No new stops.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {d.stops.map((s, si) => (
                    <li key={si}>
                      <label className="flex gap-2 items-start cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 accent-slate-900"
                          checked={s.keep}
                          onChange={() => toggle(di, si)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-900 break-words">{s.title}</span>
                            <span className="font-mono text-slate-500 text-[11px]">{s.time}</span>
                          </div>
                          <p className="text-slate-500 text-[11px] break-words">{s.why}</p>
                        </div>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <button
          disabled={!count || saving}
          onClick={addAll}
          className="btn w-full py-2.5 text-xs font-semibold"
        >
          {saving ? 'Adding…' : `Add ${count} stop${count === 1 ? '' : 's'} to itinerary`}
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={generate} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-xs">
      <div className="flex justify-between items-center pb-1 border-b border-slate-200">
        <p className="font-bold text-slate-900">Plan Entire Trip</p>
        <button type="button" onClick={onDone} className="text-slate-400 hover:text-slate-700 font-bold">✕</button>
      </div>

      <label className="block text-slate-600 font-medium">
        Destination region
        <input
          required
          className="input mt-1 text-xs"
          value={f.where}
          onChange={(e) => setF({ ...f, where: e.target.value })}
          placeholder="e.g. Gokarna and Murudeshwar"
        />
      </label>

      <div>
        <p className="text-slate-600 font-medium mb-1">Pace</p>
        <div className="grid grid-cols-3 gap-1.5">
          {PACES.map(([k, l]) => (
            <button
              type="button"
              key={k}
              onClick={() => setF({ ...f, pace: k })}
              className={`rounded-xl py-1.5 text-xs border font-medium ${
                f.pace === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-slate-600 font-medium mb-1">Interests</p>
        <div className="flex flex-wrap gap-1">
          {INTERESTS.map((x) => (
            <button
              type="button"
              key={x}
              onClick={() => toggleInterest(x)}
              className={`rounded-xl px-2.5 py-1 text-xs border ${
                f.interests.includes(x)
                  ? 'bg-slate-900 text-white border-slate-900 font-medium'
                  : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              {x}
            </button>
          ))}
        </div>
      </div>

      <textarea
        className="input text-xs"
        rows="2"
        value={f.notes}
        onChange={(e) => setF({ ...f, notes: e.target.value })}
        placeholder="Group preferences (budget, dietary, must-see places...)"
      />

      {err && <p className="text-rose-600">{err}</p>}
      <button disabled={busy} className="btn w-full py-2.5 text-xs font-semibold">
        {busy ? 'Drafting itinerary…' : `Draft ${days.length} days`}
      </button>
    </form>
  )
}

// Practical Day Notes & Packing
function Needs({ data, packed, onAdd, onClose }) {
  return (
    <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-xs">
      <div className="flex justify-between items-center pb-1 border-b border-slate-200">
        <p className="font-bold text-slate-900">Day Practical Notes & Essentials</p>
        <button aria-label="Close" className="text-slate-400 hover:text-slate-700 font-bold" onClick={onClose}>✕</button>
      </div>

      {data.essentials?.length > 0 && (
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] uppercase text-slate-400 font-semibold tracking-wider">Things to carry</p>
          <ul className="space-y-1.5">
            {data.essentials.map((e, i) => {
              const done = packed.has(e.item.toLowerCase())
              return (
                <li key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200 gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 break-words">{e.item}</p>
                    <p className="text-[11px] text-slate-500 break-words">{e.why}</p>
                  </div>
                  <button
                    disabled={done}
                    onClick={() => onAdd(e)}
                    className="text-[11px] shrink-0 rounded-lg border border-teal-700 text-teal-700 bg-white hover:bg-teal-50 px-2.5 py-1 font-semibold disabled:opacity-40 disabled:border-slate-300 disabled:text-slate-400"
                  >
                    {done ? 'In packing ✓' : '+ Packing'}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {data.prepare?.length > 0 && (
        <div className="space-y-1">
          <p className="font-mono text-[10px] uppercase text-slate-400 font-semibold tracking-wider">Before you go</p>
          <ul className="list-disc pl-4 space-y-0.5 text-slate-700">
            {data.prepare.map((t, i) => <li key={i} className="break-words">{t}</li>)}
          </ul>
        </div>
      )}

      {data.tips?.length > 0 && (
        <div className="space-y-1">
          <p className="font-mono text-[10px] uppercase text-slate-400 font-semibold tracking-wider">Local timing & tips</p>
          <ul className="list-disc pl-4 space-y-0.5 text-slate-700">
            {data.tips.map((t, i) => <li key={i} className="break-words">{t}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

// Stop Recommendations
function Suggestions({ stops, existing, onAdd, onClose, days, date, suggestTime }) {
  const [added, setAdded] = useState(new Set())
  const [picking, setPicking] = useState(null) // index of the idea whose day/time is being chosen

  return (
    <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
      <div className="flex justify-between items-center pb-1 border-b border-slate-200">
        <p className="font-bold text-slate-900">Stop Recommendations</p>
        <button aria-label="Close" className="text-slate-400 hover:text-slate-700 font-bold" onClick={onClose}>✕</button>
      </div>

      {stops.length === 0 ? (
        <p className="text-slate-500">No suggestions right now.</p>
      ) : (
        <div className="space-y-1.5">
          {stops.map((s, i) => {
            const done = added.has(i) || existing.has(s.title.toLowerCase())
            return (
              <div key={i} className="p-2.5 rounded-xl bg-white border border-slate-200">
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-900 break-words">{s.title}</span>
                    <span className="font-mono text-slate-400 text-[11px]">{s.time}</span>
                  </div>
                  <p className="text-slate-500 text-[11px] break-words">
                    {s.why}{s.cost ? ` · ≈ ${inr(s.cost)}/ea` : ''}
                  </p>
                </div>
                <button
                  disabled={done}
                  onClick={() => setPicking(picking === i ? null : i)}
                  className="text-[11px] shrink-0 rounded-lg border border-teal-700 text-teal-700 bg-white hover:bg-teal-50 px-2.5 py-1 font-semibold disabled:opacity-40 disabled:border-slate-300 disabled:text-slate-400"
                >
                  {done ? 'Added ✓' : picking === i ? 'Close' : '+ Add'}
                </button>
              </div>
              {picking === i && !done && (
                <AddToPlan title={s.title} days={days} initialDate={date} initialTime={s.time} initialDuration={s.duration}
                  suggestTime={suggestTime} onCancel={() => setPicking(null)}
                  onConfirm={async (when) => { await onAdd(s, when); setAdded(new Set(added).add(i)); setPicking(null) }} />
              )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
