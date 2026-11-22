import { useEffect, useState } from 'react'
import { configured, ensureUser } from './firebase'
import Home from './screens/Home'
import Trip from './screens/Trip'
import NetworkStatus from './components/NetworkStatus'
import Welcome from './screens/Welcome'
import { getSavedName } from './components/Auth'

const parseRoute = () => (location.hash.match(/^#\/t\/([\w-]+)/) || [])[1] || null

export default function App() {
  const [user, setUser] = useState(null)
  const [error, setError] = useState(null)
  const [tripId, setTripId] = useState(parseRoute())
  const [welcomed, setWelcomed] = useState(() => Boolean(getSavedName()))

  useEffect(() => {
    const on = () => setTripId(parseRoute())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])

  useEffect(() => {
    if (configured) ensureUser().then(setUser).catch((e) => setError(e.message))
  }, [])

  if (!configured) return <Setup />
  if (error) return <Center><p className="text-red-600">Couldn't sign in: {error}</p><p className="text-sm text-slate-500 mt-2">Check that Anonymous auth is enabled in Firebase.</p></Center>
  if (!user) return <Center><div className="size-8 mx-auto rounded-full border-2 border-slate-200 border-t-teal-700 animate-spin" aria-label="Loading" /></Center>

  // First visit (no name, not signed in with Google, not opening an invite link) → welcome screen.
  // Checked at render time: joining from an invite link saves a name too, so they shouldn't be asked again.
  if (!tripId && !welcomed && !getSavedName() && user.isAnonymous) {
    return <Welcome onUserChange={setUser} onDone={() => setWelcomed(true)} />
  }

  return (
    <>
      <NetworkStatus />
      {tripId ? <Trip tripId={tripId} uid={user.uid} user={user} onUserChange={setUser} /> : <Home uid={user.uid} user={user} onUserChange={setUser} />}
    </>
  )
}

export const Center = ({ children }) => (
  <div className="min-h-dvh grid place-items-center p-6 text-center"><div>{children}</div></div>
)

function Setup() {
  return (
    <Center>
      <h1 className="text-2xl font-bold">Yatra needs Firebase keys</h1>
      <p className="text-slate-600 mt-2 max-w-sm">Copy <code>.env.example</code> to <code>.env</code>, paste your Firebase web config, and restart <code>npm run dev</code>.</p>
    </Center>
  )
}
