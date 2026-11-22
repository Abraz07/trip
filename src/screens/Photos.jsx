import { useEffect, useRef, useState } from 'react'
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import JSZip from 'jszip'
import { useCol, newDocId, put, remove, getOnce, update, updateTrip } from '../data'
import { arrayUnion, arrayRemove } from 'firebase/firestore'
import { faceCodeFromSelfie, matchPeople } from '../faces'
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

export default function Photos({ tripId, trip, uid, byId, members = [] }) {
  const photos = useCol(tripId, 'photos')
  const input = useRef()
  const [progress, setProgress] = useState(null)
  const [zipping, setZipping] = useState(null)
  const [viewing, setViewing] = useState(null)
  const faceDocs = useCol(tripId, 'faces')
  const codes = Object.fromEntries(faceDocs.filter((f) => f.code).map((f) => [f.id, f.code]))
  const myFace = faceDocs.find((f) => f.id === uid)
  const [who, setWho] = useState('all')
  const [faceBusy, setFaceBusy] = useState('')
  const [faceErr, setFaceErr] = useState('')
  const selfie = useRef()
  const shown = who === 'all' ? photos : photos.filter((p) => p.people?.includes(who))

  // Tag a newly uploaded photo with the people (who opted in) whose faces appear in it.
  async function tagPhoto(id, src) {
    if (!Object.keys(codes).length) return
    try {
      const people = await matchPeople(src, codes)
      if (people.length) await update(tripId, 'photos', id, { people })
    } catch (e) { console.warn('face tagging skipped', e) }
  }

  async function enrol(file) {
    if (!file) return
    setFaceErr(''); setFaceBusy('Setting up face matching (first time downloads ~12 MB)…')
    try {
      const code = await faceCodeFromSelfie(file)
      await put(tripId, 'faces', uid, { code })
      // Look for me in photos already uploaded.
      for (let i = 0; i < photos.length; i++) {
        setFaceBusy(`Finding you in photos… ${i + 1}/${photos.length}`)
        const p = photos[i]
        const src = p.fullUrl || (await getOnce(tripId, 'photoFull', p.id))?.data || p.thumb
        const hit = await matchPeople(src, { [uid]: code }).catch(() => [])
        if (hit.length) await update(tripId, 'photos', p.id, { people: arrayUnion(uid) })
      }
      setWho(uid)
    } catch (e) { setFaceErr(e.message) }
    setFaceBusy('')
    if (selfie.current) selfie.current.value = ''
  }

  async function forgetMe() {
    setFaceBusy('Removing your face data…')
    await remove(tripId, 'faces', uid)
    await Promise.all(photos.filter((p) => p.people?.includes(uid)).map((p) => update(tripId, 'photos', p.id, { people: arrayRemove(uid) })))
    setWho('all'); setFaceBusy('')
  }

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
        setProgress(`Finding faces ${i + 1}/${list.length}…`)
        await tagPhoto(id, fullUrl || (await compress(file, 1600, 0.82)))
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
  for (const p of [...shown].reverse()) (byDate[p.date] ||= []).push(p)

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
        {photos.length} photos · shared instantly · saved at up to 1600px
      </p>

      <AlbumLink trip={trip} tripId={tripId} />

      <section className="card space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-sm">🙂 Find photos of people</p>
            <p className="text-xs text-slate-500">
              {myFace ? 'You’re set up — new photos with you get tagged automatically.' : 'Add a selfie to see every photo you’re in. Optional.'}
            </p>
          </div>
          <input ref={selfie} type="file" accept="image/*" capture="user" hidden onChange={(e) => enrol(e.target.files?.[0])} />
          {!myFace
            ? <button disabled={!!faceBusy} className="btn text-xs py-1.5 px-3 shrink-0" onClick={() => selfie.current.click()}>Add my face</button>
            : <button disabled={!!faceBusy} className="text-xs text-slate-500 underline shrink-0" onClick={forgetMe}>Remove my face</button>}
        </div>
        {faceBusy && <p className="text-xs text-violet-700 animate-pulse">{faceBusy}</p>}
        {faceErr && <p className="text-xs text-red-600">{faceErr}</p>}
        {!myFace && !faceBusy && <p className="text-[11px] text-slate-400">Matching runs on your phone. Your selfie isn’t uploaded — only a numeric face code that people in this trip can use to tag photos. Remove it any time.</p>}
        {faceDocs.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {[['all', `All (${photos.length})`], ...faceDocs.map((f) => [f.id, `${f.id === uid ? '🙋 Me' : byId[f.id]?.name || '?'} (${photos.filter((p) => p.people?.includes(f.id)).length})`])].map(([k, l]) => (
              <button key={k} onClick={() => setWho(k)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs border ${who === k ? 'bg-teal-700 text-white border-teal-700' : 'bg-white border-slate-300'}`}>{l}</button>
            ))}
          </div>
        )}
      </section>

      {photos.length > 0 && shown.length === 0 && <p className="card text-sm text-slate-500 text-center">No photos with {who === uid ? 'you' : byId[who]?.name} yet.</p>}

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
        <span>
          by {photo.by === uid ? 'you' : byId[photo.by]?.name || '?'}
          {photo.people?.length > 0 && <span className="block text-xs text-white/70">with {photo.people.map((u) => (u === uid ? 'you' : byId[u]?.name || '?')).join(', ')}</span>}
        </span>
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

// Link to a shared Google Photos (or any) album for full-quality originals.
function AlbumLink({ trip, tripId }) {
  const [editing, setEditing] = useState(false)
  const [url, setUrl] = useState(trip?.albumUrl || '')
  const [err, setErr] = useState('')
  function save(e) {
    e.preventDefault()
    const v = url.trim()
    if (v && !/^https:\/\/\S+$/.test(v)) return setErr('Paste a full https:// link, e.g. from Google Photos → Share → Create link.')
    updateTrip(tripId, { albumUrl: v || null }); setEditing(false); setErr('')
  }
  if (editing) {
    return (
      <form onSubmit={save} className="card space-y-2">
        <p className="text-sm font-semibold">🔗 Full-quality album</p>
        <input autoFocus className="input text-sm" placeholder="https://photos.app.goo.gl/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <p className="text-[11px] text-slate-500">Make a shared album in Google Photos (Share → Create link) so everyone can add originals.</p>
        <div className="flex gap-2"><button type="button" className="btn-ghost flex-1 text-sm" onClick={() => setEditing(false)}>Cancel</button><button className="btn flex-1 text-sm">Save</button></div>
      </form>
    )
  }
  return trip?.albumUrl
    ? (
      <div className="card flex items-center gap-3 py-3">
        <span className="text-2xl">🖼️</span>
        <div className="flex-1 min-w-0"><p className="text-sm font-semibold">Original-quality album</p><p className="text-xs text-slate-500 truncate">{trip.albumUrl}</p></div>
        <a className="btn text-xs py-1.5 px-3" href={trip.albumUrl} target="_blank" rel="noreferrer">Open</a>
        <button aria-label="Edit album link" className="text-slate-400" onClick={() => setEditing(true)}>✎</button>
      </div>
    )
    : <button className="btn-ghost w-full text-xs" onClick={() => setEditing(true)}>🔗 Add a shared album for full-quality originals</button>
}
