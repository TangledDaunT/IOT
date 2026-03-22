/**
 * securityService — shared client-side auth and MFA helpers.
 */
import { getBaseUrl } from '../config'

const TOKEN_KEY = 'iot_api_token'
const MFA_TOKEN_KEY = 'iot_mfa_token'
const MFA_EXPIRES_KEY = 'iot_mfa_token_exp'

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Ignore quota/storage failures for non-critical UX helpers.
  }
}

export function resolveEdgeApiBaseUrl() {
  const edgeBase = import.meta.env.VITE_EDGE_API_BASE_URL
  if (edgeBase && String(edgeBase).trim()) return String(edgeBase).trim().replace(/\/+$/, '')

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const proto = window.location.protocol === 'https:' ? 'https:' : 'http:'
    return `${proto}//${window.location.hostname}:8088`
  }

  return getBaseUrl()
}

export function getApiToken() {
  const saved = safeStorageGet(TOKEN_KEY)
  if (saved && saved.trim()) return saved.trim()

  const envToken = import.meta.env.VITE_IOT_API_TOKEN
  return envToken && String(envToken).trim() ? String(envToken).trim() : ''
}

export function setApiToken(token) {
  const normalized = String(token || '').trim()
  if (!normalized) {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      // no-op
    }
    return
  }
  safeStorageSet(TOKEN_KEY, normalized)
}

export function getAuthHeaders(existing = {}) {
  const token = getApiToken()
  if (!token) return { ...existing }
  return {
    ...existing,
    Authorization: `Bearer ${token}`,
  }
}

export function getMfaToken() {
  const token = safeStorageGet(MFA_TOKEN_KEY)
  const expRaw = safeStorageGet(MFA_EXPIRES_KEY)
  const exp = Number(expRaw || 0)
  if (!token || !exp || Date.now() >= exp) {
    clearMfaToken()
    return ''
  }
  return token
}

export function clearMfaToken() {
  try {
    localStorage.removeItem(MFA_TOKEN_KEY)
    localStorage.removeItem(MFA_EXPIRES_KEY)
  } catch {
    // no-op
  }
}

function setMfaToken(token, expiresInSeconds) {
  const ttlMs = Math.max(1, Number(expiresInSeconds || 0)) * 1000
  safeStorageSet(MFA_TOKEN_KEY, token)
  safeStorageSet(MFA_EXPIRES_KEY, String(Date.now() + ttlMs))
}

export function getMfaHeaders(existing = {}) {
  const token = getMfaToken()
  if (!token) return { ...existing }
  return {
    ...existing,
    'X-IOT-MFA-Token': token,
  }
}

export async function ensureStepUpMfa(reason = 'sensitive operation') {
  const existing = getMfaToken()
  if (existing) return existing

  const base = resolveEdgeApiBaseUrl()

  const challengeRes = await fetch(`${base}/api/security/mfa/challenge`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ reason }),
  })
  if (!challengeRes.ok) {
    throw new Error('Could not start MFA challenge')
  }

  const challenge = await challengeRes.json()
  const code = window.prompt('Enter MFA code to continue:')
  if (!code || !String(code).trim()) {
    throw new Error('MFA verification cancelled')
  }

  const verifyRes = await fetch(`${base}/api/security/mfa/verify`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      challenge_id: challenge.challenge_id,
      code: String(code).trim(),
    }),
  })
  if (!verifyRes.ok) {
    throw new Error('Invalid MFA code')
  }

  const verified = await verifyRes.json()
  setMfaToken(verified.mfa_token, verified.expires_in_s)
  return verified.mfa_token
}
