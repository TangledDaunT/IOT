/**
 * AiPanel — slide-in AI assistant chat panel.
 *
 * Opens via '/' keyboard shortcut or GlobalShortcuts#onOpenChat.
 * Allows free-form text queries and voice input against relay context.
 * Uses Groq llama3-8b-8192 for responses.
 *
 * Slide direction: right→left on desktop, bottom-up on portrait mobile.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useRelayContext } from '../context/RelayContext'
import { RELAY_CONFIG } from '../config'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama3-8b-8192'

// Build system prompt with live relay context
function buildSystemPrompt(relayState) {
  const relayLines = RELAY_CONFIG.map((r) => {
    const s = relayState?.relays?.[r.id]
    const onOff = s?.isOn ? 'ON' : 'OFF'
    return `  • ${r.label} (ID ${r.id}): ${onOff}`
  }).join('\n')

  return `You are an intelligent IoT home control assistant. You help monitor and control smart relays in a home automation system. Be concise, helpful, and factual. Do not use markdown headers or bullet lists unless essential. Keep answers under 120 words.

Current relay states:
${relayLines}

You can answer questions about the relay states above, suggest automation strategies, provide energy-saving tips, or explain what's happening. You cannot directly control relays from this chat — users must use voice commands or the dashboard for that.`
}

// Send a message to Groq (non-streaming)
async function askGroq(messages, relayState) {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ API key not configured. Add VITE_GROQ_API_KEY to .env')

  const body = {
    model: MODEL,
    temperature: 0.5,
    max_tokens: 200,
    messages: [
      { role: 'system', content: buildSystemPrompt(relayState) },
      ...messages,
    ],
  }

  const resp = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Groq API error ${resp.status}: ${text.slice(0, 80)}`)
  }

  const data = await resp.json()
  return data.choices?.[0]?.message?.content?.trim() ?? '(no response)'
}

// ── Message bubble ────────────────────────────────────────────────────────
function Bubble({ role, content, isLoading }) {
  const isUser = role === 'user'
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '10px',
    }}>
      <div style={{
        maxWidth: '82%',
        background: isUser ? '#1a1a1a' : '#0d0d0d',
        border: `1px solid ${isUser ? '#333333' : '#222222'}`,
        borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        padding: '8px 12px',
        fontSize: '12px',
        lineHeight: '1.55',
        color: isUser ? '#cccccc' : '#e0e0e0',
        fontFamily: isUser ? 'inherit' : 'monospace',
        letterSpacing: isUser ? 'inherit' : '0.01em',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {isLoading ? (
          <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{
                width: '5px', height: '5px', borderRadius: '50%',
                background: '#555555',
                animation: `dotBlink 1.2s ease-in-out ${i * 0.2}s infinite`,
                display: 'inline-block',
              }} />
            ))}
          </span>
        ) : content}
      </div>
    </div>
  )
}

// ── Relay status bar ──────────────────────────────────────────────────────
function RelayStatusBar({ relayState }) {
  const active = RELAY_CONFIG.filter((r) => relayState?.relays?.[r.id]?.isOn)
  return (
    <div style={{
      display: 'flex', gap: '8px', flexWrap: 'wrap',
      padding: '8px 12px', borderBottom: '1px solid #1a1a1a',
      background: '#050505',
    }}>
      {RELAY_CONFIG.map((r) => {
        const on = relayState?.relays?.[r.id]?.isOn
        return (
          <span key={r.id} style={{
            fontSize: '9px', fontFamily: 'monospace',
            letterSpacing: '0.06em', textTransform: 'uppercase',
            color: on ? '#ffffff' : '#333333',
            padding: '2px 6px',
            border: `1px solid ${on ? '#444444' : '#1a1a1a'}`,
            borderRadius: '4px',
            transition: 'color 0.3s, border-color 0.3s',
          }}>
            {r.label}
            <span style={{ marginLeft: '4px', opacity: 0.6 }}>{on ? '●' : '○'}</span>
          </span>
        )
      })}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function AiPanel({ open, onClose }) {
  const { state: relayState } = useRelayContext()
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'System online. How can I assist you today?' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus input when opening
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const sendMessage = useCallback(async (text) => {
    const userMsg = text.trim()
    if (!userMsg || loading) return

    setInput('')
    setError(null)
    const userEntry = { role: 'user', content: userMsg }
    setMessages((prev) => [...prev, userEntry])
    setLoading(true)

    try {
      const history = [...messages, userEntry].slice(-10) // last 10 messages for context
      const reply = await askGroq(history, relayState)
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch (err) {
      const errMsg = err.message || 'Connection failed'
      setError(errMsg)
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠ ${errMsg}` }])
    } finally {
      setLoading(false)
    }
  }, [messages, loading, relayState])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }, [input, sendMessage])

  const handleClear = useCallback(() => {
    setMessages([{ role: 'assistant', content: 'Conversation cleared. How can I help?' }])
    setError(null)
  }, [])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 10001,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(340px, 92vw)',
        zIndex: 10002,
        background: '#080808',
        borderLeft: '1px solid #1f1f1f',
        display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid #1a1a1a',
          background: '#050505', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: import.meta.env.VITE_GROQ_API_KEY ? '#4ade80' : '#ef4444',
            }} />
            <span style={{
              fontSize: '11px', fontFamily: 'monospace', fontWeight: 700,
              letterSpacing: '0.1em', color: '#ffffff',
              textTransform: 'uppercase',
            }}>AI ASSISTANT</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={handleClear}
              style={{
                background: 'none', border: '1px solid #222222',
                color: '#444444', cursor: 'pointer', fontSize: '9px',
                fontFamily: 'monospace', letterSpacing: '0.06em',
                padding: '3px 8px', borderRadius: '4px',
              }}
              title="Clear conversation"
            >CLEAR</button>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none',
                color: '#555555', cursor: 'pointer', fontSize: '18px',
                lineHeight: 1, padding: '2px 4px',
              }}
              aria-label="Close panel"
            >×</button>
          </div>
        </div>

        {/* Relay status */}
        <RelayStatusBar relayState={relayState} />

        {/* Chat area */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '12px 14px',
          scrollbarWidth: 'thin', scrollbarColor: '#222222 #080808',
        }}>
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role} content={m.content} />
          ))}
          {loading && <Bubble role="assistant" isLoading />}
          {error && (
            <div style={{ fontSize: '10px', color: '#ef4444', fontFamily: 'monospace', textAlign: 'center', marginBottom: '8px' }}>
              {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div style={{
          padding: '10px 12px', borderTop: '1px solid #1a1a1a',
          background: '#050505', flexShrink: 0,
        }}>
          <div style={{
            display: 'flex', gap: '8px', alignItems: 'flex-end',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about relays, automations, tips…"
              disabled={loading}
              rows={2}
              style={{
                flex: 1, background: '#111111',
                border: '1px solid #2a2a2a', borderRadius: '10px',
                color: '#e0e0e0', fontSize: '12px',
                padding: '8px 12px', resize: 'none',
                outline: 'none', fontFamily: 'inherit',
                lineHeight: '1.4',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => { e.target.style.borderColor = '#444444' }}
              onBlur={(e) => { e.target.style.borderColor = '#2a2a2a' }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              style={{
                background: input.trim() && !loading ? '#ffffff' : '#1a1a1a',
                border: 'none', borderRadius: '10px',
                color: input.trim() && !loading ? '#000000' : '#444444',
                cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                padding: '8px 14px', fontSize: '11px',
                fontFamily: 'monospace', fontWeight: 700,
                letterSpacing: '0.05em',
                flexShrink: 0, alignSelf: 'stretch',
                transition: 'background 0.2s, color 0.2s',
              }}
            >
              SEND
            </button>
          </div>
          <p style={{ fontSize: '9px', color: '#2a2a2a', fontFamily: 'monospace', marginTop: '5px', textAlign: 'right' }}>
            Enter to send · Shift+Enter newline · / to open · Esc to close
          </p>
        </div>
      </div>
    </>
  )
}
