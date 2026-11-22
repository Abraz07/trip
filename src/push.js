import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging'
import { arrayUnion } from 'firebase/firestore'
import { app } from './firebase'
import { updateMember } from './data'

const VAPID = import.meta.env.VITE_FB_VAPID_KEY
// Off until a sender (Cloud Functions or similar) is deployed; set VITE_PUSH_ENABLED=1 then.
const PUSH_DISABLED = import.meta.env.VITE_PUSH_ENABLED !== '1'

export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
export const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true

// 'unsupported' | 'needs-install' | 'default' | 'granted' | 'denied'
export async function pushState() {
  if (!VAPID || PUSH_DISABLED) return 'unsupported'
  if (isIOS && !isStandalone) return 'needs-install'
  if (!(await isSupported().catch(() => false)) || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

async function swRegistration() {
  if (!app?.options) throw new Error('Firebase app not initialized')
  const o = app.options
  const q = new URLSearchParams({
    apiKey: o.apiKey || '',
    projectId: o.projectId || '',
    messagingSenderId: o.messagingSenderId || '',
    appId: o.appId || '',
  })
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${q}`, {
    scope: '/firebase-cloud-messaging-push-scope',
  })
}

export async function enablePush(tripId, uid) {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return perm
  const messaging = getMessaging(app)
  const reg = await swRegistration()
  const token = await getToken(messaging, { vapidKey: VAPID, serviceWorkerRegistration: reg })
  if (token) {
    await updateMember(tripId, uid, { pushTokens: arrayUnion(token) })
  }
  return 'granted'
}

// Re-register silently on each open (tokens rotate), and show pushes that arrive while the app is open.
export async function refreshPush(tripId, uid, onForeground) {
  if ((await pushState()) !== 'granted') return
  try {
    const messaging = getMessaging(app)
    const reg = await swRegistration()
    const token = await getToken(messaging, { vapidKey: VAPID, serviceWorkerRegistration: reg })
    if (token) {
      await updateMember(tripId, uid, { pushTokens: arrayUnion(token) })
    }
    return onMessage(messaging, (m) => onForeground?.(m.data || {}))
  } catch (e) {
    console.warn('Push refresh failed:', e)
  }
}

// Trigger a local notification to verify notifications work on device
export async function sendLocalTestNotification(title = 'Yatra 🏔️', body = 'Test notification: You will receive trip reminders!') {
  if (Notification.permission !== 'granted') {
    throw new Error('Notification permission not granted')
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration('/firebase-cloud-messaging-push-scope')
    if (reg && reg.showNotification) {
      await reg.showNotification(title, {
        body,
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: 'test-notification',
      })
      return true
    }
  } catch (e) {
    console.warn('Service worker notification failed, trying native Notification', e)
  }

  // Fallback to native window Notification
  try {
    new Notification(title, { body, icon: '/icon.svg' })
    return true
  } catch (e) {
    console.error('Failed to trigger notification', e)
    throw e
  }
}
