/**
 * ToastContainer — renders active toast notifications.
 *
 * Positioned top-center so it doesn't collide with the bottom
 * robot face widget. Lightweight: no framer-motion, no react-spring.
 */
import React from 'react'
import { useToast } from '../context/ToastContext'

const TYPE_STYLES = {
  success: 'bg-relay-on text-white border-relay-on/30',
  error:   'bg-relay-err text-white border-relay-err/30',
  warn:    'bg-relay-warn text-surface-900 border-relay-warn/30',
  info:    'bg-surface-700 text-white border-surface-600',
}

const TYPE_ICONS = {
  success: '✓',
  error:   '✕',
  warn:    '⚠',
  info:    'ℹ',
}

const Toast = React.memo(function Toast({ id, message, type, onDismiss }) {
  return (
    <div
      role="alert"
      className={[
        'flex items-start gap-2 px-4 py-3 rounded-xl border shadow-lg text-sm max-w-[90vw]',
        'animate-[fadeSlideDown_0.2s_ease-out]',
        TYPE_STYLES[type] ?? TYPE_STYLES.info,
      ].join(' ')}
    >
      <span className="font-bold mt-[1px]">{TYPE_ICONS[type] ?? 'ℹ'}</span>
      <span className="flex-1">{message}</span>
      <button
        onClick={() => onDismiss(id)}
        className="ml-2 opacity-70 hover:opacity-100 transition-opacity min-h-[24px] min-w-[24px] flex items-center justify-center"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
})

export default function ToastContainer() {
  const { toasts, dismiss } = useToast()

  if (!toasts.length) return null

  return (
    <div
      aria-live="polite"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center w-full pointer-events-none px-4"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast {...t} onDismiss={dismiss} />
        </div>
      ))}
    </div>
  )
}
