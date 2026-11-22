import { useState } from 'react'
import Packing from './Packing'
import Polls from './Polls'
import People from './People'
import Summary from './Summary'
import Safety from './Safety'
import Places from './Places'

const SECTIONS = [
  ['polls', '📊 Polls', Polls],
  ['places', '📍 Places', Places],
  ['pack', '🎒 Pack', Packing],
  ['group', '👥 Group', People],
  ['safety', '🛡️ Safety', Safety],
  ['summary', '🎉 Wrapped', Summary],
]

export default function More(props) {
  const [s, setS] = useState(() => { try { return sessionStorage.getItem('yatra:more') || 'polls' } catch { return 'polls' } })
  const pick = (k) => { setS(k); try { sessionStorage.setItem('yatra:more', k) } catch {} }
  const Screen = SECTIONS.find(([k]) => k === s)?.[2] || Polls
  return (
    <>
      <div className="grid grid-cols-3 gap-1 bg-slate-200 rounded-xl p-1 text-[11px] font-semibold text-center">
        {SECTIONS.map(([k, l]) => (
          <button
            key={k}
            onClick={() => pick(k)}
            className={`py-2 rounded-lg transition truncate ${s === k ? 'bg-white shadow-xs text-teal-800' : 'text-slate-600'}`}
          >
            {l}
          </button>
        ))}
      </div>
      <Screen {...props} />
    </>
  )
}
