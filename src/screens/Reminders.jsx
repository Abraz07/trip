import { useEffect, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import { useCol, add, remove } from '../data'
import { pushState, enablePush, sendLocalTestNotification } from '../push'
import { WhatsAppButton, tripLink } from '../share'

const PUSH = import.meta.env.VITE_PUSH_ENABLED === '1' && Boolean(import.meta.env.VITE_FB_VAPID_KEY)

const fmt = (d) => d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const localInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16)

export function NotifyBanner({ tripId, uid }) {
  const [state, setState] = useState(null)
  const [testSent, setTestSent] = useState(false)

  useEffect(() => { pushState().then(setState) }, [])
  if (!state || state === 'unsupported') return null

  if (state === 'granted') {
    return (
      <div className="flex items-center justify-between px-3 py-2 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-800">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="inline-block size-2 rounded-full bg-teal-600 animate-pulse" />
          Push notifications active
        </span>
        <button
          type="button"
          className="text-teal-700 underline font-semibold hover:text-teal-900"
          onClick={async () => {
            try {
              await sendLocalTestNotification('Yatra 🏔️', 'Notifications are working! You will be alerted for headcounts and reminders.')
              setTestSent(true)
              setTimeout(() => setTestSent(false), 3000)
            } catch (e) {
              alert('Could not trigger test alert: ' + e.message)
            }
          }}
        >
          {testSent ? '✓ Alert Sent!' : 'Send test'}
        </button>
      </div>
    )
  }

  return (
    <section className="card border-teal-300 bg-teal-50">
      <p className="font-semibold">🔔 Get trip reminders</p>
      {state === 'needs-install' && <p className="text-sm mt-1">On iPhone: tap <b>Share → Add to Home Screen</b>, open Yatra from there, then turn on notifications.</p>}
      {state === 'denied' && <p className="text-sm mt-1">Notifications are blocked. Allow them for this site in your browser settings.</p>}
      {state === 'default' && (
        <>
          <p className="text-sm mt-1">Bus timings, check-out, headcounts — straight to your phone.</p>
          <button
            className="btn mt-3 w-full"
            onClick={async () => {
              try {
                const res = await enablePush(tripId, uid)
                setState(res)
                if (res === 'granted') {
                  sendLocalTestNotification('Yatra 🏔️', 'Notifications enabled successfully!')
                }
              } catch (e) {
                alert(e.message)
                setState('default')
              }
            }}
          >
            Turn on notifications
          </button>
        </>
      )}
    </section>
  )
}

export function Reminders({ tripId, trip, uid, byId }) {
  const all = useCol(tripId, 'reminders', 'at')
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [when, setWhen] = useState(() => localInput(new Date(Date.now() + 60 * 60e3)))
  const upcoming = all.filter((r) => !r.sent)

  async function save(now) {
    if (!text.trim()) return
    const reminderText = text.trim()
    await add(tripId, 'reminders', {
      text: reminderText,
      at: now ? Timestamp.now() : Timestamp.fromDate(new Date(when)),
      by: uid,
      sent: false,
    })
    if (now && Notification.permission === 'granted') {
      sendLocalTestNotification(`⏰ ${trip.name}`, reminderText).catch(() => {})
    }
    setText('')
    setOpen(false)
  }

  return (
    <section className="card">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold">⏰ Reminders</h2>
        <button className="text-teal-700 text-sm font-semibold" onClick={() => setOpen(!open)}>{open ? 'Cancel' : '+ Add'}</button>
      </div>
      {open && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); save(false) }}>
          <input required autoFocus className="input" placeholder="Bus at 9 — be in the lobby by 8:45" value={text} onChange={(e) => setText(e.target.value)} />
          <input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
          <div className="flex gap-2">
            {PUSH
              ? <button type="button" className="btn-ghost flex-1" onClick={() => save(true)}>Send now</button>
              : <WhatsAppButton className="flex-1" label="Send now" text={msg(trip, tripId, text || '…')} />}
            <button className="btn flex-1">{PUSH ? 'Schedule' : 'Save'}</button>
          </div>
          <p className="text-xs text-slate-500">{PUSH ? 'Goes to everyone who turned on notifications.' : 'Saved reminders show here for everyone — tap the WhatsApp button to ping the group.'}</p>
        </form>
      )}
      {upcoming.length === 0 && !open && <p className="text-sm text-slate-500 mt-1">No reminders scheduled.</p>}
      <ul className="mt-2 divide-y divide-slate-100">
        {upcoming.map((r) => (
          <li key={r.id} className="py-2 flex gap-3 items-start">
            <div className="flex-1">
              <p className="font-medium">{r.text}</p>
              <p className="text-xs text-slate-500">{r.at ? fmt(r.at.toDate()) : 'sending…'} · by {byId[r.by]?.name || '?'}</p>
            </div>
            {!PUSH && <WhatsAppButton label="" className="px-2.5" text={msg(trip, tripId, r.text, r.at?.toDate())} />}
            {r.by === uid && <button aria-label="Delete reminder" className="text-slate-400" onClick={() => remove(tripId, 'reminders', r.id)}>✕</button>}
          </li>
        ))}
      </ul>
    </section>
  )
}

const msg = (trip, tripId, text, at) =>
  `⏰ *${trip.name}*\n${text}${at ? `\n🕘 ${fmt(at)}` : ''}\n\n${tripLink(tripId)}`
