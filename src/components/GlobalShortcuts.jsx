/**
 * GlobalShortcuts — mounts keyboard shortcut listeners app-wide.
 *
 * Renders nothing (null). Placed inside Layout so all providers are available.
 * See useKeyboardShortcuts for the full shortcut map.
 */
import React, { useState, useCallback } from 'react'
import { useRelayContext } from '../context/RelayContext'
import { useVoice, VOICE_STATES } from '../context/VoiceContext'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { toggleRelay, getRelayStatus } from '../services/relayService'
import { RELAY_CONFIG } from '../config'

// ── Shortcut help modal ────────────────────────────────────────────────────
function HelpModal({ onClose }) {
  const shortcuts = [
    { key: '1 – 4',     desc: 'Toggle relay 1 through 4' },
    { key: 'R',         desc: 'Refresh relay status' },
    { key: 'V',         desc: 'Toggle voice command' },
    { key: '/',         desc: 'Open AI assistant panel' },
    { key: '?',         desc: 'Show this help' },
    { key: 'Esc',       desc: 'Cancel / close' },
    { key: 'Hold ⌥',   desc: 'Push-to-talk mic (left Option)' },
  ]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0a0a0a', border: '1px solid #333333',
          borderRadius: '16px', padding: '20px 24px',
          minWidth: '260px',
          animation: 'slideUp 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <p style={{ color: '#ffffff', fontSize: '13px', fontWeight: 700, fontFamily: 'monospace', letterSpacing: '0.08em' }}>
            KEYBOARD SHORTCUTS
          </p>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#555555', cursor: 'pointer', fontSize: '18px' }}
          >×</button>
        </div>
        {shortcuts.map(({ key, desc }) => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #111111' }}>
            <kbd style={{
              background: '#1a1a1a', border: '1px solid #333333',
              borderRadius: '5px', padding: '2px 8px',
              fontSize: '10px', fontFamily: 'monospace', color: '#ffffff',
              letterSpacing: '0.05em',
            }}>{key}</kbd>
            <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>{desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function GlobalShortcuts({ onOpenChat }) {
  const { state, setRelayOptimistic, setRelayState, setAllRelays, setGlobalLoading } = useRelayContext()
  const voice  = useVoice()
  const [showHelp, setShowHelp] = useState(false)

  const onRelayKey = useCallback(async (id) => {
    const relay = state.relays[id]
    if (!relay) return
    const nextState = !relay.isOn
    setRelayOptimistic(id, nextState)
    try {
      const result = await toggleRelay(id, nextState)
      setRelayState(id, result.isOn)
    } catch {
      setRelayState(id, relay.isOn) // revert on failure
    }
  }, [state.relays, setRelayOptimistic, setRelayState])

  const onRefresh = useCallback(async () => {
    setGlobalLoading(true)
    try {
      const relays = await getRelayStatus()
      setAllRelays(relays)
    } catch {
      // silent fail on shortcut refresh
    } finally {
      setGlobalLoading(false)
    }
  }, [setGlobalLoading, setAllRelays])

  const onVoice = useCallback(() => {
    // Dispatch a custom event that VoiceMicButton listens to
    window.dispatchEvent(new CustomEvent('iot:voice-trigger'))
  }, [])

  // Push-to-talk: Left ⌥ held → start recording; released → stop recording
  const onPTTStart = useCallback(() => {
    window.dispatchEvent(new CustomEvent('iot:voice-trigger'))
  }, [])

  const onPTTEnd = useCallback(() => {
    window.dispatchEvent(new CustomEvent('iot:voice-stop'))
  }, [])

  const onChat = useCallback(() => {
    onOpenChat?.()
  }, [onOpenChat])

  const onHelp = useCallback(() => {
    setShowHelp((v) => !v)
  }, [])

  const onEscape = useCallback(() => {
    setShowHelp(false)
    // Also trigger voice stop if recording
    if (voice.voiceState === VOICE_STATES.RECORDING) {
      window.dispatchEvent(new CustomEvent('iot:voice-stop'))
    }
  }, [voice.voiceState])

  useKeyboardShortcuts({ onRelayKey, onRefresh, onVoice, onChat, onHelp, onEscape, onPTTStart, onPTTEnd })

  return showHelp ? <HelpModal onClose={() => setShowHelp(false)} /> : null
}
