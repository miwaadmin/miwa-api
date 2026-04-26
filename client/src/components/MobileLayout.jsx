/**
 * MobileLayout — purpose-built mobile action hub for clinicians.
 * Replaces the desktop Layout on small screens / Capacitor native.
 * Bottom tab bar with 5 tabs, compact header, full-height content.
 */
import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { therapistInitials } from '../lib/avatar'
import { apiFetch } from '../lib/api'
import TaskInbox from './TaskInbox'

export default function MobileLayout() {
  const { therapist, logout } = useAuth()
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [showAlerts, setShowAlerts] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const initials = therapistInitials(therapist)

  useEffect(() => {
    fetchAlerts()
    const iv = setInterval(fetchAlerts, 30_000)
    return () => clearInterval(iv)
  }, [])

  const fetchAlerts = async () => {
    try {
      const res = await apiFetch('/patients/alerts')
      if (res.ok) {
        const data = await res.json()
        setAlerts(Array.isArray(data) ? data : [])
      }
    } catch {}
  }

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">
      {/* ── Compact top header ─────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 h-12 bg-white border-b border-gray-100 shrink-0 z-30">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
            style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
          >
            M
          </div>
          <span className="text-sm font-semibold text-gray-900 tracking-tight">Miwa</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Background tasks inbox */}
          <TaskInbox onOpenDetail={(id) => navigate(`/m/tasks/${id}`)} />

          {/* Notification bell */}
          <div className="relative">
            <button
              onClick={() => { setShowAlerts(!showAlerts); setShowProfile(false) }}
              className="relative w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 active:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {alerts.length > 0 && (
                <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {Math.min(alerts.length, 9)}
                </span>
              )}
            </button>

            {/* Alerts dropdown */}
            {showAlerts && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowAlerts(false)} />
                <div className="absolute right-0 top-10 z-50 w-80 max-h-80 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col">
                  <div className="px-4 py-2.5 border-b border-gray-100 bg-white">
                    <h3 className="text-sm font-semibold text-gray-900">
                      {alerts.length === 0 ? 'No alerts' : `${alerts.length} Alert${alerts.length !== 1 ? 's' : ''}`}
                    </h3>
                  </div>
                  {alerts.length > 0 ? (
                    <div className="overflow-y-auto">
                      {alerts.slice(0, 5).map(alert => (
                        <div key={alert.id} className="px-4 py-2.5 border-b border-gray-50 last:border-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                              alert.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                              alert.severity === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>
                              {alert.severity}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-gray-900">{alert.title}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{alert.description}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-6 text-center text-xs text-gray-500">All clear!</div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Profile avatar */}
          <div className="relative">
            <button
              onClick={() => { setShowProfile(!showProfile); setShowAlerts(false) }}
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white overflow-hidden border border-white/40"
              style={{ background: therapist?.avatar_url ? '#e5e7eb' : 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
            >
              {therapist?.avatar_url ? (
                <img src={therapist.avatar_url} alt={`${therapist?.full_name || 'Therapist'} profile`} className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </button>

            {showProfile && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowProfile(false)} />
                <div className="absolute right-0 top-10 z-50 w-52 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-900 truncate">{therapist?.full_name || 'Clinician'}</p>
                    <p className="text-[11px] text-gray-500 truncate">{therapist?.email}</p>
                  </div>
                  <button
                    onClick={() => { setShowProfile(false); navigate('/settings') }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Settings
                  </button>
                  <button
                    onClick={logout}
                    className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors border-t border-gray-100"
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Content area ───────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto min-h-0">
        <Outlet />
      </main>

      {/* ── Bottom tab bar ─────────────────────────────────────────── */}
      <nav
        className="shrink-0 flex items-end justify-around bg-gray-900 z-30"
        style={{ minHeight: 72, paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}
      >
        <TabLink to="/m" end icon={TabIcons.today} label="Today" />
        <TabLink to="/m/clients" icon={TabIcons.clients} label="Clients" />

        {/* Center record button — elevated */}
        <NavLink
          to="/m/record"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center -mt-4 transition-all duration-200 ${isActive ? '' : ''}`
          }
        >
          {({ isActive }) => (
            <>
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 ${
                  isActive ? 'scale-105' : ''
                }`}
                style={{ background: 'linear-gradient(135deg, #6366f1, #0ac5a2)' }}
              >
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <span className={`text-[10px] mt-0.5 font-medium ${isActive ? 'text-indigo-400' : 'text-gray-500'}`}>
                Record
              </span>
            </>
          )}
        </NavLink>

        <TabLink to="/m/miwa" icon={TabIcons.miwa} label="Miwa" />
        <TabLink to="/m/more" icon={TabIcons.more} label="More" />
      </nav>
    </div>
  )
}

/* ── Tab link helper ──────────────────────────────────────────────── */
function TabLink({ to, end, icon, label }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center py-2 px-3 min-w-[56px] transition-colors duration-200 ${
          isActive ? 'text-indigo-400' : 'text-gray-500'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {icon(isActive)}
          <span className="text-[10px] mt-0.5 font-medium">{label}</span>
        </>
      )}
    </NavLink>
  )
}

/* ── Tab icons ────────────────────────────────────────────────────── */
const TabIcons = {
  today: (active) => (
    <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 0 : 1.75}>
      {active ? (
        <path d="M6 2a1 1 0 011 1v1h10V3a1 1 0 112 0v1h1a3 3 0 013 3v12a3 3 0 01-3 3H4a3 3 0 01-3-3V7a3 3 0 013-3h1V3a1 1 0 011-1zm-2 8v9a1 1 0 001 1h14a1 1 0 001-1v-9H4z" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v4m8-4v4M3 10h18M5 6h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
      )}
    </svg>
  ),

  clients: (active) => (
    <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 0 : 1.75}>
      {active ? (
        <path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      )}
    </svg>
  ),

  miwa: (active) => (
    <div
      className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold transition-all duration-200 ${
        active ? 'text-white' : 'text-gray-400 border border-gray-600'
      }`}
      style={active ? { background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' } : {}}
    >
      M
    </div>
  ),

  more: (active) => (
    <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 0 : 1.75}>
      {active ? (
        <>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </>
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
      )}
    </svg>
  ),
}
