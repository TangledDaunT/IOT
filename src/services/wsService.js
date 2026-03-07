/**
 * wsService — WebSocket connection manager.
 *
 * Responsibilities:
 *   - Connect to ws://[baseUrl]/ws (strips http/https scheme)
 *   - Exponential backoff reconnect (1s → 2s → 4s … cap 30s)
 *   - Heartbeat ping every 25s to keep connection alive
 *   - Event emitter: subscribe to typed events
 *   - In MOCK_MODE: emits realistic synthetic events on intervals
 *
 * Message format (server → client):
 *   { type: 'relay_update'      | 'device_heartbeat' | 'log_event' | 'pong', payload: {} }
 *
 * relay_update payload:    { id: number, isOn: boolean }
 * device_heartbeat payload:{ id: string, online: boolean, rssi: number, uptime: number, firmware: string, ip: string }
 * log_event payload:       { level, source, message, meta }
 */
import { MOCK_MODE, WS_PATH } from '../config'

const MAX_BACKOFF_MS = 30_000
const PING_INTERVAL  = 25_000

// ── Event emitter (tiny, no deps) ─────────────────────────────────────────
class Emitter {
  constructor() { this._listeners = {} }
  on(type, fn)  { (this._listeners[type] ??= []).push(fn) }
  off(type, fn) { this._listeners[type] = (this._listeners[type] ?? []).filter(f => f !== fn) }
  emit(type, data) { (this._listeners[type] ?? []).forEach(fn => fn(data)) }
  offAll()      { this._listeners = {} }
}

// ── WsService class ───────────────────────────────────────────────────────
class WsService extends Emitter {
  constructor() {
    super()
    this._ws         = null
    this._url        = null
    this._backoff    = 1000
    this._pingTimer  = null
    this._reconnTimer= null
    this._destroyed  = false
    this._mockTimers = []
  }

  /** Derive ws(s):// URL from an http(s) base URL */
  static toWsUrl(baseUrl, path) {
    return baseUrl.replace(/^http/, 'ws') + path
  }

  connect(baseUrl) {
    if (MOCK_MODE) { this._startMock(); return }
    this._url = WsService.toWsUrl(baseUrl, WS_PATH)
    this._open()
  }

  disconnect() {
    this._destroyed = true
    clearTimeout(this._reconnTimer)
    clearInterval(this._pingTimer)
    this._mockTimers.forEach(clearInterval)
    this._mockTimers = []
    if (this._ws) { this._ws.onclose = null; this._ws.close() }
    this.emit('status', { connected: false })
    this.offAll()
  }

  // ── Real WebSocket ──────────────────────────────────────────────────
  _open() {
    if (this._destroyed) return
    try {
      this._ws = new WebSocket(this._url)
    } catch (e) {
      this._scheduleReconnect()
      return
    }

    this._ws.onopen = () => {
      this._backoff = 1000
      this.emit('status', { connected: true })
      this._startPing()
    }

    this._ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type && msg.payload !== undefined) {
          this.emit(msg.type, msg.payload)
          this.emit('any', msg)
        }
      } catch { /* ignore malformed JSON messages */ }
    }

    this._ws.onerror = () => { /* errors handled in onclose */ }

    this._ws.onclose = () => {
      clearInterval(this._pingTimer)
      this.emit('status', { connected: false })
      this._scheduleReconnect()
    }
  }

  _startPing() {
    clearInterval(this._pingTimer)
    this._pingTimer = setInterval(() => {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, PING_INTERVAL)
  }

  _scheduleReconnect() {
    if (this._destroyed) return
    this._reconnTimer = setTimeout(() => {
      this._backoff = Math.min(this._backoff * 2, MAX_BACKOFF_MS)
      this._open()
    }, this._backoff)
  }

  // ── Mock mode ───────────────────────────────────────────────────────
  _startMock() {
    this.emit('status', { connected: true })

    // Fire initial_state immediately so relay context syncs on connect
    setTimeout(() => {
      this.emit('initial_state', {
        relays: [
          { id: 1, isOn: false },
          { id: 2, isOn: false },
          { id: 3, isOn: false },
          { id: 4, isOn: false },
        ],
      })
    }, 300)

    const RELAY_IDS = [1, 2, 3, 4]
    const FIRMWARE    = ['1.2.3', '1.2.4']
    let uptime1 = 3600, uptime2 = 7200

    // Device heartbeats every 8s
    this._mockTimers.push(setInterval(() => {
      uptime1 += 8; uptime2 += 8
      this.emit('device_heartbeat', { id: 'esp32-01', online: true, rssi: -55 - Math.floor(Math.random() * 8), uptime: uptime1, firmware: FIRMWARE[0], ip: '192.168.1.110' })
      this.emit('device_heartbeat', { id: 'esp32-02', online: true, rssi: -63 - Math.floor(Math.random() * 8), uptime: uptime2, firmware: FIRMWARE[1], ip: '192.168.1.111' })
      this.emit('any', { type: 'device_heartbeat' })
    }, 8_000))

    // Occasional relay state sync from backend (simulates another client toggling)
    this._mockTimers.push(setInterval(() => {
      if (Math.random() < 0.25) {
        const id  = RELAY_IDS[Math.floor(Math.random() * RELAY_IDS.length)]
        const isOn = Math.random() < 0.5
        this.emit('relay_update', { id, isOn })
        this.emit('any', { type: 'relay_update', payload: { id, isOn } })
      }
    }, 12_000))
  }
}

// ── Singleton export ──────────────────────────────────────────────────────
export const wsService = new WsService()
