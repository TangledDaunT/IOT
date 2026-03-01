/**
 * VoiceMicButton — floating microphone button with voice state visuals.
 *
 * Positioned bottom-left (robot is bottom-right, keeping corners clear).
 *
 * Visual states:
 *   idle       → grey mic, soft pulse
 *   recording  → red circle, animated bars + 8s ring countdown
 *   processing → blue circle, spinner
 *   executing  → green circle, checkmark spinner
 *   error      → red circle, × icon, shakes
 *
 * A speech-bubble above shows transcript / result / error text.
 * Latency stats shown in monospace below transcript (debugging aid).
 */
import React, { useEffect, useRef, useState } from 'react'
import { VOICE_STATES } from '../context/VoiceContext'
import { useVoiceCommand } from '../hooks/useVoiceCommand'

// ── Inline SVG icons ──────────────────────────────────────────────────────
function MicIcon({ color }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8"  y1="23" x2="16" y2="23" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6"  x2="6"  y2="18" />
      <line x1="6"  y1="6"  x2="18" y2="18" />
    </svg>
  )
}

// Animated bars — 3 vertical rects that bounce at different speeds
function RecordingBars() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '20px' }}>
      {[{ dur: '0.55s', delay: '0s' }, { dur: '0.4s', delay: '0.15s' }, { dur: '0.65s', delay: '0.05s' }].map((b, i) => (
        <div key={i} style={{
          width: '4px', height: '100%',
          background: '#ef4444', borderRadius: '2px',
          animation: `vBar ${b.dur} ease-in-out ${b.delay} infinite alternate`,
          transformOrigin: 'bottom',
        }} />
      ))}
    </div>
  )
}

// Thin ring showing 8-second recording countdown
function CountdownRing({ size = 56 }) {
  const r   = (size / 2) - 4
  const circ = 2 * Math.PI * r
  return (
    <svg
      width={size} height={size}
      style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)', pointerEvents: 'none' }}
    >
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="rgba(239,68,68,0.25)" strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="#ef4444" strokeWidth="3"
        strokeDasharray={circ}
        style={{ animation: 'vCountdown 8s linear forwards' }}
      />
    </svg>
  )
}

// ── State → style config ─────────────────────────────────────────────────
const S = VOICE_STATES
const CONFIG = {
  [S.IDLE]:       { size: 48, border: '#334155', bg: '#1e293b', shadow: 'none' },
  [S.RECORDING]:  { size: 56, border: '#ef4444', bg: '#2d0a0a', shadow: '0 0 16px 2px rgba(239,68,68,0.4)' },
  [S.PROCESSING]: { size: 48, border: '#38bdf8', bg: '#0a1525', shadow: '0 0 14px 2px rgba(56,189,248,0.35)' },
  [S.EXECUTING]:  { size: 48, border: '#22c55e', bg: '#0a1e10', shadow: '0 0 14px 2px rgba(34,197,94,0.4)' },
  [S.ERROR]:      { size: 48, border: '#ef4444', bg: '#2d0a0a', shadow: 'none' },
}

// ── Keyframes injected once ───────────────────────────────────────────────
const KEYFRAMES = `
  @keyframes vBar       { from { transform: scaleY(0.15); } to { transform: scaleY(1); } }
  @keyframes vSpin      { to   { transform: rotate(360deg); } }
  @keyframes vPulse     { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
  @keyframes vShake     { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
  @keyframes vCountdown { from { stroke-dashoffset: 0; } to { stroke-dashoffset: CIRC; } }
`

