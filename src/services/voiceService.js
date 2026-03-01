/**
 * voiceService — microphone recording + STT upload.
 *
 * Keeps all Web Audio / MediaRecorder concerns out of React components.
 *
 * API contract:
 *   requestMicPermission()     → 'granted' | 'denied'
 *   startRecording()           → async stop() → Blob
 *   transcribeAudio(blob)      → transcript string (calls backend)
 *   mockTranscribe(text)       → same shape, instant fake delay
 */
import { getBaseUrl } from '../config'

/** Probe mic permission without holding the stream open. */
export async function requestMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    return 'granted'
  } catch {
    return 'denied'
  }
}

/**
 * Opens the mic and starts recording.
 * Returns a `stop()` function — call it to end recording and get the Blob.
 *
 * Audio constraints optimised for speech + J6 CPU budget:
 *   - echoCancellation + noiseSuppression handled by browser
 *   - opus codec (smallest file, best WebAudio pipeline on Android)
 */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl:  true,
      channelCount:     1,
      sampleRate:       16000,
    },
  })

  // Pick lowest-overhead supported codec
  const mimeType =
    ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
      .find((t) => MediaRecorder.isTypeSupported(t)) || ''

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks   = []

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  // 100ms chunks → allows caller to detect silence in future iterations
  recorder.start(100)

  /**
   * stop() — stops the recorder and resolves to the final audio Blob.
   * Safe to call multiple times (second call is a no-op).
   */
  let stopped = false
  return () =>
    new Promise((resolve) => {
      if (stopped) { resolve(new Blob(chunks, { type: mimeType || 'audio/webm' })); return }
      stopped = true
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }))
      }
      if (recorder.state !== 'inactive') recorder.stop()
      else resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }))
    })
}

/**
 * POST audio blob to backend /api/voice/transcribe.
 * Backend should return { transcript: string }.
 * Timeout: 15 seconds (Whisper-small on mid-range CPU).
 */
export async function transcribeAudio(blob) {
  const url  = `${getBaseUrl()}/api/voice/transcribe`
  const form = new FormData()
  form.append('audio', blob, 'recording.webm')

  const ctrl = new AbortController()
  const tm   = setTimeout(() => ctrl.abort(), 15_000)

  try {
    const res = await fetch(url, { method: 'POST', body: form, signal: ctrl.signal })
    if (!res.ok) throw new Error(`STT HTTP ${res.status}`)
    const data = await res.json()
    return (data.transcript || '').trim()
  } finally {
    clearTimeout(tm)
  }
}

/** Mock STT — simulates realistic latency without a real backend. */
export async function mockTranscribe(text) {
  await new Promise((r) => setTimeout(r, 600 + Math.random() * 400))
  return text
}
