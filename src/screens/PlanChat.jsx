import { useState } from 'react'
import { askJSON } from '../ai'
import { inr } from '../settle'

// Chat to build or edit the plan: paste a whole itinerary, or say "move rafting to day 2".
// The AI proposes changes; nothing is saved until the person reviews them and taps Apply.
const KIND_ICON = { place: '📍', activity: '🎯', food: '🍽️', stay: '🏨', travel: '🚗' }
const HHMM = /^\d{2}:\d{2}$/

const STOP = {
  title: { type: 'STRING' },
  place: { type: 'STRING', description: 'place name plus town so it can be found on a map; empty if none' },
  kind: { type: 'STRING', enum: Object.keys(KIND_ICON) },
  time: { type: 'STRING', description: 'HH:MM 24h, empty if not given' },
  duration: { type: 'STRING', description: 'e.g. 2h, empty if unknown' },
  cost: { type: 'NUMBER', description: 'INR per person if mentioned, else 0' },
  notes: { type: 'STRING', description: 'extra details from the message (booking IDs, contacts), else empty' },
  booking: { type: 'STRING', enum: ['none', 'todo', 'booked'], description: 'todo if the user says to book it / needs booking; booked if they say it is booked/confirmed' },
  bookingRef: { type: 'STRING', description: 'booking ID / PNR / ref if given, else empty' },
}

