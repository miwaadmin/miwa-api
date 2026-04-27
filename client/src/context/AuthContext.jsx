/**
 * AuthContext — session is maintained by an HttpOnly cookie set by the
 * server on login/register.  No token is stored in localStorage on web.
 *
 * On mobile (Capacitor), the JWT is stored in localStorage and sent as
 * a Bearer header since cookies don't work cross-origin in WebViews.
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE } from '../lib/api'

const BASE = API_BASE
const AuthContext = createContext(null)

// Detect Capacitor native runtime — false on web browsers
function isCapacitor() {
  try { return !!(window.Capacitor?.isNativePlatform?.()) } catch { return false }
}

export function AuthProvider({ children }) {
  const [therapist, setTherapist] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  // On mount: verify session via cookie (web) or stored token (mobile)
  useEffect(() => {
    const headers = {}
    const opts = { credentials: 'include' }
    if (isCapacitor()) {
      const t = localStorage.getItem('miwa_token')
      if (t) headers['Authorization'] = `Bearer ${t}`
      opts.credentials = 'omit'
      opts.headers = headers
    }
    fetch(`${BASE}/auth/me`, opts)
      .then(r => {
        if (!r.ok) throw new Error('no session')
        return r.json()
      })
      .then(data => setTherapist(data))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  /**
   * Called after a successful login/register.
   * Web: server already set the HttpOnly cookie.
   * Mobile: store the JWT so future requests can send it as Bearer.
   */
  function login(token, therapistData) {
    if (isCapacitor() && token) {
      localStorage.setItem('miwa_token', token)
    } else {
      try { localStorage.removeItem('miwa_token') } catch {}
    }
    setTherapist(therapistData)
  }

  async function logout() {
    try {
      const opts = { method: 'POST', credentials: 'include' }
      if (isCapacitor()) {
        const t = localStorage.getItem('miwa_token')
        opts.credentials = 'omit'
        if (t) opts.headers = { Authorization: `Bearer ${t}` }
      }
      await fetch(`${BASE}/auth/logout`, opts)
    } catch {}
    try { localStorage.removeItem('miwa_token') } catch {}
    setTherapist(null)
  }

  function refreshTherapist(updatedData, _newToken) {
    if (updatedData) { setTherapist(updatedData); return }
    fetch(`${BASE}/auth/me`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setTherapist(data) })
      .catch(() => {})
  }

  // ── Idle session timeout (HIPAA § 164.312(a)(2)(iii)) ─────────────────────
  // Auto-logout after 60 minutes of no mouse/keyboard/touch activity.
  // Resets on any user interaction. Only runs when logged in.
  const IDLE_TIMEOUT_MS = 60 * 60 * 1000 // 60 minutes
  const idleTimer = useRef(null)

  const resetIdleTimer = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (!therapist) return
    idleTimer.current = setTimeout(() => {
      console.warn('[auth] Session timed out due to inactivity')
      logout()
    }, IDLE_TIMEOUT_MS)
  }, [therapist])

  useEffect(() => {
    if (!therapist) return
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, resetIdleTimer, { passive: true }))
    resetIdleTimer()
    return () => {
      events.forEach(e => window.removeEventListener(e, resetIdleTimer))
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [therapist, resetIdleTimer])

  return (
    <AuthContext.Provider value={{ therapist, isLoading, login, logout, refreshTherapist }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
