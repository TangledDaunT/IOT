/**
 * Layout — ambient shell with idle screen, AI panel, and proactive alerts.
 *
 * Idle screen: live clock, date, relay status summary, HUD scanline grid.
 * AI panel: slides in from the right via '/' shortcut.
 * Proactive alerts: fires toast when relay ON >= 2h.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import RobotFace, { RobotSVG, useBlinking } from '../robot/RobotFace'
import { useRobot, EXPRESSIONS } from '../../context/RobotContext'
import { useRelayContext } from '../../context/RelayContext'
import ToastContainer from '../ToastContainer'
import VoiceMicButton from '../VoiceMicButton'
import GlobalShortcuts from '../GlobalShortcuts'
import AiPanel from '../AiPanel'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useRelayAlerts } from '../../hooks/useRelayAlerts'
import { useIdleVoice, IDLE_VOICE_PHASE } from '../../hooks/useIdleVoice'
import { RELAY_CONFIG } from '../../config'

// ── Live clock hook ───────────────────────────────────────────────────────
function useLiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

const IDLE_TIMEOUT = 45_000 // 45 s of inactivity → return to idle

// ─── Idle overlay ─────────────────────────────────────────────────────────
function IdleOverlay({ onWake }) {
  const { expression, setRobotExpression } = useRobot()
  const { state: relayState } = useRelayContext()
  const blinking  = useBlinking(expression)
  const [exiting, setExiting] = useState(false)
  const now = useLiveClock()

  // Compute relay states array for voice hook
  const relayStates = Object.values(relayState?.relays ?? {}).map((r) => ({ id: r.id, isOn: r.isOn }))

  const {
    phase, liveText, transcript, responseText, errorMsg,
    supportsSpeechRecognition,
  } = useIdleVoice({ enabled: !exiting, relayStates })

  // Mirror voice phase into robot expression
  useEffect(() => {
    if (phase === IDLE_VOICE_PHASE.LISTENING)  setRobotExpression(EXPRESSIONS.LOADING,  'Listening…',   0)
    else if (phase === IDLE_VOICE_PHASE.PROCESSING) setRobotExpression(EXPRESSIONS.THINKING, 'Processing…',  0)
    else if (phase === IDLE_VOICE_PHASE.RESPONDING) setRobotExpression(EXPRESSIONS.HAPPY,    'Responding…',  0)
  }, [phase, setRobotExpression])

  const handleTap = useCallback(() => {
    if (exiting) return
    setExiting(true)
    setTimeout(onWake, 650)
  }, [exiting, onWake])

  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const activeRelays = RELAY_CONFIG.filter((r) => relayState?.relays?.[r.id]?.isOn)
  const offCount     = RELAY_CONFIG.length - activeRelays.length
  const isVoiceActive = phase !== IDLE_VOICE_PHASE.IDLE

  return (
    <div
      onClick={handleTap}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: '#000000',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', userSelect: 'none',
        opacity: exiting ? 0 : 1,
        transition: 'opacity 0.55s ease',
        overflow: 'hidden',
      }}
    >
      {/* Subtle HUD grid */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />

      {/* Scanline */}
      {!exiting && (
        <div style={{
          position: 'absolute', left: 0, right: 0, height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)',
          animation: 'scanline 6s linear infinite',
          pointerEvents: 'none',
        }} />
      )}

      {/* Corner brackets */}
      {!exiting && ['tl','tr','bl','br'].map((c) => (
        <div key={c} style={{
          position: 'absolute',
          top: c[0] === 't' ? 16 : 'auto', bottom: c[0] === 'b' ? 16 : 'auto',
          left: c[1] === 'l' ? 16 : 'auto', right: c[1] === 'r' ? 16 : 'auto',
          width: '18px', height: '18px',
          borderTop:    c[0] === 't' ? '1px solid rgba(255,255,255,0.07)' : 'none',
          borderBottom: c[0] === 'b' ? '1px solid rgba(255,255,255,0.07)' : 'none',
          borderLeft:   c[1] === 'l' ? '1px solid rgba(255,255,255,0.07)' : 'none',
          borderRight:  c[1] === 'r' ? '1px solid rgba(255,255,255,0.07)' : 'none',
          pointerEvents: 'none',
        }} />
      ))}

      {/* Live clock — top */}
      {!exiting && (
        <div style={{ position: 'absolute', top: '32px', textAlign: 'center' }}>
          <div style={{ fontSize: 'clamp(20px, 4vw, 36px)', fontFamily: 'monospace', fontWeight: 300, letterSpacing: '0.1em', color: '#ffffff', fontVariantNumeric: 'tabular-nums' }}>
            {timeStr}
          </div>
          <div style={{ fontSize: '10px', fontFamily: 'monospace', letterSpacing: '0.2em', color: '#3a3a3a', textTransform: 'uppercase', marginTop: '4px' }}>
            {dateStr}
          </div>
        </div>
      )}

      {/* Robot + voice interaction area — centre */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
        transform: exiting ? 'translateY(110vh) scale(0.15)' : 'translateY(0) scale(1)',
        transformOrigin: 'center bottom',
        transition: exiting ? 'transform 0.6s cubic-bezier(0.55, 0, 1, 0.45)' : 'none',
        maxWidth: '360px', width: '100%', padding: '0 24px',
      }}>
        <RobotSVG size={180} expression={expression} blinking={blinking} />

        {/* ── Voice interaction panel ── */}
        {!exiting && (
          <div style={{
            minHeight: '76px',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: '7px',
            width: '100%', textAlign: 'center',
          }}>

            {/* LISTENING — blue dot + label + live words */}
            {phase === IDLE_VOICE_PHASE.LISTENING && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <span style={{
                    width: '7px', height: '7px', borderRadius: '50%',
                    background: '#4aa8ff', display: 'inline-block',
                    animation: 'vPulse 1s ease-in-out infinite',
                  }} />
                  <span style={{ fontSize: '10px', fontFamily: 'monospace', letterSpacing: '0.22em', color: '#4aa8ff', textTransform: 'uppercase' }}>
                    Listening
                  </span>
                </div>
                {liveText && (
                  <p style={{
                    color: '#d8d8d8', fontSize: '14px', fontFamily: 'monospace',
                    lineHeight: 1.45, marginTop: '4px', textAlign: 'left', width: '100%',
                    borderLeft: '2px solid rgba(74,168,255,0.45)', paddingLeft: '10px',
                  }}>
                    {liveText}
                  </p>
                )}
              </>
            )}

            {/* PROCESSING — pulsing indicator */}
            {phase === IDLE_VOICE_PHASE.PROCESSING && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span style={{
                  width: '7px', height: '7px', borderRadius: '50%',
                  background: '#555', display: 'inline-block',
                  animation: 'vPulse 0.7s ease-in-out infinite',
                }} />
                <span style={{ fontSize: '10px', fontFamily: 'monospace', letterSpacing: '0.22em', color: '#555', textTransform: 'uppercase' }}>
                  Thinking
                </span>
              </div>
            )}

            {/* RESPONDING — user text + streaming reply + cursor */}
            {phase === IDLE_VOICE_PHASE.RESPONDING && (
              <div style={{ width: '100%', textAlign: 'left' }}>
                {transcript && (
                  <p style={{
                    color: '#363636', fontSize: '11px', fontFamily: 'monospace',
                    marginBottom: '8px', letterSpacing: '0.02em',
                  }}>
                    you: &ldquo;{transcript}&rdquo;
                  </p>
                )}
                <p style={{
                  color: '#e8e8e8', fontSize: '14px', fontFamily: 'monospace',
                  lineHeight: 1.55, borderLeft: '2px solid rgba(255,255,255,0.14)',
                  paddingLeft: '10px',
                }}>
                  {responseText}
                  {responseText.length > 0 && (
                    <span style={{ animation: 'cursorBlink 1s step-end infinite', color: '#4aa8ff' }}>▋</span>
                  )}
                </p>
              </div>
            )}

            {/* Error (shown briefly before resetting to IDLE) */}
            {errorMsg && phase === IDLE_VOICE_PHASE.IDLE && (
              <p style={{ color: '#f05555', fontSize: '10px', fontFamily: 'monospace', letterSpacing: '0.1em' }}>
                {errorMsg}
              </p>
            )}

            {/* IDLE hint */}
            {phase === IDLE_VOICE_PHASE.IDLE && !errorMsg && (
              <p style={{
                color: '#1e1e1e', fontSize: '10px', letterSpacing: '0.2em',
                fontFamily: 'monospace', textTransform: 'uppercase',
              }}>
                {supportsSpeechRecognition ? 'say "hey buddy"' : 'tap to wake'}
              </p>
            )}

          </div>
        )}

        {/* Tap-to-wake label — only in IDLE phase */}
        {!exiting && !isVoiceActive && (
          <p style={{
            color: '#1c1c1c', fontSize: '10px', letterSpacing: '0.2em',
            fontFamily: 'monospace', textTransform: 'uppercase', marginTop: '2px',
          }}>
            tap to wake
          </p>
        )}

      </div>

      {/* Relay status — bottom */}
      {!exiting && (
        <div style={{ position: 'absolute', bottom: '28px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          {activeRelays.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {activeRelays.map((r) => (
                <span key={r.id} style={{
                  fontSize: '9px', fontFamily: 'monospace', letterSpacing: '0.07em',
                  textTransform: 'uppercase', color: '#ffffff',
                  padding: '2px 7px', border: '1px solid rgba(255,255,255,0.18)',
                  borderRadius: '3px', background: 'rgba(255,255,255,0.03)',
                }}>
                  {r.name} <span style={{ opacity: 0.5 }}>●</span>
                </span>
              ))}
            </div>
          )}
          <span style={{ fontSize: '9px', fontFamily: 'monospace', letterSpacing: '0.14em', color: '#2e2e2e', textTransform: 'uppercase' }}>
            {activeRelays.length === 0 ? 'ALL SYSTEMS OFFLINE' : `${activeRelays.length} ACTIVE · ${offCount} OFFLINE`}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Layout ────────────────────────────────────────────────────────────────
