import { useEffect, useState, useMemo } from 'react'
import { useCol, add, update, remove, updateTrip } from '../data'
import { tripDays, ymd } from './Trip'
import { MapLink } from './Today'
import ConfirmDialog from '../components/ConfirmDialog'
import { geocodePlace, extractCoordsFromText } from '../geocode'
import { askJSON, aiAvailable } from '../ai'
import { inr } from '../settle'
import { driveTime, parseDuration, toMin, fmtMin } from '../routing'
import Destinations from './Destinations'
import { locateStop } from '../locateStop'
import { parseMapsUrl, resolvePlaceLink, isShortMapsLink } from '../links'
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

// Coastal Editorial Theme: Warm terracotta, forest sage, warm amber, and linen tones
const KIND_STYLE = {
  place: { label: 'Sight & Nature', badge: 'bg-[#DCFCE7] text-[#15803D] border-[#15803D]/25', dot: 'bg-[#DCFCE7] text-[#15803D] ring-2 ring-[#DCFCE7]/70' },
  food: { label: 'Food & Dining', badge: 'bg-[#FFEDD5] text-[#C2410C] border-[#C2410C]/25', dot: 'bg-[#FFEDD5] text-[#C2410C] ring-2 ring-[#FFEDD5]/70' },
  activity: { label: 'Adventure & Trek', badge: 'bg-[#FEF3C7] text-[#B45309] border-[#B45309]/25', dot: 'bg-[#FEF3C7] text-[#B45309] ring-2 ring-[#FEF3C7]/70' },
  stay: { label: 'Stay & Hotel', badge: 'bg-[#F4ECE8] text-[#824500] border-[#824500]/25', dot: 'bg-[#F4ECE8] text-[#824500] ring-2 ring-[#F4ECE8]/70' },
  travel: { label: 'Transit & Route', badge: 'bg-[#F5F5F4] text-[#57534E] border-[#57534E]/25', dot: 'bg-[#F5F5F4] text-[#57534E] ring-2 ring-[#F5F5F4]/70' },
}

const kindOf = (k) => KINDS.find(([v]) => v === k) || KINDS[0]
const PACK_CATS = ['clothes', 'electronics', 'toiletries', 'medical', 'docs', 'gear']
const hasCoords = (i) => typeof i?.lat === 'number' && typeof i?.lng === 'number'
const dayLabel = (d) => `Day ${d.n} · ${new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`
const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99') || (a.order ?? 0) - (b.order ?? 0)

