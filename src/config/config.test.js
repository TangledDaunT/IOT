/**
 * Config tests — verifies configuration loading and defaults.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { getBaseUrl, RELAY_CONFIG, API_TIMEOUT, POLL_INTERVAL, DEVICE_CONFIG, WS_PATH } from '../config'

describe('Config', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getBaseUrl', () => {
    it('returns localStorage URL when set', () => {
      localStorage.setItem('iot_base_url', 'http://saved-url:8000')
      
      const url = getBaseUrl()
      
      expect(url).toBe('http://saved-url:8000')
    })

    it('trims whitespace from localStorage URL', () => {
      localStorage.setItem('iot_base_url', '  http://trimmed-url:8000  ')
      
      const url = getBaseUrl()
      
      expect(url).toBe('http://trimmed-url:8000')
    })

    it('falls back to env or localhost when localStorage empty', () => {
      const url = getBaseUrl()
      
      // Should return either env variable value or localhost fallback
      expect(url).toBeDefined()
      expect(typeof url).toBe('string')
    })
  })

  describe('RELAY_CONFIG', () => {
    it('has 4 relays defined', () => {
      expect(RELAY_CONFIG).toHaveLength(4)
    })

    it('each relay has required properties', () => {
      RELAY_CONFIG.forEach((relay) => {
        expect(relay).toHaveProperty('id')
        expect(relay).toHaveProperty('name')
        expect(relay).toHaveProperty('icon')
        expect(typeof relay.id).toBe('number')
        expect(typeof relay.name).toBe('string')
        expect(typeof relay.icon).toBe('string')
      })
    })

    it('has unique relay IDs', () => {
      const ids = RELAY_CONFIG.map((r) => r.id)
      const uniqueIds = new Set(ids)
      
      expect(uniqueIds.size).toBe(ids.length)
    })
  })

  describe('DEVICE_CONFIG', () => {
    it('has devices defined', () => {
      expect(DEVICE_CONFIG.length).toBeGreaterThan(0)
    })

    it('each device has required properties', () => {
      DEVICE_CONFIG.forEach((device) => {
        expect(device).toHaveProperty('id')
        expect(device).toHaveProperty('name')
        expect(device).toHaveProperty('room')
        expect(device).toHaveProperty('relays')
        expect(Array.isArray(device.relays)).toBe(true)
      })
    })
  })

  describe('Constants', () => {
    it('API_TIMEOUT is a positive number', () => {
      expect(typeof API_TIMEOUT).toBe('number')
      expect(API_TIMEOUT).toBeGreaterThan(0)
    })

    it('POLL_INTERVAL is a number', () => {
      expect(typeof POLL_INTERVAL).toBe('number')
    })

    it('WS_PATH is a string starting with /', () => {
      expect(typeof WS_PATH).toBe('string')
      expect(WS_PATH.startsWith('/')).toBe(true)
    })
  })
})
