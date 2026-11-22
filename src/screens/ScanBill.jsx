import { useRef, useState } from 'react'
import { compress } from './Photos'
import { readBill, itemSplits } from '../scan'
import { inr } from '../settle'
import { getGeminiApiKey, saveGeminiApiKey } from '../gemini'

export default function ScanBill({ uid, members, onSave, onCancel }) {
  const input = useRef()
  const [stage, setStage] = useState('pick') // pick | reading | edit | error
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState(null)
  const [bill, setBill] = useState(null)
  const [assign, setAssign] = useState([])
  const [paidBy, setPaidBy] = useState(uid)
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [customKey, setCustomKey] = useState(getGeminiApiKey)
  const everyone = members.map((m) => m.id)

  async function pick(file, keyOverride) {
    if (!file && !preview) return
    setStage('reading')
    setErr('')
    try {
      let img = preview
      if (file) {
        img = await compress(file, 1600, 0.85)
        setPreview(img)
      }
      const b = await readBill(img, keyOverride || customKey)
      if (!b.items.length) throw new Error("Couldn't find any items — try a sharper, straight-on photo.")
      setBill(b)
      setAssign(b.items.map(() => [...everyone]))
      setStage('edit')
    } catch (e) {
      const msg = friendly(e)
      setErr(msg)
      setStage('error')
      if (/AI Logic|Vertex|403|not enabled|SERVICE_DISABLED/i.test(String(e?.message || e))) {
        setShowKeyInput(true)
      }
    }
  }

  function handleSaveKey(e) {
    e.preventDefault()
    if (!customKey.trim()) return
    saveGeminiApiKey(customKey.trim())
    setShowKeyInput(false)
    if (preview) {
      pick(null, customKey.trim())
    }
  }

  const setItem = (i, patch) => setBill({ ...bill, items: bill.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) })
  const toggle = (i, u) => setAssign(assign.map((a, j) => (j !== i ? a : a.includes(u) ? a.filter((x) => x !== u) : [...a, u])))
  const allOnly = (i, u) => setAssign(assign.map((a, j) => (j !== i ? a : u ? [u] : [...everyone])))

  const itemSum = bill ? bill.items.reduce((s, i) => s + Number(i.price || 0), 0) : 0
  const total = bill ? Math.round((itemSum + Number(bill.extras || 0)) * 100) / 100 : 0
  const unassigned = bill ? bill.items.filter((_, i) => !assign[i]?.length).length : 0
  const splits = bill && !unassigned ? itemSplits(bill.items.map((i) => ({ ...i, price: Number(i.price || 0) })), assign, total) : {}
  const name = (u) => (u === uid ? 'You' : members.find((m) => m.id === u)?.name || '?')

  function save() {
    onSave({
      title: bill.merchant?.trim() || 'Bill',
      amount: total,
      paidBy,
      splits,
      items: bill.items.map((it, i) => ({ name: it.name, price: Number(it.price || 0), who: assign[i] })),
      extras: Number(bill.extras || 0),
      scanned: true,
      by: uid,
    })
  }

  if (stage === 'pick' || stage === 'reading' || stage === 'error') {
    return (
      <section className="card space-y-3 text-center">
        <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files[0])} />
        {preview && <img src={preview} alt="Bill" className="max-h-48 mx-auto rounded-lg shadow-xs" />}
        {stage === 'reading' && (
          <div className="py-4 space-y-2">
            <p className="text-sm font-semibold text-teal-800 animate-pulse">Reading the bill with Gemini AI… 🔍</p>
            <p className="text-xs text-slate-500">Extracting merchant, items, taxes & total</p>
          </div>
        )}
        {stage === 'error' && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-left space-y-2">
            <p className="text-xs font-semibold text-red-800">⚠️ Bill Scanning Notice</p>
            <p className="text-xs text-red-700">{err}</p>
            {showKeyInput && (
              <form onSubmit={handleSaveKey} className="pt-2 border-t border-red-200 space-y-2">
                <p className="text-xs text-slate-700 font-medium">Use a free Gemini API key from Google AI Studio:</p>
                <input
                  type="password"
                  required
                  placeholder="Paste AIzaSy... key"
                  className="input text-xs py-1.5"
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                />
                <div className="flex justify-between items-center text-xs">
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-teal-700 underline">Get free key ↗</a>
                  <button type="submit" className="btn py-1 px-3 text-xs">Save & Retry</button>
                </div>
              </form>
            )}
          </div>
        )}
        {stage !== 'reading' && (
          <>
            <p className="text-sm text-slate-600">Snap the whole bill, flat and in good light.</p>
            <p className="text-[11px] text-slate-400">Protected by reCAPTCHA — Google <a className="underline" href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy</a> &amp; <a className="underline" href="https://policies.google.com/terms" target="_blank" rel="noreferrer">Terms</a> apply.</p>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={onCancel}>Cancel</button>
              <button className="btn flex-1" onClick={() => input.current.click()}>{stage === 'error' ? 'Try again' : '📷 Take photo'}</button>
            </div>
            {!showKeyInput && stage !== 'error' && (
              <button
                type="button"
                onClick={() => setShowKeyInput(true)}
                className="text-xs text-slate-400 hover:text-slate-600 underline"
              >
                Configure Gemini API key
              </button>
            )}
            {showKeyInput && stage !== 'error' && (
              <div className="pt-2 text-left bg-slate-50 p-3 rounded-xl border border-slate-200">
                <form onSubmit={handleSaveKey} className="space-y-2">
                  <p className="text-xs font-medium text-slate-700">Gemini Vision API Key:</p>
                  <input
                    type="password"
                    placeholder="AIzaSy..."
                    className="input text-xs py-1.5"
                    value={customKey}
                    onChange={(e) => setCustomKey(e.target.value)}
                  />
                  <div className="flex justify-between items-center text-xs">
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-teal-700 underline">Get key ↗</a>
                    <button type="submit" className="btn py-1 px-3 text-xs">Save</button>
                  </div>
                </form>
              </div>
            )}
          </>
        )}
      </section>
    )
  }

  return (
    <section className="card space-y-3">
      <input className="input font-semibold" value={bill.merchant} placeholder="Where? (Restaurant)" onChange={(e) => setBill({ ...bill, merchant: e.target.value })} />
      <p className="text-xs text-slate-500">Tap names to choose who had each item. Check prices against the bill.</p>

      <ul className="space-y-3">
        {bill.items.map((it, i) => (
          <li key={i} className="border-b border-slate-100 pb-3">
            <div className="flex gap-2">
              <input className="input py-1.5 text-sm" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} />
              <input className="input py-1.5 text-sm w-24 text-right" inputMode="decimal" value={it.price} onChange={(e) => setItem(i, { price: e.target.value.replace(/[^\d.]/g, '') })} />
              <button aria-label={`Remove ${it.name}`} className="text-slate-400 px-1" onClick={() => { setBill({ ...bill, items: bill.items.filter((_, j) => j !== i) }); setAssign(assign.filter((_, j) => j !== i)) }}>✕</button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <button className={`rounded-full px-2.5 py-1 text-xs border ${assign[i]?.length === everyone.length ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-300'}`} onClick={() => allOnly(i)}>All</button>
              {members.map((m) => (
                <button key={m.id} onClick={() => toggle(i, m.id)} className={`rounded-full px-2.5 py-1 text-xs border ${assign[i]?.includes(m.id) ? 'bg-teal-700 text-white border-teal-700' : 'border-slate-300'}`}>{m.id === uid ? 'Me' : m.name}</button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <button className="text-sm text-teal-700 font-semibold" onClick={() => { setBill({ ...bill, items: [...bill.items, { name: '', price: '' }] }); setAssign([...assign, [...everyone]]) }}>+ Add item</button>

      <div className="text-sm space-y-1 bg-slate-50 rounded-xl p-3">
        <div className="flex justify-between"><span>Items</span><span>{inr(itemSum)}</span></div>
        <label className="flex justify-between items-center"><span>Tax / service / round-off</span>
          <input className="w-24 text-right bg-transparent border-b border-slate-300" inputMode="decimal" value={bill.extras} onChange={(e) => setBill({ ...bill, extras: e.target.value.replace(/[^\d.-]/g, '') })} /></label>
        <div className="flex justify-between font-bold text-base pt-1"><span>Total</span><span>{inr(total)}</span></div>
      </div>

      <label className="block text-sm font-medium">Paid by
        <select className="input mt-1" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {members.map((m) => <option key={m.id} value={m.id}>{m.id === uid ? `${m.name} (you)` : m.name}</option>)}
        </select>
      </label>

      {unassigned > 0
        ? <p className="text-sm text-amber-700">{unassigned} item{unassigned > 1 ? 's' : ''} with nobody picked.</p>
        : (
          <div className="text-sm">
            <p className="font-medium mb-1">Each person's share</p>
            {Object.entries(splits).map(([u, v]) => <div key={u} className="flex justify-between"><span>{name(u)}</span><span>{inr(v)}</span></div>)}
          </div>
        )}

      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={onCancel}>Cancel</button>
        <button disabled={!!unassigned || total <= 0} className="btn flex-1" onClick={save}>Save {inr(total)}</button>
      </div>
    </section>
  )
}

function friendly(e) {
  const m = String(e?.message || e)
  if (/api-not-enabled|AI Logic|firebasevertexai|generativelanguage|SERVICE_DISABLED|403/i.test(m)) {
    return 'Direct Firebase AI Logic is not enabled on this Firebase project. Enter a free Gemini API key below to scan instantly with Gemini Vision.'
  }
  if (/quota|429|RESOURCE_EXHAUSTED/i.test(m)) return 'Too many scans right now — wait a minute and try again.'
  if (/network|fetch|offline/i.test(m)) return 'No internet — bill scan needs a connection. Add it manually for now.'
  return m
}
