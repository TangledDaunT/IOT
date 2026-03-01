/**
 * LogContext — append-only event log for every meaningful system action.
 *
 * Each log entry:
 *   { id, ts, level:'info'|'warn'|'error', source, message, meta:{} }
 *
 * Sources: relay | timer | voice | device | scene | system | ws
 *
 * Last MAX_ENTRIES kept in localStorage so logs survive refresh.
 * Export `useLog()` to add entries; `useLogContext()` to read state.
 */
import { createContext, useContext, useReducer, useCallback, useRef } from 'react'

const MAX_ENTRIES = 200
const LS_KEY      = 'iot_event_log'

// ── Helpers ───────────────────────────────────────────────────────────────
let _seq = 0
function makeId() {
  return `log-${Date.now()}-${++_seq}`
}

function loadFromLS() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToLS(entries) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    // storage full — ignore
  }
}

// ── Reducer ───────────────────────────────────────────────────────────────
function logReducer(state, action) {
  switch (action.type) {
    case 'ADD': {
      const entries = [action.entry, ...state.entries].slice(0, MAX_ENTRIES)
      return { ...state, entries }
    }
    case 'CLEAR':
      return { ...state, entries: [] }
    default:
      return state
  }
}

// ── Context ───────────────────────────────────────────────────────────────
const LogContext = createContext(null)

export function LogProvider({ children }) {
  const [state, dispatch] = useReducer(logReducer, undefined, () => ({
    entries: loadFromLS(),
  }))

  // Persist whenever entries change — debounced via ref
  const saveTimer = useRef(null)
  const persistRef = useRef(state.entries)
  persistRef.current = state.entries

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveToLS(persistRef.current), 500)
  }, [])

  const addLog = useCallback(
    (level, source, message, meta = {}) => {
      const entry = { id: makeId(), ts: Date.now(), level, source, message, meta }
      dispatch({ type: 'ADD', entry })
      scheduleSave()
      return entry
    },
    [scheduleSave]
  )

  const clearLogs = useCallback(() => {
    dispatch({ type: 'CLEAR' })
    localStorage.removeItem(LS_KEY)
  }, [])

  return (
    <LogContext.Provider value={{ state, addLog, clearLogs }}>
      {children}
    </LogContext.Provider>
  )
}

export function useLogContext() {
  const ctx = useContext(LogContext)
  if (!ctx) throw new Error('useLogContext must be used inside LogProvider')
  return ctx
}

/** Convenience hook — just addLog + clearLogs */
export function useLog() {
  const { addLog, clearLogs } = useLogContext()
  return { addLog, clearLogs }
}
