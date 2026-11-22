import { useState, useEffect, useMemo } from 'react'
import { useCol, add, update } from '../data'
import { balances, inr } from '../settle'
import { tripDays, ymd } from '../dates'
import { PollCard } from './Polls'
import { NotifyBanner, Reminders } from './Reminders'
import { WhatsAppButton, tripLink } from '../share'
import { getTheme } from '../themes'


// Kind styling tokens aligned with Coastal Editorial design system
const KIND_CONFIG = {
  place: { icon: '📍', label: 'Sight & Monument', badge: 'bg-[#DCFCE7] text-[#15803D] border-[#15803D]/20', dot: 'bg-emerald-500' },
  food: { icon: '🍽️', label: 'Dining & Cafe', badge: 'bg-[#FFEDD5] text-[#C2410C] border-[#C2410C]/25', dot: 'bg-orange-500' },
  activity: { icon: '🎯', label: 'Adventure & Trek', badge: 'bg-[#FEF3C7] text-[#B45309] border-[#B45309]/25', dot: 'bg-amber-500' },
  stay: { icon: '🏨', label: 'Stay & Hotel', badge: 'bg-[#F4ECE8] text-[#824500] border-[#824500]/25', dot: 'bg-stone-500' },
  travel: { icon: '🚗', label: 'Transit & Route', badge: 'bg-[#F5F5F4] text-[#57534E] border-[#57534E]/25', dot: 'bg-slate-500' },
}

const AVATAR_PALETTE = [
  'bg-amber-100 text-amber-900 border-amber-200',
  'bg-emerald-100 text-emerald-900 border-emerald-200',
  'bg-rose-100 text-rose-900 border-rose-200',
  'bg-orange-100 text-orange-900 border-orange-200',
  'bg-blue-100 text-blue-900 border-blue-200',
  'bg-teal-100 text-teal-900 border-teal-200',
  'bg-purple-100 text-purple-900 border-purple-200',
]

function getAvatarStyle(name = '') {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i)
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}

export function getInitials(name = '') {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (trimmed[0] || '?').toUpperCase()
}

