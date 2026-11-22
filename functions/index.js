import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { setGlobalOptions, logger } from 'firebase-functions/v2'

initializeApp()
setGlobalOptions({ region: 'asia-south1', maxInstances: 3 })
const db = getFirestore()
const SITE = 'https://trip-e42a4.web.app'

// Send a notification to every member of a trip (optionally skipping one uid).
async function notifyTrip(tripId, { title, body, tag, except }) {
  const members = await db.collection(`trips/${tripId}/members`).get()
  const owners = []
  for (const m of members.docs) {
    if (m.id === except) continue
    for (const t of m.get('pushTokens') || []) owners.push({ uid: m.id, token: t })
  }
  if (!owners.length) return 0
  const res = await getMessaging().sendEachForMulticast({
    tokens: owners.map((o) => o.token),
    data: { title, body, tag: tag || '', url: `${SITE}/#/t/${tripId}` },
    webpush: { headers: { Urgency: 'high', TTL: '3600' } },
  })
  // Drop tokens for uninstalled apps / revoked permission.
  const dead = {}
  res.responses.forEach((r, i) => {
    const code = r.error?.code
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      (dead[owners[i].uid] ||= []).push(owners[i].token)
    }
  })
  await Promise.all(Object.entries(dead).map(([uid, toks]) =>
    db.doc(`trips/${tripId}/members/${uid}`).update({ pushTokens: FieldValue.arrayRemove(...toks) })))
  return res.successCount
}

const tripName = async (tripId) => (await db.doc(`trips/${tripId}`).get()).get('name') || 'Yatra'

// Claim a reminder exactly once (the schedule and the create trigger may race), then send it.
async function fireReminder(ref) {
  const claimed = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref)
    if (!s.exists || s.get('sent')) return null
    tx.update(ref, { sent: true, sentAt: FieldValue.serverTimestamp() })
    return s.data()
  })
  if (!claimed) return
  const tripId = ref.parent.parent.id
  const n = await notifyTrip(tripId, { title: `⏰ ${await tripName(tripId)}`, body: claimed.text, tag: ref.id })
  logger.info('reminder sent', { tripId, id: ref.id, delivered: n })
}

export const sendDueReminders = onSchedule('every 1 minutes', async () => {
  const due = await db.collectionGroup('reminders').where('sent', '==', false).where('at', '<=', Timestamp.now()).limit(50).get()
  await Promise.all(due.docs.map((d) => fireReminder(d.ref)))
})

// "Send now" reminders go out immediately instead of waiting for the next minute.
export const onReminderCreated = onDocumentCreated('trips/{tripId}/reminders/{id}', async (e) => {
  const at = e.data?.get('at')
  if (at && at.toMillis() <= Date.now() + 30e3) await fireReminder(e.data.ref)
})

export const onHeadcountStarted = onDocumentCreated('trips/{tripId}/headcounts/{id}', async (e) => {
  const { tripId } = e.params
  const by = e.data.get('by')
  const who = (await db.doc(`trips/${tripId}/members/${by}`).get()).get('name') || 'Someone'
  await notifyTrip(tripId, { title: `🚌 ${e.data.get('label') || 'Headcount'}`, body: `${who} started a headcount — open Yatra and tap "I'm here".`, tag: `hc-${e.params.id}`, except: by })
})

export const onPollCreated = onDocumentCreated('trips/{tripId}/polls/{id}', async (e) => {
  const { tripId } = e.params
  await notifyTrip(tripId, { title: '📊 New poll', body: e.data.get('question'), tag: `poll-${e.params.id}`, except: e.data.get('by') })
})
