import { createContext, useContext, useEffect, useState } from 'react'
import { API_BASE } from '../lib/api'

const ClientAuthContext = createContext(null)

function isCapacitor() {
  try { return !!(window.Capacitor?.isNativePlatform?.()) } catch { return false }
}

export function ClientAuthProvider({ children }) {
  const [client, setClient] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const opts = { credentials: 'include' }
    if (isCapacitor()) {
      const token = localStorage.getItem('miwa_client_token')
      opts.credentials = 'omit'
      if (token) opts.headers = { Authorization: `Bearer ${token}` }
    }
    fetch(`${API_BASE}/client-auth/me`, opts)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setClient(data) })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  function login(token, clientData) {
    if (isCapacitor() && token) localStorage.setItem('miwa_client_token', token)
    else try { localStorage.removeItem('miwa_client_token') } catch {}
    setClient(clientData)
  }

  async function logout() {
    try {
      const opts = { method: 'POST', credentials: 'include' }
      if (isCapacitor()) {
        const token = localStorage.getItem('miwa_client_token')
        opts.credentials = 'omit'
        if (token) opts.headers = { Authorization: `Bearer ${token}` }
      }
      await fetch(`${API_BASE}/client-auth/logout`, opts)
    } catch {}
    try { localStorage.removeItem('miwa_client_token') } catch {}
    setClient(null)
  }

  return (
    <ClientAuthContext.Provider value={{ client, isLoading, login, logout }}>
      {children}
    </ClientAuthContext.Provider>
  )
}

export function useClientAuth() {
  const ctx = useContext(ClientAuthContext)
  if (!ctx) throw new Error('useClientAuth must be used inside ClientAuthProvider')
  return ctx
}
