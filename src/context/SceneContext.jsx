/**
 * SceneContext — store and execute multi-step relay automation scenes.
 *
 * A Scene is:
 *   { id, name, icon, steps: [{ relay_id, state:'on'|'off', delay_before_ms }] }
 *
 * Execution is sequential:
 *   For each step: wait delay_before_ms → toggle relay → move to next step.
 *
 * Scenes are persisted in localStorage.
 * `runningSceneId` tracks which scene is executing (if any).
 */
import { createContext, useContext, useReducer, useCallback, useRef } from 'react'

const LS_KEY = 'iot_scenes'

// ── Helpers ───────────────────────────────────────────────────────────────
function makeId() {
  return `sc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function loadFromLS() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  // Default scene so the page isn't empty on first load
  return [
    {
      id: 'scene-night',
      name: 'Night Mode',
      icon: '🌙',
      steps: [
        { relay_id: 1, state: 'off', delay_before_ms: 0 },
        { relay_id: 2, state: 'on',  delay_before_ms: 500 },
        { relay_id: 3, state: 'off', delay_before_ms: 2000 },
      ],
    },
    {
      id: 'scene-all-off',
      name: 'All Off',
      icon: '⏹️',
      steps: [
        { relay_id: 1, state: 'off', delay_before_ms: 0 },
        { relay_id: 2, state: 'off', delay_before_ms: 200 },
        { relay_id: 3, state: 'off', delay_before_ms: 200 },
        { relay_id: 4, state: 'off', delay_before_ms: 200 },
      ],
    },
  ]
}

function saveToLS(scenes) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(scenes)) } catch {}
}

// ── Reducer ───────────────────────────────────────────────────────────────
function sceneReducer(state, action) {
  switch (action.type) {
    case 'ADD': {
      const scenes = [...state.scenes, action.scene]
      saveToLS(scenes)
      return { ...state, scenes }
    }
    case 'UPDATE': {
      const scenes = state.scenes.map((s) =>
        s.id === action.scene.id ? action.scene : s
      )
      saveToLS(scenes)
      return { ...state, scenes }
    }
    case 'DELETE': {
      const scenes = state.scenes.filter((s) => s.id !== action.id)
      saveToLS(scenes)
      return { ...state, scenes }
    }
    case 'SET_RUNNING':
      return { ...state, runningSceneId: action.id }
    default:
      return state
  }
}

// ── Context ───────────────────────────────────────────────────────────────
const SceneContext = createContext(null)

export function SceneProvider({ children }) {
  const [state, dispatch] = useReducer(sceneReducer, undefined, () => ({
    scenes: loadFromLS(),
    runningSceneId: null,
  }))

  // Store cancel ref — call to abort mid-execution
  const cancelRef = useRef(false)

  const addScene = useCallback((scene) => {
    dispatch({ type: 'ADD', scene: { ...scene, id: makeId() } })
  }, [])

  const updateScene = useCallback((scene) => {
    dispatch({ type: 'UPDATE', scene })
  }, [])

  const deleteScene = useCallback((id) => {
    dispatch({ type: 'DELETE', id })
  }, [])

  /**
   * Execute a scene.
   * @param {string} sceneId
   * @param {(relay_id:number, state:'on'|'off') => Promise<void>} toggleFn
   *   Caller provides the actual relay-toggle effect (uses useRelays hook outside)
   * @param {(msg:string) => void} [onStep]   called before each step
   * @returns {Promise<void>}
   */
  const executeScene = useCallback(
    async (sceneId, toggleFn, onStep) => {
      const scene = state.scenes.find((s) => s.id === sceneId)
      if (!scene || state.runningSceneId) return

      cancelRef.current = false
      dispatch({ type: 'SET_RUNNING', id: sceneId })

      try {
        for (const step of scene.steps) {
          if (cancelRef.current) break

          if (step.delay_before_ms > 0) {
            await new Promise((res) => setTimeout(res, step.delay_before_ms))
          }
          if (cancelRef.current) break

          onStep?.(`${step.state === 'on' ? '⚡' : '○'} Relay ${step.relay_id}`)
          await toggleFn(step.relay_id, step.state === 'on')
        }
      } finally {
        dispatch({ type: 'SET_RUNNING', id: null })
      }
    },
    [state.scenes, state.runningSceneId]
  )

  const cancelScene = useCallback(() => {
    cancelRef.current = true
  }, [])

  return (
    <SceneContext.Provider value={{ state, addScene, updateScene, deleteScene, executeScene, cancelScene }}>
      {children}
    </SceneContext.Provider>
  )
}

export function useSceneContext() {
  const ctx = useContext(SceneContext)
  if (!ctx) throw new Error('useSceneContext must be used inside SceneProvider')
  return ctx
}
