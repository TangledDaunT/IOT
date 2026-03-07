/**
 * Logs — real-time event log with source filtering.
 *
 * Shows entries most-recent-first with:
 *   - Level dot (info/warn/error → green/amber/red)
 *   - Absolute timestamp (HH:MM:SS) + relative age
 *   - Source badge (relay, voice, timer, scene, device, ws, system)
 *   - Message text
 * Filter chips at top narrow to one source.
 * Clear button wipes localStorage.
 */
import React, { useState, useRef, useEffect } from 'react'
import { useLogContext } from '../context/LogContext'

// ── Colour maps ───────────────────────────────────────────────────────────
const LEVEL_COLOR = {
  info:  '#ffffff',
  warn:  '#888888',
  error: '#555555',
}

const SOURCE_COLOR = {
  relay:  { bg: 'rgba(255,255,255,0.06)', text: '#cccccc' },
  voice:  { bg: 'rgba(255,255,255,0.05)', text: '#aaaaaa' },
  timer:  { bg: 'rgba(255,255,255,0.05)', text: '#aaaaaa' },
  scene:  { bg: 'rgba(255,255,255,0.06)', text: '#cccccc' },
  device: { bg: 'rgba(255,255,255,0.05)', text: '#999999' },
  ws:     { bg: 'rgba(255,255,255,0.04)', text: '#888888' },
  system: { bg: 'rgba(255,255,255,0.04)', text: '#777777' },
}

// ── Helpers ───────────────────────────────────────────────────────────────
function fmtTime(ts) {
  const d = new Date(ts)
  return d.toTimeString().slice(0, 8)
}

function fmtRelative(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5)    return 'now'
  if (s < 60)   return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

const ALL_SOURCES = ['relay', 'voice', 'timer', 'scene', 'device', 'ws', 'system']

// ── Log row ───────────────────────────────────────────────────────────────
const LogRow = React.memo(function LogRow({ entry }) {
  const sc = SOURCE_COLOR[entry.source] ?? SOURCE_COLOR.system
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '8px',
      padding: '5px 10px',
      borderBottom: '1px solid #111111',
    }}>
      {/* Level dot */}
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
        background: LEVEL_COLOR[entry.level] ?? '#64748b',
        marginTop: '4px',
      }} />

      {/* Time */}
      <span style={{ fontSize: '9px', color: '#555555', fontFamily: 'monospace', flexShrink: 0, minWidth: '52px', paddingTop: '1px' }}>
        {fmtTime(entry.ts)}<br />
        <span style={{ color: '#333333' }}>{fmtRelative(entry.ts)}</span>
      </span>

      {/* Source badge */}
      <span style={{
        fontSize: '8px', fontFamily: 'monospace', letterSpacing: '0.08em',
        textTransform: 'uppercase', flexShrink: 0,
        background: sc.bg, color: sc.text,
        borderRadius: '4px', padding: '1px 5px',
        marginTop: '1px',
      }}>
        {entry.source}
      </span>

      {/* Message */}
      <span style={{ fontSize: '11px', color: '#cbd5e1', flex: 1, lineHeight: 1.4, wordBreak: 'break-word' }}>
        {entry.message}
      </span>
    </div>
  )
})

// ── Page ──────────────────────────────────────────────────────────────────
export default function Logs() {
  const { state, clearLogs }     = useLogContext()
  const [filter, setFilter]      = useState('all')
  const [, setTick]              = useState(0)
  const scrollRef                = useRef(null)
  const prevCountRef             = useRef(0)

  // Refresh relative timestamps every 10s
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 10_000)
    return () => clearInterval(t)
  }, [])

  // Auto-scroll only when new entries arrive and user is near top (entries are newest-first)
  const entries = filter === 'all'
    ? state.entries
    : state.entries.filter((e) => e.source === filter)

  useEffect(() => {
    if (entries.length > prevCountRef.current) {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
    prevCountRef.current = entries.length
  }, [entries.length])

  return (
    <div className="flex flex-col w-full" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 shrink-0"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 28px)', height: '52px' }}>
        <h1 className="text-white font-bold text-sm tracking-tight">Event Log</h1>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-slate-500 font-mono">{state.entries.length} entries</span>
          <button
            onClick={clearLogs}
            style={{
              fontSize: '9px', color: '#888888', background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
              padding: '2px 8px', cursor: 'pointer', fontFamily: 'monospace',
            }}
          >
            CLEAR
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: '5px', padding: '0 12px 8px', flexWrap: 'nowrap', overflowX: 'auto', flexShrink: 0 }}>
        {['all', ...ALL_SOURCES].map((src) => {
          const active = filter === src
          const sc = src === 'all' ? null : SOURCE_COLOR[src]
          return (
            <button
              key={src}
              onClick={() => setFilter(src)}
              style={{
                fontSize: '8px', fontFamily: 'monospace', letterSpacing: '0.1em',
                textTransform: 'uppercase', flexShrink: 0,
                border: active ? '1px solid ' + (sc?.text ?? '#94a3b8') : '1px solid #1e293b',
                background: active ? (sc?.bg ?? 'rgba(148,163,184,0.1)') : 'transparent',
                color: active ? (sc?.text ?? '#94a3b8') : '#475569',
                borderRadius: '6px', padding: '3px 8px', cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {src}
            </button>
          )
        })}
      </div>

      {/* Log list */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ background: '#000000' }}
      >
        {entries.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#333333', fontSize: '11px', fontFamily: 'monospace', marginTop: '40px' }}>
            No log entries
          </div>
        ) : (
          entries.map((e) => <LogRow key={e.id} entry={e} />)
        )}
      </div>
    </div>
  )
}
