import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * ScrollToTop — resets the window scroll to (0, 0) on every client-side
 * route change. Without this, React Router preserves browser scroll
 * position when navigating via <Link>, which means clicking "Compare
 * solo plans" from a scrolled-down page lands the user wherever the
 * browser last remembered — typically the bottom of the new page.
 *
 * If the URL has a hash fragment (#section), we leave scroll alone so
 * anchor links still work. If the navigation is a back/forward action
 * (POP), we also leave it — preserving scroll there is the natural UX.
 */
export default function ScrollToTop() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (hash) return // let in-page anchors handle themselves
    // Next-tick so the new route has rendered before we scroll.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, hash])

  return null
}
