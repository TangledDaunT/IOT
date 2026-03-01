/**
 * Devices — ESP32 device health dashboard.
 *
 * Shows per-device: online status, WiFi RSSI bars, last heartbeat,
 * uptime, firmware version, IP, and OTA trigger button.
 */
import React, { useState, useCallback } from 'react'
import { useDeviceContext } from '../context/DeviceContext'
import { useLogContext } from '../context/LogContext'
import { triggerOTA } from '../services/deviceService'
import { useToast } from '../context/ToastContext'
import { MOCK_MODE } from '../config'

// ── Tiny helpers ──────────────────────────────────────────────────────────
function relativeTime(ts) {
  if (!ts) return '—'
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 5)   return 'just now'
  if (diff < 60)  return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function formatUptime(seconds) {
  if (seconds == null) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0)  return `${d}d ${h}h`
  if (h > 0)  return `${h}h ${m}m`
  if (m > 0)  return `${m}m ${s}s`
  return `${s}s`
}

// WiFi RSSI → 0–4 bars  (excellent ≥ -55, good -55 to -70, fair -70 to -80, poor < -80)
function rssiToBars(rssi) {
  if (rssi == null) return 0
  if (rssi >= -55)  return 4
  if (rssi >= -65)  return 3
  if (rssi >= -75)  return 2
  if (rssi >= -85)  return 1
  return 0
}

function RssiBars({ rssi }) {
  const bars  = rssiToBars(rssi)
  const color = bars >= 3 ? '#22c55e' : bars === 2 ? '#f59e0b' : '#ef4444'
  const heights = [4, 7, 10, 14]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: '2px', height: '14px' }}>
      {heights.map((h, i) => (
        <span key={i} style={{
          display: 'block',
          width: '3px', height: `${h}px`,
          borderRadius: '1px',
          background: i < bars ? color : '#334155',
        }} />
      ))}
      {rssi != null && (
        <span style={{ fontSize: '8px', color: '#64748b', fontFamily: 'monospace', marginLeft: '3px', alignSelf: 'center' }}>
          {rssi}dBm
        </span>
      )}
    </span>
  )
}

// ── Device card ───────────────────────────────────────────────────────────
function DeviceCard({ device }) {
  const { toast }  = useToast()
  const { addLog } = useLogContext()
  const [otaBusy, setOtaBusy] = useState(false)
  const [tick, setTick]       = useState(0)

  // Refresh relative timestamps every 5 seconds
  React.useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 5000)
    return () => clearInterval(t)
  }, [])

  const handleOTA = useCallback(async () => {
    setOtaBusy(true)
    try {
      const res = await triggerOTA(device.id)
      toast(res.message || 'OTA triggered', 'success')
      addLog('info', 'device', `OTA triggered on ${device.name}`, { id: device.id })
    } catch (e) {
      toast(e.message || 'OTA failed', 'error')
    } finally {
      setOtaBusy(false)
    }
  }, [device, toast, addLog])

  const onlineBg    = device.online ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.08)'
  const borderColor = device.online ? '#166534' : '#450a0a'

  return (
    <div style={{
      background: '#0f172a',
      border: `1.5px solid ${borderColor}`,
      borderRadius: '14px',
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      minWidth: 0,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          fontSize: '8px', fontFamily: 'monospace', letterSpacing: '0.1em',
          textTransform: 'uppercase', fontWeight: 700,
          color: device.online ? '#22c55e' : '#ef4444',
          background: onlineBg, borderRadius: '4px',
          padding: '1px 5px', flexShrink: 0,
        }}>
          {device.online ? '● ONLINE' : '○ OFFLINE'}
        </span>
        <span style={{ color: '#f8fafc', fontSize: '12px', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {device.name}
        </span>
        <span style={{ fontSize: '9px', color: '#475569', fontFamily: 'monospace', flexShrink: 0 }}>
          {device.room}
        </span>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 10px' }}>
        <StatRow label="Signal"    value={<RssiBars rssi={device.rssi} />} />
        <StatRow label="Heartbeat" value={relativeTime(device.lastHeartbeat)} />
        <StatRow label="Uptime"    value={formatUptime(device.uptime)} />
        <StatRow label="Firmware"  value={device.firmware ?? '—'} mono />
        <StatRow label="IP"        value={device.ip ?? '—'}       mono />
        <StatRow label="Relays"    value={device.relays?.join(', ') ?? '—'} />
      </div>

      {/* OTA button */}
      <button
        onClick={handleOTA}
        disabled={otaBusy || !device.online}
        style={{
          marginTop: '2px',
          height: '28px',
          borderRadius: '8px',
          border: '1px solid #1e3a5f',
          background: otaBusy ? '#1e293b' : 'transparent',
          color: device.online && !otaBusy ? '#38bdf8' : '#334155',
          fontSize: '10px',
          fontFamily: 'monospace',
          letterSpacing: '0.1em',
          cursor: device.online && !otaBusy ? 'pointer' : 'not-allowed',
          transition: 'all 0.2s',
        }}
      >
        {otaBusy ? '⟳ UPDATING…' : '↑ OTA UPDATE'}
      </button>
    </div>
  )
}

function StatRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
      <span style={{ fontSize: '8px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <span style={{ fontSize: '10px', color: '#cbd5e1', fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</span>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function Devices() {
  const { state }   = useDeviceContext()
  const devices     = Object.values(state.devices)
  const onlineCount = devices.filter((d) => d.online).length

  return (
    <div className="flex flex-col w-full" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 shrink-0"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 28px)', height: '52px' }}>

        <div className="flex items-center gap-3">
          <h1 className="text-white font-bold text-sm tracking-tight">Device Health</h1>
          {MOCK_MODE && (
            <span className="px-1.5 py-0.5 bg-relay-warn/20 text-relay-warn text-[9px] rounded font-mono">MOCK</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* WS indicator */}
          <span style={{
            fontSize: '8px', fontFamily: 'monospace', letterSpacing: '0.1em',
            color: state.wsConnected ? '#22c55e' : '#ef4444',
          }}>
            {state.wsConnected ? '⬤ WS' : '○ WS'}
          </span>
          <span className="text-xs text-slate-400 font-mono">
            <span className={onlineCount > 0 ? 'text-relay-on font-semibold' : ''}>{onlineCount}</span>
            <span className="text-slate-600"> / {devices.length} online</span>
          </span>
        </div>
      </div>

      {/* Device cards grid */}
      <div className="flex-1 min-h-0 px-3 pb-3 overflow-y-auto">
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(devices.length, 3)}, 1fr)`,
          gap: '10px',
          height: '100%',
          alignContent: 'start',
        }}>
          {devices.map((d) => <DeviceCard key={d.id} device={d} />)}
        </div>
      </div>
    </div>
  )
}
