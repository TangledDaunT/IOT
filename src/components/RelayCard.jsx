/**
 * RelayCard — tap entire card to toggle relay.
 *
 * Whole card = toggle button. ON state → white glow ring.
 * Shows live ON-duration ticker while active.
 */
import React, { useRef, useEffect, useState } from 'react'

// Format seconds → "1h 23m" or "45s"
function fmtDuration(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const RelayCard = React.memo(function RelayCard({ relay, onToggle }) {
  const isOn    = relay.isOn
  const loading = relay.loading

  // Track ON-start time and live duration display
  const onSinceRef = useRef(null)
  const [duration, setDuration] = useState(null)

  useEffect(() => {
    if (isOn && onSinceRef.current === null) {
      onSinceRef.current = Date.now()
    } else if (!isOn) {
      onSinceRef.current = null
      setDuration(null)
    }
  }, [isOn])

  useEffect(() => {
    if (!isOn) return
    const id = setInterval(() => {
      if (onSinceRef.current) setDuration(Date.now() - onSinceRef.current)
    }, 1000)
    return () => clearInterval(id)
  }, [isOn])

  return (
    <button
      type="button"
      onClick={() => !loading && onToggle(relay.id, relay.isOn)}
      aria-label={`${relay.name} — ${isOn ? 'ON' : 'OFF'}, tap to toggle`}
      aria-pressed={isOn}
      disabled={loading}
      className={[
        'relative w-full h-full min-h-0 rounded-2xl border-2 flex flex-col items-center justify-center gap-2',
        'transition-all duration-300 select-none outline-none',
        'active:scale-[0.95]',
        isOn
          ? 'bg-white/5 border-white/25 shadow-[0_0_18px_2px_rgba(255,255,255,0.12)]'
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
          isOn ? 'text-white' : 'text-slate-400',
        ].join(' ')}
      >
        {relay.name}
      </span>

      {/* Status badge / spinner */}
      {loading ? (
        <span className="text-[10px] font-mono text-slate-400 tracking-widest animate-pulse">
          WAIT
        </span>
      ) : (
        <span
          className={[
            'text-[10px] font-mono font-bold tracking-widest',
            isOn ? 'text-white' : 'text-slate-600',
          ].join(' ')}
        >
          {isOn ? '● ON' : '○ OFF'}
        </span>
      )}

      {/* ON-duration ticker */}
      {isOn && duration !== null && !loading && (
        <span className="absolute bottom-2 left-0 right-0 text-center text-[9px] font-mono text-white/30 tracking-wider">
          {fmtDuration(duration)}
        </span>
      )}

      {/* Relay index badge — top right */}
      <span className="absolute top-2 right-2.5 text-[9px] font-mono text-slate-600">
        R{relay.id}
      </span>
    </button>
  )
})

export default RelayCard
