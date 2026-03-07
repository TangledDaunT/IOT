/**
 * useRelays — orchestrates relay data fetching and toggling.
 *
 * Encapsulates: polling, loading states, error handling,
 * and robot face updates triggered by relay events.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useRelayContext } from '../context/RelayContext'
import { useToast } from '../context/ToastContext'
import { useRobot } from '../context/RobotContext'
import { EXPRESSIONS } from '../context/RobotContext'
import { useLog } from '../context/LogContext'
import { getRelayStatus, toggleRelay } from '../services/relayService'
import { POLL_INTERVAL, RELAY_CONFIG } from '../config'

export function useRelays() {
  const { state, setRelayLoading, setRelayState, setRelayOptimistic, setAllRelays, setGlobalLoading } =
    useRelayContext()
  const { toast } = useToast()
  const { setRobotExpression } = useRobot()
  const { addLog } = useLog()
  const pollRef = useRef(null)
  // Track in-flight relay IDs to prevent double-tap race conditions
  const inflightRef = useRef(new Set())

  /** Fetch all relay states from backend and sync to context */
  const fetchStatus = useCallback(async () => {
    setGlobalLoading(true)
    try {
      const relays = await getRelayStatus()
      setAllRelays(relays)
    } catch (err) {
      toast(err.message || 'Failed to fetch relay status', 'error')
      setRobotExpression(EXPRESSIONS.ERROR, 'Cannot reach device', 3000)
      addLog('error', 'relay', `Status fetch failed: ${err.message ?? 'network error'}`)
    } finally {
      setGlobalLoading(false)
    }
  }, [setAllRelays, setGlobalLoading, toast, setRobotExpression, addLog])

  /**
   * Toggle a relay.
   * Optimistic UI: update state immediately, revert if API fails.
   */
  const handleToggle = useCallback(
    async (id, currentIsOn) => {
      // Guard: ignore if this relay already has an in-flight API call
      if (inflightRef.current.has(id)) return
      inflightRef.current.add(id)

      const nextState = !currentIsOn
      setRobotExpression(EXPRESSIONS.THINKING, 'Sending command…', 0)

      // Optimistic update: show new state immediately, keep loading spinner
      setRelayOptimistic(id, nextState)

      try {
        const result = await toggleRelay(id, nextState)
        setRelayState(id, result.isOn)
        setRobotExpression(
          EXPRESSIONS.SUCCESS,
          result.isOn ? 'Relay ON!' : 'Relay OFF',
          2500
        )
        const relayName = RELAY_CONFIG.find((r) => r.id === id)?.name ?? `Relay ${id}`
        toast(`${relayName} turned ${result.isOn ? 'ON' : 'OFF'}`, 'success')
        addLog('info', 'relay', `${relayName} → ${result.isOn ? 'ON' : 'OFF'} (manual)`, { relay_id: id, isOn: result.isOn, source: 'manual' })
      } catch (err) {
        // Revert optimistic update on failure
        setRelayState(id, currentIsOn)
        toast(err.message || 'Toggle failed', 'error')
        setRobotExpression(EXPRESSIONS.ERROR, 'Command failed!', 3000)
        addLog('error', 'relay', `Toggle failed for relay ${id}: ${err.message ?? 'unknown'}`, { relay_id: id })
      } finally {
        inflightRef.current.delete(id)
      }
    },
    [setRelayOptimistic, setRelayState, toast, setRobotExpression, addLog]
  )

  // Initial fetch on mount
  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Optional periodic polling
  useEffect(() => {
    if (!POLL_INTERVAL) return
    pollRef.current = setInterval(fetchStatus, POLL_INTERVAL)
    return () => clearInterval(pollRef.current)
  }, [fetchStatus])

  return {
    relays: Object.values(state.relays),
    globalLoading: state.globalLoading,
    lastSynced: state.lastSynced,
    handleToggle,
    refresh: fetchStatus,
  }
}
