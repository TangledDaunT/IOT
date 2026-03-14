/**
 * useWebSocket — mounts the WebSocket service and wires events to contexts.
 *
 * Call ONCE at the top of the component tree (wrapped in Layout or App).
 *
 * WS events handled:
 *   relay_update      → RelayContext.setRelayState
 *   initial_state     → RelayContext.setAllRelays (ESP32 sends on connect)
 *   device_heartbeat  → DeviceContext.recordHeartbeat / setDeviceOffline
 *   log_event         → LogContext.addLog
 *   status            → DeviceContext.setWsConnected
 */
import { useEffect, useRef } from 'react'
import { wsService } from '../services/wsService'
import { getBaseUrl } from '../config'
import { useRelayContext } from '../context/RelayContext'
import { useDeviceContext } from '../context/DeviceContext'
import { useLogContext } from '../context/LogContext'
import { useSmoke } from '../context/SmokeContext'
import { getAllDeviceStatus } from '../services/deviceService'
import { DEVICE_POLL_INTERVAL } from '../config'
import { useRobot, EXPRESSIONS } from '../context/RobotContext'
import { useToast } from '../context/ToastContext'

export function useWebSocket() {
  const { setRelayState, setAllRelays }              = useRelayContext()
  const { recordHeartbeat, setDeviceOffline, bulkUpdateDevices, setWsConnected } = useDeviceContext()
  const { addLog }                                   = useLogContext()
  const { setTelemetry, ingestSmokeEvent } = useSmoke()
  const { setRobotExpression } = useRobot()
  const { toast } = useToast()
  const pollRef   = useRef(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (mountedRef.current) return   // strict-mode double-invoke guard
    mountedRef.current = true

    // ── Wire event listeners ─────────────────────────────────────────
    const onRelayUpdate = ({ id, isOn }) => {
      setRelayState(id, isOn)
      addLog('info', 'ws', `Relay ${id} → ${isOn ? 'ON' : 'OFF'} (real-time sync)`, { relay_id: id, isOn })
    }

    // ESP32 sends initial_state with all relay states on WebSocket connect
    const onInitialState = ({ relays }) => {
      if (Array.isArray(relays)) {
        setAllRelays(relays)
        addLog('info', 'ws', `Synced ${relays.length} relays from ESP32`, {})
      }
    }

    const onHeartbeat = (payload) => {
      if (payload.online === false) {
        setDeviceOffline(payload.id)
        addLog('warn', 'device', `${payload.id} went offline`, { id: payload.id })
      } else {
        recordHeartbeat(payload.id, payload)
      }
    }

    const onLogEvent = ({ level, source, message, meta }) => {
      addLog(level ?? 'info', source ?? 'system', message ?? '', meta ?? {})
    }

    const onStatus = ({ connected }) => {
      setWsConnected(connected)
      addLog(
        connected ? 'info' : 'warn',
        'ws',
        connected ? 'WebSocket connected' : 'WebSocket disconnected'
      )
    }

    const onSmokeTelemetry = (payload) => {
      setTelemetry(payload)
      recordHeartbeat('esp32-01', {
        phase: payload?.phase,
        sensorHealthy: payload?.sensorHealthy,
        airQualityAvg5mReady: payload?.airQualityAvg5mReady,
      })
    }

    const onAirQualityAverage = (payload) => {
      setTelemetry({
        airQualityAvg5m: payload?.airQualityAvg5m,
        airQualityAvg5mReady: payload?.airQualityAvg5mReady,
        samplesInWindow: payload?.samplesInWindow,
        windowMs: payload?.windowMs,
      })
    }

    const onSmokeEvent = async (payload) => {
      const eventType = payload?.eventType ?? payload?.event_type ?? 'unknown'
      addLog('info', 'smoke', `Smoke event: ${eventType}`, payload ?? {})

      if (eventType === 'smoke_detected') {
        toast('Smoke detected. Fan automation engaged.', 'warn')
        setRobotExpression(EXPRESSIONS.THINKING, 'Smoke detected', 3000)
      } else if (eventType === 'smoke_cleared') {
        setRobotExpression(EXPRESSIONS.SUCCESS, 'Air clearing', 2500)
      } else if (eventType === 'cigarette_episode_closed') {
        const result = await ingestSmokeEvent(payload)
        if (result?.counted) {
          addLog('info', 'smoke', 'cigarette_count_incremented', {
            episode_id: payload?.episodeId ?? payload?.episode_id,
            day_key: result.dayKey,
          })

          if (result.syncResult?.failed > 0 || result.syncResult?.pending > 0) {
            addLog('warn', 'openclaw', 'openclaw_sync_success_or_failure', {
              status: 'pending_or_failed',
              pending: result.syncResult?.pending ?? 0,
              failed: result.syncResult?.failed ?? 0,
            })
          } else {
            addLog('info', 'openclaw', 'openclaw_sync_success_or_failure', {
              status: 'synced',
            })
          }
        }
      }
    }

    wsService.on('relay_update',      onRelayUpdate)
    wsService.on('initial_state',     onInitialState)
    wsService.on('device_heartbeat',  onHeartbeat)
    wsService.on('log_event',         onLogEvent)
    wsService.on('status',            onStatus)
    wsService.on('smoke_telemetry',   onSmokeTelemetry)
    wsService.on('smoke_event',       onSmokeEvent)
    wsService.on('air_quality_average', onAirQualityAverage)

    // ── Connect ──────────────────────────────────────────────────────
    wsService.connect(getBaseUrl())

    // ── Log startup ──────────────────────────────────────────────────
    addLog('info', 'system', 'IoT Control Platform started')

    // ── Initial REST device poll + recurring fallback ─────────────────
    const pollDevices = async () => {
      try {
        const devices = await getAllDeviceStatus()
        bulkUpdateDevices(devices)
      } catch { /* device poll failed - will retry */ }
    }

    pollDevices()
    if (DEVICE_POLL_INTERVAL) {
      pollRef.current = setInterval(pollDevices, DEVICE_POLL_INTERVAL)
    }

    return () => {
      wsService.off('relay_update',     onRelayUpdate)
      wsService.off('initial_state',    onInitialState)
      wsService.off('device_heartbeat', onHeartbeat)
      wsService.off('log_event',        onLogEvent)
      wsService.off('status',           onStatus)
      wsService.off('smoke_telemetry',  onSmokeTelemetry)
      wsService.off('smoke_event',      onSmokeEvent)
      wsService.off('air_quality_average', onAirQualityAverage)
      clearInterval(pollRef.current)
      // Do NOT call wsService.disconnect() here — service is singleton,
      // hot-reload would kill every reconnect. Only disconnect on explicit logout.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentional mount-once
}
