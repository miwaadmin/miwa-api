import { NavLink, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

const navItems = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    end: true,
    activeColor: 'text-indigo-300',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    to: '/workspace',
    label: 'Workspace',
    tourId: 'workspace',
    activeColor: 'text-violet-300',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    to: '/schedule',
    label: 'Schedule',
    tourId: 'schedule',
    activeColor: 'text-cyan-300',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 2v4m8-4v4M3 10h18M5 6h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
      </svg>
    ),
  },
  {
    to: '/patients',
    label: 'Patients',
    tourId: 'patients',
    activeColor: 'text-sky-300',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    to: '/outcomes',
    label: 'Outcomes',
    tourId: 'outcomes',
    activeColor: 'text-emerald-300',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    to: '/consult',
    label: 'Consult',
    activeColor: 'text-teal-300',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    to: '/briefs',
    label: 'Briefs',
    activeColor: 'text-amber-300',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
      </svg>
    ),
  },
  {
    to: '/library',
    label: 'Resources',
    activeColor: 'text-orange-300',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    to: '/contacts',
    label: 'Contacts',
    activeColor: 'text-cyan-300',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    to: '/billing',
    label: 'Billing',
    activeColor: 'text-emerald-300',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    activeColor: 'text-gray-300',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

export function MiwaLogo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="miwa-bg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6047EE" />
          <stop offset="100%" stopColor="#1b1560" />
        </linearGradient>
        <radialGradient id="miwa-inner" cx="50%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#7c6af7" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#7c6af7" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Background rounded square */}
      <rect width="40" height="40" rx="11" fill="url(#miwa-bg)" />
      {/* Inner radial glow */}
      <rect width="40" height="40" rx="11" fill="url(#miwa-inner)" />
      {/* Subtle border */}
      <rect x="0.75" y="0.75" width="38.5" height="38.5" rx="10.25" stroke="white" strokeOpacity="0.15" strokeWidth="1.5" fill="none" />
      {/* M letterform — two curved arches meeting at center */}
      <path
        d="M8 28 L8 16 C8 11 12.5 9 16.5 13.5 L20 19.5 L23.5 13.5 C27.5 9 32 11 32 16 L32 28"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeOpacity="0.95"
      />
      {/* Teal node at the valley — the "mind spark" */}
      <circle cx="20" cy="19.5" r="3" fill="#2dd4bf" />
      <circle cx="20" cy="19.5" r="5.5" fill="#2dd4bf" fillOpacity="0.2" />
      <circle cx="19.2" cy="18.5" r="1.1" fill="white" fillOpacity="0.6" />
    </svg>
  )
}

export default function Sidebar() {
  const { therapist } = useAuth()
  const [alertCount, setAlertCount] = useState(0)

  // Poll for unread alert count every 5 minutes
  useEffect(() => {
    let cancelled = false
    function fetchAlerts() {
      apiFetch('/patients/alerts').then(r => r.json()).then(data => {
        if (!cancelled && Array.isArray(data)) setAlertCount(data.length)
      }).catch(() => {})
    }
    fetchAlerts()
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Listen for alert dismissals from Dashboard so count stays in sync
  useEffect(() => {
    const handler = () => {
      apiFetch('/patients/alerts').then(r => r.json()).then(data => {
        if (Array.isArray(data)) setAlertCount(data.length)
      }).catch(() => {})
    }
    window.addEventListener('miwa:alert_dismissed', handler)
    return () => window.removeEventListener('miwa:alert_dismissed', handler)
  }, [])

  // Practice nav removed — group practice is a separate product
  const visibleNavItems = navItems

  return (
    <aside
      data-tour="sidebar"
      className="w-60 flex flex-col h-full flex-shrink-0 relative overflow-hidden"
      style={{ background: 'linear-gradient(175deg, #18134d 0%, #221a6e 45%, #18134d 100%)' }}
    >
      {/* Rainbow top accent line */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5"
        style={{ background: 'linear-gradient(90deg, #6047EE 0%, #818cf8 40%, #2dd4bf 70%, #6047EE 100%)' }}
      />

      {/* Decorative background circle */}
      <div
        className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(96,71,238,0.25) 0%, transparent 70%)' }}
      />

      {/* Logo area */}
      <div className="flex items-center gap-3 px-4 pt-6 pb-5">
        <MiwaLogo size={40} />
        <div>
          <div className="text-[17px] font-bold text-white tracking-tight leading-none">Miwa</div>
          <div className="text-[13px] text-indigo-300/80 mt-0.5 font-medium tracking-wider uppercase">Therapist Copilot</div>
        </div>
      </div>

      <div className="mx-4 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)' }} />

      {/* Navigation */}
      <nav className="flex-1 px-2.5 py-3 space-y-0.5">
        {visibleNavItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            {...(item.tourId ? { 'data-tour': item.tourId } : {})}
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group ${
                isActive
                  ? 'text-white'
                  : 'text-white/50 hover:text-white/80'
              }`
            }
            style={({ isActive }) => isActive ? {
              background: 'linear-gradient(135deg, rgba(96,71,238,0.35) 0%, rgba(45,212,191,0.1) 100%)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
            } : {}}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r-full"
                    style={{ background: 'linear-gradient(to bottom, #818cf8, #2dd4bf)' }}
                  />
                )}
                <span className={`flex-shrink-0 transition-colors ${isActive ? item.activeColor : 'text-white/30 group-hover:text-white/50'}`}>
                  {item.icon}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge && (
                  <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-md tracking-wide"
                    style={{ background: 'rgba(45,212,191,0.15)', color: '#5eead4', border: '1px solid rgba(45,212,191,0.2)' }}>
                    {item.badge}
                  </span>
                )}
                {item.to === '/dashboard' && alertCount > 0 && (
                  <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center"
                    style={{ background: 'rgba(239,68,68,0.85)', color: 'white', fontSize: '9px' }}>
                    {alertCount > 9 ? '9+' : alertCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Homepage link */}
      <div className="px-4 pb-5">
        <div className="h-px mb-3" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)' }} />
        <Link
          to="/"
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-white/35 hover:text-white/60 transition-colors group"
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0 text-white/25 group-hover:text-white/50 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span>Back to Homepage</span>
        </Link>
      </div>
    </aside>
  )
}
