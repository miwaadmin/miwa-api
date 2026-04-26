/**
 * MobileUnsigned — unsigned notes queue, mobile-native.
 *
 * Stacked list of every session note across the caseload with content
 * but no signed_at. Each tap jumps straight to that session in the
 * mobile session editor so the clinician can finish + sign in one flow.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  catch { return iso }
}

function daysAgo(iso) {
  if (!iso) return null
  const d = (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000)
  if (Number.isNaN(d)) return null
  return Math.floor(d)
}

function initials(name) {
  const n = (name || '').trim()
  if (!n) return '?'
  return n.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()
}

export default function MobileUnsigned() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sessions, setSessions] = useState([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch('/sessions/unsigned')
        if (!res.ok) throw new Error('Failed to load')
        const data = await res.json()
        if (cancelled) return
        setSessions(Array.isArray(data.sessions) ? data.sessions : [])
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Group by overdue-ness for visual urgency
  const grouped = {
    old:   sessions.filter(s => (daysAgo(s.session_date) ?? 0) >= 7),
    recent: sessions.filter(s => (daysAgo(s.session_date) ?? 0) < 7),
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="px-4 py-3 bg-white border-b border-gray-100 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Unsigned notes</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {loading ? 'Loading…' : `${sessions.length} note${sessions.length === 1 ? '' : 's'} waiting on your sign-off`}
          </p>
        </div>
        <button
          onClick={() => navigate('/m/more')}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 active:bg-gray-100"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-2xl bg-white border border-gray-100 p-4 animate-pulse" style={{ minHeight: 72 }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-gray-200 rounded w-1/2" />
                    <div className="h-2 bg-gray-100 rounded w-1/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
            Couldn't load. <button onClick={() => window.location.reload()} className="underline font-semibold ml-1">Retry</button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center pt-10">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-base font-semibold text-gray-900 mb-1">All caught up.</p>
            <p className="text-sm text-gray-500 max-w-xs mx-auto">
              Every note in your caseload is signed. Nice work.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.old.length > 0 && (
              <section>
                <p className="text-[11px] font-bold uppercase tracking-widest text-red-600 mb-2 px-1">
                  7+ days old · {grouped.old.length}
                </p>
                <div className="space-y-2">
                  {grouped.old.map(s => <Row key={s.id} s={s} onOpen={() => navigate(`/m/clients/${s.patient_id}/session/${s.id}`)} urgent />)}
                </div>
              </section>
            )}
            {grouped.recent.length > 0 && (
              <section>
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2 px-1">
                  Recent · {grouped.recent.length}
                </p>
                <div className="space-y-2">
                  {grouped.recent.map(s => <Row key={s.id} s={s} onOpen={() => navigate(`/m/clients/${s.patient_id}/session/${s.id}`)} />)}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ s, onOpen, urgent }) {
  const name = s.display_name || s.client_id || 'Client'
  const d = daysAgo(s.session_date)
  const accent = urgent ? '#ef4444' : '#6047EE'
  return (
    <button
      onClick={onOpen}
      className={`w-full text-left rounded-2xl p-4 flex items-center gap-3 active:scale-[0.99] transition-all bg-white ${urgent ? 'border border-red-100' : 'border border-gray-100'}`}
      style={{ minHeight: 72 }}
    >
      <div
        className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
        style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
      >
        {initials(name)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
        <p className="text-[11px] text-gray-500">
          {fmtDate(s.session_date)}
          {d != null && <> · <span className={urgent ? 'text-red-600 font-semibold' : ''}>{d === 0 ? 'today' : d === 1 ? '1d ago' : `${d}d ago`}</span></>}
        </p>
        {s.preview && (
          <p className="text-[11px] text-gray-500 mt-1 line-clamp-1">{s.preview}</p>
        )}
      </div>
      <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}
