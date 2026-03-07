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
import React, { useEffect } from 'react'
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

// CrossIcon removed - was unused

// Animated bars — 3 vertical rects that bounce at different speeds
function RecordingBars() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '20px' }}>
      {[{ dur: '0.55s', delay: '0s' }, { dur: '0.4s', delay: '0.15s' }, { dur: '0.65s', delay: '0.05s' }].map((b, i) => (
        <div key={i} style={{
          width: '4px', height: '100%',
          background: '#ffffff', borderRadius: '2px',
          animation: `vBar ${b.dur} ease-in-out ${b.delay} infinite alternate`,
          transformOrigin: 'bottom',
        }} />
      ))}
    </div>
  )
}

// Thin ring showing 8-second recording countdown
// Size 56, radius 24, circumference ≈ 150.8 (matches keyframe in index.css)
function CountdownRing({ size = 56 }) {
  const r = (size / 2) - 4
  return (
    <svg
      width={size} height={size}
      style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)', pointerEvents: 'none' }}
    >
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="#ffffff" strokeWidth="3"
        strokeDasharray={150.8}
        style={{ animation: 'vCountdown 8s linear forwards' }}
      />
    </svg>
  )
}

// ── State → style config ─────────────────────────────────────────────────
const S = VOICE_STATES
const CONFIG = {
  [S.IDLE]:       { size: 48, border: '#333333', bg: '#111111', shadow: 'none' },
  [S.RECORDING]:  { size: 56, border: '#ffffff', bg: '#1a1a1a', shadow: '0 0 16px 2px rgba(255,255,255,0.2)' },
  [S.PROCESSING]: { size: 48, border: '#888888', bg: '#111111', shadow: 'none' },
  [S.EXECUTING]:  { size: 48, border: '#ffffff', bg: '#1a1a1a', shadow: '0 0 14px 2px rgba(255,255,255,0.2)' },
  [S.ERROR]:      { size: 48, border: '#555555', bg: '#111111', shadow: 'none' },
}

// Keyframes are defined in index.css for better performance

export default function VoiceMicButton() {
  const {
    voiceState, transcript, result, error, latency, settings, handleMicTap,
  } = useVoiceCommand()

  // Listen for keyboard shortcut events dispatched by GlobalShortcuts
  useEffect(() => {
    const onTrigger = () => handleMicTap()
    const onStop = () => {
      if (voiceState === VOICE_STATES.RECORDING) handleMicTap()
    }
    window.addEventListener('iot:voice-trigger', onTrigger)
    window.addEventListener('iot:voice-stop', onStop)
    return () => {
      window.removeEventListener('iot:voice-trigger', onTrigger)
      window.removeEventListener('iot:voice-stop', onStop)
    }
  }, [handleMicTap, voiceState])

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
  const bubbleColor = isErr ? '#888888' : result ? '#ffffff' : '#cccccc'

  return (
    <div style={{
      position: 'fixed', bottom: '12px', left: '12px',
      zIndex: 9998, userSelect: 'none',
    }}>
      {/* Speech-bubble above button */}
      {bubbleText && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: '8px',
          background: '#1a1a1a', border: '1px solid #333333',
          borderRadius: '10px', borderBottomLeftRadius: 0,
          padding: '6px 10px', fontSize: '11px', color: bubbleColor,
          whiteSpace: 'nowrap', maxWidth: '220px',
          overflow: 'hidden', textOverflow: 'ellipsis',
          boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
          lineHeight: 1.4,
        }}>
          {bubbleText}
          {latency.sttMs && (
            <span style={{ fontSize: '9px', color: '#555555', marginLeft: '6px', fontFamily: 'monospace' }}>
              {latency.sttMs}ms
            </span>
          )}
          {/* Arrow */}
          <span style={{
            position: 'absolute', bottom: '-7px', left: '12px', width: 0, height: 0,
            borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
            borderTop: '7px solid #333333',
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
              border: `2.5px solid #ffffff`,
              borderTopColor: 'transparent',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'vSpin 0.7s linear infinite',
            }} />
          )}
          {(isIdle || isErr) && <MicIcon color={isErr ? '#555555' : '#555555'} />}
        </button>
      </div>

      {/* State label beneath the button */}
      <div style={{
        textAlign: 'center', marginTop: '4px',
        fontSize: '8px', letterSpacing: '0.1em',
        fontFamily: 'monospace', textTransform: 'uppercase',
        color: isRec ? '#ffffff' : isProc ? '#888888' : isExec ? '#ffffff' : isErr ? '#666666' : '#333333',
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
