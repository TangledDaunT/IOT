/**
 * RelayCard — tap entire card to toggle relay.
 *
 * No toggle switch. No small buttons.
 * The whole card IS the button.
 * ON state → card turns green with a glow ring.
 * OFF state → dark slate.
 */
import React from 'react'

const RelayCard = React.memo(function RelayCard({ relay, onToggle }) {
  const isOn    = relay.isOn
  const loading = relay.loading

  return (
    <button
      type="button"
      onClick={() => !loading && onToggle(relay.id, relay.isOn)}
      aria-label={`${relay.name} — ${isOn ? 'ON' : 'OFF'}, tap to toggle`}
      aria-pressed={isOn}
      disabled={loading}
      className={[
        // Fill the grid cell completely
        'relative w-full h-full min-h-0 rounded-2xl border-2 flex flex-col items-center justify-center gap-2',
        'transition-all duration-300 select-none outline-none',
        'active:scale-[0.95]',
        // ON state — vivid green
        isOn
          ? 'bg-relay-on/20 border-relay-on shadow-[0_0_20px_2px_rgba(34,197,94,0.35)]'
          : 'bg-surface-800 border-surface-600/50',
        loading ? 'opacity-60 cursor-wait' : 'cursor-pointer',
      ].join(' ')}
    >
      {/* Icon */}
      <span className="text-3xl leading-none" role="img" aria-hidden>
        {relay.icon}
      </span>

      {/* Name */}
      <span
        className={[
          'text-xs font-semibold tracking-wide text-center px-1 leading-tight',
          isOn ? 'text-relay-on' : 'text-slate-400',
        ].join(' ')}
      >
        {relay.name}
      </span>

      {/* Status badge */}
      {loading ? (
        <span className="text-[10px] font-mono text-relay-warn tracking-widest animate-pulse">
          WAIT
        </span>
      ) : (
        <span
          className={[
            'text-[10px] font-mono font-bold tracking-widest',
            isOn ? 'text-relay-on' : 'text-slate-600',
          ].join(' ')}
        >
          {isOn ? '● ON' : '○ OFF'}
        </span>
      )}

      {/* Relay index badge — top right corner */}
      <span className="absolute top-2 right-2.5 text-[9px] font-mono text-slate-600">
        R{relay.id}
      </span>
    </button>
  )
})

export default RelayCard
