// On-device face matching (opt-in). Uses @vladmandic/face-api, loaded only when someone uses the feature.
// Nothing leaves the phone except a 128-number "face code" per person who chose to add theirs.
// Unmatched faces in photos are ignored — nothing is stored about people who didn't opt in.
const LIB = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js'
const MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/'
const MATCH_DISTANCE = 0.5 // lower = stricter. 0.5 is a common balance for 128-d face descriptors.

let ready = null
export function loadFaceModels() {
  ready ||= (async () => {
    const faceapi = await import(/* @vite-ignore */ LIB)
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODELS),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODELS),
    ])
    return faceapi
  })().catch((e) => { ready = null; throw e })
  return ready
}

const loadImage = (src) => new Promise((res, rej) => {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => res(img)
  img.onerror = () => rej(new Error('Could not open that image.'))
  img.src = src
})

const fileToDataUrl = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file)
})

// Selfie → face code. Requires exactly one clear face.
export async function faceCodeFromSelfie(file) {
  const faceapi = await loadFaceModels()
  const img = await loadImage(await fileToDataUrl(file))
  const found = await faceapi.detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 })).withFaceLandmarks().withFaceDescriptors()
  if (found.length === 0) throw new Error("Couldn't see a face — try a well-lit selfie, facing the camera.")
  if (found.length > 1) throw new Error('More than one face in that photo — use a selfie with just you.')
  return Array.from(found[0].descriptor, (v) => Math.round(v * 1e4) / 1e4)
}

// Photo → member ids whose face code matches a face in it. `codes` = { uid: number[] }.
export async function matchPeople(src, codes) {
  const entries = Object.entries(codes).filter(([, c]) => Array.isArray(c) && c.length === 128)
  if (!entries.length) return []
  const faceapi = await loadFaceModels()
  const img = await loadImage(src)
  const faces = await faceapi.detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })).withFaceLandmarks().withFaceDescriptors()
  const found = new Set()
  for (const f of faces) {
    let best = null, bestD = Infinity
    for (const [uid, code] of entries) {
      const d = faceapi.euclideanDistance(f.descriptor, code)
      if (d < bestD) { bestD = d; best = uid }
    }
    if (best && bestD < MATCH_DISTANCE) found.add(best)
  }
  return [...found]
}