function getMemberInitials(name) {
  if (!name) return '??'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export default function Plan({ tripId, trip, uid, setTab, members = [], byId = {} }) {
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
  const [reordering, setReordering] = useState(null)
  const [pinState, setPinState] = useState({}) // stop id -> 'busy' | error message

  // 📍 Map Pin: find the stop on the map *before* switching tabs, so the Map can zoom straight to it.
  // Titles like "Arrival at Alnavar Station" aren't places, so locateStop cleans them up and tries the
  // trip's destinations too. If nothing matches, stay here and say what to fix instead of doing nothing.
  async function openOnMap(i) {
    const focus = (lat, lng) => {
      sessionStorage.setItem('yatra:map_focus', JSON.stringify({ id: i.id, date: i.date, lat, lng, title: i.title, place: i.place || i.title }))
      setTab('map')
    }
    if (hasCoords(i)) return focus(i.lat, i.lng)
    setPinState((m) => ({ ...m, [i.id]: 'busy' }))
    const g = await locateStop(i, trip.destinations || [])
    if (g) {
      update(tripId, 'plan', i.id, { lat: g.lat, lng: g.lng }).catch(() => {})
      setPinState((m) => ({ ...m, [i.id]: null }))
      focus(g.lat, g.lng)
    } else {
      setPinState((m) => ({ ...m, [i.id]: 'Couldn’t find this on the map — tap ✎ and add a place name (e.g. “Alnavar Station”) or a Google Maps link.' }))
    }
  }
  const [filterCategory, setFilterCategory] = useState('all')

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

  // Collaborator initials list for header cluster
  const memberInitials = useMemo(() => {
    if (members && members.length > 0) {
      return members.slice(0, 4).map((m) => ({
        initials: getMemberInitials(m.name || 'Friend'),
        name: m.name || 'Friend',
      }))
    }
    const mem = trip.members || {}
    const entries = Object.entries(mem)
    if (entries.length > 0) {
      return entries.slice(0, 4).map(([id, info]) => ({
        initials: getMemberInitials(info?.name || id),
        name: info?.name || 'Friend',
      }))
    }
    return [{ initials: 'YOU', name: 'You' }, { initials: '+4', name: '4 Friends' }]
  }, [members, trip.members])

  // Look up coordinates for stops without lat/lng
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

  // Active day estimate for sticky bottom bar (default to today or day 1)
  const activeDayObj = days.find((d) => d.date === today) || days[0] || { n: 1, date: today }
  const activeDayStops = items.filter((i) => i.date === activeDayObj.date)
  const activeDayCost = activeDayStops.reduce((s, i) => s + (Number(i.cost) || 0), 0)

  // ＋ → "Add to Plan" in the bottom bar opens the add-stop form here.
  useEffect(() => {
    const open = () => {
      try {
        if (!sessionStorage.getItem('yatra:quick_add')) return
        sessionStorage.removeItem('yatra:quick_add')
      } catch {}
      startAddStop()
    }
    open()
    window.addEventListener('yatra:quick-add', open)
    return () => window.removeEventListener('yatra:quick-add', open)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Smoothly initiate stop creation on a specific date, expanding and scrolling to it
  function startAddStop(targetDate) {
    const date = targetDate || activeDayObj?.date || days[0]?.date || ymd(new Date())
    setCollapsed((c) => {
      const n = new Set(c)
      n.delete(date)
      return n
    })
    setEditing({ date })
    setTimeout(() => {
      const el = document.getElementById(`day-${date}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 40)
  }

  return (
    <div className="space-y-4 font-sans-editorial pb-20">

      {/* 1. TOP EDITORIAL HERO & ROUTE OVERVIEW */}
      <section className="rounded-3xl bg-[#FFFFFF] border border-[#E7E5E4] p-4 sm:p-5 shadow-[0_4px_20px_-2px_rgba(28,25,23,0.04)] space-y-3.5">
        
        {/* Eyebrow Route Pill */}
        <div className="inline-flex items-center gap-1.5 self-start px-3 py-1 rounded-full bg-[#FAF2EE] text-[#59413A] font-medium text-xs border border-[#E7E5E4]/80 shadow-xs">
          <span className="size-1.5 rounded-full bg-[#C2410C]" />
          {route.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {route.map((loc, idx) => (
                <span key={idx} className="flex items-center gap-1.5">
                  {idx > 0 && <span className="text-[#8D7168] text-[10px]">→</span>}
                  <span className="font-semibold text-[#1C1917]">{loc}</span>
                </span>
              ))}
            </div>
          ) : (
            <span className="font-semibold text-[#1C1917]">{trip.name || 'Coastal Roadtrip'}</span>
          )}
        </div>

        {/* Display Title & Sub-bar */}
        <div className="flex flex-col gap-1">
          <h1 className="font-serif-editorial text-2xl sm:text-3xl font-medium text-[#1C1917] tracking-tight leading-snug">
            {trip.name || (route.length ? route.join(' & ') : 'Coastal Roadtrip Itinerary')}
          </h1>

          <div className="flex flex-wrap items-center justify-between text-[#78716C] text-xs pt-0.5 gap-2">
            <span className="flex items-center gap-1.5">
              <span className="text-[#C2410C]">📅</span>
              <span>
                {trip.start && trip.end ? `${trip.start} to ${trip.end} · ` : ''}
                {days.length} Days · {Object.keys(trip.members || {}).length || members.length || 5} Explorers
              </span>
            </span>

            {/* Friend initials avatar cluster & Share button */}
            <div className="flex items-center gap-2">
              <div className="flex items-center -space-x-1.5">
                {memberInitials.map((m, idx) => (
                  <span
                    key={idx}
                    className="size-6 rounded-full bg-[#FAF2EE] text-[#59413A] border-2 border-white flex items-center justify-center text-[9px] font-bold shadow-xs uppercase"
                    title={m.name}
                  >
                    {m.initials}
                  </span>
                ))}
              </div>
              <button
                onClick={() => setShareOpen(true)}
                className="px-2.5 py-1 rounded-full bg-white hover:bg-[#FAF9F6] border border-[#E7E5E4] text-[#1C1917] font-medium text-xs shadow-xs active:scale-95 transition flex items-center gap-1"
              >
                <span>↗</span>
                <span>Share</span>
              </button>
            </div>
          </div>
        </div>

        {/* 3 Refined Metric Pill Cards */}
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          <div className="bg-[#FAF9F6] p-2.5 sm:p-3 rounded-2xl border border-[#E7E5E4] shadow-xs flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-1 text-[#78716C] text-[11px] font-medium">
              <span className="text-[#C2410C]">🧭</span>
              <span className="truncate">Route</span>
            </div>
            <div className="font-bold text-sm text-[#1C1917] truncate">{items.length} Stops</div>
            <div className="text-[10px] text-[#8D7168] truncate">{plannedDays}/{days.length} days set</div>
          </div>

          <div className="bg-[#FAF9F6] p-2.5 sm:p-3 rounded-2xl border border-[#E7E5E4] shadow-xs flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-1 text-[#78716C] text-[11px] font-medium">
              <span className="text-[#B45309]">💳</span>
              <span className="truncate">Shared</span>
            </div>
            <div className="font-bold text-sm text-[#1C1917] truncate">
              {totalCost ? inr(totalCost) : '₹0'}<span className="text-[10px] font-normal text-[#8D7168]">/p</span>
            </div>
            <div className="text-[10px] text-[#8D7168] truncate">Split per person</div>
          </div>

          <div className="bg-[#FAF9F6] p-2.5 sm:p-3 rounded-2xl border border-[#E7E5E4] shadow-xs flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-1 text-[#78716C] text-[11px] font-medium">
              <span className="text-[#15803D]">✓</span>
              <span className="truncate">Status</span>
            </div>
            <div className={`font-bold text-sm truncate ${toBook.length > 0 ? 'text-[#B45309]' : 'text-[#15803D]'}`}>
              {toBook.length > 0 ? `${toBook.length} To Book` : `${items.filter((i) => i.booking === 'booked').length} Booked`}
            </div>
            <div className={`text-[10px] truncate ${toBook.length > 0 ? 'text-[#B45309]' : 'text-[#15803D]'}`}>
              {toBook.length > 0 ? 'Pending tickets' : 'Ready to roll'}
            </div>
          </div>
        </div>

        {/* Quick Action & Control Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#E7E5E4]/80">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => startAddStop(activeDayObj?.date)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#C2410C] hover:bg-[#9A3412] text-white rounded-full text-xs font-semibold shadow-xs active:scale-95 transition"
            >
              <span className="text-sm leading-none">+</span>
              <span>Add Stop</span>
            </button>

            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-[#E7E5E4] text-[#1C1917] rounded-full text-xs font-medium shadow-xs outline-none hover:border-[#D6D3D1]"
            >
              <option value="all">All Categories</option>
              {KINDS.map(([k, icon, label]) => (
                <option key={k} value={k}>{icon} {label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {aiAvailable() && (
              <button
                onClick={() => { setChatOpen(!chatOpen); setPlanner(false) }}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition active:scale-95 ${
                  chatOpen ? 'bg-[#1C1917] text-white border-[#1C1917]' : 'bg-white border-[#E7E5E4] text-[#1C1917] hover:bg-[#FAF9F6]'
                }`}
              >
                💬 Chat
              </button>
            )}

            {aiAvailable() && (
              <button
                onClick={() => { setPlanner(!planner); setChatOpen(false) }}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition active:scale-95 ${
                  planner ? 'bg-[#1C1917] text-white border-[#1C1917]' : 'bg-white border-[#E7E5E4] text-[#1C1917] hover:bg-[#FAF9F6]'
                }`}
              >
                ✨ Plan Trip
              </button>
            )}

            {toBook.length > 0 && (
              <button
                onClick={() => setShowToBook(!showToBook)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition active:scale-95 ${
                  showToBook ? 'bg-[#B45309] text-white border-[#B45309]' : 'bg-[#FEF3C7] text-[#B45309] border-[#B45309]/30'
                }`}
              >
                🎟️ {toBook.length} To Book {showToBook ? '▲' : '▼'}
              </button>
            )}

            {setTab && items.length > 0 && (
              <button
                onClick={() => setTab('map')}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-white hover:bg-[#FAF9F6] border border-[#E7E5E4] text-[#1C1917] shadow-xs active:scale-95 transition"
              >
                🗺️ See Map
              </button>
            )}
          </div>
        </div>

        {/* Inline Bookings Checklist Drawer */}
        {showToBook && toBook.length > 0 && (
          <div className="p-3 bg-[#FEF3C7]/60 rounded-2xl border border-[#B45309]/30 space-y-2">
            <div className="flex items-center justify-between pb-1 border-b border-[#B45309]/20 text-xs">
              <span className="font-bold text-[#B45309]">Pending Reservations ({toBook.length})</span>
              <button onClick={() => setShowToBook(false)} className="text-[#B45309] hover:text-[#92400E] font-bold">✕</button>
            </div>
            <ul className="divide-y divide-[#B45309]/20 text-xs">
              {toBook.map((i) => {
                const d = days.find((x) => x.date === i.date)
                return (
                  <li key={i.id} className="py-2 flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[#1C1917] truncate">{i.title}</p>
                      <p className="text-[11px] text-[#78716C] mt-0.5">
                        {d ? dayLabel(d) : i.date}{i.time ? ` · ${i.time}` : ''}{i.cost ? ` · ≈ ${inr(i.cost)}/ea` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        jump(i.date)
                        setEditing(i)
                      }}
                      className="shrink-0 text-xs rounded-xl border border-[#C2410C] bg-white hover:bg-[#FAF2EE] text-[#C2410C] font-semibold px-2.5 py-1 active:scale-95 transition"
                    >
                      Mark booked
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Embedded Chat Planner */}
        {chatOpen && (
          <div className="pt-2 border-t border-[#E7E5E4]">
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
          <div className="pt-2 border-t border-[#E7E5E4]">
            <TripPlanner trip={trip} days={days} items={items} onAdd={addStop} onDone={() => setPlanner(false)} />
          </div>
        )}

        {/* Destinations Wishlist & Manager */}
        <div className="pt-2 border-t border-[#E7E5E4]">
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
      </section>

      {/* 2. HORIZONTAL DAY SELECTOR CAROUSEL */}
      <nav aria-label="Jump to day" className="mt-1 -mx-1 px-1 overflow-x-auto no-scrollbar flex items-stretch gap-2.5 pb-2">
        {days.map((d) => {
          const count = items.filter((i) => i.date === d.date).length
          const isToday = d.date === today
          const title = trip.dayTitles?.[d.date]
          const dayDate = new Date(d.date + 'T00:00')
          const weekday = dayDate.toLocaleDateString('en-IN', { weekday: 'short' })
          const dayNum = dayDate.toLocaleDateString('en-IN', { day: 'numeric' })

          return (
            <button
              key={d.date}
              onClick={() => jump(d.date)}
              className={`shrink-0 flex flex-col p-2.5 rounded-2xl text-left min-w-[124px] sm:min-w-[136px] shadow-xs transition-all relative overflow-hidden border ${
                isToday
                  ? 'bg-[#FAF2EE] border-[#C2410C]/40 text-[#1C1917] shadow-sm'
                  : 'bg-white border-[#E7E5E4] hover:border-[#D6D3D1] text-[#1C1917]'
              }`}
            >
              {isToday && <div className="absolute top-0 left-0 right-0 h-1 bg-[#C2410C]" />}
              <div className="flex items-center justify-between w-full">
                <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${isToday ? 'text-[#C2410C]' : 'text-[#8D7168]'}`}>
                  {weekday} {dayNum}
                </span>
                {isToday && (
                  <span className="px-1.5 py-0.2 rounded-full bg-[#C2410C] text-white font-bold text-[9px] uppercase tracking-wide">
                    Today
                  </span>
                )}
              </div>
              <span className="font-serif-editorial text-sm font-semibold text-[#1C1917] mt-0.5">
                Day {d.n}
              </span>
              <div className="flex items-center gap-1 mt-1 text-[11px] text-[#78716C] truncate">
                <span className={`size-1.5 rounded-full shrink-0 ${isToday ? 'bg-[#C2410C]' : 'bg-[#8D7168]'}`} />
                <span className="truncate">{title || (count ? `${count} stop${count > 1 ? 's' : ''}` : 'Free day')}</span>
              </div>
              <span className="text-[10px] text-[#8D7168] mt-0.5 font-medium">
                {count ? `${count} active stop${count > 1 ? 's' : ''}` : 'Nothing planned'}
              </span>
            </button>
          )
        })}
      </nav>

      {/* 3. DAY-BY-DAY SECTIONS WITH VERTICAL TIMELINE */}
      {days.map((d) => {
        const rawList = items.filter((i) => i.date === d.date).sort(byTime)
        const list = filterCategory === 'all' ? rawList : rawList.filter((i) => i.kind === filterCategory)
        const dayCost = rawList.reduce((s, i) => s + (Number(i.cost) || 0), 0)
        const isCollapsed = collapsed.has(d.date)
        const title = trip.dayTitles?.[d.date]
        const isToday = d.date === today
        const a = ai[d.date]
        const dayDate = new Date(d.date + 'T00:00')

        return (
          <section
            key={d.date}
            id={`day-${d.date}`}
            className={`scroll-mt-20 rounded-3xl bg-[#FFFFFF] border shadow-xs overflow-hidden transition ${
              isToday ? 'border-[#C2410C]/50 ring-2 ring-[#C2410C]/15' : 'border-[#E7E5E4]'
            }`}
          >
            {/* Day Header */}
            <header className="flex items-start gap-3 p-4 sm:p-5 pb-3">
              {/* Day Badge */}
              <div
                className={`size-11 shrink-0 rounded-2xl grid place-items-center text-center leading-none ${
                  isToday ? 'bg-[#C2410C] text-white font-black shadow-xs' : 'bg-[#1C1917] text-white font-bold'
                }`}
              >
                <span className="text-[9px] font-mono uppercase tracking-wider opacity-80">Day</span>
                <span className="text-base font-extrabold -mt-0.5">{d.n}</span>
              </div>

              {/* Title & Metadata */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#78716C]">
                  <span className="font-medium">
                    {dayDate.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
                  </span>
                  {isToday && (
                    <span className="rounded-full bg-[#FAF2EE] text-[#C2410C] border border-[#C2410C]/30 px-2 py-0.2 text-[9px] font-extrabold font-mono tracking-wide">
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
                      placeholder="e.g. Gokarna Beach Trail"
                      className="input flex-1 min-w-0 py-1 text-xs"
                    />
                    <button type="submit" className="btn shrink-0 py-1 px-3 text-xs bg-[#C2410C] hover:bg-[#9A3412]">Save</button>
                    <button type="button" onClick={() => setTitleEdit(null)} className="btn-ghost shrink-0 py-1 px-2 text-xs">✕</button>
                  </form>
                ) : (
                  <button
                    className="text-left font-serif-editorial font-medium text-[#1C1917] hover:text-[#C2410C] text-base sm:text-lg mt-0.5 break-words block w-full leading-snug transition-colors"
                    onClick={() => setTitleEdit(d.date)}
                  >
                    {title || <span className="text-[#8D7168] font-normal italic">+ Add day highlight (e.g. Gokarna Beach Trail)</span>}
                  </button>
                )}

                {rawList.length > 0 && <DaySummary list={rawList} cost={dayCost} />}
              </div>

              {/* Collapse/Expand */}
              <button
                aria-label={isCollapsed ? `Expand day ${d.n}` : `Collapse day ${d.n}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggleDay(d.date)}
                className="size-8 shrink-0 grid place-items-center rounded-xl hover:bg-[#FAF9F6] text-[#78716C] hover:text-[#1C1917] text-xs font-bold transition"
              >
                {isCollapsed ? '▾' : '▴'}
              </button>
            </header>

            {/* Day Stops Content */}
            {!isCollapsed && (
              <div className="px-4 sm:px-5 pb-5 pt-1 space-y-3">
                {/* Empty State */}
                {rawList.length === 0 && editing?.date !== d.date && (
                  <div className="rounded-2xl border-2 border-dashed border-[#E7E5E4] p-5 text-center space-y-2 bg-[#FAF9F6]">
                    <p className="text-xs text-[#78716C] font-medium">Nothing planned yet 🌴</p>
                    <div className="flex justify-center gap-2">
                      <button
                        className="btn text-xs py-1.5 px-3.5 bg-[#C2410C] hover:bg-[#9A3412]"
                        onClick={() => startAddStop(d.date)}
                      >
                        + Add stop
                      </button>
                      {aiAvailable() && (
                        <button
                          disabled={a?.busy}
                          onClick={() => runAI(d, rawList, 'stops')}
                          className="btn-ghost text-xs py-1.5 px-3 border-[#E7E5E4]"
                        >
                          {a?.busy ? 'Checking…' : 'Suggest stops'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Filter Empty State */}
                {rawList.length > 0 && list.length === 0 && (
                  <div className="p-3 text-center rounded-2xl bg-[#FAF9F6] border border-[#E7E5E4] text-xs text-[#78716C] space-y-1">
                    <p>No {KIND_STYLE[filterCategory]?.label || filterCategory} stops found for this day.</p>
                    <button
                      onClick={() => setFilterCategory('all')}
                      className="text-[#C2410C] font-semibold underline text-xs"
                    >
                      Clear category filter
                    </button>
                  </div>
                )}

                {reordering === d.date && (
                  <ReorderList list={rawList} onCancel={() => setReordering(null)} onSave={saveOrder} />
                )}

                {/* Stops Timeline with Continuous Vertical Connector Line */}
                <ol className={`relative space-y-0 ${reordering === d.date ? 'hidden' : ''}`}>
                  {/* Continuous Vertical Backbone Hairline */}
                  {list.length > 1 && (
                    <div className="absolute left-[15px] top-4 bottom-8 w-[1.5px] bg-[#E7E5E4] z-0" aria-hidden />
                  )}

                  {list.map((i, idx) => {
                    const [, icon, label] = kindOf(i.kind)
                    const next = list[idx + 1]
                    const meta = KIND_STYLE[i.kind] || KIND_STYLE.place
                    const isItemVisited = !!visited[i.id]

                    // Note author resolution
                    const noteMatch = (i.notes || '').match(/^([A-Za-z0-9_-]+):/)
                    const noteAuthor = noteMatch ? noteMatch[1] : (i.by && byId?.[i.by]?.name) || 'Tip'
                    const noteInits = getMemberInitials(noteAuthor)
                    const noteText = noteMatch ? i.notes.slice(noteMatch[0].length).trim() : i.notes

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
                        <div className="flex items-start gap-3 z-10 relative">
                          
                          {/* Left Rail: Node Circle & Time Stamp */}
                          <div className="flex flex-col items-center shrink-0 w-8">
                            <div
                              className={`size-8 rounded-full flex items-center justify-center text-xs shadow-xs transition-all ${
                                isItemVisited
                                  ? 'bg-[#DCFCE7] text-[#15803D] ring-2 ring-[#DCFCE7]'
                                  : meta.dot
                              }`}
                              title={label}
                            >
                              {isItemVisited ? '✓' : icon}
                            </div>
                            <span className="text-[10px] font-mono font-bold text-[#1C1917] mt-1 tabular-nums">
                              {i.time || '—'}
                            </span>
                            {i.duration && (
                              <span className="text-[9px] text-[#78716C] leading-none mt-0.5">{i.duration}</span>
                            )}
                          </div>

                          {/* Stop Card */}
                          <div className="flex-1 min-w-0 bg-white rounded-2xl border border-[#E7E5E4] p-3.5 sm:p-4 shadow-sm mb-3 hover:border-[#D6D3D1] transition-all">
                            {/* Card Header Row */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                                  <span className={`text-[10px] uppercase font-mono font-semibold px-2 py-0.5 rounded-full border ${meta.badge}`}>
                                    {label}
                                  </span>

                                  {isItemVisited && (
                                    <span className="text-[10px] font-semibold bg-[#DCFCE7] text-[#15803D] border border-[#15803D]/20 px-2 py-0.5 rounded-full">
                                      ✓ Visited
                                    </span>
                                  )}

                                  {i.booking === 'todo' && (
                                    <span className="text-[10px] font-bold bg-[#FEF3C7] text-[#B45309] border border-[#B45309]/30 px-2 py-0.5 rounded-full">
                                      🎟️ To book
                                    </span>
                                  )}

                                  {i.booking === 'booked' && (
                                    <span className="text-[10px] font-bold bg-[#DCFCE7] text-[#15803D] border border-[#15803D]/25 px-2 py-0.5 rounded-full font-mono truncate max-w-[150px]">
                                      ✓ Booked{i.bookingRef ? ` #${i.bookingRef}` : ''}
                                    </span>
                                  )}
                                </div>

                                <h3 className="font-serif-editorial text-base sm:text-lg font-medium text-[#1C1917] leading-tight break-words">
                                  {i.title}
                                </h3>
                              </div>

                              {/* Action controls */}
                              <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                  aria-label={`Edit ${i.title}`}
                                  className="size-7 rounded-lg text-[#78716C] hover:text-[#1C1917] hover:bg-[#FAF9F6] flex items-center justify-center text-xs transition"
                                  onClick={() => setEditing(i)}
                                >
                                  ✎
                                </button>
                                <button
                                  aria-label={`Delete ${i.title}`}
                                  className="size-7 rounded-lg text-[#78716C] hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center text-xs transition"
                                  onClick={() => setDeletingItem(i)}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>

                            {/* Location Link */}
                            {i.place && (
                              <div className="mt-1 text-xs text-[#78716C] break-words flex items-center gap-1">
                                <MapLink place={i.place} />
                              </div>
                            )}

                            {/* Collaborator Notes Bubble */}
                            {i.notes && (
                              <div className="mt-2.5 p-2.5 rounded-xl bg-[#FAF9F6] border border-[#E7E5E4] flex items-start gap-2 text-xs">
                                <div className="size-5 rounded-full bg-[#FAF2EE] text-[#C2410C] shrink-0 flex items-center justify-center text-[9px] font-bold shadow-xs uppercase">
                                  {noteInits}
                                </div>
                                <p className="text-[#1C1917] leading-relaxed break-words flex-1">
                                  <strong className="font-semibold text-[#C2410C] mr-1">{noteAuthor}:</strong>
                                  {noteText}
                                </p>
                              </div>
                            )}

                            {/* Footer Metadata & Map Pin Button */}
                            <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5 pt-2 border-t border-[#E7E5E4]/80 text-xs">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {Number(i.cost) > 0 ? (
                                  <span className="font-mono text-[#59413A] text-[11px] bg-[#FAF9F6] border border-[#E7E5E4] px-2 py-0.5 rounded-full">
                                    ≈ {inr(i.cost)}/ea
                                  </span>
                                ) : (
                                  <span className="text-[#78716C] text-[11px] px-1">Free entry</span>
                                )}

                                {setTab && (i.place || i.lat || i.title) && (
                                  <button
                                    type="button"
                                    disabled={pinState[i.id] === 'busy'}
                                    onClick={() => openOnMap(i)}
                                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FAF2EE] text-[#C2410C] hover:bg-[#FFEDD5] font-medium text-xs border border-[#C2410C]/20 transition active:scale-95"
                                  >
                                    <span>📍</span>
                                    <span>{pinState[i.id] === 'busy' ? 'Finding…' : 'Map Pin →'}</span>
                                  </button>
                                )}
                                {pinState[i.id] && pinState[i.id] !== 'busy' && (
                                  <p role="alert" className="basis-full text-[11px] text-[#B91C1C] leading-snug">{pinState[i.id]}</p>
                                )}
                              </div>

                              <div className="flex items-center gap-1">
                                {isItemVisited ? (
                                  <span className="text-[11px] font-semibold text-[#15803D] bg-[#DCFCE7] border border-[#15803D]/20 px-2 py-0.5 rounded-full">
                                    ✓ Visited {visited[i.id].rating ? '★'.repeat(visited[i.id].rating) : ''}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={marking[i.id] === 'busy'}
                                    onClick={() => markVisited(i)}
                                    className="text-[11px] font-medium border border-[#E7E5E4] bg-white hover:bg-[#FAF9F6] text-[#1C1917] px-2.5 py-0.5 rounded-full transition active:scale-95 shadow-xs"
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
                          <div className="my-1">
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
                {rawList.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-[#E7E5E4] flex items-center gap-2 flex-wrap">
                    <button
                      className="btn flex-1 text-xs py-2 shadow-xs font-semibold bg-[#C2410C] hover:bg-[#9A3412]"
                      onClick={() => startAddStop(d.date)}
                    >
                      + Add stop
                    </button>
                    {rawList.length > 1 && reordering !== d.date && (
                      <button
                        className="btn-ghost text-xs py-2 px-3 font-medium shrink-0 border-[#E7E5E4]"
                        onClick={() => { setEditing(null); setReordering(d.date) }}
                        title="Rearrange order of stops"
                      >
                        ⇅ Reorder
                      </button>
                    )}
                    {aiAvailable() && (
                      <button
                        disabled={a?.busy}
                        onClick={() => runAI(d, rawList, 'needs')}
                        className="btn-ghost text-xs py-2 px-3 font-medium shrink-0 border-[#E7E5E4]"
                      >
                        {a?.busy && a.mode === 'needs' ? 'Checking…' : '🎒 Carry & prep'}
                      </button>
                    )}
                    {aiAvailable() && (
                      <button
                        disabled={a?.busy}
                        onClick={() => runAI(d, rawList, 'stops')}
                        className="btn-ghost text-xs py-2 px-3 font-medium shrink-0 border-[#E7E5E4]"
                      >
                        {a?.busy && a.mode === 'stops' ? 'Thinking…' : '💡 Ideas'}
                      </button>
                    )}
                  </div>
                )}

                {/* Practical Day Notes & Tips */}
                {a?.err && <p className="text-xs text-rose-600 mt-2">{a.err}</p>}
                {a?.data && a.mode === 'needs' && (
                  <Needs data={a.data} packed={packed} onAdd={addToPacking} onClose={() => setAi((x) => ({ ...x, [d.date]: null }))} />
                )}
                {a?.data && a.mode === 'stops' && (
                  <Suggestions
                    stops={a.data.stops || []}
                    existing={new Set(rawList.map((i) => i.title.toLowerCase()))}
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

      {/* 4. DOCKED DAY SUMMARY & ACTION STRIP */}
      <aside className="sticky bottom-[4.25rem] w-full z-30 mt-4 pointer-events-auto">
        <div className="bg-[#FFFFFF]/95 backdrop-blur-md rounded-2xl p-2.5 sm:p-3 border border-[#E7E5E4] shadow-lg flex items-center justify-between gap-2 max-w-lg mx-auto">
          <div className="flex flex-col pl-1 min-w-0">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#78716C] font-semibold">
              Day {activeDayObj?.n || 1} Overview
            </span>
            <span className="text-xs sm:text-sm font-bold text-[#1C1917] truncate">
              ≈ {inr(activeDayCost)} · {activeDayStops.length} waypoints
            </span>
          </div>
          <button
            onClick={() => startAddStop(activeDayObj?.date)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#C2410C] hover:bg-[#9A3412] text-white font-semibold text-xs shadow-sm active:scale-95 transition-all shrink-0"
          >
            <span>+</span>
            <span>Add Stop</span>
          </button>
        </div>
      </aside>

      {/* 5. SHARE ITINERARY MODAL */}
      {shareOpen && (
        <ShareItinerary
          trip={trip}
          days={days}
          items={items}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* 6. DELETE STOP CONFIRMATION */}
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

// Day Summary Component
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
    <p className="mt-1 text-xs text-[#78716C] leading-relaxed">
      {parts.join(' · ')}
    </p>
  )
}

// Transit Leg Connector Component
function Leg({ from, to }) {
  const [r, setR] = useState(undefined)
  const ready = hasCoords(from) && hasCoords(to)

  useEffect(() => {
    let live = true
    if (ready) driveTime(from, to).then((v) => live && setR(v))
    return () => { live = false }
  }, [ready, from.lat, from.lng, to.lat, to.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return (
      <div className="relative flex items-center gap-3 my-1 z-10">
        <div className="flex items-center justify-center w-8 shrink-0">
          <div className="size-5 rounded-full bg-[#FAF9F6] border border-[#E7E5E4] text-[#78716C] flex items-center justify-center text-[10px]">
            🚗
          </div>
        </div>
        <div className="flex-1 py-0.5">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FAF9F6] text-[#78716C] text-[10px] border border-[#E7E5E4]">
            <span>Transit link</span>
          </div>
        </div>
      </div>
    )
  }

  const start = toMin(from.time)
  const end = toMin(to.time)
  const free = start != null && end != null ? end - (start + parseDuration(from.duration)) : null
  const tight = r && free != null && free < r.min

  return (
    <div className="relative flex items-center gap-3 my-1 z-10">
      <div className="flex items-center justify-center w-8 shrink-0">
        <div className="size-5 rounded-full bg-[#FAF9F6] border border-[#E7E5E4] text-[#78716C] flex items-center justify-center text-[10px]">
          🚗
        </div>
      </div>
      <div className="flex-1 py-0.5">
        {r === undefined && (
          <span className="text-[10px] text-[#78716C] font-mono">Checking drive time…</span>
        )}
        {r === null && (
          <span className="text-[10px] text-[#78716C] font-mono">No direct road mapped</span>
        )}
        {r && (
          <div className={`inline-flex flex-wrap items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] shadow-xs border ${
            tight
              ? 'bg-[#FEF3C7] text-[#B45309] border-[#B45309]/30 font-semibold'
              : 'bg-[#FAF2EE] text-[#59413A] border-[#E7E5E4]'
          }`}>
            <span className="font-semibold text-[#1C1917]">
              {r.km < 1 ? `${Math.round(r.km * 1000)} m` : `${r.km} km`} · {fmtMin(r.min)}
            </span>
            {tight ? (
              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-[#B45309] text-white font-bold">
                ⚠️ {free <= 0 ? 'tight schedule' : `+${fmtMin(free)} buffer`}
              </span>
            ) : free != null && free > 0 ? (
              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-[#DCFCE7] text-[#15803D] font-bold">
                +{fmtMin(free)} buffer
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

// Reorder Stops List
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
    <div className="rounded-2xl border border-[#E7E5E4] bg-[#FAF9F6] p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-[#1C1917]">⇅ Rearrange stops</p>
        <p className="text-[11px] text-[#78716C]">Times stay in place — stops move between slots.</p>
      </div>
      <ol className="space-y-1.5">
        {order.map((i, k) => {
          const [, icon] = kindOf(i.kind)
          return (
            <li key={i.id} className="flex items-center gap-2 rounded-xl bg-white border border-[#E7E5E4] px-3 py-2 shadow-xs">
              <span className="w-11 shrink-0 text-xs font-mono font-semibold text-[#C2410C] tabular-nums">{slots[k] || '—'}</span>
              <span aria-hidden className="text-base">{icon}</span>
              <span className="flex-1 min-w-0 truncate text-sm font-medium text-[#1C1917]">{i.title}</span>
              <button type="button" aria-label={`Move ${i.title} up`} disabled={k === 0} onClick={() => move(k, -1)}
                className="size-8 grid place-items-center rounded-lg border border-[#E7E5E4] text-[#1C1917] disabled:opacity-30 active:bg-[#FAF9F6]">▲</button>
              <button type="button" aria-label={`Move ${i.title} down`} disabled={k === order.length - 1} onClick={() => move(k, 1)}
                className="size-8 grid place-items-center rounded-lg border border-[#E7E5E4] text-[#1C1917] disabled:opacity-30 active:bg-[#FAF9F6]">▼</button>
            </li>
          )
        })}
      </ol>
      <div className="flex gap-2 pt-1">
        <button type="button" className="btn-ghost flex-1 text-xs py-2 border-[#E7E5E4]" onClick={onCancel}>Cancel</button>
        <button type="button" disabled={!changed || saving} className="btn flex-1 text-xs py-2 bg-[#C2410C] hover:bg-[#9A3412]"
          onClick={async () => { setSaving(true); await onSave(order) }}>{saving ? 'Saving…' : 'Save order'}</button>
      </div>
    </div>
  )
}

// Stop Form: 2-column layout with Coastal Editorial styling
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
  const [linkNote, setLinkNote] = useState('')

  // Paste a Google Maps link (into the place *or* the title): use the place's name as the title and keep
  // its exact pin. Short maps.app.goo.gl links are opened in the background (can take a minute the first time).
  function onLink(field) {
    return (e) => {
      const value = e.target.value.trim()
      const isLink = /^https?:\/\//i.test(value)
      if (!isLink) return setV({ ...v, [field]: e.target.value })
      const next = { ...v, place: value, title: field === 'title' ? '' : v.title }
      const m = parseMapsUrl(value)
      if (m) {
        if (!next.title.trim() && m.name) next.title = m.name.split(',')[0]
        if (m.lat != null) { next.linkLat = m.lat; next.linkLng = m.lng }
        setLinkNote(m.lat != null ? `📍 Exact pin from the link${m.name ? `: ${m.name.split(',')[0]}` : ''}` : '')
        return setV(next)
      }
      setV(next)
      if (isShortMapsLink(value)) {
        setLinkNote('Opening the link… (can take up to a minute the first time)')
        resolvePlaceLink(value).then((r) => {
          if (!r) return setLinkNote('Couldn’t open this short link. Add the place name in the title instead.')
          setV((cur) => ({
            ...cur,
            title: cur.title.trim() ? cur.title : (r.name || '').split(',')[0],
            ...(r.lat != null ? { linkLat: r.lat, linkLng: r.lng } : {}),
          }))
          setLinkNote(`📍 Found: ${(r.name || '').split(',').slice(0, 2).join(',')}`)
        })
      } else {
        setLinkNote('Only Google Maps links can be read — other links are saved as-is.')
      }
    }
  }

  function submit(e) {
    e.preventDefault()
    const { id, createdAt, lat, lng, linkLat, linkLng, ...rest } = v
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
    if (typeof linkLat === 'number') { out.lat = linkLat; out.lng = linkLng }
    if (!out.title) out.title = 'Place from link'
    onSave(out)
  }

  return (
    <form className="space-y-3 bg-[#FAF9F6] p-4 sm:p-5 rounded-2xl border border-[#E7E5E4] shadow-xs" onSubmit={submit}>
      <div className="flex items-center justify-between pb-1 border-b border-[#E7E5E4]">
        <h4 className="font-serif-editorial font-bold text-sm text-[#1C1917]">
          {initial.id ? 'Edit Stop' : 'Add New Stop'}
        </h4>
        <button type="button" onClick={onCancel} className="text-[#78716C] hover:text-[#1C1917] text-xs font-bold">✕</button>
      </div>

      {/* Category Selection */}
      <div className="flex flex-wrap gap-1">
        {KINDS.map(([k, icon, label]) => (
          <button
            type="button"
            key={k}
            onClick={() => setV({ ...v, kind: k })}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
              v.kind === k
                ? 'bg-[#C2410C] text-white border-[#C2410C] shadow-xs'
                : 'bg-white border-[#E7E5E4] text-[#1C1917] hover:bg-[#FAF9F6]'
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
        placeholder="Stop title (e.g. Om Beach Sunrise Walk, Cafe 1984, Kali River Rafting…)"
        value={v.title}
        onChange={onLink('title')}
      />

      {/* Time & Duration: 2 spacious columns */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[11px] font-medium text-[#78716C]">
          Departure / Slot Time
          <input
            type="time"
            className="input mt-1 text-xs font-mono"
            value={v.time}
            onChange={set('time')}
          />
        </label>
        <label className="block text-[11px] font-medium text-[#78716C]">
          Duration
          <input
            className="input mt-1 text-xs"
            placeholder="e.g. 2h or 45m"
            value={v.duration}
            onChange={set('duration')}
          />
        </label>
      </div>

      {/* Cost & Location */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[11px] font-medium text-[#78716C]">
          Cost / person
          <input
            className="input mt-1 text-xs font-mono"
            inputMode="numeric"
            placeholder="₹ per person"
            value={v.cost || ''}
            onChange={(e) => setV({ ...v, cost: e.target.value.replace(/[^\d]/g, '') })}
          />
        </label>
        <label className="block text-[11px] font-medium text-[#78716C]">
          Location / Address
          <input
            className="input mt-1 text-xs"
            placeholder="Place name or Maps link"
            value={v.place}
            onChange={onLink('place')}
          />
          {linkNote && <span className="block mt-1 text-[11px] font-normal text-[#59413A]">{linkNote}</span>}
        </label>
      </div>

      {initial.id && (
        <label className="block text-xs font-medium text-[#78716C]">
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
        <p className="text-xs font-medium text-[#78716C] mb-1">Booking & Reservation</p>
        <div className="grid grid-cols-3 bg-[#E7E5E4]/60 rounded-xl p-1 text-xs font-medium gap-0.5">
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
                v.booking === k ? 'bg-white text-[#1C1917] shadow-xs font-semibold' : 'text-[#78716C]'
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
        placeholder="Collaborator notes (best dishes, what to pack, cash-only, entry gate...)"
        value={v.notes}
        onChange={set('notes')}
      />

      <div className="flex gap-2 pt-1">
        <button type="button" className="btn-ghost flex-1 text-xs py-2 border-[#E7E5E4]" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn flex-1 text-xs py-2 bg-[#C2410C] hover:bg-[#9A3412]">
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
      <div className="bg-white rounded-3xl max-w-sm w-full p-5 space-y-3 shadow-2xl border border-[#E7E5E4]">
        <div className="flex justify-between items-center pb-1 border-b border-[#E7E5E4]">
          <p className="font-serif-editorial text-base font-bold text-[#1C1917]">Share Itinerary</p>
          <button aria-label="Close" className="text-[#78716C] hover:text-[#1C1917] font-bold" onClick={onClose}>✕</button>
        </div>
        <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap text-xs text-[#59413A] bg-[#FAF9F6] rounded-2xl p-3 border border-[#E7E5E4] font-mono">
          {text}
        </pre>
        <div className="flex gap-2 pt-1">
          <WhatsAppButton className="flex-1 text-xs py-2" label="WhatsApp" text={text} />
          <button
            className="btn-ghost flex-1 text-xs py-2 border-[#E7E5E4]"
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
      <div className="rounded-2xl border border-[#E7E5E4] bg-[#FAF9F6] p-4 space-y-3 text-xs">
        <div className="flex justify-between items-center pb-1 border-b border-[#E7E5E4]">
          <p className="font-serif-editorial font-bold text-sm text-[#1C1917]">Draft Itinerary</p>
          <button className="text-[#C2410C] underline font-semibold" onClick={() => setDraft(null)}>
            Change preferences
          </button>
        </div>
        <p className="text-[#78716C]">Uncheck any stops you don't want, then add the rest.</p>

        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {draft.map((d, di) => (
            <div key={d.date} className="bg-white p-3 rounded-xl border border-[#E7E5E4]">
              <p className="font-bold text-[#1C1917]">{dayLabel(d)}{d.theme ? ` — ${d.theme}` : ''}</p>
              {d.stops.length === 0 ? (
                <p className="text-[#8D7168] mt-1">No new stops.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {d.stops.map((s, si) => (
                    <li key={si}>
                      <label className="flex gap-2 items-start cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 accent-[#C2410C]"
                          checked={s.keep}
                          onChange={() => toggle(di, si)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-[#1C1917] break-words">{s.title}</span>
                            <span className="font-mono text-[#78716C] text-[11px]">{s.time}</span>
                          </div>
                          <p className="text-[#78716C] text-[11px] break-words">{s.why}</p>
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
          className="btn w-full py-2.5 text-xs font-semibold bg-[#C2410C] hover:bg-[#9A3412]"
        >
          {saving ? 'Adding…' : `Add ${count} stop${count === 1 ? '' : 's'} to itinerary`}
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={generate} className="rounded-2xl border border-[#E7E5E4] bg-[#FAF9F6] p-4 space-y-3 text-xs">
      <div className="flex justify-between items-center pb-1 border-b border-[#E7E5E4]">
        <p className="font-serif-editorial font-bold text-sm text-[#1C1917]">Plan Entire Trip</p>
        <button type="button" onClick={onDone} className="text-[#78716C] hover:text-[#1C1917] font-bold">✕</button>
      </div>

      <label className="block text-[#78716C] font-medium">
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
        <p className="text-[#78716C] font-medium mb-1">Pace</p>
        <div className="grid grid-cols-3 gap-1.5">
          {PACES.map(([k, l]) => (
            <button
              type="button"
              key={k}
              onClick={() => setF({ ...f, pace: k })}
              className={`rounded-xl py-1.5 text-xs border font-medium ${
                f.pace === k ? 'bg-[#C2410C] text-white border-[#C2410C]' : 'bg-white border-[#E7E5E4] text-[#1C1917]'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[#78716C] font-medium mb-1">Interests</p>
        <div className="flex flex-wrap gap-1">
          {INTERESTS.map((x) => (
            <button
              type="button"
              key={x}
              onClick={() => toggleInterest(x)}
              className={`rounded-full px-3 py-1 text-xs border ${
                f.interests.includes(x)
                  ? 'bg-[#C2410C] text-white border-[#C2410C] font-medium'
                  : 'bg-white border-[#E7E5E4] text-[#1C1917]'
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
      <button disabled={busy} className="btn w-full py-2.5 text-xs font-semibold bg-[#C2410C] hover:bg-[#9A3412]">
        {busy ? 'Drafting itinerary…' : `Draft ${days.length} days`}
      </button>
    </form>
  )
}

// Practical Day Notes & Packing
function Needs({ data, packed, onAdd, onClose }) {
  return (
    <div className="mt-2 rounded-2xl border border-[#E7E5E4] bg-[#FAF9F6] p-4 space-y-3 text-xs">
      <div className="flex justify-between items-center pb-1 border-b border-[#E7E5E4]">
        <p className="font-serif-editorial font-bold text-sm text-[#1C1917]">Day Practical Notes & Essentials</p>
        <button aria-label="Close" className="text-[#78716C] hover:text-[#1C1917] font-bold" onClick={onClose}>✕</button>
      </div>

      {data.essentials?.length > 0 && (
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] uppercase text-[#8D7168] font-semibold tracking-wider">Things to carry</p>
          <ul className="space-y-1.5">
            {data.essentials.map((e, i) => {
              const done = packed.has(e.item.toLowerCase())
              return (
                <li key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-[#E7E5E4] gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#1C1917] break-words">{e.item}</p>
                    <p className="text-[11px] text-[#78716C] break-words">{e.why}</p>
                  </div>
                  <button
                    disabled={done}
                    onClick={() => onAdd(e)}
                    className="text-[11px] shrink-0 rounded-full border border-[#C2410C] text-[#C2410C] bg-white hover:bg-[#FAF2EE] px-3 py-1 font-semibold disabled:opacity-40 disabled:border-[#E7E5E4] disabled:text-[#8D7168]"
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
          <p className="font-mono text-[10px] uppercase text-[#8D7168] font-semibold tracking-wider">Before you go</p>
          <ul className="list-disc pl-4 space-y-0.5 text-[#59413A]">
            {data.prepare.map((t, i) => <li key={i} className="break-words">{t}</li>)}
          </ul>
        </div>
      )}

      {data.tips?.length > 0 && (
        <div className="space-y-1">
          <p className="font-mono text-[10px] uppercase text-[#8D7168] font-semibold tracking-wider">Local timing & tips</p>
          <ul className="list-disc pl-4 space-y-0.5 text-[#59413A]">
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
  const [picking, setPicking] = useState(null)

  return (
    <div className="mt-2 rounded-2xl border border-[#E7E5E4] bg-[#FAF9F6] p-4 space-y-2 text-xs">
      <div className="flex justify-between items-center pb-1 border-b border-[#E7E5E4]">
        <p className="font-serif-editorial font-bold text-sm text-[#1C1917]">Stop Recommendations</p>
        <button aria-label="Close" className="text-[#78716C] hover:text-[#1C1917] font-bold" onClick={onClose}>✕</button>
      </div>

      {stops.length === 0 ? (
        <p className="text-[#78716C]">No suggestions right now.</p>
      ) : (
        <div className="space-y-1.5">
          {stops.map((s, i) => {
            const done = added.has(i) || existing.has(s.title.toLowerCase())
            return (
              <div key={i} className="p-2.5 rounded-xl bg-white border border-[#E7E5E4]">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-[#1C1917] break-words">{s.title}</span>
                      <span className="font-mono text-[#78716C] text-[11px]">{s.time}</span>
                    </div>
                    <p className="text-[#78716C] text-[11px] break-words">
                      {s.why}{s.cost ? ` · ≈ ${inr(s.cost)}/ea` : ''}
                    </p>
                  </div>
                  <button
                    disabled={done}
                    onClick={() => setPicking(picking === i ? null : i)}
                    className="text-[11px] shrink-0 rounded-full border border-[#C2410C] text-[#C2410C] bg-white hover:bg-[#FAF2EE] px-3 py-1 font-semibold disabled:opacity-40 disabled:border-[#E7E5E4] disabled:text-[#8D7168]"
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
