/**
 * useIdleVoice — always-on voice pipeline for the idle overlay.
 *
 * Uses the browser's built-in Web Speech Recognition API for:
 *   1. Continuous wake word detection ("hey buddy")
 *   2. Live transcription with interim results while user speaks
 *
 * After transcription, Groq LLM parses the command, executes relay actions,
 * and streams back a natural language reply. Browser TTS speaks the reply.
 *
 * State machine:
 *   IDLE → (say "hey buddy") → LISTENING → PROCESSING → RESPONDING → IDLE
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { parseWithGroq, isGroqConfigured, streamVoiceResponse } from '../services/groqService'
import { toggleRelay } from '../services/relayService'
import { RELAY_CONFIG } from '../config'

// ── Voice phases ────────────────────────────────────────────────────────────
export const IDLE_VOICE_PHASE = {
  IDLE:       'idle',       // Wake word detector running silently
  LISTENING:  'listening',  // Actively recording command, showing live text
  PROCESSING: 'processing', // Sending to Groq (parse intent + relay control)
  RESPONDING: 'responding', // Streaming LLM reply back to user
}

// ── SpeechRecognition API compat (Chrome / Safari) ──────────────────────────
const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null

// ── Browser TTS helper ───────────────────────────────────────────────────────
function speak(text) {
  try {
    window.speechSynthesis.cancel()
    const u     = new SpeechSynthesisUtterance(text)
    u.rate  = 1.0
    u.pitch = 1.05
    u.volume = 0.9
    window.speechSynthesis.speak(u)
  } catch { /* not available */ }
}

// ── Main hook ───────────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {boolean}  opts.enabled      - whether to run wake-word detection
 * @param {Array<{id: number, isOn: boolean}>} opts.relayStates
 */
