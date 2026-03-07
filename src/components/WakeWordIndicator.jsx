/**
 * WakeWordIndicator — small HUD badge showing wake word listener status.
 *
 * Positioned top-right when active. Pulses when listening, flashes on detect.
 */
import React from 'react'
import { WAKE_STATES } from '../hooks/usePorcupineWakeWord'

const LABELS = {
  [WAKE_STATES.IDLE]:        null,         // hidden
  [WAKE_STATES.LOADING]:     'WAKE WORD…',
  [WAKE_STATES.LISTENING]:   'HEY BUDDY',
  [WAKE_STATES.DETECTED]:    '● DETECTED',
  [WAKE_STATES.ERROR]:       'WAKE ERR',
  [WAKE_STATES.UNSUPPORTED]: null,
}

const COLORS = {
  [WAKE_STATES.LOADING]:   '#3a3a3a',
  [WAKE_STATES.LISTENING]: '#2a2a2a',
  [WAKE_STATES.DETECTED]:  '#ffffff',
  [WAKE_STATES.ERROR]:     '#3a0000',
}

const TEXT_COLORS = {
  [WAKE_STATES.LOADING]:   '#555555',
  [WAKE_STATES.LISTENING]: '#444444',
  [WAKE_STATES.DETECTED]:  '#000000',
  [WAKE_STATES.ERROR]:     '#ef4444',
}

export default function WakeWordIndicator({ wakeState, wakeError }) {
  const label = LABELS[wakeState]
  if (!label) return null

  return (
    <div
      title={wakeError ?? label}
      style={{
        position: 'fixed', top: 24, right: 14, zIndex: 9990,
        background: COLORS[wakeState] ?? '#1a1a1a',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6, padding: '3px 8px',
        display: 'flex', alignItems: 'center', gap: 5,
        pointerEvents: 'none',
        animation: wakeState === WAKE_STATES.DETECTED ? 'vPulse 0.4s ease' : 'none',
        transition: 'background 0.3s',
      }}
    >
      {/* Dot */}
      <span style={{
        width: 5, height: 5, borderRadius: '50%',
        background: TEXT_COLORS[wakeState] ?? '#555555',
        flexShrink: 0,
        animation: wakeState === WAKE_STATES.LISTENING ? 'vPulse 2.5s ease-in-out infinite' : 'none',
      }} />
      <span style={{
        fontSize: 8, fontFamily: 'monospace', letterSpacing: '0.1em',
        color: TEXT_COLORS[wakeState] ?? '#555555',
        textTransform: 'uppercase',
        userSelect: 'none',
      }}>
        {label}
      </span>
    </div>
  )
}
