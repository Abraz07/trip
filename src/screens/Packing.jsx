import { useState, useMemo } from 'react'
import { useCol, add, update, remove } from '../data'
import ConfirmDialog from '../components/ConfirmDialog'

const PACK_TEMPLATES = [
  {
    id: 'beach',
    name: 'Beach & Sun 🏖️',
    items: ['Sunscreen SPF 50+ 🧴', 'Swimwear / Trunks 🩱', 'Flip flops / Slides 🩴', 'Sunglasses 🕶️', 'Beach towel 🏖️', 'Waterproof phone pouch 📱', 'Aloe vera / After-sun 🌿'],
  },
  {
    id: 'trek',
    name: 'Trek & Mountains 🏔️',
    items: ['Thermals / Base layer ❄️', 'Trekking shoes 🥾', 'Rain poncho / Jacket 🌧️', 'Woolen socks 🧦', 'Beanie / Warm cap 🧢', 'Power bank (20k mAh) 🔋', 'Blister tape / Bandages 🩹'],
  },
  {
    id: 'city',
    name: 'City & Sightseeing 🏙️',
    items: ['Walking sneakers 👟', 'Daypack / Crossbody 🎒', 'Universal adapter 🔌', 'Portable umbrella ☂️', 'Lip balm & moisturizer 🧴', 'Hand sanitizer 🧼'],
  },
  {
    id: 'roadtrip',
    name: 'Road Trip 🚗',
    items: ['Bluetooth speaker 🔊', 'Car phone mount 📱', 'Travel neck pillow 😴', 'Motion sickness tablets 💊', 'Snacks & energy bars 🍫', 'Car charger cable 🔌'],
  },
]

const CATEGORIES = [
  ['all', 'All'],
  ['clothes', '👕 Clothes'],
  ['electronics', '🔌 Tech'],
  ['toiletries', '🧴 Toiletries'],
  ['medical', '🩹 Medical'],
  ['docs', '📄 Docs'],
  ['gear', '🎒 Gear'],
]

function autoDetectCategory(text) {
  const t = text.toLowerCase()
  if (/shirt|pant|dress|swim|underwear|sock|towel|hoodie|jacket|thermal|shoe|flip|sandal|hat|beanie/i.test(t)) return 'clothes'
  if (/charger|cable|power|speaker|camera|adapter|battery|phone|laptop|headphone|earbud/i.test(t)) return 'electronics'
  if (/sunscreen|shampoo|soap|brush|paste|lotion|cream|deodorant|perfume|razor|comb|lip/i.test(t)) return 'toiletries'
  if (/medicine|pill|band|aid|med|paracetamol|tablet|spray|cough|pain|first/i.test(t)) return 'medical'
  if (/passport|ticket|id|visa|license|booking|cash|card|insurance/i.test(t)) return 'docs'
  return 'gear'
}

