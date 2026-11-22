import { useState, useMemo, useEffect } from 'react'
import { useCol } from '../data'
import { getTheme } from '../themes'
import { inr } from '../settle'
import { fmtRange } from '../dates'
import Packing from './Packing'
import Polls from './Polls'
import People from './People'
import Summary from './Summary'
import Safety from './Safety'
import Places from './Places'
import TravelToolkit from './TravelToolkit'

// Section definitions with metadata
const SECTIONS = [
  { id: 'hub', label: 'Command Hub', icon: '🏠', component: null },
  { id: 'polls', label: 'Polls', icon: '📊', component: Polls },
  { id: 'pack', label: 'Packing', icon: '🎒', component: Packing },
  { id: 'places', label: 'Places', icon: '📍', component: Places },
  { id: 'group', label: 'Crew', icon: '👥', component: People },
  { id: 'safety', label: 'Safety & Vault', icon: '🛡️', component: Safety },
  { id: 'summary', label: 'Wrapped', icon: '🎉', component: Summary },
  { id: 'tools', label: 'Toolkit', icon: '🧰', component: TravelToolkit },
]

export default function More(props) {
  const { tripId, trip, uid, me, members = [], byId = {} } = props

  // Live Firestore collections for real-time dynamic intelligence
  const polls = useCol(tripId, 'polls')
  const packItems = useCol(tripId, 'packing')
  const places = useCol(tripId, 'places')
  const docs = useCol(tripId, 'documents')
  const customContacts = useCol(tripId, 'emergency_contacts')
  const expenses = useCol(tripId, 'expenses')
  const planItems = useCol(tripId, 'plan')
  const photos = useCol(tripId, 'photos')

  // Screen selection state (defaults to 'hub' for rich dashboard overview)
  const [activeSection, setActiveSection] = useState(() => {
    try {
      return sessionStorage.getItem('yatra:more') || 'hub'
    } catch {
      return 'hub'
    }
  })

  // Modals & UI states
  const [showSosModal, setShowSosModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedLink, setCopiedLink] = useState(false)

  const pickSection = (sectionId) => {
    setActiveSection(sectionId)
    try {
      sessionStorage.setItem('yatra:more', sectionId)
    } catch {}
    // Scroll smoothly to top
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Real-time Dynamic Metrics Calculations
  // 1. Polls Intelligence
  const openPolls = useMemo(() => polls.filter((p) => !p.closed), [polls])
  const unvotedPolls = useMemo(
    () => openPolls.filter((p) => !p.votes || p.votes[uid] === undefined),
    [openPolls, uid]
  )
  const latestOpenPoll = openPolls[0]

  // 2. Packing Intelligence
  const totalPackItems = packItems.length
  const packedItems = packItems.filter((i) => i.done).length
  const packProgressPct = totalPackItems > 0 ? Math.round((packedItems / totalPackItems) * 100) : 0
  const myPackItems = packItems.filter((i) => i.owner === uid)
  const myPackedCount = myPackItems.filter((i) => i.done).length

  // 3. Places Intelligence
  const totalPlaces = places.length
  const placeCategories = useMemo(() => {
    const counts = {}
    places.forEach((p) => {
      const c = p.category || 'other'
      counts[c] = (counts[c] || 0) + 1
    })
    return counts
  }, [places])

  // 4. Group Intelligence
  const upiLinkedCount = useMemo(() => members.filter((m) => Boolean(m.upi)).length, [members])

  // 5. Financial Overview
  const totalExpenses = useMemo(
    () => expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
    [expenses]
  )

  // 6. Trip Countdown & Status
  const tripTiming = useMemo(() => {
    if (!trip?.start) {
      return { status: 'tbd', label: 'Dates to be decided', badge: '🗓️ Dates TBD', color: 'bg-slate-100 text-slate-700' }
    }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const s = new Date(trip.start + 'T00:00')
    const e = trip.end ? new Date(trip.end + 'T00:00') : s
    s.setHours(0, 0, 0, 0)
    e.setHours(0, 0, 0, 0)

    const diffDays = Math.round((s.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays > 0) {
      return {
        status: 'upcoming',
        label: diffDays === 1 ? 'Starts tomorrow!' : `Departs in ${diffDays} days`,
        badge: `🚀 ${diffDays}d to go`,
        color: 'bg-emerald-500/20 text-emerald-100 border border-emerald-400/30',
      }
    } else if (today >= s && today <= e) {
      const dayNum = Math.round((today.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
      const totalDays = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
      return {
        status: 'active',
        label: `Day ${dayNum} of ${totalDays} · Trip is live!`,
        badge: '🟢 Ongoing Trip',
        color: 'bg-teal-400 text-teal-950 font-bold',
      }
    } else {
      return {
        status: 'completed',
        label: 'Trip completed',
        badge: '✨ Memories',
        color: 'bg-white/20 text-white/90 border border-white/30',
      }
    }
  }, [trip?.start, trip?.end])

  // 7. Dynamic Trip Readiness / Health Meter (0 - 100%)
  const readiness = useMemo(() => {
    let score = 0
    // Packing readiness (up to 30 pts)
    if (totalPackItems > 0) {
      score += Math.round((packedItems / totalPackItems) * 30)
    } else {
      score += 5
    }
    // Itinerary stops (up to 25 pts)
    if (planItems.length >= 5) score += 25
    else if (planItems.length > 0) score += planItems.length * 5
    // Safety & emergency preparedness (up to 25 pts)
    if (docs.length > 0 || customContacts.length > 0) score += 25
    // Group & coordination (up to 20 pts)
    if (members.length >= 2) score += 20
    else score += 10

    const clamped = Math.min(100, Math.max(10, score))
    let feedback = 'Trip prep just getting started'
    if (clamped >= 85) feedback = 'Pack & prep complete! Ready for take-off ✈️'
    else if (clamped >= 60) feedback = 'Good progress! Check remaining packing & docs 🎒'
    else if (clamped >= 40) feedback = 'Planning in motion · Add stops & gear 📍'

    return { score: clamped, feedback }
  }, [totalPackItems, packedItems, planItems.length, docs.length, customContacts.length, members.length])

  // Quick invite link copier
  const copyInvite = async () => {
    const link = `${location.origin}${location.pathname}#/t/${tripId}`
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(link).catch(() => {})
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2500)
    }
  }

  // Active theme info
  const theme = getTheme(trip?.theme)

  // Filtered Cards for search
  const query = searchQuery.trim().toLowerCase()

  // Find active screen component
  const CurrentScreenComponent = SECTIONS.find((s) => s.id === activeSection)?.component

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------- */}
      {/* Top Header & Sticky Navigation Bar */}
      {/* ---------------------------------------------------- */}
      <div className="space-y-2">
        {activeSection !== 'hub' && (
          <div className="flex items-center justify-between gap-2 pb-1">
            <button
              type="button"
              onClick={() => pickSection('hub')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 transition active:scale-95 shadow-2xs"
            >
              <span>←</span>
              <span>Hub Overview</span>
            </button>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <span>More</span>
              <span>›</span>
              <span className="text-teal-800 font-bold capitalize">
                {SECTIONS.find((s) => s.id === activeSection)?.label}
              </span>
            </div>
          </div>
        )}

        {/* Dynamic Horizontal Pill Bar with Real-Time Badges */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar scroll-smooth">
          {SECTIONS.map((sec) => {
            const isActive = activeSection === sec.id
            // Calculate dynamic badge for each section
            let badge = null
            if (sec.id === 'polls' && unvotedPolls.length > 0) {
              badge = <span className="size-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            } else if (sec.id === 'pack' && totalPackItems > 0) {
              badge = (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  isActive ? 'bg-teal-900/40 text-teal-100' : 'bg-slate-200 text-slate-700'
                }`}>
                  {packProgressPct}%
                </span>
              )
            } else if (sec.id === 'places' && totalPlaces > 0) {
              badge = (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  isActive ? 'bg-teal-900/40 text-teal-100' : 'bg-slate-200 text-slate-700'
                }`}>
                  {totalPlaces}
                </span>
              )
            } else if (sec.id === 'safety' && (docs.length > 0 || customContacts.length > 0)) {
              badge = (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  isActive ? 'bg-teal-900/40 text-teal-100' : 'bg-slate-200 text-slate-700'
                }`}>
                  {docs.length}
                </span>
              )
            }

            return (
              <button
                key={sec.id}
                onClick={() => pickSection(sec.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-teal-700 text-white shadow-sm ring-1 ring-teal-800/30 font-bold scale-[1.02]'
                    : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <span>{sec.icon}</span>
                <span className="truncate">{sec.label}</span>
                {badge}
              </button>
            )
          })}
        </div>
      </div>

      {/* ---------------------------------------------------- */}
      {/* Sub-Screen Rendering Mode */}
      {/* ---------------------------------------------------- */}
      {activeSection !== 'hub' && CurrentScreenComponent && (
        <div className="animate-fade-in space-y-4">
          <CurrentScreenComponent
            {...props}
            planItems={planItems}
            expenses={expenses}
            places={places}
            emergencyContacts={customContacts}
          />
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Command Hub Dashboard Mode (Overview) */}
      {/* ---------------------------------------------------- */}
      {activeSection === 'hub' && (
        <div className="space-y-4 animate-fade-in">
          {/* 1. Hero Trip Command Card */}
          <section className={`card relative overflow-hidden text-white shadow-xl bg-gradient-to-br ${theme.gradient} border-0`}>
            {/* Subtle glow / ornament */}
            <div className="absolute -top-12 -right-12 size-36 rounded-full bg-white/10 blur-2xl pointer-events-none" />

            <div className="relative z-10 space-y-3">
              {/* Header Row: Timing badge + theme icon */}
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${tripTiming.color}`}>
                  {tripTiming.badge}
                </span>
                <span className="text-xl">{theme.icon}</span>
              </div>

              {/* Title & Dates */}
              <div>
                <h2 className="text-xl font-black tracking-tight leading-tight">{trip?.name}</h2>
                <p className="text-xs text-white/80 mt-0.5 font-medium">
                  {fmtRange(trip?.start, trip?.end)} · {members.length} {members.length === 1 ? 'traveler' : 'travelers'}
                </p>
                <p className="text-[11px] text-white/70 mt-0.5">{tripTiming.label}</p>
              </div>

              {/* Dynamic Readiness Meter */}
              <div className="pt-2 border-t border-white/15 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white/90">Trip Readiness Index</span>
                  <span className="font-black font-mono text-white">{readiness.score}%</span>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-black/25 rounded-full h-2.5 overflow-hidden p-0.5">
                  <div
                    className="bg-teal-300 h-full rounded-full transition-all duration-700 ease-out shadow-xs"
                    style={{ width: `${readiness.score}%` }}
                  />
                </div>
                <p className="text-[10px] text-white/75 italic">{readiness.feedback}</p>
              </div>

              {/* Quick Action Chips Bar */}
              <div className="grid grid-cols-4 gap-1.5 pt-2">
                <button
                  type="button"
                  onClick={copyInvite}
                  className="py-2 px-1 rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur-xs text-center flex flex-col items-center justify-center gap-0.5 transition active:scale-95 text-white"
                >
                  <span className="text-sm">{copiedLink ? '✓' : '🔗'}</span>
                  <span className="text-[10px] font-semibold truncate">
                    {copiedLink ? 'Copied!' : 'Invite'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowSosModal(true)}
                  className="py-2 px-1 rounded-xl bg-rose-500/30 hover:bg-rose-500/40 border border-rose-300/30 backdrop-blur-xs text-center flex flex-col items-center justify-center gap-0.5 transition active:scale-95 text-rose-100 font-semibold"
                >
                  <span className="text-sm">🚨</span>
                  <span className="text-[10px] truncate">Emergency</span>
                </button>

                <button
                  type="button"
                  onClick={() => pickSection('tools')}
                  className="py-2 px-1 rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur-xs text-center flex flex-col items-center justify-center gap-0.5 transition active:scale-95 text-white"
                >
                  <span className="text-sm">💱</span>
                  <span className="text-[10px] font-semibold truncate">FX & Tools</span>
                </button>

                <button
                  type="button"
                  onClick={() => pickSection('summary')}
                  className="py-2 px-1 rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur-xs text-center flex flex-col items-center justify-center gap-0.5 transition active:scale-95 text-white"
                >
                  <span className="text-sm">🎉</span>
                  <span className="text-[10px] font-semibold truncate">Wrapped</span>
                </button>
              </div>
            </div>
          </section>

          {/* 2. Interactive Feature Search & Quick Filter */}
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tools, gear, places, currency, vault…"
              className="input pl-9 pr-8 text-xs py-2.5 rounded-xl border-slate-200 shadow-2xs placeholder:text-slate-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 size-5 grid place-items-center"
              >
                ✕
              </button>
            )}
          </div>

          {/* ---------------------------------------------------- */}
          {/* Section: Trip Coordination & Group Planning */}
          {/* ---------------------------------------------------- */}
          {(!query || 'polls decisions vote pack packing gear places saved crew members people'.includes(query)) && (
            <div className="space-y-2.5">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1 flex items-center justify-between">
                <span>Trip Coordination</span>
                <span className="text-[10px] font-semibold text-teal-700">Live Sync</span>
              </h3>

              <div className="grid grid-cols-1 gap-2.5">
                {/* A. Live Polls Card */}
                {(!query || 'polls decisions vote questions debate'.includes(query)) && (
                  <div
                    onClick={() => pickSection('polls')}
                    className="card hover:border-teal-400 hover:shadow-md transition cursor-pointer space-y-2.5 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="size-8 rounded-xl bg-violet-100 text-violet-700 grid place-items-center text-sm font-bold">
                          📊
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm group-hover:text-teal-800 transition">
                            Group Polls & Debates
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            {openPolls.length === 0
                              ? 'No open debates'
                              : `${openPolls.length} active ${openPolls.length === 1 ? 'poll' : 'polls'}`}
                          </p>
                        </div>
                      </div>

                      {unvotedPolls.length > 0 ? (
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full animate-pulse flex items-center gap-1">
                          <span>⚠️</span>
                          <span>Vote needed ({unvotedPolls.length})</span>
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 font-semibold group-hover:translate-x-0.5 transition">
                          View →
                        </span>
                      )}
                    </div>

                    {/* Poll Snippet / Teaser */}
                    {latestOpenPoll ? (
                      <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-100 text-xs">
                        <p className="font-semibold text-slate-800 truncate">
                          "{latestOpenPoll.question}"
                        </p>
                        <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                          <span>{latestOpenPoll.options?.length || 0} options available</span>
                          <span>
                            {Object.keys(latestOpenPoll.votes || {}).length} votes cast
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400 italic">
                        Tap to create a quick poll for dinner, stays, or activities.
                      </p>
                    )}
                  </div>
                )}

                {/* B. Smart Packing Card */}
                {(!query || 'pack packing gear luggage checklist clothes items'.includes(query)) && (
                  <div
                    onClick={() => pickSection('pack')}
                    className="card hover:border-teal-400 hover:shadow-md transition cursor-pointer space-y-2.5 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="size-8 rounded-xl bg-emerald-100 text-emerald-700 grid place-items-center text-sm font-bold">
                          🎒
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm group-hover:text-teal-800 transition">
                            Packing Checklist
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            {totalPackItems === 0
                              ? 'No items added yet'
                              : `${packedItems} of ${totalPackItems} items packed`}
                          </p>
                        </div>
                      </div>

                      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        {packProgressPct}%
                      </span>
                    </div>

                    {/* Visual Progress Bar */}
                    <div className="space-y-1">
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-emerald-600 h-full rounded-full transition-all duration-500"
                          style={{ width: `${packProgressPct}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span>
                          {totalPackItems - packedItems === 0
                            ? '🎉 All gear packed!'
                            : `${totalPackItems - packedItems} items remaining`}
                        </span>
                        {myPackItems.length > 0 && (
                          <span>My gear: {myPackedCount}/{myPackItems.length}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* C. Saved Places & Highlights */}
                {(!query || 'places map spots food restaurants sights cafes saved gems'.includes(query)) && (
                  <div
                    onClick={() => pickSection('places')}
                    className="card hover:border-teal-400 hover:shadow-md transition cursor-pointer space-y-2.5 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="size-8 rounded-xl bg-amber-100 text-amber-700 grid place-items-center text-sm font-bold">
                          📍
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm group-hover:text-teal-800 transition">
                            Saved Places & Gems
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            {totalPlaces === 0
                              ? 'Pin food, viewpoints & hotels'
                              : `${totalPlaces} spots saved for this trip`}
                          </p>
                        </div>
                      </div>

                      <span className="text-xs text-slate-400 font-semibold group-hover:translate-x-0.5 transition">
                        Map →
                      </span>
                    </div>

                    {/* Category preview chips */}
                    {totalPlaces > 0 ? (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {Object.entries(placeCategories).slice(0, 4).map(([cat, count]) => (
                          <span
                            key={cat}
                            className="text-[10px] bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded-lg border border-slate-200 capitalize"
                          >
                            {cat}: {count}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400 italic">
                        Mark places you discover or want to visit together.
                      </p>
                    )}
                  </div>
                )}

                {/* D. Travel Gang & Split Readiness */}
                {(!query || 'group crew members people gang friends upi invite share'.includes(query)) && (
                  <div
                    onClick={() => pickSection('group')}
                    className="card hover:border-teal-400 hover:shadow-md transition cursor-pointer space-y-2.5 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="size-8 rounded-xl bg-blue-100 text-blue-700 grid place-items-center text-sm font-bold">
                          👥
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm group-hover:text-teal-800 transition">
                            Travel Crew & UPI
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            {members.length} {members.length === 1 ? 'member' : 'members'} · {upiLinkedCount}/{members.length} UPI ready
                          </p>
                        </div>
                      </div>

                      <span className="text-xs text-teal-700 font-bold hover:underline">
                        Invite +
                      </span>
                    </div>

                    {/* Member Avatars Stack */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex -space-x-2 overflow-hidden">
                        {members.slice(0, 6).map((m) => (
                          <div
                            key={m.id}
                            className="size-7 rounded-full bg-teal-800 text-white font-bold text-xs grid place-items-center ring-2 ring-white shadow-xs"
                            title={m.name || 'Member'}
                          >
                            {(m.name || '?')[0].toUpperCase()}
                          </div>
                        ))}
                        {members.length > 6 && (
                          <div className="size-7 rounded-full bg-slate-200 text-slate-700 font-bold text-[10px] grid place-items-center ring-2 ring-white">
                            +{members.length - 6}
                          </div>
                        )}
                      </div>

                      <span className="text-[11px] text-slate-500 font-medium">
                        {trip?.createdBy === uid ? '👑 You organize' : 'Collaborating'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---------------------------------------------------- */}
          {/* Section: Safety, Vault & Trip Memories */}
          {/* ---------------------------------------------------- */}
          {(!query || 'safety vault documents tickets insurance emergency sos wrapped summary highlights'.includes(query)) && (
            <div className="space-y-2.5">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1 flex items-center justify-between">
                <span>Safety & Memories</span>
                <span className="text-[10px] font-semibold text-rose-600">Secure</span>
              </h3>

              <div className="grid grid-cols-2 gap-2.5">
                {/* Safety & Vault Card */}
                {(!query || 'safety vault documents tickets emergency sos'.includes(query)) && (
                  <div
                    onClick={() => pickSection('safety')}
                    className="card hover:border-rose-400 hover:shadow-md transition cursor-pointer space-y-2 flex flex-col justify-between group"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="size-8 rounded-xl bg-rose-100 text-rose-700 grid place-items-center text-sm font-bold">
                          🛡️
                        </div>
                        <span className="text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.2 rounded-full">
                          {docs.length} Docs
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-900 text-xs group-hover:text-teal-800 transition leading-tight">
                        Safety & Vault
                      </h4>
                      <p className="text-[10px] text-slate-500">
                        {customContacts.length} custom emergency contacts
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowSosModal(true)
                      }}
                      className="w-full py-1 text-[10px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200 transition"
                    >
                      🚨 Quick SOS
                    </button>
                  </div>
                )}

                {/* Wrapped / Highlights Card */}
                {(!query || 'wrapped summary highlights stats photos expenses total'.includes(query)) && (
                  <div
                    onClick={() => pickSection('summary')}
                    className="card hover:border-teal-400 hover:shadow-md transition cursor-pointer space-y-2 flex flex-col justify-between group"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="size-8 rounded-xl bg-amber-100 text-amber-700 grid place-items-center text-sm font-bold">
                          🎉
                        </div>
                        <span className="text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200 px-1.5 py-0.2 rounded-full">
                          {photos.length} Photos
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-900 text-xs group-hover:text-teal-800 transition leading-tight">
                        Trip Wrapped
                      </h4>
                      <p className="text-[10px] text-slate-500 font-mono">
                        {inr(totalExpenses)} spent overall
                      </p>
                    </div>

                    <span className="text-[10px] font-bold text-teal-700 hover:underline block text-center py-1">
                      View Story →
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---------------------------------------------------- */}
          {/* Section: Smart Travel Utilities Suite */}
          {/* ---------------------------------------------------- */}
          {(!query || 'tools toolkit currency fx exchange converter clock timezone time phrasebook phrases words export print pdf'.includes(query)) && (
            <div className="space-y-2.5">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1 flex items-center justify-between">
                <span>Travel Toolkit & Utilities</span>
                <span className="text-[10px] font-semibold text-teal-700">Essential</span>
              </h3>

              <div className="grid grid-cols-2 gap-2.5">
                {/* Currency Converter Shortcut Card */}
                <div
                  onClick={() => pickSection('tools')}
                  className="card hover:border-teal-400 hover:shadow-md transition cursor-pointer space-y-1.5 group p-3.5"
                >
                  <div className="size-7 rounded-lg bg-teal-100 text-teal-800 grid place-items-center text-xs font-bold">
                    💱
                  </div>
                  <h4 className="font-bold text-slate-900 text-xs group-hover:text-teal-800 transition">
                    FX Converter
                  </h4>
                  <p className="text-[10px] text-slate-500 leading-tight">
                    12 global currencies with live & offline FX math.
                  </p>
                </div>

                {/* World & Destination Clock Shortcut Card */}
                <div
                  onClick={() => pickSection('tools')}
                  className="card hover:border-teal-400 hover:shadow-md transition cursor-pointer space-y-1.5 group p-3.5"
                >
                  <div className="size-7 rounded-lg bg-sky-100 text-sky-800 grid place-items-center text-xs font-bold">
                    ⏱️
                  </div>
                  <h4 className="font-bold text-slate-900 text-xs group-hover:text-teal-800 transition">
                    World Time
                  </h4>
                  <p className="text-[10px] text-slate-500 leading-tight">
                    Daylight & time differences for trip destination.
                  </p>
                </div>

                {/* Travel Phrasebook Shortcut Card */}
                <div
                  onClick={() => pickSection('tools')}
                  className="card hover:border-teal-400 hover:shadow-md transition cursor-pointer space-y-1.5 group p-3.5"
                >
                  <div className="size-7 rounded-lg bg-purple-100 text-purple-800 grid place-items-center text-xs font-bold">
                    🗣️
                  </div>
                  <h4 className="font-bold text-slate-900 text-xs group-hover:text-teal-800 transition">
                    Phrasebook
                  </h4>
                  <p className="text-[10px] text-slate-500 leading-tight">
                    Essential greetings, food, transit & medical phrases.
                  </p>
                </div>

                {/* Itinerary Exporter Shortcut Card */}
                <div
                  onClick={() => pickSection('tools')}
                  className="card hover:border-teal-400 hover:shadow-md transition cursor-pointer space-y-1.5 group p-3.5"
                >
                  <div className="size-7 rounded-lg bg-indigo-100 text-indigo-800 grid place-items-center text-xs font-bold">
                    📤
                  </div>
                  <h4 className="font-bold text-slate-900 text-xs group-hover:text-teal-800 transition">
                    Export Trip
                  </h4>
                  <p className="text-[10px] text-slate-500 leading-tight">
                    Generate WhatsApp briefing or print PDF schedule.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ---------------------------------------------------- */}
          {/* Quick Offline & App Info Footer */}
          {/* ---------------------------------------------------- */}
          <div className="pt-2 text-center space-y-1 text-slate-400">
            <p className="text-[11px] flex items-center justify-center gap-1.5 font-medium">
              <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
              <span>Real-time Cloud Sync Active</span>
              <span>·</span>
              <span>PWA Ready</span>
            </p>
            <p className="text-[10px]">
              Yatra Travel Hub · Built for frictionless group adventures
            </p>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Rapid Emergency SOS Modal */}
      {/* ---------------------------------------------------- */}
      {showSosModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setShowSosModal(false)}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-sm p-5 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🚨</span>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Emergency SOS</h3>
                  <p className="text-xs text-rose-600 font-medium">Instant 1-tap emergency dialer</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSosModal(false)}
                className="size-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 grid place-items-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Tap any number below to dial immediately from your phone.
            </p>

            {/* Default Emergency Numbers */}
            <div className="space-y-2">
              {[
                { name: 'National Emergency', num: '112', icon: '🚨' },
                { name: 'Ambulance / Medical', num: '108', icon: '🚑' },
                { name: 'Police Helpline', num: '100', icon: '🚓' },
                { name: 'Tourist Helpline', num: '1363', icon: '🧳' },
                { name: 'Women Helpline', num: '1091', icon: '👩' },
              ].map((item) => (
                <a
                  key={item.num}
                  href={`tel:${item.num}`}
                  className="flex items-center justify-between p-3 rounded-2xl bg-rose-50/60 border border-rose-200 hover:bg-rose-100 transition"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg">{item.icon}</span>
                    <div>
                      <p className="font-bold text-xs text-slate-900">{item.name}</p>
                      <p className="text-[11px] text-rose-700 font-mono font-semibold">{item.num}</p>
                    </div>
                  </div>
                  <span className="text-xs bg-rose-600 text-white font-bold px-3 py-1.5 rounded-xl shadow-xs">
                    Call 📞
                  </span>
                </a>
              ))}
            </div>

            {/* Custom Trip Contacts if available */}
            {customContacts.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <h4 className="text-xs font-bold text-slate-700">Trip Emergency Contacts:</h4>
                {customContacts.map((c) => (
                  <a
                    key={c.id}
                    href={`tel:${c.phone || c.num}`}
                    className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200 hover:bg-slate-100 transition"
                  >
                    <div>
                      <p className="font-bold text-xs text-slate-900">{c.name}</p>
                      <p className="text-[11px] text-slate-500 font-mono">{c.phone || c.num}</p>
                    </div>
                    <span className="text-xs bg-teal-700 text-white font-bold px-3 py-1.5 rounded-xl">
                      Call 📞
                    </span>
                  </a>
                ))}
              </div>
            )}

            {/* Jump to Full Safety & Vault Screen */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowSosModal(false)
                  pickSection('safety')
                }}
                className="w-full btn text-xs py-2.5 text-center block"
              >
                Open Safety Vault & Documents →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
