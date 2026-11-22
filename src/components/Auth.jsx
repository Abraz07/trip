import { useEffect, useRef, useState } from 'react'
import { linkAccountWithGoogle, signOutUser, authErrorMessage } from '../firebase'

export const getSavedName = () => { try { return localStorage.getItem('yatra:name') || '' } catch { return '' } }
export const saveName = (n) => { try { localStorage.setItem('yatra:name', n) } catch {} }

export const GoogleIcon = ({ className = 'size-5' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.15z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.41 7.34 24 12 24z" />
    <path fill="#FBBC05" d="M5.28 14.27a7.22 7.22 0 0 1 0-4.54V6.58H1.25a11.97 11.97 0 0 0 0 10.84l4.03-3.15z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.59 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
  </svg>
)

// Shared "Continue with Google" logic: links a guest (keeps their trips), saves their Google name.
export function useGoogleSignIn(onUserChange) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function signIn() {
    setBusy(true); setError('')
    try {
      const u = await linkAccountWithGoogle()
      if (u) {
        if (u.displayName && !getSavedName()) saveName(u.displayName.split(' ')[0])
        onUserChange?.(u)
      }
    } catch (e) {
      const msg = authErrorMessage(e)
      if (msg) setError(msg)
    }
    setBusy(false)
  }
  return { signIn, busy, error }
}

// Follows Google's sign-in button guidelines: white, Google "G", "Continue with Google".
export function GoogleButton({ onClick, busy, label = 'Continue with Google' }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className="w-full flex items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-800 shadow-sm hover:bg-slate-50 active:scale-[.99] disabled:opacity-60 transition">
      {busy ? <span className="size-5 rounded-full border-2 border-slate-300 border-t-slate-700 animate-spin" aria-hidden /> : <GoogleIcon />}
      <span>{busy ? 'Connecting…' : label}</span>
    </button>
  )
}

export const OrDivider = () => (
  <div className="flex items-center gap-3 text-xs text-slate-400" role="separator">
    <span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" />
  </div>
)

export function GuestForm({ onSubmit, cta = 'Continue as guest', busy }) {
  const [name, setName] = useState(getSavedName)
  const n = name.trim()
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (n) { saveName(n); onSubmit(n) } }}>
      <label htmlFor="guest-name" className="block text-xs font-medium text-slate-600 text-left">Your name</label>
      <input id="guest-name" className="input" autoComplete="given-name" maxLength={40} placeholder="What should friends call you?" value={name} onChange={(e) => setName(e.target.value)} />
      <button disabled={!n || busy} className="btn w-full py-3">{busy ? 'Please wait…' : cta}</button>
    </form>
  )
}

export const PrivacyNote = () => (
  <p className="text-[11px] leading-relaxed text-slate-400">
    No passwords. We only keep your name and the trips you join — trip details are visible to the people in that trip.
    Google sign-in shares just your name, email and photo.
  </p>
)

// Avatar button with an account menu: name (editable), Google or Guest status, sign in / sign out.
export function AccountMenu({ user, onUserChange, onNameChange }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(getSavedName)
  const ref = useRef()
  const google = useGoogleSignIn((u) => { onUserChange?.(u); setName(getSavedName()); setOpen(false) })
  const isGuest = !user || user.isAnonymous
  const display = name || user?.displayName || 'Guest'

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) { setOpen(false); setEditing(false) } }
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  async function signOut() {
    if (!confirm('Sign out of Yatra on this device? Your trips stay in your Google account — sign in again to get them back.')) return
    const guest = await signOutUser().catch(() => null)
    try { localStorage.removeItem('yatra:name'); localStorage.removeItem('yatra:my_trips') } catch {}
    onUserChange?.(guest?.user || guest)
    location.hash = '#/'
    location.reload()
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Account" onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white pl-1 pr-3 py-1 shadow-sm hover:border-teal-600">
        <Avatar user={user} name={display} />
        <span className="text-xs font-semibold text-slate-700 max-w-24 truncate">{display}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl z-50 space-y-3 text-left">
          <div className="flex items-center gap-3">
            <Avatar user={user} name={display} size="size-11 text-lg" />
            <div className="min-w-0">
              {editing ? (
                <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (n) { saveName(n); onNameChange?.(n); setEditing(false) } }}>
                  <input autoFocus aria-label="Your name" className="input py-1 px-2 text-sm" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
                  <button className="btn py-1 px-2 text-xs">Save</button>
                </form>
              ) : (
                <button className="font-semibold text-slate-900 truncate hover:underline" onClick={() => setEditing(true)}>{display} <span className="text-slate-400 text-xs">✎</span></button>
              )}
              <p className="text-xs text-slate-500 truncate">{isGuest ? 'Guest on this device' : user.email}</p>
            </div>
          </div>
          {isGuest ? (
            <div className="space-y-2 rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-600">Sign in to keep your trips if you change phones, and use Yatra on all your devices.</p>
              <GoogleButton onClick={google.signIn} busy={google.busy} label="Sign in with Google" />
              {google.error && <p role="alert" className="text-xs text-red-600">{google.error}</p>}
            </div>
          ) : (
            <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-1.5">✓ Your trips are saved to your Google account</p>
          )}
          {!isGuest && <button role="menuitem" className="w-full text-left text-sm text-red-600 hover:bg-red-50 rounded-lg px-2 py-1.5" onClick={signOut}>Sign out</button>}
        </div>
      )}
    </div>
  )
}

export function Avatar({ user, name, size = 'size-7 text-xs' }) {
  const [broken, setBroken] = useState(false)
  if (user?.photoURL && !broken) {
    return <img src={user.photoURL} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`${size} rounded-full object-cover`} />
  }
  return <span className={`${size} rounded-full bg-teal-700 text-white grid place-items-center font-bold`} aria-hidden>{(name || '?')[0].toUpperCase()}</span>
}
