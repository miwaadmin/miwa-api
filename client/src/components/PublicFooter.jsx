import { MiwaLogo } from './Sidebar'
import { COMMUNITY_URL, COMMUNITY_LABEL, HAS_COMMUNITY } from '../lib/community'

/**
 * PublicFooter — minimal footer for every public page.
 *
 * Logo + copyright. Adds a Community link when VITE_COMMUNITY_URL is
 * configured — gives anonymous visitors on miwa.care a path into the
 * Discord without forcing them to sign up first.
 */
export default function PublicFooter() {
  return (
    <footer
      className="py-12 px-8 lg:px-12"
      style={{ background: '#0d0b24', borderTop: '1px solid rgba(96,71,238,0.2)' }}
    >
      <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <MiwaLogo size={22} />
          <span
            className="font-bold text-base"
            style={{
              background: 'linear-gradient(135deg, #6047EE 0%, #2dd4bf 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Miwa.care
          </span>
        </div>
        <div className="flex items-center gap-5">
          {HAS_COMMUNITY && (
            <a
              href={COMMUNITY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/60 hover:text-white text-sm font-medium flex items-center gap-1.5 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3a13.32 13.32 0 0 0-.69 1.402 18.27 18.27 0 0 0-5.736 0A12.94 12.94 0 0 0 9.43 3a19.74 19.74 0 0 0-3.76 1.37C2.46 9.07 1.7 13.66 2.06 18.18a19.86 19.86 0 0 0 5.99 3.04 14.85 14.85 0 0 0 1.27-2.07c-.7-.26-1.36-.58-1.99-.96.17-.12.33-.25.49-.38a14.18 14.18 0 0 0 12.36 0c.16.13.32.26.49.38-.63.38-1.3.7-2 .96.36.71.79 1.4 1.27 2.07a19.84 19.84 0 0 0 6-3.04c.43-5.27-.74-9.81-3.62-13.81ZM9.55 15.74c-1.18 0-2.16-1.1-2.16-2.45 0-1.34.96-2.45 2.16-2.45 1.21 0 2.18 1.11 2.16 2.45 0 1.35-.96 2.45-2.16 2.45Zm4.92 0c-1.18 0-2.16-1.1-2.16-2.45 0-1.34.96-2.45 2.16-2.45 1.21 0 2.18 1.11 2.16 2.45 0 1.35-.95 2.45-2.16 2.45Z" />
              </svg>
              {COMMUNITY_LABEL}
            </a>
          )}
          <p className="text-white/40 text-sm">&copy; 2026 Miwa. Built for clinicians.</p>
        </div>
      </div>
    </footer>
  )
}
