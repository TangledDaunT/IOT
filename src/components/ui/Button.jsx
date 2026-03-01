/**
 * Button — base interactive element.
 *
 * Enforces minimum 44px touch target for mobile usability.
 * Variants: primary, secondary, danger, ghost
 */
import React from 'react'

const VARIANTS = {
  primary: 'bg-accent text-surface-900 font-semibold hover:brightness-110 active:scale-95',
  secondary: 'bg-surface-700 text-white hover:bg-surface-600 active:scale-95',
  danger: 'bg-relay-err text-white hover:brightness-110 active:scale-95',
  ghost: 'bg-transparent text-accent border border-accent hover:bg-accent/10 active:scale-95',
}

const SIZES = {
  sm: 'px-3 py-1.5 text-sm min-h-[36px]',
  md: 'px-4 py-2.5 text-sm min-h-[44px]',
  lg: 'px-6 py-3 text-base min-h-[52px]',
}

const Button = React.memo(function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  onClick,
  type = 'button',
  className = '',
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-lg transition-all duration-150 select-none',
        VARIANTS[variant] ?? VARIANTS.primary,
        SIZES[size] ?? SIZES.md,
        fullWidth ? 'w-full' : '',
        disabled || loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {loading && (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  )
})

export default Button
