/**
 * DeviceContext — source of truth for ESP32 device health.
 *
 * Tracks per-device: online status, last heartbeat timestamp,
 * WiFi RSSI, uptime seconds, firmware version, IP address.
 *
 * Populated by:
 *   - REST poll via deviceService (fallback / initial load)
 *   - WebSocket 'device_heartbeat' events (real-time)
 */
import { createContext, useContext, useReducer, useCallback } from 'react'
import { DEVICE_CONFIG } from '../config'

// ── Initial state ─────────────────────────────────────────────────────────
const buildInitialState = () => ({
  devices: Object.fromEntries(
    DEVICE_CONFIG.map((d) => [
      d.id,
      {
        id:            d.id,
        name:          d.name,
        room:          d.room,
        relays:        d.relays,
        online:        false,
        lastHeartbeat: null,   // epoch ms
        rssi:          null,   // dBm
        uptime:        null,   // seconds
        firmware:      null,   // semver string
        ip:            null,   // local IP
        wifi:          null,
        mqtt:          null,
        mqttState:     null,
        phase:         null,
        airQualityAvg5mReady: false,
        sensorHealthy: true,
      },
    ])
  ),
  wsConnected: false,      // live WS connection present?
  lastPolled:  null,       // epoch ms of last REST poll
})

// ── Reducer ───────────────────────────────────────────────────────────────
function deviceReducer(state, action) {
  switch (action.type) {
    case 'HEARTBEAT': {
      const prev = state.devices[action.id]
      if (!prev) return state
      return {
        ...state,
        devices: {
          ...state.devices,
          [action.id]: {
            ...prev,
            online:        true,
            lastHeartbeat: Date.now(),
            rssi:          action.rssi    ?? prev.rssi,
            uptime:        action.uptime  ?? prev.uptime,
            firmware:      action.firmware ?? prev.firmware,
            ip:            action.ip      ?? prev.ip,
            wifi:          action.wifi ?? prev.wifi,
            mqtt:          action.mqtt ?? prev.mqtt,
            mqttState:     action.mqttState ?? prev.mqttState,
            phase:         action.phase ?? prev.phase,
            airQualityAvg5mReady: action.airQualityAvg5mReady ?? prev.airQualityAvg5mReady,
            sensorHealthy: action.sensorHealthy ?? prev.sensorHealthy,
          },
        },
      }
    }
    case 'SET_OFFLINE': {
      const prev = state.devices[action.id]
      if (!prev) return state
      return {
        ...state,
        devices: {
          ...state.devices,
          [action.id]: { ...prev, online: false },
        },
      }
    }
    case 'BULK_UPDATE': {
      // action.devices: array of heartbeat-shaped objects
      const updated = { ...state.devices }
      action.devices.forEach((d) => {
        if (updated[d.id]) {
          updated[d.id] = {
            ...updated[d.id],
            online:        d.online ?? updated[d.id].online,
            lastHeartbeat: d.online ? (d.lastHeartbeat ?? Date.now()) : updated[d.id].lastHeartbeat,
            rssi:          d.rssi      ?? updated[d.id].rssi,
            uptime:        d.uptime    ?? updated[d.id].uptime,
            firmware:      d.firmware  ?? updated[d.id].firmware,
            ip:            d.ip        ?? updated[d.id].ip,
            wifi:          d.wifi      ?? updated[d.id].wifi,
            mqtt:          d.mqtt      ?? updated[d.id].mqtt,
            mqttState:     d.mqttState ?? updated[d.id].mqttState,
            phase:         d.phase     ?? updated[d.id].phase,
            airQualityAvg5mReady: d.airQualityAvg5mReady ?? updated[d.id].airQualityAvg5mReady,
            sensorHealthy: d.sensorHealthy ?? updated[d.id].sensorHealthy,
          }
        }
      })
      return { ...state, devices: updated, lastPolled: Date.now() }
    }
    case 'SET_WS_CONNECTED':
      return { ...state, wsConnected: action.value }
    default:
      return state
  }
}

// ── Context ───────────────────────────────────────────────────────────────
const DeviceContext = createContext(null)

export function DeviceProvider({ children }) {
  const [state, dispatch] = useReducer(deviceReducer, undefined, buildInitialState)

  const recordHeartbeat = useCallback((id, data = {}) => {
    dispatch({ type: 'HEARTBEAT', id, ...data })
  }, [])

  const setDeviceOffline = useCallback((id) => {
    dispatch({ type: 'SET_OFFLINE', id })
  }, [])

  const bulkUpdateDevices = useCallback((devices) => {
    dispatch({ type: 'BULK_UPDATE', devices })
  }, [])

  const setWsConnected = useCallback((value) => {
    dispatch({ type: 'SET_WS_CONNECTED', value })
  }, [])

  return (
    <DeviceContext.Provider value={{ state, recordHeartbeat, setDeviceOffline, bulkUpdateDevices, setWsConnected }}>
      {children}
    </DeviceContext.Provider>
  )
}

export function useDeviceContext() {
  const ctx = useContext(DeviceContext)
  if (!ctx) throw new Error('useDeviceContext must be used inside DeviceProvider')
  return ctx
}
