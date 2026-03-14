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

const mockSmokeState = {
  telemetry: {
    raw: 140,
    smoothed: 135,
    baseline: 110,
    cleanBaseline: 108,
    smokeReference: 215,
    smokeReferenceReady: true,
    intensity: 0.12,
    aqiBand: 'good',
    airQualityAvg5m: 0.1,
    airQualityAvg5mReady: false,
    samplesInWindow: 0,
    windowMs: 300000,
    phase: 'normal_operation',
    sensorHealthy: true,
    smokeActive: false,
    fanAutoActive: false,
    fanManuallyDisabled: false,
    cooldownRemainingMs: 0,
    ts: Date.now(),
  },
  policy: {
    mode: 'auto',
    fanRelayId: 2,
    safetyOverrideEnabled: false,
    smokeThresholdOn: 260,
    smokeThresholdOff: 200,
    triggerOffset: 80,
    minSmokeDurationMs: 6000,
    debounceMs: 1800,
    postSmokeCooldownMs: 120000,
    timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
  },
}

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

  /** POST /relays/toggle?id=X&state=1|0 */
  async toggleRelay(id, isOn) {
    await delay(300)
    // If isOn is provided, use it; otherwise toggle (for backwards compatibility)
    mockRelayState[id] = isOn !== undefined ? isOn : !mockRelayState[id]
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

  /** GET /smoke/status */
  async getSmokeStatus() {
    await delay(250)
    const jitter = Math.floor(Math.random() * 16) - 8
    mockSmokeState.telemetry.raw = Math.max(80, mockSmokeState.telemetry.raw + jitter)
    mockSmokeState.telemetry.smoothed = Math.round(
      mockSmokeState.telemetry.smoothed * 0.8 + mockSmokeState.telemetry.raw * 0.2
    )
    mockSmokeState.telemetry.intensity = Math.max(
      0,
      Math.min(1, (mockSmokeState.telemetry.smoothed - mockSmokeState.telemetry.baseline) / 300)
    )
    mockSmokeState.telemetry.aqiBand = mockSmokeState.telemetry.intensity < 0.15
      ? 'good'
      : mockSmokeState.telemetry.intensity < 0.35
        ? 'moderate'
        : mockSmokeState.telemetry.intensity < 0.65
          ? 'unhealthy'
          : 'hazardous'
    mockSmokeState.telemetry.ts = Date.now()

    return {
      data: {
        telemetry: mockSmokeState.telemetry,
        policy: mockSmokeState.policy,
        cigarettesToday: 0,
        syncStatus: { synced: true, pending: 0, failed: 0 },
      },
    }
  },

  /** POST /smoke/policy */
  async updateSmokePolicy(partial) {
    await delay(300)
    mockSmokeState.policy = { ...mockSmokeState.policy, ...partial }
    return { data: mockSmokeState.policy }
  },
}
