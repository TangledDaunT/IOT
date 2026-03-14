/**
 * smokeAutomationEngine — deterministic smoke episode and fan automation state transitions.
 *
 * Used for unit testing algorithm behavior that mirrors firmware semantics.
 */

export function createSmokeEngineState() {
  return {
    smoothed: 0,
    baseline: 0,
    smokeActive: false,
    aboveSince: 0,
    belowSince: 0,
    cooldownUntil: 0,
    episodeOpen: false,
    episodeStart: 0,
    episodePeak: 0,
    episodeSeq: 0,
  }
}

export function intensityFor(smoothed, baseline) {
  const delta = smoothed - baseline
  if (delta <= 0) return 0
  return Math.max(0, Math.min(1, delta / 320))
}

export function stepSmokeEngine(prev, sample, cfg) {
  const next = { ...prev }
  const events = []

  next.smoothed = next.smoothed === 0
    ? sample.raw
    : (next.smoothed * (1 - cfg.smoothAlpha)) + (sample.raw * cfg.smoothAlpha)

  if (!next.smokeActive) {
    next.baseline = next.baseline === 0
      ? next.smoothed
      : (next.baseline * (1 - cfg.baselineAlpha)) + (next.smoothed * cfg.baselineAlpha)
  }

  const intensity = intensityFor(next.smoothed, next.baseline)
  next.episodePeak = Math.max(next.episodePeak, intensity)

  if (next.smoothed >= cfg.smokeThresholdOn) {
    if (!next.aboveSince) next.aboveSince = sample.ts
    if (!next.smokeActive && sample.ts - next.aboveSince >= cfg.minSmokeDurationMs) {
      next.smokeActive = true
      next.episodeOpen = true
      next.episodeStart = sample.ts
      next.episodePeak = intensity
      next.episodeSeq += 1
      next.belowSince = 0
      events.push({ type: 'smoke_detected' })
    }
  } else {
    next.aboveSince = 0
  }

  if (next.smokeActive) {
    if (next.smoothed <= cfg.smokeThresholdOff) {
      if (!next.belowSince) next.belowSince = sample.ts
      if (sample.ts - next.belowSince >= cfg.debounceMs) {
        next.smokeActive = false
        next.cooldownUntil = sample.ts + cfg.postSmokeCooldownMs
        next.episodeOpen = false
        events.push({ type: 'smoke_cleared' })
        events.push({ type: 'cigarette_episode_closed' })
      }
    } else {
      next.belowSince = 0
    }
  }

  const cooldownActive = sample.ts < next.cooldownUntil
  const fanAutoOn = cfg.mode === 'force_on'
    ? true
    : cfg.mode === 'force_off'
      ? Boolean(cfg.safetyOverrideEnabled && intensity >= 0.8)
      : next.smokeActive || cooldownActive

  return {
    next,
    output: {
      intensity,
      fanAutoOn,
      smokeActive: next.smokeActive,
      cooldownRemainingMs: cooldownActive ? next.cooldownUntil - sample.ts : 0,
      events,
    },
  }
}
