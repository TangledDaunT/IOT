/**
 * Timer Service — schedule relay state changes via the backend.
 * The ESP32 FastAPI server will store and execute scheduled jobs.
 */
import { MOCK_MODE } from '../config'
import { createApiClient, attachInterceptors } from './api'
import { mockApi } from './mock'

/**
 * Creates a scheduled relay action.
 * @param {{ relayId: number, scheduledAt: string, action: 'ON'|'OFF' }} payload
 * @returns {Promise<object>}
 */
export async function createTimer(payload) {
  if (MOCK_MODE) {
    const res = await mockApi.createTimer(payload)
    return res.data
  }
  const client = attachInterceptors(createApiClient())
  const res = await client.post('/timers', payload)
  return res.data
}

/**
 * Retrieves all pending timers from the backend.
 * @returns {Promise<Array>}
 */
export async function getTimers() {
  if (MOCK_MODE) {
    const res = await mockApi.getTimers()
    return res.data
  }
  const client = attachInterceptors(createApiClient())
  const res = await client.get('/timers')
  return res.data
}
