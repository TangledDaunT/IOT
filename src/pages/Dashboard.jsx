/**
 * Dashboard — landscape relay control panel.
 *
 * 4 relay cards filling the full screen in a row.
 * Each card IS the button — tap to toggle.
 * Landscape-first layout: full width, fills available height.
 */
import React from 'react'
import { useRelays } from '../hooks/useRelays'
import RelayCard from '../components/RelayCard'
import { MOCK_MODE } from '../config'

export default function Dashboard() {
  const { relays, globalLoading, handleToggle, refresh } = useRelays()
  const onCount = relays.filter((r) => r.isOn).length

  return (
    <div className="flex flex-col w-full" style={{ height: '100dvh' }}>
      {/* ── Top status bar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 shrink-0" style={{ paddingTop: 'max(env(safe-area-inset-top), 28px)', height: '52px' }}>
        <div className="flex items-center gap-3">
          <h1 className="text-white font-bold text-sm tracking-tight">
            Control Panel
          </h1>
          {MOCK_MODE && (
            <span className="px-1.5 py-0.5 bg-relay-warn/20 text-relay-warn text-[9px] rounded font-mono tracking-wide">
              MOCK
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 font-mono">
            <span className={onCount > 0 ? 'text-relay-on font-semibold' : ''}>{onCount}</span>
            <span className="text-slate-600"> / {relays.length} ON</span>
          </span>
          <button
            onClick={refresh}
            disabled={globalLoading}
            aria-label="Refresh"
            className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-accent transition-colors active:scale-90 disabled:opacity-40"
          >
            <RefreshIcon spinning={globalLoading} />
          </button>
        </div>
      </div>

      {/* ── Relay grid — fills remaining height ────────────────── */}
      <div className="flex-1 min-h-0 px-3 pb-3">
        {globalLoading && relays.every((r) => !r.isOn) ? (
          // Skeleton
          <div className="grid grid-cols-4 gap-3 h-full">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface-800 rounded-2xl animate-pulse border-2 border-surface-700" />
            ))}
          </div>
        ) : (
          /* 4 cards side by side in landscape */
          <div className="grid grid-cols-4 gap-3 h-full">
            {relays.map((relay) => (
              <RelayCard
                key={relay.id}
                relay={relay}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      width="18" height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={spinning ? { animation: 'spin 0.8s linear infinite' } : undefined}
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}
