/**
 * Timer — client-side relay scheduler.
 *
 * Left column: create timer form (relay, datetime, action)
 * Right column: active timer list with live countdown + cancel
 *
 * All timers are browser-local (no server required).
 * Fires the relay toggle directly when countdown expires.
 */
import React, { useState, useCallback, useEffect } from 'react'
import { useRobot, EXPRESSIONS } from '../context/RobotContext'
import { useToast } from '../context/ToastContext'
import { useClientTimers } from '../hooks/useClientTimers'
import { useRelayContext } from '../context/RelayContext'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import { RELAY_CONFIG } from '../config'

// ── Countdown display ──────────────────────────────────────────────────────
function useCountdown(fireAt) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((new Date(fireAt).getTime() - Date.now()) / 1000))
  )
  useEffect(() => {
    const t = setInterval(() => {
      const secs = Math.max(0, Math.floor((new Date(fireAt).getTime() - Date.now()) / 1000))
      setRemaining(secs)
    }, 1000)
    return () => clearInterval(t)
  }, [fireAt])
  return remaining
}

function formatCountdown(seconds) {
  if (seconds <= 0) return 'FIRING...'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── Timer row ──────────────────────────────────────────────────────────────
function TimerRow({ timer, onCancel }) {
  const remaining   = useCountdown(timer.fireAt)
  const relay       = RELAY_CONFIG.find((r) => r.id === timer.relayId)
  const urgent      = !timer.fired && remaining < 60
  const isOn        = timer.action === 'ON'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '9px 12px',
      background: timer.fired ? 'rgba(255,255,255,0.03)' : '#0a0a0a',
      border: `1px solid ${timer.fired ? '#111111' : urgent ? '#555555' : '#1e293b'}`,
      borderRadius: '10px',
      opacity: timer.fired ? 0.5 : 1,
      transition: 'all 0.3s',
    }}>
      <span style={{ fontSize: '18px', flexShrink: 0 }}>{relay?.icon ?? '⚡'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '11px', color: '#f8fafc', fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {relay?.name ?? `Relay ${timer.relayId}`}
        </span>
        <span style={{ fontSize: '9px', color: '#475569', fontFamily: 'monospace' }}>
          {new Date(timer.fireAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <span style={{
        fontSize: '9px', fontFamily: 'monospace', fontWeight: 700,
        padding: '2px 7px', borderRadius: '5px',
        background: isOn ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
        color: isOn ? '#ffffff' : '#555555', flexShrink: 0,
      }}>
        {timer.action}
      </span>
      <span style={{
        fontSize: '12px', fontFamily: 'monospace', fontWeight: 700,
        color: timer.fired ? '#22c55e' : urgent ? '#ffffff' : '#64748b',
        flexShrink: 0, minWidth: '52px', textAlign: 'right',
      }}>
        {timer.fired ? '✓ DONE' : formatCountdown(remaining)}
      </span>
      {!timer.fired && (
        <button
          onClick={() => onCancel(timer.id)}
          aria-label="Cancel timer"
          style={{
            width: '22px', height: '22px', borderRadius: '6px',
            background: 'transparent', border: '1px solid #2a2a2a',
            color: '#475569', cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '12px',
          }}
        >×</button>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────
function defaultDateTime() {
  const d = new Date(Date.now() + 5 * 60 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const INITIAL_FORM = { relayId: '', scheduledAt: '', action: 'ON' }

export default function Timer() {
  const { state: relayState }              = useRelayContext()
  const { toast }                          = useToast()
  const { setRobotExpression }             = useRobot()
  const { timers, addTimer, cancelTimer }  = useClientTimers()

  const [form, setForm]           = useState({ ...INITIAL_FORM, scheduledAt: defaultDateTime() })
  const [submitted, setSubmitted] = useState(null)

  const handleChange = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }, [])

  const validate = () => {
    if (!form.relayId)     return 'Please select a relay'
    if (!form.scheduledAt) return 'Please pick a date and time'
    if (new Date(form.scheduledAt) <= new Date()) return 'Schedule must be in the future'
    return null
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const err = validate()
    if (err) { toast(err, 'warn'); return }

    const relay = RELAY_CONFIG.find((r) => r.id === Number(form.relayId))
    addTimer({
      relayId:  Number(form.relayId),
      fireAt:   new Date(form.scheduledAt).toISOString(),
      action:   form.action,
      label:    relay?.name ?? `Relay ${form.relayId}`,
    })

    setSubmitted({
      relay:  relay?.name ?? `Relay ${form.relayId}`,
      action: form.action,
      time:   new Date(form.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    })
    setForm({ ...INITIAL_FORM, scheduledAt: defaultDateTime() })
    toast('Timer scheduled', 'success')
    setRobotExpression(EXPRESSIONS.SUCCESS, 'Timer set!', 2500)
  }

  return (
    <div className="flex w-full gap-0" style={{ height: '100dvh' }}>
      {/* Left — form */}
      <div className="flex-1 flex flex-col px-4 pb-4 min-w-0" style={{ paddingTop: 'max(env(safe-area-inset-top), 28px)' }}>
        <h1 className="text-white font-bold text-sm tracking-tight mb-3 shrink-0">Schedule Timer</h1>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3 flex-1">
          <Card className="p-3 flex flex-col gap-3 flex-1">
            {/* Relay selector */}
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Relay</p>
              <select
                value={form.relayId}
                onChange={(e) => handleChange('relayId', e.target.value)}
                className="w-full bg-surface-700 text-white border border-surface-600 rounded-xl px-3 py-2.5 text-sm min-h-[44px] focus:outline-none focus:border-accent transition-colors"
                style={{ colorScheme: 'dark' }}
              >
                <option value="">Select relay…</option>
                {RELAY_CONFIG.map((r) => (
                  <option key={r.id} value={r.id}>{r.icon} {r.name}</option>
                ))}
              </select>
            </div>
            {/* Action selector */}
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Action</p>
              <div className="flex gap-2">
                {['ON', 'OFF'].map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => handleChange('action', action)}
                    style={{
                      flex: 1, height: '40px', borderRadius: '10px',
                      border: `1.5px solid ${form.action === action ? '#ffffff' : '#2a2a2a'}`,
                      background: form.action === action ? 'rgba(255,255,255,0.1)' : 'transparent',
                      color: form.action === action ? '#ffffff' : '#555555',
                      fontSize: '11px', fontFamily: 'monospace', fontWeight: 700,
                      letterSpacing: '0.15em', cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >{action}</button>
                ))}
              </div>
            </div>
            {/* Datetime picker */}
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Fire at</p>
              <input
                type="datetime-local"
                value={form.scheduledAt}
                min={new Date().toISOString().slice(0, 16)}
                onChange={(e) => handleChange('scheduledAt', e.target.value)}
                className="w-full bg-surface-700 text-white border border-surface-600 rounded-xl px-3 py-2.5 text-sm min-h-[44px] focus:outline-none focus:border-accent transition-colors font-mono"
                style={{ colorScheme: 'dark' }}
              />
            </div>
            {/* Current relay states */}
            <div className="mt-auto">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Current State</p>
              <div className="flex gap-2 flex-wrap">
                {Object.values(relayState.relays).map((relay) => (
                  <span key={relay.id} style={{
                    fontSize: '9px', fontFamily: 'monospace', padding: '2px 7px', borderRadius: '5px',
                    background: relay.isOn ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
                    color: relay.isOn ? '#ffffff' : '#444444',
                  }}>
                    {relay.icon} {relay.isOn ? 'ON' : 'OFF'}
                  </span>
                ))}
              </div>
            </div>
          </Card>
          <Button type="submit" fullWidth size="md" disabled={!form.relayId || !form.scheduledAt}>
            Schedule
          </Button>
          {submitted && (
            <p className="text-xs text-slate-400 text-center font-mono">
              <span className="text-white">{submitted.relay}</span>
              {' → '}
              <span className={submitted.action === 'ON' ? 'text-white font-semibold' : 'text-slate-500 font-semibold'}>
                {submitted.action}
              </span>
              {' at '}{submitted.time}
            </p>
          )}
        </form>
      </div>

      {/* Right — timer list */}
      <div className="w-52 shrink-0 flex flex-col pb-4 pr-3" style={{ paddingTop: 'max(env(safe-area-inset-top), 28px)' }}>
        <div className="flex items-center justify-between mb-2 shrink-0">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">
            Scheduled
            {timers.filter(t => !t.fired).length > 0 && (
              <span className="ml-1.5 px-1 py-0.5 bg-white/10 text-white rounded text-[8px] font-mono">
                {timers.filter(t => !t.fired).length}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto flex-1">
          {timers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 opacity-30">
              <span style={{ fontSize: '24px' }}>⏱</span>
              <p className="text-[10px] font-mono text-slate-600 text-center">No timers scheduled</p>
            </div>
          ) : (
            timers.map((timer) => (
              <TimerRow key={timer.id} timer={timer} onCancel={cancelTimer} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

