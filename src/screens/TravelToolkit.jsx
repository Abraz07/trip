import { useState, useEffect, useMemo } from 'react'
import { inr } from '../settle'
import { fmtRange } from '../dates'

// 12 Travel-Ready Currencies with offline fallback conversion rates (relative to USD)
export const CURRENCIES = {
  INR: { name: 'Indian Rupee', symbol: '₹', flag: '🇮🇳', rateToUSD: 0.0116 },
  USD: { name: 'US Dollar', symbol: '$', flag: '🇺🇸', rateToUSD: 1.0 },
  EUR: { name: 'Euro', symbol: '€', flag: '🇪🇺', rateToUSD: 1.085 },
  GBP: { name: 'British Pound', symbol: '£', flag: '🇬🇧', rateToUSD: 1.29 },
  AED: { name: 'UAE Dirham', symbol: 'د.إ', flag: '🇦🇪', rateToUSD: 0.272 },
  THB: { name: 'Thai Baht', symbol: '฿', flag: '🇹🇭', rateToUSD: 0.029 },
  JPY: { name: 'Japanese Yen', symbol: '¥', flag: '🇯🇵', rateToUSD: 0.0066 },
  SGD: { name: 'Singapore Dollar', symbol: 'S$', flag: '🇸🇬', rateToUSD: 0.76 },
  AUD: { name: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺', rateToUSD: 0.655 },
  CAD: { name: 'Canadian Dollar', symbol: 'C$', flag: '🇨🇦', rateToUSD: 0.72 },
  IDR: { name: 'Indonesian Rupiah', symbol: 'Rp', flag: '🇮🇩', rateToUSD: 0.000062 },
  VND: { name: 'Vietnamese Dong', symbol: '₫', flag: '🇻🇳', rateToUSD: 0.000039 },
}

// Destination Timezones
export const TIMEZONES = [
  { id: 'Asia/Kolkata', label: 'India (IST +5:30)', offsetMinutes: 330, flag: '🇮🇳' },
  { id: 'UTC', label: 'UTC / GMT (+0:00)', offsetMinutes: 0, flag: '🌐' },
  { id: 'Europe/London', label: 'London (GMT/BST)', offsetMinutes: 60, flag: '🇬🇧' },
  { id: 'Europe/Paris', label: 'Paris / Rome (CET +1:00)', offsetMinutes: 60, flag: '🇫🇷' },
  { id: 'Asia/Dubai', label: 'Dubai (GST +4:00)', offsetMinutes: 240, flag: '🇦🇪' },
  { id: 'Asia/Bangkok', label: 'Bangkok / Bali (ICT +7:00)', offsetMinutes: 420, flag: '🇹🇭' },
  { id: 'Asia/Singapore', label: 'Singapore (SGT +8:00)', offsetMinutes: 480, flag: '🇸🇬' },
  { id: 'Asia/Tokyo', label: 'Tokyo (JST +9:00)', offsetMinutes: 540, flag: '🇯🇵' },
  { id: 'Australia/Sydney', label: 'Sydney (AEST +10:00)', offsetMinutes: 600, flag: '🇦🇺' },
  { id: 'America/New_York', label: 'New York (EST -5:00)', offsetMinutes: -300, flag: '🇺🇸' },
  { id: 'America/Los_Angeles', label: 'Los Angeles (PST -8:00)', offsetMinutes: -480, flag: '🇺🇸' },
]

// Essential Travel Phrases across popular languages
export const PHRASES = {
  es: {
    name: 'Spanish',
    flag: '🇪🇸',
    list: [
      { en: 'Hello / Good morning', tr: '¡Hola! / Buenos días', pron: 'OH-lah / BWAY-nos DEE-as' },
      { en: 'Thank you very much', tr: 'Muchas gracias', pron: 'MOO-chas GRAH-syas' },
      { en: 'Please / Excuse me', tr: 'Por favor / Disculpe', pron: 'por fah-VOR / dees-KOOL-peh' },
      { en: 'How much does this cost?', tr: '¿Cuánto cuesta esto?', pron: 'KWAN-toh KWAY-stah EHS-toh' },
      { en: 'Where is the restroom?', tr: '¿Dónde está el baño?', pron: 'DON-day ess-TAH el BAHN-yo' },
      { en: 'Is this vegetarian?', tr: '¿Es vegetariano?', pron: 'es veh-heh-tah-RYAH-noh' },
      { en: 'Water, please', tr: 'Agua, por favor', pron: 'AH-gwah, por fah-VOR' },
      { en: 'The check / bill, please', tr: 'La cuenta, por favor', pron: 'lah KWEN-tah, por fah-VOR' },
      { en: 'Can you help me?', tr: '¿Me puede ayudar?', pron: 'meh PWAY-deh ah-yoo-DAR' },
      { en: 'Emergency / Doctor', tr: 'Emergencia / Médico', pron: 'eh-mehr-HEN-syah / MEH-dee-koh' },
    ],
  },
  fr: {
    name: 'French',
    flag: '🇫🇷',
    list: [
      { en: 'Hello / Good morning', tr: 'Bonjour', pron: 'bohn-ZHOOR' },
      { en: 'Thank you very much', tr: 'Merci beaucoup', pron: 'mair-SEE boh-KOO' },
      { en: 'Please / Excuse me', tr: "S'il vous plaît / Excusez-moi", pron: 'seel voo PLEH / ek-skew-ZAY mwah' },
      { en: 'How much does this cost?', tr: 'Combien ça coûte ?', pron: 'kohm-BYEN sah KOOT' },
      { en: 'Where is the restroom?', tr: 'Où sont les toilettes ?', pron: 'oo sohn lay twah-LET' },
      { en: 'Is this vegetarian?', tr: 'Est-ce végétarien ?', pron: 'ess veh-zheh-tah-RYAN' },
      { en: 'Water, please', tr: "De l'eau, s'il vous plaît", pron: 'duh LOH, seel voo PLEH' },
      { en: 'The check / bill, please', tr: "L'addition, s'il vous plaît", pron: 'lah-dee-SYOHN, seel voo PLEH' },
      { en: 'Can you help me?', tr: "Pouvez-vous m'aider ?", pron: 'poo-VAY voo may-DAY' },
      { en: 'Emergency / Doctor', tr: 'Urgence / Médecin', pron: 'oor-ZHAHNS / mayd-SAN' },
    ],
  },
  th: {
    name: 'Thai',
    flag: '🇹🇭',
    list: [
      { en: 'Hello', tr: 'Sawatdee (khrub/ka)', pron: 'sah-wah-dee' },
      { en: 'Thank you very much', tr: 'Khop khun (khrub/ka)', pron: 'kop koon' },
      { en: 'Excuse me / Sorry', tr: 'Khor thot (khrub/ka)', pron: 'kor tot' },
      { en: 'How much is this?', tr: 'Nee thao rai?', pron: 'nee tao rye' },
      { en: 'Where is the toilet?', tr: 'Hong nam yoo tee nai?', pron: 'hong nahm yoo tee nye' },
      { en: 'Is this vegetarian (Jay)?', tr: 'Ahan jay chai mai?', pron: 'ah-hahn jay chye my' },
      { en: 'Water, please', tr: 'Khor nam plao', pron: 'kor nahm plow' },
      { en: 'The bill, please', tr: 'Chek bin duay', pron: 'check bin doo-ay' },
      { en: 'Can you help me?', tr: 'Chuay duay dai mai?', pron: 'choo-ay doo-ay dye my' },
      { en: 'Emergency / Hospital', tr: 'Chuk-chern / Rong phayaban', pron: 'chook-churn / rong pay-ah-bahn' },
    ],
  },
  ja: {
    name: 'Japanese',
    flag: '🇯🇵',
    list: [
      { en: 'Hello / Good day', tr: 'Konnichiwa', pron: 'kohn-nee-chee-wah' },
      { en: 'Thank you very much', tr: 'Arigatou gozaimasu', pron: 'ah-ree-GAH-toh goh-ZY-mahs' },
      { en: 'Excuse me / Please', tr: 'Sumimasen / Onegaishimasu', pron: 'soo-mee-mah-sen / oh-neh-guy-she-mahs' },
      { en: 'How much is this?', tr: 'Kore wa ikura desu ka?', pron: 'koh-reh wah ee-koo-rah dess kah' },
      { en: 'Where is the restroom?', tr: 'Toire wa doko desu ka?', pron: 'toy-reh wah doh-koh dess kah' },
      { en: 'Is this vegetarian?', tr: 'Bejitarian muke desu ka?', pron: 'beh-jee-tah-ree-an moo-keh dess kah' },
      { en: 'Water, please', tr: 'Omizu o kudasai', pron: 'oh-mee-zoo oh koo-dah-sigh' },
      { en: 'The check / bill, please', tr: 'Okaikei o onegaishimasu', pron: 'oh-kye-kay oh oh-neh-guy-she-mahs' },
      { en: 'Help me, please', tr: 'Tasukete kudasai', pron: 'tah-soo-keh-teh koo-dah-sigh' },
      { en: 'Emergency / Doctor', tr: 'Kinkyuu / Isha', pron: 'keen-kyoo / ee-shah' },
    ],
  },
  ar: {
    name: 'Arabic',
    flag: '🇦🇪',
    list: [
      { en: 'Hello / Welcome', tr: 'Marhaban / Ahlan', pron: 'MAR-ha-ban / AH-lan' },
      { en: 'Thank you very much', tr: 'Shukran jazeelan', pron: 'SHOOK-ran ja-ZEE-lan' },
      { en: 'Please / Excuse me', tr: 'Min fadlak / Afwan', pron: 'min FAD-lak / AF-wan' },
      { en: 'How much is this?', tr: 'Bikam hatha?', pron: 'bi-KAM HA-tha' },
      { en: 'Where is the bathroom?', tr: 'Ayna al-hammam?', pron: 'AY-na al-ham-MAM' },
      { en: 'Is this vegetarian / Halal?', tr: 'Hal hatha nabati / halal?', pron: 'hal HA-tha na-BA-tee' },
      { en: 'Water, please', tr: 'Maa, min fadlak', pron: 'MAA-an, min FAD-lak' },
      { en: 'The bill, please', tr: 'Al-fatoorah, min fadlak', pron: 'al-fa-TOO-rah, min FAD-lak' },
      { en: 'Can you help me?', tr: 'Hal yumkinuka musa’adati?', pron: 'hal YUM-ki-nu-ka moo-SA-a-da-tee' },
      { en: 'Emergency / Doctor', tr: 'Tawari / Tabeeb', pron: 'ta-WA-ree / ta-BEEB' },
    ],
  },
  hi: {
    name: 'Hindi',
    flag: '🇮🇳',
    list: [
      { en: 'Hello / Greetings', tr: 'Namaste', pron: 'nah-mas-TAY' },
      { en: 'Thank you very much', tr: 'Bahut bahut dhanyavaad', pron: 'BAH-hoot dun-ya-VAHD' },
      { en: 'Please / Excuse me', tr: 'Kripya / Maaf kijiye', pron: 'KRIP-yah / MAHF kee-jee-yay' },
      { en: 'How much is this?', tr: 'Yeh kitne ka hai?', pron: 'yeh KIT-nay kah high' },
      { en: 'Where is the washroom?', tr: 'Washroom / Shauchalay kahan hai?', pron: 'shoh-CHA-lay ka-HAAN high' },
      { en: 'Is this pure vegetarian?', tr: 'Kya yeh shuddh shakahari hai?', pron: 'kya yeh shoodh shah-kah-HAH-ree high' },
      { en: 'Drinking water, please', tr: 'Peene ka paani dijiye', pron: 'PEE-nay kah PAH-nee DEE-jee-yay' },
      { en: 'The bill, please', tr: 'Bill de dijiye', pron: 'bill day DEE-jee-yay' },
      { en: 'Please help me', tr: 'Kripya meri madad kijiye', pron: 'KRIP-yah MAY-ree MUH-dud kee-jee-yay' },
      { en: 'Emergency / Doctor', tr: 'Aapatkaal / Doctor', pron: 'ah-put-KAHL / DOC-tor' },
    ],
  },
}

export default function TravelToolkit({ trip, members, planItems = [], expenses = [], places = [], emergencyContacts = [] }) {
  const [activeTab, setActiveTab] = useState('currency') // 'currency' | 'clock' | 'phrases' | 'export'

  return (
    <div className="space-y-4">
      {/* Toolkit Tab Navigation */}
      <div className="grid grid-cols-4 gap-1 bg-slate-200/90 rounded-2xl p-1 text-xs font-semibold">
        {[
          ['currency', '💱 FX', 'Currency'],
          ['clock', '⏱️ Time', 'World Clock'],
          ['phrases', '🗣️ Talk', 'Phrasebook'],
          ['export', '📤 Share', 'Export Trip'],
        ].map(([k, icon, title]) => (
          <button
            key={k}
            onClick={() => setActiveTab(k)}
            className={`py-2 rounded-xl transition text-center flex flex-col items-center justify-center gap-0.5 ${
              activeTab === k
                ? 'bg-white shadow-xs text-teal-800 font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="text-sm">{icon}</span>
            <span className="text-[10px] leading-tight truncate">{title}</span>
          </button>
        ))}
      </div>

      {/* Sub-tools */}
      {activeTab === 'currency' && <CurrencyConverter />}
      {activeTab === 'clock' && <DestinationClock />}
      {activeTab === 'phrases' && <TravelPhrasebook />}
      {activeTab === 'export' && (
        <TripExporter
          trip={trip}
          members={members}
          planItems={planItems}
          expenses={expenses}
          places={places}
          emergencyContacts={emergencyContacts}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------
// 1. Dynamic Currency Converter
// ----------------------------------------------------
function CurrencyConverter() {
  const [amount, setAmount] = useState('100')
  const [fromCurr, setFromCurr] = useState('USD')
  const [toCurr, setToCurr] = useState('INR')

  const parsedAmount = parseFloat(amount) || 0

  const rate = useMemo(() => {
    const fromUSD = CURRENCIES[fromCurr]?.rateToUSD || 1
    const toUSD = CURRENCIES[toCurr]?.rateToUSD || 1
    return fromUSD / toUSD
  }, [fromCurr, toCurr])

  const convertedValue = (parsedAmount * rate).toFixed(2)

  const swapCurrencies = () => {
    setFromCurr(toCurr)
    setToCurr(fromCurr)
  }

  const presets = fromCurr === 'INR' ? [100, 500, 2000, 5000] : [10, 50, 100, 500]

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
            <span>💱</span> Travel Currency Converter
          </h3>
          <p className="text-[11px] text-slate-500">Live & offline calculated FX exchange rates</p>
        </div>
        <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
          Offline Ready
        </span>
      </div>

      {/* From Currency Block */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>You send / pay</span>
          <span className="font-mono">{CURRENCIES[fromCurr]?.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full text-2xl font-bold bg-transparent outline-none text-slate-900"
          />
          <select
            value={fromCurr}
            onChange={(e) => setFromCurr(e.target.value)}
            className="bg-white border border-slate-200 font-bold text-sm px-2.5 py-1.5 rounded-xl outline-none shadow-xs text-slate-800"
          >
            {Object.keys(CURRENCIES).map((code) => (
              <option key={code} value={code}>
                {CURRENCIES[code].flag} {code}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Swap Button */}
      <div className="flex justify-center -my-2 relative z-10">
        <button
          type="button"
          onClick={swapCurrencies}
          className="size-9 rounded-full bg-white border border-slate-300 shadow-md text-slate-700 hover:text-teal-700 grid place-items-center active:scale-95 transition"
          title="Swap currencies"
        >
          ⇅
        </button>
      </div>

      {/* To Currency Block */}
      <div className="bg-teal-50/60 border border-teal-200 rounded-2xl p-3.5 space-y-2">
        <div className="flex items-center justify-between text-xs text-teal-800">
          <span>You get / estimate</span>
          <span className="font-mono">{CURRENCIES[toCurr]?.name}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xl font-black text-teal-950 truncate">
            {CURRENCIES[toCurr]?.symbol} {Number(convertedValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
          <select
            value={toCurr}
            onChange={(e) => setToCurr(e.target.value)}
            className="bg-white border border-teal-200 font-bold text-sm px-2.5 py-1.5 rounded-xl outline-none shadow-xs text-teal-900"
          >
            {Object.keys(CURRENCIES).map((code) => (
              <option key={code} value={code}>
                {CURRENCIES[code].flag} {code}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Exchange Rate Formula Banner */}
      <div className="text-center bg-slate-100 rounded-xl py-2 px-3 text-xs text-slate-600 flex items-center justify-between font-mono">
        <span>Exchange Rate:</span>
        <span className="font-semibold text-slate-900">
          1 {fromCurr} = {rate.toFixed(4)} {toCurr}
        </span>
      </div>

      {/* Quick Amount Presets */}
      <div>
        <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Quick amounts:</p>
        <div className="grid grid-cols-4 gap-1.5">
          {presets.map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => setAmount(String(val))}
              className={`py-1.5 text-xs font-semibold rounded-lg border transition ${
                amount === String(val)
                  ? 'bg-teal-700 text-white border-teal-700 shadow-xs'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {CURRENCIES[fromCurr]?.symbol}{val}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------
// 2. Dynamic Destination & World Clock
// ----------------------------------------------------
function DestinationClock() {
  const [time, setTime] = useState(new Date())
  const [selectedTz, setSelectedTz] = useState(TIMEZONES[0].id)

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const targetTz = TIMEZONES.find((t) => t.id === selectedTz) || TIMEZONES[0]

  // Compute Destination Time
  const destDateString = time.toLocaleString('en-US', { timeZone: targetTz.id })
  const destDate = new Date(destDateString)
  const destHour = destDate.getHours()
  const isDestDay = destHour >= 6 && destHour < 18

  // Compute Device Local Time
  const localHour = time.getHours()
  const isLocalDay = localHour >= 6 && localHour < 18

  // Compute difference in hours
  const localMinutes = time.getTimezoneOffset() * -1
  const diffMinutes = targetTz.offsetMinutes - localMinutes
  const diffHours = (diffMinutes / 60).toFixed(1).replace('.0', '')
  const diffText =
    diffMinutes === 0
      ? 'Same timezone as you'
      : diffMinutes > 0
      ? `${diffHours} hrs ahead of your device`
      : `${Math.abs(Number(diffHours))} hrs behind your device`

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
            <span>⏱️</span> Destination Time & Daylight
          </h3>
          <p className="text-[11px] text-slate-500">Compare your time with trip location</p>
        </div>
      </div>

      {/* Select Destination Zone */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-slate-600">Select Trip Timezone</label>
        <select
          value={selectedTz}
          onChange={(e) => setSelectedTz(e.target.value)}
          className="input text-xs font-semibold"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz.id} value={tz.id}>
              {tz.flag} {tz.label}
            </option>
          ))}
        </select>
      </div>

      {/* Side-by-Side Dual Clock Cards */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Destination Clock */}
        <div className={`p-3.5 rounded-2xl border text-center space-y-1 ${
          isDestDay ? 'bg-amber-50/70 border-amber-200 text-amber-950' : 'bg-slate-900 border-slate-800 text-white'
        }`}>
          <div className="flex items-center justify-center gap-1 text-[11px] font-semibold opacity-85">
            <span>{isDestDay ? '☀️ Daytime' : '🌙 Nighttime'}</span>
            <span>·</span>
            <span>Destination</span>
          </div>
          <div className="text-2xl font-black font-mono tracking-tight">
            {destDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <p className="text-[10px] opacity-75">
            {destDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          </p>
        </div>

        {/* Local Clock */}
        <div className={`p-3.5 rounded-2xl border text-center space-y-1 ${
          isLocalDay ? 'bg-sky-50/70 border-sky-200 text-sky-950' : 'bg-slate-900 border-slate-800 text-white'
        }`}>
          <div className="flex items-center justify-center gap-1 text-[11px] font-semibold opacity-85">
            <span>{isLocalDay ? '☀️ Daytime' : '🌙 Nighttime'}</span>
            <span>·</span>
            <span>Your Device</span>
          </div>
          <div className="text-2xl font-black font-mono tracking-tight">
            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <p className="text-[10px] opacity-75">
            {time.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Timezone Offset Indicator Banner */}
      <div className="bg-slate-100 rounded-xl p-2.5 text-center text-xs text-slate-700 font-medium">
        ✈️ {diffText}
      </div>
    </div>
  )
}

// ----------------------------------------------------
// 3. Essential Travel Phrasebook
// ----------------------------------------------------
function TravelPhrasebook() {
  const [lang, setLang] = useState('es')
  const [copiedIdx, setCopiedIdx] = useState(null)

  const activeLang = PHRASES[lang] || PHRASES.es

  const copyPhrase = (text, idx) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {})
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 2000)
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
            <span>🗣️</span> Travel Phrasebook & Cheat Sheet
          </h3>
          <p className="text-[11px] text-slate-500">Tap any phrase to copy for quick messaging</p>
        </div>
      </div>

      {/* Language Selector Pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {Object.entries(PHRASES).map(([code, item]) => (
          <button
            key={code}
            type="button"
            onClick={() => setLang(code)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition flex items-center gap-1.5 ${
              lang === code
                ? 'bg-teal-700 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <span>{item.flag}</span>
            <span>{item.name}</span>
          </button>
        ))}
      </div>

      {/* Phrases List */}
      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
        {activeLang.list.map((item, idx) => (
          <div
            key={idx}
            onClick={() => copyPhrase(item.tr, idx)}
            className="p-3 rounded-xl border border-slate-200 hover:border-teal-300 hover:bg-teal-50/40 transition cursor-pointer flex items-center justify-between gap-3 group"
          >
            <div className="min-w-0">
              <p className="text-xs text-slate-500 font-medium">{item.en}</p>
              <p className="text-sm font-bold text-slate-900 mt-0.5">{item.tr}</p>
              <p className="text-[11px] text-teal-700 italic mt-0.5">🗣️ {item.pron}</p>
            </div>
            <button
              type="button"
              className="size-8 rounded-lg bg-slate-100 group-hover:bg-teal-700 group-hover:text-white text-slate-600 shrink-0 text-xs font-bold grid place-items-center transition"
            >
              {copiedIdx === idx ? '✓' : '📋'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ----------------------------------------------------
// 4. Trip Itinerary & Briefing Exporter
// ----------------------------------------------------
function TripExporter({ trip, members, planItems, expenses, places, emergencyContacts }) {
  const [copied, setCopied] = useState(false)

  const totalSpent = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)

  // Generate plain text itinerary
  const summaryText = useMemo(() => {
    const lines = []
    lines.push(`🎒 *${trip.name.toUpperCase()}*`)
    lines.push(`📅 Dates: ${fmtRange(trip.start, trip.end)}`)
    lines.push(`👥 Gang (${members.length}): ${members.map((m) => m.name || 'Friend').join(', ')}`)
    lines.push('')

    // Planned stops
    if (planItems.length > 0) {
      lines.push(`📍 *Planned Itinerary (${planItems.length} stops)*:`)
      const sorted = [...planItems].sort((a, b) => (a.day || 0) - (b.day || 0) || (a.time || '').localeCompare(b.time || ''))
      let currentDay = null
      sorted.forEach((item) => {
        if (item.day !== currentDay) {
          currentDay = item.day
          lines.push(`\n📅 Day ${currentDay}:`)
        }
        lines.push(` • ${item.time ? `[${item.time}] ` : ''}${item.text || item.title || 'Stop'}${item.note ? ` (${item.note})` : ''}`)
      })
      lines.push('')
    }

    // Places
    if (places.length > 0) {
      lines.push(`✨ *Saved Highlights (${places.length})*:`)
      places.slice(0, 8).forEach((p) => {
        lines.push(` • ${p.name}${p.note ? ` - ${p.note}` : ''}`)
      })
      lines.push('')
    }

    // Money overview
    lines.push(`💰 *Expense Ledger*:`)
    lines.push(`Total Spent: ${inr(totalSpent)} (${inr(totalSpent / (members.length || 1))} / person)`)
    lines.push(`Tracked Expenses: ${expenses.length} entries`)
    lines.push('')

    // Emergency contacts
    if (emergencyContacts.length > 0) {
      lines.push(`🛡️ *Emergency Contacts*:`)
      emergencyContacts.forEach((c) => {
        lines.push(` • ${c.name}: ${c.phone || c.num || ''}`)
      })
      lines.push('')
    }

    lines.push(`✨ Shared via Yatra Travel Hub 🎒`)
    return lines.join('\n')
  }, [trip, members, planItems, expenses, places, emergencyContacts, totalSpent])

  const copySummary = async () => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(summaryText).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  const printSummary = () => {
    window.print()
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
            <span>📤</span> Trip Itinerary & Ledger Exporter
          </h3>
          <p className="text-[11px] text-slate-500">Export formatted briefing to WhatsApp or Print/PDF</p>
        </div>
      </div>

      {/* Live Formatted Preview */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 max-h-60 overflow-y-auto">
        <pre className="text-[11px] font-mono text-slate-800 whitespace-pre-wrap leading-relaxed">
          {summaryText}
        </pre>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          onClick={copySummary}
          className="btn text-xs py-2.5 flex items-center justify-center gap-1.5"
        >
          <span>{copied ? '✓' : '📋'}</span>
          <span>{copied ? 'Copied to Clipboard!' : 'Copy for WhatsApp'}</span>
        </button>

        <button
          type="button"
          onClick={printSummary}
          className="btn-ghost text-xs py-2.5 flex items-center justify-center gap-1.5 text-slate-700"
        >
          <span>🖨️</span>
          <span>Print / Save PDF</span>
        </button>
      </div>
    </div>
  )
}
