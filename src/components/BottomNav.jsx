import { useState, useEffect } from 'react'

export function CompassIcon({ className = 'size-5', active = false }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill={active ? 'currentColor' : 'none'} />
    </svg>
  )
}

export function CalendarIcon({ className = 'size-5', active = false }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </svg>
  )
}

export function MapIcon({ className = 'size-5', active = false }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.15 : 0} />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  )
}

export function SplitsIcon({ className = 'size-5', active = false }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.15 : 0} />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </svg>
  )
}

export function CameraIcon({ className = 'size-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  )
}

export function HubIcon({ className = 'size-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="7" height="7" x="3" y="3" rx="1.5" />
      <rect width="7" height="7" x="14" y="3" rx="1.5" />
      <rect width="7" height="7" x="14" y="14" rx="1.5" />
      <rect width="7" height="7" x="3" y="14" rx="1.5" />
    </svg>
  )
}

export function PlusIcon({ className = 'size-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export default function BottomNav({ tab, setTab }) {
  const [quickOpen, setQuickOpen] = useState(false)

  // Close quick action sheet on escape key
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setQuickOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function handleSelect(newTab) {
    setTab(newTab)
    setQuickOpen(false)
  }

  // Is a secondary screen active? (photos or more)
  const isSecondaryActive = tab === 'photos' || tab === 'more'

  return (
    <>
      {/* Quick Action Sheet Modal Overlay */}
      {quickOpen && (
        <div
          className="fixed inset-0 z-40 bg-stone-950/40 backdrop-blur-xs flex items-end justify-center px-4 pb-[max(5.5rem,calc(env(safe-area-inset-bottom)+5rem))] animate-fade-in"
          onClick={() => setQuickOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-white/95 backdrop-blur-2xl rounded-3xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-stone-200/80 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div>
                <h3 className="font-bold text-sm text-stone-900 font-sans-editorial">Quick Actions</h3>
                <p className="text-[11px] text-stone-500 font-sans-editorial">Jump to or create anything on this trip</p>
              </div>
              <button
                type="button"
                onClick={() => setQuickOpen(false)}
                className="size-7 rounded-full bg-stone-100 text-stone-500 hover:bg-stone-200 grid place-items-center text-xs font-semibold"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Quick Expense */}
              <button
                type="button"
                onClick={() => handleSelect('money')}
                className="flex flex-col items-start p-3 rounded-2xl bg-orange-50/70 hover:bg-orange-100/70 border border-orange-200/50 transition-all text-left group"
              >
                <div className="size-8 rounded-xl bg-[#c2410c] text-white grid place-items-center mb-2 shadow-xs group-hover:scale-105 transition-transform">
                  <span className="font-bold text-xs font-sans-editorial">₹</span>
                </div>
                <span className="text-xs font-bold text-stone-900">Add Expense</span>
                <span className="text-[10px] text-stone-500 leading-tight mt-0.5">Split bills & settle up</span>
              </button>

              {/* Quick Plan Stop */}
              <button
                type="button"
                onClick={() => handleSelect('plan')}
                className="flex flex-col items-start p-3 rounded-2xl bg-emerald-50/70 hover:bg-emerald-100/70 border border-emerald-200/50 transition-all text-left group"
              >
                <div className="size-8 rounded-xl bg-emerald-700 text-white grid place-items-center mb-2 shadow-xs group-hover:scale-105 transition-transform">
                  <CalendarIcon className="size-4" active />
                </div>
                <span className="text-xs font-bold text-stone-900">Add to Plan</span>
                <span className="text-[10px] text-stone-500 leading-tight mt-0.5">Sights, stays & dining</span>
              </button>

              {/* Photos Gallery */}
              <button
                type="button"
                onClick={() => handleSelect('photos')}
                className={`flex flex-col items-start p-3 rounded-2xl border transition-all text-left group ${
                  tab === 'photos' ? 'bg-amber-100/60 border-amber-300' : 'bg-stone-50 hover:bg-stone-100 border-stone-200/60'
                }`}
              >
                <div className="size-8 rounded-xl bg-amber-600 text-white grid place-items-center mb-2 shadow-xs group-hover:scale-105 transition-transform">
                  <CameraIcon className="size-4" />
                </div>
                <span className="text-xs font-bold text-stone-900">Trip Photos</span>
                <span className="text-[10px] text-stone-500 leading-tight mt-0.5">Upload & share memories</span>
              </button>

              {/* Command Hub */}
              <button
                type="button"
                onClick={() => handleSelect('more')}
                className={`flex flex-col items-start p-3 rounded-2xl border transition-all text-left group ${
                  tab === 'more' ? 'bg-teal-100/60 border-teal-300' : 'bg-stone-50 hover:bg-stone-100 border-stone-200/60'
                }`}
              >
                <div className="size-8 rounded-xl bg-teal-700 text-white grid place-items-center mb-2 shadow-xs group-hover:scale-105 transition-transform">
                  <HubIcon className="size-4" />
                </div>
                <span className="text-xs font-bold text-stone-900">Command Hub</span>
                <span className="text-[10px] text-stone-500 leading-tight mt-0.5">Polls, pack, crew & vault</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Luminous Frosted Bar with Hero Quick Action Orb */}
      <nav
        aria-label="Bottom Navigation"
        className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] inset-x-3 max-w-md mx-auto z-30 select-none"
      >
        <div className="relative bg-white/92 backdrop-blur-2xl rounded-3xl border border-stone-200/80 shadow-[0_12px_40px_rgba(28,25,23,0.12),0_2px_8px_rgba(0,0,0,0.04)] px-2 py-1.5">
          <div className="grid grid-cols-5 items-center relative">
            {/* 1. Today */}
            <button
              type="button"
              onClick={() => setTab('today')}
              className={`flex flex-col items-center justify-center py-1 transition-all group ${
                tab === 'today' ? 'text-[#c2410c]' : 'text-stone-400 hover:text-stone-700'
              }`}
            >
              <div
                className={`px-3 py-0.5 rounded-full flex items-center justify-center transition-all ${
                  tab === 'today' ? 'bg-orange-100/70 shadow-xs' : 'group-hover:scale-105'
                }`}
              >
                <CompassIcon className="size-5" active={tab === 'today'} />
              </div>
              <span className={`text-[10px] tracking-tight font-sans-editorial mt-0.5 flex items-center gap-0.5 ${
                tab === 'today' ? 'font-bold text-[#c2410c]' : 'font-medium'
              }`}>
                Today
                {tab === 'today' && <span className="size-1 rounded-full bg-[#c2410c]" />}
              </span>
            </button>

            {/* 2. Plan */}
            <button
              type="button"
              onClick={() => setTab('plan')}
              className={`flex flex-col items-center justify-center py-1 transition-all group ${
                tab === 'plan' ? 'text-[#c2410c]' : 'text-stone-400 hover:text-stone-700'
              }`}
            >
              <div
                className={`px-3 py-0.5 rounded-full flex items-center justify-center transition-all ${
                  tab === 'plan' ? 'bg-orange-100/70 shadow-xs' : 'group-hover:scale-105'
                }`}
              >
                <CalendarIcon className="size-5" active={tab === 'plan'} />
              </div>
              <span className={`text-[10px] tracking-tight font-sans-editorial mt-0.5 flex items-center gap-0.5 ${
                tab === 'plan' ? 'font-bold text-[#c2410c]' : 'font-medium'
              }`}>
                Plan
                {tab === 'plan' && <span className="size-1 rounded-full bg-[#c2410c]" />}
              </span>
            </button>

            {/* 3. CENTER HERO ACTION ORB (+ Vertical Pop-out) */}
            <div className="relative flex items-center justify-center">
              <button
                type="button"
                aria-label={quickOpen ? 'Close quick menu' : 'Open quick actions'}
                title="Quick Actions"
                onClick={() => setQuickOpen(!quickOpen)}
                className={`relative -top-5 flex items-center justify-center size-[52px] rounded-full bg-gradient-to-tr from-[#9b2f00] via-[#c2410c] to-[#ea580c] text-white shadow-[0_10px_25px_rgba(194,65,12,0.45)] ring-4 ring-white active:scale-95 transition-all duration-200 hover:shadow-[0_12px_28px_rgba(194,65,12,0.55)] cursor-pointer ${
                  isSecondaryActive ? 'ring-amber-300' : 'ring-white'
                }`}
              >
                {/* Subtle Inner Gloss Rim */}
                <div className="absolute inset-0.5 rounded-full bg-gradient-to-b from-white/35 to-transparent pointer-events-none" />

                <span
                  className={`transition-transform duration-300 flex items-center justify-center ${
                    quickOpen ? 'rotate-45' : 'rotate-0'
                  }`}
                >
                  <PlusIcon className="size-6 text-white" />
                </span>

                {/* Secondary Screen Active Dot */}
                {isSecondaryActive && !quickOpen && (
                  <span className="absolute -bottom-0.5 bg-amber-300 size-2 rounded-full ring-2 ring-[#c2410c]" />
                )}
              </button>
            </div>

            {/* 4. Map */}
            <button
              type="button"
              onClick={() => setTab('map')}
              className={`flex flex-col items-center justify-center py-1 transition-all group ${
                tab === 'map' ? 'text-[#c2410c]' : 'text-stone-400 hover:text-stone-700'
              }`}
            >
              <div
                className={`relative px-3 py-0.5 rounded-full flex items-center justify-center transition-all ${
                  tab === 'map' ? 'bg-orange-100/70 shadow-xs' : 'group-hover:scale-105'
                }`}
              >
                <MapIcon className="size-5" active={tab === 'map'} />
                {/* Live Emerald Radar Beacon */}
                <span className="absolute top-0 right-1.5 flex size-2">
                  <span className="animate-ping absolute inline-flex size-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full size-2 bg-emerald-500" />
                </span>
              </div>
              <span className={`text-[10px] tracking-tight font-sans-editorial mt-0.5 flex items-center gap-0.5 ${
                tab === 'map' ? 'font-bold text-[#c2410c]' : 'font-medium'
              }`}>
                Map
                {tab === 'map' && <span className="size-1 rounded-full bg-[#c2410c]" />}
              </span>
            </button>

            {/* 5. Splits / Money */}
            <button
              type="button"
              onClick={() => setTab('money')}
              className={`flex flex-col items-center justify-center py-1 transition-all group ${
                tab === 'money' ? 'text-[#c2410c]' : 'text-stone-400 hover:text-stone-700'
              }`}
            >
              <div
                className={`relative px-3 py-0.5 rounded-full flex items-center justify-center transition-all ${
                  tab === 'money' ? 'bg-orange-100/70 shadow-xs' : 'group-hover:scale-105'
                }`}
              >
                <SplitsIcon className="size-5" active={tab === 'money'} />
                {/* Currency chip */}
                <span className="absolute -top-0.5 -right-0.5 bg-amber-500 text-stone-950 font-bold text-[8px] size-3.5 rounded-full flex items-center justify-center shadow-xs">
                  ₹
                </span>
              </div>
              <span className={`text-[10px] tracking-tight font-sans-editorial mt-0.5 flex items-center gap-0.5 ${
                tab === 'money' ? 'font-bold text-[#c2410c]' : 'font-medium'
              }`}>
                Splits
                {tab === 'money' && <span className="size-1 rounded-full bg-[#c2410c]" />}
              </span>
            </button>
          </div>
        </div>
      </nav>
    </>
  )
}
