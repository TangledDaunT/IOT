/**
 * useClientTimers — 100% client-side relay scheduler.
 *
 * No backend required. Every timer is:
 *   { id, relayId, action:'ON'|'OFF', fireAt: ISO string, label: string, fired: bool }
 *
 * On mount, any past-due timer whose `fired` flag is false is immediately fired once.
 * Uses a single master `setInterval` (1 s tick) rather than individual `setTimeout`
 * so all timers stay in sync even after the session wakes from sleep.
 *
 * Timers persist to localStorage across page reloads.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { toggleRelay } from '../services/relayService'
import { RELAY_CONFIG } from '../config'
import { useLog } from '../context/LogContext'
import { useToast } from '../context/ToastContext'

const LS_KEY = 'iot_client_timers'
const MAX_TIMERS = 20

// ── Persistence helpers ───────────────────────────────────────────────────
function loadTimers() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveTimers(timers) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(timers.slice(-MAX_TIMERS)))
  } catch { /* quota */ }
}

// ── Hook ──────────────────────────────────────────────────────────────────
export function useClientTimers() {
  const [timers, setTimers] = useState(loadTimers)
  const { addLog }          = useLog()
  const { toast }           = useToast()
  const timersRef           = useRef(timers)
  timersRef.current         = timers

  /** Fire a single timer — toggles the relay and marks it as done */
  const fireTimer = useCallback(async (timer) => {
    const relay = RELAY_CONFIG.find((r) => r.id === timer.relayId)
    const label = relay?.name ?? `Relay ${timer.relayId}`
    try {
      await toggleRelay(timer.relayId, timer.action === 'ON')
      toast(`Timer fired: ${label} → ${timer.action}`, 'success')
      addLog('info', 'timer', `Scheduled ${timer.action} on ${label}`, {
        relay_id: timer.relayId,
        action:   timer.action,
        label:    timer.label,
      })
    } catch (err) {
      toast(`Timer failed: ${label} — ${err.message || 'network error'}`, 'error')
      addLog('error', 'timer', `Timer execution failed for ${label}: ${err.message ?? ''}`, {
        relay_id: timer.relayId,
      })
    }

    // Mark as fired and remove after short delay so user sees it complete
    setTimers((prev) => {
      const updated = prev.map((t) =>
        t.id === timer.id ? { ...t, fired: true } : t
      )
      saveTimers(updated)
      return updated
    })

    // Auto-remove fired timer after 5 s
    setTimeout(() => {
      setTimers((prev) => {
        const updated = prev.filter((t) => t.id !== timer.id)
        saveTimers(updated)
        return updated
      })
    }, 5000)
  }, [addLog, toast])

  /** 1-second tick — checks each timer */
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now()
      timersRef.current.forEach((timer) => {
        if (!timer.fired && new Date(timer.fireAt).getTime() <= now) {
          fireTimer(timer)
        }
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [fireTimer])

  /** Schedule a new timer */
  const addTimer = useCallback(({ relayId, fireAt, action, label }) => {
    const timer = {
      id:      `tmr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      relayId: Number(relayId),
      action:  action || 'ON',
      fireAt:  new Date(fireAt).toISOString(),
      label:   label || '',
      fired:   false,
      createdAt: new Date().toISOString(),
    }
    setTimers((prev) => {
      const updated = [...prev, timer].slice(-MAX_TIMERS)
      saveTimers(updated)
      return updated
    })
    return timer
  }, [])

  /** Cancel (remove) a timer by id */
  const cancelTimer = useCallback((id) => {
    setTimers((prev) => {
      const updated = prev.filter((t) => t.id !== id)
      saveTimers(updated)
      return updated
    })
  }, [])

  /** Clear all FIRED timers */
  const clearFired = useCallback(() => {
    setTimers((prev) => {
      const updated = prev.filter((t) => !t.fired)
      saveTimers(updated)
      return updated
    })
  }, [])

  return { timers, addTimer, cancelTimer, clearFired }
}
