import { useState } from 'react'
import { useCol, add, remove } from '../data'
import { tripDays } from './Trip'
import { MapLink } from './Today'
import ConfirmDialog from '../components/ConfirmDialog'
import { geocodePlace } from '../geocode'
import { ymd } from './Trip'

export default function Plan({ tripId, trip, uid, setTab }) {
  const items = useCol(tripId, 'plan', 'time')
  const days = tripDays(trip)
  const [adding, setAdding] = useState(null)
  const [deletingItem, setDeletingItem] = useState(null)
  const places = useCol(tripId, 'places')
  const visited = Object.fromEntries(places.filter((p) => p.planId).map((p) => [p.planId, p]))
  const [marking, setMarking] = useState({}) // planId -> 'busy' | error text

  // Save a plan stop as a visited place (rate it later in More → Places).
  async function markVisited(i) {
    setMarking((m) => ({ ...m, [i.id]: 'busy' }))
    let lat = i.lat, lng = i.lng
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      const g = await geocodePlace(i.place || i.title)
      lat = g?.lat; lng = g?.lng
    }
    if (typeof lat !== 'number') {
      setMarking((m) => ({ ...m, [i.id]: "Couldn't find it on the map — mark it from More → Places instead." }))
      return
    }
    await add(tripId, 'places', { name: i.title, lat, lng, category: 'other', rating: 0, note: '', planId: i.id, by: uid, date: ymd(new Date()) })
    setMarking((m) => ({ ...m, [i.id]: null }))
  }

  return (
    <>
      {days.map((d) => {
        const list = items.filter((i) => i.date === d.date)
        return (
          <section key={d.date} className="card">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">
                  Day {d.n} <span className="text-slate-500 font-normal text-sm">· {new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                </h2>
                {list.length > 0 && setTab && (
                  <button
                    type="button"
                    onClick={() => {
                      sessionStorage.setItem('yatra:map_focus', list[0].id)
                      setTab('map')
                    }}
                    className="text-xs text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full font-medium"
                  >
                    🗺️ Day Route
                  </button>
                )}
              </div>
              <button className="text-teal-700 text-sm font-semibold" onClick={() => setAdding(adding === d.date ? null : d.date)}>
                {adding === d.date ? 'Cancel' : '+ Add'}
              </button>
            </div>
            <ul className="divide-y divide-slate-100">
              {list.map((i) => (
                <li key={i.id} className="py-2.5 flex gap-3 items-start">
                  <span className="text-sm font-mono text-teal-700 w-12 shrink-0 pt-0.5">{i.time || '—'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900">{i.title}</p>
                    {i.place && (
                      <div className="flex items-center gap-2 mt-0.5">
                        <MapLink place={i.place} />
                        {setTab && (
                          <button
                            type="button"
                            onClick={() => {
                              sessionStorage.setItem('yatra:map_focus', i.id)
                              setTab('map')
                            }}
                            className="text-[11px] bg-teal-50 border border-teal-200 text-teal-800 rounded px-1.5 py-0.5 font-medium hover:bg-teal-100 transition"
                          >
                            🗺️ Map
                          </button>
                        )}
                      </div>
                    )}
                    {i.notes && <p className="text-xs text-slate-500 whitespace-pre-wrap mt-0.5">{i.notes}</p>}
                    <div className="mt-1">
                      {visited[i.id]
                        ? <span className="text-[11px] font-semibold text-teal-700">✓ Visited{visited[i.id].rating ? ` · ${'★'.repeat(visited[i.id].rating)}` : ''}</span>
                        : <button type="button" disabled={marking[i.id] === 'busy'} onClick={() => markVisited(i)}
                            className="text-[11px] border border-slate-300 rounded-full px-2 py-0.5 font-medium text-slate-600 hover:border-teal-600 hover:text-teal-700">
                            {marking[i.id] === 'busy' ? 'Saving…' : '✓ Mark visited'}
                          </button>}
                      {marking[i.id] && marking[i.id] !== 'busy' && <p className="text-[11px] text-red-600 mt-0.5">{marking[i.id]}</p>}
                    </div>
                  </div>
                  <button
                    aria-label="Delete"
                    className="text-slate-400 px-1 hover:text-red-500 transition"
                    onClick={() => setDeletingItem(i)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {list.length === 0 && adding !== d.date && <p className="text-sm text-slate-400 mt-1">Free day 🌴</p>}
            {adding === d.date && <AddItem onAdd={(v) => { add(tripId, 'plan', { ...v, date: d.date }); setAdding(null) }} />}
          </section>
        )
      })}

      <ConfirmDialog
        isOpen={!!deletingItem}
        title="Delete Itinerary Item?"
        message={`Delete "${deletingItem?.title}" from the trip plan?`}
        onConfirm={() => {
          remove(tripId, 'plan', deletingItem.id)
          setDeletingItem(null)
        }}
        onCancel={() => setDeletingItem(null)}
      />
    </>
  )
}

function AddItem({ onAdd }) {
  const [v, setV] = useState({ time: '', title: '', place: '', notes: '' })
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  return (
    <form className="mt-3 space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-200" onSubmit={(e) => { e.preventDefault(); onAdd(v) }}>
      <div className="flex gap-2">
        <input type="time" className="input w-32" value={v.time} onChange={set('time')} />
        <input required autoFocus className="input" placeholder="What? (Check-in, Beach, Dinner…)" value={v.title} onChange={set('title')} />
      </div>
      <input className="input" placeholder="Place or Google Maps link" value={v.place} onChange={set('place')} />
      <textarea className="input" rows="2" placeholder="Notes — PNR, booking ID, contact…" value={v.notes} onChange={set('notes')} />
      <button className="btn w-full">Add to Plan</button>
    </form>
  )
}
