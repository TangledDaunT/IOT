/**
 * AuthGate — full-screen password login screen.
 *
 * Blocks the app on any device that hasn't authenticated this session.
 * Uses a shared password stored in VITE_APP_PASSWORD env var.
 * Password is SHA-256 hashed before comparison — plaintext never stored.
 *
 * Session persists in sessionStorage → re-prompts when browser tab closes.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'

const SESSION_KEY = 'iot_session'

// SHA-256 via Web Crypto API (no external dep)
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function AuthGate({ children }) {
  const [authed, setAuthed]   = useState(false)
  const [checking, setChecking] = useState(true) // true while checking sessionStorage
  const [password, setPassword] = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  // On mount, check if this session already authenticated
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY)
    if (saved) setAuthed(true)
    setChecking(false)
  }, [])

  // Auto-focus password input
  useEffect(() => {
    if (!authed && !checking) setTimeout(() => inputRef.current?.focus(), 100)
  }, [authed, checking])

  const handleLogin = useCallback(async (e) => {
    e?.preventDefault()
    if (!password.trim() || loading) return
    setLoading(true)
    setError('')

    const correct = import.meta.env.VITE_APP_PASSWORD ?? 'changeme123'
    const [enteredHash, correctHash] = await Promise.all([sha256(password), sha256(correct)])

    if (enteredHash === correctHash) {
      sessionStorage.setItem(SESSION_KEY, enteredHash)
      setAuthed(true)
    } else {
      setError('Incorrect password.')
      setPassword('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
    setLoading(false)
  }, [password, loading])

  if (checking) return null // brief flash prevention
  if (authed) return children

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'monospace',
    }}>
      {/* HUD grid */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />

      {/* Corner brackets */}
      {['tl','tr','bl','br'].map((c) => (
        <div key={c} style={{
          position: 'absolute',
          top: c[0]==='t' ? 16 : 'auto', bottom: c[0]==='b' ? 16 : 'auto',
          left: c[1]==='l' ? 16 : 'auto', right: c[1]==='r' ? 16 : 'auto',
          width: 20, height: 20,
          borderTop: c[0]==='t' ? '1px solid rgba(255,255,255,0.1)' : 'none',
          borderBottom: c[0]==='b' ? '1px solid rgba(255,255,255,0.1)' : 'none',
          borderLeft: c[1]==='l' ? '1px solid rgba(255,255,255,0.1)' : 'none',
          borderRight: c[1]==='r' ? '1px solid rgba(255,255,255,0.1)' : 'none',
        }} />
      ))}

      {/* Login card */}
      <form
        onSubmit={handleLogin}
        style={{
          background: '#080808',
          border: '1px solid #1f1f1f',
          borderRadius: '20px',
          padding: '36px 32px',
          width: 'min(320px, 88vw)',
          display: 'flex', flexDirection: 'column', gap: '20px',
          position: 'relative', zIndex: 1,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: '#0d0d0d', border: '1px solid #2a2a2a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
            fontSize: 22,
          }}>🔒</div>
          <p style={{ color: '#ffffff', fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Smart Home Control
          </p>
          <p style={{ color: '#444444', fontSize: 10, letterSpacing: '0.14em', marginTop: 6, textTransform: 'uppercase' }}>
            Enter password to continue
          </p>
        </div>

        {/* Password input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 9, color: '#444444', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Password
          </label>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError('') }}
            placeholder="••••••••"
            autoComplete="current-password"
            style={{
              background: '#111111', border: `1px solid ${error ? '#ef4444' : '#2a2a2a'}`,
              borderRadius: 10, color: '#ffffff', fontSize: 14,
              padding: '10px 14px', outline: 'none', width: '100%',
              boxSizing: 'border-box',
              transition: 'border-color 0.2s',
            }}
            onFocus={(e) => { if (!error) e.target.style.borderColor = '#444444' }}
            onBlur={(e) => { if (!error) e.target.style.borderColor = '#2a2a2a' }}
          />
          {error && (
            <span style={{ fontSize: 10, color: '#ef4444', letterSpacing: '0.06em' }}>{error}</span>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!password.trim() || loading}
          style={{
            background: password.trim() && !loading ? '#ffffff' : '#1a1a1a',
            border: 'none', borderRadius: 10,
            color: password.trim() && !loading ? '#000000' : '#444444',
            fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
            letterSpacing: '0.1em', textTransform: 'uppercase',
            padding: '12px', cursor: password.trim() && !loading ? 'pointer' : 'not-allowed',
            transition: 'background 0.2s, color 0.2s',
          }}
        >
          {loading ? 'VERIFYING…' : 'UNLOCK'}
        </button>

        <p style={{ fontSize: 9, color: '#222222', textAlign: 'center', letterSpacing: '0.08em', margin: 0 }}>
          Session expires when tab closes
        </p>
      </form>
    </div>
  )
}
