/**
 * PageSwiper — gesture-driven full-screen page switcher.
 *
 * No library. Raw touch events only.
 * Swipe left → next page, swipe right → previous page.
 * Pages slide horizontally with CSS transform (GPU-composited).
 * Min swipe distance: 60px to avoid accidental switches.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useRobot, EXPRESSIONS } from '../context/RobotContext'

const SWIPE_THRESHOLD = 60   // px minimum to register a swipe
const SWIPE_VELOCITY  = 0.3  // px/ms — fast flick counts even if short

export default function PageSwiper({ pages }) {
  const [current, setCurrent]    = useState(0)
  const [dragging, setDragging]  = useState(false)
  const [dragDelta, setDragDelta] = useState(0)
  const touchStart  = useRef({ x: 0, y: 0, time: 0 })
  const containerRef = useRef(null)
  const { setRobotExpression } = useRobot()
  const total = pages.length

  // Lock scroll direction once we know it's horizontal
  const isHorizontal = useRef(false)

  const goTo = useCallback((idx, expr) => {
    const clamped = Math.min(Math.max(idx, 0), total - 1)
    setCurrent(clamped)
    setDragDelta(0)
    setDragging(false)
    isHorizontal.current = false
    if (expr) setRobotExpression(expr, pages[clamped].label, 1500)
  }, [total, pages, setRobotExpression])

  // ── Touch handlers ────────────────────────────────────────────────────
  const onTouchStart = useCallback((e) => {
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY, time: Date.now() }
    setDragging(true)
    isHorizontal.current = false
  }, [])

  const onTouchMove = useCallback((e) => {
    if (!dragging) return
    const t = e.touches[0]
    const dx = t.clientX - touchStart.current.x
    const dy = t.clientY - touchStart.current.y

    // Determine direction on first significant move
    if (!isHorizontal.current && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      isHorizontal.current = Math.abs(dx) > Math.abs(dy)
    }

    if (isHorizontal.current) {
      e.preventDefault() // prevent page scroll while swiping cards
      // Rubber-band at edges
      let delta = dx
      if ((current === 0 && dx > 0) || (current === total - 1 && dx < 0)) {
        delta = dx * 0.2
      }
      setDragDelta(delta)
    }
  }, [dragging, current, total])

  const onTouchEnd = useCallback((e) => {
    if (!isHorizontal.current) { setDragging(false); return }

    const dx    = dragDelta
    const dt    = Date.now() - touchStart.current.time
    const vel   = Math.abs(dx) / dt

    if (Math.abs(dx) > SWIPE_THRESHOLD || vel > SWIPE_VELOCITY) {
      if (dx < 0) goTo(current + 1, EXPRESSIONS.THINKING)
      else         goTo(current - 1, EXPRESSIONS.THINKING)
    } else {
      // Snap back
      setDragDelta(0)
      setDragging(false)
    }
    isHorizontal.current = false
  }, [dragDelta, current, goTo])

  // Prevent default passive violation on move
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [onTouchMove])

  // Width of a single viewport (100vw)
  const pageW = typeof window !== 'undefined' ? window.innerWidth : 360

  const trackStyle = {
    display: 'flex',
    width: `${total * 100}vw`,
    height: '100%',
    transform: `translateX(calc(${-current * pageW}px + ${dragDelta}px))`,
    transition: dragging ? 'none' : 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    willChange: 'transform',
  }

  return (
    <div
      ref={containerRef}
      className="relative w-screen overflow-hidden"
      style={{ height: '100dvh' }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Sliding track */}
      <div style={trackStyle}>
        {pages.map((page, idx) => (
          <div
            key={page.key}
            style={{ width: '100vw', height: '100%', flexShrink: 0 }}
            aria-hidden={idx !== current}
          >
            <page.component />
          </div>
        ))}
      </div>

      {/* Page indicator dots — top center */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 flex gap-2 z-20 pointer-events-none">
        {pages.map((_, idx) => (
          <span
            key={idx}
            className={[
              'rounded-full transition-all duration-300',
              idx === current
                ? 'w-5 h-1.5 bg-accent'
                : 'w-1.5 h-1.5 bg-surface-600',
            ].join(' ')}
          />
        ))}
      </div>

      {/* Page label — top left */}
      <div className="absolute top-1.5 left-3 z-20 pointer-events-none">
        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">
          {pages[current]?.label}
        </span>
      </div>
    </div>
  )
}
