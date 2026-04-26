/**
 * PublicPageShell — white base with Miwa brand colors (purple / teal / white).
 * Sections control their own accent patches. Dark nav + footer frame the page.
 */
export default function PublicPageShell({ children }) {
  return (
    <div
      className="public-page min-h-screen"
      style={{
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      {children}
    </div>
  )
}
