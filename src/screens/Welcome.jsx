import { GoogleButton, GuestForm, OrDivider, PrivacyNote, useGoogleSignIn } from '../components/Auth'

// First-run screen: shown once, to people who haven't signed in or chosen a name yet.
export default function Welcome({ onUserChange, onDone }) {
  const google = useGoogleSignIn((u) => { onUserChange?.(u); onDone() })

  return (
    <div className="min-h-dvh bg-gradient-to-b from-teal-800 via-teal-700 to-slate-50 from-0% via-[38%] to-[38%]">
      <div className="max-w-md mx-auto px-5 pt-[max(env(safe-area-inset-top),48px)] pb-10">
        <div className="text-white text-center">
          <div className="mx-auto size-16 rounded-2xl bg-white/15 backdrop-blur grid place-items-center text-3xl shadow-lg ring-1 ring-white/20">🏔️</div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight">Yatra</h1>
          <p className="mt-1 text-teal-100">Plan, split and remember your group trips — together.</p>
        </div>

        <div className="mt-8 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-slate-200 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Get started</h2>
            <p className="text-sm text-slate-500">Free. No password needed.</p>
          </div>
          <GoogleButton onClick={google.signIn} busy={google.busy} />
          {google.error && <p role="alert" className="text-sm text-red-600 -mt-2">{google.error}</p>}
          <OrDivider />
          <GuestForm onSubmit={onDone} />
          <PrivacyNote />
        </div>

        <ul className="mt-8 grid grid-cols-3 gap-3 text-center text-xs text-slate-600">
          {[['🗓️', 'Day-by-day plan with AI'], ['💸', 'Split bills & settle by UPI'], ['📸', 'One shared photo album']].map(([i, t]) => (
            <li key={t} className="rounded-2xl bg-white p-3 ring-1 ring-slate-200"><div className="text-2xl">{i}</div><p className="mt-1 leading-tight">{t}</p></li>
          ))}
        </ul>
      </div>
    </div>
  )
}
