/**
 * Central app configuration.
 *
 * Priority for base URL resolution:
 *   1. User-saved IP from localStorage (set in Settings page)
 *   2. VITE_API_BASE_URL from .env
 *   3. Primary ESP32 local IP fallback
 *   4. mDNS fallback
 *
 * This means the user can override the backend IP at runtime
 * without rebuilding the app — critical for local IoT setups.
 */

export const ESP32_PRIMARY_BASE_URL = 'http://192.168.1.10'
export const ESP32_MDNS_BASE_URL = 'http://esp32.local'

export function normalizeBaseUrl(raw) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  return withScheme.replace(/\/+$/, '')
}

export function getFallbackBaseUrls() {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('iot_base_url') : ''
  const envBase = import.meta.env.VITE_API_BASE_URL
  const candidates = [saved, envBase, ESP32_PRIMARY_BASE_URL, ESP32_MDNS_BASE_URL]
    .map(normalizeBaseUrl)
    .filter(Boolean)
  return [...new Set(candidates)]
}

export const getBaseUrl = () => getFallbackBaseUrls()[0] || ESP32_PRIMARY_BASE_URL

/**
 * When VITE_MOCK_MODE=true, all API calls return simulated data.
 * Flip to false when FastAPI backend is ready.
 */
export const MOCK_MODE = import.meta.env.VITE_MOCK_MODE === 'true'

/**
 * Relay definitions.
 * Extend this array to add more relays.
 * `id` maps to the relay index on the ESP32 GPIO.
 */
export const RELAY_CONFIG = [
  { id: 1, name: 'Main Lights',    icon: '💡' },
  { id: 2, name: 'Exhaust Fan',    icon: '🌀' },
  { id: 3, name: 'Water Pump',     icon: '💧' },
  { id: 4, name: 'Backup Power',   icon: '🔋' },
]

/** API request timeout in milliseconds */
export const API_TIMEOUT = 8000

/** Smoke / air-quality automation defaults */
export const SMOKE_DEFAULTS = {
  fanRelayId: 2,
  mode: 'auto', // auto | force_on | force_off
  safetyOverrideEnabled: true,
  smokeThresholdOn: 260,
  smokeThresholdOff: 200,
  triggerOffset: 80,
  minSmokeDurationMs: 6000,
  debounceMs: 1800,
  postSmokeCooldownMs: 120000,
  baselineAlpha: 0.02,
  smoothAlpha: 0.2,
  timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
}

/** OpenClaw sync defaults for cigarette episode counting */
export const OPENCLAW_CONFIG = {
  endpointPath: '/openclaw/events/smoke_count',
  flushIntervalMs: 10000,
  maxRetryDelayMs: 300000,
}

/** Polling interval for relay state refresh (ms). Set 0 to disable. */
export const POLL_INTERVAL = 15000

/**
 * Physical ESP32 nodes in the installation.
 * relays[] maps which relay IDs live on each device.
 */
export const DEVICE_CONFIG = [
  { id: 'esp32-01', name: 'Main ESP32 Node', room: 'Control Room', relays: [1, 2, 3, 4] },
]

/** WebSocket path — backend must expose ws://[host]/ws */
export const WS_PATH = '/ws'

/** How often to request a device heartbeat poll when WS is unavailable (ms) */
export const DEVICE_POLL_INTERVAL = 20000
