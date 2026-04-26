import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTour } from '../context/TourContext'
import { therapistInitials } from '../lib/avatar'
import { apiFetch } from '../lib/api'
import TaskInbox from './TaskInbox'

const pageMeta = {
  '/dashboard':  { title: 'Dashboard' },
  '/patients':   { title: 'Patients' },
  '/consult': { title: 'Consult' },
  '/workspace':  { title: 'Session Workspace' },
  '/billing':    { title: 'Billing' },
  '/settings':   { title: 'Settings' },
}

function getMeta(pathname) {
  if (pageMeta[pathname]) return pageMeta[pathname]
  if (pathname.includes('/sessions/new')) return { title: 'New Session Note' }
  if (pathname.includes('/sessions/'))   return { title: 'Session Note' }
  if (pathname.match(/^\/patients\/\d+$/)) return { title: 'Patient Details' }
  return { title: 'Miwa' }
}

export default function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const { therapist, logout } = useAuth()
  const { startTour } = useTour()
  const { title } = getMeta(location.pathname)
  const [alerts, setAlerts] = useState([])
  const [showAlertsPanel, setShowAlertsPanel] = useState(false)

  useEffect(() => {
    fetchAlerts()
    // Refresh alerts every 30 seconds
    const interval = setInterval(fetchAlerts, 30_000)
    return () => clearInterval(interval)
  }, [])

  const fetchAlerts = async () => {
    try {
      const res = await apiFetch('/patients/alerts')
      if (res.ok) {
        const data = await res.json()
        setAlerts(Array.isArray(data) ? data : [])
      }
    } catch {
      // Silently fail
    }
  }

  const dismissAlert = async (alertId) => {
    try {
      await apiFetch(`/patients/alerts/${alertId}/dismiss`, { method: 'POST' })
      setAlerts(alerts.filter(a => a.id !== alertId))
    } catch {}
  }

  const isSubPage = location.pathname !== '/dashboard' &&
    !['patients','supervisor','workspace','settings','billing'].some(p => location.pathname === `/${p}`)

  const initials = therapistInitials(therapist)

  return (
    <header className="app-header flex items-center justify-between px-3 md:px-6 flex-shrink-0 gap-3">
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        {isSubPage && (
          <button
            onClick={() => navigate(-1)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <h1 className="text-sm md:text-[15px] font-semibold text-gray-900 tracking-tight truncate max-w-[42vw] sm:max-w-none">{title}</h1>
      </div>

      <div className="flex items-center gap-2 md:gap-3 shrink-0">

        {/* App tour / help button */}
        <button
          onClick={startTour}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
          title="Take an app tour"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>

        {/* Background agent tasks inbox */}
        <TaskInbox onOpenDetail={(id) => navigate(`/tasks/${id}`)} />

        {/* Alerts bell with badge and panel */}
        <div className="relative">
          <button
            onClick={() => setShowAlertsPanel(!showAlertsPanel)}
            className="relative w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-brand-600 hover:bg-brand-50 transition-colors"
            title={alerts.length === 0 ? 'No alerts' : `${alerts.length} alert${alerts.length !== 1 ? 's' : ''}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {alerts.length > 0 && (
              <span className="absolute top-0 right-0 w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">
                {Math.min(alerts.length, 9)}
              </span>
            )}
          </button>

          {/* Alerts dropdown panel */}
          {showAlertsPanel && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowAlertsPanel(false)}
              />
              <div className="absolute right-0 top-10 z-50 w-96 max-h-96 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-gray-100 sticky top-0 bg-white">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {alerts.length === 0 ? 'No alerts' : `${alerts.length} Alert${alerts.length !== 1 ? 's' : ''}`}
                  </h3>
                </div>
                {alerts.length > 0 ? (
                  <div className="overflow-y-auto">
                    {alerts.map(alert => (
                      <div
                        key={alert.id}
                        className="px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                  alert.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                                  alert.severity === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                                  alert.severity === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-blue-100 text-blue-700'
                                }`}
                              >
                                {alert.severity}
                              </span>
                              <span className="text-xs text-gray-400">
                                {alert.display_name || alert.client_id}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-gray-900">{alert.title}</p>
                            <p className="text-xs text-gray-600 mt-0.5">{alert.description}</p>
                          </div>
                          <button
                            onClick={() => dismissAlert(alert.id)}
                            className="p-1 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors mt-0.5"
                            title="Dismiss"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-8 text-center text-sm text-gray-500">
                    All clear! No active alerts.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Therapist avatar + logout */}
        {therapist && (
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white cursor-pointer overflow-hidden border border-white/40"
              style={{ background: therapist?.avatar_url ? '#e5e7eb' : 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
              title={therapist.full_name || therapist.email}
            >
              {therapist?.avatar_url ? (
                <img src={therapist.avatar_url} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors font-medium"
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
