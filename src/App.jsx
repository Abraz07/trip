import { useEffect, useState } from 'react'
import { configured, ensureUser } from './firebase'
import Home from './screens/Home'
import Trip from './screens/Trip'
import NetworkStatus from './components/NetworkStatus'

const parseRoute = () => (location.hash.match(/^#\/t\/([\w-]+)/) || [])[1] || null

export default function App() {
  const [user, setUser] = useState(null)
  const [error, setError] = useState(null)
  const [tripId, setTripId] = useState(parseRoute())

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
  if (!user) return <Center><p className="text-slate-500">Loading…</p></Center>

  return (
    <>
      <NetworkStatus />
      {tripId ? <Trip tripId={tripId} uid={user.uid} user={user} /> : <Home uid={user.uid} user={user} onUserChange={setUser} />}
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
