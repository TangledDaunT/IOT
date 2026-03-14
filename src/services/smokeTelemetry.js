/**
 * smokeTelemetry — payload normalizers for smoke telemetry and smoke events.
 *
 * Keeps websocket and REST payload handling consistent and resilient to
 * backend shape differences.
 */

const VALID_AQI_BANDS = new Set(['good', 'moderate', 'unhealthy', 'hazardous', 'unknown'])

export function estimateAqiBand(intensity) {
  const x = Number(intensity)
  if (!Number.isFinite(x)) return 'unknown'
  if (x < 0.15) return 'good'
  if (x < 0.35) return 'moderate'
  if (x < 0.65) return 'unhealthy'
  return 'hazardous'
}

export function normalizeSmokeTelemetry(data = {}) {
  const raw = Number(data.raw ?? data.raw_mq2 ?? 0)
  const smoothed = Number(data.smoothed ?? data.smoothed_mq2 ?? raw)
  const baseline = Number(data.baseline ?? 0)
  const cleanBaseline = Number(data.cleanBaseline ?? data.clean_baseline ?? baseline)
  const smokeReference = Number(data.smokeReference ?? data.smoke_reference ?? 0)
  const smokeReferenceReady = Boolean(data.smokeReferenceReady ?? data.smoke_reference_ready ?? false)
  const intensity = Number(data.intensity ?? data.smoke_intensity ?? 0)
  const avg5mCandidate = Number(
    data.airQualityAvg5m
      ?? data.air_quality_avg_5m
      ?? data.aqi_moving_avg
      ?? data.aqiMovingAvg
      ?? 0
  )
  const avg5mReady = Boolean(
    data.airQualityAvg5mReady
      ?? data.air_quality_avg_5m_ready
      ?? data.aqi_moving_avg_ready
      ?? data.aqiMovingAvgReady
      ?? false
  )
  const bandCandidate = String(data.aqiBand ?? data.aqi_band ?? '').toLowerCase()
  const aqiBand = VALID_AQI_BANDS.has(bandCandidate) ? bandCandidate : estimateAqiBand(intensity)
  const avg5m = Number.isFinite(avg5mCandidate) ? Math.max(0, Math.min(1, avg5mCandidate)) : 0
  const avg5mBand = estimateAqiBand(avg5m)

  return {
    raw: Number.isFinite(raw) ? raw : 0,
    smoothed: Number.isFinite(smoothed) ? smoothed : 0,
    baseline: Number.isFinite(baseline) ? baseline : 0,
      cleanBaseline: Number.isFinite(cleanBaseline) ? cleanBaseline : 0,
      smokeReference: Number.isFinite(smokeReference) ? smokeReference : 0,
      smokeReferenceReady,
    intensity: Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0,
    aqiBand,
    airQualityAvg5m: avg5m,
    airQualityAvg5mReady: avg5mReady,
    airQualityBand5m: avg5mBand,
    samplesInWindow: Number(data.samplesInWindow ?? data.samples_in_window ?? 0) || 0,
    windowMs: Number(data.windowMs ?? data.window_ms ?? 300000) || 300000,
    phase: String(data.phase ?? 'normal_operation'),
    sensorHealthy: Boolean(data.sensorHealthy ?? data.sensor_healthy ?? true),
    smokeActive: Boolean(data.smokeActive ?? data.smoke_active ?? false),
    fanAutoActive: Boolean(data.fanAutoActive ?? data.fan_auto_active ?? false),
    fanManuallyDisabled: Boolean(data.fanManuallyDisabled ?? data.fan_manually_disabled ?? false),
    cooldownRemainingMs: Number(data.cooldownRemainingMs ?? data.cooldown_remaining_ms ?? 0) || 0,
    policy: data.policy && typeof data.policy === 'object' ? data.policy : null,
    sourceOnline: data.sourceOnline !== undefined ? Boolean(data.sourceOnline) : true,
    ts: Number(data.ts ?? data.timestamp ?? Date.now()) || Date.now(),
  }
}

export function normalizeSmokeEvent(data = {}) {
  const eventType = String(data.eventType ?? data.event_type ?? 'unknown')
  const episodeId = String(data.episodeId ?? data.episode_id ?? '').trim() || null

  return {
    eventType,
    eventId: String(data.eventId ?? data.event_id ?? '').trim() || `${eventType}-${Date.now()}`,
    episodeId,
    deviceId: String(data.deviceId ?? data.device_id ?? 'esp32-01'),
    startedAt: Number(data.startedAt ?? data.started_at ?? 0) || null,
    endedAt: Number(data.endedAt ?? data.ended_at ?? 0) || null,
    durationMs: Number(data.durationMs ?? data.duration_ms ?? 0) || 0,
    peakIntensity: Number(data.peakIntensity ?? data.peak_intensity ?? 0) || 0,
    ts: Number(data.ts ?? data.timestamp ?? Date.now()) || Date.now(),
  }
}
