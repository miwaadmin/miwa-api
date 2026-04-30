/**
 * CommunityBanner — small dismissable card on the Dashboard inviting users
 * to the Discord (or whatever community URL is configured). Renders nothing
 * when VITE_COMMUNITY_URL isn't set, so deploys without a configured
 * community URL show no banner at all.
 *
 * Per-user dismissal is stored in localStorage so it doesn't keep nagging
 * after the user has either joined or explicitly dismissed.
 */
import { useState, useEffect } from 'react'
import { COMMUNITY_URL, COMMUNITY_LABEL, HAS_COMMUNITY } from '../lib/community'

// v2: prior versions auto-dismissed when the user clicked the join link,
// which made the banner vanish on a stray click with no obvious way back.
// Bumping the key invalidates any v1 dismissal flag so the banner returns
// for everyone once.
const STORAGE_KEY = 'miwa.community_banner.dismissed.v2'

export default function CommunityBanner() {
  const [dismissed, setDismissed] = useState(true) // default true to avoid SSR/first-paint flash
  useEffect(() => {
    try { setDismissed(localStorage.getItem(STORAGE_KEY) === '1') }
    catch { setDismissed(false) }
  }, [])

  if (!HAS_COMMUNITY || dismissed) return null

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
    setDismissed(true)
  }

  return (
    <div
      className="rounded-2xl p-4 flex items-start gap-3 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(96,71,238,0.08), rgba(45,212,191,0.06))',
        border: '1px solid rgba(96,71,238,0.18)',
      }}
    >
      <div
        className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}
      >
        <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3a13.32 13.32 0 0 0-.69 1.402 18.27 18.27 0 0 0-5.736 0A12.94 12.94 0 0 0 9.43 3a19.74 19.74 0 0 0-3.76 1.37C2.46 9.07 1.7 13.66 2.06 18.18a19.86 19.86 0 0 0 5.99 3.04 14.85 14.85 0 0 0 1.27-2.07c-.7-.26-1.36-.58-1.99-.96.17-.12.33-.25.49-.38a14.18 14.18 0 0 0 12.36 0c.16.13.32.26.49.38-.63.38-1.3.7-2 .96.36.71.79 1.4 1.27 2.07a19.84 19.84 0 0 0 6-3.04c.43-5.27-.74-9.81-3.62-13.81ZM9.55 15.74c-1.18 0-2.16-1.1-2.16-2.45 0-1.34.96-2.45 2.16-2.45 1.21 0 2.18 1.11 2.16 2.45 0 1.35-.96 2.45-2.16 2.45Zm4.92 0c-1.18 0-2.16-1.1-2.16-2.45 0-1.34.96-2.45 2.16-2.45 1.21 0 2.18 1.11 2.16 2.45 0 1.35-.95 2.45-2.16 2.45Z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0 pr-7">
        <p className="text-sm font-bold text-gray-900 leading-tight">
          Join the Miwa community
        </p>
        <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
          Early-access {COMMUNITY_LABEL.toLowerCase()} for therapists using Miwa. Share workflows, request features, and shape what ships next.
        </p>
        {/* Plain link — no auto-dismiss. The X button is the only dismissal
            path so a stray click on Join doesn't make the banner vanish for
            good with no way back short of clearing localStorage. */}
        <a
          href={COMMUNITY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 mt-2 text-xs font-bold text-brand-700 hover:text-brand-800"
        >
          Join the {COMMUNITY_LABEL}
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </a>
      </div>
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-white/60 transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
