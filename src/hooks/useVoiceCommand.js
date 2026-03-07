/**
 * useVoiceCommand — orchestrates the full voice pipeline:
 *
 *   Mic tap → record → STT → rule-based parser → relay API → TTS feedback
 *
 * Architecture:
 *   Rule-based parsing runs first (zero latency, zero AI cost).
 *   If parsing fails, error is shown — future enhancement can escalate to LLM.
 *
 * Command history: last 5 commands stored in localStorage via VoiceContext.
 */
import { useCallback, useRef } from 'react'
import { VOICE_STATES, useVoice } from '../context/VoiceContext'
import { useRelayContext } from '../context/RelayContext'
import { useRobot, EXPRESSIONS } from '../context/RobotContext'
import { useToast } from '../context/ToastContext'
import { toggleRelay } from '../services/relayService'
import { startRecording, requestMicPermission, mockTranscribe } from '../services/voiceService'
import { parseWithGroq, isGroqConfigured, transcribeWithGroq } from '../services/groqService'
import { RELAY_CONFIG, MOCK_MODE } from '../config'

// ─── Relay name → id alias map ─────────────────────────────────────────────
// Built dynamically from RELAY_CONFIG so adding relays in config is enough.
const RELAY_ALIASES = {}
RELAY_CONFIG.forEach((r) => {
  const name = r.name.toLowerCase()
  RELAY_ALIASES[name]        = r.id          // full name  e.g. "main lights"
  RELAY_ALIASES[String(r.id)] = r.id          // numeric    e.g. "1"
  name.split(/\s+/).forEach((word) => {
    if (word.length > 2) RELAY_ALIASES[word] = r.id // last/first word e.g. "lights", "fan"
  })
})

// ─── Rule-based intent parser ──────────────────────────────────────────────
function parseIntent(text) {
  const t = text.toLowerCase().trim()

  // "turn on relay 1" / "turn off relay 2"
  let m = t.match(/\bturn\s+(on|off)\s+relay\s*(\d+)/)
  if (m) return { action: 'relay_control', relay_id: +m[2], state: m[1] }

  // "relay 1 on" / "relay 3 off"
  m = t.match(/\brelay\s*(\d+)\s+(on|off)/)
  if (m) return { action: 'relay_control', relay_id: +m[1], state: m[2] }

  // "switch relay 2 on"
  m = t.match(/\bswitch\s+relay\s*(\d+)\s+(on|off)/)
  if (m) return { action: 'relay_control', relay_id: +m[1], state: m[2] }

  // "turn on lights" / "turn off the fan" — try longest alias match
  m = t.match(/\bturn\s+(on|off)\s+(?:the\s+)?([\w\s]+?)(?:\s*(?:please|now|$))/)
  if (m) {
    const segs = m[2].trim().split(/\s+/)
    for (let len = segs.length; len > 0; len--) {
      const candidate = segs.slice(segs.length - len).join(' ')
      if (RELAY_ALIASES[candidate] !== undefined) {
        return { action: 'relay_control', relay_id: RELAY_ALIASES[candidate], state: m[1] }
      }
    }
  }

  // "lights on" / "pump off"
  m = t.match(/\b([\w\s]+?)\s+(on|off)\s*$/)
  if (m) {
    const segs = m[1].trim().split(/\s+/)
    for (let len = segs.length; len > 0; len--) {
      const candidate = segs.slice(segs.length - len).join(' ')
      if (RELAY_ALIASES[candidate] !== undefined) {
        return { action: 'relay_control', relay_id: RELAY_ALIASES[candidate], state: m[2] }
      }
    }
  }

  // "all off" / "turn off everything"
  if (/\b(all\s*off|turn\s+off\s+all|everything\s+off|all\s+relays?\s+off)\b/.test(t)) {
    return { action: 'all_off' }
  }

  // "status" / "what's on"
  if (/\b(status|what.?s\s+on|report|show)\b/.test(t)) {
    return { action: 'status' }
  }

  return null
}

// ─── TTS helper ────────────────────────────────────────────────────────────
function speak(text, enabled) {
  if (!enabled) return
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate   = 1.05
    u.pitch  = 1.0
    u.volume = 0.85
    synth.speak(u)
  } catch { /* not available on this browser */ }
}

// ─── Test commands for mock STT mode ──────────────────────────────────────
export const MOCK_STT_COMMANDS = [
  'Turn on relay 1',
  'Turn off relay 2',
  'Relay 3 on',
  'Relay 4 off',
  'All off',
  'Turn on lights',
  'Fan off',
  'Status',
]

