/**
 * Card — container with consistent background and padding.
 * Keeps surface elevation visual hierarchy consistent.
 */
import React from 'react'

const Card = React.memo(function Card({ children, className = '', onClick }) {
  return (
    <div
      onClick={onClick}
      className={[
        'bg-surface-800 rounded-2xl border border-surface-600/50 shadow-lg',
        onClick ? 'cursor-pointer active:scale-[0.98] transition-transform' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
})

export default Card
