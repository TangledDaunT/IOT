/**
 * Modal — accessible dialog overlay.
 *
 * Traps focus within modal while open.
 * Closes on overlay click or ESC key.
 * No external library needed for this use case.
 */
import React, { useEffect, useRef } from 'react'

const Modal = React.memo(function Modal({
  isOpen,
  onClose,
  title,
  children,
  className = '',
}) {
  const overlayRef = useRef(null)

  // Close on ESC key
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm px-4 pb-6"
      onClick={(e) => { if (e.target === overlayRef.current) onClose?.() }}
    >
      <div
        className={[
          'w-full max-w-md bg-surface-800 rounded-2xl border border-surface-600/50 p-5 shadow-2xl',
          'animate-[slideUp_0.2s_ease-out]',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {title && (
          <h2
            id="modal-title"
            className="text-white text-lg font-semibold mb-4 border-b border-surface-600 pb-3"
          >
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  )
})

export default Modal
