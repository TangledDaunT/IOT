/**
 * smokeAutomationEngine tests.
 */
import { describe, expect, it } from 'vitest'
import { createSmokeEngineState, stepSmokeEngine } from './smokeAutomationEngine'

const cfg = {
  mode: 'auto',
  safetyOverrideEnabled: false,
  smoothAlpha: 1,
  baselineAlpha: 0.01,
  smokeThresholdOn: 240,
  smokeThresholdOff: 180,
  minSmokeDurationMs: 2000,
  debounceMs: 1000,
  postSmokeCooldownMs: 5000,
}

function runSeries(values, startTs = 0, step = 500) {
  let state = createSmokeEngineState()
  const outputs = []

  values.forEach((raw, i) => {
    const ts = startTs + i * step
    const res = stepSmokeEngine(state, { raw, ts }, cfg)
    state = res.next
    outputs.push(res.output)
  })

  return outputs
}

describe('smokeAutomationEngine', () => {
  it('ignores short noise spikes', () => {
    const outputs = runSeries([110, 120, 450, 120, 110, 115])
    expect(outputs.some((o) => o.events.some((e) => e.type === 'cigarette_episode_closed'))).toBe(false)
    expect(outputs.some((o) => o.smokeActive)).toBe(false)
  })

  it('detects prolonged smoke and closes one episode', () => {
    const outputs = runSeries([120, 125, 260, 270, 280, 290, 300, 175, 170, 168, 166, 165], 0, 500)
    const detectedCount = outputs.flatMap((o) => o.events).filter((e) => e.type === 'smoke_detected').length
    const closedCount = outputs.flatMap((o) => o.events).filter((e) => e.type === 'cigarette_episode_closed').length
    expect(detectedCount).toBe(1)
    expect(closedCount).toBe(1)
  })

  it('keeps fan on during cooldown in auto mode', () => {
    const state = { ...createSmokeEngineState(), cooldownUntil: 8000 }
    const out = stepSmokeEngine(state, { raw: 120, ts: 3000 }, cfg).output
    expect(out.cooldownRemainingMs).toBeGreaterThan(0)
    expect(out.fanAutoOn).toBe(true)
  })

  it('respects force_off without safety override', () => {
    let state = createSmokeEngineState()
    const forceOffCfg = { ...cfg, mode: 'force_off', safetyOverrideEnabled: false }
    const a = stepSmokeEngine(state, { raw: 500, ts: 0 }, forceOffCfg)
    state = a.next
    const b = stepSmokeEngine(state, { raw: 520, ts: 5000 }, forceOffCfg)
    expect(b.output.fanAutoOn).toBe(false)
  })

  it('allows safety override in force_off for extreme intensity', () => {
    let state = createSmokeEngineState()
    const forceOffCfg = { ...cfg, mode: 'force_off', safetyOverrideEnabled: true }
    state = stepSmokeEngine(state, { raw: 120, ts: 0 }, forceOffCfg).next
    state = stepSmokeEngine(state, { raw: 980, ts: 500 }, forceOffCfg).next
    const out = stepSmokeEngine(state, { raw: 1000, ts: 1000 }, forceOffCfg).output
    expect(out.fanAutoOn).toBe(true)
  })
})
