import { useState } from 'react'
import { createTrip, useUserTrips, removeLocalTrip } from '../data'
import { fmtRange } from './Trip'

export default function Home({ uid }) {
  const myTrips = useUserTrips(uid)
  const [f, setF] = useState({ name: '', start: '', end: '', me: localStorage.getItem('yatra:name') || '' })
  const [busy, setBusy] = useState(false)
  const [showCreate, setShowCreate] = useState(myTrips.length === 0)
  const [pasteLink, setPasteLink] = useState('')
  const [userName, setUserName] = useState(f.me)
  const [editingName, setEditingName] = useState(false)

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

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

  const todayStr = new Date().toISOString().slice(0, 10)

  return (
    <div className="min-h-dvh max-w-md mx-auto px-4 py-8 pb-16 space-y-6">
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
        <div className="space-y-2.5">
          {myTrips.map((t) => {
            const isActive = t.start && t.end && todayStr >= t.start && todayStr <= t.end
            const isUpcoming = t.start && todayStr < t.start
            const isDone = t.end && todayStr > t.end

            return (
              <div
                key={t.id}
                onClick={() => { location.hash = `#/t/${t.id}` }}
                className="card p-4 hover:border-teal-600 transition cursor-pointer shadow-xs relative group flex items-center justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-base text-slate-900 truncate">{t.name || 'Untitled Trip'}</h3>
                    {isActive && (
                      <span className="text-[10px] bg-teal-100 text-teal-800 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                        Active
                      </span>
                    )}
                    {isUpcoming && (
                      <span className="text-[10px] bg-amber-100 text-amber-800 font-medium px-2 py-0.5 rounded-full">
                        Upcoming
                      </span>
                    )}
                    {isDone && (
                      <span className="text-[10px] bg-slate-100 text-slate-500 font-medium px-2 py-0.5 rounded-full">
                        Completed
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {t.start && t.end ? fmtRange(t.start, t.end) : 'Dates pending'}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-teal-700 text-sm font-semibold">Open →</span>
                  <button
                    aria-label="Remove from list"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeLocalTrip(t.id)
                      window.location.reload()
                    }}
                    className="size-7 grid place-items-center text-slate-300 hover:text-red-500 rounded-full hover:bg-slate-100"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Create Trip Form (Collapsible when user has trips) */}
      {showCreate && (
        <form onSubmit={submit} className="card space-y-3 border-teal-200 bg-teal-50/30">
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
            Trip Name
            <input
              required
              className="input mt-1"
              placeholder="e.g. Goa Trip '26, Manali Trek"
              value={f.name}
              onChange={set('name')}
            />
          </label>
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
            Your Name
            <input required className="input mt-1" placeholder="Your name in the group" value={f.me} onChange={set('me')} />
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
