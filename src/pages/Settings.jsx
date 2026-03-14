/**
 * Settings — landscape two-column layout.
 * Left: backend IP config. Right: app info + relay map.
 */
import React, { useState, useEffect } from 'react'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import { useToast } from '../context/ToastContext'
import { useRobot, EXPRESSIONS } from '../context/RobotContext'
import { MOCK_MODE, RELAY_CONFIG } from '../config'
import { useVoiceCommand, MOCK_STT_COMMANDS } from '../hooks/useVoiceCommand'
import { requestMicPermission } from '../services/voiceService'
import { useSmoke } from '../context/SmokeContext'

const LS_KEY = 'iot_base_url'

export default function Settings() {
  const { toast } = useToast()
  const { setRobotExpression } = useRobot()
  const { settings: voiceSettings, setSettings: setVoiceSettings, micPermission, setMicPermission, handleMicTap } = useVoiceCommand()

  const [ip, setIp]           = useState(() => localStorage.getItem(LS_KEY) || '')
  const [saved, setSaved]     = useState(false)
  const [testing, setTesting] = useState(false)
  const [pingResult, setPingResult] = useState(null)
  const { state: smokeState, cigarettesToday, updatePolicy } = useSmoke()

  useEffect(() => {
    if (ip) setRobotExpression(EXPRESSIONS.THINKING, 'Configuring…', 0)
    else    setRobotExpression(EXPRESSIONS.IDLE, '', 0)
  }, [ip, setRobotExpression])

  const handleSave = () => {
    const trimmed = ip.trim()
    if (trimmed) {
      // Must start with http:// or https://
      if (!/^https?:\/\//.test(trimmed)) {
        toast('URL must start with http:// or https://', 'warn')
        return
      }
      // Reject JavaScript injection attempts
      if (/javascript:/i.test(trimmed) || /data:/i.test(trimmed)) {
        toast('Invalid URL format', 'error')
        return
      }
    }
    localStorage.setItem(LS_KEY, trimmed)
    setSaved(true)
    setPingResult(null)
    toast('Backend URL saved', 'success')
    setRobotExpression(EXPRESSIONS.SUCCESS, 'Config saved!', 2500)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleClear = () => {
    localStorage.removeItem(LS_KEY)
    setIp('')
    setPingResult(null)
    toast('URL cleared', 'info')
    setRobotExpression(EXPRESSIONS.HAPPY, 'Cleared!', 2000)
  }

  const handlePing = async () => {
    const url = ip.trim() || localStorage.getItem(LS_KEY) || ''
    if (!url) { toast('No URL to test', 'warn'); return }
    setTesting(true)
    setPingResult(null)
    setRobotExpression(EXPRESSIONS.LOADING, 'Testing…', 0)
    try {
      const res = await fetch(`${url}/health`, { method: 'GET', signal: AbortSignal.timeout(5000) })
      if (res.ok || res.status < 500) {
        setPingResult('ok')
        toast('Backend reachable ✓', 'success')
        setRobotExpression(EXPRESSIONS.SUCCESS, 'Online!', 3000)
      } else throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      setPingResult('fail')
      toast(`Unreachable: ${e.message}`, 'error')
      setRobotExpression(EXPRESSIONS.ERROR, 'No response', 3000)
    } finally {
      setTesting(false)
    }
  }

  const handlePolicyChange = async (partial) => {
    try {
      await updatePolicy(partial)
      toast('Smoke automation policy updated', 'success')
    } catch (err) {
      toast(err.message || 'Policy update failed', 'error')
      setRobotExpression(EXPRESSIONS.ERROR, 'Policy failed', 2500)
    }
  }

  return (
    <div className="flex w-full gap-3 px-3 pb-3 overflow-hidden" style={{ height: '100dvh', paddingTop: 'max(env(safe-area-inset-top), 28px)' }}>
      {/* Left — backend URL config */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">
        <h1 className="text-white font-bold text-sm tracking-tight shrink-0">Settings</h1>

        <Card className="p-3 flex-1 flex flex-col gap-3">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Backend IP</p>
          <input
            type="url"
            inputMode="url"
            placeholder="http://192.168.1.100:8000"
            value={ip}
            onChange={(e) => { setIp(e.target.value); setSaved(false) }}
            className="w-full bg-surface-700 text-white border border-surface-600 rounded-xl px-3 py-2.5 text-sm min-h-[44px] focus:outline-none focus:border-accent transition-colors placeholder:text-slate-600 font-mono"
          />
          {pingResult && (
            <span className={['text-xs', pingResult === 'ok' ? 'text-relay-on' : 'text-relay-err'].join(' ')}>
              {pingResult === 'ok' ? '● Connected' : '✕ Unreachable'}
            </span>
          )}
          <div className="flex gap-2 mt-auto">
            <Button variant="primary" size="sm" onClick={handleSave} loading={saved} className="flex-1">
              {saved ? 'Saved ✓' : 'Save'}
            </Button>
            <Button variant="ghost"     size="sm" onClick={handlePing}  loading={testing}>Test</Button>
            <Button variant="secondary" size="sm" onClick={handleClear}>Clear</Button>
          </div>
        </Card>

        {/* App info */}
        <Card className="p-3 shrink-0">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Info</p>
          <InfoRow label="Version" value="1.0.0" />
          <InfoRow label="Mode"    value={MOCK_MODE ? 'MOCK' : 'LIVE'} valueClass={MOCK_MODE ? 'text-relay-warn' : 'text-relay-on'} />
          <InfoRow label="Cigs today" value={String(cigarettesToday)} />
        </Card>
      </div>

      {/* Right — relay map + voice settings */}
      <div className="w-44 shrink-0 flex flex-col gap-3">
        <div className="h-[34px]" /> {/* spacer to align with h1 */}
        <Card className="p-3 flex-1 overflow-y-auto">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-2 sticky top-0 bg-surface-800 pb-1">Relay Map</p>
          {RELAY_CONFIG.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-2 border-b border-surface-700 last:border-0">
              <span className="text-base">{r.icon}</span>
              <span className="text-xs text-white flex-1 truncate">{r.name}</span>
              <span className="text-[9px] text-slate-500 font-mono shrink-0">GPIO#{r.id}</span>
            </div>
          ))}
        </Card>

        {/* Voice settings */}
        <Card className="p-3 shrink-0">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Voice</p>
          <VoiceToggle label="Enable"     value={voiceSettings.enabled}    onChange={v => setVoiceSettings({ enabled: v })} />
          <VoiceToggle label="TTS"        value={voiceSettings.ttsEnabled} onChange={v => setVoiceSettings({ ttsEnabled: v })} />
          <VoiceToggle
            label="Wake Word"
            value={voiceSettings.wakeWordEnabled ?? true}
            onChange={v => setVoiceSettings({ wakeWordEnabled: v })}
          />
          {MOCK_MODE && (
            <VoiceToggle label="Mock STT" value={voiceSettings.mockStt}   onChange={v => setVoiceSettings({ mockStt: v })} />
          )}
          {/* Mic permission status */}
          <div className="flex items-center justify-between py-1.5 border-b border-surface-700">
            <span className="text-xs text-slate-500">Mic</span>
            {micPermission === 'granted' ? (
              <span className="text-[10px] text-relay-on font-mono">● OK</span>
            ) : (
              <button
                onClick={async () => {
                  const p = await requestMicPermission()
                  setMicPermission(p)
                  toast(p === 'granted' ? 'Mic access granted' : 'Mic denied', p === 'granted' ? 'success' : 'error')
                }}
                className="text-[10px] text-accent font-mono underline"
              >
                Allow
              </button>
            )}
          </div>
          {/* Test button */}
          {voiceSettings.enabled && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleMicTap(MOCK_STT_COMMANDS[0])}
              className="w-full mt-2 text-[10px]"
            >
              Test voice
            </Button>
          )}
        </Card>

        <Card className="p-3 shrink-0">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Smoke Automation</p>

          <div className="flex items-center justify-between py-1.5 border-b border-surface-700">
            <span className="text-xs text-slate-500">Mode</span>
            <select
              value={smokeState.policy.mode}
              onChange={(e) => handlePolicyChange({ mode: e.target.value })}
              className="bg-surface-700 border border-surface-600 rounded px-2 py-1 text-[10px] text-white font-mono"
            >
              <option value="auto">AUTO</option>
              <option value="force_on">FORCE ON</option>
              <option value="force_off">FORCE OFF</option>
            </select>
          </div>

          <div className="flex items-center justify-between py-1.5 border-b border-surface-700">
            <span className="text-xs text-slate-500">Fan relay</span>
            <select
              value={smokeState.policy.fanRelayId}
              onChange={(e) => handlePolicyChange({ fanRelayId: Number(e.target.value) })}
              className="bg-surface-700 border border-surface-600 rounded px-2 py-1 text-[10px] text-white font-mono"
            >
              {RELAY_CONFIG.map((relay) => (
                <option key={relay.id} value={relay.id}>{relay.id} - {relay.name}</option>
              ))}
            </select>
          </div>

          <VoiceToggle
            label="Safety Override"
            value={smokeState.policy.safetyOverrideEnabled}
            onChange={(v) => handlePolicyChange({ safetyOverrideEnabled: v })}
          />

          <NumericSetting
            label="On threshold"
            value={smokeState.policy.smokeThresholdOn}
            onCommit={(v) => handlePolicyChange({ smokeThresholdOn: v })}
          />
          <NumericSetting
            label="Off threshold"
            value={smokeState.policy.smokeThresholdOff}
            onCommit={(v) => handlePolicyChange({ smokeThresholdOff: v })}
          />
          <NumericSetting
            label="Cooldown ms"
            value={smokeState.policy.postSmokeCooldownMs}
            onCommit={(v) => handlePolicyChange({ postSmokeCooldownMs: v })}
          />
          <NumericSetting
            label="Min smoke ms"
            value={smokeState.policy.minSmokeDurationMs}
            onCommit={(v) => handlePolicyChange({ minSmokeDurationMs: v })}
          />
          <NumericSetting
            label="Debounce ms"
            value={smokeState.policy.debounceMs}
            onCommit={(v) => handlePolicyChange({ debounceMs: v })}
          />
          <NumericSetting
            label="Trigger offset"
            value={smokeState.policy.triggerOffset}
            onCommit={(v) => handlePolicyChange({ triggerOffset: v })}
          />
          <NumericSetting
            label="Timezone mins"
            value={smokeState.policy.timezoneOffsetMinutes}
            allowNegative
            onCommit={(v) => handlePolicyChange({ timezoneOffsetMinutes: v })}
          />

          <div className="pt-2 text-[10px] font-mono">
            <div className="flex justify-between text-slate-400">
              <span>OpenClaw sync</span>
              <span className={smokeState.syncStatus.pending > 0 ? 'text-relay-warn' : smokeState.syncStatus.failed > 0 ? 'text-relay-err' : 'text-relay-on'}>
                {smokeState.syncStatus.pending > 0 ? `PENDING ${smokeState.syncStatus.pending}` : smokeState.syncStatus.failed > 0 ? `FAILED ${smokeState.syncStatus.failed}` : 'SYNCED'}
              </span>
            </div>
            {smokeState.syncStatus.lastError && (
              <p className="text-relay-err mt-1">{smokeState.syncStatus.lastError}</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

function InfoRow({ label, value, valueClass = 'text-slate-300' }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-surface-700 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={['text-xs font-mono', valueClass].join(' ')}>{value}</span>
    </div>
  )
}

function VoiceToggle({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-surface-700 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: '28px', height: '16px', borderRadius: '8px', border: 'none',
          background: value ? '#2563eb' : '#334155',
          position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
          flexShrink: 0,
        }}
        aria-checked={value}
        role="switch"
      >
        <span style={{
          position: 'absolute', top: '2px',
          left: value ? '14px' : '2px',
          width: '12px', height: '12px', borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
        }} />
      </button>
    </div>
  )
}

function NumericSetting({ label, value, onCommit, allowNegative = false }) {
  const [draft, setDraft] = useState(String(value ?? ''))

  useEffect(() => {
    setDraft(String(value ?? ''))
  }, [value])

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-surface-700">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft)
          if (Number.isFinite(n) && (allowNegative || n >= 0)) onCommit(Math.round(n))
          else setDraft(String(value ?? ''))
        }}
        className="w-20 bg-surface-700 border border-surface-600 rounded px-2 py-1 text-[10px] text-white font-mono"
      />
    </div>
  )
}
