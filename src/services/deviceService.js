/**
 * deviceService — REST API for ESP32 device health.
 *
 * Endpoints (backend):
 *   GET  /devices/status          → DeviceHealth[]
 *   GET  /devices/:id/status      → DeviceHealth
 *   POST /devices/:id/ota         → triggers OTA update
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
  const res = await client.get('/devices/status', { timeout: API_TIMEOUT })
  return res.data
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
  const res = await client.get(`/devices/${id}/status`, { timeout: API_TIMEOUT })
  return res.data
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
  const client = attachInterceptors(createApiClient())
  const res = await client.post(`/devices/${id}/ota`, {}, { timeout: API_TIMEOUT })
  return res.data
}
