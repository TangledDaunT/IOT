/**
 * Scenes — multi-step relay automation builder.
 *
 * Left: saved scene list with Run / Edit / Delete.
 * Right: step-by-step editor — relay selector, on/off, delay before step.
 *
 * Execution: sequential, with per-step delays. A running indicator
 * shows which step is active and allows cancel.
 */
import React, { useState, useCallback } from 'react'
import { useSceneContext } from '../context/SceneContext'
import { useRelayContext } from '../context/RelayContext'
import { useLog } from '../context/LogContext'
import { useToast } from '../context/ToastContext'
import { RELAY_CONFIG } from '../config'
import { toggleRelay } from '../services/relayService'

const ICONS = ['⚡','💡','🌙','🌅','🎬','🧹','💤','🔒','🏠','🔥']

// ── Step editor row ───────────────────────────────────────────────────────
function StepRow({ step, index, onChange, onDelete }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '5px 8px', background: '#0f172a',
      borderRadius: '8px', border: '1px solid #1e293b',
    }}>
      <span style={{ fontSize: '9px', color: '#475569', fontFamily: 'monospace', minWidth: '14px' }}>
        {index + 1}.
      </span>

      {/* Relay selector */}
      <select
        value={step.relay_id}
        onChange={(e) => onChange({ ...step, relay_id: Number(e.target.value) })}
        style={{
          flex: 1, fontSize: '10px', background: '#111111', color: '#cccccc',
          border: '1px solid #333333', borderRadius: '6px',
          padding: '3px 4px', minWidth: 0,
        }}
      >
        {RELAY_CONFIG.map((r) => (
          <option key={r.id} value={r.id}>{r.icon} {r.name}</option>
        ))}
      </select>

      {/* State toggle */}
      <button
        onClick={() => onChange({ ...step, state: step.state === 'on' ? 'off' : 'on' })}
        style={{
          fontSize: '9px', fontFamily: 'monospace', letterSpacing: '0.1em',
          padding: '3px 7px', borderRadius: '6px', border: 'none', cursor: 'pointer',
          background: step.state === 'on' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.15)',
          color: step.state === 'on' ? '#22c55e' : '#ef4444',
          flexShrink: 0,
        }}
      >
        {step.state.toUpperCase()}
      </button>

      {/* Delay input */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <input
          type="number" min="0" max="300000" step="500"
          value={Math.round(step.delay_before_ms / 1000)}
          onChange={(e) => onChange({ ...step, delay_before_ms: Math.max(0, Number(e.target.value)) * 1000 })}
          style={{
            width: '36px', fontSize: '9px', fontFamily: 'monospace',
            background: '#1e293b', color: '#cbd5e1',
            border: '1px solid #334155', borderRadius: '4px',
            padding: '3px 4px', textAlign: 'center',
          }}
        />
        <span style={{ fontSize: '7px', color: '#334155' }}>delay s</span>
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        style={{
          fontSize: '12px', lineHeight: 1, background: 'none', border: 'none',
          color: '#334155', cursor: 'pointer', flexShrink: 0, padding: '0 2px',
        }}
      >×</button>
    </div>
  )
}

