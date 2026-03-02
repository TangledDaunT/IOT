/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Dark mode is forced via class — we default to dark in index.html
  darkMode: 'class',
  theme: {
    extend: {
      // Custom color palette for industrial/control-panel feel
      colors: {
        surface: {
          900: '#000000',
          800: '#111111',
          700: '#1a1a1a',
          600: '#2a2a2a',
        },
        relay: {
          on:   '#ffffff',  // white — energized
          off:  '#444444',  // dark grey — de-energized
          warn: '#999999',  // grey — pending
          err:  '#888888',  // grey — fault
        },
        accent: '#ffffff', // white — primary interactive
      },
      // Large touch targets on mobile (minimum 44px — Apple HIG)
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
      // Samsung J6 viewport reference
      screens: {
        mobile: '360px',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'blink': 'blink 3s ease-in-out infinite',
        'blink-fast': 'blink 0.5s ease-in-out 2',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'robot-float': 'robotFloat 4s ease-in-out infinite',
      },
      keyframes: {
        blink: {
          '0%, 90%, 100%': { scaleY: '1' },
          '95%': { scaleY: '0.05' },
        },
        robotFloat: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
    },
  },
  plugins: [],
}
