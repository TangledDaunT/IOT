/**
 * TimerInput — a date-time + action picker for scheduled relay commands.
 *
 * Uses native <input type="datetime-local"> which has good support on
 * Android WebView / Chrome Mobile — no third-party date picker needed.
 */
import React from 'react'

/**
 * @param {{
 *   relays: Array<{id: number, name: string}>,
 *   value: { relayId: string, scheduledAt: string, action: 'ON'|'OFF' },
 *   onChange: (field: string, value: string) => void
 * }} props
 */
const TimerInput = React.memo(function TimerInput({ relays, value, onChange }) {
  // Build minimum datetime string (now + 1 min) for the picker
  const minDateTime = (() => {
    const d = new Date(Date.now() + 60 * 1000)
    // datetime-local expects "YYYY-MM-DDTHH:mm"
    return d.toISOString().slice(0, 16)
  })()

  return (
    <div className="flex flex-col gap-4">
      {/* Relay selector */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wide">
          Select Relay
        </label>
        <select
          value={value.relayId}
          onChange={(e) => onChange('relayId', e.target.value)}
          className="w-full bg-surface-700 text-white border border-surface-600 rounded-xl px-4 py-3 min-h-[44px] appearance-none focus:outline-none focus:border-accent transition-colors"
        >
          <option value="">-- Choose relay --</option>
          {relays.map((r) => (
            <option key={r.id} value={r.id}>
              Relay {r.id} — {r.name}
            </option>
          ))}
        </select>
      </div>

      {/* Date & time picker */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wide">
          Schedule At
        </label>
        <input
          type="datetime-local"
          min={minDateTime}
          value={value.scheduledAt}
          onChange={(e) => onChange('scheduledAt', e.target.value)}
          className="w-full bg-surface-700 text-white border border-surface-600 rounded-xl px-4 py-3 min-h-[44px] focus:outline-none focus:border-accent transition-colors [color-scheme:dark]"
        />
      </div>

      {/* Action selector */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wide">
          Action
        </label>
        <div className="flex gap-3">
          {['ON', 'OFF'].map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => onChange('action', action)}
              className={[
                'flex-1 py-3 rounded-xl font-semibold text-sm transition-all min-h-[44px]',
                value.action === action
                  ? action === 'ON'
                    ? 'bg-relay-on text-white scale-[1.02]'
                    : 'bg-relay-err text-white scale-[1.02]'
                  : 'bg-surface-700 text-slate-400 hover:bg-surface-600',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {action}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
})

export default TimerInput
