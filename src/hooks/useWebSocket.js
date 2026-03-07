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
import { getAllDeviceStatus } from '../services/deviceService'
import { DEVICE_POLL_INTERVAL } from '../config'

export function useWebSocket() {
  const { setRelayState, setAllRelays }              = useRelayContext()
  const { recordHeartbeat, setDeviceOffline, bulkUpdateDevices, setWsConnected } = useDeviceContext()
  const { addLog }                                   = useLogContext()
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

    wsService.on('relay_update',      onRelayUpdate)
    wsService.on('initial_state',     onInitialState)
    wsService.on('device_heartbeat',  onHeartbeat)
    wsService.on('log_event',         onLogEvent)
    wsService.on('status',            onStatus)

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
      clearInterval(pollRef.current)
      // Do NOT call wsService.disconnect() here — service is singleton,
      // hot-reload would kill every reconnect. Only disconnect on explicit logout.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentional mount-once
}
