/**
 * smokeService — smoke telemetry and automation policy endpoints.
 */
import { MOCK_MODE, SMOKE_DEFAULTS } from '../config'
import { createApiClient, attachInterceptors } from './api'
import { mockApi } from './mock'
import { normalizeSmokeTelemetry } from './smokeTelemetry'

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

  const client = attachInterceptors(createApiClient())
  const res = await client.get('/smoke/status')
  return {
    telemetry: normalizeSmokeTelemetry(res.data?.telemetry ?? res.data),
    policy: normalizePolicy(res.data?.policy ?? {}),
    cigarettesToday: Number(res.data?.cigarettesToday ?? 0),
    syncStatus: res.data?.syncStatus ?? { synced: true, pending: 0, failed: 0 },
  }
}

export async function updateSmokePolicy(partialPolicy) {
  if (MOCK_MODE) {
    const res = await mockApi.updateSmokePolicy(partialPolicy)
    return normalizePolicy(res.data)
  }

  const client = attachInterceptors(createApiClient())
  const res = await client.post('/smoke/policy', partialPolicy)
  return normalizePolicy(res.data)
}
