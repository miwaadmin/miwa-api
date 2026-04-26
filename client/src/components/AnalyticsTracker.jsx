import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * AnalyticsTracker — privacy-scoped Umami pageview tracking.
 *
 * The Umami script in index.html is loaded with data-auto-track="false",
 * which means it does NOT record pageviews on its own. This component
 * watches the route and calls umami.track() ONLY when the current path
 * is a public marketing/auth route.
 *
 * Authenticated pages, patient-facing token URLs, and the mobile app are
 * intentionally NOT tracked because their URLs can contain identifiers
 * that could be linked back to PHI (e.g., /patients/17, /assess/{token},
 * /portal/{token}, /m/clients/3). Never tracking them is the only
 * defensible posture for a HIPAA-adjacent healthcare product.
 *
 * When adding a new public route, add its path to PUBLIC_PATHS below.
 */

// Exact-match public paths (landing, marketing, legal, auth)
const PUBLIC_EXACT = new Set([
  '/',
  '/features',
  '/pricing',
  '/about',
  '/for-trainees',
  '/for-practices',
  '/security',
  '/privacy',
  '/delete-account',
  '/resources',
  '/lethality-screen',
  '/network',
  '/templates',
  '/docs',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
])

// Prefix-match paths — anything starting with these is tracked.
// (None right now — all public routes above are exact-match. Leave as
// scaffolding in case we add e.g. /blog/:slug later.)
const PUBLIC_PREFIXES = []

function isPublicPath(pathname) {
  if (PUBLIC_EXACT.has(pathname)) return true
  return PUBLIC_PREFIXES.some(p => pathname.startsWith(p))
}

/**
 * Fire umami.track() with a small retry loop — on first paint after a
 * cold reload, the deferred Umami script may not have attached window.umami
 * yet. Retry a few times at 200ms intervals rather than losing the event.
 */
function trackWhenReady(retries = 10) {
  if (typeof window === 'undefined') return
  if (window.umami?.track) {
    try { window.umami.track() } catch { /* swallow */ }
    return
  }
  if (retries > 0) {
    setTimeout(() => trackWhenReady(retries - 1), 200)
  }
}

export default function AnalyticsTracker() {
  const location = useLocation()
  useEffect(() => {
    if (!isPublicPath(location.pathname)) return
    trackWhenReady()
  }, [location.pathname])
  return null
}
