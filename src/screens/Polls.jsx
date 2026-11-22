import { useState } from 'react'
import { useCol, add, update, remove } from '../data'
import { WhatsAppButton, tripLink } from '../share'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Polls({ tripId, uid, members, byId }) {
  const polls = useCol(tripId, 'polls')
  const [creating, setCreating] = useState(false)
  const open = polls.filter((p) => !p.closed).reverse()
  const closed = polls.filter((p) => p.closed).reverse()

  return (
    <>
      {creating
        ? <NewPoll onCancel={() => setCreating(false)} onCreate={(p) => { add(tripId, 'polls', { ...p, by: uid, votes: {}, closed: false }); setCreating(false) }} />
        : <button className="btn w-full" onClick={() => setCreating(true)}>+ New poll</button>}
      {polls.length === 0 && !creating && <p className="text-sm text-slate-500 text-center">Settle debates fast — "Which beach today?", "Veg or non-veg dinner?"</p>}
      {open.map((p) => <PollCard key={p.id} poll={p} tripId={tripId} uid={uid} members={members} byId={byId} />)}
      {closed.length > 0 && <h2 className="text-sm font-semibold text-slate-500 pt-2">Closed</h2>}
      {closed.map((p) => <PollCard key={p.id} poll={p} tripId={tripId} uid={uid} members={members} byId={byId} />)}
    </>
  )
}

export function PollCard({ poll, tripId, uid, members, byId, compact }) {
  const [deleting, setDeleting] = useState(false)
  const votes = poll.votes || {}
  const myVote = votes[uid]
  const counts = poll.options.map((_, i) => Object.values(votes).filter((v) => v === i).length)
  const voted = Object.keys(votes).length
  const max = Math.max(...counts)
  const vote = (i) => !poll.closed && update(tripId, 'polls', poll.id, { [`votes.${uid}`]: i })
  const notVoted = members.filter((m) => votes[m.id] === undefined)

  return (
    <section className={`card ${poll.closed ? 'opacity-75' : ''}`}>
      <div className="flex justify-between gap-2">
        <h3 className="font-semibold">📊 {poll.question}</h3>
        {!compact && poll.by === uid && (
          <div className="flex gap-3 text-sm shrink-0">
            <button className="text-slate-500 underline" onClick={() => update(tripId, 'polls', poll.id, { closed: !poll.closed })}>{poll.closed ? 'Reopen' : 'Close'}</button>
            <button
              aria-label="Delete poll"
              className="text-slate-400 hover:text-red-500 transition"
              onClick={() => setDeleting(true)}
            >
              ✕
            </button>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">{voted}/{members.length} voted · by {byId[poll.by]?.name || '?'}</p>
      <ul className="mt-3 space-y-2">
        {poll.options.map((o, i) => {
          const pct = voted ? Math.round((counts[i] / voted) * 100) : 0
          const lead = poll.closed && counts[i] === max && max > 0
          return (
            <li key={i}>
              <button disabled={poll.closed} onClick={() => vote(i)} className={`relative w-full text-left rounded-xl border overflow-hidden px-3 py-2.5 ${myVote === i ? 'border-teal-700' : 'border-slate-200'}`}>
                <span className="absolute inset-y-0 left-0 bg-teal-100 transition-all" style={{ width: `${myVote !== undefined || poll.closed ? pct : 0}%` }} />
                <span className="relative flex justify-between gap-2">
                  <span>{lead && '🏆 '}{o}{myVote === i && ' ✓'}</span>
                  {(myVote !== undefined || poll.closed) && <span className="text-sm text-slate-600">{counts[i]}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {!poll.closed && myVote !== undefined && notVoted.length > 0 && <p className="text-xs text-slate-500 mt-2">Waiting on: {notVoted.map((m) => m.name).join(', ')}</p>}
      {!compact && (
        <WhatsAppButton className="w-full mt-3" label={poll.closed ? 'Share result' : 'Ask the group to vote'}
          text={poll.closed
            ? `📊 *${poll.question}*\n🏆 ${poll.options[counts.indexOf(max)]} wins (${max} votes)`
            : `📊 *${poll.question}*\n${poll.options.map((o) => `• ${o}`).join('\n')}\n\nVote here 👉 ${tripLink(tripId)}`} />
      )}

      <ConfirmDialog
        isOpen={deleting}
        title="Delete Poll?"
        message={`Delete "${poll.question}" for everyone in the group?`}
        onConfirm={() => {
          remove(tripId, 'polls', poll.id)
          setDeleting(false)
        }}
        onCancel={() => setDeleting(false)}
      />
    </section>
  )
}

function NewPoll({ onCreate, onCancel }) {
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState(['', ''])
  const clean = opts.map((o) => o.trim()).filter(Boolean)
  const setOpt = (i, v) => { const n = [...opts]; n[i] = v; if (i === n.length - 1 && v && n.length < 8) n.push(''); setOpts(n) }
  return (
    <form className="card space-y-2" onSubmit={(e) => { e.preventDefault(); if (q.trim() && clean.length >= 2) onCreate({ question: q.trim(), options: clean }) }}>
      <input required autoFocus className="input" placeholder="Question — e.g. Which beach tomorrow?" value={q} onChange={(e) => setQ(e.target.value)} />
      {opts.map((o, i) => <input key={i} className="input" placeholder={`Option ${i + 1}`} value={o} onChange={(e) => setOpt(i, e.target.value)} />)}
      <div className="flex gap-2 pt-1">
        <button type="button" className="btn-ghost flex-1" onClick={onCancel}>Cancel</button>
        <button disabled={!q.trim() || clean.length < 2} className="btn flex-1">Create poll</button>
      </div>
    </form>
  )
}
