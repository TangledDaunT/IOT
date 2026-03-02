/**
 * RobotFace — sleek blue robot companion widget.
 *
 * Design: dark navy rounded-rect head, horizontal glowing pill eyes,
 * side ear bumps, glowing antenna tip. Matches the cute AI-robot aesthetic.
 *
 * Exports:
 *   default   RobotFace   — corner overlay widget
 *   named     RobotSVG    — pure SVG render (used by idle screen at any size)
 *   named     useBlinking — blink controller hook (used by idle screen)
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useRobot, EXPRESSIONS } from '../../context/RobotContext'
import { useRelayContext } from '../../context/RelayContext'

// ─── Blink controller (exported for reuse in IdleOverlay) ─────────────────
export function useBlinking(expression) {
  const [blinking, setBlinking] = useState(false)
  const timerRef = useRef(null)

  const scheduleBlink = useCallback(() => {
    const delay = 2500 + Math.random() * 3000
    timerRef.current = setTimeout(() => {
      setBlinking(true)
      setTimeout(() => {
        setBlinking(false)
        scheduleBlink()
      }, 120)
    }, delay)
  }, [])

  useEffect(() => {
    const noBlinkExprs = [
      EXPRESSIONS.HAPPY, EXPRESSIONS.LOADING,
      EXPRESSIONS.SUCCESS, EXPRESSIONS.ERROR, EXPRESSIONS.SLEEPING,
    ]
    if (noBlinkExprs.includes(expression)) {
      clearTimeout(timerRef.current)
      setBlinking(false)
      return
    }
    scheduleBlink()
    return () => clearTimeout(timerRef.current)
  }, [expression, scheduleBlink])

  return blinking
}

// ─── Expression configs ────────────────────────────────────────────────────
const EXPRESSION_CONFIG = {
  [EXPRESSIONS.IDLE]:     { headColor: '#0a0a0a', borderColor: '#333333', eyeColor: '#ffffff', glowColor: 'rgba(255,255,255,0.08)', cheekColor: null,                   antennaColor: '#ffffff' },
  [EXPRESSIONS.HAPPY]:    { headColor: '#0a0a0a', borderColor: '#ffffff', eyeColor: '#ffffff', glowColor: 'rgba(255,255,255,0.15)', cheekColor: 'rgba(255,255,255,0.1)', antennaColor: '#ffffff' },
  [EXPRESSIONS.THINKING]: { headColor: '#0a0a0a', borderColor: '#888888', eyeColor: '#cccccc', glowColor: 'rgba(255,255,255,0.06)', cheekColor: null,                   antennaColor: '#888888' },
  [EXPRESSIONS.LOADING]:  { headColor: '#000000', borderColor: '#aaaaaa', eyeColor: '#aaaaaa', glowColor: 'rgba(255,255,255,0.08)', cheekColor: null,                   antennaColor: '#aaaaaa' },
  [EXPRESSIONS.SUCCESS]:  { headColor: '#0a0a0a', borderColor: '#ffffff', eyeColor: '#ffffff', glowColor: 'rgba(255,255,255,0.2)',  cheekColor: 'rgba(255,255,255,0.1)', antennaColor: '#ffffff' },
  [EXPRESSIONS.ERROR]:    { headColor: '#0a0a0a', borderColor: '#666666', eyeColor: '#888888', glowColor: 'rgba(255,255,255,0.04)', cheekColor: null,                   antennaColor: '#666666' },
  [EXPRESSIONS.SLEEPING]: { headColor: '#000000', borderColor: '#222222', eyeColor: '#2a2a2a', glowColor: null,                     cheekColor: null,                   antennaColor: '#222222' },
}

// ─── Eye geometry (viewBox 0 0 100 112) ────────────────────────────────────
// Left eye center: cx=30, cy=44 | Right eye center: cx=70, cy=44
// Pill dimensions: width=28, height=14
const EW = 28
const EH = 14

function PillSocket({ cx, cy }) {
  return <rect x={cx - EW / 2} y={cy - EH / 2} width={EW} height={EH} rx={EH / 2} fill="#000000" />
}

// Normal glowing pill
function EyePill({ cx, cy, color, blinking }) {
  return (
    <g style={{ transformOrigin: `${cx}px ${cy}px`, transform: blinking ? 'scaleY(0.06)' : 'scaleY(1)', transition: 'transform 0.07s ease-in-out' }}>
      <PillSocket cx={cx} cy={cy} />
      <rect x={cx - EW / 2 + 2} y={cy - EH / 2 + 2} width={EW - 4} height={EH - 4} rx={(EH - 4) / 2} fill={color} />
      <ellipse cx={cx - 6} cy={cy - 2} rx={4} ry={2.5} fill="white" opacity={0.35} />
    </g>
  )
}

// Happy — squinted top-arc only
function EyeHappy({ cx, cy, color }) {
  const y = cy - EH / 2
  return (
    <g>
      <PillSocket cx={cx} cy={cy} />
      <clipPath id={`hc${cx}`}>
        <rect x={cx - EW / 2 - 1} y={y - 1} width={EW + 2} height={EH / 2 + 1} />
      </clipPath>
      <rect x={cx - EW / 2 + 2} y={cy - EH / 2 + 2} width={EW - 4} height={EH - 4} rx={(EH - 4) / 2} fill={color} clipPath={`url(#hc${cx})`} />
      <path d={`M ${cx - EW / 2 + 3} ${cy + 1} Q ${cx} ${cy - EH / 2} ${cx + EW / 2 - 3} ${cy + 1}`} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </g>
  )
}

// Sleeping — flat line
function EyeSleeping({ cx, cy }) {
  return (
    <g>
      <PillSocket cx={cx} cy={cy} />
      <line x1={cx - 9} y1={cy} x2={cx + 9} y2={cy} stroke="#333333" strokeWidth={2.5} strokeLinecap="round" />
    </g>
  )
}

// Loading — spinning ring
function EyeLoading({ cx, cy, color }) {
  return (
    <g>
      <PillSocket cx={cx} cy={cy} />
      <circle cx={cx} cy={cy} r={4} fill="none" stroke={color} strokeWidth={2} strokeDasharray="7 7"
        style={{ transformOrigin: `${cx}px ${cy}px`, animation: 'spin 0.8s linear infinite' }} />
    </g>
  )
}

// Success — 4-point star inside pill
function EyeStar({ cx, cy, color }) {
  return (
    <g>
      <PillSocket cx={cx} cy={cy} />
      <clipPath id={`sc${cx}`}>
        <rect x={cx - EW / 2 + 1} y={cy - EH / 2 + 1} width={EW - 2} height={EH - 2} rx={(EH - 4) / 2} />
      </clipPath>
      <path
        d={`M${cx},${cy - 5} L${cx + 1.8},${cy - 1.8} L${cx + 5},${cy} L${cx + 1.8},${cy + 1.8} L${cx},${cy + 5} L${cx - 1.8},${cy + 1.8} L${cx - 5},${cy} L${cx - 1.8},${cy - 1.8} Z`}
        fill={color} clipPath={`url(#sc${cx})`}
      />
    </g>
  )
}

// Error — × marks
function EyeError({ cx, cy }) {
  return (
    <g>
      <PillSocket cx={cx} cy={cy} />
      <line x1={cx - 5} y1={cy - 4} x2={cx + 5} y2={cy + 4} stroke="#888888" strokeWidth={2.5} strokeLinecap="round" />
      <line x1={cx + 5} y1={cy - 4} x2={cx - 5} y2={cy + 4} stroke="#888888" strokeWidth={2.5} strokeLinecap="round" />
    </g>
  )
}

// Thinking — one eye squinted
function EyeThinkingSquint({ cx, cy, color }) {
  return (
    <g>
      <PillSocket cx={cx} cy={cy} />
      <rect x={cx - EW / 2 + 2} y={cy - 3} width={EW - 4} height={6} rx={3} fill={color} opacity={0.7} />
    </g>
  )
}

// ─── Mouth renderers ────────────────────────────────────────────────────────
function MouthNeutral() {
  return <path d="M 36 72 Q 50 78 64 72" fill="none" stroke="#333333" strokeWidth={2.5} strokeLinecap="round" />
}
function MouthHappy() {
  return (
    <g>
      <path d="M 30 68 Q 50 84 70 68" fill="#ffffff" opacity={0.15} />
      <path d="M 30 68 Q 50 84 70 68" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" />
      <rect x={35} y={68} width={30} height={6} fill="white" rx={2} opacity={0.9} />
    </g>
  )
}
function MouthThinking() {
  return <path d="M 36 72 Q 46 66 64 70" fill="none" stroke="#333333" strokeWidth={2.5} strokeLinecap="round" />
}
function MouthLoading() {
  return <circle cx={50} cy={72} r={7} fill="none" stroke="#334155" strokeWidth={2} strokeDasharray="14 10"
    style={{ transformOrigin: '50px 72px', animation: 'spin 1.2s linear infinite' }} />
}
function MouthSuccess() {
  return (
    <g>
      <path d="M 28 66 Q 50 84 72 66" fill="#22c55e" opacity={0.5} />
      <path d="M 28 66 Q 50 84 72 66" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" />
      <rect x={33} y={66} width={34} height={7} fill="white" rx={2} opacity={0.9} />
    </g>
  )
}
function MouthError() {
  return <path d="M 36 76 Q 50 64 64 76" fill="none" stroke="#ef4444" strokeWidth={2.5} strokeLinecap="round" />
}
function MouthSleeping() {
  return <path d="M 43 70 Q 50 74 57 70" fill="none" stroke="#1e293b" strokeWidth={2} strokeLinecap="round" />
}

// ─── ZZZ element ────────────────────────────────────────────────────────────
function ZzzElement() {
  return (
    <div className="absolute -top-5 -right-3 pointer-events-none select-none">
      <span className="text-slate-500 font-bold" style={{ fontSize: '10px', animation: 'zFloat 2s ease-in-out infinite', display: 'block' }}>Z</span>
      <span className="text-slate-600 font-bold" style={{ fontSize: '9px',  animation: 'zFloat 2s ease-in-out infinite 0.5s', display: 'block', marginLeft: '6px',  marginTop: '-2px' }}>z</span>
      <span className="text-slate-700 font-bold" style={{ fontSize: '7px',  animation: 'zFloat 2s ease-in-out infinite 1s',   display: 'block', marginLeft: '10px', marginTop: '-2px' }}>z</span>
    </div>
  )
}

// ─── Speech bubble ───────────────────────────────────────────────────────────
function SpeechBubble({ message }) {
  if (!message) return null
  return (
    <div className="absolute bottom-full mb-2 right-0 max-w-[160px] bg-surface-700 border border-surface-600 rounded-2xl rounded-br-none px-3 py-2 text-xs text-white shadow-lg pointer-events-none whitespace-nowrap">
      {message}
      <span className="absolute -bottom-2 right-3 w-0 h-0"
        style={{ borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '8px solid #334155' }} />
    </div>
  )
}

// ─── RobotSVG — pure visual, exported for idle screen ───────────────────────
export function RobotSVG({ size = 90, expression = EXPRESSIONS.IDLE, blinking = false }) {
  const cfg = EXPRESSION_CONFIG[expression] ?? EXPRESSION_CONFIG[EXPRESSIONS.IDLE]
  const Lx = 30, Rx = 70, Ey = 44

  const renderEyes = () => {
    switch (expression) {
      case EXPRESSIONS.HAPPY:
        return <><EyeHappy cx={Lx} cy={Ey} color={cfg.eyeColor} /><EyeHappy cx={Rx} cy={Ey} color={cfg.eyeColor} /></>
      case EXPRESSIONS.THINKING:
        return <><EyePill cx={Lx} cy={Ey} color={cfg.eyeColor} blinking={false} /><EyeThinkingSquint cx={Rx} cy={Ey} color={cfg.eyeColor} /></>
      case EXPRESSIONS.LOADING:
        return <><EyeLoading cx={Lx} cy={Ey} color={cfg.eyeColor} /><EyeLoading cx={Rx} cy={Ey} color={cfg.eyeColor} /></>
      case EXPRESSIONS.SUCCESS:
        return <><EyeStar cx={Lx} cy={Ey} color={cfg.eyeColor} /><EyeStar cx={Rx} cy={Ey} color={cfg.eyeColor} /></>
      case EXPRESSIONS.ERROR:
        return <><EyeError cx={Lx} cy={Ey} /><EyeError cx={Rx} cy={Ey} /></>
      case EXPRESSIONS.SLEEPING:
        return <><EyeSleeping cx={Lx} cy={Ey} /><EyeSleeping cx={Rx} cy={Ey} /></>
      default:
        return <><EyePill cx={Lx} cy={Ey} color={cfg.eyeColor} blinking={blinking} /><EyePill cx={Rx} cy={Ey} color={cfg.eyeColor} blinking={blinking} /></>
    }
  }

  const renderMouth = () => {
    switch (expression) {
      case EXPRESSIONS.HAPPY:    return <MouthHappy />
      case EXPRESSIONS.THINKING: return <MouthThinking />
      case EXPRESSIONS.LOADING:  return <MouthLoading />
      case EXPRESSIONS.SUCCESS:  return <MouthSuccess />
      case EXPRESSIONS.ERROR:    return <MouthError />
      case EXPRESSIONS.SLEEPING: return <MouthSleeping />
      default:                   return <MouthNeutral />
    }
  }

  return (
    <svg
      width={size} height={Math.round(size * 1.12)}
      viewBox="0 0 100 112"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ filter: cfg.glowColor ? `drop-shadow(0 0 12px ${cfg.glowColor})` : undefined }}
    >
      {/* Antenna */}
      <line x1="50" y1="11" x2="50" y2="20" stroke={cfg.antennaColor} strokeWidth="3" strokeLinecap="round" />
      <circle cx="50" cy="7" r="5.5" fill={cfg.antennaColor} opacity="0.9" />
      <circle cx="50" cy="7" r="2.5" fill="white" opacity="0.65" />

      {/* Head */}
      <rect x="8" y="20" width="84" height="72" rx="21"
        fill={cfg.headColor} stroke={cfg.borderColor} strokeWidth="2.5" />

      {/* Inner bevel detail */}
      <rect x="14" y="27" width="72" height="58" rx="15"
        fill="none" stroke={cfg.borderColor} strokeWidth="1" opacity="0.25" />

      {/* Left ear */}
      <rect x="1" y="36" width="11" height="30" rx="5.5"
        fill={cfg.headColor} stroke={cfg.borderColor} strokeWidth="2" />
      <circle cx="6.5" cy="51" r="2" fill={cfg.borderColor} opacity="0.5" />

      {/* Right ear */}
      <rect x="88" y="36" width="11" height="30" rx="5.5"
        fill={cfg.headColor} stroke={cfg.borderColor} strokeWidth="2" />
      <circle cx="93.5" cy="51" r="2" fill={cfg.borderColor} opacity="0.5" />

      {/* Cheeks (happy / success only) */}
      {cfg.cheekColor && (
        <>
          <ellipse cx="19" cy="59" rx="8" ry="5" fill={cfg.cheekColor} />
          <ellipse cx="81" cy="59" rx="8" ry="5" fill={cfg.cheekColor} />
        </>
      )}

      {renderEyes()}
      {renderMouth()}

      {/* Chin vent */}
      <rect x="37" y="85" width="26" height="4" rx="2" fill={cfg.borderColor} opacity="0.35" />
      <circle cx="44" cy="87" r="1.2" fill={cfg.borderColor} opacity="0.5" />
      <circle cx="50" cy="87" r="1.2" fill={cfg.borderColor} opacity="0.5" />
      <circle cx="56" cy="87" r="1.2" fill={cfg.borderColor} opacity="0.5" />
    </svg>
  )
}

