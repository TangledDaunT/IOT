/**
 * RelayContext — global source of truth for relay states.
 *
 * Keeps all relay on/off states in one place so the Dashboard,
 * Timer, and future pages all read from the same data.
 * Avoids prop drilling through deep component trees.
 */
import { createContext, useContext, useReducer, useCallback } from 'react'
import { RELAY_CONFIG } from '../config'

// ── Initial state built from RELAY_CONFIG ─────────────────────────────────
const buildInitialState = () => ({
  // Keyed by relay id for O(1) lookups
  relays: Object.fromEntries(
    RELAY_CONFIG.map((r) => [r.id, { ...r, isOn: false, loading: false }])
  ),
  globalLoading: false,
  lastSynced: null,
})

// ── Reducer — all mutations in one place ──────────────────────────────────
function relayReducer(state, action) {
  switch (action.type) {
    case 'SET_RELAY_LOADING':
      return {
        ...state,
        relays: {
          ...state.relays,
          [action.id]: { ...state.relays[action.id], loading: action.value },
        },
      }
    case 'SET_RELAY_STATE':
      return {
        ...state,
        relays: {
          ...state.relays,
          [action.id]: {
            ...state.relays[action.id],
            isOn: action.isOn,
            loading: false,
          },
        },
      }
    case 'SET_ALL_RELAYS': {
      // action.relays: [{ id, isOn }]
      const updated = { ...state.relays }
      action.relays.forEach(({ id, isOn }) => {
        if (updated[id]) updated[id] = { ...updated[id], isOn, loading: false }
      })
      return { ...state, relays: updated, lastSynced: Date.now() }
    }
    case 'SET_GLOBAL_LOADING':
      return { ...state, globalLoading: action.value }
    default:
      return state
  }
}

// ── Context & hook ─────────────────────────────────────────────────────────
const RelayContext = createContext(null)

export function RelayProvider({ children }) {
  const [state, dispatch] = useReducer(relayReducer, undefined, buildInitialState)

  /** Mark a single relay as toggling (shows spinner on its card) */
  const setRelayLoading = useCallback((id, value) => {
    dispatch({ type: 'SET_RELAY_LOADING', id, value })
  }, [])

  /** Update a single relay's on/off state after API responds */
  const setRelayState = useCallback((id, isOn) => {
    dispatch({ type: 'SET_RELAY_STATE', id, isOn })
  }, [])

  /** Bulk-update all relays from a /status API response */
  const setAllRelays = useCallback((relays) => {
    dispatch({ type: 'SET_ALL_RELAYS', relays })
  }, [])

  const setGlobalLoading = useCallback((value) => {
    dispatch({ type: 'SET_GLOBAL_LOADING', value })
  }, [])

  return (
    <RelayContext.Provider
      value={{ state, setRelayLoading, setRelayState, setAllRelays, setGlobalLoading }}
    >
      {children}
    </RelayContext.Provider>
  )
}

/** Consume relay context — throws if used outside provider */
export function useRelayContext() {
  const ctx = useContext(RelayContext)
  if (!ctx) throw new Error('useRelayContext must be used inside RelayProvider')
  return ctx
}
