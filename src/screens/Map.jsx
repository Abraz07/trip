import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { serverTimestamp } from 'firebase/firestore'
import { useCol, put, update, updateTrip } from '../data'
import { WhatsAppButton } from '../share'
import { geocodePlace, extractCoordsFromText } from '../geocode'
import { tripDays, ymd } from './Trip'

const STALE_MS = 10 * 60 * 1000
const shareKey = (t) => `yatra:share:${t}`
const ago = (ms) => (ms < 60e3 ? 'just now' : ms < 3600e3 ? `${Math.round(ms / 60e3)} min ago` : `${Math.round(ms / 3600e3)} h ago`)
const dist = (a, b) => L.latLng(a).distanceTo(L.latLng(b))

export default function Map({ tripId, trip, uid, byId }) {
  const locs = useCol(tripId, 'locations')
  const planItems = useCol(tripId, 'plan', 'time')
  const days = tripDays(trip)
  const today = ymd(new Date())

  // Default day: today if within trip, else first day
  const [selectedDay, setSelectedDay] = useState(() => {
    const focusId = sessionStorage.getItem('yatra:map_focus')
    if (focusId) {
      const match = planItems.find((p) => p.id === focusId)
      if (match?.date) return match.date
    }
    const cur = days.find((d) => d.date === today)
    return cur ? cur.date : 'all'
  })

  const [showLive, setShowLive] = useState(true)
  const [showStops, setShowStops] = useState(true)
  const [showRoute, setShowRoute] = useState(true)

  const el = useRef(), map = useRef(), layer = useRef(), routeLayer = useRef()
  const fitted = useRef(false)
  const [sharing, setSharing] = useState(() => { try { return localStorage.getItem(shareKey(tripId)) === '1' } catch { return false } })
  const [err, setErr] = useState(null)
  const [, tick] = useState(0)
  const [activeStopId, setActiveStopId] = useState(null)

  // Map setup
  useEffect(() => {
    map.current = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([14.28, 74.44], 6)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map.current)
    routeLayer.current = L.layerGroup().addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    const i = setInterval(() => tick((n) => n + 1), 30e3)
    return () => { clearInterval(i); map.current.remove() }
  }, [])

  // Geocode any plan items with a place that don't have lat/lng yet
  useEffect(() => {
    for (const item of planItems) {
      if (item.place && (!item.lat || !item.lng)) {
        geocodePlace(item.place).then((coords) => {
          if (coords?.lat && coords?.lng) {
            update(tripId, 'plan', item.id, { lat: coords.lat, lng: coords.lng }).catch(() => {})
          }
        })
      }
    }
  }, [planItems, tripId])

  // Share my location while the app is open
  useEffect(() => {
    try { localStorage.setItem(shareKey(tripId), sharing ? '1' : '0') } catch {}
    if (!sharing) { update(tripId, 'locations', uid, { sharing: false }).catch(() => {}); return }
    if (!navigator.geolocation) { setErr('This browser has no location support.'); setSharing(false); return }
    let last = null, lastAt = 0
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const here = [p.coords.latitude, p.coords.longitude]
        if (last && dist(last, here) < 25 && Date.now() - lastAt < 60e3) return
        last = here; lastAt = Date.now(); setErr(null)
        put(tripId, 'locations', uid, { lat: here[0], lng: here[1], acc: Math.round(p.coords.accuracy), sharing: true, at: serverTimestamp() })
      },
      (e) => { setErr(e.code === 1 ? 'Location permission denied — allow it in your browser settings.' : 'Could not get your location.'); if (e.code === 1) setSharing(false) },
      { enableHighAccuracy: true, maximumAge: 15e3, timeout: 30e3 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [sharing, tripId, uid])

  // Filter plan items for current day
  const filteredStops = planItems
    .filter((it) => (selectedDay === 'all' || it.date === selectedDay) && (it.lat || extractCoordsFromText(it.place)))
    .map((it) => {
      const coords = it.lat && it.lng ? { lat: it.lat, lng: it.lng } : extractCoordsFromText(it.place)
      return { ...it, ...coords }
    })
    .filter((it) => it.lat && it.lng)

  const live = locs.filter((l) => l.sharing && l.at)

  // Draw markers, itinerary stops, and route lines
  useEffect(() => {
    if (!layer.current || !routeLayer.current) return
    const g = layer.current
    const rg = routeLayer.current
    g.clearLayers()
    rg.clearLayers()

    const allPts = []

    // 1. Draw Itinerary Stops
    if (showStops) {
      filteredStops.forEach((stop, index) => {
        const stopNum = index + 1
        const isCurrentActive = activeStopId === stop.id
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:${isCurrentActive ? '#042f2e' : '#0f766e'};color:#fff;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font:700 14px system-ui;transform:translate(-2px,-2px);transition:transform 0.2s">${stopNum}</div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        })

        const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`
        const popupContent = `
          <div style="min-width:180px;font-family:system-ui">
            <div style="font-size:11px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:0.5px">Stop #${stopNum} · ${escapeHtml(stop.time || 'Anytime')}</div>
            <div style="font-size:15px;font-weight:700;color:#0f172a;margin-top:2px">${escapeHtml(stop.title)}</div>
            ${stop.place ? `<div style="font-size:12px;color:#64748b;margin-top:2px">📍 ${escapeHtml(stop.place)}</div>` : ''}
            ${stop.notes ? `<div style="font-size:11px;color:#475569;margin-top:4px;background:#f8fafc;padding:4px 6px;border-radius:6px">${escapeHtml(stop.notes)}</div>` : ''}
            <div style="margin-top:8px;display:flex;gap:6px">
              <a href="${directionsUrl}" target="_blank" rel="noreferrer" style="display:inline-block;background:#0f766e;color:#fff;font-size:11px;font-weight:600;padding:5px 8px;border-radius:6px;text-decoration:none">🧭 Navigate</a>
              <button onclick="window.__yatraSetMeet && window.__yatraSetMeet(${stop.lat}, ${stop.lng}, '${escapeHtml(stop.title)}')" style="background:#f1f5f9;color:#334155;font-size:11px;font-weight:600;padding:5px 8px;border-radius:6px;border:none;cursor:pointer">📍 Meet Here</button>
            </div>
          </div>
        `

        const marker = L.marker([stop.lat, stop.lng], { icon }).bindPopup(popupContent).addTo(g)
        allPts.push([stop.lat, stop.lng])

        if (isCurrentActive) {
          marker.openPopup()
        }
      })

      // Draw connecting polyline for the day's itinerary route
      if (showRoute && filteredStops.length > 1) {
        const routeCoords = filteredStops.map((s) => [s.lat, s.lng])
        L.polyline(routeCoords, {
          color: '#0f766e',
          weight: 4,
          opacity: 0.8,
          dashArray: '6, 8',
          lineJoin: 'round',
        }).addTo(rg)
      }
    }

    // 2. Draw Live Friends
    if (showLive) {
      for (const l of live) {
        const age = Date.now() - l.at.toMillis()
        const name = byId[l.id]?.name || '?'
        const me = l.id === uid
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:${me ? '#0f766e' : age > STALE_MS ? '#94a3b8' : '#f59e0b'};color:#fff;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font:700 14px system-ui">${name[0]?.toUpperCase()}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        })
        L.marker([l.lat, l.lng], { icon })
          .bindPopup(`<b>${escapeHtml(name)}${me ? ' (you)' : ''}</b><br>${ago(age)} · ±${l.acc}m`)
          .addTo(g)
        allPts.push([l.lat, l.lng])
      }
    }

    // 3. Draw Meet Point
    if (trip.meet) {
      L.marker([trip.meet.lat, trip.meet.lng], {
        icon: L.divIcon({ className: '', html: '<div style="font-size:36px;line-height:1;transform:translate(-6px,-32px);filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3))">📍</div>', iconSize: [30, 30] }),
      }).bindPopup(`<b>Meet here</b><br>${escapeHtml(trip.meet.label || '')}`).addTo(g)
      allPts.push([trip.meet.lat, trip.meet.lng])
    }

    // Handle deep focus on mount
    const mapFocusId = sessionStorage.getItem('yatra:map_focus')
    if (mapFocusId) {
      sessionStorage.removeItem('yatra:map_focus')
      const target = planItems.find((p) => p.id === mapFocusId)
      if (target?.lat && target?.lng) {
        setActiveStopId(target.id)
        map.current.setView([target.lat, target.lng], 16)
        return
      }
    }

    // Auto-fit bounds on initial load
    if (!fitted.current && allPts.length) {
      fitted.current = true
      map.current.fitBounds(allPts, { padding: [50, 50], maxZoom: 15 })
    }
  })

  // Global handler for meet point from popup
  useEffect(() => {
    window.__yatraSetMeet = (lat, lng, title) => {
      updateTrip(tripId, { meet: { lat, lng, label: title, by: uid } })
    }
    return () => { delete window.__yatraSetMeet }
  }, [tripId, uid])

  const fitAll = () => {
    const pts = []
    if (showStops) filteredStops.forEach((s) => pts.push([s.lat, s.lng]))
    if (showLive) live.forEach((l) => pts.push([l.lat, l.lng]))
    if (trip.meet) pts.push([trip.meet.lat, trip.meet.lng])
    if (pts.length) map.current.fitBounds(pts, { padding: [50, 50], maxZoom: 15 })
  }

  const [settingMeet, setSettingMeet] = useState(false)
  const [meetLabel, setMeetLabel] = useState('Meet here')

  const setManualMeet = () => {
    setMeetLabel('Meet here')
    setSettingMeet(true)
  }

  const zoomToStop = (stop) => {
    setActiveStopId(stop.id)
    map.current.setView([stop.lat, stop.lng], 16, { animate: true })
  }

  return (
    <>
      {/* Day Selector Tabs */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-sm text-slate-800">🗓️ Itinerary Route Map</h2>
          <span className="text-xs text-slate-500">{filteredStops.length} stops plotted</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => { setSelectedDay('all'); fitted.current = false }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
              selectedDay === 'all' ? 'bg-teal-700 text-white shadow-sm' : 'bg-slate-200 text-slate-700'
            }`}
          >
            All Stops
          </button>
          {days.map((d) => (
            <button
              key={d.date}
              onClick={() => { setSelectedDay(d.date); fitted.current = false }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                selectedDay === d.date ? 'bg-teal-700 text-white shadow-sm' : 'bg-slate-200 text-slate-700'
              }`}
            >
              Day {d.n} {d.date === today && '• Today'}
            </button>
          ))}
        </div>
      </section>

      {/* Layer Filters & Location Share Bar */}
      <div className="card py-2.5 px-3 flex items-center justify-between gap-2 text-xs">
        <div className="flex gap-2">
          <button
            onClick={() => setShowStops(!showStops)}
            className={`px-2 py-1 rounded-md font-medium border ${showStops ? 'bg-teal-50 border-teal-300 text-teal-800 font-semibold' : 'border-slate-200 text-slate-400'}`}
          >
            📍 Stops
          </button>
          <button
            onClick={() => setShowRoute(!showRoute)}
            className={`px-2 py-1 rounded-md font-medium border ${showRoute ? 'bg-teal-50 border-teal-300 text-teal-800 font-semibold' : 'border-slate-200 text-slate-400'}`}
          >
            〰️ Route
          </button>
          <button
            onClick={() => setShowLive(!showLive)}
            className={`px-2 py-1 rounded-md font-medium border ${showLive ? 'bg-amber-50 border-amber-300 text-amber-800 font-semibold' : 'border-slate-200 text-slate-400'}`}
          >
            👥 Gang ({live.length})
          </button>
        </div>
        <button
          role="switch"
          aria-checked={sharing}
          onClick={() => setSharing(!sharing)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition ${
            sharing ? 'bg-teal-700 text-white' : 'bg-slate-200 text-slate-700'
          }`}
        >
          <span className={`inline-block size-2 rounded-full ${sharing ? 'bg-white animate-pulse' : 'bg-slate-400'}`} />
          {sharing ? 'Sharing GPS' : 'Share GPS'}
        </button>
      </div>

      {trip.meet && (
        <WhatsAppButton
          className="w-full"
          label="Send meet point to WhatsApp"
          text={`📍 *Meet here${trip.meet.label && trip.meet.label !== 'Meet here' ? `: ${trip.meet.label}` : ''}*\nhttps://www.google.com/maps/search/?api=1&query=${trip.meet.lat.toFixed(6)},${trip.meet.lng.toFixed(6)}`}
        />
      )}
      {err && <p className="text-xs text-red-600 px-1">{err}</p>}

      {/* Interactive Map Canvas */}
      <div className="relative rounded-2xl overflow-hidden border border-slate-200 h-[48dvh] z-0 shadow-inner">
        <div ref={el} className="absolute inset-0" />
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center text-2xl text-slate-700/60 z-[400]">+</div>

        {/* Floating Quick Action Buttons */}
        <div className="absolute right-2 top-2 z-[500] flex flex-col gap-1.5">
          <button className="btn-ghost text-xs py-1.5 px-2.5 shadow-md font-medium" onClick={fitAll}>
            🔍 Fit view
          </button>
          <button className="btn-ghost text-xs py-1.5 px-2.5 shadow-md font-medium" onClick={setManualMeet}>
            📍 Meet at +
          </button>
          {trip.meet && (
            <button className="btn-ghost text-xs py-1.5 px-2.5 shadow-md text-red-600" onClick={() => updateTrip(tripId, { meet: null })}>
              Clear 📍
            </button>
          )}
        </div>
      </div>

      {/* Ordered Stops List for Selected Day */}
      {showStops && filteredStops.length > 0 && (
        <section className="card p-0 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
            <h3 className="font-semibold text-xs text-slate-700 uppercase tracking-wider">
              {selectedDay === 'all' ? 'All Scheduled Stops' : `Day's Stops (In Order)`}
            </h3>
            <span className="text-xs text-teal-700 font-medium">Tap stop to center map</span>
          </div>
          <ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
            {filteredStops.map((s, idx) => (
              <li
                key={s.id}
                onClick={() => zoomToStop(s)}
                className={`p-3 flex items-start gap-3 cursor-pointer hover:bg-teal-50/50 transition ${
                  activeStopId === s.id ? 'bg-teal-50' : ''
                }`}
              >
                <span className="size-6 rounded-full bg-teal-700 text-white font-bold text-xs grid place-items-center shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between">
                    <p className="font-semibold text-sm text-slate-900 truncate">{s.title}</p>
                    <span className="text-xs font-mono text-teal-700 ml-2 shrink-0">{s.time || '—'}</span>
                  </div>
                  {s.place && <p className="text-xs text-slate-500 truncate mt-0.5">📍 {s.place}</p>}
                </div>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-teal-700 font-semibold px-2 py-1 bg-teal-100/60 rounded-md hover:bg-teal-200/60 shrink-0"
                >
                  Go ↗
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Live Friends Status List */}
      {showLive && (
        <section className="card">
          <h2 className="font-semibold text-sm">Live Gang on Map</h2>
          {live.length === 0 && <p className="text-xs text-slate-500 mt-1">Nobody is sharing their location right now.</p>}
          <ul className="mt-2 space-y-1">
            {live.map((l) => {
              const age = Date.now() - l.at.toMillis()
              return (
                <li key={l.id} className="flex justify-between text-xs">
                  <button className="underline-offset-2 hover:underline font-medium text-slate-700" onClick={() => map.current.setView([l.lat, l.lng], 16)}>
                    {byId[l.id]?.name}{l.id === uid && ' (you)'}
                  </button>
                  <span className={age > STALE_MS ? 'text-slate-400' : 'text-teal-700 font-semibold'}>{ago(age)}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {/* Manual Meet Point Modal */}
      {settingMeet && (
        <div
          className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setSettingMeet(false)}
        >
          <form
            className="bg-white rounded-2xl max-w-sm w-full p-4 space-y-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              const c = map.current.getCenter()
              updateTrip(tripId, { meet: { lat: c.lat, lng: c.lng, label: meetLabel.trim() || 'Meet here', by: uid } })
              setSettingMeet(false)
            }}
          >
            <h3 className="font-bold text-sm text-slate-800">📍 Set Meet Point at Center of Map</h3>
            <p className="text-xs text-slate-500">Center the map on your meeting spot, then name it below.</p>
            <input
              autoFocus
              className="input text-xs"
              placeholder="e.g. Hotel Lobby, Beach Shack"
              value={meetLabel}
              onChange={(e) => setMeetLabel(e.target.value)}
            />
            <div className="flex gap-2 pt-1">
              <button type="button" className="btn-ghost flex-1 py-1.5 text-xs" onClick={() => setSettingMeet(false)}>
                Cancel
              </button>
              <button type="submit" className="btn flex-1 py-1.5 text-xs">
                Set Meet Point
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
