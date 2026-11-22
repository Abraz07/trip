import { initializeApp } from 'firebase/app'
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  GoogleAuthProvider,
  linkWithPopup,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID,
}

export const configured = Boolean(config.apiKey && config.projectId)

export const app = configured ? initializeApp(config) : null

// App Check proves requests come from this app (required for bill scan / Gemini).
const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY
if (configured && siteKey) {
  if (import.meta.env.DEV) self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true
  import('firebase/app-check').then(({ initializeAppCheck, ReCaptchaV3Provider }) =>
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(siteKey), isTokenAutoRefreshEnabled: true }))
}

export const auth = configured ? getAuth(app) : null
// Offline-first: writes queue locally and sync when the network comes back.
export const db = configured
  ? initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })
  : null
// Cloud Storage needs the Blaze plan, so it's off unless VITE_USE_STORAGE=1, and loaded only when used.
export const storageEnabled = configured && Boolean(config.storageBucket) && import.meta.env.VITE_USE_STORAGE === '1'
let storageMod = null
export async function loadStorage() {
  if (!storageEnabled) return null
  if (!storageMod) {
    const m = await import('firebase/storage')
    storageMod = { ...m, storage: m.getStorage(app) }
  }
  return storageMod
}

export function ensureUser() {
  return new Promise((resolve, reject) => {
    const off = onAuthStateChanged(auth, (u) => {
      if (u) {
        off()
        resolve(u)
      } else {
        signInAnonymously(auth).catch(reject)
      }
    })
  })
}

// 1-Tap Google Link & Sync
export async function linkAccountWithGoogle() {
  if (!auth) throw new Error('Firebase Auth not initialized')
  const provider = new GoogleAuthProvider()
  const currentUser = auth.currentUser

  if (currentUser && currentUser.isAnonymous) {
    try {
      const res = await linkWithPopup(currentUser, provider)
      return res.user
    } catch (e) {
      if (e.code === 'auth/credential-already-in-use') {
        const res = await signInWithPopup(auth, provider)
        return res.user
      }
      throw e
    }
  } else {
    const res = await signInWithPopup(auth, provider)
    return res.user
  }
}

export async function signOutUser() {
  if (!auth) return
  await signOut(auth)
  return signInAnonymously(auth)
}