export default function VoiceMicButton() {
  const {
    voiceState, transcript, result, error, latency, settings, handleMicTap,
  } = useVoiceCommand()

  // Track whether keyframes have been injected
  const injectedRef = useRef(false)
  useEffect(() => {
    if (injectedRef.current) return
    injectedRef.current = true
    const style     = document.createElement('style')
    const r         = (56 / 2) - 4
    const circ      = 2 * Math.PI * r
    style.textContent = KEYFRAMES.replace('CIRC', `${circ}`)
    document.head.appendChild(style)
  }, [])

  if (!settings.enabled) return null

  const cfg     = CONFIG[voiceState] ?? CONFIG[S.IDLE]
  const isRec   = voiceState === S.RECORDING
  const isProc  = voiceState === S.PROCESSING
  const isExec  = voiceState === S.EXECUTING
  const isErr   = voiceState === S.ERROR
  const isIdle  = voiceState === S.IDLE
  const isBusy  = isProc || isExec

  // Bubble label: result > transcript (quoted) > error
  const bubbleText  = result || (isErr && error ? error : null) || (transcript ? `"${transcript}"`.slice(0, 44) : null)
  const bubbleColor = isErr ? '#ef4444' : result ? '#22c55e' : '#cbd5e1'

  return (
    <div style={{
      position: 'fixed', bottom: '12px', left: '12px',
      zIndex: 9998, userSelect: 'none',
    }}>
      {/* Speech-bubble above button */}
      {bubbleText && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: '8px',
          background: '#1e293b', border: '1px solid #334155',
          borderRadius: '10px', borderBottomLeftRadius: 0,
          padding: '6px 10px', fontSize: '11px', color: bubbleColor,
          whiteSpace: 'nowrap', maxWidth: '220px',
          overflow: 'hidden', textOverflow: 'ellipsis',
          boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
          lineHeight: 1.4,
        }}>
          {bubbleText}
          {latency.sttMs && (
            <span style={{ fontSize: '9px', color: '#475569', marginLeft: '6px', fontFamily: 'monospace' }}>
              {latency.sttMs}ms
            </span>
          )}
          {/* Arrow */}
          <span style={{
            position: 'absolute', bottom: '-7px', left: '12px', width: 0, height: 0,
            borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
            borderTop: '7px solid #334155',
          }} />
        </div>
      )}

      {/* Button wrapper (relative for countdown ring positioning) */}
      <div style={{ position: 'relative', width: `${cfg.size}px`, height: `${cfg.size}px` }}>
        {isRec && <CountdownRing size={cfg.size} />}

        <button
          onClick={() => handleMicTap()}
          disabled={isBusy}
          aria-label={isRec ? 'Stop recording' : 'Start voice command'}
          style={{
            width:        `${cfg.size}px`,
            height:       `${cfg.size}px`,
            borderRadius: '50%',
            border:       `2px solid ${cfg.border}`,
            background:   cfg.bg,
            boxShadow:    cfg.shadow,
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            cursor:       isBusy ? 'not-allowed' : 'pointer',
            transition:   'all 0.22s ease',
            outline:      'none',
            WebkitTapHighlightColor: 'transparent',
            animation:    isIdle
              ? 'vPulse 3s ease-in-out infinite'
              : isErr
              ? 'vShake 0.35s ease-in-out'
              : 'none',
          }}
        >
          {isRec  && <RecordingBars />}
          {isBusy && (
            <span style={{
              width: '18px', height: '18px',
              border: `2.5px solid ${isExec ? '#22c55e' : '#38bdf8'}`,
              borderTopColor: 'transparent',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'vSpin 0.7s linear infinite',
            }} />
          )}
          {(isIdle || isErr) && <MicIcon color={isErr ? '#ef4444' : '#64748b'} />}
        </button>
      </div>

      {/* State label beneath the button */}
      <div style={{
        textAlign: 'center', marginTop: '4px',
        fontSize: '8px', letterSpacing: '0.1em',
        fontFamily: 'monospace', textTransform: 'uppercase',
        color: isRec ? '#ef4444' : isProc ? '#38bdf8' : isExec ? '#22c55e' : isErr ? '#ef4444' : '#334155',
      }}>
        {isIdle  && 'voice'}
        {isRec   && 'rec ●'}
        {isProc  && 'stt…'}
        {isExec  && 'exec…'}
        {isErr   && 'error'}
      </div>
    </div>
  )
}
