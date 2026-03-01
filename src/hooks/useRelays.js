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
import { getRelayStatus, toggleRelay } from '../services/relayService'
import { POLL_INTERVAL } from '../config'

export function useRelays() {
  const { state, setRelayLoading, setRelayState, setAllRelays, setGlobalLoading } =
    useRelayContext()
  const { toast } = useToast()
  const { setRobotExpression } = useRobot()
  const pollRef = useRef(null)

  /** Fetch all relay states from backend and sync to context */
  const fetchStatus = useCallback(async () => {
    setGlobalLoading(true)
    try {
      const relays = await getRelayStatus()
      setAllRelays(relays)
    } catch (err) {
      toast(err.message || 'Failed to fetch relay status', 'error')
      setRobotExpression(EXPRESSIONS.ERROR, 'Cannot reach device', 3000)
    } finally {
      setGlobalLoading(false)
    }
  }, [setAllRelays, setGlobalLoading, toast, setRobotExpression])

  /**
   * Toggle a relay.
   * Optimistic UI: update state immediately, revert if API fails.
   */
  const handleToggle = useCallback(
    async (id, currentIsOn) => {
      const nextState = !currentIsOn
      setRelayLoading(id, true)
      setRobotExpression(EXPRESSIONS.THINKING, 'Sending command…', 0)

      // Optimistic update
      setRelayState(id, nextState)

      try {
        const result = await toggleRelay(id, nextState)
        setRelayState(id, result.isOn)
        setRobotExpression(
          EXPRESSIONS.SUCCESS,
          result.isOn ? 'Relay ON!' : 'Relay OFF',
          2500
        )
        toast(`Relay ${id} turned ${result.isOn ? 'ON' : 'OFF'}`, 'success')
      } catch (err) {
        // Revert optimistic update on failure
        setRelayState(id, currentIsOn)
        toast(err.message || 'Toggle failed', 'error')
        setRobotExpression(EXPRESSIONS.ERROR, 'Command failed!', 3000)
      }
    },
    [setRelayLoading, setRelayState, toast, setRobotExpression]
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
