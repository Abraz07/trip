import { useState, useEffect } from 'react'
import { serverTimestamp } from 'firebase/firestore'
import { useCol, add, update, remove } from '../data'
import { WhatsAppButton } from '../share'
import ConfirmDialog from '../components/ConfirmDialog'
import { compress } from './Photos'

// Firestore documents max out at ~1 MB; base64 adds a third, so keep raw attachments under ~700 KB.
const MAX_ATTACHMENT = 700 * 1024

const DEFAULT_EMERGENCY_NUMS = [
  { name: 'National Emergency', num: '112', icon: '🚨' },
  { name: 'Ambulance / Medical', num: '108', icon: '🚑' },
  { name: 'Police', num: '100', icon: '🚓' },
  { name: 'Tourist Helpline', num: '1363', icon: '🧳' },
  { name: 'Women Helpline', num: '1091', icon: '👩' },
]

const DOC_CATEGORIES = [
  ['flight', '✈️ Flights & Transit'],
  ['hotel', '🏨 Stays & Hotels'],
  ['insurance', '📄 Insurance & Medical'],
  ['id', '🎟️ Tickets & Passes'],
  ['other', '📁 General Docs'],
]

export default function Safety({ tripId, trip, uid, me, byId }) {
  const emergencies = useCol(tripId, 'emergencies')
  const docs = useCol(tripId, 'documents')
  const customContacts = useCol(tripId, 'emergency_contacts')

  const [locating, setLocating] = useState(false)
  const [sosActive, setSosActive] = useState(false)
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)
  const [deletingDoc, setDeletingDoc] = useState(null)
  const [fileErr, setFileErr] = useState('')
  const [savingDoc, setSavingDoc] = useState(false)

  // Document form
  const [docForm, setDocForm] = useState({
    title: '',
    category: 'hotel',
    refNo: '',
    notes: '',
    fileData: null,
    fileName: '',
  })

  // Custom contact form
  const [contactForm, setContactForm] = useState({ name: '', num: '', role: 'Hotel / Guide' })

  // Active SOS alert in the trip
  const activeSos = emergencies.find((e) => e.status === 'active')

  async function triggerSOS() {
    setLocating(true)
    if (!navigator.geolocation) {
      alert('Geolocation not supported on this browser.')
      setLocating(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

        await add(tripId, 'emergencies', {
          by: uid,
          name: me?.name || 'Someone',
          lat,
          lng,
          mapsUrl,
          status: 'active',
          at: serverTimestamp(),
        })

        setLocating(false)
        setSosActive(true)
      },
      (err) => {
        alert('Could not fetch GPS location: ' + err.message)
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15e3 }
    )
  }

  async function handleFileAttach(e) {
    const file = e.target.files?.[0]
    setFileErr('')
    if (!file) return
    try {
      let fileData
      if (file.type.startsWith('image/')) {
        // Photos of tickets/vouchers: shrink to fit in the database (stays readable at 1600px).
        fileData = await compress(file, 1600, 0.8)
      } else {
        if (file.size > MAX_ATTACHMENT) {
          setFileErr(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit for PDFs is 700 KB. Attach a screenshot of the ticket instead.`)
          e.target.value = ''
          return
        }
        fileData = await new Promise((res, rej) => {
          const reader = new FileReader()
          reader.onload = () => res(reader.result)
          reader.onerror = () => rej(reader.error)
          reader.readAsDataURL(file)
        })
      }
      setDocForm((prev) => ({ ...prev, fileData, fileName: file.name }))
    } catch (err) {
      setFileErr(`Couldn't read that file: ${err.message}`)
      e.target.value = ''
    }
  }

  async function handleSaveDoc(e) {
    e.preventDefault()
    if (!docForm.title.trim()) return
    setSavingDoc(true)
    try {
      await add(tripId, 'documents', {
        ...docForm,
        by: uid,
        createdAt: serverTimestamp(),
      })
      setDocForm({ title: '', category: 'hotel', refNo: '', notes: '', fileData: null, fileName: '' })
      setShowAddDoc(false)
    } catch (err) {
      setFileErr(`Couldn't save: ${err.message}`)
    } finally {
      setSavingDoc(false)
    }
  }

  async function handleSaveContact(e) {
    e.preventDefault()
    if (!contactForm.name.trim() || !contactForm.num.trim()) return
    await add(tripId, 'emergency_contacts', {
      ...contactForm,
      by: uid,
    })
    setContactForm({ name: '', num: '', role: 'Hotel / Guide' })
    setShowAddContact(false)
  }

  return (
    <div className="space-y-4">
      {/* Active SOS Distress Alert */}
      {activeSos && (
        <section className="card bg-red-600 text-white border-0 shadow-lg animate-pulse space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xl">🚨 EMERGENCY DISTRESS ALERT</span>
            {activeSos.by === uid && (
              <button
                type="button"
                onClick={() => update(tripId, 'emergencies', activeSos.id, { status: 'resolved' })}
                className="bg-white text-red-700 text-xs font-bold px-2.5 py-1 rounded-lg"
              >
                I'm Safe Now ✓
              </button>
            )}
          </div>
          <p className="font-bold text-sm">
            {activeSos.name} sent an SOS distress alert!
          </p>
          <div className="flex gap-2 pt-1">
            <a
              href={activeSos.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="btn bg-white text-red-700 font-bold flex-1 text-xs py-2 text-center"
            >
              📍 Open Exact Location
            </a>
            <WhatsAppButton
              className="flex-1 text-xs py-2"
              label="Broadcast on WhatsApp"
              text={`🚨 *EMERGENCY SOS from ${activeSos.name}!* Need immediate help!\nLocation: ${activeSos.mapsUrl}`}
            />
          </div>
        </section>
      )}

      {/* Emergency SOS Trigger Card */}
      <section className="card border-red-200 bg-red-50/40 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🚨</span>
          <div>
            <h2 className="font-bold text-sm text-red-900">Emergency SOS Broadcast</h2>
            <p className="text-xs text-red-700">Shows your GPS location on the screen of everyone who has Yatra open. Then send it on WhatsApp so nobody misses it — and call 112 if it's serious.</p>
          </div>
        </div>
        <button
          disabled={locating}
          onClick={triggerSOS}
          className="w-full py-3 bg-red-600 hover:bg-red-700 active:scale-98 text-white rounded-xl font-bold text-sm shadow-md flex items-center justify-center gap-2 transition"
        >
          <span>🆘</span> {locating ? 'Capturing High-Accuracy GPS…' : 'Alert the Gang (Emergency SOS)'}
        </button>
      </section>

      {/* Emergency Helpline Numbers Directory */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-sm text-slate-800">Emergency Call Directory</h2>
          <button
            type="button"
            onClick={() => setShowAddContact(!showAddContact)}
            className="text-xs text-teal-700 font-semibold hover:underline"
          >
            {showAddContact ? 'Cancel' : '+ Add Contact'}
          </button>
        </div>

        {showAddContact && (
          <form onSubmit={handleSaveContact} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <p className="text-xs font-semibold text-slate-700">Add local driver, hotel, or guide contact:</p>
            <input
              required
              className="input text-xs py-1.5"
              placeholder="Contact Name (e.g. Hotel Frontdesk, Driver Suresh)"
              value={contactForm.name}
              onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
            />
            <input
              required
              type="tel"
              className="input text-xs py-1.5"
              placeholder="Phone Number (e.g. +91 98765 43210)"
              value={contactForm.num}
              onChange={(e) => setContactForm({ ...contactForm, num: e.target.value })}
            />
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1 py-1 text-xs" onClick={() => setShowAddContact(false)}>Cancel</button>
              <button type="submit" className="btn flex-1 py-1 text-xs">Save Contact</button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-2 gap-2">
          {DEFAULT_EMERGENCY_NUMS.map((item) => (
            <a
              key={item.num}
              href={`tel:${item.num}`}
              className="p-2.5 rounded-xl border border-slate-200 hover:border-teal-600 bg-white shadow-2xs flex items-center gap-2 transition"
            >
              <span className="text-lg">{item.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-xs text-slate-900 truncate">{item.name}</p>
                <p className="text-xs text-teal-700 font-mono font-semibold">{item.num}</p>
              </div>
            </a>
          ))}

          {customContacts.map((c) => (
            <div
              key={c.id}
              className="p-2.5 rounded-xl border border-slate-200 bg-teal-50/40 flex items-center justify-between gap-1"
            >
              <a href={`tel:${c.num}`} className="flex-1 min-w-0">
                <p className="font-bold text-xs text-slate-900 truncate">{c.name}</p>
                <p className="text-xs text-teal-700 font-mono font-semibold">{c.num}</p>
              </a>
              <button
                type="button"
                className="text-slate-300 hover:text-red-500 text-xs px-1"
                onClick={() => remove(tripId, 'emergency_contacts', c.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Travel Document Vault (Offline Ready) */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-sm text-slate-800">Travel Document Vault</h2>
            <p className="text-[11px] text-slate-500">Available offline without cellular reception</p>
            <p className="text-[11px] text-amber-700 font-medium">Everyone in this trip can see these. Don't upload passports, Aadhaar or other IDs.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddDoc(!showAddDoc)}
            className="btn py-1 px-3 text-xs font-semibold shrink-0"
          >
            {showAddDoc ? 'Cancel' : '+ Add Document'}
          </button>
        </div>

        {/* Add Document Form */}
        {showAddDoc && (
          <form onSubmit={handleSaveDoc} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
            <h3 className="font-bold text-xs text-slate-800">Save Travel Document</h3>
            <input
              required
              className="input text-xs py-1.5"
              placeholder="Document Title (e.g. Indigo Flight 6E-204, Taj Fort Aguada)"
              value={docForm.title}
              onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                className="input text-xs py-1.5"
                value={docForm.category}
                onChange={(e) => setDocForm({ ...docForm, category: e.target.value })}
              >
                {DOC_CATEGORIES.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              <input
                className="input text-xs py-1.5"
                placeholder="PNR / Booking ID"
                value={docForm.refNo}
                onChange={(e) => setDocForm({ ...docForm, refNo: e.target.value })}
              />
            </div>
            <textarea
              rows="2"
              className="input text-xs py-1.5"
              placeholder="Important notes: seat numbers, terminal, check-in code…"
              value={docForm.notes}
              onChange={(e) => setDocForm({ ...docForm, notes: e.target.value })}
            />
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 block">Attach Image / PDF:</label>
              <input
                type="file"
                accept="image/*,application/pdf"
                className="text-xs file:btn-ghost file:py-1 file:px-2 file:text-xs"
                onChange={handleFileAttach}
              />
              {docForm.fileName && <p className="text-[10px] text-teal-700 font-medium">✓ {docForm.fileName}</p>}
              {fileErr && <p className="text-[11px] text-red-600 font-medium">{fileErr}</p>}
              <p className="text-[10px] text-slate-400">Photos are shrunk automatically. PDFs up to 700 KB.</p>
            </div>
            <button disabled={savingDoc} className="btn w-full py-2 text-xs font-semibold">{savingDoc ? 'Saving…' : 'Save to Vault'}</button>
          </form>
        )}

        {/* Saved Documents List */}
        {docs.length === 0 && !showAddDoc && (
          <div className="text-center py-6 text-xs text-slate-400">
            No documents saved yet. Add your tickets, hotel vouchers, and insurance for 1-tap offline access.
          </div>
        )}

        <div className="space-y-2">
          {docs.map((d) => (
            <div
              key={d.id}
              className="p-3 rounded-xl border border-slate-200 bg-white hover:border-teal-600 shadow-2xs space-y-1.5 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">
                    {DOC_CATEGORIES.find(([k]) => k === d.category)?.[1] || 'Document'}
                  </span>
                  <h3 className="font-bold text-sm text-slate-900 mt-1">{d.title}</h3>
                </div>
                {d.by === uid && (
                  <button
                    type="button"
                    aria-label={`Delete ${d.title}`}
                    className="text-slate-300 hover:text-red-500 text-xs px-1"
                    onClick={() => setDeletingDoc(d)}
                  >
                    ✕
                  </button>
                )}
              </div>

              {d.refNo && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">Ref / PNR:</span>
                  <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                    {d.refNo}
                  </span>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(d.refNo); alert('PNR copied!') }}
                    className="text-[11px] text-teal-700 underline font-medium"
                  >
                    Copy
                  </button>
                </div>
              )}

              {d.notes && <p className="text-xs text-slate-600 whitespace-pre-wrap">{d.notes}</p>}

              {d.fileData && (
                <div className="pt-1">
                  <a
                    href={d.fileData}
                    download={d.fileName || `doc-${d.title}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-lg hover:bg-teal-100 transition"
                  >
                    <span>📄</span> View / Download Attachment
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <ConfirmDialog
        isOpen={!!deletingDoc}
        title="Delete Document?"
        message={`Delete "${deletingDoc?.title}" from the trip vault?`}
        onConfirm={() => {
          remove(tripId, 'documents', deletingDoc.id)
          setDeletingDoc(null)
        }}
        onCancel={() => setDeletingDoc(null)}
      />
    </div>
  )
}