export function formatTime12(timeStr) {
  if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr)) return timeStr || '—'
  const [h, m] = timeStr.split(':').map(Number)
  if (h < 0 || h > 23 || m < 0 || m > 59) return timeStr
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`
}

export const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99') || (a.order ?? 0) - (b.order ?? 0)
export const daysUntil = (d) => Math.ceil((new Date(d + 'T00:00') - new Date()) / 864e5)


export default function Today({ tripId, trip, uid, me, members, byId, setTab }) {
  const items = useCol(tripId, 'plan', 'time')
  const checks = useCol(tripId, 'headcounts')
  const polls = useCol(tripId, 'polls')
  const emergencies = useCol(tripId, 'emergencies')
  const expenses = useCol(tripId, 'expenses')

  const activeSos = emergencies.find((e) => e.status === 'active')
  const pending = polls.filter((p) => !p.closed && p.votes?.[uid] === undefined)
  const check = checks[checks.length - 1]

  const today = ymd(new Date())
  const days = useMemo(() => tripDays(trip), [trip])
  const day = days.find((d) => d.date === today)
  const next = days.find((d) => d.date > today)
  const showDate = day ? today : next?.date || days[0]?.date

  const todays = useMemo(() => {
    return items.filter((i) => i.date === showDate).sort(byTime)
  }, [items, showDate])

  const myBal = useMemo(() => {
    return balances(expenses, members)[uid] || 0
  }, [expenses, members, uid])

  const totalTripSpend = useMemo(() => {
    return expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
  }, [expenses])

  // Destination telemetry & solar timing
  const { weather, sunsetInfo } = useDestinationTelemetry(trip, todays)

  // Identify the "Happening Next" / Active Spotlight stop
  const { spotlightItem, spotlightIndex } = useMemo(() => {
    if (!todays.length) return { spotlightItem: null, spotlightIndex: -1 }
    const nowHHMM = new Date().toTimeString().slice(0, 5)
    
    // If today is actively happening, find the first stop that hasn't finished yet
    if (day) {
      const idx = todays.findIndex((item) => (item.time || '99') >= nowHHMM)
      if (idx !== -1) return { spotlightItem: todays[idx], spotlightIndex: idx }
      // All stops have passed for today: spotlight the last/highlight stop
      return { spotlightItem: todays[todays.length - 1], spotlightIndex: todays.length - 1 }
    }
    // If before trip or looking at upcoming date, spotlight the first stop
    return { spotlightItem: todays[0], spotlightIndex: 0 }
  }, [todays, day])

  return (
    <div className="space-y-4 font-sans-editorial">
      {/* 1. SOS Distress Banner (When Active) */}
      {activeSos && (
        <section className="card bg-rose-600 text-white border-0 shadow-lg space-y-2.5 animate-pulse">
          <div className="flex items-center justify-between">
            <span className="font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>🚨</span> EMERGENCY SOS DISTRESS FROM {activeSos.name}
            </span>
            {activeSos.by === uid && (
              <button
                type="button"
                onClick={() => update(tripId, 'emergencies', activeSos.id, { status: 'resolved' })}
                className="bg-white text-rose-700 text-xs font-bold px-2.5 py-1 rounded-lg hover:bg-rose-50 transition"
              >
                I'm Safe Now ✓
              </button>
            )}
          </div>
          <div className="flex gap-2 pt-0.5">
            <a
              href={activeSos.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="btn bg-white text-rose-700 flex-1 text-xs py-2 text-center font-bold shadow-sm"
            >
              📍 Open Exact Location
            </a>
            <WhatsAppButton
              className="flex-1 text-xs py-2"
              label="Alert Group"
              text={`🚨 EMERGENCY SOS from ${activeSos.name}!\nLocation: ${activeSos.mapsUrl}`}
            />
          </div>
        </section>
      )}

      {/* 2. Editorial Destination & Ambient Header */}
      <EditorialHeader
        trip={trip}
        me={me}
        members={members}
        day={day}
        days={days}
        today={today}
        weather={weather}
        sunsetInfo={sunsetInfo}
      />

      {/* 3. Push Notification Status Banner */}
      <NotifyBanner tripId={tripId} uid={uid} />

      {/* 4. Pending Polls */}
      {pending.map((p) => (
        <PollCard key={p.id} compact poll={p} tripId={tripId} uid={uid} members={members} byId={byId} />
      ))}

      {/* 5. "Happening Next" / Hero Spotlight Card */}
      {spotlightItem && (
        <HeroSpotlight
          item={spotlightItem}
          totalStops={todays.length}
          index={spotlightIndex}
          tripId={tripId}
          setTab={setTab}
          isToday={Boolean(day)}
        />
      )}

      {/* 6. Group Pulse & Presence (Headcount) */}
      <GroupPulse
        trip={trip}
        tripId={tripId}
        uid={uid}
        check={check}
        members={members}
        byId={byId}
        setTab={setTab}
      />

      {/* 7. Expedition Kitty & Financial Glance */}
      <ExpeditionKitty
        myBal={myBal}
        totalSpend={totalTripSpend}
        setTab={setTab}
      />

      {/* 8. Scheduled Reminders */}
      <Reminders tripId={tripId} trip={trip} uid={uid} byId={byId} />

      {/* 9. Chronological Waypoint Trail */}
      <WaypointTimeline
        items={todays}
        showDate={showDate}
        day={day}
        setTab={setTab}
        activeItemId={spotlightItem?.id}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Pillar 1: Editorial Destination Header                                     */
/* -------------------------------------------------------------------------- */
export function EditorialHeader({ trip, me, members, day, days, today, weather, sunsetInfo }) {
  const theme = getTheme(trip.theme)

  const dateSubtext = useMemo(() => {
    if (day) {
      const dt = new Date(day.date + 'T00:00')
      return dt.toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' })
    }
    if (today < trip.start) {
      return `Starts ${new Date(trip.start + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })}`
    }
    return `Completed on ${new Date(trip.end + 'T00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}`
  }, [day, today, trip.start, trip.end])

  return (
    <section className="relative bg-[#FAF9F6] rounded-2xl p-4.5 border border-[#E7E5E4] shadow-warm-sm overflow-hidden">
      {/* Subtle warm decorative glow */}
      <div className="absolute -top-12 -right-12 w-36 h-36 bg-[#C2410C]/8 rounded-full blur-2xl pointer-events-none" />

      {/* Top Telemetry Row */}
      <div className="flex items-center justify-between text-xs mb-2.5">
        <div className="flex items-center gap-1.5 font-medium tracking-wide text-[#C2410C] uppercase text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#C2410C]" />
          <span>
            {day ? `Day ${day.n} of ${days.length}` : today < trip.start ? `${daysUntil(trip.start)} days to go` : 'Trip done 🎉'}
          </span>
          <span className="text-stone-300">•</span>
          <span className="text-stone-500 normal-case">{dateSubtext}</span>
        </div>

        {/* Ambient Sunset / Solar Pill */}
        <span className="bg-amber-50 text-amber-900 text-[10px] font-semibold px-2.5 py-0.5 rounded-full border border-amber-200/70 flex items-center gap-1 shadow-xs">
          {sunsetInfo}
        </span>
      </div>

      {/* Destination & Editorial Title */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif-editorial text-2xl sm:text-3xl font-medium text-[#1C1917] leading-tight tracking-tight">
            {day ? (
              <>
                Exploring <span className="italic font-normal text-[#C2410C]">{trip.name}</span>
              </>
            ) : today < trip.start ? (
              <>
                Countdown to <span className="italic font-normal text-[#C2410C]">{trip.name}</span>
              </>
            ) : (
              <>
                Memories of <span className="italic font-normal text-[#C2410C]">{trip.name}</span>
              </>
            )}
          </h2>
          <p className="text-xs text-[#78716C] mt-1 flex items-center gap-1.5">
            <span>Welcome back, {me.name} 👋</span>
            <span className="text-stone-300">•</span>
            <span className="inline-flex items-center gap-1 text-stone-700 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
              {weather}
            </span>
          </p>
        </div>

        {/* Member Avatars Stack */}
        <div className="flex items-center -space-x-2 shrink-0 pt-1" title={`${members.length} expedition travelers`}>
          {members.slice(0, 4).map((m) => (
            <div
              key={m.id}
              className={`w-7 h-7 rounded-full border-2 border-[#FAF9F6] flex items-center justify-center text-[10px] font-bold shadow-xs ${getAvatarStyle(m.name)}`}
              title={m.name}
            >
              {getInitials(m.name)}
            </div>
          ))}
          {members.length > 4 && (
            <div className="w-7 h-7 rounded-full bg-stone-800 border-2 border-[#FAF9F6] flex items-center justify-center text-[9px] font-medium text-stone-200 shadow-xs">
              +{members.length - 4}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Pillar 2: "Happening Next" / Active Spotlight Hero Card                    */
/* -------------------------------------------------------------------------- */
export function HeroSpotlight({ item, totalStops, index, tripId, setTab, isToday }) {
  const [copied, setCopied] = useState(false)
  const config = KIND_CONFIG[item.kind] || KIND_CONFIG.place

  const relativeTime = useMemo(() => {
    if (!item.time) return ''
    const now = new Date()
    const [h, m] = item.time.split(':').map(Number)
    const target = new Date(now)
    target.setHours(h, m, 0, 0)
    const diff = Math.round((target - now) / 60000)

    if (diff < -30) return 'Completed'
    if (diff <= 0) return 'Happening Now'
    if (diff <= 60) return `In ${diff} mins`
    const hrs = Math.floor(diff / 60)
    const mins = diff % 60
    return mins > 0 ? `In ${hrs}h ${mins}m` : `In ${hrs}h`
  }, [item.time])

  function handleMapFocus() {
    if (!setTab) return
    sessionStorage.setItem('yatra:map_focus', JSON.stringify({
      id: item.id,
      date: item.date,
      lat: item.lat,
      lng: item.lng,
      title: item.title,
      place: item.place,
    }))
    setTab('map')
  }

  return (
    <section className="relative bg-white rounded-2xl p-4.5 border border-[#E7E5E4] shadow-warm-md overflow-hidden">
      {/* Accent corner vignette */}
      <div className="absolute -top-10 -right-10 w-32 h-32 bg-[#C2410C]/8 rounded-full blur-2xl pointer-events-none" />

      {/* Header bar */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#C2410C] text-white shadow-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
            {isToday ? 'Happening Next' : 'Featured Stop'} • {formatTime12(item.time)}
          </span>
          {relativeTime && (
            <span className="text-[11px] font-medium text-[#78716C]">{relativeTime}</span>
          )}
        </div>
        <span className="text-[10px] font-semibold text-stone-500 bg-stone-100 px-2 py-0.5 rounded-md border border-stone-200">
          Stop {index + 1} of {totalStops}
        </span>
      </div>

      {/* Title & Category */}
      <div className="space-y-1">
        <h3 className="font-serif-editorial text-xl font-medium text-[#1C1917] leading-snug">
          {item.title}
        </h3>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${config.badge}`}>
            <span>{config.icon}</span>
            <span>{config.label}</span>
          </span>
          {item.duration && (
            <span className="text-[11px] text-stone-500">⏱️ {item.duration}</span>
          )}
          {item.cost > 0 && (
            <span className="text-[11px] text-stone-500">💳 {inr(item.cost)}/person</span>
          )}
        </div>
      </div>

      {/* Place / Meeting Point Profile */}
      {item.place && (
        <div className="bg-[#FAF9F6] rounded-xl p-2.5 border border-[#E7E5E4] my-3 flex items-center justify-between text-xs">
          <div className="min-w-0 pr-2">
            <span className="text-stone-400 block text-[10px] uppercase font-bold tracking-wider">Basecamp / Meet Point</span>
            <p className="font-medium text-stone-800 truncate mt-0.5">
              📍 {item.place}
            </p>
          </div>
          <MapLink place={item.place} />
        </div>
      )}

      {/* Notes / Caution Intel */}
      {(item.notes || item.why) && (
        <div className="bg-amber-50/70 rounded-xl p-2.5 border border-amber-200/60 mb-3.5 flex items-start gap-2 text-xs text-amber-950">
          <span className="text-sm shrink-0">💡</span>
          <p className="leading-snug">{item.notes || item.why}</p>
        </div>
      )}

      {/* Dual tactile action buttons */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          onClick={handleMapFocus}
          className="flex items-center justify-center gap-1.5 bg-[#C2410C] hover:bg-[#9A3412] text-white font-semibold text-xs py-2.5 px-3 rounded-xl shadow-glow-terracotta transition active:scale-[0.98]"
        >
          <span>🗺️</span> Start Route
        </button>
        <WhatsAppButton
          className="py-2.5 text-xs font-semibold"
          label="Alert Group 💬"
          text={`📍 *${item.title}*\nTime: ${formatTime12(item.time)}\nLocation: ${item.place || 'See Yatra'}\nOpen Yatra 👉 ${tripLink(tripId)}`}
        />
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Pillar 3: Group Pulse & Headcount Deck                                     */
/* -------------------------------------------------------------------------- */
function GroupPulse({ trip, tripId, uid, check, members, byId, setTab }) {
  const [customLabel, setCustomLabel] = useState('')
  const [showPresets, setShowPresets] = useState(false)
  const open = check && !check.closed
  const present = check?.present || {}
  const missing = members.filter((m) => !present[m.id])
  const presentMembers = members.filter((m) => present[m.id])

  const PRESETS = ['Departing hotel 🏨', 'Beach rendezvous 🏖️', 'Dinner meetup 🍽️', 'Bus boarding 🚌']

  function startCheck(label) {
    add(tripId, 'headcounts', {
      label: label || 'Headcount',
      present: { [uid]: true },
      by: uid,
      closed: false,
    })
    setCustomLabel('')
    setShowPresets(false)
  }

  if (!open) {
    return (
      <section className="bg-white rounded-2xl p-4 border border-[#E7E5E4] shadow-warm-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-600 animate-pulse" />
            <h3 className="font-bold text-xs uppercase tracking-wider text-[#1C1917]">
              Group Pulse
            </h3>
          </div>
          <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            All {members.length} Synced
          </span>
        </div>

        <p className="text-xs text-[#78716C]">
          Moving to the next spot? Start a quick headcount so everyone can confirm presence in 1 tap.
        </p>

        {showPresets ? (
          <div className="space-y-2 pt-1 animate-fade-in">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => startCheck(p)}
                  className="text-xs bg-[#FAF9F6] hover:bg-stone-100 text-stone-800 font-medium px-2.5 py-1.5 rounded-lg border border-stone-200 transition"
                >
                  {p}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2 pt-1"
              onSubmit={(e) => {
                e.preventDefault()
                if (customLabel.trim()) startCheck(customLabel.trim())
              }}
            >
              <input
                className="input text-xs py-1.5"
                placeholder="e.g. Leaving cafe"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
              />
              <button className="btn text-xs py-1.5 shrink-0">Start</button>
              <button
                type="button"
                onClick={() => setShowPresets(false)}
                className="btn-ghost text-xs py-1.5 px-2.5 shrink-0"
              >
                ✕
              </button>
            </form>
          </div>
        ) : (
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowPresets(true)}
              className="btn flex-1 text-xs py-2 text-center"
            >
              🚌 Start Headcount Check
            </button>
          </div>
        )}

        <div className="pt-1 text-center">
          <button
            type="button"
            onClick={() => setTab && setTab('more')}
            className="text-[10px] text-stone-400 hover:text-stone-600 transition inline-flex items-center gap-1 font-medium"
          >
            <span>🛡️</span> Yatra Trip Safety & SOS Protocol
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="bg-white rounded-2xl p-4 border-2 border-emerald-600/30 shadow-warm-sm space-y-3.5">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest block">Active Check-In</span>
          <h3 className="font-serif-editorial text-lg font-medium text-[#1C1917] leading-tight">
            🚌 {check.label}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
            {presentMembers.length} of {members.length} Assembled
          </span>
          <button
            type="button"
            className="text-xs text-stone-400 hover:text-stone-700 underline"
            onClick={() => update(tripId, 'headcounts', check.id, { closed: true })}
          >
            Close
          </button>
        </div>
      </div>

      {/* Member Avatar Presence Grid */}
      <div className="bg-[#FAF9F6] p-3 rounded-xl border border-[#E7E5E4] space-y-2">
        <div className="flex items-center justify-between text-xs text-stone-600">
          <span className="font-medium">Checked-in travelers</span>
          <span className="text-[11px] text-stone-400">{Math.round((presentMembers.length / members.length) * 100)}%</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => {
            const isHere = Boolean(present[m.id])
            return (
              <span
                key={m.id}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition ${
                  isHere
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-semibold'
                    : 'bg-stone-100 border-stone-200 text-stone-400 opacity-70'
                }`}
                title={isHere ? `${m.name} is here` : `Waiting for ${m.name}`}
              >
                <span>{isHere ? '✓' : '⏱️'}</span>
                <span>{m.name}{m.id === uid ? ' (you)' : ''}</span>
              </span>
            )
          })}
        </div>

        {missing.length > 0 && (
          <p className="text-[11px] text-amber-900 pt-1">
            Waiting for: <b>{missing.map((m) => byId[m.id]?.name || m.name).join(', ')}</b>
          </p>
        )}
        {missing.length === 0 && (
          <p className="text-[11px] text-emerald-800 font-bold pt-1">
            Everyone's here — let's roll! 🎉
          </p>
        )}
      </div>

      {/* Interactive check-in CTA */}
      <div className="flex items-center gap-2 pt-0.5">
        {!present[uid] ? (
          <button
            type="button"
            className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs py-2.5 px-3 rounded-xl shadow-sm transition active:scale-[0.98]"
            onClick={() => update(tripId, 'headcounts', check.id, { [`present.${uid}`]: true })}
          >
            ✋ I am Here
          </button>
        ) : (
          <div className="flex-1 bg-emerald-50 text-emerald-800 font-semibold text-xs py-2.5 text-center rounded-xl border border-emerald-200">
            ✓ You are Checked In
          </div>
        )}

        {missing.length > 0 && (
          <WhatsAppButton
            className="flex-1 text-xs py-2.5"
            label="Ping WhatsApp"
            text={`🚌 *${check.label}* — Headcount!\nStill waiting for: ${missing.map((m) => byId[m.id]?.name || m.name).join(', ')}\nOpen Yatra and tap "I'm here" 👉 ${tripLink(tripId)}`}
          />
        )}
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Pillar 4: Expedition Kitty & Financial Glance                              */
/* -------------------------------------------------------------------------- */
export function ExpeditionKitty({ myBal, totalSpend, setTab }) {
  const isOwed = myBal > 0.5
  const owes = myBal < -0.5

  return (
    <section className="bg-white rounded-2xl p-4 border border-[#E7E5E4] shadow-warm-sm flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div
          className={`size-10 rounded-xl flex items-center justify-center font-bold text-sm border ${
            isOwed
              ? 'bg-[#DCFCE7] text-[#15803D] border-emerald-300'
              : owes
              ? 'bg-[#FFEDD5] text-[#C2410C] border-orange-300'
              : 'bg-stone-100 text-stone-600 border-stone-200'
          }`}
        >
          ₹
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#78716C] block">
            Expedition Kitty
          </span>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span
              className={`text-sm font-bold ${
                isOwed ? 'text-[#15803D]' : owes ? 'text-[#C2410C]' : 'text-stone-800'
              }`}
            >
              {isOwed ? `+${inr(myBal)}` : owes ? `-${inr(-myBal)}` : 'All settled 👌'}
            </span>
            <span className="text-[11px] text-stone-500 font-medium">
              {isOwed ? 'owed to you' : owes ? 'you owe' : `• ${inr(totalSpend)} total`}
            </span>
          </div>
        </div>
      </div>

      {setTab && (
        <button
          type="button"
          onClick={() => setTab('money')}
          className="text-xs font-semibold text-[#C2410C] bg-[#FFEDD5]/70 hover:bg-[#FFEDD5] px-3 py-1.5 rounded-lg transition active:scale-[0.98]"
        >
          {isOwed || owes ? 'Settle Up →' : 'Expenses →'}
        </button>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Pillar 5: Chronological Waypoint Trail                                     */
/* -------------------------------------------------------------------------- */
export function WaypointTimeline({ items, showDate, day, setTab, activeItemId }) {
  return (
    <section className="space-y-3.5 pt-1">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-serif-editorial text-xl font-medium text-[#1C1917]">
            {day ? "Today's Trail & Waypoints" : 'Coming Up on the Itinerary'}
          </h3>
          <p className="text-[11px] text-[#78716C] mt-0.5">
            {items.length} {items.length === 1 ? 'stop' : 'stops'} scheduled
          </p>
        </div>

        {items.length > 0 && setTab && (
          <button
            type="button"
            onClick={() => {
              const firstWithCoords = items.find((i) => i.lat && i.lng) || items[0]
              if (firstWithCoords) {
                sessionStorage.setItem('yatra:map_focus', JSON.stringify({
                  id: firstWithCoords.id,
                  date: firstWithCoords.date,
                  lat: firstWithCoords.lat,
                  lng: firstWithCoords.lng,
                  title: firstWithCoords.title,
                  place: firstWithCoords.place,
                }))
              }
              setTab('map')
            }}
            className="text-xs text-[#C2410C] bg-[#FFEDD5] border border-[#C2410C]/25 px-2.5 py-1 rounded-full font-semibold hover:bg-[#fed7aa] transition"
          >
            🗺️ Open Route Map
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-2xl p-6 border border-[#E7E5E4] text-center space-y-2">
          <span className="text-3xl block">🎒</span>
          <p className="font-serif-editorial text-base text-[#1C1917]">Nothing planned for this day yet.</p>
          <p className="text-xs text-stone-500">
            Add scenic viewpoints, artisan cafes, or coastal trails in the Plan tab.
          </p>
          {setTab && (
            <button
              type="button"
              onClick={() => setTab('plan')}
              className="btn text-xs py-2 px-4 mt-2"
            >
              + Add Stops in Plan
            </button>
          )}
        </div>
      ) : (
        /* Vertical continuous connecting spine */
        <div className="relative pl-6 space-y-4 before:content-[''] before:absolute before:left-[11px] before:top-3 before:bottom-4 before:w-[1.5px] before:bg-[#E7E5E4]">
          {items.map((i, idx) => {
            const isActive = i.id === activeItemId
            const config = KIND_CONFIG[i.kind] || KIND_CONFIG.place
            const nowHHMM = new Date().toTimeString().slice(0, 5)
            const isCompleted = day && i.time && i.time < nowHHMM && !isActive

            return (
              <div key={i.id} className="relative group">
                {/* Node indicator */}
                <span
                  className={`absolute -left-[23px] top-1.5 size-5 rounded-full border-2 flex items-center justify-center text-[9px] font-bold transition ${
                    isActive
                      ? 'bg-[#C2410C] border-white text-white ring-4 ring-[#C2410C]/20 shadow-sm'
                      : isCompleted
                      ? 'bg-emerald-100 border-emerald-600 text-emerald-800'
                      : 'bg-white border-stone-300 text-stone-500'
                  }`}
                >
                  {isCompleted ? '✓' : idx + 1}
                </span>

                {/* Waypoint card */}
                <div
                  className={`bg-white rounded-xl p-3.5 border transition ${
                    isActive
                      ? 'border-[#C2410C]/70 shadow-warm-md'
                      : 'border-[#E7E5E4] shadow-warm-sm hover:border-stone-300'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className={`font-semibold ${isActive ? 'text-[#C2410C]' : 'text-stone-500'}`}>
                      {formatTime12(i.time)}
                      {isActive && ' • Active Next'}
                      {isCompleted && ' • Completed'}
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${config.badge}`}>
                      {config.icon} {config.label}
                    </span>
                  </div>

                  <h4 className="text-sm font-semibold text-[#1C1917] leading-snug">
                    {i.title}
                  </h4>

                  {i.place && (
                    <div className="flex items-center justify-between gap-2 mt-1 pt-1 border-t border-stone-100 text-xs">
                      <p className="text-stone-500 truncate flex items-center gap-1">
                        📍 {i.place}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {setTab && (
                          <button
                            type="button"
                            onClick={() => {
                              sessionStorage.setItem('yatra:map_focus', JSON.stringify({
                                id: i.id,
                                date: i.date,
                                lat: i.lat,
                                lng: i.lng,
                                title: i.title,
                                place: i.place,
                              }))
                              setTab('map')
                            }}
                            className="text-[11px] bg-stone-50 border border-stone-200 text-stone-700 hover:bg-stone-100 px-2 py-0.5 rounded font-medium transition"
                          >
                            🗺️ Map
                          </button>
                        )}
                        <MapLink place={i.place} />
                      </div>
                    </div>
                  )}

                  {(i.notes || i.why) && (
                    <p className="text-[11px] text-stone-500 italic mt-1.5 bg-[#FAF9F6] p-1.5 rounded-lg border border-stone-100">
                      "{i.notes || i.why}"
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Destination Telemetry & Solar Hook                                         */
/* -------------------------------------------------------------------------- */
function useDestinationTelemetry(trip, todays) {
  const [weather, setWeather] = useState(() => {
    return getDefaultThemeWeather(trip?.theme)
  })

  // 1. Solar tracker (Sunset / Golden hour countdown)
  const sunsetInfo = useMemo(() => {
    const now = new Date()
    const sunset = new Date(now)
    sunset.setHours(18, 0, 0, 0) // ~6:00 PM sunset
    const diffMs = sunset - now
    const diffMins = Math.round(diffMs / 60000)

    if (diffMins > 60) {
      const hrs = Math.floor(diffMins / 60)
      const mins = diffMins % 60
      return `🌅 Sunset in ${hrs}h ${mins > 0 ? `${mins}m` : ''}`
    }
    if (diffMins > 0) return `🌅 Sunset in ${diffMins}m`
    if (diffMins > -60) return '✨ Golden Hour'
    return '🌙 Night Sky'
  }, [])

  // 2. Fetch live Open-Meteo weather if coordinates are available
  useEffect(() => {
    const stopWithCoords = todays.find((i) => typeof i.lat === 'number' && typeof i.lng === 'number')
    if (!stopWithCoords) return

    const { lat, lng } = stopWithCoords
    const cacheKey = `yatra:weather:${lat.toFixed(2)}:${lng.toFixed(2)}`
    const cached = sessionStorage.getItem(cacheKey)

    if (cached) {
      try {
        const { temp, text, time } = JSON.parse(cached)
        if (Date.now() - time < 30 * 60 * 1000) {
          setWeather(`${Math.round(temp)}°C • ${text}`)
          return
        }
      } catch {}
    }

    const abortController = new AbortController()
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code`,
      { signal: abortController.signal }
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.current) return
        const temp = data.current.temperature_2m
        const code = data.current.weather_code
        const text = interpretWeatherCode(code)
        setWeather(`${Math.round(temp)}°C • ${text}`)
        sessionStorage.setItem(cacheKey, JSON.stringify({ temp, text, time: Date.now() }))
      })
      .catch(() => {})

    return () => abortController.abort()
  }, [todays])

  return { weather, sunsetInfo }
}

export function interpretWeatherCode(code) {
  if (code === 0) return 'Clear Skies ☀️'
  if ([1, 2, 3].includes(code)) return 'Partly Cloudy 🌤️'
  if ([45, 48].includes(code)) return 'Coastal Mist 🌫️'
  if ([51, 53, 55, 61, 63, 65].includes(code)) return 'Light Rain 🌦️'
  if ([80, 81, 82].includes(code)) return 'Passing Showers 🌧️'
  if ([95, 96, 99].includes(code)) return 'Thunderstorm ⛈️'
  return 'Breezy 🍃'
}

export function getDefaultThemeWeather(themeId = 'beach') {
  switch (themeId) {
    case 'mountains':
      return '16°C • Crisp Mountain Air 🏔️'
    case 'heritage':
      return '24°C • Golden Heritage Breeze 🏰'
    case 'nature':
      return '22°C • Evergreen Canopy 🌿'
    case 'desert':
      return '29°C • Warm Dune Breeze 🐪'
    case 'city':
      return '23°C • Clear Metro Sky 🏛️'
    case 'party':
      return '26°C • Balmy Evening 🪩'
    default:
      return '28°C • Sunny Coastal Breeze 🏖️'
  }
}

/* -------------------------------------------------------------------------- */
/* Backward Compatible MapLink Export                                         */
/* -------------------------------------------------------------------------- */
export const MapLink = ({ place }) => (
  <a
    className="text-xs text-[#C2410C] font-semibold underline hover:text-[#9A3412] transition"
    target="_blank"
    rel="noreferrer"
    href={
      /^https?:/.test(place)
        ? place
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`
    }
  >
    {/^https?:/.test(place) ? 'Open Map 📍' : 'Google Maps ↗'}
  </a>
)
