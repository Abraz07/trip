import { useMemo, useState } from 'react'
import { useCol, add, update, remove } from '../data'
import { geocodePlace, reverseGeocode } from '../geocode'
import { ymd } from './Trip'
import { WhatsAppButton } from '../share'
import ConfirmDialog from '../components/ConfirmDialog'
import PlacesMap from '../places/PlacesMap'
import { CATEGORIES, catOf, mapsLink, shareText } from '../places/common'
import { publishPlaces, shareUrl } from '../places/share'

export default function Places({ tripId, trip, uid, byId }) {
  const places = useCol(tripId, 'places')
  const [form, setForm] = useState(null) // null | { id?, name, lat, lng, category, rating, note, address }
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [focus, setFocus] = useState(null)
  const [filter, setFilter] = useState('all')
  const [deleting, setDeleting] = useState(null)
  const [link, setLink] = useState(null)

  const shown = useMemo(() => (filter === 'all' ? places : places.filter((p) => p.category === filter)), [places, filter])
  const usedCats = CATEGORIES.filter(([k]) => places.some((p) => p.category === k))

  function markHere() {
    setErr('')
    if (!navigator.geolocation) return setErr('This browser has no location support.')
    setBusy('Finding where you are…')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        const r = await reverseGeocode(lat, lng)
        setBusy('')
        setForm({ name: r?.name || '', address: r?.address || '', lat, lng, category: 'food', rating: 0, note: '' })
      },
      (e) => { setBusy(''); setErr(e.code === 1 ? 'Location permission denied — allow it in your browser settings, or search the place instead.' : 'Could not get your location — try searching the place instead.') },
      { enableHighAccuracy: true, timeout: 20e3, maximumAge: 30e3 },
    )
  }

  async function searchPlace(q) {
    setErr(''); setBusy('Searching…')
    const r = await geocodePlace(q)
    setBusy('')
    if (!r) return setErr(`Couldn't find "${q}" on the map. Try adding the town name, e.g. "Namaste Cafe, Gokarna".`)
    setForm({ name: q, address: r.displayName || '', lat: r.lat, lng: r.lng, category: 'food', rating: 0, note: '' })
  }

  async function save() {
    const { id, ...data } = form
    if (!data.name.trim()) return setErr('Give the place a name.')
    data.name = data.name.trim(); data.note = data.note.trim()
    try {
      if (id) await update(tripId, 'places', id, data)
      else await add(tripId, 'places', { ...data, by: uid, date: ymd(new Date()) })
      setForm(null)
    } catch (e) { setErr(`Couldn't save: ${e.message}`) }
  }

  async function makeLink() {
    setBusy('Creating link…'); setErr('')
    try {
      const id = await publishPlaces(trip, places, uid)
      setLink(shareUrl(id))
    } catch (e) { setErr(`Couldn't create the link: ${e.message}`) }
    setBusy('')
  }

  return (
    <>
      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">📍 Places we visited</h2>
          <p className="text-xs text-slate-500">Mark spots as you go — rate them, add a tip, and share the list with anyone who asks for recommendations.</p>
        </div>
        {!form && (
          <>
            <button disabled={!!busy} className="btn w-full" onClick={markHere}>{busy || "📍 I'm here — mark this place"}</button>
            <SearchBox disabled={!!busy} onSearch={searchPlace} />
          </>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
        {form && <PlaceForm form={form} setForm={setForm} onSave={save} onCancel={() => { setForm(null); setErr('') }} />}
      </section>

      {places.length > 0 && <PlacesMap places={shown} focus={focus} />}

      {usedCats.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Chip on={filter === 'all'} onClick={() => setFilter('all')}>All ({places.length})</Chip>
          {usedCats.map(([k, icon, label]) => (
            <Chip key={k} on={filter === k} onClick={() => setFilter(k)}>{icon} {label} ({places.filter((p) => p.category === k).length})</Chip>
          ))}
        </div>
      )}

      {places.length === 0 && !form && <p className="card text-sm text-slate-500 text-center">No places yet. Tap <b>I'm here</b> at the next café, beach or viewpoint you love.</p>}

      {shown.length > 0 && (
        <ul className="card p-0 divide-y divide-slate-100">
          {[...shown].reverse().map((p) => {
            const [, icon, label] = catOf(p.category)
            return (
              <li key={p.id} className="px-4 py-3 flex gap-3 items-start">
                <button className="text-2xl leading-none pt-0.5" aria-label={`Show ${p.name} on map`} onClick={() => setFocus(p.id)}>{icon}</button>
                <div className="flex-1 min-w-0">
                  <button className="font-medium text-left hover:underline" onClick={() => setFocus(p.id)}>{p.name}</button>
                  <p className="text-xs text-slate-500">
                    {label}{p.rating ? <> · <span className="text-amber-600">{'★'.repeat(p.rating)}</span></> : null} · by {p.by === uid ? 'you' : byId[p.by]?.name || '?'}
                  </p>
                  {p.note && <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap">{p.note}</p>}
                  <div className="flex gap-3 mt-1 text-xs">
                    <a className="text-teal-700 underline" href={mapsLink(p)} target="_blank" rel="noreferrer">Open in Maps</a>
                    <button className="text-teal-700 underline" onClick={() => setForm({ ...p })}>Edit</button>
                    {p.by === uid && <button className="text-slate-400 underline" onClick={() => setDeleting(p)}>Delete</button>}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {places.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Share recommendations</h2>
          <WhatsAppButton className="w-full" label="Send the list on WhatsApp" text={shareText(trip.name, places)} />
          <button disabled={!!busy} className="btn-ghost w-full text-sm" onClick={makeLink}>
            🔗 {trip.placesShareId ? 'Update & copy public link' : 'Create public link'}
          </button>
          {link && <ShareLink url={link} />}
          <p className="text-xs text-slate-500">The public link shows only the places, ratings and tips — not expenses, photos or who's in the group. Tap the button again after adding places to update it.</p>
        </section>
      )}

      <ConfirmDialog
        isOpen={!!deleting}
        title="Delete place?"
        message={`Remove "${deleting?.name}" from your visited places?`}
        onConfirm={() => { remove(tripId, 'places', deleting.id); setDeleting(null) }}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function SearchBox({ onSearch, disabled }) {
  const [q, setQ] = useState('')
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { onSearch(q.trim()); setQ('') } }}>
      <input className="input" placeholder="…or search: Namaste Cafe, Gokarna" value={q} onChange={(e) => setQ(e.target.value)} />
      <button disabled={disabled} className="btn-ghost shrink-0">Find</button>
    </form>
  )
}

function PlaceForm({ form, setForm, onSave, onCancel }) {
  const set = (k, v) => setForm({ ...form, [k]: v })
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave() }}>
      <div>
        <input required autoFocus className="input font-semibold" placeholder="Place name" value={form.name} onChange={(e) => set('name', e.target.value)} />
        {form.address && <p className="text-[11px] text-slate-400 mt-1 truncate">{form.address}</p>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map(([k, icon, label]) => (
          <Chip key={k} on={form.category === k} onClick={() => set('category', k)}>{icon} {label}</Chip>
        ))}
      </div>
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button type="button" key={n} role="radio" aria-checked={form.rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
            className={`text-2xl leading-none ${n <= (form.rating || 0) ? 'text-amber-500' : 'text-slate-300'}`}
            onClick={() => set('rating', form.rating === n ? 0 : n)}>★</button>
        ))}
        <span className="text-xs text-slate-500 ml-2">{form.rating ? `${form.rating}/5` : 'Tap to rate'}</span>
      </div>
      <textarea className="input" rows="2" placeholder="Tip for friends — what to order, best time to go…" value={form.note} onChange={(e) => set('note', e.target.value)} />
      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={onCancel}>Cancel</button>
        <button className="btn flex-1">{form.id ? 'Save changes' : 'Save place'}</button>
      </div>
    </form>
  )
}

function ShareLink({ url }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {}
  }
  return (
    <div className="flex gap-2">
      <input readOnly className="input text-xs text-slate-600" value={url} onFocus={(e) => e.target.select()} />
      <button className="btn shrink-0 text-sm" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
    </div>
  )
}

const Chip = ({ on, onClick, children }) => (
  <button type="button" onClick={onClick} className={`shrink-0 rounded-full px-3 py-1.5 text-xs border ${on ? 'bg-teal-700 text-white border-teal-700' : 'bg-white border-slate-300'}`}>{children}</button>
)
