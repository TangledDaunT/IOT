/**
 * openclawService tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => {
  return {
    createApiClient: vi.fn(() => ({
      post: vi.fn(() => Promise.resolve({ data: { ok: true } })),
      interceptors: { response: { use: vi.fn(), handlers: [] } },
    })),
    attachInterceptors: vi.fn((client) => client),
  }
})

import {
  buildIdempotencyKey,
  dayKeyFor,
  enqueueEpisodeEvent,
  flushOpenClawQueue,
  loadQueue,
  saveQueue,
} from './openclawService'

describe('openclawService', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('computes day key with timezone offset', () => {
    const ts = Date.UTC(2026, 2, 13, 23, 30, 0)
    expect(dayKeyFor(ts, 120)).toBe('2026-03-14')
  })

  it('enqueues event once by idempotency key', () => {
    const event = {
      episodeId: 'ep-1',
      deviceId: 'esp32-1',
      startedAt: 10,
      endedAt: 20,
    }

    const first = enqueueEpisodeEvent(event)
    const second = enqueueEpisodeEvent(event)

    expect(first.enqueued).toBe(true)
    expect(second.enqueued).toBe(false)
    expect(loadQueue()).toHaveLength(1)
  })

  it('flushes queue and marks entries synced', async () => {
    saveQueue([
      {
        idempotencyKey: buildIdempotencyKey({
          episodeId: 'ep-1',
          deviceId: 'd1',
          startedAt: 1,
          endedAt: 2,
        }),
        payload: { episodeId: 'ep-1' },
        attempts: 0,
        nextAttemptAt: 0,
      },
    ])

    const result = await flushOpenClawQueue()
    expect(result.pending).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.syncedNow).toBe(1)
  })
})
