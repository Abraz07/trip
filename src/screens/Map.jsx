import { useEffect, useRef, useState, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { serverTimestamp } from 'firebase/firestore'
import { useCol, put, update, updateTrip, add } from '../data'
import { WhatsAppButton } from '../share'
import { geocodePlace, reverseGeocode, extractCoordsFromText } from '../geocode'
import { fetchFullRoadRoute } from '../routing'
import { tripDays, ymd } from './Trip'

const STALE_MS = 10 * 60 * 1000
const shareKey = (t) => `yatra:share:${t}`
const styleKey = 'yatra:map_style'

const ago = (ms) => (ms < 60e3 ? 'just now' : ms < 3600e3 ? `${Math.round(ms / 60e3)}m ago` : `${Math.round(ms / 3600e3)}h ago`)
const distMeters = (a, b) => L.latLng(a).distanceTo(L.latLng(b))
const fmtDistance = (meters) => (meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`)

export const MAP_STYLES = [
  {
    id: 'satellite',
    name: 'Satellite',
    icon: '🛰️',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    // Place names over the photo. (CARTO's label tiles now need an API key and show a watermark.)
    labelUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  {
    id: 'voyager',
    name: 'Travel Clean',
    icon: '🗺️',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; HERE, Garmin, OpenStreetMap',
    maxZoom: 19,
  },
  {
    id: 'topo',
    name: 'Mountains & Topo',
    icon: '⛰️',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri World Topo',
    maxZoom: 19,
  },
  {
    id: 'dark',
    name: 'Night Mode',
    icon: '🌙',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    labelUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; HERE, Garmin, OpenStreetMap',
    maxZoom: 19,
    maxNativeZoom: 16, // Esri's dark canvas stops at z16; Leaflet scales those tiles beyond that
  },
  {
    id: 'osm',
    name: 'Classic Street',
    icon: '📍',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  },
]

function getCategoryTheme(item = {}) {
  const k = item.kind || ''
  const title = (item.title || '').toLowerCase()
  const place = (item.place || '').toLowerCase()
  const all = `${title} ${place}`

  if (k === 'food' || /cafe|restaurant|bistro|bar|diner|breakfast|lunch|dinner|shack/i.test(all)) {
    return { icon: '🍽️', gradient: 'linear-gradient(135deg, #f97316, #ea580c)', label: 'Food & Dining' }
  }
  if (k === 'stay' || /hotel|resort|hostel|villa|homestay|cottage|camp|stay/i.test(all)) {
    return { icon: '🏨', gradient: 'linear-gradient(135deg, #6366f1, #4338ca)', label: 'Stay & Hotel' }
  }
  if (/beach|coast|sea|cove|bay/i.test(all)) {
    return { icon: '🏖️', gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)', label: 'Beach' }
  }
  if (/trek|hike|peak|mountain|valley|fall|falls|waterfall/i.test(all)) {
    return { icon: '🏔️', gradient: 'linear-gradient(135deg, #059669, #047857)', label: 'Nature & Trek' }
  }
  if (k === 'activity' || /scuba|surf|kayak|temple|fort|palace|museum|safari/i.test(all)) {
    return { icon: '🎯', gradient: 'linear-gradient(135deg, #ec4899, #db2777)', label: 'Activity' }
  }
  return { icon: '📍', gradient: 'linear-gradient(135deg, #0d9488, #0f766e)', label: 'Sightseeing' }
}

export default function Map({ tripId, trip, uid, byId }) {
  const locs = useCol(tripId, 'locations')
  const planItems = useCol(tripId, 'plan', 'time')
  const days = tripDays(trip)
  const today = ymd(new Date())

  // Day filter
  const [selectedDay, setSelectedDay] = useState(() => {
    const focusId = sessionStorage.getItem('yatra:map_focus')
    if (focusId) {
      const match = planItems.find((p) => p.id === focusId)
      if (match?.date) return match.date
    }
    const cur = days.find((d) => d.date === today)
    return cur ? cur.date : 'all'
  })

  // Map state
  const [mapStyleId, setMapStyleId] = useState(() => {
    try { return localStorage.getItem(styleKey) || 'satellite' } catch { return 'satellite' }
  })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showLive, setShowLive] = useState(true)
  const [showStops, setShowStops] = useState(true)
  const [showRoute, setShowRoute] = useState(true)
  const [activeStopId, setActiveStopId] = useState(null)
  const [styleDropdown, setStyleDropdown] = useState(false)

  // In-map search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResultPin, setSearchResultPin] = useState(null)
  const [addDayModal, setAddDayModal] = useState(null) // place to add to plan

  // User live location state
  const [userCoords, setUserCoords] = useState(null)
  const [userAccuracy, setUserAccuracy] = useState(null)
  const [sharing, setSharing] = useState(() => {
    try { return localStorage.getItem(shareKey(tripId)) === '1' } catch { return false }
  })
  const [locating, setLocating] = useState(false)
  const [err, setErr] = useState(null)
  const [permissionBlockedModal, setPermissionBlockedModal] = useState(false)
  const [permissionSource, setPermissionSource] = useState('share')

  // Route statistics state
  const [routeStats, setRouteStats] = useState(null)

  // Meet point state
  const [settingMeet, setSettingMeet] = useState(false)
  const [meetLabel, setMeetLabel] = useState('Hotel / Meet Spot')
  const [dropPinMode, setDropPinMode] = useState(false)

  // Map refs
  const el = useRef()
  const map = useRef()
  const tileLayerRef = useRef()
  const labelLayerRef = useRef()
  const stopsLayer = useRef()
  const routeLayer = useRef()
  const liveLayer = useRef()
  const meetLayer = useRef()
  const userLayer = useRef()
  const searchLayer = useRef()
  const fitted = useRef(false)
  const [, tick] = useState(0)

  // 1. Initialize Map
  useEffect(() => {
    if (!el.current) return

    const initialStyle = MAP_STYLES.find((s) => s.id === mapStyleId) || MAP_STYLES[0]

    map.current = L.map(el.current, {
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: true,
      zoomAnimation: true,
    }).setView([15.49, 73.82], 11)

    // Base tile layer
    tileLayerRef.current = L.tileLayer(initialStyle.url, {
      maxZoom: initialStyle.maxZoom || 19,
      maxNativeZoom: initialStyle.maxNativeZoom,
      attribution: initialStyle.attribution,
    }).addTo(map.current)

    // Labels overlay if present (for satellite hybrid view)
    if (initialStyle.labelUrl) {
      labelLayerRef.current = L.tileLayer(initialStyle.labelUrl, {
        maxZoom: initialStyle.maxZoom || 19,
      maxNativeZoom: initialStyle.maxNativeZoom,
        zIndex: 2,
      }).addTo(map.current)
    }

    // Layer groups
    routeLayer.current = L.layerGroup().addTo(map.current)
    stopsLayer.current = L.layerGroup().addTo(map.current)
    meetLayer.current = L.layerGroup().addTo(map.current)
    liveLayer.current = L.layerGroup().addTo(map.current)
    userLayer.current = L.layerGroup().addTo(map.current)
    searchLayer.current = L.layerGroup().addTo(map.current)

    // Map tap handler for "Drop Pin" mode
    map.current.on('click', async (e) => {
      const { lat, lng } = e.latlng
      const rev = await reverseGeocode(lat, lng)
      setSearchResultPin({
        lat,
        lng,
        displayName: rev?.name || `Point (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        fullAddress: rev?.address || '',
      })
    })

    const interval = setInterval(() => tick((n) => n + 1), 30e3)
    return () => {
      clearInterval(interval)
      map.current?.remove()
    }
  }, [])

  // 2. Handle Map Style Switch
  function switchMapStyle(newStyleId) {
    setMapStyleId(newStyleId)
    try { localStorage.setItem(styleKey, newStyleId) } catch {}
    setStyleDropdown(false)

    if (!map.current) return
    const styleObj = MAP_STYLES.find((s) => s.id === newStyleId) || MAP_STYLES[0]

    if (tileLayerRef.current) map.current.removeLayer(tileLayerRef.current)
    if (labelLayerRef.current) map.current.removeLayer(labelLayerRef.current)

    tileLayerRef.current = L.tileLayer(styleObj.url, {
      maxZoom: styleObj.maxZoom || 19,
        maxNativeZoom: styleObj.maxNativeZoom,
      attribution: styleObj.attribution,
    }).addTo(map.current)

    if (styleObj.labelUrl) {
      labelLayerRef.current = L.tileLayer(styleObj.labelUrl, {
        maxZoom: styleObj.maxZoom || 19,
        maxNativeZoom: styleObj.maxNativeZoom,
        zIndex: 2,
      }).addTo(map.current)
    }
  }

  // 3. Geocode plan items missing lat/lng
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

  // 4. Live GPS Sharing & Watcher
  useEffect(() => {
    try { localStorage.setItem(shareKey(tripId), sharing ? '1' : '0') } catch {}
    if (!sharing) {
      update(tripId, 'locations', uid, { sharing: false }).catch(() => {})
      return
    }
    if (!navigator.geolocation) {
      setErr('Location not supported on this device.')
      setSharing(false)
      return
    }

    let last = null
    let lastAt = 0

    const id = navigator.geolocation.watchPosition(
      (p) => {
        const here = [p.coords.latitude, p.coords.longitude]
        setUserCoords(here)
        setUserAccuracy(Math.round(p.coords.accuracy))
        setErr(null)

        if (last && distMeters(last, here) < 20 && Date.now() - lastAt < 45e3) return
        last = here
        lastAt = Date.now()

        put(tripId, 'locations', uid, {
          lat: here[0],
          lng: here[1],
          acc: Math.round(p.coords.accuracy),
          sharing: true,
          at: serverTimestamp(),
        })
      },
      (e) => {
        setErr(e.code === 1 ? 'Location permission denied in browser.' : 'Could not detect location.')
        if (e.code === 1) setSharing(false)
      },
      { enableHighAccuracy: true, maximumAge: 15e3, timeout: 30e3 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [sharing, tripId, uid])

  function handleToggleShare() {
    if (sharing) {
      setSharing(false)
      update(tripId, 'locations', uid, { sharing: false }).catch(() => {})
      try { localStorage.setItem(shareKey(tripId), '0') } catch {}
    } else {
      // Ask straight away: the browser shows the phone's own location popup (iOS/Android).
      setPermissionSource('share')
      requestLocationAccess('share')
    }
  }

  function handleLocateMe() {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.')
      return
    }
    if (userCoords) {
      map.current?.flyTo(userCoords, 16, { animate: true, duration: 1 })
      return
    }
    setPermissionSource('locate')
    requestLocationAccess('locate')
  }

  function requestLocationAccess(action = 'share') {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.')
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        setPermissionBlockedModal(false)
        setErr(null)
        const coords = [pos.coords.latitude, pos.coords.longitude]
        setUserCoords(coords)
        setUserAccuracy(Math.round(pos.coords.accuracy))

        if (action === 'share' || action === 'both') {
          setSharing(true)
          try { localStorage.setItem(shareKey(tripId), '1') } catch {}
          put(tripId, 'locations', uid, {
            lat: coords[0],
            lng: coords[1],
            acc: Math.round(pos.coords.accuracy),
            sharing: true,
            at: serverTimestamp(),
          })
        }

        map.current?.flyTo(coords, 16, { animate: true, duration: 1 })
      },
      (e) => {
        setLocating(false)
        if (e.code === 1) { // PERMISSION_DENIED
          setPermissionBlockedModal(true)
          setErr('Location permission blocked in browser.')
        } else {
          alert('Could not detect location: ' + e.message)
        }
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  // Filter stops for the selected day
  const filteredStops = useMemo(() => {
    return planItems
      .filter((it) => (selectedDay === 'all' || it.date === selectedDay) && (it.lat || extractCoordsFromText(it.place)))
      .map((it) => {
        const coords = it.lat && it.lng ? { lat: it.lat, lng: it.lng } : extractCoordsFromText(it.place)
        return { ...it, ...coords }
      })
      .filter((it) => it.lat && it.lng)
  }, [planItems, selectedDay])

  const liveFriends = useMemo(() => {
    return locs.filter((l) => l.sharing && l.at)
  }, [locs])

  // Active stop object for drawer
  const activeStop = useMemo(() => {
    return filteredStops.find((s) => s.id === activeStopId) || null
  }, [filteredStops, activeStopId])

  // 6. Draw Stops & Photorealistic Pins
  useEffect(() => {
    if (!stopsLayer.current) return
    const g = stopsLayer.current
    g.clearLayers()

    if (!showStops) return

    filteredStops.forEach((stop, index) => {
      const stopNum = index + 1
      const isActive = activeStopId === stop.id
      const theme = getCategoryTheme(stop)

      // Custom 3D Droplet SVG Marker
      const pinHtml = `
        <div class="relative cursor-pointer select-none" style="transform: translate(-18px, -38px); width: 36px; height: 42px;">
          ${isActive ? '<div class="absolute -inset-2 rounded-full bg-teal-400/40 yatra-radar-ring"></div>' : ''}
          <div style="background: ${theme.gradient}; box-shadow: 0 4px 12px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.2);"
               class="relative size-9 rounded-full rounded-br-none rotate-45 border-2 border-white flex items-center justify-center transition-all ${
                 isActive ? 'scale-115 ring-2 ring-white ring-offset-2 ring-offset-teal-900' : 'hover:scale-110'
               }">
            <span class="-rotate-45 text-white font-extrabold text-xs tracking-tight">
              ${stopNum}
            </span>
          </div>
          <div class="absolute -top-1 -right-1 size-4 bg-white rounded-full shadow-md text-[10px] grid place-items-center border border-slate-200">
            ${theme.icon}
          </div>
        </div>
      `

      const icon = L.divIcon({
        className: '',
        html: pinHtml,
        iconSize: [36, 42],
        iconAnchor: [18, 38],
      })

      const marker = L.marker([stop.lat, stop.lng], { icon })
        .on('click', () => {
          setActiveStopId(stop.id)
          map.current?.flyTo([stop.lat, stop.lng], 16, { animate: true, duration: 0.8 })
        })
        .addTo(g)

      if (isActive) {
        marker.setZIndexOffset(1000)
      }
    })
  }, [filteredStops, activeStopId, showStops])

  // 7. Draw Road Route Polylines & Calculate Driving Stats
  useEffect(() => {
    if (!routeLayer.current) return
    const rg = routeLayer.current
    rg.clearLayers()

    if (!showRoute || filteredStops.length < 2) {
      setRouteStats(null)
      return
    }

    let active = true

    fetchFullRoadRoute(filteredStops).then((roadResult) => {
      if (!active) return

      if (roadResult && roadResult.latLngs && roadResult.latLngs.length > 0) {
        // High-end dual polyline (soft outer glow + crisp inner road line)
        L.polyline(roadResult.latLngs, {
          color: '#042f2e',
          weight: 7,
          opacity: 0.35,
          lineJoin: 'round',
        }).addTo(rg)

        L.polyline(roadResult.latLngs, {
          color: '#0d9488',
          weight: 3.5,
          opacity: 0.95,
          lineJoin: 'round',
        }).addTo(rg)

        setRouteStats({
          km: roadResult.distanceKm,
          min: roadResult.durationMin,
          isRoad: true,
        })
      } else {
        // Fallback straight geodesic lines
        const coords = filteredStops.map((s) => [s.lat, s.lng])
        L.polyline(coords, {
          color: '#0f766e',
          weight: 4,
          opacity: 0.8,
          dashArray: '6, 8',
          lineJoin: 'round',
        }).addTo(rg)

        let totalMeters = 0
        for (let i = 0; i < coords.length - 1; i++) {
          totalMeters += distMeters(coords[i], coords[i + 1])
        }
        const km = Math.round(totalMeters / 100) / 10
        setRouteStats({
          km,
          min: Math.round(km * 2.2), // reasonable driving speed approximation
          isRoad: false,
        })
      }
    })

    return () => { active = false }
  }, [filteredStops, showRoute])

  // 8. Draw Live Gang Avatars
  useEffect(() => {
    if (!liveLayer.current) return
    const lg = liveLayer.current
    lg.clearLayers()

    if (!showLive) return

    for (const l of liveFriends) {
      const age = Date.now() - (l.at?.toMillis ? l.at.toMillis() : Date.now())
      const name = byId[l.id]?.name || 'Traveler'
      const isMe = l.id === uid
      const isOnline = age <= STALE_MS

      const avatarHtml = `
        <div class="relative cursor-pointer select-none" style="transform: translate(-17px, -17px); width: 34px; height: 34px;">
          ${isOnline ? '<div class="absolute -inset-1.5 rounded-full bg-emerald-400/40 yatra-radar-ring"></div>' : ''}
          <div style="background: ${isMe ? '#0f766e' : isOnline ? '#059669' : '#64748b'};"
               class="size-8.5 rounded-full border-2 border-white shadow-lg text-white font-bold text-xs flex items-center justify-center">
            ${name[0]?.toUpperCase() || '?'}
          </div>
          <div class="absolute -bottom-1 -right-1 size-3 rounded-full border border-white ${isOnline ? 'bg-emerald-400' : 'bg-slate-400'}"></div>
        </div>
      `

      const icon = L.divIcon({
        className: '',
        html: avatarHtml,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      })

      L.marker([l.lat, l.lng], { icon })
        .bindPopup(`
          <div style="font-family:system-ui;min-width:140px">
            <b style="font-size:14px;color:#0f172a">${escapeHtml(name)}${isMe ? ' (You)' : ''}</b>
            <div style="font-size:11px;color:#64748b;margin-top:2px">
              ${isOnline ? '🟢 Live now' : '⚪ ' + ago(age)} · ±${l.acc}m
            </div>
          </div>
        `)
        .addTo(lg)
    }
  }, [liveFriends, showLive, uid, byId])

  // 9. Draw Meet Point Beacon
  useEffect(() => {
    if (!meetLayer.current) return
    const mg = meetLayer.current
    mg.clearLayers()

    if (trip.meet && typeof trip.meet.lat === 'number' && typeof trip.meet.lng === 'number') {
      const meetHtml = `
        <div class="relative cursor-pointer select-none" style="transform: translate(-20px, -20px); width: 40px; height: 40px;">
          <div class="absolute -inset-3 rounded-full bg-rose-500/40 yatra-radar-ring"></div>
          <div class="size-10 rounded-full bg-gradient-to-tr from-rose-600 to-amber-500 text-white font-bold grid place-items-center shadow-xl border-2 border-white text-lg">
            📍
          </div>
        </div>
      `

      const icon = L.divIcon({
        className: '',
        html: meetHtml,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      })

      L.marker([trip.meet.lat, trip.meet.lng], { icon })
        .bindPopup(`
          <div style="font-family:system-ui;min-width:180px">
            <span style="font-size:10px;font-weight:700;color:#e11d48;text-transform:uppercase">Meeting Point</span>
            <div style="font-size:15px;font-weight:700;color:#0f172a;margin-top:2px">${escapeHtml(trip.meet.label || 'Meet here')}</div>
            <a href="https://www.google.com/maps/dir/?api=1&destination=${trip.meet.lat},${trip.meet.lng}" target="_blank" rel="noreferrer"
               style="display:inline-block;margin-top:6px;background:#e11d48;color:#fff;font-size:11px;font-weight:600;padding:4px 8px;border-radius:6px;text-decoration:none">
              🧭 Directions
            </a>
          </div>
        `)
        .addTo(mg)
    }
  }, [trip.meet])

  // 10. Draw User Live Accuracy & Pin
  useEffect(() => {
    if (!userLayer.current) return
    const ug = userLayer.current
    ug.clearLayers()

    if (userCoords) {
      if (userAccuracy && userAccuracy > 15) {
        L.circle(userCoords, {
          radius: userAccuracy,
          color: '#0d9488',
          fillColor: '#14b8a6',
          fillOpacity: 0.12,
          weight: 1.5,
        }).addTo(ug)
      }

      const dotHtml = `
        <div class="relative select-none" style="transform: translate(-10px, -10px); width: 20px; height: 20px;">
          <div class="absolute -inset-2 rounded-full bg-teal-400/50 yatra-radar-ring"></div>
          <div class="size-5 rounded-full bg-teal-600 border-2 border-white shadow-lg"></div>
        </div>
      `
      L.marker(userCoords, {
        icon: L.divIcon({ className: '', html: dotHtml, iconSize: [20, 20], iconAnchor: [10, 10] }),
        zIndexOffset: 2000,
      }).addTo(ug)
    }
  }, [userCoords, userAccuracy])

  // 11. Draw In-Map Search Result Pin
  useEffect(() => {
    if (!searchLayer.current) return
    const sg = searchLayer.current
    sg.clearLayers()

    if (searchResultPin) {
      const pinHtml = `
        <div class="relative cursor-pointer select-none" style="transform: translate(-18px, -38px); width: 36px; height: 42px;">
          <div class="absolute -inset-3 rounded-full bg-purple-500/40 yatra-radar-ring"></div>
          <div class="size-9 rounded-full rounded-br-none rotate-45 bg-gradient-to-tr from-purple-600 to-indigo-500 border-2 border-white shadow-2xl flex items-center justify-center">
            <span class="-rotate-45 text-white font-bold text-sm">✨</span>
          </div>
        </div>
      `
      L.marker([searchResultPin.lat, searchResultPin.lng], {
        icon: L.divIcon({ className: '', html: pinHtml, iconSize: [36, 42], iconAnchor: [18, 38] }),
        zIndexOffset: 3000,
      }).addTo(sg)
    }
  }, [searchResultPin])

  // 12. Auto-Fit Bounds on initial load or day switch
  useEffect(() => {
    if (!map.current || fitted.current) return
    const pts = []
    filteredStops.forEach((s) => pts.push([s.lat, s.lng]))
    if (trip.meet) pts.push([trip.meet.lat, trip.meet.lng])
    if (pts.length > 0) {
      fitted.current = true
      map.current.fitBounds(pts, { padding: [50, 50], maxZoom: 15 })
    }
  }, [filteredStops, trip.meet])

  // 13. Deep focus handler from sessionStorage
  useEffect(() => {
    const mapFocusId = sessionStorage.getItem('yatra:map_focus')
    if (mapFocusId) {
      sessionStorage.removeItem('yatra:map_focus')
      const target = planItems.find((p) => p.id === mapFocusId)
      if (target?.lat && target?.lng) {
        setActiveStopId(target.id)
        setTimeout(() => {
          map.current?.flyTo([target.lat, target.lng], 16, { animate: true, duration: 1 })
        }, 300)
      }
    }
  }, [planItems])

  // Handle Fullscreen Resize
  useEffect(() => {
    const t = setTimeout(() => {
      map.current?.invalidateSize()
    }, 200)
    return () => clearTimeout(t)
  }, [isFullscreen])

  function fitAll() {
    const pts = []
    filteredStops.forEach((s) => pts.push([s.lat, s.lng]))
    if (trip.meet) pts.push([trip.meet.lat, trip.meet.lng])
    if (userCoords) pts.push(userCoords)
    liveFriends.forEach((l) => pts.push([l.lat, l.lng]))

    if (pts.length > 0) {
      map.current?.fitBounds(pts, { padding: [50, 50], maxZoom: 15 })
    }
  }

  // Search handler
  async function handleSearch(e) {
    e.preventDefault()
    if (!searchQuery.trim()) return
    setSearchLoading(true)
    const res = await geocodePlace(searchQuery.trim())
    setSearchLoading(false)
    if (res?.lat && res?.lng) {
      const pin = {
        lat: res.lat,
        lng: res.lng,
        displayName: searchQuery.trim(),
        fullAddress: res.displayName || '',
      }
      setSearchResultPin(pin)
      map.current?.flyTo([res.lat, res.lng], 15, { animate: true, duration: 1 })
    } else {
      alert(`Could not find "${searchQuery}". Try adding the city or state.`)
    }
  }

  // Quick next/prev stop switcher
  function stepStop(delta) {
    if (!filteredStops.length) return
    const curIdx = filteredStops.findIndex((s) => s.id === activeStopId)
    const nextIdx = (curIdx + delta + filteredStops.length) % filteredStops.length
    const nextStop = filteredStops[nextIdx]
    setActiveStopId(nextStop.id)
    map.current?.flyTo([nextStop.lat, nextStop.lng], 16, { animate: true, duration: 0.8 })
  }

  const activeTheme = MAP_STYLES.find((s) => s.id === mapStyleId) || MAP_STYLES[0]

  return (
    <div className={`space-y-3 ${isFullscreen ? 'fixed inset-0 z-50 bg-slate-950 p-0 m-0 flex flex-col' : ''}`}>
      {/* Top Header / Day Navigation */}
      <section className={`${isFullscreen ? 'bg-slate-900/90 backdrop-blur-md px-3 pt-3 pb-2 z-10' : 'space-y-2'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isFullscreen && (
              <button
                onClick={() => setIsFullscreen(false)}
                className="size-8 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold grid place-items-center text-sm"
              >
                ✕
              </button>
            )}
            <h2 className={`font-bold text-sm ${isFullscreen ? 'text-white' : 'text-slate-800'}`}>
              🗓️ Itinerary Route Map
            </h2>
          </div>
          <span className={`text-xs ${isFullscreen ? 'text-slate-400' : 'text-slate-500'}`}>
            {filteredStops.length} stops plotted
          </span>
        </div>

        {/* Day Horizontal Scroller */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <button
            onClick={() => { setSelectedDay('all'); fitted.current = false }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
              selectedDay === 'all'
                ? 'bg-teal-700 text-white shadow-sm'
                : isFullscreen ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'
            }`}
          >
            All Stops
          </button>
          {days.map((d) => (
            <button
              key={d.date}
              onClick={() => { setSelectedDay(d.date); fitted.current = false }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                selectedDay === d.date
                  ? 'bg-teal-700 text-white shadow-sm'
                  : isFullscreen ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'
              }`}
            >
              Day {d.n} {d.date === today && '• Today'}
            </button>
          ))}
        </div>
      </section>

      {/* Layer Toggles & GPS Share Bar (Only in normal view) */}
      {!isFullscreen && (
        <div className="card py-2 px-3 flex items-center justify-between gap-2 text-xs">
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setShowStops(!showStops)}
              className={`px-2 py-1 rounded-md font-medium border whitespace-nowrap transition ${
                showStops ? 'bg-teal-50 border-teal-300 text-teal-800 font-semibold' : 'border-slate-200 text-slate-400'
              }`}
            >
              📍 Stops ({filteredStops.length})
            </button>
            <button
              onClick={() => setShowRoute(!showRoute)}
              className={`px-2 py-1 rounded-md font-medium border whitespace-nowrap transition ${
                showRoute ? 'bg-teal-50 border-teal-300 text-teal-800 font-semibold' : 'border-slate-200 text-slate-400'
              }`}
            >
              〰️ Route
            </button>
            <button
              onClick={() => setShowLive(!showLive)}
              className={`px-2 py-1 rounded-md font-medium border whitespace-nowrap transition ${
                showLive ? 'bg-amber-50 border-amber-300 text-amber-800 font-semibold' : 'border-slate-200 text-slate-400'
              }`}
            >
              👥 Gang ({liveFriends.length})
            </button>
          </div>
          <button
            role="switch"
            aria-checked={sharing}
            onClick={handleToggleShare}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold shrink-0 transition ${
              sharing ? 'bg-teal-700 text-white shadow-sm' : 'bg-slate-200 text-slate-700'
            }`}
          >
            <span className={`inline-block size-2 rounded-full ${sharing ? 'bg-white animate-pulse' : 'bg-slate-400'}`} />
            {sharing ? 'Sharing GPS' : 'Share GPS'}
          </button>
        </div>
      )}

      {/* Interactive Map Canvas Container */}
      <div
        className={`relative overflow-hidden ${
          isFullscreen
            ? 'flex-1 w-full h-full'
            : 'rounded-2xl border border-slate-200 h-[52dvh] shadow-inner'
        }`}
      >
        {/* Leaflet Map Div */}
        <div ref={el} className="absolute inset-0 z-0" />

        {/* Floating Top In-Map Search Bar */}
        <div className="absolute top-2.5 inset-x-2.5 z-[500] max-w-sm mx-auto">
          <form onSubmit={handleSearch} className="relative shadow-lg rounded-xl overflow-hidden">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 Search place, beach, hotel, cafe…"
              className="w-full bg-white/95 backdrop-blur-md px-3.5 py-2 pr-9 text-xs font-medium text-slate-800 outline-none placeholder:text-slate-400 border border-black/10"
            />
            {searchLoading ? (
              <span className="absolute right-3 top-2.5 text-xs animate-spin text-teal-700">⏳</span>
            ) : searchQuery ? (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setSearchResultPin(null) }}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 size-5 grid place-items-center text-xs"
              >
                ✕
              </button>
            ) : null}
          </form>
        </div>

        {/* Floating Route Distance Badge */}
        {showRoute && routeStats && (
          <div className="absolute left-2.5 top-13 z-[450] bg-black/75 backdrop-blur-md text-white text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-md flex items-center gap-1.5 animate-fade-in border border-white/10">
            <span>🚗</span>
            <span>
              {routeStats.km} km · ~{routeStats.min} min travel
            </span>
          </div>
        )}

        {/* Floating Glassmorphic Map Control Pod (Right Column) */}
        <div className="absolute right-2.5 top-13 z-[500] flex flex-col gap-1.5">
          {/* Map Style Selector */}
          <div className="relative">
            <button
              title="Change Map Style"
              onClick={() => setStyleDropdown(!styleDropdown)}
              className="size-9 rounded-xl bg-white/95 backdrop-blur-md shadow-md grid place-items-center text-sm border border-black/10 hover:bg-white transition"
            >
              {activeTheme.icon}
            </button>
            {styleDropdown && (
              <div
                className="absolute right-0 top-10 w-44 bg-white/95 backdrop-blur-md rounded-xl p-1.5 shadow-2xl border border-slate-200 space-y-1 animate-fade-in z-50"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-[10px] font-bold text-slate-400 px-2 py-0.5 uppercase tracking-wider">
                  Map Style
                </div>
                {MAP_STYLES.map((st) => (
                  <button
                    key={st.id}
                    onClick={() => switchMapStyle(st.id)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition ${
                      mapStyleId === st.id ? 'bg-teal-50 text-teal-800 font-bold' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{st.icon}</span>
                      <span>{st.name}</span>
                    </span>
                    {mapStyleId === st.id && <span>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Locate Me Button */}
          <button
            title="Locate my position"
            onClick={handleLocateMe}
            className="size-9 rounded-xl bg-white/95 backdrop-blur-md shadow-md grid place-items-center text-sm border border-black/10 hover:bg-white transition"
          >
            {locating ? <span className="animate-spin text-xs">🌀</span> : '🎯'}
          </button>

          {/* Fit Bounds Button */}
          <button
            title="Fit all stops in view"
            onClick={fitAll}
            className="size-9 rounded-xl bg-white/95 backdrop-blur-md shadow-md grid place-items-center text-sm border border-black/10 hover:bg-white transition"
          >
            🔍
          </button>

          {/* Meet Point Button */}
          <button
            title="Set Meeting Point"
            onClick={() => { setMeetLabel('Meet here'); setSettingMeet(true) }}
            className="size-9 rounded-xl bg-white/95 backdrop-blur-md shadow-md grid place-items-center text-sm border border-black/10 hover:bg-white transition"
          >
            📍
          </button>

          {/* Fullscreen Expansion Toggle */}
          <button
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Map'}
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="size-9 rounded-xl bg-white/95 backdrop-blur-md shadow-md grid place-items-center text-sm border border-black/10 hover:bg-white transition"
          >
            {isFullscreen ? '↙' : '⛶'}
          </button>
        </div>

        {/* Floating Active Stop Drawer (Docked to Bottom of Map) */}
        {activeStop && (
          <div className="absolute inset-x-2.5 bottom-2.5 z-[500] max-w-sm mx-auto bg-white/95 backdrop-blur-md rounded-2xl p-3.5 shadow-2xl border border-black/10 animate-fade-in space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 uppercase tracking-wider">
                    Stop #{filteredStops.findIndex((s) => s.id === activeStop.id) + 1}
                  </span>
                  <span className="text-xs font-mono text-slate-500">
                    {activeStop.time || 'Anytime'}
                  </span>
                  {userCoords && (
                    <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                      {fmtDistance(distMeters(userCoords, [activeStop.lat, activeStop.lng]))} away
                    </span>
                  )}
                </div>
                <h4 className="font-bold text-sm text-slate-900 truncate mt-1">
                  {activeStop.title}
                </h4>
                {activeStop.place && (
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    📍 {activeStop.place}
                  </p>
                )}
                {activeStop.notes && (
                  <p className="text-[11px] text-slate-600 bg-slate-50 rounded p-1 mt-1 border border-slate-100 line-clamp-2">
                    💡 {activeStop.notes}
                  </p>
                )}
              </div>
              <button
                onClick={() => setActiveStopId(null)}
                className="text-slate-400 hover:text-slate-600 size-6 grid place-items-center text-xs rounded-full hover:bg-slate-100 shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
              <div className="flex gap-1.5">
                <button
                  onClick={() => stepStop(-1)}
                  title="Previous Stop"
                  className="size-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 grid place-items-center text-xs font-bold"
                >
                  ◀
                </button>
                <button
                  onClick={() => stepStop(1)}
                  title="Next Stop"
                  className="size-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 grid place-items-center text-xs font-bold"
                >
                  ▶
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => updateTrip(tripId, { meet: { lat: activeStop.lat, lng: activeStop.lng, label: activeStop.title, by: uid } })}
                  className="btn-ghost py-1 px-2.5 text-xs font-semibold"
                >
                  📍 Meet Here
                </button>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${activeStop.lat},${activeStop.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn py-1 px-3 text-xs font-semibold flex items-center gap-1 shadow-sm"
                >
                  🧭 Navigate
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Floating Search Result Card */}
        {searchResultPin && !activeStop && (
          <div className="absolute inset-x-2.5 bottom-2.5 z-[500] max-w-sm mx-auto bg-white/95 backdrop-blur-md rounded-2xl p-3.5 shadow-2xl border border-black/10 animate-fade-in space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 uppercase tracking-wider">
                  Found Place
                </span>
                <h4 className="font-bold text-sm text-slate-900 truncate mt-1">
                  {searchResultPin.displayName}
                </h4>
                {searchResultPin.fullAddress && (
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {searchResultPin.fullAddress}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSearchResultPin(null)}
                className="text-slate-400 hover:text-slate-600 size-6 grid place-items-center text-xs rounded-full hover:bg-slate-100 shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
              <button
                onClick={() => setAddDayModal(searchResultPin)}
                className="btn flex-1 py-1 px-2.5 text-xs font-semibold"
              >
                ➕ Add to Plan
              </button>
              <button
                onClick={() => {
                  updateTrip(tripId, { meet: { lat: searchResultPin.lat, lng: searchResultPin.lng, label: searchResultPin.displayName, by: uid } })
                  setSearchResultPin(null)
                }}
                className="btn-ghost flex-1 py-1 px-2.5 text-xs font-semibold"
              >
                📍 Set Meet Point
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Meet Point Active Floating Alert */}
      {trip.meet && (
        <div className="card py-2.5 px-3 bg-gradient-to-r from-rose-50 to-amber-50 border-rose-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-rose-500 animate-ping" />
              <p className="text-xs font-bold text-rose-950 truncate">
                📍 {trip.meet.label || 'Meeting Point'}
              </p>
            </div>
            {userCoords && (
              <p className="text-[11px] text-rose-700 font-medium">
                {fmtDistance(distMeters(userCoords, [trip.meet.lat, trip.meet.lng]))} from your current GPS
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <WhatsAppButton
              className="py-1 px-2 text-xs"
              label="Share"
              text={`📍 *Meeting Point${trip.meet.label ? `: ${trip.meet.label}` : ''}*\nhttps://www.google.com/maps/search/?api=1&query=${trip.meet.lat.toFixed(6)},${trip.meet.lng.toFixed(6)}`}
            />
            <button
              onClick={() => updateTrip(tripId, { meet: null })}
              className="text-xs text-rose-600 hover:text-rose-800 font-medium px-1.5 py-1"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Ordered Stops List for Selected Day (Normal View) */}
      {!isFullscreen && showStops && filteredStops.length > 0 && (
        <section className="card p-0 overflow-hidden shadow-sm">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
            <h3 className="font-semibold text-xs text-slate-700 uppercase tracking-wider">
              {selectedDay === 'all' ? 'All Scheduled Stops' : `Day's Stops (In Sequence)`}
            </h3>
            <span className="text-xs text-teal-700 font-medium">Tap stop to center map</span>
          </div>
          <ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
            {filteredStops.map((s, idx) => {
              const theme = getCategoryTheme(s)
              const isActive = activeStopId === s.id
              const prev = idx > 0 ? filteredStops[idx - 1] : null
              const distFromPrev = prev ? distMeters([prev.lat, prev.lng], [s.lat, s.lng]) : null

              return (
                <li
                  key={s.id}
                  onClick={() => {
                    setActiveStopId(s.id)
                    map.current?.flyTo([s.lat, s.lng], 16, { animate: true, duration: 0.8 })
                  }}
                  className={`p-3 flex items-start gap-3 cursor-pointer hover:bg-teal-50/50 transition ${
                    isActive ? 'bg-teal-50/80 border-l-4 border-teal-700' : ''
                  }`}
                >
                  <span
                    style={{ background: theme.gradient }}
                    className="size-7 rounded-full text-white font-black text-xs grid place-items-center shrink-0 mt-0.5 shadow-sm"
                  >
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between">
                      <p className="font-semibold text-sm text-slate-900 truncate">{s.title}</p>
                      <span className="text-xs font-mono text-teal-700 ml-2 shrink-0">{s.time || '—'}</span>
                    </div>
                    {s.place && <p className="text-xs text-slate-500 truncate mt-0.5">📍 {s.place}</p>}
                    {distFromPrev && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        🚗 ~{fmtDistance(distFromPrev)} from Stop #{idx}
                      </p>
                    )}
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
              )
            })}
          </ul>
        </section>
      )}

      {/* Live Friends Status List (Normal View) */}
      {!isFullscreen && showLive && (
        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">👥 Live Gang on Map</h2>
            <span className="text-xs text-slate-400">{liveFriends.length} sharing</span>
          </div>
          {liveFriends.length === 0 && (
            <p className="text-xs text-slate-500 mt-1">Nobody is sharing their location right now.</p>
          )}
          <ul className="mt-2 space-y-1.5">
            {liveFriends.map((l) => {
              const age = Date.now() - (l.at?.toMillis ? l.at.toMillis() : Date.now())
              const isOnline = age <= STALE_MS
              return (
                <li key={l.id} className="flex items-center justify-between text-xs">
                  <button
                    className="underline-offset-2 hover:underline font-medium text-slate-700 flex items-center gap-1.5"
                    onClick={() => map.current?.flyTo([l.lat, l.lng], 16, { animate: true, duration: 0.8 })}
                  >
                    <span className={`size-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    <span>{byId[l.id]?.name}{l.id === uid && ' (You)'}</span>
                  </button>
                  <span className={isOnline ? 'text-teal-700 font-semibold' : 'text-slate-400'}>
                    {isOnline ? 'Active now' : ago(age)}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Manual Meet Point Modal */}
      {settingMeet && (
        <div
          className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setSettingMeet(false)}
        >
          <form
            className="bg-white rounded-2xl max-w-sm w-full p-4 space-y-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              const c = map.current?.getCenter() || { lat: 15.49, lng: 73.82 }
              updateTrip(tripId, { meet: { lat: c.lat, lng: c.lng, label: meetLabel.trim() || 'Meet here', by: uid } })
              setSettingMeet(false)
            }}
          >
            <h3 className="font-bold text-sm text-slate-800">📍 Set Meeting Point at Map Center</h3>
            <p className="text-xs text-slate-500">
              Pan or zoom the map to your desired meeting spot, enter a name, and tap Set.
            </p>
            <input
              autoFocus
              className="input text-xs"
              placeholder="e.g. Hotel Lobby, Beach Shack, South Gate"
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

      {/* Add Search Result to Day Plan Modal */}
      {addDayModal && (
        <div
          className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setAddDayModal(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-sm w-full p-4 space-y-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-sm text-slate-800">➕ Add Place to Itinerary</h3>
            <p className="text-xs text-slate-600 truncate">
              {addDayModal.displayName}
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 block">Select Day:</label>
              <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                {days.map((d) => (
                  <button
                    key={d.date}
                    onClick={async () => {
                      await add(tripId, 'plan', {
                        title: addDayModal.displayName,
                        place: addDayModal.fullAddress || addDayModal.displayName,
                        lat: addDayModal.lat,
                        lng: addDayModal.lng,
                        date: d.date,
                        time: '10:00',
                        by: uid,
                      })
                      setAddDayModal(null)
                      setSearchResultPin(null)
                      setSelectedDay(d.date)
                    }}
                    className="p-2 rounded-xl bg-slate-50 hover:bg-teal-50 border border-slate-200 hover:border-teal-300 text-xs text-left font-medium transition"
                  >
                    Day {d.n} · {new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => setAddDayModal(null)}
              className="btn-ghost w-full py-1.5 text-xs mt-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Location Permission Blocked Help Modal */}
      {permissionBlockedModal && (
        <div
          className="fixed inset-0 z-[1100] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setPermissionBlockedModal(false)}
        >
          <div
            className="bg-white rounded-3xl max-w-sm w-full p-5 space-y-3.5 shadow-2xl text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="size-14 rounded-2xl bg-amber-100 text-amber-700 mx-auto grid place-items-center text-2xl font-bold">
              🔒
            </div>

            <div className="space-y-1">
              <h3 className="font-extrabold text-base text-slate-900">
                Location Access is Blocked
              </h3>
              <p className="text-xs text-slate-500">
                Your browser has blocked location access for Yatra. Follow these quick steps to unblock:
              </p>
            </div>

            <div className="bg-slate-50 rounded-2xl p-3.5 text-left space-y-2 border border-slate-100 text-xs">
              <div className="flex items-start gap-2">
                <span className="font-bold text-teal-800 shrink-0">1.</span>
                <p className="text-slate-700">
                  Tap the <b>🔒 lock</b> or <b>tune icon</b> in your browser's address bar.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-teal-800 shrink-0">2.</span>
                <p className="text-slate-700">
                  Find <b>Location</b> permissions and switch it to <b>Allow</b>.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-teal-800 shrink-0">3.</span>
                <p className="text-slate-700">
                  Tap <b>Try Again</b> below to refresh your location.
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPermissionBlockedModal(false)}
                className="btn-ghost flex-1 py-2 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => requestLocationAccess(permissionSource)}
                className="btn flex-1 py-2 text-xs font-bold"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
