/**
 * Layout — minimal shell with idle-screen mode.
 *
 * When idle (default on load, or after IDLE_TIMEOUT ms of no interaction):
 *   - A full-screen overlay shows the robot centred large.
 * On tap:
 *   - Robot animates down off-screen, overlay fades out.
 *   - Main content fades in.
 * After IDLE_TIMEOUT ms of inactivity the idle screen returns.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import RobotFace, { RobotSVG, useBlinking } from '../robot/RobotFace'
import { useRobot, EXPRESSIONS } from '../../context/RobotContext'
import ToastContainer from '../ToastContainer'
import VoiceMicButton from '../VoiceMicButton'
import { useWebSocket } from '../../hooks/useWebSocket'

const IDLE_TIMEOUT = 45_000 // 45 s of inactivity → return to idle

// ─── Idle overlay ─────────────────────────────────────────────────────────
function IdleOverlay({ onWake }) {
  const { expression } = useRobot()
  const blinking = useBlinking(expression)
  const [exiting, setExiting] = useState(false)

  const handleTap = useCallback(() => {
    if (exiting) return
    setExiting(true)
    // Give animation time to play, then hand control back to Layout
    setTimeout(onWake, 650)
  }, [exiting, onWake])

  return (
    <div
      onClick={handleTap}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: '#000000',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', userSelect: 'none',
        // Fade the whole overlay out as the robot flies away
        opacity: exiting ? 0 : 1,
        transition: 'opacity 0.55s ease',
      }}
    >
      {/* Robot — slides down + shrinks when exiting */}
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px',
          transform: exiting ? 'translateY(110vh) scale(0.15)' : 'translateY(0) scale(1)',
          transformOrigin: 'center bottom',
          transition: exiting ? 'transform 0.6s cubic-bezier(0.55, 0, 1, 0.45)' : 'none',
        }}
      >
        <RobotSVG size={180} expression={expression} blinking={blinking} />

        {!exiting && (
          <p style={{
            color: '#333333',
            fontSize: '12px',
            letterSpacing: '0.18em',
            fontFamily: 'monospace',
            textTransform: 'uppercase',
            marginTop: '4px',
          }}>
            tap to wake
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Layout ────────────────────────────────────────────────────────────────
export default function Layout({ children }) {
  // Start WebSocket + device polling once here — single mount point
  useWebSocket()

  const [idleMode, setIdleMode] = useState(true)
  const timerRef = useRef(null)

  const goIdle = useCallback(() => setIdleMode(true), [])

  const resetIdleTimer = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(goIdle, IDLE_TIMEOUT)
  }, [goIdle])

  const wakeUp = useCallback(() => {
    setIdleMode(false)
    resetIdleTimer()
  }, [resetIdleTimer])

  // Any pointer activity while awake resets the idle countdown
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
      {/* Main content — always mounted, hidden behind overlay when idle */}
      <div style={{ width: '100%', height: '100%', opacity: idleMode ? 0 : 1, transition: 'opacity 0.4s ease' }}>
        {children}
      </div>

      {/* Corner robot and toasts only shown when awake */}
      {!idleMode && <RobotFace />}
      {!idleMode && <ToastContainer />}
      {!idleMode && <VoiceMicButton />}

      {/* Idle overlay sits on top of everything */}
      {idleMode && <IdleOverlay onWake={wakeUp} />}
    </div>
  )
}
