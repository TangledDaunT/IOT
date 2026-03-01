/**
 * Navbar — bottom tab navigation bar.
 *
 * Placed at the bottom (thumb-friendly on mobile).
 * Tabs: Dashboard, Timer, Settings.
 * Uses NavLink for automatic active state styling.
 */
import React from 'react'
import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/',        label: 'Dashboard', icon: GridIcon },
  { to: '/timer',   label: 'Timer',     icon: ClockIcon },
  { to: '/settings',label: 'Settings',  icon: GearIcon },
]

export default function Navbar() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 bg-surface-800/95 backdrop-blur-sm border-t border-surface-600/50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex justify-around items-center h-16">
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                [
                  'flex flex-col items-center justify-center gap-1 w-full h-16 transition-colors',
                  isActive ? 'text-accent' : 'text-slate-500 hover:text-slate-300',
                ].join(' ')
              }
              aria-label={label}
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={['w-6 h-6 transition-transform', isActive ? 'scale-110' : ''].join(' ')}
                  />
                  <span className="text-[10px] font-medium">{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// ─── Inline SVG icons (no icon library needed) ────────────────────────────

function GridIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function ClockIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  )
}

function GearIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