export default function Layout({ children }) {
  useWebSocket()
  useRelayAlerts()
  const [idleMode, setIdleMode] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const timerRef = useRef(null)

  const goIdle = useCallback(() => {
    setIdleMode(true)
    setChatOpen(false)
  }, [])

  const resetIdleTimer = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(goIdle, IDLE_TIMEOUT)
  }, [goIdle])

  const wakeUp = useCallback(() => {
    setIdleMode(false)
    resetIdleTimer()
  }, [resetIdleTimer])

  const handleActivity = useCallback(() => {
    if (!idleMode) resetIdleTimer()
  }, [idleMode, resetIdleTimer])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return (
    <div
      className="bg-surface-900 text-white"
      style={{ width: '100vw', height: '100dvh', overflow: 'hidden' }}
      onPointerMove={handleActivity}
      onPointerDown={handleActivity}
    >
      {/* Main content */}
      <div style={{ width: '100%', height: '100%', opacity: idleMode ? 0 : 1, transition: 'opacity 0.4s ease' }}>
        {children}
      </div>

      {/* Active UI — only when awake */}
      {!idleMode && <RobotFace />}
      {!idleMode && <ToastContainer />}
      {!idleMode && <VoiceMicButton />}
      {!idleMode && <GlobalShortcuts onOpenChat={() => setChatOpen(true)} />}
      {!idleMode && <AiPanel open={chatOpen} onClose={() => setChatOpen(false)} />}

      {/* Idle overlay */}
      {idleMode && <IdleOverlay onWake={wakeUp} />}
    </div>
  )
}
