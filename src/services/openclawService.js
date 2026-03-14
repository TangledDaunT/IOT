/**
 * openclawService — durable retry queue and idempotent sync for cigarette episodes.
 */
import { OPENCLAW_CONFIG } from '../config'
import { createApiClient, attachInterceptors } from './api'

const QUEUE_KEY = 'iot_openclaw_queue_v1'
const FAILED_KEY = 'iot_openclaw_failed_v1'

function nowMs() {
  return Date.now()
}

export function dayKeyFor(ts, timezoneOffsetMinutes) {
  const offsetMs = Number(timezoneOffsetMinutes || 0) * 60000
  const shifted = new Date(ts + offsetMs)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

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

export function loadQueue() {
  return loadJson(QUEUE_KEY, [])
}

export function saveQueue(queue) {
  saveJson(QUEUE_KEY, queue)
}

export function loadFailedMap() {
  return loadJson(FAILED_KEY, {})
}

export function saveFailedMap(failedMap) {
  saveJson(FAILED_KEY, failedMap)
}

export function buildIdempotencyKey(event) {
  return [
    event.deviceId || 'esp32-01',
    event.episodeId || 'episode-unknown',
    event.startedAt || 'start-unknown',
    event.endedAt || 'end-unknown',
  ].join(':')
}

export function enqueueEpisodeEvent(event) {
  const queue = loadQueue()
  const idempotencyKey = event.idempotencyKey || buildIdempotencyKey(event)

  if (queue.some((item) => item.idempotencyKey === idempotencyKey)) {
    return { queue, enqueued: false, idempotencyKey }
  }

  const entry = {
    idempotencyKey,
    payload: {
      ...event,
      idempotencyKey,
    },
    attempts: 0,
    nextAttemptAt: nowMs(),
    lastError: null,
    createdAt: nowMs(),
  }

  const nextQueue = [...queue, entry]
  saveQueue(nextQueue)
  return { queue: nextQueue, enqueued: true, idempotencyKey }
}

export async function sendToOpenClaw(payload) {
  const client = attachInterceptors(createApiClient())
  const res = await client.post(OPENCLAW_CONFIG.endpointPath, payload)
  return res.data
}

function backoffDelayMs(attempts) {
  const base = Math.min(OPENCLAW_CONFIG.maxRetryDelayMs, 1000 * (2 ** attempts))
  const jitter = Math.floor(Math.random() * 400)
  return base + jitter
}

export async function flushOpenClawQueue() {
  const queue = loadQueue()
  if (queue.length === 0) {
    return { pending: 0, failed: 0, syncedNow: 0 }
  }

  const failedMap = loadFailedMap()
  const t = nowMs()
  let syncedNow = 0

  const nextQueue = []
  for (const item of queue) {
    if (item.nextAttemptAt > t) {
      nextQueue.push(item)
      continue
    }

    try {
      await sendToOpenClaw(item.payload)
      syncedNow += 1
      delete failedMap[item.idempotencyKey]
    } catch (err) {
      const attempts = (item.attempts || 0) + 1
      const lastError = err?.message || 'OpenClaw sync failed'
      const retryAt = nowMs() + backoffDelayMs(attempts)

      failedMap[item.idempotencyKey] = {
        attempts,
        lastError,
        updatedAt: nowMs(),
      }

      nextQueue.push({
        ...item,
        attempts,
        lastError,
        nextAttemptAt: retryAt,
      })
    }
  }

  saveQueue(nextQueue)
  saveFailedMap(failedMap)

  const failed = Object.keys(failedMap).length
  return {
    pending: nextQueue.length,
    failed,
    syncedNow,
  }
}
