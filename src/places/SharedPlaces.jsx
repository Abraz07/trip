import { useEffect, useState } from 'react'
import { loadShared } from './share'
import PlacesMap from './PlacesMap'
import { CATEGORIES, catOf, mapsLink } from './common'

// Public read-only page: #/p/{shareId}. No sign-in, no trip membership needed.
export default function SharedPlaces({ shareId }) {
  const [data, setData] = useState(undefined)
  const [focus, setFocus] = useState(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => { loadShared(shareId).then(setData).catch(() => setData(null)) }, [shareId])

  if (data === undefined) return <Center>Loading recommendations…</Center>
  if (data === null) return <Center>This list doesn't exist or was removed.</Center>

  const places = data.places || []
  const shown = (filter === 'all' ? places : places.filter((p) => p.category === filter)).slice().sort((a, b) => (b.rating || 0) - (a.rating || 0))
  const usedCats = CATEGORIES.filter(([k]) => places.some((p) => p.category === k))

  return (
    <div className="min-h-dvh max-w-md mx-auto px-4 py-6 space-y-4">
      <header>
        <p className="text-sm text-teal-700 font-semibold">📍 Recommendations</p>
        <h1 className="text-2xl font-bold">{data.tripName}</h1>
        <p className="text-sm text-slate-500">{places.length} places we visited and liked</p>
      </header>

      {places.length > 0 && <PlacesMap places={shown} focus={focus} height="45dvh" />}

      {usedCats.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[['all', '', `All (${places.length})`], ...usedCats.map(([k, i, l]) => [k, i, l])].map(([k, icon, label]) => (
            <button key={k} onClick={() => setFilter(k)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs border ${filter === k ? 'bg-teal-700 text-white border-teal-700' : 'bg-white border-slate-300'}`}>{icon} {label}</button>
          ))}
        </div>
      )}

      <ul className="card p-0 divide-y divide-slate-100">
        {shown.map((p) => {
          const [, icon, label] = catOf(p.category)
          return (
            <li key={p.id} className="px-4 py-3 flex gap-3">
              <button className="text-2xl leading-none" aria-label={`Show ${p.name} on map`} onClick={() => setFocus(p.id)}>{icon}</button>
              <div className="flex-1 min-w-0">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-slate-500">{label}{p.rating ? <> · <span className="text-amber-600">{'★'.repeat(p.rating)}</span></> : null}</p>
                {p.note && <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap">{p.note}</p>}
                <a className="text-xs text-teal-700 underline" href={mapsLink(p)} target="_blank" rel="noreferrer">Open in Google Maps</a>
              </div>
            </li>
          )
        })}
      </ul>

      <p className="text-center text-xs text-slate-400 pt-2">Made with Yatra · <a className="underline" href="/">Plan your own trip</a></p>
    </div>
  )
}

const Center = ({ children }) => <div className="min-h-dvh grid place-items-center p-6 text-center text-slate-500">{children}</div>