// ─── Main hook ──────────────────────────────────────────────────────────────
export function useVoiceCommand() {
  const voice              = useVoice()
  const { state: relayCtxState, setRelayState }  = useRelayContext()
  const { setRobotExpression } = useRobot()
  const { toast }          = useToast()
  const stopRef            = useRef(null)   // () => Promise<Blob>
  const timerRef           = useRef(null)   // auto-stop timer

  // ── Execute a successfully parsed command ─────────────────────────────
  const executeCommand = useCallback(async (command, transcript) => {
    voice.setState(VOICE_STATES.EXECUTING)
    const execStart = Date.now()

    try {
      if (command.action === 'relay_control') {
        const relay = RELAY_CONFIG.find((r) => r.id === command.relay_id)
        if (!relay) throw new Error(`Relay ${command.relay_id} not found`)

        const result = await toggleRelay(relay.id, command.state === 'on')
        setRelayState(relay.id, result.isOn)
        voice.setLatency({ execMs: Date.now() - execStart })

        const msg = `Relay ${relay.id} ${result.isOn ? 'ON' : 'OFF'}`
        voice.setResult(msg)
        speak(msg, voice.settings.ttsEnabled)
        setRobotExpression(EXPRESSIONS.SUCCESS, msg, 2500)
        toast(msg, 'success')
        voice.addHistory({ transcript, parsed: command, result: msg, ts: Date.now() })

      } else if (command.action === 'all_off') {
        await Promise.all(
          RELAY_CONFIG.map((r) =>
            toggleRelay(r.id, false).then((res) => setRelayState(r.id, res.isOn))
          )
        )
        voice.setLatency({ execMs: Date.now() - execStart })
        const msg = 'All relays OFF'
        voice.setResult(msg)
        speak(msg, voice.settings.ttsEnabled)
        setRobotExpression(EXPRESSIONS.SUCCESS, msg, 2500)
        toast(msg, 'success')
        voice.addHistory({ transcript, parsed: command, result: msg, ts: Date.now() })

      } else if (command.action === 'status') {
        // Build a spoken status summary from current relay context
        const relays     = Object.values(relayCtxState.relays)
        const onRelays   = relays.filter((r) => r.isOn).map((r) => r.name)
        const msg = onRelays.length === 0
          ? 'All systems offline. All relays are off.'
          : `${onRelays.length} relay${onRelays.length > 1 ? 's' : ''} active: ${onRelays.join(', ')}.`
        voice.setResult(msg)
        speak(msg, voice.settings.ttsEnabled)
        setRobotExpression(EXPRESSIONS.HAPPY, 'Status OK', 2500)
      }

      setTimeout(() => voice.setState(VOICE_STATES.IDLE), 1600)
    } catch (e) {
      voice.setError(e.message || 'Execution failed')
      speak('Command failed', voice.settings.ttsEnabled)
      setRobotExpression(EXPRESSIONS.ERROR, 'Failed!', 3000)
      setTimeout(() => voice.setState(VOICE_STATES.IDLE), 3000)
    }
  }, [voice, setRelayState, relayCtxState, setRobotExpression, toast])

  // ── Parse transcript and run intent ──────────────────────────────────
  const processTranscript = useCallback(async (transcript) => {
    voice.setTranscript(transcript)
    const parseStart = Date.now()

    let command = null

    // Try Groq NLP first if configured (more flexible natural language understanding)
    if (isGroqConfigured()) {
      try {
        const relayStates = Object.values(relayCtxState.relays).map((r) => ({ id: r.id, isOn: r.isOn }))
        command = await parseWithGroq(transcript, relayStates)
      } catch {
        // Groq failed — will fall through to rule-based
      }
    }

    // Fallback to rule-based parser
    if (!command) {
      command = parseIntent(transcript)
    }

    voice.setLatency({ parseMs: Date.now() - parseStart })

    if (!command || command.action === 'unknown') {
      const reason = command?.reason ?? transcript.slice(0, 36)
      const msg = `Not recognized: "${reason}"`
      voice.setError(msg)
      speak('Command not recognized', voice.settings.ttsEnabled)
      setRobotExpression(EXPRESSIONS.ERROR, 'Huh?', 2500)
      toast('Voice: command not recognized', 'warn')
      setTimeout(() => voice.setState(VOICE_STATES.IDLE), 2500)
      return
    }

    await executeCommand(command, transcript)
  }, [voice, executeCommand, relayCtxState, setRobotExpression, toast])

  // ── Start recording (real mic or mock simulation) ─────────────────────
  const startVoice = useCallback(async (mockText) => {
    if (!voice.settings.enabled) return

    // Check mic permission for real recording
    if (!mockText && voice.micPermission !== 'granted') {
      const perm = await requestMicPermission()
      voice.setMicPermission(perm)
      if (perm === 'denied') {
        voice.setError('Microphone permission denied — grant in browser settings')
        speak('Microphone access denied', voice.settings.ttsEnabled)
        setRobotExpression(EXPRESSIONS.ERROR, 'No mic!', 3000)
        setTimeout(() => voice.setState(VOICE_STATES.IDLE), 3000)
        return
      }
    }

    voice.setState(VOICE_STATES.RECORDING)
    setRobotExpression(EXPRESSIONS.LOADING, 'Listening…', 0)

    // ── Mock / test mode: skip real mic ───────────────────────────────
    const useMock = mockText || (MOCK_MODE && voice.settings.mockStt)
    if (useMock) {
      const sentence =
        typeof mockText === 'string'
          ? mockText
          : MOCK_STT_COMMANDS[Math.floor(Math.random() * MOCK_STT_COMMANDS.length)]

      timerRef.current = setTimeout(async () => {
        voice.setState(VOICE_STATES.PROCESSING)
        setRobotExpression(EXPRESSIONS.THINKING, 'Processing…', 0)
        const sttStart   = Date.now()
        const transcript = await mockTranscribe(sentence)
        voice.setLatency({ sttMs: Date.now() - sttStart })
        await processTranscript(transcript)
      }, 1600)
      return
    }

    // ── Live mode: real MediaRecorder ─────────────────────────────────
    try {
      const stop = await startRecording()
      stopRef.current = stop
      // Safety: auto-stop after 8s to protect J6 CPU and bandwidth
      timerRef.current = setTimeout(() => stopVoice(), 8000)
    } catch {
      voice.setError('Could not open microphone')
      voice.setMicPermission('denied')
      setRobotExpression(EXPRESSIONS.ERROR, 'Mic error!', 3000)
      setTimeout(() => voice.setState(VOICE_STATES.IDLE), 3000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, processTranscript, setRobotExpression])

  // ── Stop recording and ship to STT ────────────────────────────────────
  const stopVoice = useCallback(async () => {
    clearTimeout(timerRef.current)
    if (!stopRef.current) return

    voice.setState(VOICE_STATES.PROCESSING)
    setRobotExpression(EXPRESSIONS.THINKING, 'Processing…', 0)

    const sttStart = Date.now()
    try {
      const blob       = await stopRef.current()
      stopRef.current  = null
      const transcript = await transcribeWithGroq(blob)
      voice.setLatency({ sttMs: Date.now() - sttStart })
      await processTranscript(transcript)
    } catch (e) {
      const isTimeout = e.message?.includes('abort') || e.name === 'AbortError'
      voice.setError(isTimeout ? 'STT request timed out' : 'Transcription failed')
      speak('Could not process audio', voice.settings.ttsEnabled)
      setRobotExpression(EXPRESSIONS.ERROR, 'Audio error', 3000)
      setTimeout(() => voice.setState(VOICE_STATES.IDLE), 3000)
    }
  }, [voice, processTranscript, setRobotExpression])

  // ── Tap handler for mic button ─────────────────────────────────────────
  const handleMicTap = useCallback(async (mockText) => {
    const s = voice.voiceState
    if (s === VOICE_STATES.IDLE || s === VOICE_STATES.ERROR) {
      await startVoice(mockText)
    } else if (s === VOICE_STATES.RECORDING) {
      await stopVoice()
    }
    // Ignore taps during PROCESSING / EXECUTING (avoid double-submit)
  }, [voice.voiceState, startVoice, stopVoice])

  return {
    voiceState:       voice.voiceState,
    transcript:       voice.transcript,
    result:           voice.result,
    error:            voice.error,
    latency:          voice.latency,
    commandHistory:   voice.commandHistory,
    settings:         voice.settings,
    micPermission:    voice.micPermission,
    handleMicTap,
    startVoice,
    setSettings:      voice.setSettings,
    setMicPermission: voice.setMicPermission,
  }
}
