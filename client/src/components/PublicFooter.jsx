import { MiwaLogo } from './Sidebar'

/**
 * PublicFooter — minimal footer for every public page.
 *
 * Logo + copyright. No page-link list: the top nav already covers
 * navigation, and repeating the same links at the bottom was noise.
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
        <p className="text-white/40 text-sm">&copy; 2026 Miwa. Built for clinicians.</p>
      </div>
    </footer>
  )
}
