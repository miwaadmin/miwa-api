/**
 * MobileClients — streamlined patient list for phone screens.
 * Sticky search, fast scroll, tap to navigate to patient detail.
 */
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'

function formatDate(dateStr) {
  if (!dateStr) return null
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return null }
}

function getInitials(name) {
  if (!name) return '??'
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
}

// Stable pastel colors based on client name
const COLORS = [
  'bg-indigo-100 text-indigo-600',
  'bg-emerald-100 text-emerald-600',
  'bg-amber-100 text-amber-600',
  'bg-rose-100 text-rose-600',
  'bg-cyan-100 text-cyan-600',
  'bg-violet-100 text-violet-600',
  'bg-orange-100 text-orange-600',
  'bg-teal-100 text-teal-600',
]
function nameColor(name) {
  let hash = 0
  for (let i = 0; i < (name || '').length; i++) hash = (hash + name.charCodeAt(i)) * 31
  return COLORS[Math.abs(hash) % COLORS.length]
}

export default function MobileClients() {
  const navigate = useNavigate()
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    apiFetch('/patients')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setPatients(data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return patients
    const q = search.toLowerCase()
    return patients.filter(p =>
      (p.client_id || '').toLowerCase().includes(q) ||
      (p.display_name || '').toLowerCase().includes(q) ||
      (p.presenting_concerns || '').toLowerCase().includes(q)
    )
  }, [patients, search])

  return (
    <div className="flex flex-col h-full">
      {/* ── Sticky search ──────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients..."
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-300 text-white flex items-center justify-center"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {!loading && (
          <p className="text-xs text-gray-400 mt-1.5 px-1">
            {filtered.length} client{filtered.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* ── Client list ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-7 h-7 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <svg className="w-10 h-10 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm text-gray-500">
              {search ? 'No clients match your search' : 'No clients yet'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(patient => {
              const name = patient.display_name || patient.client_id || 'Unknown'
              const initials = getInitials(name)
              const color = nameColor(name)
              const lastDate = formatDate(patient.last_session_date || patient.updated_at)

              return (
                <button
                  key={patient.id}
                  onClick={() => navigate(`/patients/${patient.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-50 transition-colors text-left"
                >
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${color}`}>
                    {initials}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
                      {lastDate && (
                        <span className="text-[11px] text-gray-400 shrink-0">{lastDate}</span>
                      )}
                    </div>
                    {patient.presenting_concerns && (
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {patient.presenting_concerns}
                      </p>
                    )}
                  </div>

                  {/* Chevron */}
                  <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
