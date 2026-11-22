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

const KIND_META = {
  place: { label: 'Sight', tag: 'bg-emerald-50 text-emerald-800 border-emerald-200/80', dot: 'bg-emerald-600 ring-emerald-100' },
  food: { label: 'Food', tag: 'bg-rose-50 text-rose-800 border-rose-200/80', dot: 'bg-rose-600 ring-rose-100' },
  activity: { label: 'Activity', tag: 'bg-amber-50 text-amber-800 border-amber-200/80', dot: 'bg-amber-600 ring-amber-100' },
  stay: { label: 'Stay', tag: 'bg-indigo-50 text-indigo-800 border-indigo-200/80', dot: 'bg-indigo-600 ring-indigo-100' },
  travel: { label: 'Travel', tag: 'bg-slate-100 text-slate-800 border-slate-200', dot: 'bg-slate-600 ring-slate-100' },
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

  const [editing, setEditing] = useState(null) // { date } for new, or existing item
  const [deletingItem, setDeletingItem] = useState(null)
  const [marking, setMarking] = useState({})
  const [ai, setAi] = useState({}) // date -> { mode, busy, err, data }
  const [planner, setPlanner] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [bookingDrawerOpen, setBookingDrawerOpen] = useState(false)
  const [activeDayNotes, setActiveDayNotes] = useState(null) // day object for notes modal
  const [shareOpen, setShareOpen] = useState(false)
  const [destinationsOpen, setDestinationsOpen] = useState(false)
  const [titleEdit, setTitleEdit] = useState(null)
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [filterCat, setFilterCat] = useState('all')
  const [reordering, setReordering] = useState(null) // date of the day being rearranged

  // Save a new order: the day's time slots stay where they are and the stops move between them,
  // so moving the 16:00 fort to the top makes it the 09:00 stop. Durations travel with their stop.
  async function saveOrder(ordered) {
    const slots = ordered.map((i) => i.time || '').sort((a, b) => (a || '99').localeCompare(b || '99'))
    await Promise.all(ordered.map((i, k) => (i.time || '') === slots[k] && i.order === k
      ? null
      : update(tripId, 'plan', i.id, { time: slots[k], order: k })))
    setReordering(null)
  }

  const visited = Object.fromEntries(places.filter((p) => p.planId).map((p) => [p.planId, p]))
  const packed = new Set(packing.map((p) => (p.text || '').toLowerCase()))
  const totalCost = items.reduce((s, i) => s + (Number(i.cost) || 0), 0)
  const toBook = items.filter((i) => i.booking === 'todo').sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
  const today = ymd(new Date())
  const plannedDays = days.filter((d) => items.some((i) => i.date === d.date)).length
  const route = (trip.destinations || []).length ? trip.destinations : []

  // Automatic geocoding for route calculation and map display
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
            system: 'You are a practical Indian travel advisor. Return honest, specific items tied to the planned stops with no fluff.',
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
            system: 'You are a local Indian travel expert. Suggest real, specific places only with their towns.',
            parts: [`${ctx}\n\nSuggest up to 5 stops that fit smoothly around the existing schedule (good timing, nearby, mix of food and sights). Use real place names.`],
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

      {/* 1. EDITORIAL JOURNEY HEADER */}
      <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="p-4 space-y-3">
          {/* Route & Share Row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-slate-400">
                Itinerary · {days.length} Days
              </span>
              {route.length > 0 ? (
                <p className="font-semibold text-slate-900 text-sm sm:text-base leading-snug mt-0.5 break-words">
                  {route.join('  →  ')}
                </p>
              ) : (
                <p className="font-semibold text-slate-900 text-sm mt-0.5">
                  {trip.name || 'Trip Itinerary'}
                </p>
              )}
            </div>

            <button
              onClick={() => setShareOpen(true)}
              className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 active:scale-95 transition"
            >
              <span>↗</span>
              <span>Share</span>
            </button>
          </div>

          {/* Key Metric Chips */}
          <div className="grid grid-cols-4 gap-1.5 text-center pt-1 border-t border-slate-100">
            <div className="py-1 px-1">
              <p className="font-bold text-xs sm:text-sm text-slate-900 tabular-nums">{plannedDays}/{days.length}</p>
              <p className="text-[10px] text-slate-400">Days set</p>
            </div>
            <div className="py-1 px-1">
              <p className="font-bold text-xs sm:text-sm text-slate-900 tabular-nums">{items.length}</p>
              <p className="text-[10px] text-slate-400">Stops</p>
            </div>
            <div className="py-1 px-1">
              <p className="font-bold text-xs sm:text-sm text-slate-900 tabular-nums">{totalCost ? inr(totalCost) : '—'}</p>
              <p className="text-[10px] text-slate-400">Est. / person</p>
            </div>
            <button
              onClick={() => setBookingDrawerOpen(true)}
              className={`py-1 px-1 rounded-lg transition active:scale-95 ${toBook.length > 0 ? 'bg-amber-50 text-amber-900 border border-amber-200' : 'text-slate-400'}`}
            >
              <p className="font-bold text-xs sm:text-sm tabular-nums flex items-center justify-center gap-1">
                {toBook.length > 0 && <span className="size-1.5 rounded-full bg-amber-500 shrink-0"></span>}
                <span>{toBook.length}</span>
              </p>
              <p className="text-[10px]">To book</p>
            </button>
          </div>

          {/* Progress Strip */}
          <div className="h-1 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={plannedDays} aria-valuemax={days.length}>
            <div
              className="h-full bg-teal-700 rounded-full transition-all duration-300"
              style={{ width: `${days.length ? (plannedDays / days.length) * 100 : 0}%` }}
            />
          </div>

          {/* Utility Action Buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1 border-t border-slate-100">
            <button
              onClick={() => setDestinationsOpen(!destinationsOpen)}
              className={`py-2 px-2.5 rounded-xl border text-xs font-medium text-center truncate transition active:scale-95 ${destinationsOpen ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'}`}
            >
              📍 Destinations {route.length > 0 ? `(${route.length})` : ''}
            </button>

            {toBook.length > 0 ? (
              <button
                onClick={() => setBookingDrawerOpen(true)}
                className="py-2 px-2.5 rounded-xl border border-amber-200 bg-amber-50/70 hover:bg-amber-100 text-amber-900 text-xs font-semibold text-center truncate transition active:scale-95"
              >
                🎟️ {toBook.length} Bookings
              </button>
            ) : (
              <button
                onClick={() => setEditing({ date: days[0]?.date || today })}
                className="py-2 px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium text-center truncate transition active:scale-95"
              >
                + Add Stop
              </button>
            )}

            {aiAvailable() && (
              <button
                onClick={() => { setChatOpen(!chatOpen); setPlanner(false) }}
                className={`py-2 px-2.5 rounded-xl border text-xs font-medium text-center truncate transition active:scale-95 ${chatOpen ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'}`}
              >
                💬 Chat to plan
              </button>
            )}

            {setTab && items.length > 0 && (
              <button
                onClick={() => setTab('map')}
                className="py-2 px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium text-center truncate transition active:scale-95"
              >
                🗺️ See on map
              </button>
            )}
          </div>

          {/* Destinations Drawer (Collapsible) */}
          {destinationsOpen && (
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
          )}

          {/* Chat Assistant (Collapsible) */}
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

          {/* Full Planner Assistant (Collapsible) */}
          {planner && (
            <div className="pt-2 border-t border-slate-100">
              <TripPlanner trip={trip} days={days} items={items} onAdd={addStop} onDone={() => setPlanner(false)} />
            </div>
          )}
        </div>
      </section>

      {/* 2. CALENDAR DAY CHIP CAROUSEL (CLEAN, NO OVERLAP) */}
      <nav aria-label="Jump to day" className="bg-slate-50/90 rounded-2xl p-1.5 border border-slate-200/80">
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
                    ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
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

      {/* 3. OPTIONAL CATEGORY FILTER PILLS */}
      {items.length > 3 && (
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5 text-xs">
          <span className="text-[10px] font-mono uppercase text-slate-400 mr-1 shrink-0">Filter:</span>
          <button
            onClick={() => setFilterCat('all')}
            className={`px-2.5 py-1 rounded-lg font-medium shrink-0 transition ${filterCat === 'all' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            All ({items.length})
          </button>
          {KINDS.map(([k, icon, label]) => {
            const num = items.filter((i) => i.kind === k).length
            if (!num) return null
            return (
              <button
                key={k}
                onClick={() => setFilterCat(filterCat === k ? 'all' : k)}
                className={`px-2.5 py-1 rounded-lg font-medium shrink-0 flex items-center gap-1 transition ${
                  filterCat === k
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span>{icon}</span>
                <span>{label}</span>
                <span className="text-[10px] opacity-70 font-mono">({num})</span>
              </button>
            )
          })}
        </div>
      )}

      {/* 4. CHRONOLOGICAL DAY SECTIONS */}
      {days.map((d) => {
        const fullList = items.filter((i) => i.date === d.date).sort(byTime)
        const list = filterCat === 'all' ? fullList : fullList.filter((i) => i.kind === filterCat)
        const dayCost = fullList.reduce((s, i) => s + (Number(i.cost) || 0), 0)
        const isCollapsed = collapsed.has(d.date)
        const title = trip.dayTitles?.[d.date]
        const isToday = d.date === today
        const a = ai[d.date]

        return (
          <section
            key={d.date}
            id={`day-${d.date}`}
            className={`scroll-mt-24 rounded-2xl bg-white border shadow-xs overflow-hidden transition ${
              isToday ? 'border-slate-800' : 'border-slate-200/90'
            }`}
          >
            {/* Day Header */}
            <header className="flex items-start gap-3 p-4 pb-3">
              {/* Day Number Badge */}
              <div className={`size-11 shrink-0 rounded-xl grid place-items-center text-center leading-none ${
                isToday ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800 border border-slate-200'
              }`}>
                <span className="text-[9px] font-mono uppercase tracking-wider opacity-70">Day</span>
                <span className="text-base font-bold -mt-0.5">{d.n}</span>
              </div>

              {/* Title & Metadata */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span className="font-medium">
                    {new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
                  </span>
                  {isToday && (
                    <span className="rounded bg-amber-100 text-amber-800 px-1.5 py-0.2 text-[10px] font-bold font-mono">
                      TODAY
                    </span>
                  )}
                </div>

                {titleEdit === d.date ? (
                  <form
                    className="flex gap-1.5 mt-1"
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
                      className="input py-1 text-xs"
                    />
                    <button className="btn py-1 px-2.5 text-xs">Save</button>
                    <button type="button" onClick={() => setTitleEdit(null)} className="btn-ghost py-1 px-2 text-xs">✕</button>
                  </form>
                ) : (
                  <button
                    className="text-left font-semibold text-slate-900 hover:text-slate-700 text-sm mt-0.5 break-words block w-full"
                    onClick={() => setTitleEdit(d.date)}
                  >
                    {title || <span className="text-slate-400 font-normal">+ Add day theme or title</span>}
                  </button>
                )}

                {fullList.length > 0 && <DaySummary list={fullList} cost={dayCost} onOpenNotes={() => setActiveDayNotes(d)} />}
              </div>

              {/* Collapse/Expand Toggle */}
              <button
                aria-label={isCollapsed ? `Expand day ${d.n}` : `Collapse day ${d.n}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggleDay(d.date)}
                className="size-7 shrink-0 grid place-items-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 text-xs"
              >
                {isCollapsed ? '▼' : '▲'}
              </button>
            </header>

            {/* Day Stops Timeline */}
            {!isCollapsed && (
              <div className="px-4 pb-4 pt-1 space-y-2">

                {/* Empty State */}
                {fullList.length === 0 && editing?.date !== d.date && (
                  <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center space-y-2">
                    <p className="text-xs text-slate-500">Nothing scheduled for Day {d.n} yet.</p>
                    <div className="flex justify-center gap-2">
                      <button
                        className="btn text-xs py-1.5 px-3"
                        onClick={() => setEditing({ date: d.date })}
                      >
                        + Add stop
                      </button>
                      {aiAvailable() && (
                        <button
                          disabled={a?.busy}
                          onClick={() => runAI(d, fullList, 'stops')}
                          className="btn-ghost text-xs py-1.5 px-3"
                        >
                          {a?.busy ? 'Checking ideas…' : 'Suggest stops'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Filter Notice */}
                {filterCat !== 'all' && fullList.length > 0 && list.length === 0 && (
                  <p className="text-xs text-slate-400 italic py-2 text-center">
                    No {filterCat} stops on this day. (Showing filtered view)
                  </p>
                )}

                {reordering === d.date && (
                  <ReorderList list={fullList} onCancel={() => setReordering(null)} onSave={saveOrder} />
                )}

                {/* Timeline List */}
                <ol className={`relative space-y-0 ${reordering === d.date ? 'hidden' : ''}`}>
                  {list.map((i, idx) => {
                    const [, icon, label] = kindOf(i.kind)
                    const next = list[idx + 1]
                    const meta = KIND_META[i.kind] || KIND_META.place

                    if (editing?.id === i.id) {
                      return (
                        <li key={i.id} className="py-2">
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
                      <li key={i.id} className="relative group">
                        <div className="flex items-start gap-2.5">
                          {/* Time Column (Left Rail) */}
                          <div className="w-12 shrink-0 pt-0.5 text-right font-mono">
                            <p className="text-xs font-semibold text-slate-800 leading-tight">
                              {i.time || '—'}
                            </p>
                            {i.duration && (
                              <p className="text-[10px] text-slate-400 leading-none mt-0.5">{i.duration}</p>
                            )}
                          </div>

                          {/* Node Dot / Icon */}
                          <div className="flex flex-col items-center pt-1 shrink-0">
                            <span
                              className={`size-2.5 rounded-full ring-4 ${meta.dot} shrink-0`}
                              title={label}
                            />
                            {next ? <div className="w-px h-full bg-slate-200 mt-1 min-h-[24px]"></div> : null}
                          </div>

                          {/* Stop Details Card */}
                          <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200/90 shadow-2xs hover:border-slate-300 transition-all p-3 mb-1.5">
                            {/* Card Header: Tag, Title, Actions */}
                            <div className="flex items-start justify-between gap-1.5">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className={`text-[10px] uppercase font-mono font-semibold px-1.5 py-0.2 rounded border ${meta.tag}`}>
                                    {icon} {label}
                                  </span>
                                  {i.booking === 'todo' && (
                                    <span className="text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-200 px-1.5 py-0.2 rounded">
                                      🎟️ To book
                                    </span>
                                  )}
                                  {i.booking === 'booked' && (
                                    <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.2 rounded font-mono">
                                      ✓ Booked{i.bookingRef ? ` #${i.bookingRef}` : ''}
                                    </span>
                                  )}
                                </div>
                                <h4 className="font-semibold text-slate-900 text-sm leading-snug break-words">
                                  {i.title}
                                </h4>
                              </div>

                              {/* Edit & Delete Action Buttons */}
                              <div className="flex items-center gap-0.5 shrink-0 -mr-1 -mt-1">
                                <button
                                  aria-label={`Edit ${i.title}`}
                                  className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xs"
                                  onClick={() => setEditing(i)}
                                >
                                  ✎
                                </button>
                                <button
                                  aria-label={`Delete ${i.title}`}
                                  className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 text-xs"
                                  onClick={() => setDeletingItem(i)}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>

                            {/* Place / Map Link */}
                            {i.place && (
                              <div className="mt-1 text-xs text-slate-500 break-words flex items-center gap-1">
                                <MapLink place={i.place} />
                              </div>
                            )}

                            {/* Stop Notes */}
                            {i.notes && (
                              <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100 mt-2 whitespace-pre-wrap break-words">
                                {i.notes}
                              </p>
                            )}

                            {/* Card Footer Strip: Cost, Visited status */}
                            <div className="flex flex-wrap items-center justify-between gap-1.5 mt-2.5 pt-2 border-t border-slate-100 text-xs">
                              <div className="flex items-center gap-1.5">
                                {Number(i.cost) > 0 ? (
                                  <span className="font-mono text-slate-600 text-[11px]">
                                    ≈ {inr(i.cost)}/ea
                                  </span>
                                ) : (
                                  <span className="text-slate-400 text-[11px]">Free</span>
                                )}

                                {setTab && i.place && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      sessionStorage.setItem('yatra:map_focus', i.id)
                                      setTab('map')
                                    }}
                                    className="text-[11px] text-teal-700 font-medium hover:underline ml-1"
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
                                    className="text-[11px] font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-2 py-0.5 rounded-full active:scale-95 transition"
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

                        {/* Transit Leg Connector */}
                        {next && (
                          <div className="ml-12 pl-4 py-1">
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
                {fullList.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-slate-100 flex gap-2">
                    <button
                      className="btn-ghost flex-1 text-xs py-2"
                      onClick={() => setEditing({ date: d.date })}
                    >
                      + Add stop
                    </button>
                    {fullList.length > 1 && reordering !== d.date && (
                      <button
                        className="btn-ghost text-xs py-2 px-3"
                        onClick={() => { setEditing(null); setFilterCat('all'); setReordering(d.date) }}
                        title="Rearrange the order of stops"
                      >
                        ⇅ Reorder
                      </button>
                    )}
                    {aiAvailable() && (
                      <button
                        disabled={a?.busy}
                        onClick={() => runAI(d, fullList, 'needs')}
                        className="btn-ghost text-xs py-2 px-3"
                        title="Check essentials & tips for this day"
                      >
                        {a?.busy && a.mode === 'needs' ? 'Checking…' : 'Day notes'}
                      </button>
                    )}
                    {aiAvailable() && (
                      <button
                        disabled={a?.busy}
                        onClick={() => runAI(d, fullList, 'stops')}
                        className="btn-ghost text-xs py-2 px-3"
                        title="Suggest real stops fitting this day's timing"
                      >
                        {a?.busy && a.mode === 'stops' ? 'Thinking…' : 'Ideas'}
                      </button>
                    )}
                  </div>
                )}

                {/* AI Error or Response Sheets */}
                {a?.err && <p className="text-xs text-rose-600 mt-2">{a.err}</p>}
                {a?.data && a.mode === 'needs' && (
                  <Needs data={a.data} packed={packed} onAdd={addToPacking} onClose={() => setAi((x) => ({ ...x, [d.date]: null }))} />
                )}
                {a?.data && a.mode === 'stops' && (
                  <Suggestions
                    stops={a.data.stops || []}
                    existing={new Set(fullList.map((i) => i.title.toLowerCase()))}
                    onAdd={(s, when) => addStop({ ...s, time: when.time, duration: when.duration || s.duration }, when.date)}
                    days={days} date={d.date} suggestTime={(date) => nextFreeTime(items, date)}
                    onClose={() => setAi((x) => ({ ...x, [d.date]: null }))}
                  />
                )}
              </div>
            )}
          </section>
        )
      })}

      {/* 5. SLIDE-UP BOOKING HUB DRAWER */}
      {bookingDrawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-2xs z-40 flex flex-col justify-end p-2 sm:p-4"
          onClick={() => setBookingDrawerOpen(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md mx-auto p-5 space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between pb-2 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-sm text-slate-900">Trip Booking Hub</h3>
                <p className="text-xs text-slate-500">
                  {toBook.length > 0 ? `${toBook.length} pending reservations` : 'All bookings confirmed!'}
                </p>
              </div>
              <button
                onClick={() => setBookingDrawerOpen(false)}
                className="size-7 rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 grid place-items-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            {toBook.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 space-y-1">
                <p className="text-base">✅</p>
                <p className="font-semibold text-slate-800">No pending bookings</p>
                <p>All stops are marked as booked or don't require advance reservation.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {toBook.map((i) => {
                  const d = days.find((x) => x.date === i.date)
                  return (
                    <div key={i.id} className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] font-mono uppercase text-amber-800 font-semibold">
                            {d ? dayLabel(d) : i.date}{i.time ? ` · ${i.time}` : ''}
                          </span>
                          <h4 className="font-bold text-slate-900 text-xs mt-0.5 break-words">{i.title}</h4>
                          {i.place && <p className="text-[11px] text-slate-500 truncate">{i.place}</p>}
                        </div>
                        {i.cost > 0 && (
                          <span className="font-mono text-xs font-bold text-slate-800 shrink-0">
                            {inr(i.cost)}/ea
                          </span>
                        )}
                      </div>

                      {i.notes && (
                        <p className="text-xs text-amber-950 bg-white/70 p-2 rounded-lg border border-amber-150 whitespace-pre-wrap break-words">
                          {i.notes}
                        </p>
                      )}

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => {
                            setBookingDrawerOpen(false)
                            jump(i.date)
                            setEditing(i)
                          }}
                          className="btn-ghost flex-1 py-1.5 text-xs font-medium"
                        >
                          Edit details
                        </button>
                        <button
                          onClick={async () => {
                            const ref = window.prompt('Booking ID or PNR (optional):', '')
                            await update(tripId, 'plan', i.id, {
                              booking: 'booked',
                              bookingRef: (ref || '').trim(),
                            })
                          }}
                          className="btn flex-1 py-1.5 text-xs font-semibold"
                        >
                          ✓ Mark Booked
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <button
              onClick={() => setBookingDrawerOpen(false)}
              className="btn-ghost w-full py-2 text-xs"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* 6. SHARE ITINERARY MODAL */}
      {shareOpen && (
        <ShareItinerary
          trip={trip}
          days={days}
          items={items}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* 7. DELETE STOP CONFIRMATION */}
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

// "4 stops · 🚗 62 km · 1 h 40 min · ≈ ₹2,100/person"
function DaySummary({ list, cost, onOpenNotes }) {
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

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      <span>{list.length} stop{list.length > 1 ? 's' : ''}</span>
      {drive?.km ? (
        <>
          <span className="text-slate-300">·</span>
          <span>🚗 {drive.km} km ({fmtMin(drive.min)})</span>
        </>
      ) : null}
      {cost ? (
        <>
          <span className="text-slate-300">·</span>
          <span className="font-mono">≈ {inr(cost)}/ea</span>
        </>
      ) : null}
    </div>
  )
}

// Drive time between consecutive stops with tight schedule detection
function Leg({ from, to }) {
  const [r, setR] = useState(undefined)
  const ready = hasCoords(from) && hasCoords(to)

  useEffect(() => {
    let live = true
    if (ready) driveTime(from, to).then((v) => live && setR(v))
    return () => { live = false }
  }, [ready, from.lat, from.lng, to.lat, to.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return <div className="border-l border-dashed border-slate-200 h-3 ml-1" aria-hidden />
  }

  const start = toMin(from.time)
  const end = toMin(to.time)
  const free = start != null && end != null ? end - (start + parseDuration(from.duration)) : null
  const tight = r && free != null && free < r.min

  return (
    <div className="border-l border-slate-200 pl-3 py-1 text-xs">
      {r === undefined && <span className="text-slate-400 font-mono text-[11px]">Checking drive time…</span>}
      {r === null && <span className="text-slate-400 font-mono text-[11px]">Route not mapped</span>}
      {r && (
        <div className={`inline-flex flex-wrap items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded-md ${
          tight ? 'bg-amber-50 text-amber-900 border border-amber-200' : 'text-slate-500'
        }`}>
          <span>🚗 {r.km < 1 ? `${Math.round(r.km * 1000)} m` : `${r.km} km`} · {fmtMin(r.min)}</span>
          {tight && (
            <span className="font-bold text-amber-800">
              (⚠️ {free <= 0 ? 'no buffer' : `${fmtMin(free)} buffer`})
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// Stop Form: Add or Edit
// Rearrange a day's stops with ▲▼ (more reliable than dragging on phones). Shows the time each
// stop will get, since time slots stay put and the stops move between them.
function ReorderList({ list, onSave, onCancel }) {
  const [order, setOrder] = useState(list)
  const [saving, setSaving] = useState(false)
  const slots = list.map((i) => i.time || '').sort((a, b) => (a || '99').localeCompare(b || '99'))
  const move = (k, dir) => {
    const j = k + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[k], next[j]] = [next[j], next[k]]
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
    <form className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200" onSubmit={submit}>
      <div className="flex items-center justify-between pb-1 border-b border-slate-200/60">
        <h4 className="font-semibold text-xs text-slate-800">
          {initial.id ? 'Edit Stop' : 'Add New Stop'}
        </h4>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700 text-xs font-bold">
          ✕
        </button>
      </div>

      {/* Category selector */}
      <div className="flex flex-wrap gap-1">
        {KINDS.map(([k, icon, label]) => (
          <button
            type="button"
            key={k}
            onClick={() => setV({ ...v, kind: k })}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition ${
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
        placeholder="Stop title (e.g. Om Beach, Scuba diving, Dinner at Namaste…)"
        value={v.title}
        onChange={set('title')}
      />

      <div className="grid grid-cols-3 gap-2">
        <input
          type="time"
          aria-label="Time"
          className="input text-xs font-mono"
          value={v.time}
          onChange={set('time')}
        />
        <input
          className="input text-xs"
          aria-label="Duration"
          placeholder="Duration (2h)"
          value={v.duration}
          onChange={set('duration')}
        />
        <input
          className="input text-xs font-mono"
          aria-label="Cost per person"
          inputMode="numeric"
          placeholder="₹/person"
          value={v.cost || ''}
          onChange={(e) => setV({ ...v, cost: e.target.value.replace(/[^\d]/g, '') })}
        />
      </div>

      <input
        className="input text-xs"
        placeholder="Location name or Google Maps link"
        value={v.place}
        onChange={set('place')}
      />

      {(initial.id || days.length > 1) && (
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

      {/* Booking Segmented Control */}
      <div>
        <p className="text-xs font-medium text-slate-600 mb-1">Booking Status</p>
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
                v.booking === k ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600'
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

// Share Itinerary Component
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs z-40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full p-4 space-y-3 shadow-2xl">
        <div className="flex justify-between items-center pb-1 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-900">Share Itinerary</p>
          <button aria-label="Close" className="text-slate-400 hover:text-slate-700 font-bold" onClick={onClose}>
            ✕
          </button>
        </div>
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-slate-600 bg-slate-50 rounded-xl p-2.5 border border-slate-200 font-mono">
          {text}
        </pre>
        <div className="flex gap-2 pt-1">
          <WhatsAppButton className="flex-1 text-xs" label="WhatsApp" text={text} />
          <button
            className="btn-ghost flex-1 text-xs"
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

// AI Trip Planner Wizard
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
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-xs">
        <div className="flex justify-between items-center pb-1 border-b border-slate-200">
          <p className="font-semibold text-slate-900">Draft Itinerary</p>
          <button className="text-slate-600 underline font-medium" onClick={() => setDraft(null)}>
            Change preferences
          </button>
        </div>
        <p className="text-slate-500">Uncheck any stops you don't want, then add the rest.</p>

        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {draft.map((d, di) => (
            <div key={d.date} className="bg-white p-3 rounded-lg border border-slate-200">
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
                            <span className="font-semibold text-slate-900">{s.title}</span>
                            <span className="font-mono text-slate-500">{s.time}</span>
                          </div>
                          <p className="text-slate-500">{s.why}</p>
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
          className="btn w-full py-2.5 text-xs"
        >
          {saving ? 'Adding…' : `Add ${count} stop${count === 1 ? '' : 's'} to itinerary`}
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={generate} className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-xs">
      <div className="flex justify-between items-center pb-1 border-b border-slate-200">
        <p className="font-semibold text-slate-900">Plan Entire Trip</p>
        <button type="button" onClick={onDone} className="text-slate-400 hover:text-slate-700">✕</button>
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
              className={`rounded-lg py-1.5 text-xs border font-medium ${
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
              className={`rounded-lg px-2.5 py-1 text-xs border ${
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
      <button disabled={busy} className="btn w-full py-2.5 text-xs">
        {busy ? 'Drafting itinerary…' : `Draft ${days.length} days`}
      </button>
    </form>
  )
}

// Practical Day Notes (Clean checklist, zero slop)
function Needs({ data, packed, onAdd, onClose }) {
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-xs">
      <div className="flex justify-between items-center pb-1 border-b border-slate-200">
        <p className="font-semibold text-slate-900">Day Practical Notes & Essentials</p>
        <button aria-label="Close" className="text-slate-400 hover:text-slate-700 font-bold" onClick={onClose}>
          ✕
        </button>
      </div>

      {data.essentials?.length > 0 && (
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] uppercase text-slate-400 font-semibold tracking-wider">Things to carry</p>
          <ul className="space-y-1">
            {data.essentials.map((e, i) => {
              const done = packed.has(e.item.toLowerCase())
              return (
                <li key={i} className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200 gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 break-words">{e.item}</p>
                    <p className="text-[11px] text-slate-500 break-words">{e.why}</p>
                  </div>
                  <button
                    disabled={done}
                    onClick={() => onAdd(e)}
                    className="text-[11px] shrink-0 rounded-md border border-slate-200 px-2 py-0.5 font-medium disabled:opacity-40"
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

// Stop Suggestions (Clean inline list)
function Suggestions({ stops, existing, onAdd, onClose, days, date, suggestTime }) {
  const [added, setAdded] = useState(new Set())
  const [picking, setPicking] = useState(null) // index of the idea whose day/time is being chosen

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
      <div className="flex justify-between items-center pb-1 border-b border-slate-200">
        <p className="font-semibold text-slate-900">Stop Recommendations</p>
        <button aria-label="Close" className="text-slate-400 hover:text-slate-700 font-bold" onClick={onClose}>
          ✕
        </button>
      </div>

      {stops.length === 0 ? (
        <p className="text-slate-500">No suggestions right now.</p>
      ) : (
        <div className="space-y-1.5">
          {stops.map((s, i) => {
            const done = added.has(i) || existing.has(s.title.toLowerCase())
            return (
              <div key={i} className="p-2 rounded-lg bg-white border border-slate-200">
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
                  className="text-[11px] shrink-0 rounded-md border border-slate-200 px-2 py-0.5 font-medium disabled:opacity-40"
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
