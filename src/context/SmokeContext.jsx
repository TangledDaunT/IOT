/**
 * SmokeContext — smoke telemetry, fan automation policy, and daily cigarette counting.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react'
import { OPENCLAW_CONFIG, SMOKE_DEFAULTS } from '../config'
import { getSmokeStatus, updateSmokePolicy } from '../services/smokeService'
import {
  dayKeyFor,
  enqueueEpisodeEvent,
  flushOpenClawQueue,
  loadQueue,
} from '../services/openclawService'
import { normalizeSmokeEvent, normalizeSmokeTelemetry } from '../services/smokeTelemetry'

const COUNT_KEY = 'iot_smoke_counts_v1'
const EPISODES_KEY = 'iot_smoke_episode_ids_v1'

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function getTodayKey(offsetMinutes) {
  return dayKeyFor(Date.now(), offsetMinutes)
}

const INITIAL = {
  telemetry: normalizeSmokeTelemetry({ sourceOnline: false }),
  policy: { ...SMOKE_DEFAULTS },
  cigarettesByDay: loadJson(COUNT_KEY, {}),
  processedEpisodeIds: loadJson(EPISODES_KEY, {}),
  lastEvent: null,
  syncStatus: {
    synced: true,
    pending: loadQueue().length,
    failed: 0,
    lastSyncAt: null,
    lastError: null,
  },
  loading: false,
  error: null,
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.value }
    case 'SET_ERROR':
      return { ...state, error: action.value }
    case 'SET_STATUS':
      return {
        ...state,
        telemetry: normalizeSmokeTelemetry(action.payload.telemetry),
        policy: { ...state.policy, ...action.payload.policy },
      }
    case 'SET_TELEMETRY':
      return {
        ...state,
        telemetry: normalizeSmokeTelemetry({ ...state.telemetry, ...action.payload, sourceOnline: true }),
      }
    case 'SET_POLICY':
      return {
        ...state,
        policy: { ...state.policy, ...action.payload },
      }
    case 'SET_SYNC_STATUS':
      return {
        ...state,
        syncStatus: { ...state.syncStatus, ...action.payload },
      }
    case 'INGEST_EVENT': {
      const event = normalizeSmokeEvent(action.payload)
      return {
        ...state,
        lastEvent: event,
      }
    }
    case 'INCREMENT_DAY_COUNT': {
      const existing = state.cigarettesByDay[action.dayKey] || 0
      const cigarettesByDay = {
        ...state.cigarettesByDay,
        [action.dayKey]: existing + 1,
      }
      return { ...state, cigarettesByDay }
    }
    case 'MARK_EPISODE': {
      const processedEpisodeIds = {
        ...state.processedEpisodeIds,
        [action.episodeId]: true,
      }
      return { ...state, processedEpisodeIds }
    }
    default:
      return state
  }
}

const SmokeContext = createContext(null)

export function SmokeProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, INITIAL)

  useEffect(() => {
    saveJson(COUNT_KEY, state.cigarettesByDay)
  }, [state.cigarettesByDay])

  useEffect(() => {
    saveJson(EPISODES_KEY, state.processedEpisodeIds)
  }, [state.processedEpisodeIds])

  const refreshSmokeStatus = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', value: true })
    dispatch({ type: 'SET_ERROR', value: null })
    try {
      const status = await getSmokeStatus()
      dispatch({ type: 'SET_STATUS', payload: status })
      dispatch({
        type: 'SET_SYNC_STATUS',
        payload: {
          pending: status.syncStatus?.pending ?? loadQueue().length,
          failed: status.syncStatus?.failed ?? 0,
          synced: (status.syncStatus?.pending ?? 0) === 0,
        },
      })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', value: err.message || 'Failed to fetch smoke status' })
    } finally {
      dispatch({ type: 'SET_LOADING', value: false })
    }
  }, [])

  const setTelemetry = useCallback((payload) => {
    dispatch({ type: 'SET_TELEMETRY', payload })
  }, [])

  const flushSyncQueue = useCallback(async () => {
    const result = await flushOpenClawQueue()
    dispatch({
      type: 'SET_SYNC_STATUS',
      payload: {
        pending: result.pending,
        failed: result.failed,
        synced: result.pending === 0,
        lastSyncAt: Date.now(),
        lastError: result.failed > 0 ? 'Some OpenClaw events pending retry' : null,
      },
    })
    return result
  }, [])

  const ingestSmokeEvent = useCallback(async (payload) => {
    dispatch({ type: 'INGEST_EVENT', payload })
    const event = normalizeSmokeEvent(payload)

    if (event.eventType !== 'cigarette_episode_closed' || !event.episodeId) return { counted: false }
    if (state.processedEpisodeIds[event.episodeId]) return { counted: false, duplicate: true }

    const timezoneOffset = state.policy.timezoneOffsetMinutes ?? SMOKE_DEFAULTS.timezoneOffsetMinutes
    const dayKey = dayKeyFor(event.endedAt || event.ts, timezoneOffset)

    dispatch({ type: 'MARK_EPISODE', episodeId: event.episodeId })
    dispatch({ type: 'INCREMENT_DAY_COUNT', dayKey })

    const { idempotencyKey } = enqueueEpisodeEvent({
      eventType: event.eventType,
      eventId: event.eventId,
      episodeId: event.episodeId,
      deviceId: event.deviceId,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      durationMs: event.durationMs,
      peakIntensity: event.peakIntensity,
      dayKey,
      ts: event.ts,
    })

    dispatch({
      type: 'SET_SYNC_STATUS',
      payload: {
        synced: false,
        pending: loadQueue().length,
      },
    })

    const syncResult = await flushSyncQueue()
    return { counted: true, idempotencyKey, dayKey, syncResult }
  }, [state.processedEpisodeIds, state.policy.timezoneOffsetMinutes, flushSyncQueue])

  const updatePolicy = useCallback(async (partialPolicy) => {
    dispatch({ type: 'SET_ERROR', value: null })
    const merged = { ...state.policy, ...partialPolicy }
    dispatch({ type: 'SET_POLICY', payload: merged })

    try {
      const persisted = await updateSmokePolicy(partialPolicy)
      dispatch({ type: 'SET_POLICY', payload: persisted })
      return persisted
    } catch (err) {
      dispatch({ type: 'SET_POLICY', payload: state.policy })
      dispatch({ type: 'SET_ERROR', value: err.message || 'Policy update failed' })
      throw err
    }
  }, [state.policy])

  useEffect(() => {
    refreshSmokeStatus()
  }, [refreshSmokeStatus])

  useEffect(() => {
    const id = setInterval(() => {
      flushSyncQueue().catch(() => {
        dispatch({
          type: 'SET_SYNC_STATUS',
          payload: { synced: false, lastError: 'OpenClaw queue flush failed' },
        })
      })
    }, OPENCLAW_CONFIG.flushIntervalMs)

    return () => clearInterval(id)
  }, [flushSyncQueue])

  const todayKey = getTodayKey(state.policy.timezoneOffsetMinutes ?? SMOKE_DEFAULTS.timezoneOffsetMinutes)
  const cigarettesToday = state.cigarettesByDay[todayKey] || 0

  const value = useMemo(() => ({
    state,
    todayKey,
    cigarettesToday,
    refreshSmokeStatus,
    setTelemetry,
    ingestSmokeEvent,
    updatePolicy,
    flushSyncQueue,
  }), [state, todayKey, cigarettesToday, refreshSmokeStatus, setTelemetry, ingestSmokeEvent, updatePolicy, flushSyncQueue])

  return (
    <SmokeContext.Provider value={value}>
      {children}
    </SmokeContext.Provider>
  )
}

export function useSmoke() {
  const ctx = useContext(SmokeContext)
  if (!ctx) throw new Error('useSmoke must be used inside SmokeProvider')
  return ctx
}
