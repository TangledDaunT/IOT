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