// ─── Corner widget ──────────────────────────────────────────────────────────
export default function RobotFace() {
  const { expression, message, minimized, toggleMinimized } = useRobot()
  const { state: relayState } = useRelayContext()
  const blinking = useBlinking(expression)
  const cfg = EXPRESSION_CONFIG[expression] ?? EXPRESSION_CONFIG[EXPRESSIONS.IDLE]

  const onCount    = Object.values(relayState.relays).filter((r) => r.isOn).length
  const totalCount = Object.values(relayState.relays).length

  if (minimized) {
    return (
      <button
        onClick={toggleMinimized}
        className="fixed bottom-3 right-3 z-[9999] w-12 h-12 bg-surface-800 border-2 rounded-full flex items-center justify-center shadow-xl active:scale-90 transition-transform"
        style={{ borderColor: cfg.borderColor }}
        aria-label="Expand robot"
      >
        🤖
        {onCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-relay-on text-white text-[9px] font-bold flex items-center justify-center shadow">
            {onCount}
          </span>
        )}
      </button>
    )
  }

  return (
    <div
      className="fixed bottom-3 right-3 z-[9999] select-none"
      style={{ animation: 'robotFloat 4s ease-in-out infinite' }}
    >
      <SpeechBubble message={message} />
      <button onClick={toggleMinimized} className="block relative" aria-label="IoT Robot assistant">
        {expression === EXPRESSIONS.SLEEPING && <ZzzElement />}

        {/* Active relay counter badge */}
        <div className="absolute -top-2 -left-2 z-10">
          <span
            className={[
              'w-7 h-7 rounded-full border-2 flex flex-col items-center justify-center shadow-lg',
              onCount > 0
                ? 'bg-relay-on/90 border-relay-on text-white'
                : 'bg-surface-700 border-surface-600 text-slate-400',
            ].join(' ')}
            title={`${onCount} of ${totalCount} relays ON`}
          >
            <span className="text-[10px] font-bold leading-none">{onCount}</span>
            <span className="text-[6px] leading-none opacity-70">ON</span>
          </span>
        </div>

        <RobotSVG size={78} expression={expression} blinking={blinking} />
      </button>
    </div>
  )
}
