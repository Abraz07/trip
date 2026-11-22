import { useState, useRef } from 'react'
import { DESTINATION_THEMES, getTheme } from '../themes'
import { compress } from '../screens/Photos'
import { updateTrip, recordUserTrip } from '../data'

export default function ThemePickerModal({ tripId, currentTheme, currentCoverUrl, uid, tripName, onClose }) {
  const [selectedThemeId, setSelectedThemeId] = useState(currentTheme || 'beach')
  const [coverUrl, setCoverUrl] = useState(currentCoverUrl || null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef()

  async function handleCoverUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const compressedDataUrl = await compress(file, 1400, 0.8)
      setCoverUrl(compressedDataUrl)
    } catch (err) {
      alert('Could not process image: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    await updateTrip(tripId, {
      theme: selectedThemeId,
      coverUrl: coverUrl || null,
    })
    recordUserTrip(uid, tripId, {
      name: tripName,
      theme: selectedThemeId,
      coverUrl: coverUrl || null,
    })
    onClose()
  }

  const activeTheme = getTheme(selectedThemeId)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-base text-slate-900">Destination Theme & Cover</h3>
            <p className="text-xs text-slate-500">Personalize your trip header and dashboard card</p>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 size-8 grid place-items-center rounded-full hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        {/* Live Preview Card */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-600">Live Preview:</label>
          <div
            className={`relative rounded-xl overflow-hidden p-4 text-white shadow-md transition-all ${
              coverUrl ? 'bg-slate-900' : `bg-gradient-to-br ${activeTheme.gradient}`
            }`}
          >
            {coverUrl && (
              <img
                src={coverUrl}
                alt="Trip Cover"
                className="absolute inset-0 size-full object-cover opacity-60"
              />
            )}
            <div className="relative z-10 flex items-start justify-between">
              <div>
                <span className="text-2xl">{activeTheme.icon}</span>
                <h4 className="font-bold text-lg leading-tight mt-1 truncate">{tripName || 'Trip Name'}</h4>
                <p className="text-xs opacity-90">{activeTheme.name}</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-xs">
                Active Theme
              </span>
            </div>
          </div>
        </div>

        {/* Preset Destination Themes */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-700 block">Choose Destination Vibe:</label>
          <div className="grid grid-cols-2 gap-2">
            {DESTINATION_THEMES.map((theme) => {
              const isSelected = selectedThemeId === theme.id
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => setSelectedThemeId(theme.id)}
                  className={`p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition ${
                    isSelected
                      ? 'border-teal-700 bg-teal-50/50 ring-2 ring-teal-600/30 font-semibold'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <span className="text-xl">{theme.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-900 truncate">{theme.name}</p>
                    <div className={`h-1.5 w-12 rounded-full mt-1 bg-gradient-to-r ${theme.gradient}`} />
                  </div>
                  {isSelected && <span className="text-teal-700 text-xs font-bold">✓</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Custom Cover Photo Option */}
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700">Custom Photo Cover:</label>
            {coverUrl && (
              <button
                type="button"
                onClick={() => setCoverUrl(null)}
                className="text-[11px] text-red-600 hover:underline"
              >
                Remove photo
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="btn-ghost w-full py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <span>📷</span> {uploading ? 'Processing photo…' : coverUrl ? 'Change Cover Photo' : 'Upload Cover Photo'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleCoverUpload}
          />
        </div>

        {/* Actions */}
        <div className="pt-2 border-t border-slate-100 flex gap-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1 py-2 text-xs">
            Cancel
          </button>
          <button type="button" onClick={handleSave} className="btn flex-1 py-2 text-xs">
            Apply Theme
          </button>
        </div>
      </div>
    </div>
  )
}