export default function PlanChat({ trip, days, items, onAdd, onUpdate, onRemove, onAddDestinations, onClose }) {
  const [chat, setChat] = useState([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState(null) // { add: [], update: [], remove: [], destinations: [] } with .keep flags
  const [applying, setApplying] = useState(false)

  const dayOf = (n) => days.find((d) => d.n === n)
  const itemById = Object.fromEntries(items.map((i) => [i.id, i]))
  const label = (d) => (d ? `Day ${d.n} · ${new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}` : '?')

  async function send(e) {
    e?.preventDefault()
    const text = msg.trim()
    if (!text || busy) return
    setMsg(''); setBusy(true); setProposal(null)
    setChat((c) => [...c, { role: 'you', text }])
    try {
      const calendar = days.map((d) => `Day ${d.n} = ${d.date} (${new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })})`).join('\n')
      const current = days.map((d) => {
        const l = items.filter((i) => i.date === d.date).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'))
        return `Day ${d.n}: ${l.length ? l.map((i) => `[id ${i.id}] ${i.time || 'anytime'} ${i.title}${i.place ? ` @ ${i.place}` : ''}`).join(' | ') : '(empty)'}`
      }).join('\n')
      const out = await askJSON({
        system: `You maintain a group trip's day-by-day itinerary. Turn the user's message into concrete changes.
- A pasted itinerary becomes "add" stops on the right days. Map "Day N", dates ("27 Nov", "27/11") and weekdays to the trip's day numbers using the calendar. Never use a day outside 1..${days.length}.
- Split combined lines into separate stops ("breakfast then trek" = 2 stops). Convert times like "5am" or "evening" to HH:MM (morning 09:00, afternoon 14:00, evening 18:00, night 20:00) only if a time is implied.
- Edits ("move", "change time", "rename") go in "update" using the existing [id]. Removals go in "remove" with the id. Never remove anything the user didn't ask to remove.
- Don't add stops that already exist on that day.
- If the message names towns/regions the trip visits, list them in "destinations" in travel order.
- "reply" is one short friendly sentence summarising the proposal, or a question if the message is unclear.`,
        parts: [
          `Trip "${trip.name}" calendar:\n${calendar}`,
          `Current plan:\n${current}`,
          ...(chat.length ? [`Earlier in this chat:\n${chat.slice(-6).map((c) => `${c.role}: ${c.text}`).join('\n')}`] : []),
          `User: ${text}`,
        ],
        schema: {
          type: 'OBJECT',
          properties: {
            reply: { type: 'STRING' },
            add: { type: 'ARRAY', items: { type: 'OBJECT', properties: { day: { type: 'INTEGER' }, ...STOP }, required: ['day', 'title', 'kind'] } },
            update: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, day: { type: 'INTEGER', description: 'new day number if moving, else 0' }, time: { type: 'STRING' }, title: { type: 'STRING' }, duration: { type: 'STRING' }, notes: { type: 'STRING' } }, required: ['id'] } },
            remove: { type: 'ARRAY', items: { type: 'STRING' } },
            destinations: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['reply', 'add', 'update', 'remove'],
        },
        temperature: 0.1,
        thinking: 'low',
      })
      const add = (out.add || []).filter((a) => dayOf(a.day) && a.title).map((a) => ({ ...a, time: HHMM.test(a.time || '') ? a.time : '', keep: true }))
      // Snapshot the stop being changed: applying a removal updates the live list while this preview is still shown.
      const update = (out.update || []).filter((u) => itemById[u.id]).map((u) => ({ ...u, orig: itemById[u.id], keep: true }))
      const remove = (out.remove || []).filter((id) => itemById[id]).map((id) => ({ id, orig: itemById[id], keep: true }))
      const have = new Set((trip.destinations || []).map((d) => d.toLowerCase()))
      const destinations = (out.destinations || []).filter((d) => d && !have.has(d.toLowerCase()))
      setChat((c) => [...c, { role: 'ai', text: out.reply || 'Here’s what I’d change.' }])
      if (add.length || update.length || remove.length || destinations.length) setProposal({ add, update, remove, destinations, keepDest: true })
    } catch (err) {
      setChat((c) => [...c, { role: 'ai', text: `⚠️ ${err.message}` }])
    }
    setBusy(false)
  }

  const toggle = (k, i) => setProposal({ ...proposal, [k]: proposal[k].map((x, j) => (j === i ? { ...x, keep: !x.keep } : x)) })
  const count = proposal ? ['add', 'update', 'remove'].reduce((n, k) => n + proposal[k].filter((x) => x.keep).length, 0) + (proposal.keepDest ? proposal.destinations.length : 0) : 0

  async function apply() {
    setApplying(true)
    const p = proposal
    if (p.keepDest && p.destinations.length) await onAddDestinations(p.destinations)
    for (const a of p.add.filter((x) => x.keep)) await onAdd(a, dayOf(a.day).date)
    for (const u of p.update.filter((x) => x.keep)) {
      const patch = {}
      if (u.day && dayOf(u.day)) patch.date = dayOf(u.day).date
      for (const k of ['time', 'title', 'duration', 'notes']) if (u[k]) patch[k] = k === 'time' && !HHMM.test(u[k]) ? undefined : u[k]
      Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k])
      if (Object.keys(patch).length) await onUpdate(u.id, patch)
    }
    for (const r of p.remove.filter((x) => x.keep)) await onRemove(r.id)
    setChat((c) => [...c, { role: 'ai', text: `✅ Done — applied ${count} change${count === 1 ? '' : 's'}.` }])
    setProposal(null); setApplying(false)
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-2 text-sm">
      <div className="flex justify-between items-center">
        <p className="font-semibold text-violet-900">💬 Plan chat</p>
        <button aria-label="Close chat" className="text-slate-400" onClick={onClose}>✕</button>
      </div>
      {chat.length === 0 && (
        <p className="text-xs text-slate-600">Paste your whole itinerary (from WhatsApp, notes, anywhere) or ask for changes — "move rafting to day 2", "add dinner at 8pm on day 1". You'll see the changes before anything is saved.</p>
      )}
      {chat.length > 0 && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto" aria-live="polite">
          {chat.map((c, i) => (
            <p key={i} className={`rounded-xl px-3 py-1.5 w-fit max-w-[90%] whitespace-pre-wrap ${c.role === 'you' ? 'ml-auto bg-teal-700 text-white' : 'bg-white border border-violet-200'}`}>{c.text.length > 600 && c.role === 'you' ? c.text.slice(0, 600) + '…' : c.text}</p>
          ))}
          {busy && <p className="text-violet-700 animate-pulse">Reading your plan…</p>}
        </div>
      )}

      {proposal && (
        <div className="bg-white rounded-xl border border-violet-200 p-2.5 space-y-2">
          {proposal.destinations.length > 0 && (
            <label className="flex gap-2 items-start">
              <input type="checkbox" className="mt-0.5 size-4 accent-teal-700" checked={proposal.keepDest} onChange={() => setProposal({ ...proposal, keepDest: !proposal.keepDest })} />
              <span>📍 Add destinations: <b>{proposal.destinations.join(' → ')}</b></span>
            </label>
          )}
          {days.map((d) => {
            const adds = proposal.add.map((a, i) => [a, i]).filter(([a]) => a.day === d.n)
            if (!adds.length) return null
            return (
              <div key={d.date}>
                <p className="text-xs font-semibold text-slate-600">{label(d)}</p>
                {adds.map(([a, i]) => (
                  <label key={i} className="flex gap-2 items-start py-0.5">
                    <input type="checkbox" className="mt-0.5 size-4 accent-teal-700" checked={a.keep} onChange={() => toggle('add', i)} />
                    <span>➕ {KIND_ICON[a.kind] || '📍'} <span className="font-mono text-xs text-slate-500">{a.time || 'anytime'}</span> {a.title}{a.cost ? <span className="text-xs text-slate-500"> · ≈ {inr(a.cost)}</span> : null}{a.booking === 'todo' ? <span className="text-xs text-amber-700"> · 🎟️ to book</span> : a.booking === 'booked' ? <span className="text-xs text-teal-700"> · ✅ booked{a.bookingRef ? ` ${a.bookingRef}` : ''}</span> : null}</span>
                  </label>
                ))}
              </div>
            )
          })}
          {proposal.update.map((u, i) => {
            const it = u.orig
            const changes = [u.day && dayOf(u.day) && dayOf(u.day).date !== it.date ? `→ ${label(dayOf(u.day))}` : '', u.time && u.time !== it.time ? `time ${it.time || '—'} → ${u.time}` : '', u.title && u.title !== it.title ? `rename → "${u.title}"` : '', u.duration && u.duration !== it.duration ? `duration → ${u.duration}` : '', u.notes ? 'update notes' : ''].filter(Boolean)
            return (
              <label key={u.id} className="flex gap-2 items-start">
                <input type="checkbox" className="mt-0.5 size-4 accent-teal-700" checked={u.keep} onChange={() => toggle('update', i)} />
                <span>✏️ <b>{it.title}</b>: {changes.join(', ') || 'no visible change'}</span>
              </label>
            )
          })}
          {proposal.remove.map((r, i) => (
            <label key={r.id} className="flex gap-2 items-start">
              <input type="checkbox" className="mt-0.5 size-4 accent-teal-700" checked={r.keep} onChange={() => toggle('remove', i)} />
              <span className="text-red-700">🗑️ Remove <b>{r.orig.title}</b></span>
            </label>
          ))}
          <div className="flex gap-2 pt-1">
            <button className="btn-ghost flex-1 text-sm" onClick={() => setProposal(null)}>Discard</button>
            <button disabled={!count || applying} className="btn flex-1 text-sm" onClick={apply}>{applying ? 'Applying…' : `Apply ${count} change${count === 1 ? '' : 's'}`}</button>
          </div>
        </div>
      )}

      <form onSubmit={send} className="flex gap-2 items-end">
        <textarea className="input text-sm" rows={chat.length ? 1 : 4} value={msg} onChange={(e) => setMsg(e.target.value)} disabled={busy}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e) }}
          placeholder={chat.length ? 'Anything to change?' : 'Day 1: Leave Bangalore 5am, reach Dandeli by 1pm, rafting at 3, stay at riverside resort\nDay 2: Syntheri Rocks in the morning, drive to Gokarna, Om Beach sunset…'} />
        <button disabled={!msg.trim() || busy} className="btn shrink-0 px-3">Send</button>
      </form>
    </div>
  )
}
