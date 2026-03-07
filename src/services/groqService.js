/**
 * groqService — AI-powered voice command parser using Groq's LLM API.
 *
 * Model: llama3-8b-8192 (fast, free tier, perfect for IoT commands)
 *
 * The LLM is given the current relay names and asked to parse the user's
 * speech into a structured JSON intent. Rule-based parsing is used as
 * fallback when Groq is unavailable or key is not configured.
 *
 * System context sent to Groq includes:
 *   - All relay names and IDs so the LLM can resolve "the fan" → relay 2
 *   - Current relay states so it can answer "what's on?"
 *   - Strict JSON output format
 */
import { RELAY_CONFIG } from '../config'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL   = 'llama3-8b-8192'

/** @returns {string|null} Groq API key from env or null */
function getGroqKey() {
  return import.meta.env.VITE_GROQ_API_KEY || null
}

/**
 * Build the system prompt with relay context.
 * @param {Array<{id, isOn}>} relayStates - current relay on/off map
 */
function buildSystemPrompt(relayStates) {
  const relayList = RELAY_CONFIG.map((r) => {
    const s = relayStates?.find((rs) => rs.id === r.id)
    const onOff = s ? (s.isOn ? 'ON' : 'OFF') : 'unknown'
    return `  - Relay ${r.id}: "${r.name}" (currently ${onOff})`
  }).join('\n')

  return `You are an intelligent IoT control system voice parser. Parse the user's voice command into a JSON action.

Available relays:
${relayList}

Return ONLY valid JSON matching one of these formats:
1. Toggle relay: {"action":"relay_control","relay_id":1,"state":"on"}  or state:"off"
2. Turn all off: {"action":"all_off"}
3. Status query: {"action":"status"}
4. Unknown/ambiguous: {"action":"unknown","reason":"brief explanation"}

Rules:
- relay_id must be one of: ${RELAY_CONFIG.map(r => r.id).join(', ')}
- state must be exactly "on" or "off" (lowercase)
- Match relay names flexibly: "lights" → relay with "Light" in name, "fan" → relay with "Fan"
- Never include markdown, only raw JSON
- If the command is a question about status, use action:"status"`
}

/**
 * Parse a voice transcript using Groq LLM.
 * Returns the same shape as the rule-based parser:
 *   { action, relay_id?, state?, reason? } | null
 *
 * @param {string} transcript
 * @param {Array} relayStates - current relay states for context
 * @returns {Promise<object|null>}
 */
export async function parseWithGroq(transcript, relayStates = []) {
  const key = getGroqKey()
  if (!key) return null

  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(GROQ_API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        messages:    [
          { role: 'system',   content: buildSystemPrompt(relayStates) },
          { role: 'user',     content: transcript },
        ],
        max_tokens:  120,
        temperature: 0.1,    // low temp = deterministic structured output
        stream:      false,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      console.warn('[groqService] API error:', response.status)
      return null
    }

    const data    = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null

    // Strip any accidental markdown fences
    const json = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(json)

    // Validate the response shape
    if (!parsed || typeof parsed.action !== 'string') return null
    if (parsed.action === 'relay_control') {
      if (typeof parsed.relay_id !== 'number') return null
      if (parsed.state !== 'on' && parsed.state !== 'off') return null
    }

    return parsed
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[groqService] Request timed out')
    } else {
      console.warn('[groqService] Parse error:', err.message)
    }
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/** Returns true if a Groq API key is configured */
export function isGroqConfigured() {
  return Boolean(getGroqKey())
}

/**
 * transcribeWithGroq — send audio blob directly to Groq Whisper API.
 * Bypasses the ESP32 (which has no STT endpoint) and calls Groq directly.
 * Model: whisper-large-v3-turbo ($0.04/hr audio, fast, accurate)
 *
 * @param {Blob} blob - audio blob (webm/ogg/wav)
 * @returns {Promise<string>} trimmed transcript text
 */
export async function transcribeWithGroq(blob) {
  const key = getGroqKey()
  if (!key) throw new Error('Groq API key not configured')

  const form = new FormData()
  form.append('file', blob, 'recording.webm')
  form.append('model', 'whisper-large-v3-turbo')
  form.append('language', 'en')
  form.append('response_format', 'text')
  form.append('temperature', '0')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)

  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${key}` },
      body:    form,
      signal:  controller.signal,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => String(res.status))
      throw new Error(`Groq STT failed (${res.status}): ${detail}`)
    }
    return (await res.text()).trim()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * streamChatResponse — call Groq chat completions with SSE streaming.
 * Yields each text delta string as it arrives from the stream.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} [model]
 * @yields {string} text deltas
 */
export async function* streamChatResponse(messages, model = GROQ_MODEL) {
  const key = getGroqKey()
  if (!key) throw new Error('Groq API key not configured')

  const res = await fetch(GROQ_API_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream:     true,
      max_tokens: 120,
      temperature: 0.7,
    }),
  })

  if (!res.ok) throw new Error(`Groq chat HTTP ${res.status}`)

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer    = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process all complete (newline-terminated) lines
      const newlineIdx = buffer.lastIndexOf('\n')
      if (newlineIdx === -1) continue

      const complete = buffer.slice(0, newlineIdx + 1)
      buffer = buffer.slice(newlineIdx + 1)

      for (const line of complete.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const json = trimmed.slice(6)
        if (json === '[DONE]') return
        try {
          const parsed = JSON.parse(json)
          const delta  = parsed.choices?.[0]?.delta?.content
          if (delta) yield delta
        } catch { /* skip malformed SSE chunk */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Build system prompt for conversational voice assistant mode */
function buildConversationPrompt(relayStates = []) {
  const relayList = RELAY_CONFIG.map((r) => {
    const s = relayStates.find((rs) => rs.id === r.id)
    const onOff = s ? (s.isOn ? 'ON' : 'OFF') : 'unknown'
    return `  - Relay ${r.id}: "${r.name}" (${onOff})`
  }).join('\n')

  return `You are "Buddy", a fun and witty smart home AI. \
Keep replies to ONE short sentence — max 18 words. \
Be playful, warm, slightly cheeky. Confirm relay actions clearly when relevant. Never be formal.

Devices:
${relayList}`
}

/**
 * streamVoiceResponse — stream a spoken reply to a voice command.
 * If commandResult is provided, confirm it; otherwise respond conversationally.
 *
 * @param {string} transcript      - what the user said
 * @param {string|null} commandResult - action taken, or null for general chat
 * @param {Array} relayStates      - current relay states for context
 * @yields {string} text deltas
 */
export async function* streamVoiceResponse(transcript, commandResult, relayStates = []) {
  const userContent = commandResult
    ? `User said: "${transcript}". Action taken: ${commandResult}. Confirm and respond naturally.`
    : `User said: "${transcript}". Respond helpfully as a smart home assistant.`

  yield* streamChatResponse([
    { role: 'system', content: buildConversationPrompt(relayStates) },
    { role: 'user',   content: userContent },
  ])
}
