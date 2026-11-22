import { useEffect, useState, useCallback } from 'react'
import { refreshPush } from '../push'
import { useDoc, useCol, joinTrip, recordUserTrip, getLocalTrips } from '../data'
import { getTheme } from '../themes'
import ThemePickerModal from '../components/ThemePickerModal'
import TripSettings from '../components/TripSettings'
import { Center } from '../App'
import { GoogleButton, GuestForm, OrDivider, PrivacyNote, useGoogleSignIn, getSavedName } from '../components/Auth'
import Today from './Today'
import Plan from './Plan'
import Money from './Money'
import Photos from './Photos'
import MapScreen from './Map'
import More from './More'
import BottomNav from '../components/BottomNav'
import { VALID_TABS, getActiveTab, saveActiveTab } from '../tabRouter'
export { VALID_TABS, getActiveTab, saveActiveTab } from '../tabRouter'

const TABS = [
  ['today', '🏠', 'Today'],
  ['plan', '🗓️', 'Plan'],
  ['map', '📍', 'Map'],
  ['money', '💸', 'Money'],
  ['photos', '📸', 'Photos'],
  ['more', '☰', 'More'],
]

export default function Trip({ tripId, uid, onUserChange }) {
  const trip = useDoc(tripId)
  const members = useCol(tripId, 'members', 'joinedAt')
  const [tab, setTabState] = useState(() => getActiveTab(tripId))

  const setTab = useCallback((newTab) => {
    if (!VALID_TABS.includes(newTab)) return
    setTabState(newTab)
    saveActiveTab(tripId, newTab)
    const targetHash = `#/t/${tripId}/${newTab}`
    if (location.hash !== targetHash) {
      history.replaceState(null, '', targetHash)
    }
  }, [tripId])

  // Sync state if hash changes externally (e.g. browser Back/Forward)
  useEffect(() => {
    const onHashChange = () => {
      const active = getActiveTab(tripId)
      setTabState((prev) => (prev !== active ? active : prev))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [tripId])

  // Reset tab if tripId changes
  useEffect(() => {
    setTabState(getActiveTab(tripId))
  }, [tripId])

  // Ensure current tab is stored in sessionStorage and reflected in URL hash
  useEffect(() => {
    saveActiveTab(tripId, tab)
    const expectedHash = `#/t/${tripId}/${tab}`
    if (location.hash.startsWith(`#/t/${tripId}`) && location.hash !== expectedHash) {
      history.replaceState(null, '', expectedHash)
    }
  }, [tripId, tab])

  useEffect(() => {
    if (trip && trip.id) {
      recordUserTrip(uid, trip.id, {
        name: trip.name,
        start: trip.start,
        end: trip.end,
        theme: trip.theme,
        coverUrl: trip.coverUrl,
      })
    }
  }, [trip, uid])

  if (trip === undefined) return <Center><p className="text-slate-500">Loading trip…</p></Center>
  if (trip === null) return (
    <Center>
      <p>Trip not found.</p>
      <div className="flex gap-2 justify-center mt-4">
        <a className="btn inline-block text-xs" href="#/">My Trips</a>
        <a className="btn-ghost inline-block text-xs" href="#/">Start a new one</a>
      </div>
    </Center>
  )

  const me = members.find((m) => m.id === uid)
  if (!me) return <Join trip={trip} uid={uid} members={members} onUserChange={onUserChange} />
  return <TripInner {...{ tripId, trip, uid, me, members, tab, setTab }} />
}

function TripInner({ tripId, trip, uid, me, members, tab, setTab }) {
  const [toast, setToast] = useState(null)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [copied, setCopied] = useState(false)
  const myTrips = getLocalTrips().filter((t) => t.id !== tripId)
  const theme = getTheme(trip.theme)
  const hasCover = Boolean(trip.coverUrl)

  useEffect(() => {
    let off
    refreshPush(tripId, uid, (d) => {
      setToast(d)
      setTimeout(() => setToast(null), 6000)
    }).then((f) => { off = f })
    return () => off?.()
  }, [tripId, uid])

  async function copyLink() {
    const link = `${location.origin}/#/t/${tripId}`
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(link).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  const ctx = {
    tripId,
    trip,
    uid,
    me,
    members,
    byId: Object.fromEntries(members.map((m) => [m.id, m])),
    tab,
    setTab,
  }
  const Screen = { today: Today, plan: Plan, money: Money, photos: Photos, more: More, map: MapScreen }[tab]

  return (
    <div className="min-h-dvh max-w-md mx-auto pb-32">
      {/* Premium Sticky App Header */}
      <header
        className={`sticky top-0 z-20 text-white px-3 pt-[max(env(safe-area-inset-top),10px)] pb-2.5 shadow-md relative overflow-hidden transition-all ${
          hasCover ? 'bg-slate-950' : theme.headerBg
        }`}
      >
        {hasCover && (
          <img
            src={trip.coverUrl}
            alt="Trip Cover"
            className="absolute inset-0 size-full object-cover opacity-35 pointer-events-none"
          />
        )}
        <div className="relative z-10 flex items-center justify-between gap-2">
          {/* Back to Home / My Trips */}
          <a
            href="#/"
            aria-label="Back to My Trips"
            className="size-8 grid place-items-center rounded-lg bg-white/20 hover:bg-white/30 text-white transition shrink-0 backdrop-blur-xs"
          >
            ←
          </a>

          {/* Trip Switcher Dropdown Trigger */}
          <div className="flex-1 min-w-0 text-center">
            <button
              type="button"
              onClick={() => setShowSwitcher(!showSwitcher)}
              className="inline-flex items-center justify-center gap-1.5 max-w-full px-2 py-0.5 rounded-lg hover:bg-white/15 transition"
            >
              <span className="text-sm shrink-0">{theme.icon}</span>
              <h1 className="text-base font-bold truncate leading-tight">{trip.name}</h1>
              <span className="text-[10px] opacity-75">▼</span>
            </button>
            <p className="text-[11px] text-white/80 leading-none">
              {fmtRange(trip.start, trip.end)} · {members.length} people
            </p>
          </div>

          {/* Action Buttons: Theme Customizer + Share Link */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              aria-label="Trip settings: name, dates, theme"
              title="Edit trip name, dates, theme"
              onClick={() => setShowSettings(true)}
              className="size-8 grid place-items-center rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs font-medium transition backdrop-blur-xs"
            >
              ⚙️
            </button>
            <button
              type="button"
              aria-label="Copy invite link"
              onClick={copyLink}
              className="size-8 grid place-items-center rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs font-medium transition backdrop-blur-xs"
            >
              {copied ? '✓' : '🔗'}
            </button>
          </div>
        </div>

        {/* Copy Toast banner */}
        {copied && (
          <div className="relative z-10 mt-1 text-center text-[11px] text-white/95 bg-black/40 backdrop-blur-xs rounded py-0.5 animate-fade-in">
            Invite link copied! Share with friends.
          </div>
        )}
      </header>

      {showSettings && (
        <TripSettings tripId={tripId} trip={trip} uid={uid} onClose={() => setShowSettings(false)}
          onOpenTheme={() => { setShowSettings(false); setShowThemePicker(true) }} />
      )}

      {/* Destination Theme & Cover Picker Modal */}
      {showThemePicker && (
        <ThemePickerModal
          tripId={tripId}
          currentTheme={trip.theme}
          currentCoverUrl={trip.coverUrl}
          uid={uid}
          tripName={trip.name}
          onClose={() => setShowThemePicker(false)}
        />
      )}

      {/* Trip Switcher Modal / Dropdown */}
      {showSwitcher && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-xs flex items-start justify-center pt-16 px-4"
          onClick={() => setShowSwitcher(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-sm p-4 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-800">Switch Trip</h3>
              <a href="#/" className="text-xs text-teal-700 font-semibold hover:underline">
                All Trips →
              </a>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              <div className="p-2.5 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-xs text-teal-950">{trip.name}</p>
                  <p className="text-[10px] text-teal-700">Currently viewing</p>
                </div>
                <span className="text-xs text-teal-700 font-bold">✓</span>
              </div>

              {myTrips.map((t) => (
                <div
                  key={t.id}
                  onClick={() => {
                    setShowSwitcher(false)
                    location.hash = `#/t/${t.id}`
                  }}
                  className="p-2.5 rounded-xl hover:bg-slate-100 border border-transparent hover:border-slate-200 cursor-pointer flex items-center justify-between transition"
                >
                  <div>
                    <p className="font-semibold text-xs text-slate-800">{t.name || 'Trip'}</p>
                    <p className="text-[10px] text-slate-400">{t.start && t.end ? fmtRange(t.start, t.end) : ''}</p>
                  </div>
                  <span className="text-xs text-slate-400">→</span>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-100 flex gap-2">
              <a href="#/" className="btn-ghost w-full py-1.5 text-xs text-center block">
                + Create New Trip
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Push Notification In-App Toast */}
      {toast && (
        <button
          onClick={() => setToast(null)}
          className="fixed top-3 inset-x-3 z-[1000] max-w-md mx-auto text-left card shadow-xl border-teal-400 bg-white"
        >
          <p className="font-semibold text-sm text-teal-900">🔔 {toast.title}</p>
          <p className="text-xs text-slate-600 mt-0.5">{toast.body}</p>
        </button>
      )}

      {/* Screen Content */}
      <main className="p-4 space-y-4">
        <Screen {...ctx} />
      </main>

      {/* 10/10 Luminous Frosted Bar with Hero Quick Action Orb */}
      <BottomNav tab={tab} setTab={setTab} />
    </div>
  )
}

function Join({ trip, uid, members, onUserChange }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const theme = getTheme(trip.theme)
  const organiser = members.find((m) => m.id === trip.createdBy)?.name

  async function join(n, asUid = uid) {
    setBusy(true); setErr('')
    try {
      // Offline, Firestore queues the write and never settles — so don't wait forever.
      await Promise.race([
        joinTrip(trip.id, asUid, n),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
      ])
    } catch (e2) {
      setErr(!navigator.onLine || e2.message === 'timeout'
        ? "Couldn't reach the server — check your internet and try again."
        : `Couldn't join: ${e2.message}`)
      setBusy(false)
    }
  }

  // Google from an invite: sign in, then join with their name in one step.
  const google = useGoogleSignIn(async (u) => {
    onUserChange?.(u)
    await join(getSavedName() || u.displayName?.split(' ')[0] || 'Friend', u.uid)
  })

  return (
    <div className="min-h-dvh bg-slate-50 grid place-items-center px-5 py-10">
      <div className="w-full max-w-sm space-y-5">
        <div className="rounded-3xl overflow-hidden shadow-xl ring-1 ring-slate-200 bg-white">
          <div className={`bg-gradient-to-br ${theme?.gradient || 'from-teal-800 to-teal-600'} px-6 pt-6 pb-5 text-white`}>
            <p className="text-xs uppercase tracking-wider text-teal-100">You're invited 🎒</p>
            <h1 className="mt-1 text-2xl font-bold leading-tight">{theme?.icon ? `${theme.icon} ` : ''}{trip.name}</h1>
            <p className="mt-1 text-sm text-teal-100">{fmtRange(trip.start, trip.end)}</p>
            <div className="mt-4 flex items-center gap-2">
              <div className="flex -space-x-2">
                {members.slice(0, 5).map((m) => (
                  <span key={m.id} className="size-7 rounded-full bg-white text-teal-800 ring-2 ring-teal-700 grid place-items-center text-xs font-bold">{(m.name || '?')[0].toUpperCase()}</span>
                ))}
              </div>
              <p className="text-xs text-teal-50">
                {members.length === 0 ? 'Be the first to join' : `${organiser ? `${organiser}${members.length > 1 ? ` + ${members.length - 1} more` : ''}` : `${members.length} people`} ${members.length === 1 ? 'is' : 'are'} going`}
              </p>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <GoogleButton onClick={google.signIn} busy={google.busy || busy} label="Join with Google" />
            {(google.error || err) && <p role="alert" className="text-sm text-red-600">{google.error || err}</p>}
            <OrDivider />
            <GuestForm onSubmit={(n) => join(n)} cta="Join as guest" busy={busy} />
          </div>
        </div>
        <PrivacyNote />
      </div>
    </div>
  )
}

export { fmtRange, tripDays, ymd } from '../dates'
import { fmtRange } from '../dates'
