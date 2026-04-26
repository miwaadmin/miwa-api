/**
 * UnsignedSessions — flat list of every session note across the caseload that
 * has content but no signed_at. Reached from the dashboard's Unsigned tile.
 * Click a row → straight to that session in the patient's workspace.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

function dayOfWeek(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-US', { weekday: 'short' }) } catch { return '' }
}

export default function UnsignedSessions() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sessions, setSessions] = useState([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch('/sessions/unsigned')
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to load')
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

  const initials = (name) => {
    const n = (name || '').trim()
    if (!n) return '?'
    return n.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Breadcrumb + header */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-3">
        <Link to="/dashboard" className="hover:text-brand-600 transition-colors">Dashboard</Link>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-900 font-medium">Unsigned Notes</span>
      </nav>

      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Unsigned session notes</h1>
          <p className="text-sm text-gray-500 mt-1">
            Every session note across your caseload that has content but isn't signed yet.
          </p>
        </div>
        {!loading && sessions.length > 0 && (
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5 text-sm font-semibold text-amber-800">
            {sessions.length} unsigned
          </span>
        )}
      </div>

      {loading && (
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-2xl p-4 bg-gray-50 border border-gray-200 animate-pulse h-20" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl p-5 bg-red-50 border border-red-200 text-sm text-red-700">
          Couldn't load unsigned notes — {error}
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div className="rounded-2xl p-10 text-center bg-emerald-50 border border-emerald-200">
          <div className="w-12 h-12 rounded-full bg-emerald-100 mx-auto mb-3 flex items-center justify-center">
            <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-emerald-900">All caught up</h2>
          <p className="text-sm text-emerald-700 mt-1">Every session note in your caseload is signed.</p>
        </div>
      )}

      {!loading && !error && sessions.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100 shadow-sm">
          {sessions.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => navigate(`/patients/${s.patient_id}/sessions/${s.id}`)}
              className="w-full flex items-start gap-4 px-5 py-4 hover:bg-gray-50 active:bg-gray-100 transition-colors text-left"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-brand-100 text-brand-700 font-bold text-sm flex items-center justify-center">
                {initials(s.display_name || s.client_id)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900 truncate">
                    {s.display_name || s.client_id}
                  </span>
                  <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 uppercase tracking-wider">
                    {s.note_format || 'SOAP'}
                  </span>
                  <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 uppercase tracking-wider">
                    Unsigned
                  </span>
                </div>
                {s.preview && (
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">{s.preview}</p>
                )}
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-xs text-gray-500">{dayOfWeek(s.session_date || s.created_at)}</p>
                <p className="text-sm text-gray-700 font-medium whitespace-nowrap">{formatDate(s.session_date || s.created_at)}</p>
              </div>
              <svg className="flex-shrink-0 w-4 h-4 text-gray-400 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
