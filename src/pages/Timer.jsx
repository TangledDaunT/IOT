/**
 * Timer — schedule a relay action. Landscape-optimised layout.
 * Left column: form. Right column: current relay states.
 */
import React, { useState, useCallback } from 'react'
import { useRelayContext } from '../context/RelayContext'
import { useToast } from '../context/ToastContext'
import { useRobot, EXPRESSIONS } from '../context/RobotContext'
import { createTimer } from '../services/timerService'
import TimerInput from '../components/ui/TimerInput'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { RELAY_CONFIG } from '../config'

const INITIAL_FORM = { relayId: '', scheduledAt: '', action: 'ON' }

export default function Timer() {
  const { state: relayState } = useRelayContext()
  const { toast } = useToast()
  const { setRobotExpression } = useRobot()

  const [form, setForm]       = useState(INITIAL_FORM)
  const [loading, setLoading] = useState(false)
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    const err = validate()
    if (err) { toast(err, 'warn'); return }

    setLoading(true)
    setRobotExpression(EXPRESSIONS.THINKING, 'Scheduling…', 0)
    try {
      const result = await createTimer({
        relayId: Number(form.relayId),
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        action: form.action,
      })
      setSubmitted(result)
      setForm(INITIAL_FORM)
      toast('Timer scheduled!', 'success')
      setRobotExpression(EXPRESSIONS.SUCCESS, 'Timer set! ⏱', 3000)
    } catch (err) {
      toast(err.message || 'Failed to schedule timer', 'error')
      setRobotExpression(EXPRESSIONS.ERROR, 'Schedule failed', 3000)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex w-full overflow-y-auto" style={{ height: '100dvh', paddingTop: 'max(env(safe-area-inset-top), 28px)' }}>
      {/* Left — form */}
      <div className="flex-1 flex flex-col px-4 pb-4 min-w-0">
        <h1 className="text-white font-bold text-sm tracking-tight mb-3 shrink-0">Schedule Timer</h1>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3 flex-1">
          <Card className="p-3 flex-1">
            <TimerInput relays={RELAY_CONFIG} value={form} onChange={handleChange} />
          </Card>
          <Button
            type="submit"
            fullWidth
            size="md"
            loading={loading}
            disabled={!form.relayId || !form.scheduledAt}
          >
            Schedule Command
          </Button>
          {submitted && (
            <div className="text-xs text-slate-400 text-center">
              <span className="text-relay-on font-semibold">{submitted.action}</span>
              {' → Relay '}{submitted.relayId}{' · '}
              {new Date(submitted.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </form>
      </div>

      {/* Right — current states */}
      <div className="w-40 shrink-0 px-3 pb-4 flex flex-col">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 mt-0 pt-0 shrink-0">Current</p>
        <div className="flex flex-col gap-1.5 overflow-y-auto">
          {Object.values(relayState.relays).map((relay) => (
            <div
              key={relay.id}
              className="flex items-center justify-between bg-surface-800 rounded-lg px-2 py-2"
            >
              <span className="text-xs text-slate-300 truncate">{relay.icon} {relay.name}</span>
              <span className={['text-[10px] font-mono font-bold ml-1 shrink-0', relay.isOn ? 'text-relay-on' : 'text-slate-600'].join(' ')}>
                {relay.isOn ? 'ON' : 'OFF'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
