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
    name: 'Satellite Coastal',
    icon: '🛰️',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
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
    name: 'Western Ghats Topo',
    icon: '⛰️',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri World Topo',
    maxZoom: 19,
  },
  {
    id: 'dark',
    name: 'Midnight Radar',
    icon: '🌙',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    labelUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; HERE, Garmin, OpenStreetMap',
    maxZoom: 19,
    maxNativeZoom: 16,
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
    return { icon: '🍽️', color: '#c2410c', bg: '#ffedd5', label: 'Food & Dining' }
  }
  if (k === 'stay' || /hotel|resort|hostel|villa|homestay|cottage|camp|stay/i.test(all)) {
    return { icon: '🏨', color: '#4338ca', bg: '#e0e7ff', label: 'Stay & Hotel' }
  }
  if (/beach|coast|sea|cove|bay/i.test(all)) {
    return { icon: '🏖️', color: '#0284c7', bg: '#e0f2fe', label: 'Coastal Beach' }
  }
  if (/trek|hike|peak|mountain|valley|fall|falls|waterfall/i.test(all)) {
    return { icon: '🏔️', color: '#15803d', bg: '#dcfce7', label: 'Nature & Trek' }
  }
  if (k === 'activity' || /scuba|surf|kayak|temple|fort|palace|museum|safari/i.test(all)) {
    return { icon: '🎯', color: '#b45309', bg: '#fef3c7', label: 'Activity' }
  }
  return { icon: '📍', color: '#0f766e', bg: '#ccfbf1', label: 'Sightseeing' }
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
      if (focusId.startsWith('{')) {
        try {
          const parsed = JSON.parse(focusId)
          if (parsed.date) return parsed.date
        } catch {}
      }
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
  const [addDayModal, setAddDayModal] = useState(null)

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
  const [dynamicCoords, setDynamicCoords] = useState({})

  // Meet point state
  const [settingMeet, setSettingMeet] = useState(false)
  const [meetLabel, setMeetLabel] = useState('Hotel / Meet Spot')

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

    // Map tap handler to drop a custom pin
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
          speed: typeof p.coords.speed === 'number' && p.coords.speed > 0 ? Math.round(p.coords.speed * 3.6) : null,
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
            speed: typeof pos.coords.speed === 'number' && pos.coords.speed > 0 ? Math.round(pos.coords.speed * 3.6) : null,
            sharing: true,
            at: serverTimestamp(),
          })
        }

        map.current?.flyTo(coords, 16, { animate: true, duration: 1 })
      },
      (e) => {
        setLocating(false)
        if (e.code === 1) {
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
      .filter((it) => selectedDay === 'all' || it.date === selectedDay)
      .map((it) => {
        let lat = typeof it.lat === 'number' ? it.lat : (it.lat ? parseFloat(it.lat) : null)
        let lng = typeof it.lng === 'number' ? it.lng : (it.lng ? parseFloat(it.lng) : null)
        if (lat == null || isNaN(lat) || lng == null || isNaN(lng)) {
          const dyn = dynamicCoords[it.id]
          if (dyn && !isNaN(Number(dyn.lat)) && !isNaN(Number(dyn.lng))) {
            lat = Number(dyn.lat)
            lng = Number(dyn.lng)
          } else {
            const parsed = extractCoordsFromText(it.place)
            if (parsed) {
              lat = parsed.lat
              lng = parsed.lng
            }
          }
        }
        return { ...it, lat, lng }
      })
      .filter((it) => typeof it.lat === 'number' && !isNaN(it.lat) && typeof it.lng === 'number' && !isNaN(it.lng))
  }, [planItems, selectedDay, dynamicCoords])

  const liveFriends = useMemo(() => {
    return locs.filter((l) => l.sharing && l.at)
  }, [locs])

  // Active stop object for drawer
  const activeStop = useMemo(() => {
    return filteredStops.find((s) => s.id === activeStopId) || null
  }, [filteredStops, activeStopId])

  // Active stop index
  const activeStopIndex = useMemo(() => {
    return filteredStops.findIndex((s) => s.id === activeStopId)
  }, [filteredStops, activeStopId])

  // 6. Draw Stops & Coastal Editorial Numbered Markers
  useEffect(() => {
    if (!stopsLayer.current) return
    const g = stopsLayer.current
    g.clearLayers()

    if (!showStops) return

    filteredStops.forEach((stop, index) => {
      const stopNum = index + 1
      const isActive = activeStopId === stop.id
      const isVisited = !!stop.visited
      const theme = getCategoryTheme(stop)

      // 10/10 Coastal Editorial Pin HTML
      const pinHtml = `
        <div class="relative cursor-pointer select-none" style="transform: translate(-19px, -40px); width: 38px; height: 44px;">
          ${isActive ? '<div class="absolute -inset-2.5 rounded-full bg-[#c2410c]/40 yatra-radar-terracotta"></div>' : ''}
          <div style="background: ${isActive ? '#c2410c' : isVisited ? '#15803d' : '#ffffff'}; border-color: ${isActive ? '#9a3412' : isVisited ? '#166534' : '#e7e5e4'}; box-shadow: 0 4px 14px rgba(28,25,23,0.18), 0 1px 3px rgba(28,25,23,0.12);"
               class="relative size-9.5 rounded-full rounded-br-none rotate-45 border-2 flex items-center justify-center transition-all ${
                 isActive ? 'scale-115 ring-2 ring-white ring-offset-2 ring-offset-[#c2410c]' : 'hover:scale-108'
               }">
            <span class="-rotate-45 font-extrabold text-[12px] tracking-tight ${
              isActive || isVisited ? 'text-white' : 'text-[#1c1917]'
            }">
              ${isVisited ? '✓' : stopNum}
            </span>
          </div>
          <div style="background: ${theme.bg}; color: ${theme.color}; border-color: ${theme.color}33;"
               class="absolute -top-1 -right-1 size-4.5 rounded-full shadow-md text-[10px] grid place-items-center border">
            ${theme.icon}
          </div>
        </div>
      `

      const icon = L.divIcon({
        className: '',
        html: pinHtml,
        iconSize: [38, 44],
        iconAnchor: [19, 40],
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
        // High-end dual polyline (warm terracotta glow + crisp road polyline)
        L.polyline(roadResult.latLngs, {
          color: '#431407',
          weight: 6,
          opacity: 0.25,
          lineJoin: 'round',
        }).addTo(rg)

        L.polyline(roadResult.latLngs, {
          color: '#c2410c',
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
          color: '#c2410c',
          weight: 3.5,
          opacity: 0.85,
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
          min: Math.round(km * 2.2),
          isRoad: false,
        })
      }
    })

    return () => { active = false }
  }, [filteredStops, showRoute])

  // 8. Draw Live Gang Avatars with Speed Telemetry
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
      const speedKm = l.speed ? `${l.speed} km/h` : null

      const avatarHtml = `
        <div class="relative cursor-pointer select-none" style="transform: translate(-18px, -18px); width: 36px; height: 36px;">
          ${isOnline ? '<div class="absolute -inset-2 rounded-full bg-emerald-400/40 yatra-radar-ring"></div>' : ''}
          <div style="background: ${isMe ? '#c2410c' : isOnline ? '#15803d' : '#78716c'};"
               class="size-9 rounded-full border-2 border-white shadow-lg text-white font-bold text-xs flex items-center justify-center">
            ${name[0]?.toUpperCase() || '?'}
          </div>
          <div class="absolute -bottom-1 -right-1 size-3 rounded-full border border-white ${isOnline ? 'bg-emerald-400' : 'bg-slate-400'}"></div>
          ${speedKm ? `
            <div class="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black/80 text-white font-semibold text-[9px] px-1.5 py-0.2 rounded-full shadow">
              ${speedKm}
            </div>
          ` : ''}
        </div>
      `

      const icon = L.divIcon({
        className: '',
        html: avatarHtml,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      })

      L.marker([l.lat, l.lng], { icon })
        .bindPopup(`
          <div style="font-family:'Plus Jakarta Sans',sans-serif;min-width:150px">
            <b style="font-size:14px;color:#1c1917">${escapeHtml(name)}${isMe ? ' (You)' : ''}</b>
            <div style="font-size:11px;color:#78716c;margin-top:2px">
              ${isOnline ? '🟢 Live Radar' : '⚪ ' + ago(age)} · ±${l.acc}m
            </div>
            ${speedKm ? `<div style="font-size:11px;color:#c2410c;font-weight:600;margin-top:2px">🚗 Moving: ${speedKm}</div>` : ''}
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
          <div class="size-10 rounded-full bg-gradient-to-tr from-rose-600 to-amber-600 text-white font-bold grid place-items-center shadow-xl border-2 border-white text-lg">
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
          <div style="font-family:'Plus Jakarta Sans',sans-serif;min-width:180px">
            <span style="font-size:10px;font-weight:700;color:#e11d48;text-transform:uppercase">Meeting Point</span>
            <div style="font-size:15px;font-weight:700;color:#1c1917;margin-top:2px">${escapeHtml(trip.meet.label || 'Meet here')}</div>
            <a href="https://www.google.com/maps/dir/?api=1&destination=${trip.meet.lat},${trip.meet.lng}" target="_blank" rel="noreferrer"
               style="display:inline-block;margin-top:6px;background:#c2410c;color:#fff;font-size:11px;font-weight:600;padding:5px 10px;border-radius:6px;text-decoration:none">
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
          color: '#c2410c',
          fillColor: '#ea580c',
          fillOpacity: 0.12,
          weight: 1.5,
        }).addTo(ug)
      }

      const dotHtml = `
        <div class="relative select-none" style="transform: translate(-10px, -10px); width: 20px; height: 20px;">
          <div class="absolute -inset-2 rounded-full bg-[#c2410c]/50 yatra-radar-terracotta"></div>
          <div class="size-5 rounded-full bg-[#c2410c] border-2 border-white shadow-lg"></div>
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
        <div class="relative cursor-pointer select-none" style="transform: translate(-19px, -40px); width: 38px; height: 44px;">
          <div class="absolute -inset-3 rounded-full bg-purple-500/40 yatra-radar-ring"></div>
          <div class="size-9.5 rounded-full rounded-br-none rotate-45 bg-gradient-to-tr from-purple-600 to-indigo-600 border-2 border-white shadow-2xl flex items-center justify-center">
            <span class="-rotate-45 text-white font-bold text-sm">✨</span>
          </div>
        </div>
      `
      L.marker([searchResultPin.lat, searchResultPin.lng], {
        icon: L.divIcon({ className: '', html: pinHtml, iconSize: [38, 44], iconAnchor: [19, 40] }),
        zIndexOffset: 3000,
      }).addTo(sg)
    }
  }, [searchResultPin])

  // 12. Auto-Fit Bounds on initial load or day switch
  useEffect(() => {
    if (sessionStorage.getItem('yatra:map_focus')) {
      fitted.current = true
      return
    }
    if (!map.current || fitted.current) return
    const pts = []
    filteredStops.forEach((s) => pts.push([s.lat, s.lng]))
    if (trip.meet) pts.push([trip.meet.lat, trip.meet.lng])
    if (pts.length > 0) {
      fitted.current = true
      map.current.fitBounds(pts, { padding: [50, 50], maxZoom: 15 })
    }
  }, [filteredStops, trip.meet])

  // 13. Deep focus handler from sessionStorage (from Plan or Today tabs)
  useEffect(() => {
    const rawFocus = sessionStorage.getItem('yatra:map_focus')
    if (!rawFocus) return

    let focusId = rawFocus
    let focusCoords = null
    let focusDate = null
    let focusPlace = null
    let focusTitle = null

    try {
      if (rawFocus.startsWith('{')) {
        const parsed = JSON.parse(rawFocus)
        focusId = parsed.id
        if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
          focusCoords = [parsed.lat, parsed.lng]
        }
        if (parsed.date) focusDate = parsed.date
        if (parsed.place) focusPlace = parsed.place
        if (parsed.title) focusTitle = parsed.title
      }
    } catch {}

    const target = planItems.find((p) => p.id === focusId)

    if (!target && !focusCoords && planItems.length === 0) {
      return
    }

    let lat = (typeof target?.lat === 'number' ? target.lat : null) ?? focusCoords?.[0]
    let lng = (typeof target?.lng === 'number' ? target.lng : null) ?? focusCoords?.[1]
    const stopDate = target?.date || focusDate
    const placeToSearch = target?.place || focusPlace || target?.title || focusTitle

    if ((lat == null || lng == null) && placeToSearch) {
      const fromText = extractCoordsFromText(placeToSearch)
      if (fromText) {
        lat = fromText.lat
        lng = fromText.lng
      }
    }

    if (stopDate && stopDate !== selectedDay) {
      setSelectedDay(stopDate)
    }

    function flyAndHighlight(targetLat, targetLng, targetId) {
      sessionStorage.removeItem('yatra:map_focus')
      if (targetId) {
        setDynamicCoords((prev) => ({ ...prev, [targetId]: { lat: targetLat, lng: targetLng } }))
        setActiveStopId(targetId)
      }
      setShowStops(true)

      const attemptFly = (retries = 6) => {
        if (!map.current) {
          if (retries > 0) setTimeout(() => attemptFly(retries - 1), 100)
          return
        }
        try {
          map.current.invalidateSize()
          map.current.flyTo([targetLat, targetLng], 16, { animate: true, duration: 1.2 })
        } catch {}
      }

      setTimeout(() => attemptFly(), 200)
    }

    if (lat != null && lng != null) {
      flyAndHighlight(lat, lng, target?.id || focusId)
    } else if (placeToSearch) {
      sessionStorage.removeItem('yatra:map_focus')
      geocodePlace(placeToSearch).then((g) => {
        if (g?.lat && g?.lng) {
          if (target?.id) {
            update(tripId, 'plan', target.id, { lat: g.lat, lng: g.lng }).catch(() => {})
          }
          flyAndHighlight(g.lat, g.lng, target?.id || focusId)
        }
      })
    }
  }, [planItems, selectedDay])

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
    <div className={`space-y-3.5 font-sans-editorial ${isFullscreen ? 'fixed inset-0 z-50 bg-[#1c1917] p-0 m-0 flex flex-col' : ''}`}>
      {/* Top Coastal Command Capsule */}
      <section className={`${isFullscreen ? 'bg-[#1c1917]/95 backdrop-blur-md px-3.5 pt-3 pb-2.5 z-10 border-b border-white/10' : 'space-y-2.5'}`}>
        {/* Status Pill & Collaborator Cluster */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isFullscreen && (
              <button
                onClick={() => setIsFullscreen(false)}
                className="size-8 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold grid place-items-center text-xs transition"
              >
                ✕
              </button>
            )}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/90 border border-[#e7e5e4] shadow-xs text-xs font-semibold text-[#1c1917]">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{liveFriends.length > 0 ? `${liveFriends.length} Friends Active` : 'Cartographic View'}</span>
              <span className="text-slate-300">|</span>
              <span className="text-[#c2410c] font-medium">Live Radar</span>
            </div>
          </div>

          {/* Collaborator Avatars */}
          <div className="flex items-center -space-x-1.5 overflow-hidden">
            {liveFriends.slice(0, 4).map((l) => {
              const name = byId[l.id]?.name || 'Traveler'
              return (
                <div
                  key={l.id}
                  title={`${name} (${l.speed ? `${l.speed} km/h` : 'Online'})`}
                  className="size-6 rounded-full border-2 border-white bg-[#c2410c] text-white text-[10px] font-bold grid place-items-center shadow-xs"
                >
                  {name[0]?.toUpperCase()}
                </div>
              )
            })}
            {liveFriends.length > 4 && (
              <div className="size-6 rounded-full border-2 border-white bg-[#78716c] text-white text-[10px] font-bold grid place-items-center shadow-xs">
                +{liveFriends.length - 4}
              </div>
            )}
          </div>
        </div>

        {/* Day Horizontal Scroller Carousel */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          <button
            onClick={() => { setSelectedDay('all'); fitted.current = false }}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
              selectedDay === 'all'
                ? 'bg-[#c2410c] text-white shadow-sm ring-1 ring-[#c2410c]'
                : isFullscreen ? 'bg-white/10 text-slate-300 hover:bg-white/15' : 'bg-[#faf9f6] text-[#57534e] border border-[#e7e5e4] hover:bg-[#f5f5f4]'
            }`}
          >
            All Stops ({filteredStops.length})
          </button>
          {days.map((d) => (
            <button
              key={d.date}
              onClick={() => { setSelectedDay(d.date); fitted.current = false }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                selectedDay === d.date
                  ? 'bg-[#c2410c] text-white shadow-sm ring-1 ring-[#c2410c]'
                  : isFullscreen ? 'bg-white/10 text-slate-300 hover:bg-white/15' : 'bg-[#faf9f6] text-[#57534e] border border-[#e7e5e4] hover:bg-[#f5f5f4]'
              }`}
            >
              Day {d.n} {d.date === today && '· Today'}
            </button>
          ))}
        </div>
      </section>

      {/* Interactive Map Canvas Container */}
      <div
        className={`relative overflow-hidden ${
          isFullscreen
            ? 'flex-1 w-full h-full'
            : 'rounded-2xl border border-[#e7e5e4] h-[55dvh] shadow-sm'
        }`}
      >
        {/* Leaflet Map Div */}
        <div ref={el} className="absolute inset-0 z-0" />

        {/* Floating Top In-Map Search Capsule */}
        <div className="absolute top-3 inset-x-3 z-[500] max-w-sm mx-auto">
          <form onSubmit={handleSearch} className="relative shadow-md rounded-2xl overflow-hidden border border-black/10">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search beaches, cafes, fuel on route…"
              className="w-full bg-white/95 backdrop-blur-md pl-9 pr-9 py-2.5 text-xs font-medium text-[#1c1917] outline-none placeholder:text-[#a8a29e]"
            />
            <span className="absolute left-3 top-2.5 text-xs text-[#78716c]">🔍</span>
            {searchLoading ? (
              <span className="absolute right-3 top-2.5 text-xs animate-spin text-[#c2410c]">⏳</span>
            ) : searchQuery ? (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setSearchResultPin(null) }}
                className="absolute right-2.5 top-2 text-[#78716c] hover:text-[#1c1917] size-6 grid place-items-center text-xs rounded-full hover:bg-slate-100"
              >
                ✕
              </button>
            ) : null}
          </form>
        </div>

        {/* Floating Route Distance & Driving Stats Badge */}
        {showRoute && routeStats && (
          <div className="absolute left-3 top-15 z-[450] bg-[#1c1917]/85 backdrop-blur-md text-white text-[11px] font-medium px-3 py-1 rounded-full shadow-md flex items-center gap-1.5 border border-white/15">
            <span>🚗</span>
            <span>
              {routeStats.km} km · ~{routeStats.min} min drive
            </span>
          </div>
        )}

        {/* Floating Tool Rail (Right Column) */}
        <div className="absolute right-3 top-15 z-[500] flex flex-col gap-2">
          {/* Map Style Selector */}
          <div className="relative">
            <button
              title="Change Map Style"
              onClick={() => setStyleDropdown(!styleDropdown)}
              className="size-9.5 rounded-xl bg-white/95 backdrop-blur-md shadow-md grid place-items-center text-sm border border-[#e7e5e4] hover:bg-white transition active:scale-95"
            >
              {activeTheme.icon}
            </button>
            {styleDropdown && (
              <div
                className="absolute right-0 top-11 w-48 bg-white/95 backdrop-blur-md rounded-2xl p-1.5 shadow-2xl border border-[#e7e5e4] space-y-1 animate-fade-in z-50"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-[10px] font-bold text-[#78716c] px-2.5 py-1 uppercase tracking-wider">
                  Cartography Layer
                </div>
                {MAP_STYLES.map((st) => (
                  <button
                    key={st.id}
                    onClick={() => switchMapStyle(st.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs transition ${
                      mapStyleId === st.id ? 'bg-[#ffedd5] text-[#c2410c] font-bold' : 'text-[#1c1917] hover:bg-[#faf9f6]'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{st.icon}</span>
                      <span>{st.name}</span>
                    </span>
                    {mapStyleId === st.id && <span className="text-[#c2410c]">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Locate Me Button */}
          <button
            title="Locate my position"
            onClick={handleLocateMe}
            className="size-9.5 rounded-xl bg-white/95 backdrop-blur-md shadow-md grid place-items-center text-sm border border-[#e7e5e4] hover:bg-white transition active:scale-95"
          >
            {locating ? <span className="animate-spin text-xs">🌀</span> : '🎯'}
          </button>

          {/* Fit Bounds Button */}
          <button
            title="Fit all stops in view"
            onClick={fitAll}
            className="size-9.5 rounded-xl bg-white/95 backdrop-blur-md shadow-md grid place-items-center text-sm border border-[#e7e5e4] hover:bg-white transition active:scale-95"
          >
            🔍
          </button>

          {/* Meet Point Button */}
          <button
            title="Set Meeting Point"
            onClick={() => { setMeetLabel('Meet here'); setSettingMeet(true) }}
            className="size-9.5 rounded-xl bg-white/95 backdrop-blur-md shadow-md grid place-items-center text-sm border border-[#e7e5e4] hover:bg-white transition active:scale-95"
          >
            📍
          </button>

          {/* Fullscreen Expansion Toggle */}
          <button
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Map'}
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="size-9.5 rounded-xl bg-white/95 backdrop-blur-md shadow-md grid place-items-center text-sm border border-[#e7e5e4] hover:bg-white transition active:scale-95"
          >
            {isFullscreen ? '↙' : '⛶'}
          </button>
        </div>

        {/* Floating Active Stop Drawer (Docked to Bottom of Map) */}
        {activeStop && (
          <div className="absolute inset-x-3 bottom-3 z-[500] max-w-sm mx-auto bg-white/95 backdrop-blur-md rounded-2xl p-4 shadow-2xl border border-[#e7e5e4] animate-fade-in space-y-2.5">
            {/* Header: Prev / Next Switcher & Close */}
            <div className="flex items-center justify-between text-xs text-[#78716c] pb-1 border-b border-[#f0ede8]">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => stepStop(-1)}
                  className="hover:text-[#c2410c] font-medium transition"
                >
                  ‹ Prev Stop
                </button>
                <span>·</span>
                <button
                  onClick={() => stepStop(1)}
                  className="hover:text-[#c2410c] font-medium transition"
                >
                  Next Stop ›
                </button>
              </div>
              <button
                onClick={() => setActiveStopId(null)}
                className="text-[#a8a29e] hover:text-[#1c1917] size-6 grid place-items-center text-xs rounded-full hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            {/* Metadata Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] uppercase tracking-wider">
                {activeStopIndex >= 0 ? `Stop ${activeStopIndex + 1} of ${filteredStops.length}` : 'Waypoint'}
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#dcfce7] text-[#15803d]">
                {getCategoryTheme(activeStop).label}
              </span>
              {activeStop.time && (
                <span className="text-[11px] font-mono text-[#78716c]">
                  ⏰ {activeStop.time}
                </span>
              )}
              {userCoords && (
                <span className="text-[11px] font-medium text-[#c2410c] ml-auto">
                  {fmtDistance(distMeters(userCoords, [activeStop.lat, activeStop.lng]))} away
                </span>
              )}
            </div>

            {/* Destination Title (Editorial Serif) */}
            <div>
              <h4 className="font-serif-editorial text-lg md:text-xl font-medium text-[#1c1917] leading-snug">
                {activeStop.title}
              </h4>
              {activeStop.place && (
                <p className="text-xs text-[#78716c] truncate mt-0.5">
                  📍 {activeStop.place}
                </p>
              )}
            </div>

            {/* Group Safety Tip / Notes Callout */}
            {activeStop.notes && (
              <div className="bg-[#faf9f6] border border-[#f0ede8] rounded-xl p-2.5 text-xs text-[#57534e] flex items-start gap-2">
                <span className="text-[#c2410c] shrink-0">💡</span>
                <p className="line-clamp-2 leading-relaxed">{activeStop.notes}</p>
              </div>
            )}

            {/* Action Row */}
            <div className="flex items-center gap-2 pt-1">
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${activeStop.lat},${activeStop.lng}`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 bg-[#c2410c] hover:bg-[#9a3412] text-white font-semibold text-xs py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition active:scale-98"
              >
                <span>▲</span>
                <span>Turn-by-Turn Nav</span>
              </a>

              <button
                onClick={() => {
                  const newVisited = !activeStop.visited
                  update(tripId, 'plan', activeStop.id, { visited: newVisited }).catch(() => {})
                }}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition active:scale-98 flex items-center gap-1 ${
                  activeStop.visited
                    ? 'bg-[#dcfce7] border-[#86efac] text-[#15803d]'
                    : 'bg-white border-[#e7e5e4] text-[#57534e] hover:bg-[#faf9f6]'
                }`}
              >
                <span>{activeStop.visited ? '✓ Visited' : 'Mark Visited'}</span>
              </button>

              <button
                onClick={() => updateTrip(tripId, { meet: { lat: activeStop.lat, lng: activeStop.lng, label: activeStop.title, by: uid } })}
                title="Set as group meeting point"
                className="size-8.5 rounded-xl bg-white border border-[#e7e5e4] hover:bg-[#faf9f6] text-xs grid place-items-center text-[#78716c] transition active:scale-95"
              >
                📍
              </button>
            </div>
          </div>
        )}

        {/* Floating Search Result Card */}
        {searchResultPin && !activeStop && (
          <div className="absolute inset-x-3 bottom-3 z-[500] max-w-sm mx-auto bg-white/95 backdrop-blur-md rounded-2xl p-4 shadow-2xl border border-[#e7e5e4] animate-fade-in space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 uppercase tracking-wider">
                  Discovered Spot
                </span>
                <h4 className="font-serif-editorial text-base font-medium text-[#1c1917] truncate mt-1">
                  {searchResultPin.displayName}
                </h4>
                {searchResultPin.fullAddress && (
                  <p className="text-xs text-[#78716c] truncate mt-0.5">
                    {searchResultPin.fullAddress}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSearchResultPin(null)}
                className="text-[#a8a29e] hover:text-[#1c1917] size-6 grid place-items-center text-xs rounded-full hover:bg-slate-100 shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-[#f0ede8]">
              <button
                onClick={() => setAddDayModal(searchResultPin)}
                className="flex-1 bg-[#c2410c] hover:bg-[#9a3412] text-white font-semibold text-xs py-2 px-3 rounded-xl transition shadow-sm active:scale-98"
              >
                ➕ Add to Itinerary
              </button>
              <button
                onClick={() => {
                  updateTrip(tripId, { meet: { lat: searchResultPin.lat, lng: searchResultPin.lng, label: searchResultPin.displayName, by: uid } })
                  setSearchResultPin(null)
                }}
                className="flex-1 bg-white border border-[#e7e5e4] hover:bg-[#faf9f6] text-[#1c1917] font-semibold text-xs py-2 px-3 rounded-xl transition active:scale-98"
              >
                📍 Set Meet Spot
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Layer Toggles & GPS Share Bar (Normal View) */}
      {!isFullscreen && (
        <div className="bg-white rounded-2xl border border-[#e7e5e4] py-2 px-3.5 flex items-center justify-between gap-2 text-xs shadow-xs">
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setShowStops(!showStops)}
              className={`px-2.5 py-1 rounded-full font-semibold border whitespace-nowrap transition ${
                showStops ? 'bg-[#ffedd5] border-[#fdba74] text-[#c2410c]' : 'bg-[#faf9f6] border-[#e7e5e4] text-[#a8a29e]'
              }`}
            >
              📍 Stops ({filteredStops.length})
            </button>
            <button
              onClick={() => setShowRoute(!showRoute)}
              className={`px-2.5 py-1 rounded-full font-semibold border whitespace-nowrap transition ${
                showRoute ? 'bg-[#ffedd5] border-[#fdba74] text-[#c2410c]' : 'bg-[#faf9f6] border-[#e7e5e4] text-[#a8a29e]'
              }`}
            >
              〰️ Route
            </button>
            <button
              onClick={() => setShowLive(!showLive)}
              className={`px-2.5 py-1 rounded-full font-semibold border whitespace-nowrap transition ${
                showLive ? 'bg-[#dcfce7] border-[#86efac] text-[#15803d]' : 'bg-[#faf9f6] border-[#e7e5e4] text-[#a8a29e]'
              }`}
            >
              👥 Gang ({liveFriends.length})
            </button>
          </div>

          <button
            role="switch"
            aria-checked={sharing}
            onClick={handleToggleShare}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition active:scale-98 ${
              sharing ? 'bg-[#c2410c] text-white shadow-xs' : 'bg-[#f5f5f4] text-[#57534e] border border-[#e7e5e4]'
            }`}
          >
            <span className={`inline-block size-2 rounded-full ${sharing ? 'bg-white animate-pulse' : 'bg-slate-400'}`} />
            {sharing ? 'Sharing GPS' : 'Share GPS'}
          </button>
        </div>
      )}

      {/* Meeting Point Active Banner */}
      {trip.meet && (
        <div className="bg-gradient-to-r from-rose-50/80 to-amber-50/80 rounded-2xl border border-rose-200/80 p-3 flex items-center justify-between gap-2 shadow-xs">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-rose-500 animate-ping" />
              <p className="text-xs font-bold text-rose-950 truncate">
                📍 {trip.meet.label || 'Meeting Point'}
              </p>
            </div>
            {userCoords && (
              <p className="text-[11px] text-rose-700 font-medium mt-0.5">
                {fmtDistance(distMeters(userCoords, [trip.meet.lat, trip.meet.lng]))} from your current GPS
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <WhatsAppButton
              className="py-1 px-2.5 text-xs font-semibold"
              label="Share"
              text={`📍 *Meeting Point${trip.meet.label ? `: ${trip.meet.label}` : ''}*\nhttps://www.google.com/maps/search/?api=1&query=${trip.meet.lat.toFixed(6)},${trip.meet.lng.toFixed(6)}`}
            />
            <button
              onClick={() => updateTrip(tripId, { meet: null })}
              className="text-xs text-rose-600 hover:text-rose-800 font-medium px-2 py-1"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Ordered Stops Sequence List (Normal View) */}
      {!isFullscreen && showStops && filteredStops.length > 0 && (
        <section className="bg-white rounded-2xl border border-[#e7e5e4] p-0 overflow-hidden shadow-xs">
          <div className="px-4 py-3 bg-[#faf9f6] border-b border-[#f0ede8] flex justify-between items-center">
            <h3 className="font-semibold text-xs text-[#57534e] uppercase tracking-wider">
              {selectedDay === 'all' ? 'All Scheduled Stops' : `Day's Stops (In Sequence)`}
            </h3>
            <span className="text-xs text-[#c2410c] font-medium">Tap stop to center map</span>
          </div>
          <ul className="divide-y divide-[#f0ede8] max-h-64 overflow-y-auto">
            {filteredStops.map((s, idx) => {
              const theme = getCategoryTheme(s)
              const isActive = activeStopId === s.id
              const isVisited = !!s.visited
              const prev = idx > 0 ? filteredStops[idx - 1] : null
              const distFromPrev = prev ? distMeters([prev.lat, prev.lng], [s.lat, s.lng]) : null

              return (
                <li
                  key={s.id}
                  onClick={() => {
                    setActiveStopId(s.id)
                    map.current?.flyTo([s.lat, s.lng], 16, { animate: true, duration: 0.8 })
                  }}
                  className={`p-3.5 flex items-start gap-3 cursor-pointer hover:bg-[#faf9f6] transition ${
                    isActive ? 'bg-[#ffedd5]/50 border-l-4 border-[#c2410c]' : ''
                  }`}
                >
                  <span
                    style={{ background: isVisited ? '#15803d' : isActive ? '#c2410c' : theme.color }}
                    className="size-7 rounded-full text-white font-extrabold text-xs grid place-items-center shrink-0 mt-0.5 shadow-xs"
                  >
                    {isVisited ? '✓' : idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between">
                      <p className={`text-sm truncate ${isActive ? 'font-bold text-[#c2410c]' : 'font-semibold text-[#1c1917]'}`}>
                        {s.title}
                      </p>
                      <span className="text-xs font-mono text-[#78716c] ml-2 shrink-0">{s.time || '—'}</span>
                    </div>
                    {s.place && <p className="text-xs text-[#78716c] truncate mt-0.5">📍 {s.place}</p>}
                    {distFromPrev && (
                      <p className="text-[10px] text-[#a8a29e] mt-0.5">
                        🚗 ~{fmtDistance(distFromPrev)} from Stop #{idx}
                      </p>
                    )}
                  </div>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-[#c2410c] font-semibold px-2.5 py-1 bg-[#ffedd5] hover:bg-[#fed7aa] rounded-lg shrink-0 transition"
                  >
                    Go ↗
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Live Friends Gang Status (Normal View) */}
      {!isFullscreen && showLive && (
        <section className="bg-white rounded-2xl border border-[#e7e5e4] p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm text-[#1c1917]">👥 Live Gang Radar</h2>
            <span className="text-xs text-[#78716c]">{liveFriends.length} sharing</span>
          </div>
          {liveFriends.length === 0 && (
            <p className="text-xs text-[#a8a29e] mt-1.5">Nobody is sharing their location right now.</p>
          )}
          <ul className="mt-2.5 space-y-2">
            {liveFriends.map((l) => {
              const age = Date.now() - (l.at?.toMillis ? l.at.toMillis() : Date.now())
              const isOnline = age <= STALE_MS
              return (
                <li key={l.id} className="flex items-center justify-between text-xs">
                  <button
                    className="hover:text-[#c2410c] font-medium text-[#1c1917] flex items-center gap-2 transition"
                    onClick={() => map.current?.flyTo([l.lat, l.lng], 16, { animate: true, duration: 0.8 })}
                  >
                    <span className={`size-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                    <span>{byId[l.id]?.name}{l.id === uid && ' (You)'}</span>
                  </button>
                  <span className={isOnline ? 'text-emerald-700 font-semibold' : 'text-[#a8a29e]'}>
                    {isOnline ? 'Active on Radar' : ago(age)}
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
            className="bg-white rounded-2xl max-w-sm w-full p-4 space-y-3 shadow-2xl border border-[#e7e5e4]"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              const c = map.current?.getCenter() || { lat: 15.49, lng: 73.82 }
              updateTrip(tripId, { meet: { lat: c.lat, lng: c.lng, label: meetLabel.trim() || 'Meet here', by: uid } })
              setSettingMeet(false)
            }}
          >
            <h3 className="font-bold text-sm text-[#1c1917]">📍 Set Meeting Point at Map Center</h3>
            <p className="text-xs text-[#78716c]">
              Pan or zoom the map to your desired meeting spot, enter a name, and tap Set.
            </p>
            <input
              autoFocus
              className="w-full rounded-xl border border-[#e7e5e4] bg-[#faf9f6] px-3 py-2 text-xs outline-none focus:border-[#c2410c]"
              placeholder="e.g. Hotel Lobby, Beach Shack, South Gate"
              value={meetLabel}
              onChange={(e) => setMeetLabel(e.target.value)}
            />
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                className="flex-1 py-2 text-xs font-semibold text-[#78716c] hover:bg-slate-100 rounded-xl"
                onClick={() => setSettingMeet(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 text-xs font-semibold bg-[#c2410c] hover:bg-[#9a3412] text-white rounded-xl shadow-xs"
              >
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
            className="bg-white rounded-2xl max-w-sm w-full p-4 space-y-3 shadow-2xl border border-[#e7e5e4]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-sm text-[#1c1917]">➕ Add Place to Itinerary</h3>
            <p className="text-xs text-[#78716c] truncate">
              {addDayModal.displayName}
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#57534e] block">Select Day:</label>
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
                    className="p-2.5 rounded-xl bg-[#faf9f6] hover:bg-[#ffedd5] border border-[#e7e5e4] hover:border-[#fdba74] text-xs text-left font-medium transition"
                  >
                    Day {d.n} · {new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => setAddDayModal(null)}
              className="w-full py-2 text-xs font-semibold text-[#78716c] hover:bg-slate-100 rounded-xl mt-1"
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
            className="bg-white rounded-3xl max-w-sm w-full p-5 space-y-3.5 shadow-2xl text-center border border-[#e7e5e4]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="size-14 rounded-2xl bg-[#ffedd5] text-[#c2410c] mx-auto grid place-items-center text-2xl font-bold">
              🔒
            </div>

            <div className="space-y-1">
              <h3 className="font-extrabold text-base text-[#1c1917]">
                Location Access is Blocked
              </h3>
              <p className="text-xs text-[#78716c]">
                Your browser has blocked location access for Yatra. Follow these quick steps to unblock:
              </p>
            </div>

            <div className="bg-[#faf9f6] rounded-2xl p-3.5 text-left space-y-2 border border-[#f0ede8] text-xs">
              <div className="flex items-start gap-2">
                <span className="font-bold text-[#c2410c] shrink-0">1.</span>
                <p className="text-[#57534e]">
                  Tap the <b>🔒 lock</b> or <b>tune icon</b> in your browser's address bar.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-[#c2410c] shrink-0">2.</span>
                <p className="text-[#57534e]">
                  Find <b>Location</b> permissions and switch it to <b>Allow</b>.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-[#c2410c] shrink-0">3.</span>
                <p className="text-[#57534e]">
                  Tap <b>Try Again</b> below to refresh your location.
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPermissionBlockedModal(false)}
                className="flex-1 py-2 text-xs font-semibold text-[#78716c] hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => requestLocationAccess(permissionSource)}
                className="flex-1 py-2 text-xs font-bold bg-[#c2410c] hover:bg-[#9a3412] text-white rounded-xl shadow-xs"
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
