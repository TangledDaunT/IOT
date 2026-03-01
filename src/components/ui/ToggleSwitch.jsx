/**
 * ToggleSwitch — hardware-feel on/off toggle.
 *
 * No JS animation library needed — pure CSS transition.
 * Large enough for easy touch (min 44px height touch zone).
 */
import React from 'react'

const ToggleSwitch = React.memo(function ToggleSwitch({
  isOn = false,
  loading = false,
  onChange,
  disabled = false,
  label,
}) {
  const handleClick = () => {
    if (!disabled && !loading && onChange) onChange(!isOn)
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={label ?? (isOn ? 'ON' : 'OFF')}
      onClick={handleClick}
      disabled={disabled || loading}
      className={[
        'relative inline-flex items-center min-h-[44px] min-w-[44px] p-0 bg-transparent border-0 cursor-pointer select-none',
        disabled || loading ? 'opacity-50 cursor-not-allowed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Track */}
      <span
        className={[
          'relative w-14 h-7 rounded-full transition-colors duration-300 ease-in-out',
          isOn ? 'bg-relay-on' : 'bg-surface-600',
          loading ? 'animate-pulse' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* Thumb */}
        <span
          className={[
            'absolute top-[3px] left-[3px] w-[22px] h-[22px] rounded-full bg-white shadow-md',
            'transition-transform duration-300 ease-in-out',
            isOn ? 'translate-x-7' : 'translate-x-0',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      </span>
    </button>
  )
})

export default ToggleSwitch
