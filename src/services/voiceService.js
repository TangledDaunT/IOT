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
import { getAuthHeaders, resolveEdgeApiBaseUrl } from './securityService'

const VOICE_TIMEOUTS_MS = {
  transcribe: 3200,
  parse: 650,
  respond: 1300,
  tts: 1600,
}

function getVoiceApiBaseUrl() {
  return resolveEdgeApiBaseUrl() || getBaseUrl()
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController()
  const tm = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  } finally {
    clearTimeout(tm)
  }
}

async function fetchBlobWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController()
  const tm = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.blob()
  } finally {
    clearTimeout(tm)
  }
}

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
  const url  = `${getVoiceApiBaseUrl()}/api/voice/transcribe`
  const form = new FormData()
  form.append('audio', blob, 'recording.webm')

  const data = await fetchJsonWithTimeout(
    url,
    { method: 'POST', body: form, headers: getAuthHeaders() },
    VOICE_TIMEOUTS_MS.transcribe,
  )
  return (data.transcript || '').trim()
}

/** Parse transcript into a normalized intent using edge assistant backend. */
export async function parseIntentWithBackend(transcript, relayStates = []) {
  const url = `${getVoiceApiBaseUrl()}/api/voice/parse`
  return fetchJsonWithTimeout(
    url,
    {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        transcript,
        relay_states: relayStates.map((r) => ({ id: r.id, isOn: r.isOn })),
      }),
    },
    VOICE_TIMEOUTS_MS.parse,
  )
}

/** Get conversational text response from edge assistant backend. */
export async function respondWithBackend(transcript, commandResult = null, relayStates = []) {
  const url = `${getVoiceApiBaseUrl()}/api/voice/respond`
  const data = await fetchJsonWithTimeout(
    url,
    {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        transcript,
        command_result: commandResult,
        relay_states: relayStates.map((r) => ({ id: r.id, isOn: r.isOn })),
      }),
    },
    VOICE_TIMEOUTS_MS.respond,
  )
  return (data.reply || '').trim()
}

/** Synthesize audio with edge TTS backend and return Blob for browser playback. */
export async function synthesizeTtsWithBackend(text) {
  const url = `${getVoiceApiBaseUrl()}/api/voice/tts`
  return fetchBlobWithTimeout(
    url,
    {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text }),
    },
    VOICE_TIMEOUTS_MS.tts,
  )
}

/** Mock STT — simulates realistic latency without a real backend. */
export async function mockTranscribe(text) {
  await new Promise((r) => setTimeout(r, 600 + Math.random() * 400))
  return text
}
