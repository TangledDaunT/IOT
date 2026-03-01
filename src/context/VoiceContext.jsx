/**
 * VoiceContext — state machine for voice command sessions.
 *
 * States:
 *   idle       → default, waiting for tap
 *   recording  → mic open, capturing audio
 *   processing → sending to STT, parsing intent
 *   executing  → relay command being sent
 *   error      → something failed, auto-returns to idle
 *
 * Settings (persisted to localStorage):
 *   enabled    → master voice switch
 *   ttsEnabled → speak results via SpeechSynthesis
 *   mockStt    → simulate STT without real microphone
 */
import { createContext, useContext, useReducer, useCallback } from 'react'

export const VOICE_STATES = {
  IDLE:       'idle',
  RECORDING:  'recording',
  PROCESSING: 'processing',
  EXECUTING:  'executing',
  ERROR:      'error',
}

// ─── localStorage keys ────────────────────────────────────────────────────
const LS = {
  ENABLED: 'iot_voice_enabled',
  TTS:     'iot_voice_tts',
  MOCK:    'iot_voice_mock_stt',
  HIST:    'iot_voice_history',
}

function readSettings() {
  return {
    enabled:    localStorage.getItem(LS.ENABLED) !== 'false',
    ttsEnabled: localStorage.getItem(LS.TTS)     !== 'false',
    mockStt:    localStorage.getItem(LS.MOCK)    === 'true',
  }
}

function readHistory() {
  try { return JSON.parse(localStorage.getItem(LS.HIST) || '[]') } catch { return [] }
}

// ─── Initial state ─────────────────────────────────────────────────────────
const INITIAL = {
  voiceState:     VOICE_STATES.IDLE,
  transcript:     '',
  result:         '',
  error:          '',
  commandHistory: readHistory(),
  settings:       readSettings(),
  micPermission:  'unknown', // 'unknown' | 'granted' | 'denied'
  latency:        { sttMs: null, parseMs: null, execMs: null },
}

// ─── Reducer ───────────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {
    case 'SET_STATE':
      return {
        ...state,
        voiceState: action.value,
        // Auto-clear error when leaving error state
        ...(action.value !== VOICE_STATES.ERROR && { error: '' }),
      }
    case 'SET_TRANSCRIPT': return { ...state, transcript: action.value }
    case 'SET_RESULT':     return { ...state, result: action.value }
    case 'SET_ERROR':      return { ...state, voiceState: VOICE_STATES.ERROR, error: action.value }
    case 'SET_LATENCY':    return { ...state, latency: { ...state.latency, ...action.partial } }
    case 'SET_MIC_PERM':   return { ...state, micPermission: action.value }
    case 'ADD_HISTORY': {
      const history = [action.entry, ...state.commandHistory].slice(0, 5)
      try { localStorage.setItem(LS.HIST, JSON.stringify(history)) } catch { /* quota */ }
      return { ...state, commandHistory: history }
    }
    case 'SET_SETTINGS': {
      const settings = { ...state.settings, ...action.partial }
      if ('enabled'    in action.partial) localStorage.setItem(LS.ENABLED, String(action.partial.enabled))
      if ('ttsEnabled' in action.partial) localStorage.setItem(LS.TTS,     String(action.partial.ttsEnabled))
      if ('mockStt'    in action.partial) localStorage.setItem(LS.MOCK,    String(action.partial.mockStt))
      return { ...state, settings }
    }
    default: return state
  }
}

// ─── Context ───────────────────────────────────────────────────────────────
const VoiceContext = createContext(null)

export function VoiceProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, INITIAL)

  const setState         = useCallback((value)   => dispatch({ type: 'SET_STATE',      value }),   [])
  const setTranscript    = useCallback((value)   => dispatch({ type: 'SET_TRANSCRIPT',  value }),   [])
  const setResult        = useCallback((value)   => dispatch({ type: 'SET_RESULT',      value }),   [])
  const setError         = useCallback((value)   => dispatch({ type: 'SET_ERROR',       value }),   [])
  const setLatency       = useCallback((partial) => dispatch({ type: 'SET_LATENCY',     partial }), [])
  const setMicPermission = useCallback((value)   => dispatch({ type: 'SET_MIC_PERM',    value }),   [])
  const addHistory       = useCallback((entry)   => dispatch({ type: 'ADD_HISTORY',     entry }),   [])
  const setSettings      = useCallback((partial) => dispatch({ type: 'SET_SETTINGS',    partial }), [])

  return (
    <VoiceContext.Provider
      value={{ ...state, setState, setTranscript, setResult, setError, setLatency, setMicPermission, addHistory, setSettings }}
    >
      {children}
    </VoiceContext.Provider>
  )
}

export function useVoice() {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error('useVoice must be used inside VoiceProvider')
  return ctx
}
