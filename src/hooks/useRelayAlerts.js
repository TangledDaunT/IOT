/**
 * useRelayAlerts — proactive relay on-duration monitoring.
 *
 * Polls every 30 s. If any relay has been ON continuously for >= ALERT_THRESHOLD_MS,
 * fires a toast + robot expression warning. Re-alerts every REPEAT_INTERVAL_MS
 * to avoid spamming.
 *
 * Relay ON-start timestamps are tracked in a ref (lost on page reload — intentional,
 * since relay state is re-fetched from device on boot).
 */
import { useEffect, useRef, useCallback } from 'react'
import { useRelayContext } from '../context/RelayContext'
import { useToast } from '../context/ToastContext'
import { useRobot, EXPRESSIONS } from '../context/RobotContext'
import { RELAY_CONFIG } from '../config'

const POLL_MS            = 30_000  // check every 30 s
const ALERT_THRESHOLD_MS = 2 * 60 * 60 * 1000  // 2 hours
const REPEAT_INTERVAL_MS = 30 * 60 * 1000      // re-alert every 30 min per relay

export function useRelayAlerts() {
  const { state } = useRelayContext()
  const { addToast } = useToast()
  const { setRobotExpression } = useRobot()

  // Track when each relay turned ON: { [relayId]: timestamp }
  const onSinceRef  = useRef({})
  // Track last alert time per relay to avoid spam: { [relayId]: timestamp }
  const lastAlertRef = useRef({})

  // Sync onSince when relay state changes
  const prevRelaysRef = useRef({})
  useEffect(() => {
    const relays = state?.relays ?? {}
    const prev   = prevRelaysRef.current

    Object.entries(relays).forEach(([id, r]) => {
      const wasOn  = prev[id]?.isOn
      const isOn   = r.isOn

      if (!wasOn && isOn) {
        // Just turned on — record start time
        onSinceRef.current[id] = Date.now()
        delete lastAlertRef.current[id]
      } else if (wasOn && !isOn) {
        // Turned off — clear tracking
        delete onSinceRef.current[id]
        delete lastAlertRef.current[id]
      }
    })

    prevRelaysRef.current = relays
  }, [state])

  const checkAlerts = useCallback(() => {
    const now = Date.now()
    const onSince   = onSinceRef.current
    const lastAlert = lastAlertRef.current

    Object.entries(onSince).forEach(([id, since]) => {
      const duration = now - since
      if (duration < ALERT_THRESHOLD_MS) return

      // Check if we already alerted recently for this relay
      const lastAlertTime = lastAlert[id] ?? 0
      if (now - lastAlertTime < REPEAT_INTERVAL_MS) return

      // Emit alert
      const config = RELAY_CONFIG.find((r) => String(r.id) === String(id))
      const label  = config?.label ?? `Relay ${id}`
      const hours  = Math.floor(duration / 3_600_000)
      const mins   = Math.floor((duration % 3_600_000) / 60_000)
      const timeStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`

      addToast(`${label} has been ON for ${timeStr}`, 'warning')
      setRobotExpression(EXPRESSIONS.ERROR, `${label} on for ${timeStr}`, 5000)

      lastAlert[id] = now
    })
  }, [addToast, setRobotExpression])

  useEffect(() => {
    const id = setInterval(checkAlerts, POLL_MS)
    return () => clearInterval(id)
  }, [checkAlerts])
}
