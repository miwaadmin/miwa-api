import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { MiwaLogo } from './Sidebar'

/**
 * PublicNav — single source of truth for the top nav on every public
 * marketing / legal page (Home, Pricing, Features, For Trainees, For
 * Practices, About, Docs, Resources, Privacy, Security, Templates, etc).
 *
 * Design rules (locked):
 *   - White background with soft shadow + hairline border.
 *   - Logo + all four primary links on the left (Features, Pricing,
 *     For Trainees, About).
 *   - Sign In + Get Started on the right. If logged in, Sign In hides
 *     and the CTA becomes "Open Miwa" → /dashboard.
 *   - The active page's link renders bold/dark so the user knows where
 *     they are.
 *   - Fixed to the top (z-50). Consumers must pad their hero with at
 *     least pt-24 (or pt-32 for generous spacing) so content clears it.
 */

const GRAD = 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)'
const GRAD_TEXT = {
  background: GRAD,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}

function NavLink({ to, current, children }) {
  const isActive = current === to
  return (
    <Link
      to={to}
      className={
        isActive
          ? 'text-base font-semibold text-gray-900'
          : 'text-base font-medium text-gray-600 hover:text-gray-900 transition-colors'
      }
    >
      {children}
    </Link>
  )
}

export default function PublicNav() {
  const { pathname } = useLocation()
  let therapist = null
  try { therapist = useAuth()?.therapist || null } catch {}

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 lg:px-12 py-4 bg-white"
      style={{
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        boxShadow: '0 1px 20px rgba(96,71,238,0.06)',
      }}
    >
      <div className="flex items-center gap-8">
        <Link to="/" className="flex items-center gap-2.5">
          <MiwaLogo size={34} />
          <span className="font-extrabold text-xl tracking-tight" style={GRAD_TEXT}>
            Miwa
          </span>
        </Link>
        <div className="hidden lg:flex items-center gap-4 xl:gap-5">
          <NavLink to="/features"                current={pathname}>Features</NavLink>
          <NavLink to="/pricing"                 current={pathname}>Pricing</NavLink>
          <NavLink to="/for-trainees"            current={pathname}>For Trainees</NavLink>
          <NavLink to="/for-licensed-clinicians" current={pathname}>For Licensed Clinicians</NavLink>
          <NavLink to="/for-practices"           current={pathname}>For Practices</NavLink>
          <NavLink to="/resources"               current={pathname}>Resources</NavLink>
          <NavLink to="/network"                 current={pathname}>Network</NavLink>
          <NavLink to="/about"                   current={pathname}>About</NavLink>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {!therapist && (
          <Link
            to="/login"
            className="text-base font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            Sign In
          </Link>
        )}
        <Link
          to={therapist ? '/dashboard' : '/register'}
          className="px-5 py-2.5 rounded-xl text-base font-bold text-white transition-all hover:opacity-90"
          style={{ background: GRAD }}
        >
          {therapist ? 'Open Miwa' : 'Get Started'}
        </Link>
      </div>
    </nav>
  )
}
