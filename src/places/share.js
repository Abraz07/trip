import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { updateTrip } from '../data'

// A public, read-only snapshot of a trip's visited places at shared/{shareId}.
// Anyone with the link can read it (no sign-in); only trip members can create/refresh it.
const FIELDS = ['name', 'lat', 'lng', 'category', 'rating', 'note', 'date', 'address']
const pick = (p) => Object.fromEntries(FIELDS.filter((k) => p[k] !== undefined && p[k] !== null).map((k) => [k, p[k]]))
const newShareId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')

export async function publishPlaces(trip, places, uid) {
  const shareId = trip.placesShareId || newShareId()
  await setDoc(doc(db, 'shared', shareId), {
    tripId: trip.id,
    tripName: trip.name,
    start: trip.start || '',
    end: trip.end || '',
    places: places.map((p, i) => ({ id: p.id || String(i), ...pick(p) })),
    by: uid,
    updatedAt: serverTimestamp(),
  })
  if (!trip.placesShareId) await updateTrip(trip.id, { placesShareId: shareId })
  return shareId
}

export async function loadShared(shareId) {
  const s = await getDoc(doc(db, 'shared', shareId))
  return s.exists() ? s.data() : null
}

export const shareUrl = (shareId) => `${location.origin}/#/p/${shareId}`
