import { useEffect, useState } from 'react'
import { refreshPush } from '../push'
import { useDoc, useCol, joinTrip, recordUserTrip, getLocalTrips } from '../data'
import { getTheme } from '../themes'
import ThemePickerModal from '../components/ThemePickerModal'
import { Center } from '../App'
import Today from './Today'
import Plan from './Plan'
import Money from './Money'
import Photos from './Photos'
import MapScreen from './Map'
import More from './More'

const TABS = [
  ['today', '🏠', 'Today'],
  ['plan', '🗓️', 'Plan'],
  ['map', '📍', 'Map'],
  ['money', '💸', 'Money'],
  ['photos', '📸', 'Photos'],
  ['more', '☰', 'More'],
]

export default function Trip({ tripId, uid }) {
  const trip = useDoc(tripId)
  const members = useCol(tripId, 'members', 'joinedAt')
  const [tab, setTab] = useState('today')

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
  if (!me) return <Join trip={trip} uid={uid} />
  return <TripInner {...{ tripId, trip, uid, me, members, tab, setTab }} />
}

function TripInner({ tripId, trip, uid, me, members, tab, setTab }) {
  const [toast, setToast] = useState(null)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showThemePicker, setShowThemePicker] = useState(false)
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
    <div className="min-h-dvh max-w-md mx-auto pb-24">
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
              aria-label="Customize destination theme and cover"
              title="Change theme or cover photo"
              onClick={() => setShowThemePicker(true)}
              className="size-8 grid place-items-center rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs font-medium transition backdrop-blur-xs"
            >
              🎨
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

      {/* Bottom Tab Navigation */}
      <nav className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200 z-10 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-md mx-auto grid grid-cols-6">
          {TABS.map(([k, icon, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`py-2 text-xs flex flex-col items-center gap-0.5 transition ${
                tab === k ? 'text-teal-700 font-bold scale-105' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <span className="text-xl leading-none">{icon}</span>
              <span className="text-[11px]">{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}

function Join({ trip, uid }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem('yatra:name') || '' } catch { return '' } })
  const [busy, setBusy] = useState(false)

  async function go(e) {
    e.preventDefault()
    setBusy(true)
    try { localStorage.setItem('yatra:name', name) } catch {}
    await joinTrip(trip.id, uid, name.trim())
  }

  return (
    <Center>
      <div className="text-5xl">🎒</div>
      <p className="text-slate-500 mt-4">You're invited to</p>
      <h1 className="text-2xl font-bold">{trip.name}</h1>
      <p className="text-slate-500 text-sm">{fmtRange(trip.start, trip.end)}</p>
      <form onSubmit={go} className="mt-6 flex gap-2 w-80 max-w-full mx-auto">
        <input required autoFocus className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <button disabled={busy} className="btn">Join</button>
      </form>
    </Center>
  )
}

export function fmtRange(a, b) {
  const f = (d) => new Date(d + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return a && b ? `${f(a)} – ${f(b)}` : ''
}

export function tripDays(trip) {
  const out = []
  const d = new Date(trip.start + 'T00:00'), end = new Date(trip.end + 'T00:00')
  for (let i = 1; d <= end && i < 60; i++, d.setDate(d.getDate() + 1)) out.push({ n: i, date: ymd(d) })
  return out
}

export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
