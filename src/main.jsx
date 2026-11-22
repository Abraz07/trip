import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import SharedPlaces from './places/SharedPlaces'

// Public recommendation lists (#/p/{id}) render on their own, without the sign-in and trip flow in App.
const sharedId = () => (location.hash.match(/^#\/p\/([\w-]+)/) || [])[1] || null

function Root() {
  const [id, setId] = useState(sharedId())
  useEffect(() => {
    const on = () => setId(sharedId())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return id ? <SharedPlaces shareId={id} /> : <App />
}

createRoot(document.getElementById('root')).render(<Root />)
