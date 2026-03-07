/**
 * ErrorBoundary — catches uncaught React render errors and shows a recovery UI.
 *
 * Prevents the entire app from going white when a single component throws.
 * Displays the error message and a reload button.
 */
import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Log to console — in production this could ship to an error tracker
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div
        style={{
          width: '100vw',
          height: '100dvh',
          background: '#000000',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          padding: '24px',
          fontFamily: 'monospace',
        }}
      >
        {/* Icon */}
        <div style={{ fontSize: '40px' }}>⚠</div>

        {/* Title */}
        <p
          style={{
            color: '#ffffff',
            fontSize: '14px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            margin: 0,
          }}
        >
          System Error
        </p>

        {/* Error detail */}
        <p
          style={{
            color: '#555555',
            fontSize: '11px',
            textAlign: 'center',
            maxWidth: '300px',
            margin: 0,
            lineHeight: 1.5,
            wordBreak: 'break-word',
          }}
        >
          {this.state.error?.message ?? 'An unexpected error occurred.'}
        </p>

        {/* Reload button */}
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: '8px',
            padding: '10px 24px',
            background: 'transparent',
            border: '1px solid #333333',
            borderRadius: '10px',
            color: '#ffffff',
            fontSize: '11px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          Restart System
        </button>
      </div>
    )
  }
}
