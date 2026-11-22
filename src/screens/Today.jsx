import { useState } from 'react'
import { useCol, add, update } from '../data'
import { balances, inr } from '../settle'
import { tripDays, ymd } from './Trip'
import { PollCard } from './Polls'
import { NotifyBanner, Reminders } from './Reminders'
import { WhatsAppButton, tripLink } from '../share'

export default function Today({ tripId, trip, uid, me, members, byId, setTab }) {
  const items = useCol(tripId, 'plan', 'time')
  const checks = useCol(tripId, 'headcounts')
  const polls = useCol(tripId, 'polls')
  const emergencies = useCol(tripId, 'emergencies')
  const activeSos = emergencies.find((e) => e.status === 'active')
  const pending = polls.filter((p) => !p.closed && p.votes?.[uid] === undefined)
  const expenses = useCol(tripId, 'expenses')
  const today = ymd(new Date())
  const days = tripDays(trip)
  const day = days.find((d) => d.date === today)
  const next = days.find((d) => d.date > today)
  const showDate = day ? today : next?.date || days[0]?.date
  const todays = items.filter((i) => i.date === showDate)
  const myBal = balances(expenses, members)[uid] || 0
  const check = checks[checks.length - 1]

  return (
    <>
      {activeSos && (
        <section className="card bg-red-600 text-white border-0 shadow-lg space-y-2 animate-pulse">
          <div className="flex items-center justify-between">
            <span className="font-bold text-xs uppercase tracking-wider">🚨 SOS DISTRESS FROM {activeSos.name}</span>
            {activeSos.by === uid && (
              <button
                type="button"
                onClick={() => update(tripId, 'emergencies', activeSos.id, { status: 'resolved' })}
                className="bg-white text-red-700 text-xs font-bold px-2 py-0.5 rounded-md"
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
              className="btn bg-white text-red-700 flex-1 text-xs py-1.5 text-center font-bold"
            >
              📍 Open Exact Location
            </a>
            <WhatsAppButton
              className="flex-1 text-xs py-1.5"
              label="Alert Group"
              text={`🚨 EMERGENCY SOS from ${activeSos.name}!\nLocation: ${activeSos.mapsUrl}`}
            />
          </div>
        </section>
      )}

      <section className="card bg-gradient-to-br from-teal-700 to-teal-600 text-white border-0">
        <p className="text-teal-100 text-sm">Hey {me.name} 👋</p>
        <p className="text-xl font-bold mt-1">
          {day ? `Day ${day.n} of ${days.length}` : today < trip.start ? `${daysUntil(trip.start)} days to go` : 'Trip done 🎉'}
        </p>
        <p className="text-sm mt-2">{myBal > 0.5 ? `You're owed ${inr(myBal)}` : myBal < -0.5 ? `You owe ${inr(-myBal)}` : 'All settled 👌'}</p>
      </section>

      <NotifyBanner tripId={tripId} uid={uid} />

      {pending.map((p) => <PollCard key={p.id} compact poll={p} tripId={tripId} uid={uid} members={members} byId={byId} />)}

      <Headcount trip={trip} tripId={tripId} uid={uid} check={check} members={members} byId={byId} />

      <Reminders tripId={tripId} trip={trip} uid={uid} byId={byId} />

      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{day ? "Today's plan" : 'Coming up'}</h2>
          {todays.length > 0 && setTab && (
            <button
              type="button"
              onClick={() => {
                const s = todays[0]
                sessionStorage.setItem('yatra:map_focus', JSON.stringify({ id: s.id, date: s.date, lat: s.lat, lng: s.lng, title: s.title, place: s.place }))
                setTab('map')
              }}
              className="text-xs text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full font-medium"
            >
              🗺️ Open Map
            </button>
          )}
        </div>
        {todays.length === 0 && <p className="text-sm text-slate-500 mt-2">Nothing planned yet — add it in the Plan tab.</p>}
        <ul className="mt-2 divide-y divide-slate-100">
          {todays.map((i) => (
            <li key={i.id} className="py-2 flex gap-3">
              <span className="text-sm font-mono text-teal-700 w-12 shrink-0">{i.time || '—'}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium">{i.title}</p>
                {i.place && (
                  <div className="flex items-center gap-2 mt-0.5">
                    <MapLink place={i.place} />
                    {setTab && (
                      <button
                        type="button"
                        onClick={() => {
                          sessionStorage.setItem('yatra:map_focus', JSON.stringify({ id: i.id, date: i.date, lat: i.lat, lng: i.lng, title: i.title, place: i.place }))
                          setTab('map')
                        }}
                        className="text-[11px] bg-teal-50 border border-teal-200 text-teal-800 rounded px-1.5 py-0.5 font-medium hover:bg-teal-100"
                      >
                        🗺️ Map
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

function Headcount({ trip, tripId, uid, check, members, byId }) {
  const [label, setLabel] = useState('')
  const open = check && !check.closed
  const present = check?.present || {}
  const missing = members.filter((m) => !present[m.id])

  if (!open) {
    return (
      <section className="card">
        <h2 className="font-semibold">🚌 Headcount</h2>
        <p className="text-sm text-slate-500">Leaving somewhere? Start a check — everyone taps "I'm here".</p>
        <form className="flex gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); add(tripId, 'headcounts', { label: label || 'Headcount', present: { [uid]: true }, by: uid, closed: false }); setLabel('') }}>
          <input className="input" placeholder="e.g. Leaving hotel" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className="btn shrink-0">Start</button>
        </form>
      </section>
    )
  }
  return (
    <section className="card border-amber-300 bg-amber-50">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="font-semibold">🚌 {check.label}</h2>
          <p className="text-sm">{members.length - missing.length}/{members.length} here</p>
        </div>
        <button className="text-sm text-slate-500 underline" onClick={() => update(tripId, 'headcounts', check.id, { closed: true })}>Close</button>
      </div>
      {!present[uid] && <button className="btn w-full mt-3" onClick={() => update(tripId, 'headcounts', check.id, { [`present.${uid}`]: true })}>I'm here ✋</button>}
      {missing.length > 0 && <p className="text-sm mt-3">Waiting for: <b>{missing.map((m) => byId[m.id]?.name).join(', ')}</b></p>}
      {missing.length === 0 && <p className="text-sm mt-3 font-semibold text-teal-700">Everyone's here — let's go! 🎉</p>}
      {missing.length > 0 && (
        <WhatsAppButton className="w-full mt-3" label="Ping the group" text={`🚌 *${check.label}* — headcount!\nStill waiting for: ${missing.map((m) => byId[m.id]?.name).join(', ')}\nOpen Yatra and tap "I'm here" 👉 ${tripLink(tripId)}`} />
      )}
    </section>
  )
}

export const MapLink = ({ place }) => (
  <a className="text-sm text-teal-700 underline" target="_blank" rel="noreferrer" href={/^https?:/.test(place) ? place : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`}>
    📍 {/^https?:/.test(place) ? 'Open map' : place}
  </a>
)

const daysUntil = (d) => Math.ceil((new Date(d + 'T00:00') - new Date()) / 864e5)