// ── Scene card (left panel) ───────────────────────────────────────────────
function SceneCard({ scene, isRunning, runningLabel, onRun, onEdit, onDelete }) {
  return (
    <div style={{
      background: '#0a0a0a',
      border: `1.5px solid ${isRunning ? '#ffffff' : '#1a1a1a'}`,
      borderRadius: '12px', padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: '6px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '18px' }}>{scene.icon}</span>
        <span style={{ flex: 1, fontSize: '12px', fontWeight: 600, color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {scene.name}
        </span>
        <span style={{ fontSize: '9px', color: '#475569', fontFamily: 'monospace', flexShrink: 0 }}>
          {scene.steps.length} step{scene.steps.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Step preview */}
      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
        {scene.steps.map((s, i) => {
          const cfg = RELAY_CONFIG.find((r) => r.id === s.relay_id)
          return (
            <span key={i} style={{
              fontSize: '8px', fontFamily: 'monospace',
              background: s.state === 'on' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
              color: s.state === 'on' ? '#cccccc' : '#555555',
              borderRadius: '4px', padding: '1px 5px',
            }}>
              {cfg?.icon ?? '?'}{s.state === 'on' ? '↑' : '↓'}
            </span>
          )
        })}
      </div>

      {isRunning && (
        <span style={{ fontSize: '9px', color: '#38bdf8', fontFamily: 'monospace', animation: 'none' }}>
          ⟳ {runningLabel}
        </span>
      )}

      <div style={{ display: 'flex', gap: '5px', marginTop: '2px' }}>
        <button
          onClick={onRun}
          disabled={isRunning}
          style={{
            flex: 1, height: '26px', borderRadius: '7px',
            background: isRunning ? '#1a1a1a' : 'rgba(255,255,255,0.07)',
            border: '1px solid ' + (isRunning ? '#1a1a1a' : '#ffffff'),
            color: isRunning ? '#333333' : '#ffffff',
            fontSize: '9px', fontFamily: 'monospace', cursor: isRunning ? 'not-allowed' : 'pointer',
          }}
        >
          {isRunning ? '▶ RUNNING' : '▶ RUN'}
        </button>
        <button
          onClick={onEdit}
          style={{
            width: '26px', height: '26px', borderRadius: '7px',
            background: 'transparent', border: '1px solid #1e293b',
            color: '#64748b', fontSize: '11px', cursor: 'pointer',
          }}
        >✎</button>
        <button
          onClick={onDelete}
          disabled={isRunning}
          style={{
            width: '26px', height: '26px', borderRadius: '7px',
            background: 'transparent', border: '1px solid #1e293b',
            color: '#475569', fontSize: '11px', cursor: 'pointer',
          }}
        >×</button>
      </div>
    </div>
  )
}

// ── Scene editor (right column) ───────────────────────────────────────────
const BLANK = () => ({ id: null, name: '', icon: '⚡', steps: [] })

function SceneEditor({ initial, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => initial ? { ...initial, steps: [...initial.steps] } : BLANK())

  const updateStep  = (i, step) => setDraft((d) => { const steps = [...d.steps]; steps[i] = step; return { ...d, steps } })
  const deleteStep  = (i)       => setDraft((d) => { const steps = d.steps.filter((_, j) => j !== i); return { ...d, steps } })
  const addStep     = ()        => setDraft((d) => ({
    ...d,
    steps: [...d.steps, { relay_id: RELAY_CONFIG[0].id, state: 'on', delay_before_ms: 0 }],
  }))

  const valid = draft.name.trim() && draft.steps.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '8px' }}>
      {/* Name + icon row */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
        {/* Icon picker */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <select
            value={draft.icon}
            onChange={(e) => setDraft((d) => ({ ...d, icon: e.target.value }))}
            style={{
              fontSize: '16px', background: '#1e293b', border: '1px solid #334155',
              borderRadius: '8px', padding: '4px 6px', cursor: 'pointer', color: 'white',
            }}
          >
            {ICONS.map((ic) => <option key={ic} value={ic}>{ic}</option>)}
          </select>
        </div>
        <input
          type="text"
          placeholder="Scene name…"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          style={{
            flex: 1, fontSize: '12px', fontWeight: 600,
          background: '#111111', color: '#ffffff',
          border: '1px solid #333333', borderRadius: '8px',
            padding: '5px 10px', outline: 'none',
          }}
        />
      </div>

      {/* Step list */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {draft.steps.length === 0 && (
          <div style={{ textAlign: 'center', color: '#334155', fontSize: '10px', fontFamily: 'monospace', marginTop: '20px' }}>
            No steps — add one below
          </div>
        )}
        {draft.steps.map((step, i) => (
          <StepRow
            key={i}
            step={step}
            index={i}
            onChange={(s) => updateStep(i, s)}
            onDelete={() => deleteStep(i)}
          />
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        <button
          onClick={addStep}
          style={{
            flex: 1, height: '30px', borderRadius: '8px',
            background: 'rgba(56,189,248,0.08)', border: '1px solid #1e3a5f',
            color: '#38bdf8', fontSize: '10px', fontFamily: 'monospace',
            cursor: 'pointer',
          }}
        >+ ADD STEP</button>
        <button
          onClick={() => onSave(draft)}
          disabled={!valid}
          style={{
            flex: 1, height: '30px', borderRadius: '8px',
          background: valid ? 'rgba(255,255,255,0.1)' : '#111111',
          border: '1px solid ' + (valid ? '#ffffff' : '#1a1a1a'),
          color: valid ? '#ffffff' : '#333333',
            fontSize: '10px', fontFamily: 'monospace',
            cursor: valid ? 'pointer' : 'not-allowed',
          }}
        >SAVE</button>
        <button
          onClick={onCancel}
          style={{
            width: '30px', height: '30px', borderRadius: '8px',
            background: 'transparent', border: '1px solid #1e293b',
            color: '#475569', cursor: 'pointer',
          }}
        >✕</button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function Scenes() {
  const { state, addScene, updateScene, deleteScene, executeScene, cancelScene } = useSceneContext()
  const { setRelayState, setRelayLoading }   = useRelayContext()
  const { addLog }  = useLog()
  const { toast }   = useToast()
  const [editing, setEditing]       = useState(null)   // null | 'new' | sceneId
  const [runLabel, setRunLabel]     = useState('')

  // The actual relay toggle effect passed to executeScene
  const toggleFn = useCallback(async (relay_id, isOn) => {
    setRelayLoading(relay_id, true)
    try {
      const result = await toggleRelay(relay_id, isOn)
      setRelayState(relay_id, result.isOn)
    } catch (e) {
      toast(`Step failed: relay ${relay_id} — ${e.message}`, 'error')
    }
  }, [setRelayState, setRelayLoading, toast])

  const handleRun = useCallback(async (sceneId) => {
    const scene = state.scenes.find((s) => s.id === sceneId)
    if (!scene) return
    addLog('info', 'scene', `Running scene: ${scene.name}`, { sceneId })
    toast(`▶ Running "${scene.name}"`, 'info')
    await executeScene(sceneId, toggleFn, (label) => setRunLabel(label))
    addLog('info', 'scene', `Scene completed: ${scene.name}`, { sceneId })
    toast(`✓ Scene "${scene.name}" done`, 'success')
  }, [state.scenes, executeScene, toggleFn, addLog, toast])

  const handleSave = useCallback((draft) => {
    if (draft.id) {
      updateScene(draft)
      addLog('info', 'scene', `Scene updated: ${draft.name}`, { id: draft.id })
    } else {
      addScene(draft)
      addLog('info', 'scene', `Scene created: ${draft.name}`)
    }
    setEditing(null)
  }, [addScene, updateScene, addLog])

  const handleDelete = useCallback((scene) => {
    deleteScene(scene.id)
    addLog('warn', 'scene', `Scene deleted: ${scene.name}`, { id: scene.id })
    if (editing === scene.id) setEditing(null)
  }, [deleteScene, addLog, editing])

  const editingScene = editing && editing !== 'new'
    ? state.scenes.find((s) => s.id === editing) ?? null
    : null

  return (
    <div className="flex flex-col w-full" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 shrink-0"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 28px)', height: '52px' }}>
        <h1 className="text-white font-bold text-sm tracking-tight">Scenes</h1>
        <span className="text-xs text-slate-400 font-mono">{state.scenes.length} saved</span>
      </div>

      {/* Two-column layout */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '10px', padding: '0 12px 12px' }}>
        {/* Left — scene list */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {state.scenes.map((scene) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              isRunning={state.runningSceneId === scene.id}
              runningLabel={runLabel}
              onRun={() => handleRun(scene.id)}
              onEdit={() => setEditing(scene.id)}
              onDelete={() => handleDelete(scene)}
            />
          ))}

          {/* New scene button */}
          <button
            onClick={() => setEditing('new')}
            style={{
              height: '40px', borderRadius: '12px',
              background: 'transparent', border: '1px dashed #1e293b',
              color: '#334155', fontSize: '11px', fontFamily: 'monospace',
              cursor: 'pointer', letterSpacing: '0.1em',
            }}
          >
            + NEW SCENE
          </button>
        </div>

        {/* Right — editor */}
        <div style={{
          width: '44%', flexShrink: 0,
          background: '#000000', borderRadius: '14px',
          border: '1px solid #1a1a1a', padding: '12px',
        }}>
          {editing ? (
            <SceneEditor
              initial={editingScene}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div style={{
              height: '100%', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}>
              <span style={{ fontSize: '28px' }}>⚡</span>
              <p style={{ fontSize: '11px', color: '#333333', fontFamily: 'monospace', textAlign: 'center' }}>
                Select a scene to edit<br />or create a new one
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
