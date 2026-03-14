/**
 * Axios instance — the single HTTP client for the entire app.
 *
 * baseURL is resolved dynamically on every request so that
 * changing the IP in Settings takes effect immediately without
 * needing a page reload (the factory function is called lazily).
 */
import axios from 'axios'
import { getBaseUrl, getFallbackBaseUrls, normalizeBaseUrl, API_TIMEOUT } from '../config'

/**
 * Creates a fresh axios instance with the current base URL.
 * Called by each service function, not at module load time.
 * This is intentional — it picks up localStorage changes at runtime.
 */
export function createApiClient() {
  return axios.create({
    baseURL: normalizeBaseUrl(getBaseUrl()),
    timeout: API_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function normalizeError(error) {
  const payload = error.response?.data
  return {
    message:
      payload?.detail ||
      payload?.message ||
      payload?.error ||
      (error.code === 'ECONNABORTED' ? 'Request timed out' : null) ||
      error.message ||
      'Unknown network error',
    status: error.response?.status ?? null,
    retryAfterMs: Number(payload?.retryAfterMs ?? payload?.retry_after_ms ?? 0) || 0,
  }
}

/**
 * Shared response/error interceptor factory.
 * Attach to any axios instance for consistent error normalisation.
 *
 * Converts network errors, timeouts, and backend errors into a
 * uniform shape: { message: string, status: number | null }
 */
export function attachInterceptors(instance) {
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const cfg = error.config || {}
      const hasResponse = Boolean(error.response)

      // Auto-failover only for transport-level failures (no HTTP response).
      if (!hasResponse && cfg.url && error.code !== 'ECONNABORTED' && !cfg.__esp32FailoverTried) {
        const current = normalizeBaseUrl(cfg.baseURL || instance.defaults.baseURL || getBaseUrl())
        const fallbacks = getFallbackBaseUrls().filter((base) => base !== current)

        for (const baseURL of fallbacks) {
          try {
            const retryResponse = await axios.request({
              ...cfg,
              baseURL,
              __esp32FailoverTried: true,
              timeout: cfg.timeout ?? instance.defaults.timeout ?? API_TIMEOUT,
            })

            // Persist a working endpoint so subsequent calls stay stable.
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('iot_base_url', baseURL)
            }
            instance.defaults.baseURL = baseURL
            return retryResponse
          } catch (retryError) {
            if (retryError.response) {
              return Promise.reject(normalizeError(retryError))
            }
          }
        }
      }

      return Promise.reject(normalizeError(error))
    }
  )
  return instance
}