export function useIdleVoice({ enabled = true, relayStates = [] } = {}) {
  const [phase,        setPhase]        = useState(IDLE_VOICE_PHASE.IDLE)
  const [liveText,     setLiveText]     = useState('')   // interim from SpeechRecognition
  const [transcript,   setTranscript]   = useState('')   // final user command
  const [responseText, setResponseText] = useState('')   // streaming LLM reply
  const [errorMsg,     setErrorMsg]     = useState(null)

  // ── Stable refs ─────────────────────────────────────────────────────────
  const mountedRef     = useRef(true)
  const activeRef      = useRef(false)   // true while processing a command
  const wakeRecRef     = useRef(null)    // SpeechRecognition instance for wake word
  const cmdRecRef      = useRef(null)    // SpeechRecognition instance for command
  const resetTimerRef  = useRef(null)
  const relayStatesRef = useRef(relayStates)
  const enabledRef     = useRef(enabled)

  // Declare function refs early so they can be used inside closures below
  const startListeningRef   = useRef(null)
  const startWakeLoopRef    = useRef(null)
  const processCommandRef   = useRef(null)

  // Keep refs in sync with latest versions (on each render)
  useEffect(() => { relayStatesRef.current = relayStates }, [relayStates])
  useEffect(() => { enabledRef.current = enabled }, [enabled])
  useEffect(() => () => { mountedRef.current = false }, [])

  // ── Reset to IDLE after delay ────────────────────────────────────────────
  const resetToIdle = useCallback((delay = 5000) => {
    clearTimeout(resetTimerRef.current)
    resetTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return
      setPhase(IDLE_VOICE_PHASE.IDLE)
      setLiveText('')
      setTranscript('')
      setResponseText('')
      setErrorMsg(null)
      activeRef.current = false
    }, delay)
  }, [])

  // ── Process command: parse → execute relay → stream reply ───────────────
  const processCommand = useCallback(async (text) => {
    if (!mountedRef.current) return
    setTranscript(text)
    setPhase(IDLE_VOICE_PHASE.PROCESSING)
    setLiveText('')

    let commandResult = null

    // Parse intent and execute relay action
    try {
      if (isGroqConfigured()) {
        const intent = await parseWithGroq(text, relayStatesRef.current)

        if (intent?.action === 'relay_control') {
          const relay = RELAY_CONFIG.find((r) => r.id === intent.relay_id)
          if (relay) {
            try {
              const result = await toggleRelay(relay.id, intent.state === 'on')
              commandResult = `${relay.name} turned ${result.isOn ? 'ON' : 'OFF'}`
            } catch {
              commandResult = `Could not reach ${relay.name} — ESP32 may be offline`
            }
          }
        } else if (intent?.action === 'all_off') {
          try {
            await Promise.all(RELAY_CONFIG.map((r) => toggleRelay(r.id, false)))
            commandResult = 'All relays turned OFF'
          } catch {
            commandResult = 'Could not reach relays — ESP32 may be offline'
          }
        } else if (intent?.action === 'status') {
          const onCount = (relayStatesRef.current || []).filter((r) => r.isOn).length
          commandResult = onCount === 0
            ? 'All systems offline'
            : `${onCount} relay${onCount > 1 ? 's' : ''} currently active`
        }
      }
    } catch { /* ignore parse errors — will still stream a friendly reply */ }

    if (!mountedRef.current) return

    // Stream conversational reply
    setPhase(IDLE_VOICE_PHASE.RESPONDING)
    setResponseText('')
    let fullResponse = ''

    try {
      for await (const delta of streamVoiceResponse(text, commandResult, relayStatesRef.current)) {
        if (!mountedRef.current) break
        fullResponse += delta
        setResponseText(fullResponse)
      }
    } catch {
      fullResponse = commandResult || 'Got it!'
      if (mountedRef.current) setResponseText(fullResponse)
    }

    // Speak response via browser TTS
    if (fullResponse) speak(fullResponse)

    activeRef.current = false
    // Auto-dismiss: longer responses stay visible longer
    resetToIdle(Math.min(4000 + fullResponse.length * 35, 9000))
  }, [resetToIdle])

  // Keep processCommand ref in sync
  processCommandRef.current = processCommand

  // ── Active listening: record command with live transcript ────────────────
  const startListening = useCallback(() => {
    if (!SR || !mountedRef.current) return
    activeRef.current = true
    clearTimeout(resetTimerRef.current)

    setPhase(IDLE_VOICE_PHASE.LISTENING)
    setLiveText('')
    setTranscript('')
    setResponseText('')
    setErrorMsg(null)

    try {
      try { cmdRecRef.current?.abort() } catch { /* ignore */ }
      const rec = new SR()
      cmdRecRef.current = rec
      rec.continuous     = false  // stops automatically after user pauses
      rec.interimResults = true   // shows words as they're spoken
      rec.lang           = 'en-US'
      rec.maxAlternatives = 1

      let finalText = ''

      rec.onresult = (e) => {
        let interim = '', final = ''
        for (const result of e.results) {
          if (result.isFinal) final += result[0].transcript
          else interim += result[0].transcript
        }
        if (mountedRef.current) setLiveText(final || interim)
        if (final) finalText = final
      }

      rec.onend = () => {
        if (!mountedRef.current) return
        const text = finalText.trim()
        if (text) {
          processCommandRef.current(text)
        } else {
          setErrorMsg('Nothing heard — say your command clearly')
          activeRef.current = false
          resetToIdle(3000)
        }
      }

      rec.onerror = (e) => {
        if (!mountedRef.current) return
        const msg = e.error === 'no-speech'   ? 'No speech detected — try again'
          : e.error === 'not-allowed'         ? 'Microphone permission denied'
          : `Mic error: ${e.error}`
        setErrorMsg(msg)
        activeRef.current = false
        resetToIdle(3000)
      }

      // Safety: auto-stop after 10 seconds (avoids draining battery)
      setTimeout(() => {
        try {
          if (cmdRecRef.current?.state !== 'inactive') cmdRecRef.current?.stop()
        } catch { /* ignore */ }
      }, 10_000)

      rec.start()
    } catch {
      if (mountedRef.current) setErrorMsg('Could not start microphone')
      activeRef.current = false
      resetToIdle(3000)
    }
  }, [resetToIdle])

  // Keep startListening ref in sync
  startListeningRef.current = startListening

  // ── Wake word detection loop (restarts automatically after each result) ──
  const startWakeLoop = useCallback(() => {
    if (!SR || !enabledRef.current || !mountedRef.current) return
    if (activeRef.current) return

    try {
      try { wakeRecRef.current?.abort() } catch { /* ignore */ }
      const rec = new SR()
      wakeRecRef.current = rec
      rec.continuous     = false
      rec.interimResults = false
      rec.lang           = 'en-US'
      rec.maxAlternatives = 5   // more alternatives → better "hey buddy" recognition

      rec.onresult = (e) => {
        if (activeRef.current) return
        const variants = Array.from(e.results[0]).map((r) => r.transcript.toLowerCase())
        const woke = variants.some((t) =>
          t.includes('hey buddy')  || t.includes('hey body')   ||
          t.includes('hey buddie') || t.includes('hey budi')   ||
          t.includes('a buddy')    || t.includes('hey but')    ||
          t.includes('hey bud')
        )
        if (woke) {
          startListeningRef.current?.()
        }
        // If not woke, onend fires and restarts the loop automatically
      }

      rec.onerror = () => {
        if (mountedRef.current && !activeRef.current) {
          setTimeout(() => startWakeLoopRef.current?.(), 1500)
        }
      }
      rec.onend = () => {
        if (mountedRef.current && !activeRef.current) {
          setTimeout(() => startWakeLoopRef.current?.(), 300)
        }
      }

      rec.start()
    } catch {
      setTimeout(() => startWakeLoopRef.current?.(), 2000)
    }
  }, []) // no deps — everything accessed via refs

  // Keep startWakeLoop ref in sync
  startWakeLoopRef.current = startWakeLoop

  // ── Start/stop detection based on enabled flag ───────────────────────────
  useEffect(() => {
    if (enabled) {
      startWakeLoopRef.current?.()
    } else {
      try { wakeRecRef.current?.abort() } catch { /* ignore */ }
      try { cmdRecRef.current?.abort()  } catch { /* ignore */ }
    }
    return () => {
      try { wakeRecRef.current?.abort() } catch { /* ignore */ }
      try { cmdRecRef.current?.abort()  } catch { /* ignore */ }
      clearTimeout(resetTimerRef.current)
      window.speechSynthesis?.cancel()
    }
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    phase,
    liveText,
    transcript,
    responseText,
    errorMsg,
    startListening,                    // can also be triggered by tapping a mic button
    supportsSpeechRecognition: !!SR,
  }
}
