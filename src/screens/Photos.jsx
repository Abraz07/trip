import { useEffect, useRef, useState } from 'react'
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import JSZip from 'jszip'
import { useCol, newDocId, put, remove, getOnce } from '../data'
import { storage } from '../firebase'
import { ymd } from './Trip'
import ConfirmDialog from '../components/ConfirmDialog'

const MAX_DOC = 950_000

export async function compress(file, maxSide, quality) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  let q = quality, url = c.toDataURL('image/jpeg', q)
  while (url.length > MAX_DOC && q > 0.4) {
    q -= 0.1
    url = c.toDataURL('image/jpeg', q)
  }
  return url
}

// Convert dataURL to Blob
async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl)
  return res.blob()
}

export default function Photos({ tripId, trip, uid, byId }) {
  const photos = useCol(tripId, 'photos')
  const input = useRef()
  const [progress, setProgress] = useState(null)
  const [zipping, setZipping] = useState(null)
  const [viewing, setViewing] = useState(null)

  async function upload(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'))
    if (list.length === 0) return

    for (let i = 0; i < list.length; i++) {
      const file = list[i]
      const id = newDocId(tripId, 'photos')
      const date = file.lastModified ? ymd(new Date(file.lastModified)) : ymd(new Date())

      setProgress(`Processing ${i + 1}/${list.length}…`)

      try {
        const thumb = await compress(file, 480, 0.7)
        let fullUrl = null
        let storagePath = null

        // 1. Try Firebase Cloud Storage first
        if (storage) {
          try {
            const fullBlob = await dataUrlToBlob(await compress(file, 2000, 0.88))
            storagePath = `trips/${tripId}/photos/${id}.jpg`
            const storageRef = ref(storage, storagePath)
            const uploadTask = uploadBytesResumable(storageRef, fullBlob)

            await new Promise((resolve, reject) => {
              uploadTask.on(
                'state_changed',
                (snapshot) => {
                  const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
                  setProgress(`Uploading ${i + 1}/${list.length} (${pct}%)…`)
                },
                (err) => reject(err),
                async () => {
                  fullUrl = await getDownloadURL(uploadTask.snapshot.ref)
                  resolve()
                }
              )
            })
          } catch (storageErr) {
            console.warn('Storage upload unavailable, falling back to Firestore doc:', storageErr)
          }
        }

        // 2. Fallback to Firestore document if storage unavailable
        if (!fullUrl) {
          const fullData = await compress(file, 1600, 0.82)
          await put(tripId, 'photoFull', id, { data: fullData })
        }

        // Save photo record in Firestore
        await put(tripId, 'photos', id, {
          thumb,
          fullUrl: fullUrl || null,
          storagePath: storagePath || null,
          by: uid,
          date,
        })
      } catch (e) {
        alert(`Couldn't upload ${file.name}: ${e.message}`)
      }
    }

    setProgress(null)
    if (input.current) input.current.value = ''
  }

  // Download all photos as a ZIP file
  async function downloadAlbumZip() {
    if (photos.length === 0) return
    setZipping('0%')
    try {
      const zip = new JSZip()
      const folder = zip.folder(`yatra-${(trip?.name || 'trip').toLowerCase().replace(/[^\w-]/g, '_')}`)

      for (let i = 0; i < photos.length; i++) {
        const p = photos[i]
        setZipping(`${Math.round(((i + 1) / photos.length) * 100)}%`)

        let imgBlob = null
        if (p.fullUrl) {
          imgBlob = await fetch(p.fullUrl).then((r) => r.blob()).catch(() => null)
        }
        if (!imgBlob) {
          const docData = await getOnce(tripId, 'photoFull', p.id)
          const src = docData?.data || p.thumb
          imgBlob = await dataUrlToBlob(src)
        }

        if (imgBlob) {
          const filename = `photo-${i + 1}-${p.date || 'trip'}.jpg`
          folder.file(filename, imgBlob)
        }
      }

      setZipping('Generating ZIP…')
      const content = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(content)
      const a = document.createElement('a')
      a.href = url
      a.download = `yatra-${(trip?.name || 'trip').toLowerCase().replace(/[^\w-]/g, '_')}-album.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Could not download ZIP album: ' + err.message)
    } finally {
      setZipping(null)
    }
  }

  const byDate = {}
  for (const p of [...photos].reverse()) (byDate[p.date] ||= []).push(p)

  return (
    <>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />

      <div className="flex gap-2">
        <button disabled={!!progress} className="btn flex-1 py-2.5 text-sm" onClick={() => input.current.click()}>
          {progress || '📸 Add Photos'}
        </button>
        {photos.length > 0 && (
          <button
            disabled={!!zipping}
            className="btn-ghost flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-2xs"
            onClick={downloadAlbumZip}
          >
            <span>📥</span> {zipping ? `Zipping ${zipping}` : 'Download Album (.zip)'}
          </button>
        )}
      </div>

      <p className="text-xs text-slate-500 text-center">
        {photos.length} photos · High-resolution gallery with real-time sync
      </p>

      {photos.length === 0 && (
        <p className="card text-sm text-slate-500 text-center py-6">
          No photos yet. Drop the best shots of the day here so nobody has to beg for pics later 😄
        </p>
      )}

      {Object.entries(byDate)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, list]) => (
          <section key={date} className="space-y-2">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {new Date(date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
            </h2>
            <div className="grid grid-cols-3 gap-1.5">
              {list.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setViewing(p)}
                  className="aspect-square bg-slate-200 rounded-xl overflow-hidden hover:opacity-90 transition shadow-2xs"
                >
                  <img
                    src={p.thumb}
                    alt={`Photo by ${byId[p.by]?.name || 'someone'}`}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </section>
        ))}

      {viewing && <Viewer photo={viewing} tripId={tripId} uid={uid} byId={byId} onClose={() => setViewing(null)} />}
    </>
  )
}

function Viewer({ photo, tripId, uid, byId, onClose }) {
  const [full, setFull] = useState(photo.fullUrl || null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!full && !photo.fullUrl) {
      getOnce(tripId, 'photoFull', photo.id).then((d) => setFull(d?.data || photo.thumb))
    }
  }, [tripId, photo, full])

  const src = full || photo.fullUrl || photo.thumb

  async function handleDelete() {
    const promises = [remove(tripId, 'photos', photo.id), remove(tripId, 'photoFull', photo.id)]
    if (photo.storagePath && storage) {
      promises.push(deleteObject(ref(storage, photo.storagePath)).catch(() => {}))
    }
    await Promise.all(promises)
    setConfirmDelete(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xs flex flex-col" onClick={onClose}>
      <div
        className="flex justify-between items-center p-4 pt-[max(env(safe-area-inset-top),16px)] text-white text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <span>by {photo.by === uid ? 'you' : byId[photo.by]?.name || '?'}</span>
        <div className="flex gap-4">
          <a href={src} target="_blank" rel="noreferrer" download={`yatra-${photo.id}.jpg`} className="underline font-medium">
            Save
          </a>
          {photo.by === uid && (
            <button className="underline text-red-300 font-medium" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
          <button aria-label="Close" onClick={onClose} className="text-xl leading-none">
            ✕
          </button>
        </div>
      </div>
      <div className="flex-1 grid place-items-center p-2 min-h-0">
        <img src={src} alt="" className={`max-w-full max-h-full object-contain ${full ? '' : 'blur-xs'}`} />
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        title="Delete Photo?"
        message="Delete this photo for everyone in the group?"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
