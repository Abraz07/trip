import { useState } from 'react'
import { updateMember } from '../data'

export default function People({ tripId, trip, uid, me, members }) {
  const link = `${location.origin}${location.pathname}#/t/${tripId}`
  const [copied, setCopied] = useState(false)
  const [upi, setUpi] = useState(me.upi || '')
  const [saved, setSaved] = useState(false)

  async function share() {
    const text = `Join "${trip.name}" on Yatra 🎒`
    if (navigator.share) { try { await navigator.share({ title: trip.name, text, url: link }); return } catch {} }
    await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <section className="card">
        <h2 className="font-semibold">Invite the gang</h2>
        <p className="text-sm text-slate-500">Anyone with this link can join — drop it in the WhatsApp group.</p>
        <div className="mt-3 flex gap-2">
          <input readOnly className="input text-sm text-slate-600" value={link} onFocus={(e) => e.target.select()} />
          <button className="btn shrink-0" onClick={share}>{copied ? 'Copied!' : 'Share'}</button>
        </div>
        <a className="btn-ghost block text-center mt-2 text-sm" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Join "${trip.name}" on Yatra 🎒 ${link}`)}`}>Send on WhatsApp</a>
      </section>

      <section className="card">
        <h2 className="font-semibold">Your UPI ID</h2>
        <p className="text-sm text-slate-500">So friends can pay you back in one tap.</p>
        <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); await updateMember(tripId, uid, { upi: upi.trim() }); setSaved(true); setTimeout(() => setSaved(false), 2000) }}>
          <input className="input" placeholder="name@okaxis" value={upi} onChange={(e) => setUpi(e.target.value)} />
          <button className="btn shrink-0">{saved ? 'Saved ✓' : 'Save'}</button>
        </form>
      </section>

      <section className="card">
        <h2 className="font-semibold">{members.length} in the group</h2>
        <ul className="mt-2 space-y-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3">
              <span className="size-9 rounded-full bg-teal-100 text-teal-800 grid place-items-center font-bold">{m.name?.[0]?.toUpperCase()}</span>
              <span className="flex-1">{m.name}{m.id === uid && <span className="text-slate-400"> (you)</span>}{m.id === trip.createdBy && <span className="text-xs ml-2 bg-amber-100 rounded px-1.5 py-0.5">organiser</span>}</span>
              {m.upi ? <span className="text-xs text-teal-700">UPI ✓</span> : <span className="text-xs text-slate-400">no UPI</span>}
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
