import { useEffect, useState } from 'react'
import {
  collection, doc, getDoc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy,
} from 'firebase/firestore'
import { db } from './firebase'
import { detectThemeFromName } from './themes'

const tripRef = (t) => doc(db, 'trips', t)
const col = (t, name) => collection(db, 'trips', t, name)

export function useDoc(tripId) {
  const [data, setData] = useState(undefined)
  useEffect(() => onSnapshot(tripRef(tripId), (s) => setData(s.exists() ? { id: s.id, ...s.data() } : null), () => setData(null)), [tripId])
  return data
}

export function useCol(tripId, name, order = 'createdAt') {
  const [rows, setRows] = useState([])
  useEffect(() => {
    const q = query(col(tripId, name), orderBy(order))
    return onSnapshot(q, (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [tripId, name, order])
  return rows
}

const newId = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6)

export async function createTrip(uid, { name, start, end, me, theme, coverUrl }) {
  const id = newId()
  const chosenTheme = theme || detectThemeFromName(name)
  await setDoc(tripRef(id), {
    name,
    start,
    end,
    theme: chosenTheme,
    coverUrl: coverUrl || null,
    createdBy: uid,
    createdAt: serverTimestamp(),
  })
  await joinTrip(id, uid, me)
  recordUserTrip(uid, id, { name, start, end, theme: chosenTheme, coverUrl: coverUrl || null })
  return id
}

export const joinTrip = async (t, uid, name) => {
  await setDoc(doc(db, 'trips', t, 'members', uid), { name, joinedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true })
  // Fetch trip info to cache in user trips
  getOnce(t, null, t).then((tripData) => {
    if (tripData) {
      recordUserTrip(uid, t, {
        name: tripData.name,
        start: tripData.start,
        end: tripData.end,
        theme: tripData.theme || 'beach',
        coverUrl: tripData.coverUrl || null,
      })
    }
  }).catch(() => {})
}

export const updateMember = (t, uid, patch) => updateDoc(doc(db, 'trips', t, 'members', uid), patch)
export const updateTrip = (t, patch) => updateDoc(tripRef(t), patch)

export const add = (t, name, data) => addDoc(col(t, name), { ...data, createdAt: serverTimestamp() })
export const update = (t, name, id, patch) => updateDoc(doc(db, 'trips', t, name, id), patch)
export const remove = (t, name, id) => deleteDoc(doc(db, 'trips', t, name, id))

export const newDocId = (t, name) => doc(col(t, name)).id
export const put = (t, name, id, data) => setDoc(doc(db, 'trips', t, name, id), { ...data, createdAt: serverTimestamp() })
export const getOnce = async (t, name, id) => {
  const ref = name ? doc(db, 'trips', t, name, id) : tripRef(id)
  const s = await getDoc(ref)
  return s.exists() ? s.data() : null
}

// User Trips Tracking & Persistence
const TRIPS_LOCAL_KEY = 'yatra:my_trips'

export function getLocalTrips() {
  try {
    const raw = localStorage.getItem(TRIPS_LOCAL_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function recordUserTrip(uid, tripId, meta = {}) {
  if (!tripId) return

  // 1. Instant local storage update
  try {
    const list = getLocalTrips()
    const idx = list.findIndex((t) => t.id === tripId)
    const entry = {
      id: tripId,
      name: meta.name || list[idx]?.name || 'Trip',
      start: meta.start || list[idx]?.start || '',
      end: meta.end || list[idx]?.end || '',
      theme: meta.theme || list[idx]?.theme || 'beach',
      coverUrl: meta.coverUrl !== undefined ? meta.coverUrl : (list[idx]?.coverUrl || null),
      lastOpened: Date.now(),
    }
    if (idx >= 0) list[idx] = { ...list[idx], ...entry }
    else list.unshift(entry)
    localStorage.setItem(TRIPS_LOCAL_KEY, JSON.stringify(list.slice(0, 30)))
  } catch {}

  // 2. Firestore sync
  if (uid && db) {
    // Firestore rejects undefined values synchronously (so .catch() never sees it) — drop them first.
    const clean = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined))
    try {
      setDoc(doc(db, 'users', uid, 'trips', tripId), {
        tripId,
        ...clean,
        lastOpened: serverTimestamp(),
      }, { merge: true }).catch(() => {})
    } catch (e) {
      console.warn('trip list sync skipped', e)
    }
  }
}

export function removeLocalTrip(tripId) {
  try {
    const list = getLocalTrips().filter((t) => t.id !== tripId)
    localStorage.setItem(TRIPS_LOCAL_KEY, JSON.stringify(list))
  } catch {}
}

export function useUserTrips(uid) {
  const [trips, setTrips] = useState(getLocalTrips)

  useEffect(() => {
    if (!uid || !db) return
    const q = collection(db, 'users', uid, 'trips')
    return onSnapshot(q, (s) => {
      // Cloud entries store lastOpened as a Firestore Timestamp; local ones as epoch ms. Normalise to ms so sorting works.
      const remote = s.docs.map((d) => {
        const data = d.data()
        const lo = data.lastOpened
        return { id: d.id, ...data, lastOpened: typeof lo?.toMillis === 'function' ? lo.toMillis() : Number(lo) || Date.now() }
      })
      if (remote.length > 0) {
        // Merge with local storage
        const map = new Map()
        getLocalTrips().forEach((t) => map.set(t.id, t))
        remote.forEach((t) => map.set(t.id, { ...map.get(t.id), ...t }))
        const merged = Array.from(map.values()).sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))
        setTrips(merged)
        try { localStorage.setItem(TRIPS_LOCAL_KEY, JSON.stringify(merged)) } catch {}
      }
    }, () => {})
  }, [uid])

  return trips
}
