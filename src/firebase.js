import { initializeApp } from 'firebase/app'
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  GoogleAuthProvider,
  linkWithPopup,
  linkWithRedirect,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  getRedirectResult,
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

export async function ensureUser() {
  // Finish a Google sign-in that fell back to a full-page redirect (popup blocked).
  try {
    await getRedirectResult(auth)
  } catch (e) {
    const cred = GoogleAuthProvider.credentialFromError(e)
    if (e.code === 'auth/credential-already-in-use' && cred) await signInWithCredential(auth, cred).catch(() => {})
  }
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

// Continue with Google. A guest is *linked* (same user id, so their trips and balances carry over).
// If that Google account already has a Yatra profile, we switch to it using the same credential
// (no second popup). If the browser blocks the popup, fall back to a full-page redirect.
export async function linkAccountWithGoogle() {
  if (!auth) throw new Error('Firebase Auth not initialized')
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  const currentUser = auth.currentUser
  try {
    if (currentUser?.isAnonymous) return (await linkWithPopup(currentUser, provider)).user
    return (await signInWithPopup(auth, provider)).user
  } catch (e) {
    if (e.code === 'auth/credential-already-in-use') {
      const cred = GoogleAuthProvider.credentialFromError(e)
      if (cred) return (await signInWithCredential(auth, cred)).user
    }
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      if (currentUser?.isAnonymous) await linkWithRedirect(currentUser, provider)
      else await signInWithRedirect(auth, provider)
      return null // page navigates away; ensureUser() finishes on return
    }
    throw e
  }
}

// Human-readable message for sign-in errors (null = user cancelled, show nothing).
export function authErrorMessage(e) {
  switch (e?.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return null
    case 'auth/network-request-failed':
      return 'No internet connection — try again when you’re back online.'
    case 'auth/unauthorized-domain':
      return 'Sign-in isn’t enabled for this web address yet.'
    case 'auth/too-many-requests':
      return 'Too many attempts — wait a minute and try again.'
    default:
      return 'Couldn’t sign in with Google. Please try again.'
  }
}

export async function signOutUser() {
  if (!auth) return
  await signOut(auth)
  return signInAnonymously(auth)
}
