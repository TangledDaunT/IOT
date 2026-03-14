/**
 * deviceService — REST API for ESP32 device health.
 *
 * Firmware endpoints:
 *   GET /health
 *
 * In MOCK_MODE, returns synthetic health data with simulated
 * RSSI jitter and an incrementing uptime counter.
 */
import { MOCK_MODE, DEVICE_CONFIG, API_TIMEOUT } from '../config'
import { createApiClient, attachInterceptors } from './api'

// ── Mock data generation ──────────────────────────────────────────────────
const MOCK_START_TS = Date.now()

function mockDevice(cfg, index) {
  const uptime  = Math.floor((Date.now() - MOCK_START_TS) / 1000) + index * 3600
  const rssi    = -55 - (index * 8) - Math.floor(Math.random() * 6)
  return {
    id:            cfg.id,
    online:        true,   // one could be offline: index === 1 ? false : true
    lastHeartbeat: Date.now() - Math.floor(Math.random() * 4000),
    rssi,
    uptime,
    firmware:      '1.2.' + (3 + index),
    ip:            `192.168.1.${110 + index}`,
  }
}

async function mockDelay(ms = 400) {
  return new Promise((res) => setTimeout(res, ms + Math.random() * 200))
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Fetch health for all configured devices.
 * @returns {Promise<Array<DeviceHealth>>}
 */
export async function getAllDeviceStatus() {
  if (MOCK_MODE) {
    await mockDelay()
    return DEVICE_CONFIG.map((cfg, i) => mockDevice(cfg, i))
  }

  const client = attachInterceptors(createApiClient())
  const res = await client.get('/health', { timeout: API_TIMEOUT })
  const data = res.data ?? {}
  const cfg = DEVICE_CONFIG[0] ?? { id: 'esp32-01', name: 'ESP32 Node', room: 'Control Room', relays: [1, 2, 3, 4] }

  return [{
    id: cfg.id,
    name: cfg.name,
    room: cfg.room,
    relays: cfg.relays,
    online: Boolean(data.status === 'OK' || data.wifi || data.mqtt),
    lastHeartbeat: Date.now(),
    rssi: null,
    uptime: Number(data.uptimeSec ?? 0) || 0,
    firmware: data.firmware ?? '3.1.0-smoke',
    ip: data.ip ?? null,
    wifi: Boolean(data.wifi),
    mqtt: Boolean(data.mqtt),
    mqttState: Number(data.mqttState ?? 0) || 0,
    phase: String(data.phase ?? 'normal_operation'),
    airQualityAvg5mReady: Boolean(data.airQualityAvg5mReady ?? false),
    sensorHealthy: Boolean(data.sensorHealthy ?? true),
  }]
}

/**
 * Fetch health for a single device.
 * @param {string} id
 * @returns {Promise<DeviceHealth>}
 */
export async function getDeviceStatus(id) {
  if (MOCK_MODE) {
    await mockDelay(200)
    const cfg = DEVICE_CONFIG.find((d) => d.id === id)
    if (!cfg) throw new Error(`Unknown device: ${id}`)
    return mockDevice(cfg, DEVICE_CONFIG.indexOf(cfg))
  }

  const client = attachInterceptors(createApiClient())
  const all = await getAllDeviceStatus()
  const match = all.find((d) => d.id === id)
  if (match) return match
  return all[0]
}

/**
 * Trigger OTA firmware update on a device.
 * @param {string} id
 * @returns {Promise<{ queued: boolean }>}
 */
export async function triggerOTA(id) {
  if (MOCK_MODE) {
    await mockDelay(600)
    return { queued: true, message: 'OTA update queued (mock)' }
  }

  return {
    queued: false,
    message: `OTA endpoint not exposed by firmware for ${id}`,
  }
}
