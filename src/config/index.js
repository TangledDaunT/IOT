/**
 * Central app configuration.
 *
 * Priority for base URL resolution:
 *   1. User-saved IP from localStorage (set in Settings page)
 *   2. VITE_API_BASE_URL from .env
 *   3. Fallback to localhost for local dev
 *
 * This means the user can override the backend IP at runtime
 * without rebuilding the app — critical for local IoT setups.
 */

export const getBaseUrl = () => {
  const saved = localStorage.getItem('iot_base_url')
  if (saved && saved.trim()) return saved.trim()
  return import.meta.env.VITE_API_BASE_URL || 'http://192.168.1.7'
}

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

/** Polling interval for relay state refresh (ms). Set 0 to disable. */
export const POLL_INTERVAL = 15000

/**
 * Physical ESP32 nodes in the installation.
 * relays[] maps which relay IDs live on each device.
 */
export const DEVICE_CONFIG = [
  { id: 'esp32-01', name: 'Living Room Node', room: 'Living Room', relays: [1, 2] },
  { id: 'esp32-02', name: 'Utility Node',      room: 'Utility',      relays: [3, 4] },
]

/** WebSocket path — backend must expose ws://[host]/ws */
export const WS_PATH = '/ws'

/** How often to request a device heartbeat poll when WS is unavailable (ms) */
export const DEVICE_POLL_INTERVAL = 20000
