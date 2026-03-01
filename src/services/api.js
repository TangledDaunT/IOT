/**
 * Axios instance — the single HTTP client for the entire app.
 *
 * baseURL is resolved dynamically on every request so that
 * changing the IP in Settings takes effect immediately without
 * needing a page reload (the factory function is called lazily).
 */
import axios from 'axios'
import { getBaseUrl, API_TIMEOUT } from '../config'

/**
 * Creates a fresh axios instance with the current base URL.
 * Called by each service function, not at module load time.
 * This is intentional — it picks up localStorage changes at runtime.
 */
export function createApiClient() {
  return axios.create({
    baseURL: getBaseUrl(),
    timeout: API_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
    },
  })
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
    (error) => {
      const normalised = {
        message:
          error.response?.data?.detail ||
          error.response?.data?.message ||
          (error.code === 'ECONNABORTED' ? 'Request timed out' : null) ||
          error.message ||
          'Unknown network error',
        status: error.response?.status ?? null,
      }
      return Promise.reject(normalised)
    }
  )
  return instance
}