export default function Packing({ tripId, uid, byId }) {
  const items = useCol(tripId, 'packing')
  const [view, setView] = useState('group') // 'group' | 'mine'
  const [text, setText] = useState('')
  const [selectedCat, setSelectedCat] = useState('all')
  const [showTemplates, setShowTemplates] = useState(false)
  const [deletingItem, setDeletingItem] = useState(null)

  const group = items.filter((i) => !i.owner)
  const mine = items.filter((i) => i.owner === uid)
  const currentList = view === 'group' ? group : mine

  const filteredList = useMemo(() => {
    if (selectedCat === 'all') return currentList
    return currentList.filter((i) => (i.category || autoDetectCategory(i.text)) === selectedCat)
  }, [currentList, selectedCat])

  const totalCount = currentList.length
  const doneCount = currentList.filter((i) => i.done).length
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  const addItem = (t, cat) => {
    const detected = cat || autoDetectCategory(t)
    add(tripId, 'packing', {
      text: t,
      category: detected,
      owner: view === 'mine' ? uid : null,
      bringer: null,
      done: false,
    })
  }

  const applyTemplate = (tpl) => {
    tpl.items.forEach((itemText) => {
      // Prevent duplicates
      const exists = currentList.some((it) => it.text.toLowerCase() === itemText.toLowerCase())
      if (!exists) {
        addItem(itemText)
      }
    })
    setShowTemplates(false)
  }

  return (
    <div className="space-y-4">
      {/* Group vs Personal Selector */}
      <div className="grid grid-cols-2 bg-slate-200 rounded-xl p-1 text-xs font-semibold">
        <button
          onClick={() => { setView('group'); setSelectedCat('all') }}
          className={`py-2 rounded-lg transition ${view === 'group' ? 'bg-white shadow-xs text-teal-800' : 'text-slate-600'}`}
        >
          Shared Group Gear
        </button>
        <button
          onClick={() => { setView('mine'); setSelectedCat('all') }}
          className={`py-2 rounded-lg transition ${view === 'mine' ? 'bg-white shadow-xs text-teal-800' : 'text-slate-600'}`}
        >
          My Personal Checklist
        </button>
      </div>

      {/* Progress Bar Card */}
      {totalCount > 0 && (
        <section className="card p-3 space-y-1.5 bg-gradient-to-r from-teal-50 to-slate-50 border-teal-200/80">
          <div className="flex justify-between items-center text-xs font-semibold">
            <span className="text-teal-900">
              {doneCount} of {totalCount} packed
            </span>
            <span className="text-teal-700">{progressPct}%</span>
          </div>
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-600 transition-all duration-300 rounded-full"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </section>
      )}

      {/* Add Item Bar */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) {
            addItem(text.trim())
            setText('')
          }
        }}
      >
        <input
          className="input text-xs"
          placeholder={view === 'group' ? 'Add shared gear (e.g. Speaker, Cards…)' : 'Add personal item (e.g. Passport, Thermals…)'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn shrink-0 py-2 px-4 text-xs font-semibold">Add</button>
      </form>

      {/* 1-Tap Packing Starter Packs Button */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowTemplates(!showTemplates)}
          className="text-xs text-teal-700 font-semibold hover:underline flex items-center gap-1"
        >
          <span>✨</span> {showTemplates ? 'Hide Starter Packs' : 'Browse Trip Starter Packs'}
        </button>
        <span className="text-[11px] text-slate-400">
          {view === 'group' ? 'Avoid duplicate gear' : 'Private to you'}
        </span>
      </div>

      {/* Starter Pack Templates Accordion */}
      {showTemplates && (
        <div className="card p-3 space-y-3 bg-slate-50 border-teal-200">
          <p className="text-xs font-semibold text-slate-800">Choose a template to add essentials in 1 tap:</p>
          <div className="grid grid-cols-2 gap-2">
            {PACK_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => applyTemplate(tpl)}
                className="p-2.5 rounded-xl border border-slate-200 bg-white hover:border-teal-600 text-left transition shadow-2xs space-y-1"
              >
                <p className="font-bold text-xs text-slate-900">{tpl.name}</p>
                <p className="text-[10px] text-slate-500 leading-tight">+{tpl.items.length} essentials</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Category Pills Filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {CATEGORIES.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSelectedCat(id)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${
              selectedCat === id
                ? 'bg-teal-700 text-white font-semibold shadow-2xs'
                : 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Items List */}
      <ul className="card p-0 divide-y divide-slate-100 overflow-hidden">
        {filteredList.length === 0 && (
          <li className="p-6 text-xs text-slate-400 text-center">
            Nothing in this list yet. Type above or pick a starter pack!
          </li>
        )}
        {filteredList.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/50 transition">
            <input
              type="checkbox"
              className="size-5 accent-teal-700 rounded cursor-pointer"
              checked={!!i.done}
              onChange={(e) => update(tripId, 'packing', i.id, { done: e.target.checked })}
            />
            <span className={`flex-1 text-sm ${i.done ? 'line-through text-slate-400' : 'text-slate-800 font-medium'}`}>
              {i.text}
            </span>

            {/* In group view, allow claiming "I'll bring" */}
            {view === 'group' && (
              i.bringer ? (
                <button
                  type="button"
                  className={`text-xs rounded-full px-2.5 py-1 font-medium transition ${
                    i.bringer === uid ? 'bg-teal-100 text-teal-800 font-semibold' : 'bg-slate-100 text-slate-600'
                  }`}
                  onClick={() => i.bringer === uid && update(tripId, 'packing', i.id, { bringer: null })}
                >
                  {i.bringer === uid ? 'You ✕' : byId[i.bringer]?.name || 'Claimed'}
                </button>
              ) : (
                <button
                  type="button"
                  className="text-xs rounded-full px-2.5 py-1 border border-teal-700 text-teal-700 hover:bg-teal-50 font-semibold transition"
                  onClick={() => update(tripId, 'packing', i.id, { bringer: uid })}
                >
                  I'll bring
                </button>
              )
            )}

            <button
              aria-label="Delete item"
              className="text-slate-300 hover:text-red-500 transition px-1"
              onClick={() => setDeletingItem(i)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        isOpen={!!deletingItem}
        title="Remove Item?"
        message={`Remove "${deletingItem?.text}" from the checklist?`}
        onConfirm={() => {
          remove(tripId, 'packing', deletingItem.id)
          setDeletingItem(null)
        }}
        onCancel={() => setDeletingItem(null)}
      />
    </div>
  )
}
