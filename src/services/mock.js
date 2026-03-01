/**
 * Mock API responses — used when VITE_MOCK_MODE=true.
 *
 * Simulates realistic latency so UI loading/error states
 * can be verified during development without a backend.
 */

/** Simulates async network delay */
const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms))

// In-memory relay state (survives within a page session)
const mockRelayState = { 1: false, 2: false, 3: false, 4: false }

export const mockApi = {
  /** GET /relays/status */
  async getRelayStatus() {
    await delay(500)
    return {
      data: Object.entries(mockRelayState).map(([id, isOn]) => ({
        id: Number(id),
        isOn,
      })),
    }
  },

  /** POST /relays/{id}/toggle */
  async toggleRelay(id) {
    await delay(300)
    mockRelayState[id] = !mockRelayState[id]
    return { data: { id, isOn: mockRelayState[id] } }
  },

  /** POST /timers */
  async createTimer(payload) {
    await delay(400)
    return {
      data: {
        id: Math.floor(Math.random() * 10000),
        ...payload,
        created: new Date().toISOString(),
      },
    }
  },

  /** GET /timers */
  async getTimers() {
    await delay(300)
    return { data: [] } // return empty list by default in mock
  },
}
