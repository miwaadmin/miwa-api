import { NavLink, Outlet } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'
import { MiwaLogo } from './Sidebar'

const adminNav = [
  {
    to: '/admin',
    label: 'Overview',
    end: true,
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    to: '/admin/accounts',
    label: 'Accounts',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    to: '/admin/usage',
    label: 'Usage',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    to: '/admin/support',
    label: 'Support',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    to: '/admin/security',
    label: 'Security',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 3l7 4v5c0 4.5-2.9 7.9-7 9-4.1-1.1-7-4.5-7-9V7l7-4z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9.5 12.5l1.6 1.6 3.4-4.2" />
      </svg>
    ),
  },
  {
    to: '/admin/billing',
    label: 'Billing',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
]

export default function AdminLayout() {
  const { admin, adminLogout } = useAdminAuth()

  const initials = (() => {
    if (!admin) return '?'
    const f = admin.first_name?.[0] || ''
    const l = admin.last_name?.[0] || ''
    return (f + l).toUpperCase() || admin.email?.[0]?.toUpperCase() || '?'
  })()

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Admin sidebar */}
      <aside
        className="w-60 flex flex-col h-full flex-shrink-0 relative overflow-hidden"
        style={{ background: 'linear-gradient(175deg, #0a0818 0%, #1a1456 45%, #0a0818 100%)' }}
      >
        {/* Top accent — orange/amber to differentiate from clinician */}
        <div
          className="absolute top-0 left-0 right-0 h-0.5"
          style={{ background: 'linear-gradient(90deg, #f59e0b 0%, #6047EE 50%, #f59e0b 100%)' }}
        />

        {/* Logo */}
        <div className="flex items-center gap-3 px-4 pt-6 pb-2">
          <MiwaLogo size={40} />
          <div>
            <div className="text-[17px] font-bold text-white tracking-tight leading-none">Miwa</div>
            <div className="text-[11px] text-amber-400/80 mt-0.5 font-bold tracking-wider uppercase">Admin Portal</div>
          </div>
        </div>

        {/* Admin badge */}
        <div className="mx-4 mb-3 mt-1 px-3 py-1.5 rounded-lg flex items-center gap-2"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.15)' }}>
          <div className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-[11px] text-amber-400/80 font-medium">{admin?.email}</span>
        </div>

        <div className="mx-4 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)' }} />

        {/* Nav */}
        <nav className="flex-1 px-2.5 py-3 space-y-0.5">
          {adminNav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group ${
                  isActive ? 'text-white' : 'text-white/40 hover:text-white/70'
                }`
              }
              style={({ isActive }) => isActive ? {
                background: 'linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(96,71,238,0.15) 100%)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
              } : {}}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r-full"
                      style={{ background: 'linear-gradient(to bottom, #f59e0b, #6047EE)' }}
                    />
                  )}
                  <span className={`flex-shrink-0 transition-colors ${isActive ? 'text-amber-400' : 'text-white/25 group-hover:text-white/40'}`}>
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 pb-5">
          <div className="h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)' }} />
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Admin header */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-white flex-shrink-0">
          <h1 className="text-[15px] font-semibold text-gray-900 tracking-tight">Admin Console</h1>
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #6047EE)' }}
              title={admin?.full_name || admin?.email}
            >
              {initials}
            </div>
            <button
              onClick={adminLogout}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors font-medium"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-gray-50">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
