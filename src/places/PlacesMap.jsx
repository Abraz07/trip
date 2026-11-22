import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { catOf, stars } from './common'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Small map of visited places. `focus` = place id to zoom to.
export default function PlacesMap({ places, focus, height = '40dvh' }) {
  const el = useRef(), map = useRef(), layer = useRef(), markers = useRef({})

  useEffect(() => {
    map.current = L.map(el.current, { zoomControl: false }).setView([15.3, 74.3], 6)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    return () => map.current.remove()
  }, [])

  useEffect(() => {
    layer.current.clearLayers(); markers.current = {}
    const pts = []
    for (const p of places) {
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue
      const [, icon] = catOf(p.category)
      const m = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: `<div style="font-size:22px;background:#fff;border-radius:50%;width:36px;height:36px;display:grid;place-items:center;box-shadow:0 1px 4px #0005;border:2px solid #0f766e">${icon}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] }),
      }).bindPopup(`<b>${esc(p.name)}</b>${p.rating ? `<br><span style="color:#d97706">${stars(p.rating)}</span>` : ''}${p.note ? `<br>${esc(p.note)}` : ''}`)
      m.addTo(layer.current); markers.current[p.id] = m
      pts.push([p.lat, p.lng])
    }
    if (pts.length) map.current.fitBounds(pts, { padding: [40, 40], maxZoom: 14 })
  }, [places])

  useEffect(() => {
    const m = focus && markers.current[focus]
    if (m) { map.current.setView(m.getLatLng(), 16); m.openPopup() }
  }, [focus])

  return <div ref={el} className="rounded-2xl overflow-hidden border border-slate-200 z-0" style={{ height }} />
}
