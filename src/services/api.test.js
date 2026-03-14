/**
 * API service tests — verifies HTTP client and interceptors.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createApiClient, attachInterceptors } from '../services/api'

describe('createApiClient', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
  })

  it('creates axios instance with default timeout', () => {
    const client = createApiClient()
    
    expect(client.defaults.timeout).toBe(8000)
    expect(client.defaults.headers['Content-Type']).toBe('application/json')
  })

  it('uses localStorage URL when available', () => {
    localStorage.setItem('iot_base_url', 'http://custom-url:8080')
    
    const client = createApiClient()
    
    expect(client.defaults.baseURL).toBe('http://custom-url:8080')
  })

  it('falls back to default URL when localStorage empty', () => {
    const client = createApiClient()
    
    // Should use env variable or localhost fallback
    expect(client.defaults.baseURL).toBeDefined()
  })
})

describe('attachInterceptors', () => {
  it('normalizes error with response data', async () => {
    const client = createApiClient()
    attachInterceptors(client)
    
    const mockError = {
      response: {
        data: { detail: 'Custom error message' },
        status: 400,
      },
    }
    
    // Test the interceptor by calling it directly
    const interceptor = client.interceptors.response.handlers[0]
    
    try {
      await interceptor.rejected(mockError)
    } catch (err) {
      expect(err.message).toBe('Custom error message')
      expect(err.status).toBe(400)
    }
  })

  it('handles timeout errors', async () => {
    const client = createApiClient()
    attachInterceptors(client)
    
    const mockError = {
      code: 'ECONNABORTED',
      message: 'timeout of 8000ms exceeded',
    }
    
    const interceptor = client.interceptors.response.handlers[0]
    
    try {
      await interceptor.rejected(mockError)
    } catch (err) {
      expect(err.message).toBe('Request timed out')
      expect(err.status).toBeNull()
    }
  })

  it('handles network errors without response', async () => {
    const client = createApiClient()
    attachInterceptors(client)
    
    const mockError = {
      message: 'Network Error',
    }
    
    const interceptor = client.interceptors.response.handlers[0]
    
    try {
      await interceptor.rejected(mockError)
    } catch (err) {
      expect(err.message).toBe('Network Error')
      expect(err.status).toBeNull()
    }
  })

  it('passes through successful responses', async () => {
    const client = createApiClient()
    attachInterceptors(client)
    
    const mockResponse = { data: { id: 1, isOn: true } }
    
    const interceptor = client.interceptors.response.handlers[0]
    const result = interceptor.fulfilled(mockResponse)
    
    expect(result).toBe(mockResponse)
  })

  it('normalizes 423 safety-lock retry payload', async () => {
    const client = createApiClient()
    attachInterceptors(client)

    const mockError = {
      response: {
        data: { error: 'Relay 1 locked OFF due to smoke safety hold', retryAfterMs: 19000 },
        status: 423,
      },
    }

    const interceptor = client.interceptors.response.handlers[0]

    try {
      await interceptor.rejected(mockError)
    } catch (err) {
      expect(err.message).toBe('Relay 1 locked OFF due to smoke safety hold')
      expect(err.status).toBe(423)
      expect(err.retryAfterMs).toBe(19000)
    }
  })
})
