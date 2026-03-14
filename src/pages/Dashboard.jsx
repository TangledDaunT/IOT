/**
 * Dashboard — landscape relay control panel.
 *
 * 4 relay cards filling the full screen in a row.
 * Each card IS the button — tap to toggle.
 * Landscape-first layout: full width, fills available height.
 */
import React from 'react'
import { useRelays } from '../hooks/useRelays'
import RelayCard from '../components/RelayCard'
import { MOCK_MODE } from '../config'
import { useSmoke } from '../context/SmokeContext'
import { useDeviceContext } from '../context/DeviceContext'

function bandClass(band) {
  if (band === 'good') return 'text-relay-on'
  if (band === 'moderate') return 'text-relay-warn'
  if (band === 'unhealthy') return 'text-orange-400'
  if (band === 'hazardous') return 'text-relay-err'
  return 'text-slate-400'
}

export default function Dashboard() {
  const { relays, globalLoading, handleToggle, refresh } = useRelays()
  const { state: smoke, cigarettesToday } = useSmoke()
  const { state: deviceState } = useDeviceContext()
  const onCount = relays.filter((r) => r.isOn).length
  const telemetry = smoke.telemetry
  const avg5mPercent = Math.round((telemetry.airQualityAvg5m || 0) * 100)
  const cooldownSec = Math.max(0, Math.ceil((telemetry.cooldownRemainingMs || 0) / 1000))
  const smokeLockActive = Boolean(telemetry.smokeActive && telemetry.cooldownRemainingMs > 0)
  const fanRelay = relays.find((r) => r.id === smoke.policy?.fanRelayId) ?? relays.find((r) => r.id === 2)
  const fanManualOverrideActive = Boolean(smokeLockActive && fanRelay && !fanRelay.isOn)
  const primaryDevice = Object.values(deviceState.devices)[0]
  const phase = String(telemetry.phase || primaryDevice?.phase || 'normal_operation')
  const phaseLabel = phase === 'boot_calibrating_clean_air'
    ? 'Boot: Calibrating clean-air baseline'
    : phase === 'boot_learning_smoke_air'
      ? 'Boot: Learning smoke-air profile'
      : 'Normal operation'
  const phaseProgress = phase === 'boot_calibrating_clean_air' ? 35 : phase === 'boot_learning_smoke_air' ? 75 : 100

  return (
    <div className="flex flex-col w-full" style={{ height: '100dvh' }}>
      {/* ── Top status bar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 shrink-0" style={{ paddingTop: 'max(env(safe-area-inset-top), 28px)', height: '52px' }}>
        <div className="flex items-center gap-3">
          <h1 className="text-white font-bold text-sm tracking-tight">
            Control Panel
          </h1>
          {MOCK_MODE && (
            <span className="px-1.5 py-0.5 bg-relay-warn/20 text-relay-warn text-[9px] rounded font-mono tracking-wide">
              MOCK
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 font-mono">
            <span className={onCount > 0 ? 'text-relay-on font-semibold' : ''}>{onCount}</span>
            <span className="text-slate-600"> / {relays.length} ON</span>
          </span>
          <button
            onClick={refresh}
            disabled={globalLoading}
            aria-label="Refresh"
            className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-accent transition-colors active:scale-90 disabled:opacity-40"
          >
            <RefreshIcon spinning={globalLoading} />
          </button>
        </div>
      </div>

      {/* ── Smoke telemetry strip ─────────────────────────────────── */}
      <div className="px-4 pb-2 shrink-0">
        <div className="bg-surface-800 border border-surface-700 rounded-xl px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-[10px] font-mono">
              <span className="text-slate-400">MQ2:</span>
              <span className="text-white">{Math.round(telemetry.raw)}</span>
              <span className="text-slate-500">smoothed</span>
              <span className="text-white">{Math.round(telemetry.smoothed)}</span>
              <span className="text-slate-500">baseline</span>
              <span className="text-white">{Math.round(telemetry.baseline)}</span>
              <span className="text-slate-500">clean</span>
              <span className="text-white">{Math.round(telemetry.cleanBaseline)}</span>
              <span className="text-slate-500">smoke-ref</span>
              <span className={telemetry.smokeReferenceReady ? 'text-white' : 'text-slate-400'}>
                {telemetry.smokeReferenceReady ? Math.round(telemetry.smokeReference) : 'learning'}
              </span>
              <span className="text-slate-500">intensity</span>
              <span className="text-white">{Math.round(telemetry.intensity * 100)}%</span>
              <span className="text-slate-500">avg(5m)</span>
              <span className={telemetry.airQualityAvg5mReady ? 'text-white' : 'text-slate-400'}>
                {telemetry.airQualityAvg5mReady ? `${avg5mPercent}%` : 'warming'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-mono">
              <span className={bandClass(telemetry.aqiBand)}>{telemetry.aqiBand.toUpperCase()}</span>
              <span className={bandClass(telemetry.airQualityBand5m)}>{String(telemetry.airQualityBand5m || 'unknown').toUpperCase()}</span>
              <span className={telemetry.fanAutoActive ? 'text-relay-on' : 'text-slate-400'}>
                FAN-AUTO {telemetry.fanAutoActive ? 'ON' : 'OFF'}
              </span>
              <span className={fanManualOverrideActive ? 'text-relay-warn' : 'text-slate-500'}>
                FAN-OVERRIDE {fanManualOverrideActive ? 'MANUAL OFF' : 'NONE'}
              </span>
              <span className={smokeLockActive ? 'text-relay-err' : 'text-slate-500'}>
                R1 LOCK {smokeLockActive ? `ON (${cooldownSec}s)` : 'OFF'}
              </span>
              <span className="text-white">CIG TODAY: {cigarettesToday}</span>
              <span className={smoke.syncStatus.pending > 0 ? 'text-relay-warn' : smoke.syncStatus.failed > 0 ? 'text-relay-err' : 'text-relay-on'}>
                SYNC {smoke.syncStatus.pending > 0 ? `PENDING:${smoke.syncStatus.pending}` : smoke.syncStatus.failed > 0 ? `FAILED:${smoke.syncStatus.failed}` : 'OK'}
              </span>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded bg-surface-700 overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-500"
                style={{ width: `${phaseProgress}%` }}
              />
            </div>
            <span className="text-[9px] text-slate-300 font-mono">{phaseLabel}</span>
          </div>
          <div className="mt-1 text-[9px] text-slate-500">
            AQI band is approximate from MQ-2 intensity and not a calibrated PM2.5-grade AQI measurement.
            {!telemetry.sourceOnline && <span className="text-relay-warn ml-2">Device offline. Showing last known values.</span>}
            {!telemetry.sensorHealthy && <span className="text-relay-warn ml-2">Sensor signal unstable.</span>}
            {smokeLockActive && <span className="text-relay-err ml-2">Relay 1 forced OFF by smoke safety lock.</span>}
            <span className="ml-2">Phase: {phase}</span>
            <span className="ml-2">Samples: {telemetry.samplesInWindow}</span>
            <span className="ml-2">WiFi: {primaryDevice?.wifi ? 'OK' : 'OFF'}</span>
            <span className="ml-2">MQTT: {primaryDevice?.mqtt ? 'OK' : 'OFF'}</span>
            <span className="ml-2">Uptime: {primaryDevice?.uptime ?? 0}s</span>
            <span className="ml-2">MQTT state: {primaryDevice?.mqttState ?? 'N/A'}</span>
          </div>
        </div>
      </div>

      {/* ── Relay grid — fills remaining height ────────────────── */}
      <div className="flex-1 min-h-0 px-3 pb-3">
        {globalLoading && relays.every((r) => !r.isOn) ? (
          // Skeleton
          <div className="grid grid-cols-4 gap-3 h-full">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface-800 rounded-2xl animate-pulse border-2 border-surface-700" />
            ))}
          </div>
        ) : (
          /* 4 cards side by side in landscape */
          <div className="grid grid-cols-4 gap-3 h-full">
            {relays.map((relay) => (
              <RelayCard
                key={relay.id}
                relay={relay}
                onToggle={handleToggle}
                  disabled={relay.id === 1 && smokeLockActive}
                  disabledLabel={relay.id === 1 && smokeLockActive ? `Locked ${cooldownSec}s` : ''}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      width="18" height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={spinning ? { animation: 'spin 0.8s linear infinite' } : undefined}
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}
