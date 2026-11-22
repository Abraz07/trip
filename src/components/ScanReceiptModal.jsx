import { useState, useRef } from 'react'
import { getGeminiApiKey, saveGeminiApiKey, scanReceiptWithGemini } from '../gemini'
import { inr, equalSplit } from '../settle'

export default function ScanReceiptModal({ uid, members, onAdd, onClose }) {
  const [apiKey, setApiKey] = useState(getGeminiApiKey)
  const [showKeyPrompt, setShowKeyPrompt] = useState(!apiKey)
  const [tempKey, setTempKey] = useState('')

  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState(null)

  // Scanned Receipt Data
  const [parsed, setParsed] = useState(null)
  const [merchant, setMerchant] = useState('')
  const [total, setTotal] = useState(0)
  const [paidBy, setPaidBy] = useState(uid)
  const [splitMode, setSplitMode] = useState('equal') // 'equal' | 'itemized'

  // Equal split selection
  const [equalAmong, setEqualAmong] = useState(() => new Set(members.map((m) => m.id)))

  // Itemized split mappings: { [itemId]: Set of memberIds }
  const [itemShares, setItemShares] = useState({})
  // Item list (editable)
  const [items, setItems] = useState([])

  const fileInputRef = useRef()
  const cameraInputRef = useRef()

  function handleKeySubmit(e) {
    e.preventDefault()
    if (!tempKey.trim()) return
    saveGeminiApiKey(tempKey.trim())
    setApiKey(tempKey.trim())
    setShowKeyPrompt(false)
    setError(null)
  }

  async function processFile(selectedFile) {
    if (!selectedFile) return
    setFile(selectedFile)
    setScanning(true)
    setError(null)
    setParsed(null)

    // Local preview while processing
    const objectUrl = URL.createObjectURL(selectedFile)
    setPreview(objectUrl)

    try {
      const result = await scanReceiptWithGemini(selectedFile, apiKey)
      setParsed(result)
      setMerchant(result.merchant || 'Scanned Expense')
      setTotal(result.total || 0)
      setItems(result.items || [])

      // Default item shares: all members on each item
      const initialItemShares = {}
      for (const it of result.items) {
        initialItemShares[it.id] = new Set(members.map((m) => m.id))
      }
      setItemShares(initialItemShares)

      if (result.items && result.items.length > 1) {
        setSplitMode('itemized')
      } else {
        setSplitMode('equal')
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Could not scan receipt. Please check your image or API key.')
    } finally {
      setScanning(false)
    }
  }

  // Calculate itemized splits
  function calculateItemizedSplits() {
    const rawTotal = Number(total) || 0
    if (rawTotal <= 0 || items.length === 0) {
      return equalSplit(rawTotal, [...equalAmong])
    }

    const memberSubtotals = Object.fromEntries(members.map((m) => [m.id, 0]))
    let totalAssignedSubtotal = 0

    for (const item of items) {
      const consumers = itemShares[item.id] ? [...itemShares[item.id]] : []
      if (consumers.length > 0) {
        const sharePrice = item.price / consumers.length
        for (const cid of consumers) {
          memberSubtotals[cid] = (memberSubtotals[cid] || 0) + sharePrice
          totalAssignedSubtotal += sharePrice
        }
      }
    }

    // Proportional distribution of taxes, service fees, or adjustments
    const finalSplits = Object.fromEntries(members.map((m) => [m.id, 0]))
    if (totalAssignedSubtotal > 0) {
      const multiplier = rawTotal / totalAssignedSubtotal
      for (const [mId, sub] of Object.entries(memberSubtotals)) {
        finalSplits[mId] = Math.round(sub * multiplier * 100) / 100
      }
    } else {
      // Fallback to equal split if no items have assigned consumers
      return equalSplit(rawTotal, [...equalAmong])
    }

    // Reconcile rounding difference to payer or largest consumer
    const sumSplits = Object.values(finalSplits).reduce((s, v) => s + v, 0)
    const diff = Math.round((rawTotal - sumSplits) * 100) / 100
    if (diff !== 0 && members.length > 0) {
      finalSplits[members[0].id] = Math.round((finalSplits[members[0].id] + diff) * 100) / 100
    }

    return finalSplits
  }

  function toggleItemConsumer(itemId, memberId) {
    setItemShares((prev) => {
      const current = new Set(prev[itemId] || [])
      if (current.has(memberId)) {
        current.delete(memberId)
      } else {
        current.add(memberId)
      }
      return { ...prev, [itemId]: current }
    })
  }

  function toggleEqualMember(memberId) {
    setEqualAmong((prev) => {
      const next = new Set(prev)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  function handleSave() {
    const finalAmount = Number(total)
    if (!merchant.trim() || finalAmount <= 0) {
      alert('Please provide a valid merchant title and total amount.')
      return
    }

    let computedSplits
    if (splitMode === 'itemized' && items.length > 0) {
      computedSplits = calculateItemizedSplits()
    } else {
      const uids = [...equalAmong]
      if (uids.length === 0) {
        alert('Please select at least one member to split with.')
        return
      }
      computedSplits = equalSplit(finalAmount, uids)
    }

    onAdd({
      title: merchant.trim(),
      amount: finalAmount,
      paidBy,
      splits: computedSplits,
      items: items.map((it) => ({
        name: it.name,
        price: it.price,
        sharedBy: itemShares[it.id] ? [...itemShares[it.id]] : members.map((m) => m.id),
      })),
      scanned: true,
      by: uid,
    })
    onClose()
  }

  const computedSplits = splitMode === 'itemized' ? calculateItemizedSplits() : {}

  return (
    <div className="fixed inset-0 z-50 bg-black/70 overflow-y-auto p-4 flex justify-center items-start sm:items-center">
      <div className="bg-white rounded-2xl w-full max-w-lg p-5 my-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🤖</span>
            <div>
              <h2 className="font-bold text-lg leading-tight">AI Receipt Scanner</h2>
              <p className="text-xs text-slate-500">Powered by Google Gemini Vision</p>
            </div>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 size-8 grid place-items-center rounded-full hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        {/* API Key Modal / Banner */}
        {showKeyPrompt && (
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 space-y-3">
            <div>
              <p className="font-semibold text-teal-900 text-sm">🔑 Enter Gemini API Key</p>
              <p className="text-xs text-teal-700 mt-1">
                To scan bills with AI, provide a free Gemini API key from Google AI Studio. It stays saved in your browser.
              </p>
            </div>
            <form onSubmit={handleKeySubmit} className="space-y-2">
              <input
                required
                type="password"
                className="input text-sm"
                placeholder="AIzaSy..."
                value={tempKey}
                onChange={(e) => setTempKey(e.target.value)}
              />
              <div className="flex items-center justify-between gap-2 pt-1">
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-teal-700 underline font-medium"
                >
                  Get free key ↗
                </a>
                <button type="submit" className="btn py-1.5 px-3 text-xs">
                  Save Key
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* File Picker State */}
          {!parsed && !scanning && (
            <div className="space-y-4 text-center py-4">
              <div className="border-2 border-dashed border-slate-300 rounded-2xl p-6 hover:border-teal-600 transition bg-slate-50/50">
                <div className="text-4xl mb-2">🧾</div>
                <p className="font-semibold text-slate-700">Drop or take a photo of your receipt</p>
                <p className="text-xs text-slate-500 mt-1">
                  Works for restaurant bills, cabs, grocery receipts, and bar tabs.
                </p>

                <div className="flex flex-col sm:flex-row gap-2 justify-center mt-5">
                  {/* Camera button for mobile */}
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="btn flex items-center justify-center gap-1.5 py-2.5 text-sm"
                  >
                    <span>📷</span> Take Photo
                  </button>
                  {/* Gallery / File picker */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-ghost flex items-center justify-center gap-1.5 py-2.5 text-sm"
                  >
                    <span>🖼️</span> Choose from Gallery
                  </button>
                </div>

                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => processFile(e.target.files?.[0])}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => processFile(e.target.files?.[0])}
                />
              </div>

              {!showKeyPrompt && (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xs text-slate-400">Gemini Key configured</span>
                  <button
                    type="button"
                    onClick={() => setShowKeyPrompt(true)}
                    className="text-xs text-teal-700 underline font-medium"
                  >
                    Change key
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Scanning In Progress State */}
          {scanning && (
            <div className="text-center py-8 space-y-4">
              <div className="relative mx-auto w-44 h-56 rounded-xl overflow-hidden border-2 border-teal-600 shadow-md bg-slate-100">
                {preview && <img src={preview} alt="Scanning" className="w-full h-full object-cover opacity-80" />}
                {/* Laser animation */}
                <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-teal-400 via-teal-300 to-teal-500 shadow-[0_0_12px_#0d9488] animate-[bounce_2s_infinite]" />
              </div>
              <div>
                <p className="font-semibold text-teal-800 text-base">Reading receipt with Gemini Vision...</p>
                <p className="text-xs text-slate-500 mt-1">Extracting merchant, items, taxes & total amount</p>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs space-y-1">
              <p className="font-semibold">⚠️ Scan Error</p>
              <p>{error}</p>
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setFile(null)
                }}
                className="underline mt-1 block font-medium"
              >
                Try another photo
              </button>
            </div>
          )}

          {/* Scanned Result & Split Builder */}
          {parsed && (
            <div className="space-y-4">
              {/* Receipt Summary Card */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-slate-500 font-medium">Merchant / Place</label>
                    <input
                      required
                      className="input py-1.5 text-sm font-semibold"
                      value={merchant}
                      onChange={(e) => setMerchant(e.target.value)}
                    />
                  </div>
                  <div className="w-32">
                    <label className="text-xs text-slate-500 font-medium">Total (₹)</label>
                    <input
                      required
                      type="number"
                      step="any"
                      className="input py-1.5 text-sm font-bold text-teal-800"
                      value={total}
                      onChange={(e) => setTotal(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 text-xs pt-1">
                  <div className="flex-1">
                    <label className="text-slate-500 font-medium block">Paid by</label>
                    <select
                      className="input py-1.5 text-xs font-medium mt-0.5"
                      value={paidBy}
                      onChange={(e) => setPaidBy(e.target.value)}
                    >
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id === uid ? `${m.name} (you)` : m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-slate-500 font-medium block">Split Mode</label>
                    <div className="grid grid-cols-2 bg-slate-200 rounded-lg p-0.5 mt-0.5">
                      <button
                        type="button"
                        onClick={() => setSplitMode('equal')}
                        className={`py-1 rounded text-xs font-semibold ${
                          splitMode === 'equal' ? 'bg-white shadow-xs text-teal-800' : 'text-slate-600'
                        }`}
                      >
                        Equal
                      </button>
                      <button
                        type="button"
                        onClick={() => setSplitMode('itemized')}
                        className={`py-1 rounded text-xs font-semibold ${
                          splitMode === 'itemized' ? 'bg-white shadow-xs text-teal-800' : 'text-slate-600'
                        }`}
                      >
                        Itemized
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Mode 1: Equal Split */}
              {splitMode === 'equal' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span>Split equally between ({equalAmong.size} selected)</span>
                    {equalAmong.size > 0 && total > 0 && (
                      <span className="text-teal-700 font-bold">{inr(total / equalAmong.size)} each</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((m) => (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => toggleEqualMember(m.id)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                          equalAmong.has(m.id)
                            ? 'bg-teal-700 text-white border-teal-700'
                            : 'bg-white text-slate-600 border-slate-300'
                        }`}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Mode 2: Itemized Split */}
              {splitMode === 'itemized' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-700">
                      Who had what? (Taxes/fees split proportionally)
                    </p>
                    <button
                      type="button"
                      className="text-xs text-teal-700 underline font-medium"
                      onClick={() => {
                        const all = {}
                        for (const it of items) all[it.id] = new Set(members.map((m) => m.id))
                        setItemShares(all)
                      }}
                    >
                      Select all for all
                    </button>
                  </div>

                  <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto border border-slate-200 rounded-xl bg-white p-2 space-y-2">
                    {items.map((it, idx) => {
                      const shared = itemShares[it.id] || new Set()
                      return (
                        <div key={it.id || idx} className="pt-2 first:pt-0 space-y-1">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-semibold text-slate-800">
                              {it.name} {it.qty > 1 && `(x${it.qty})`}
                            </span>
                            <span className="font-bold text-slate-900">{inr(it.price)}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {members.map((m) => {
                              const active = shared.has(m.id)
                              return (
                                <button
                                  type="button"
                                  key={m.id}
                                  onClick={() => toggleItemConsumer(it.id, m.id)}
                                  className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
                                    active
                                      ? 'bg-teal-100 text-teal-800 border-teal-300 font-semibold'
                                      : 'bg-slate-50 text-slate-400 border-slate-200'
                                  }`}
                                >
                                  {m.name}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Calculated Per-Person Breakdown */}
                  <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-amber-900">Per-Person Split Summary</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {members.map((m) => (
                        <div key={m.id} className="flex justify-between text-xs">
                          <span className="text-slate-600 truncate">{m.name}:</span>
                          <span className="font-bold text-slate-900">{inr(computedSplits[m.id] || 0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="pt-2 border-t border-slate-100 flex gap-2 shrink-0">
          <button type="button" onClick={onClose} className="btn-ghost flex-1 py-2 text-sm">
            Cancel
          </button>
          {parsed && (
            <button type="button" onClick={handleSave} className="btn flex-1 py-2 text-sm">
              Save Expense
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
