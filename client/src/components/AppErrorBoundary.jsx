import { Component } from 'react'

const AUTO_RELOAD_KEY = 'miwa:last-render-error-reload-at'
const AUTO_RELOAD_WINDOW_MS = 60 * 1000

function errorText(error) {
  return String(error?.stack || error?.message || error || '')
}

function recentlyAutoReloaded() {
  try {
    const lastReloadAt = Number(window.sessionStorage.getItem(AUTO_RELOAD_KEY) || 0)
    return lastReloadAt && Date.now() - lastReloadAt < AUTO_RELOAD_WINDOW_MS
  } catch {
    return false
  }
}

function markAutoReload() {
  try {
    window.sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()))
  } catch {
    // Some locked-down browsers block sessionStorage.
  }
}

function shouldAutoRecover(error) {
  const text = errorText(error)
  return [
    'Minified React error #300',
    'ChunkLoadError',
    'Loading chunk',
    'Loading CSS chunk',
    'Failed to fetch dynamically imported module',
    'Importing a module script failed',
  ].some(fragment => text.includes(fragment))
}

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, autoRecovering: false }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Keep this lightweight; the UI should still render a recovery state.
    console.error('Miwa UI crashed:', error, info)

    if (shouldAutoRecover(error) && !recentlyAutoReloaded()) {
      markAutoReload()
      this.setState({ autoRecovering: true })
      window.setTimeout(() => window.location.reload(), 150)
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.state.autoRecovering) {
        return (
          <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-950 via-indigo-950 to-emerald-950">
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/95 p-6 text-center shadow-2xl">
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-600">Miwa</div>
              <h1 className="mt-2 text-2xl font-bold text-gray-900">Refreshing Miwa</h1>
              <p className="mt-3 text-sm text-gray-600">
                One moment while the latest app version loads.
              </p>
            </div>
          </div>
        )
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-950 via-indigo-950 to-emerald-950">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/95 p-6 shadow-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-600">Miwa</div>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">The interface hit a rendering error</h1>
            <p className="mt-3 text-sm text-gray-600">
              This is a UI problem, not a data loss problem. Your session data should still be intact.
            </p>
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              If the page stayed blank, reload once. If it keeps happening, send the screenshot plus the browser console error.
            </div>
            {this.state.error ? (
              <pre className="mt-4 max-h-48 overflow-auto rounded-2xl bg-gray-950 p-4 text-xs text-emerald-200 whitespace-pre-wrap">
                {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
              </pre>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
              >
                Reload Miwa
              </button>
              <button
                onClick={() => window.location.href = '/login'}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Go to login
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
