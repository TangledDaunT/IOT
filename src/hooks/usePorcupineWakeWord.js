/**
 * usePorcupineWakeWord — always-on wake word listener using Porcupine Web SDK.
 *
 * Listens for "hey buddy" using the custom .ppn model.
 * When detected, fires the `iot:voice-trigger` CustomEvent which
 * VoiceMicButton already listens to — no changes needed there.
 *
 * SETUP REQUIRED (one-time):
 *  1. Go to https://console.picovoice.ai
 *  2. Open your "hey_budy" keyword → click Download
 *  3. Select platform: "Browser (WebAssembly)"  ← IMPORTANT, not macOS
 *  4. Save the .ppn file as: public/porcupine/hey-buddy.ppn
 *     (the porcupine_params.pv model is already in public/)
 *
 * The hook is no-op if:
 *  - VITE_PORCUPINE_ACCESS_KEY is missing
 *  - public/porcupine/hey-buddy.ppn is not yet placed
 *  - Microphone permission is denied
 */
import { useState, useEffect, useRef, useCallback } from 'react'

export const WAKE_STATES = {
  IDLE:         'idle',        // ready, not started
  LOADING:      'loading',     // initializing SDK
  LISTENING:    'listening',   // actively listening for wake word
  DETECTED:     'detected',    // wake word just fired
  ERROR:        'error',       // init or runtime error
  UNSUPPORTED:  'unsupported', // browser missing required APIs
}

const KEYWORD_PATH = '/porcupine/hey-buddy.ppn'
const MODEL_PATH   = '/porcupine_params.pv'

export function usePorcupineWakeWord({ enabled = true } = {}) {
  const [state, setState]   = useState(WAKE_STATES.IDLE)
  const [error, setError]   = useState(null)
  const porcupineRef        = useRef(null)
  const processorRef        = useRef(null)
  const startedRef          = useRef(false)

  const accessKey = import.meta.env.VITE_PORCUPINE_ACCESS_KEY

  const stop = useCallback(async () => {
    if (processorRef.current) {
      try {
        const { WebVoiceProcessor } = await import('@picovoice/web-voice-processor')
        if (porcupineRef.current) {
          await WebVoiceProcessor.unsubscribe(porcupineRef.current)
        }
      } catch (_) { /* ignore */ }
      processorRef.current = null
    }
    if (porcupineRef.current) {
      try { await porcupineRef.current.release() } catch (_) { /* ignore */ }
      porcupineRef.current = null
    }
    startedRef.current = false
    setState(WAKE_STATES.IDLE)
  }, [])

  const start = useCallback(async () => {
    if (startedRef.current) return
    if (!accessKey) {
      setError('VITE_PORCUPINE_ACCESS_KEY not set in .env')
      setState(WAKE_STATES.ERROR)
      return
    }

    // Basic browser API check
    if (!window.AudioContext && !window.webkitAudioContext) {
      setState(WAKE_STATES.UNSUPPORTED)
      return
    }

    setState(WAKE_STATES.LOADING)
    setError(null)

    try {
      const { PorcupineWorker }   = await import('@picovoice/porcupine-web')
      const { WebVoiceProcessor } = await import('@picovoice/web-voice-processor')

      const keywordModel = {
        publicPath: KEYWORD_PATH,
        label: 'hey-buddy',
        forceWrite: true,
        version: 1,
      }

      const porcupineModel = {
        publicPath: MODEL_PATH,
        forceWrite: false,
      }

      const onDetected = () => {
        setState(WAKE_STATES.DETECTED)
        // Dispatch the same CustomEvent that the V key shortcut uses
        window.dispatchEvent(new CustomEvent('iot:voice-trigger'))
        // Reset back to listening after a short delay
        setTimeout(() => setState(WAKE_STATES.LISTENING), 1500)
      }

      const onError = (err) => {
        console.error('[Porcupine]', err)
        setError(String(err))
        setState(WAKE_STATES.ERROR)
      }

      const porcupine = await PorcupineWorker.create(
        accessKey,
        [keywordModel],
        onDetected,
        porcupineModel,
        { processErrorCallback: onError }
      )

      porcupineRef.current = porcupine
      // Subscribe to WebVoiceProcessor — starts mic capture automatically
      await WebVoiceProcessor.subscribe(porcupine)
      processorRef.current = true

      startedRef.current = true
      setState(WAKE_STATES.LISTENING)
    } catch (err) {
      console.error('[Porcupine init error]', err)
      const msg = err?.message ?? String(err)
      // .ppn file not found → give clear instruction
      const friendlyMsg = msg.includes('404') || msg.includes('fetch')
        ? `hey-buddy.ppn not found at ${KEYWORD_PATH}. Re-download it for "Browser (WASM)" platform from console.picovoice.ai and place it at public/porcupine/hey-buddy.ppn`
        : msg
      setError(friendlyMsg)
      setState(WAKE_STATES.ERROR)
    }
  }, [accessKey])

  // Auto-start when enabled
  useEffect(() => {
    if (!enabled) { stop(); return }
    // Delay slightly so the page has finished loading
    const t = setTimeout(() => start(), 1200)
    return () => {
      clearTimeout(t)
      stop()
    }
  }, [enabled, start, stop])

  return { wakeState: state, wakeError: error, startListening: start, stopListening: stop }
}
