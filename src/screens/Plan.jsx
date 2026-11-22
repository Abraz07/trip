import { useState } from 'react'
import { useCol, add, remove } from '../data'
import { tripDays } from './Trip'
import { MapLink } from './Today'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Plan({ tripId, trip, setTab }) {
  const items = useCol(tripId, 'plan', 'time')
  const days = tripDays(trip)
  const [adding, setAdding] = useState(null)
  const [deletingItem, setDeletingItem] = useState(null)

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
