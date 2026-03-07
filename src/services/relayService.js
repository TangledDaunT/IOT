/**
 * Relay Service — all relay-related API calls.
 *
 * Components NEVER import axios directly. All HTTP interaction
 * must go through this file so the API layer can be swapped,
 * mocked, or extended without touching component code.
 */
import { MOCK_MODE } from '../config'
import { createApiClient, attachInterceptors } from './api'
import { mockApi } from './mock'

/**
 * Validates and normalises the relay-status array from the backend.
 * Guards against malformed ESP32 responses corrupting React state.
 */
function normaliseRelayStatus(data) {
  if (!Array.isArray(data)) throw new Error('Invalid relay status: expected array')
  return data.map((item) => ({
    id:   typeof item.id   === 'number' ? item.id   : Number(item.id),
    isOn: Boolean(item.isOn ?? item.is_on ?? item.state === 1 ?? false),
  }))
}

/**
 * Normalises a single relay toggle response.
 */
function normaliseToggleResult(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid toggle response')
  return {
    id:   typeof data.id   === 'number' ? data.id   : Number(data.id),
    isOn: Boolean(data.isOn ?? data.is_on ?? data.state === 1 ?? false),
  }
}

/**
 * Fetches current on/off state for all relays.
 * @returns {Promise<Array<{id: number, isOn: boolean}>>}
 */
export async function getRelayStatus() {
  if (MOCK_MODE) {
    const res = await mockApi.getRelayStatus()
    return normaliseRelayStatus(res.data)
  }
  const client = attachInterceptors(createApiClient())
  const res = await client.get('/relays/status')
  return normaliseRelayStatus(res.data)
}

/**
 * Toggles a single relay on or off.
 * @param {number} id     relay id (1-indexed, matches ESP32 GPIO mapping)
 * @param {boolean} isOn  desired state
 * @returns {Promise<{id: number, isOn: boolean}>}
 */
export async function toggleRelay(id, isOn) {
  if (MOCK_MODE) {
    const res = await mockApi.toggleRelay(id, isOn)
    return normaliseToggleResult(res.data)
  }
  const client = attachInterceptors(createApiClient())
  // ESP32 WebServer expects query params: ?id=X&state=1|0
  const state = isOn ? '1' : '0'
  const res = await client.post(`/relays/toggle?id=${id}&state=${state}`)
  return normaliseToggleResult(res.data)
}
