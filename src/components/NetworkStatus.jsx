import { useEffect, useState } from 'react'
import { waitForPendingWrites } from 'firebase/firestore'
import { db } from '../firebase'

export default function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [syncing, setSyncing] = useState(false)
  const [showSyncedBanner, setShowSyncedBanner] = useState(false)

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
      setSyncing(true)

      // Wait for any queued offline writes to finish syncing
      if (db) {
        waitForPendingWrites(db)
          .then(() => {
            setSyncing(false)
            setShowSyncedBanner(true)
            setTimeout(() => setShowSyncedBanner(false), 3000)
          })
          .catch(() => {
            setSyncing(false)
          })
      } else {
        setSyncing(false)
        setShowSyncedBanner(true)
        setTimeout(() => setShowSyncedBanner(false), 3000)
      }
    }

    function handleOffline() {
      setIsOnline(false)
      setShowSyncedBanner(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (isOnline && !syncing && !showSyncedBanner) {
    return null
  }

  return (
    <div className="fixed top-2 inset-x-0 z-[2000] flex justify-center pointer-events-none px-4 animate-fade-in">
      {!isOnline && (
        <div className="bg-amber-600/95 text-white backdrop-blur-xs px-3 py-1 rounded-full text-xs font-semibold shadow-lg flex items-center gap-1.5 pointer-events-auto">
          <span className="size-2 rounded-full bg-white animate-pulse" />
          <span>Offline Mode · Edits saved locally</span>
        </div>
      )}

      {isOnline && syncing && (
        <div className="bg-teal-700/95 text-white backdrop-blur-xs px-3 py-1 rounded-full text-xs font-semibold shadow-lg flex items-center gap-1.5 pointer-events-auto">
          <span className="size-2 rounded-full bg-teal-300 animate-ping" />
          <span>Syncing offline changes…</span>
        </div>
      )}

      {isOnline && !syncing && showSyncedBanner && (
        <div className="bg-emerald-600/95 text-white backdrop-blur-xs px-3 py-1 rounded-full text-xs font-semibold shadow-lg flex items-center gap-1.5 pointer-events-auto">
          <span>✓</span>
          <span>All changes synced</span>
        </div>
      )}
    </div>
  )
}
