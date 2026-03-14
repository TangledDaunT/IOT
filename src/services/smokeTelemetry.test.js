/**
 * smokeTelemetry contract tests.
 */
import { describe, expect, it } from 'vitest'
import { normalizeSmokeEvent, normalizeSmokeTelemetry } from './smokeTelemetry'

describe('smokeTelemetry', () => {
  it('normalizes telemetry payload variants', () => {
    const t = normalizeSmokeTelemetry({
      raw_mq2: '300',
      smoothed_mq2: '250',
      clean_baseline: '112',
      smoke_reference: '210',
      smoke_reference_ready: true,
      smoke_intensity: '0.4',
      air_quality_avg_5m: '0.31',
      air_quality_avg_5m_ready: true,
      samples_in_window: 1000,
      window_ms: 300000,
      phase: 'normal_operation',
      sensor_healthy: true,
      aqi_band: 'UNHEALTHY',
      smoke_active: 1,
      fan_auto_active: true,
      cooldown_remaining_ms: 5000,
    })

    expect(t.raw).toBe(300)
    expect(t.smoothed).toBe(250)
    expect(t.cleanBaseline).toBe(112)
    expect(t.smokeReference).toBe(210)
    expect(t.smokeReferenceReady).toBe(true)
    expect(t.intensity).toBe(0.4)
    expect(t.aqiBand).toBe('unhealthy')
    expect(t.airQualityAvg5m).toBe(0.31)
    expect(t.airQualityAvg5mReady).toBe(true)
    expect(t.airQualityBand5m).toBe('moderate')
    expect(t.samplesInWindow).toBe(1000)
    expect(t.windowMs).toBe(300000)
    expect(t.phase).toBe('normal_operation')
    expect(t.sensorHealthy).toBe(true)
    expect(t.smokeActive).toBe(true)
  })

  it('normalizes smoke events and ensures fallback event id', () => {
    const e = normalizeSmokeEvent({
      event_type: 'cigarette_episode_closed',
      episode_id: 'ep-1',
      device_id: 'esp32-01',
    })

    expect(e.eventType).toBe('cigarette_episode_closed')
    expect(e.episodeId).toBe('ep-1')
    expect(e.deviceId).toBe('esp32-01')
    expect(e.eventId.length).toBeGreaterThan(4)
  })
})
