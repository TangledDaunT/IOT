/**
 * ToastContext — lightweight notification system.
 *
 * Designed to be minimal: no external library, no heavy animation.
 * Toasts auto-dismiss after a configurable duration.
 */
import { createContext, useContext, useState, useCallback, useRef } from 'react'

const ToastContext = createContext(null)

let _toastId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timerRef = useRef({})

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    clearTimeout(timerRef.current[id])
    delete timerRef.current[id]
  }, [])

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {'success'|'error'|'info'|'warn'} type
   * @param {number} duration  auto-dismiss ms (default 3500)
   */
  const toast = useCallback(
    (message, type = 'info', duration = 3500) => {
      const id = ++_toastId
      setToasts((prev) => [...prev.slice(-3), { id, message, type }]) // max 4 toasts

      timerRef.current[id] = setTimeout(() => dismiss(id), duration)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
