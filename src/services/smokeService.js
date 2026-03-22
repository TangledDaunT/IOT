/**
 * smokeService — smoke telemetry and automation policy endpoints.
 */
import { MOCK_MODE, SMOKE_DEFAULTS } from '../config'
import { createApiClient, attachInterceptors } from './api'
import { mockApi } from './mock'
import { normalizeSmokeTelemetry } from './smokeTelemetry'
import { getAuthHeaders, getMfaHeaders, resolveEdgeApiBaseUrl } from './securityService'

const EDGE_TIMEOUT_MS = 8_000

async function fetchJson(url, options, timeoutMs = EDGE_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(detail || `HTTP ${res.status}`)
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

function edgeConfigured() {
  return Boolean(import.meta.env.VITE_EDGE_API_BASE_URL)
}

function normalizePolicy(data = {}) {
  return {
    mode: String(data.mode ?? SMOKE_DEFAULTS.mode),
    fanRelayId: Number(data.fanRelayId ?? data.fan_relay_id ?? SMOKE_DEFAULTS.fanRelayId),
    safetyOverrideEnabled: Boolean(data.safetyOverrideEnabled ?? data.safety_override_enabled ?? SMOKE_DEFAULTS.safetyOverrideEnabled),
    smokeThresholdOn: Number(data.smokeThresholdOn ?? data.smoke_threshold_on ?? SMOKE_DEFAULTS.smokeThresholdOn),
    smokeThresholdOff: Number(data.smokeThresholdOff ?? data.smoke_threshold_off ?? SMOKE_DEFAULTS.smokeThresholdOff),
    minSmokeDurationMs: Number(data.minSmokeDurationMs ?? data.min_smoke_duration_ms ?? SMOKE_DEFAULTS.minSmokeDurationMs),
    debounceMs: Number(data.debounceMs ?? data.debounce_ms ?? SMOKE_DEFAULTS.debounceMs),
    postSmokeCooldownMs: Number(data.postSmokeCooldownMs ?? data.post_smoke_cooldown_ms ?? SMOKE_DEFAULTS.postSmokeCooldownMs),
    triggerOffset: Number(data.triggerOffset ?? data.trigger_offset ?? SMOKE_DEFAULTS.triggerOffset),
    timezoneOffsetMinutes: Number(data.timezoneOffsetMinutes ?? data.timezone_offset_minutes ?? SMOKE_DEFAULTS.timezoneOffsetMinutes),
  }
}

export async function getSmokeStatus() {
  if (MOCK_MODE) {
    const res = await mockApi.getSmokeStatus()
    return {
      telemetry: normalizeSmokeTelemetry(res.data?.telemetry ?? res.data),
      policy: normalizePolicy(res.data?.policy ?? {}),
      cigarettesToday: Number(res.data?.cigarettesToday ?? 0),
      syncStatus: res.data?.syncStatus ?? { synced: true, pending: 0, failed: 0 },
    }
  }

  let data
  if (edgeConfigured()) {
    const base = resolveEdgeApiBaseUrl()
    data = await fetchJson(`${base}/api/smoke/status`, {
      method: 'GET',
      headers: getAuthHeaders(),
    })
  } else {
    const client = attachInterceptors(createApiClient())
    const res = await client.get('/smoke/status')
    data = res.data
  }

  return {
    telemetry: normalizeSmokeTelemetry(data?.telemetry ?? data),
    policy: normalizePolicy(data?.policy ?? {}),
    cigarettesToday: Number(data?.cigarettesToday ?? 0),
    syncStatus: data?.syncStatus ?? { synced: true, pending: 0, failed: 0 },
  }
}

export async function updateSmokePolicy(partialPolicy) {
  if (MOCK_MODE) {
    const res = await mockApi.updateSmokePolicy(partialPolicy)
    return normalizePolicy(res.data)
  }

  if (edgeConfigured()) {
    const base = resolveEdgeApiBaseUrl()
    const data = await fetchJson(`${base}/api/smoke/policy`, {
      method: 'POST',
      headers: getMfaHeaders(getAuthHeaders({ 'Content-Type': 'application/json' })),
      body: JSON.stringify(partialPolicy),
    })
    return normalizePolicy(data)
  }

  const client = attachInterceptors(createApiClient())
  const res = await client.post('/smoke/policy', partialPolicy, { headers: getMfaHeaders() })
  return normalizePolicy(res.data)
}
