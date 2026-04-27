/**
 * API helpers — all requests use credentials:'include' so the HttpOnly auth
 * cookie is sent automatically on web.  On mobile (Capacitor), the
 * Authorization header is used instead (see AuthContext for token storage).
 */
// On web: relative /api. On Capacitor native: full API URL (no local server on phone)
export const API_BASE = (() => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  try {
    if (window.Capacitor?.isNativePlatform?.()) return 'https://api.miwa.care/api'
  } catch {}
  return '/api'
})()

const BASE = API_BASE

function mobileBearerHeader() {
  try {
    const t = localStorage.getItem('miwa_token')
    return t ? { Authorization: `Bearer ${t}` } : {}
  } catch { return {} }
}

function isCapacitor() {
  try { return !!(window.Capacitor?.isNativePlatform?.()) } catch { return false }
}

export async function apiFetch(path, options = {}) {
  const { headers: extraHeaders, ...rest } = options
  const mobile = isCapacitor()
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    credentials: mobile ? 'omit' : 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(mobile ? mobileBearerHeader() : {}),
      ...(extraHeaders || {}),
    },
  })
  if (res.status === 401) {
    if (mobile) try { localStorage.removeItem('miwa_token') } catch {}
    window.location.href = '/login'
    return res
  }
  return res
}

export async function apiUpload(path, formData, method = 'POST') {
  const mobile = isCapacitor()
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: mobile ? 'omit' : 'include',
    headers: mobile ? mobileBearerHeader() : {},
    body: formData,
  })
  if (res.status === 401) {
    if (mobile) try { localStorage.removeItem('miwa_token') } catch {}
    window.location.href = '/login'
  }
  return res
}

export function getToken() {
  try { return localStorage.getItem('miwa_token') } catch { return null }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem('miwa_token', token)
    else localStorage.removeItem('miwa_token')
  } catch {}
}

/**
 * Admin API fetch — identical to apiFetch but redirects to /admin/login on 401
 * and uses the admin-specific mobile token.
 */
export async function adminApiFetch(path, options = {}) {
  const { headers: extraHeaders, ...rest } = options
  const mobile = isCapacitor()
  const mobileHeader = (() => {
    try {
      const t = localStorage.getItem('miwa_admin_token')
      return t ? { Authorization: `Bearer ${t}` } : {}
    } catch { return {} }
  })()
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    credentials: mobile ? 'omit' : 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(mobile ? mobileHeader : {}),
      ...(extraHeaders || {}),
    },
  })
  if (res.status === 401) {
    if (mobile) try { localStorage.removeItem('miwa_admin_token') } catch {}
    window.location.href = '/admin/login'
    return res
  }
  return res
}

/** @deprecated */
export function authHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', ...extra }
}
