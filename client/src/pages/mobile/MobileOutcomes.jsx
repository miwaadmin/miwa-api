/**
 * MobileOutcomes — caseload-wide outcome trends, mobile-first.
 *
 * The desktop Outcomes.jsx is a dashboard with multi-column grids,
 * per-template score tables, alert tables, and MBC adherence bars.
 * Collapsing that into a phone loses what matters: which clients need
 * a look right now.
 *
 * This view stacks per-client trend cards sorted by clinical urgency:
 *   1. Worsening clients first (red)
 *   2. Overdue assessments next (amber)
 *   3. Stable / improving below (gray / green)
 * Tap a card → jumps to /m/clients/:id for the full picture.
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'

function trendTone(trend) {
  const t = (trend || '').toUpperCase()
  if (t === 'WORSENING' || t === 'DETERIORATION') return 'red'
  if (t === 'IMPROVING' || t === 'IMPROVEMENT')   return 'emerald'
  if (t === 'STABLE')                              return 'amber'
  return 'gray'
}

function TrendPill({ type, baseline, current, trend }) {
  const tone = trendTone(trend)
  const cls = {
    red:     'bg-red-50 text-red-700 border-red-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber:   'bg-amber-50 text-amber-700 border-amber-100',
    gray:    'bg-gray-50 text-gray-600 border-gray-100',
  }[tone]
  const arrow = tone === 'red' ? '↑' : tone === 'emerald' ? '↓' : '→'
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border ${cls}`}>
      <span className="uppercase tracking-wider">{type}</span>
      {baseline != null && <span className="text-gray-400">{baseline}</span>}
      <span>{arrow}</span>
      {current != null && <span className="font-bold">{current}</span>}
    </span>
  )
}

function clientLabel(row) {
  return row?.client_label || row?.display_name || row?.client_name || row?.patient_name || row?.client_id || 'Client'
}

function ClientOutcomeCard({ row, onOpen }) {
  const initials = clientLabel(row)
    .split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  const hasFlags = row.trend === 'WORSENING' || row.risk_flags > 0
  const isOverdue = row.overdue_count > 0
  const trends = Array.isArray(row.trends) ? row.trends : []

  const accentColor = hasFlags ? '#ef4444' : isOverdue ? '#f59e0b' : '#6047EE'

  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-2xl bg-white border border-gray-200 p-4 active:scale-[0.99] transition-all"
      style={{ minHeight: 80 }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm"
          style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)` }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5 flex-wrap mb-1">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {clientLabel(row)}
            </p>
            {hasFlags && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                ⚠ Attention
              </span>
            )}
            {isOverdue && !hasFlags && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                Overdue
              </span>
            )}
          </div>

          {/* Trend pills */}
          <div className="flex flex-wrap gap-1 mt-1">
            {trends.slice(0, 3).map((t, i) => (
              <TrendPill key={i} type={(t.template || t.type || '').toUpperCase()} baseline={t.baseline} current={t.current} trend={t.trend || t.direction} />
            ))}
            {trends.length === 0 && row.latest_score != null && (
              <TrendPill
                type={(row.template_type || 'SCORE').toUpperCase()}
                baseline={row.baseline_score}
                current={row.latest_score}
                trend={row.trend}
              />
            )}
            {trends.length === 0 && row.latest_score == null && (
              <span className="text-[11px] text-gray-400 italic">No recent assessments</span>
            )}
          </div>

          {row.last_admin_days != null && (
            <p className="text-[10px] text-gray-400 mt-1.5">
              Last assessment {row.last_admin_days === 0 ? 'today' : `${row.last_admin_days}d ago`}
            </p>
          )}
        </div>
        <svg className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  )
}

function urgency(row) {
  // Sort: worsening first, then overdue, then stable, then improving, then no data
  const t = (row.trend || '').toUpperCase()
  if (t === 'WORSENING' || t === 'DETERIORATION') return 0
  if ((row.risk_flags || 0) > 0) return 1
  if ((row.overdue_count || 0) > 0) return 2
  if (t === 'STABLE') return 3
  if (t === 'IMPROVING' || t === 'IMPROVEMENT') return 4
  return 5
}

export default function MobileOutcomes() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all') // all | attention | overdue

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await apiFetch('/assessments/caseload')
      if (!r.ok) throw new Error('Failed to load caseload')
      const data = await r.json()
      const list = Array.isArray(data) ? data : (data?.caseload || data?.rows || [])
      setRows(list)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = rows
    .filter(r => {
      if (filter === 'attention') return (r.trend || '').toUpperCase() === 'WORSENING' || (r.risk_flags || 0) > 0
      if (filter === 'overdue')   return (r.overdue_count || 0) > 0
      return true
    })
    .sort((a, b) => urgency(a) - urgency(b))

  const attentionCount = rows.filter(r => (r.trend || '').toUpperCase() === 'WORSENING' || (r.risk_flags || 0) > 0).length
  const overdueCount = rows.filter(r => (r.overdue_count || 0) > 0).length

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-gray-100">
        <h1 className="text-lg font-bold text-gray-900">Outcomes</h1>
        <p className="text-[11px] text-gray-500 mt-0.5">
          {rows.length} active client{rows.length === 1 ? '' : 's'} · ordered by clinical urgency
        </p>
      </div>

      {/* Filter pills */}
      <div className="px-4 pt-3 pb-2 bg-white border-b border-gray-100 flex gap-2 overflow-x-auto no-scrollbar">
        {[
          { id: 'all',       label: `All (${rows.length})`, color: '#111' },
          { id: 'attention', label: `Attention (${attentionCount})`, color: '#ef4444' },
          { id: 'overdue',   label: `Overdue (${overdueCount})`, color: '#f59e0b' },
        ].map(p => {
          const active = filter === p.id
          return (
            <button
              key={p.id}
              onClick={() => setFilter(p.id)}
              className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                active ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 active:bg-gray-100'
              }`}
              style={active ? { background: p.color } : {}}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-2xl bg-white border border-gray-100 p-4 animate-pulse" style={{ minHeight: 80 }}>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-gray-200" />
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
            Couldn't load outcomes. <button onClick={load} className="font-semibold underline ml-1">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center pt-10">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-base font-semibold text-gray-900 mb-1">
              {filter === 'all' ? 'No caseload yet.' : filter === 'attention' ? 'No one needs attention right now.' : 'No overdue assessments.'}
            </p>
            <p className="text-sm text-gray-500 max-w-xs mx-auto">
              {filter === 'all'
                ? 'Add a patient to start tracking outcomes.'
                : 'Check back after the next batch of scores comes in.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(r => (
              <ClientOutcomeCard
                key={r.patient_id || r.id}
                row={r}
                onOpen={() => navigate(`/m/clients/${r.patient_id || r.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
