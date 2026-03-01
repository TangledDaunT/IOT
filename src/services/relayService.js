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
 * Fetches current on/off state for all relays.
 * @returns {Promise<Array<{id: number, isOn: boolean}>>}
 */
export async function getRelayStatus() {
  if (MOCK_MODE) {
    const res = await mockApi.getRelayStatus()
    return res.data
  }
  const client = attachInterceptors(createApiClient())
  const res = await client.get('/relays/status')
  return res.data
}

/**
 * Toggles a single relay on or off.
 * @param {number} id     relay id (1-indexed, matches ESP32 GPIO mapping)
 * @param {boolean} isOn  desired state
 * @returns {Promise<{id: number, isOn: boolean}>}
 */
export async function toggleRelay(id, isOn) {
  if (MOCK_MODE) {
    const res = await mockApi.toggleRelay(id)
    return res.data
  }
  const client = attachInterceptors(createApiClient())
  const res = await client.post(`/relays/${id}/toggle`, { isOn })
  return res.data
}
