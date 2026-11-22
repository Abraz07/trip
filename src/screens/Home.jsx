import { useState } from 'react'
import { createTrip, useUserTrips, removeLocalTrip } from '../data'
import { fmtRange } from './Trip'
import { linkAccountWithGoogle, signOutUser } from '../firebase'
import { DESTINATION_THEMES, getTheme, detectThemeFromName } from '../themes'

export default function Home({ uid, user, onUserChange }) {
  const myTrips = useUserTrips(uid)
  const [f, setF] = useState({
    name: '',
    start: '',
    end: '',
    me: localStorage.getItem('yatra:name') || '',
    theme: 'beach',
  })
  const [busy, setBusy] = useState(false)
  const [syncingGoogle, setSyncingGoogle] = useState(false)
  const [showCreate, setShowCreate] = useState(myTrips.length === 0)
  const [pasteLink, setPasteLink] = useState('')
  const [userName, setUserName] = useState(f.me)
  const [editingName, setEditingName] = useState(false)

  const set = (k) => (e) => {
    const val = e.target.value
    if (k === 'name') {
      const detected = detectThemeFromName(val)
      setF((prev) => ({ ...prev, name: val, theme: detected }))
    } else {
      setF((prev) => ({ ...prev, [k]: val }))
    }
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try { localStorage.setItem('yatra:name', f.me) } catch {}
    const id = await createTrip(uid, f)
    location.hash = `#/t/${id}`
  }

  function handleJoinLink(e) {
    e.preventDefault()
    const query = pasteLink.trim()
    if (!query) return
    const match = query.match(/(?:#\/t\/|^)([\w-]+)/)
    const tripId = match ? match[1] : query
    if (tripId) {
      location.hash = `#/t/${tripId}`
    }
  }

  function handleSaveName(e) {
    e.preventDefault()
    if (!userName.trim()) return
    try { localStorage.setItem('yatra:name', userName.trim()) } catch {}
    setF((prev) => ({ ...prev, me: userName.trim() }))
    setEditingName(false)
  }

  async function handleGoogleSync() {
    setSyncingGoogle(true)
    try {
      const updated = await linkAccountWithGoogle()
      if (updated) {
        onUserChange?.(updated)
        if (updated.displayName && !userName) {
          setUserName(updated.displayName)
          setF((prev) => ({ ...prev, me: updated.displayName }))
          try { localStorage.setItem('yatra:name', updated.displayName) } catch {}
        }
      }
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        alert('Could not link Google account: ' + err.message)
      }
    } finally {
      setSyncingGoogle(false)
    }
  }

  async function handleSignOut() {
    if (!confirm('Sign out from this device? You can sign back in with your Google account anytime.')) return
    try {
      const guest = await signOutUser()
      if (guest) onUserChange?.(guest.user || guest)
    } catch (e) {
      alert('Sign out error: ' + e.message)
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  const isGoogleLinked = user && !user.isAnonymous

  return (
    <div className="min-h-dvh max-w-md mx-auto px-4 py-8 pb-16 space-y-5">
      {/* Top Profile Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-2xl bg-gradient-to-tr from-teal-800 to-teal-600 text-white grid place-items-center text-xl shadow-md">
            🏔️
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Yatra</h1>
            <p className="text-xs text-slate-500">One app for the group trip</p>
          </div>
        </div>

        {/* User Chip */}
        <div className="text-right">
          {editingName ? (
            <form onSubmit={handleSaveName} className="flex items-center gap-1">
              <input
                autoFocus
                className="input py-1 px-2 text-xs w-28"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
              />
              <button className="btn py-1 px-2 text-xs">Save</button>
            </form>
          ) : (
            <button
              onClick={() => setEditingName(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 rounded-full text-xs font-medium text-slate-700 shadow-2xs hover:border-teal-600"
            >
              <span className="size-2 rounded-full bg-teal-600" />
              <span>{f.me || 'Set your name'}</span>
              <span className="text-slate-400 text-[10px]">✎</span>
            </button>
          )}
        </div>
      </div>

      {/* Google Account Persistence Card */}
      {!isGoogleLinked ? (
        <section className="card p-3 bg-gradient-to-r from-blue-50/70 to-slate-50 border-blue-200/80 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">📲</span>
            <div>
              <p className="font-bold text-xs text-slate-900">Sync Across Devices</p>
              <p className="text-[11px] text-slate-500">Save trips to your Google account</p>
            </div>
          </div>
          <button
            type="button"
            disabled={syncingGoogle}
            onClick={handleGoogleSync}
            className="btn bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 py-1.5 px-3 text-xs font-semibold shadow-2xs shrink-0 flex items-center gap-1.5"
          >
            <svg viewBox="0 0 24 24" className="size-3.5"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.15z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.41 7.34 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.27a7.22 7.22 0 0 1 0-4.54V6.58H1.25a11.97 11.97 0 0 0 0 10.84l4.03-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.59 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/></svg>
            {syncingGoogle ? 'Connecting…' : 'Sign In'}
          </button>
        </section>
      ) : (
        <section className="card p-2.5 bg-emerald-50/70 border-emerald-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-emerald-700 font-bold">✓</span>
            <span className="text-emerald-900 font-medium truncate max-w-[210px]">
              {user.email || 'Google Account Linked'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-slate-500 hover:text-red-600 underline font-medium text-[11px]"
          >
            Sign Out
          </button>
        </section>
      )}

      {/* My Trips Dashboard Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-base text-slate-900">Your Trips</h2>
          {myTrips.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCreate(!showCreate)}
              className="text-xs text-teal-700 font-semibold hover:text-teal-900"
            >
              {showCreate ? 'Close form' : '+ New Trip'}
            </button>
          )}
        </div>

        {myTrips.length === 0 && !showCreate && (
          <div className="card text-center py-8 space-y-2">
            <span className="text-3xl">🌴</span>
            <p className="font-semibold text-slate-800">No trips yet</p>
            <p className="text-xs text-slate-500 max-w-xs mx-auto">
              Create a trip to start planning, packing, and splitting expenses with friends.
            </p>
            <button onClick={() => setShowCreate(true)} className="btn text-xs py-2 px-4 mt-2">
              + Plan a Trip
            </button>
          </div>
        )}

        {/* List of Trip Cards */}
        <div className="space-y-3">
          {myTrips.map((t) => {
            const isActive = t.start && t.end && todayStr >= t.start && todayStr <= t.end
            const isUpcoming = t.start && todayStr < t.start
            const isDone = t.end && todayStr > t.end
            const theme = getTheme(t.theme)

            return (
              <div
                key={t.id}
                onClick={() => { location.hash = `#/t/${t.id}` }}
                className="card p-0 overflow-hidden hover:shadow-md transition cursor-pointer relative group border-slate-200"
              >
                {/* Visual Destination Hero Header on Card */}
                <div
                  className={`relative p-3.5 text-white ${
                    t.coverUrl ? 'bg-slate-900' : `bg-gradient-to-r ${theme.gradient}`
                  }`}
                >
                  {t.coverUrl && (
                    <img
                      src={t.coverUrl}
                      alt=""
                      className="absolute inset-0 size-full object-cover opacity-50"
                    />
                  )}
                  <div className="relative z-10 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl drop-shadow">{theme.icon}</span>
                      <h3 className="font-bold text-base text-white truncate drop-shadow-xs">
                        {t.name || 'Untitled Trip'}
                      </h3>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isActive && (
                        <span className="text-[10px] bg-emerald-400 text-emerald-950 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shadow-2xs">
                          Active
                        </span>
                      )}
                      {isUpcoming && (
                        <span className="text-[10px] bg-white/30 backdrop-blur-xs text-white font-semibold px-2 py-0.5 rounded-full">
                          Upcoming
                        </span>
                      )}
                      {isDone && (
                        <span className="text-[10px] bg-black/30 backdrop-blur-xs text-slate-200 font-medium px-2 py-0.5 rounded-full">
                          Completed
                        </span>
                      )}

                      <button
                        aria-label="Remove from list"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeLocalTrip(t.id)
                          window.location.reload()
                        }}
                        className="size-6 grid place-items-center text-white/70 hover:text-white rounded-full hover:bg-black/20"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-3 bg-white flex items-center justify-between text-xs">
                  <p className="text-slate-500 font-medium">
                    📅 {t.start && t.end ? fmtRange(t.start, t.end) : 'Dates pending'}
                  </p>
                  <span className="text-teal-700 font-bold flex items-center gap-1">
                    Open Trip →
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Create Trip Form (Collapsible when user has trips) */}
      {showCreate && (
        <form onSubmit={submit} className="card space-y-3.5 border-teal-200 bg-teal-50/30">
          <div className="flex items-center justify-between pb-1 border-b border-teal-100">
            <h3 className="font-bold text-sm text-slate-800">Plan a New Trip</h3>
            {myTrips.length > 0 && (
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            )}
          </div>

          <label className="block text-xs font-semibold text-slate-700">
            Trip Name & Destination
            <input
              required
              className="input mt-1"
              placeholder="e.g. Goa Trip '26, Manali Trek, Dubai Vacation"
              value={f.name}
              onChange={set('name')}
            />
          </label>

          {/* Destination Vibe Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 block">Destination Theme:</label>
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {DESTINATION_THEMES.map((theme) => {
                const isSelected = f.theme === theme.id
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setF((prev) => ({ ...prev, theme: theme.id }))}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition flex items-center gap-1 border ${
                      isSelected
                        ? 'bg-teal-700 text-white border-teal-700 shadow-2xs font-semibold'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span>{theme.icon}</span>
                    <span>{theme.name.split(' ')[0]}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-slate-700">
              Start Date
              <input required type="date" className="input mt-1 text-xs" value={f.start} onChange={set('start')} />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              End Date
              <input required type="date" className="input mt-1 text-xs" value={f.end} min={f.start} onChange={set('end')} />
            </label>
          </div>

          <label className="block text-xs font-semibold text-slate-700">
            Your Name in Group
            <input required className="input mt-1" placeholder="Your name" value={f.me} onChange={set('me')} />
          </label>

          <button disabled={busy} className="btn w-full py-2.5 text-sm mt-2">
            {busy ? 'Creating trip…' : 'Create & Invite Friends'}
          </button>
        </form>
      )}

      {/* Quick Join Via Link / Code */}
      <section className="card space-y-2 bg-slate-50/70 border-slate-200">
        <h3 className="font-semibold text-xs text-slate-700">Got an Invite Link?</h3>
        <form onSubmit={handleJoinLink} className="flex gap-2">
          <input
            className="input text-xs"
            placeholder="Paste link or Trip ID"
            value={pasteLink}
            onChange={(e) => setPasteLink(e.target.value)}
          />
          <button className="btn py-2 px-3 text-xs shrink-0">Join</button>
        </form>
      </section>
    </div>
  )
}
