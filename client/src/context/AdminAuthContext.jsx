/**
 * AdminAuthContext — independent admin session using the `miwa_admin_auth`
 * HttpOnly cookie.  Completely separate from the clinician AuthContext so
 * admin and clinician sessions can coexist.
 */
import { createContext, useContext, useState, useEffect } from 'react'
import { API_BASE } from '../lib/api'

const BASE = API_BASE
const AdminAuthContext = createContext(null)

function isCapacitor() {
  try { return !!(window.Capacitor?.isNativePlatform?.()) } catch { return false }
}

export function AdminAuthProvider({ children }) {
  const [admin, setAdmin] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  // On mount: check admin session via cookie or stored token
  useEffect(() => {
    const headers = {}
    const opts = { credentials: 'include' }
    if (isCapacitor()) {
      const t = localStorage.getItem('miwa_admin_token')
      if (t) headers['Authorization'] = `Bearer ${t}`
      opts.credentials = 'omit'
      opts.headers = headers
    }
    fetch(`${BASE}/auth/admin-me`, opts)
      .then(r => {
        if (!r.ok) throw new Error('no admin session')
        return r.json()
      })
      .then(data => setAdmin(data))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  function adminLogin(token, adminData) {
    if (isCapacitor() && token) {
      localStorage.setItem('miwa_admin_token', token)
    } else {
      try { localStorage.removeItem('miwa_admin_token') } catch {}
    }
    setAdmin(adminData)
  }

  async function adminLogout() {
    try {
      const opts = { method: 'POST', credentials: 'include' }
      if (isCapacitor()) {
        const t = localStorage.getItem('miwa_admin_token')
        opts.credentials = 'omit'
        if (t) opts.headers = { Authorization: `Bearer ${t}` }
      }
      await fetch(`${BASE}/auth/admin-logout`, opts)
    } catch {}
    try { localStorage.removeItem('miwa_admin_token') } catch {}
    setAdmin(null)
  }

  return (
    <AdminAuthContext.Provider value={{ admin, isLoading, adminLogin, adminLogout }}>
      {children}
    </AdminAuthContext.Provider>
  )
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used inside AdminAuthProvider')
  return ctx
}
