import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return dateStr }
}

const STATUS_STYLES = {
  active:       { bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-100', dot: 'bg-indigo-500',  bar: 'bg-indigo-500',  label: 'Active' },
  met:          { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100', dot: 'bg-emerald-500', bar: 'bg-emerald-500', label: 'Met' },
  stalled:      { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-100',  dot: 'bg-amber-500',   bar: 'bg-amber-400',   label: 'Stalled' },
  revised:      { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-100',   dot: 'bg-blue-500',    bar: 'bg-blue-500',    label: 'Revised' },
  discontinued: { bg: 'bg-gray-50',    text: 'text-gray-500',    border: 'border-gray-200',   dot: 'bg-gray-400',    bar: 'bg-gray-400',    label: 'Discontinued' },
}

function getStatusStyle(status) {
  return STATUS_STYLES[(status || 'active').toLowerCase()] || STATUS_STYLES.active
}

function progressPercent(baseline, current, target) {
  if (baseline == null || target == null) return null
  const curr = current ?? baseline
  const range = target - baseline
  if (range === 0) return curr === target ? 100 : 0
  const pct = ((curr - baseline) / range) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

function GoalCard({ goal, isExpanded, onToggle }) {
  const style = getStatusStyle(goal.status)
  const pct = progressPercent(goal.baseline, goal.current_value, goal.target_value)
  const notes = goal.progress_notes || goal.notes || []

  return (
    <div className={`rounded-xl border ${style.border} overflow-hidden`}>
      {/* Goal header */}
      <button
        onClick={onToggle}
        className={`w-full text-left px-4 py-3 hover:bg-gray-50/50 transition-colors`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                {style.label}
              </span>
              {goal.target_metric && (
                <span className="text-[10px] text-gray-400 font-medium">{goal.target_metric}</span>
              )}
            </div>
            <p className="text-sm font-medium text-gray-900 leading-snug">
              {goal.text || goal.goal || goal.description}
            </p>
          </div>
          <svg className={`w-4 h-4 text-gray-300 flex-shrink-0 mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Progress bar */}
        {pct != null && (
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
              <span>Baseline: {goal.baseline}</span>
              <span>Current: {goal.current_value ?? '...'}</span>
              <span>Target: {goal.target_value}</span>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${style.bar}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5 text-right">{pct}% toward target</p>
          </div>
        )}
      </button>

      {/* Expanded: progress notes timeline */}
      {isExpanded && notes.length > 0 && (
        <div className="px-4 pb-3 border-t border-gray-100">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mt-3 mb-2">Progress Notes</p>
          <div className="relative pl-4 space-y-2">
            {/* Timeline line */}
            <div className="absolute left-[5px] top-1 bottom-1 w-px bg-gray-200" />
            {notes.map((note, i) => (
              <div key={i} className="relative flex items-start gap-2.5">
                <span className={`absolute left-[-11px] top-1.5 w-2 h-2 rounded-full ${i === 0 ? style.dot : 'bg-gray-300'} flex-shrink-0`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 leading-relaxed">
                    {typeof note === 'string' ? note : note.text || note.content}
                  </p>
                  {(note.date || note.session_date) && (
                    <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(note.date || note.session_date)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expanded: no notes */}
      {isExpanded && notes.length === 0 && (
        <div className="px-4 pb-3 border-t border-gray-100">
          <p className="text-xs text-gray-400 mt-3">No progress notes recorded yet.</p>
        </div>
      )}
    </div>
  )
}

export default function TreatmentPlanPanel({ patientId }) {
  const navigate = useNavigate()
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedGoal, setExpandedGoal] = useState(null)

  useEffect(() => {
    if (!patientId) { setLoading(false); return }
    apiFetch(`/ai/treatment-plan/${patientId}`)
      .then(r => {
        if (r.status === 404) return null
        if (!r.ok) throw new Error('fetch failed')
        return r.json()
      })
      .then(data => {
        if (data && (data.goals?.length > 0 || data.plan)) {
          setPlan(data)
        }
        setLoading(false)
      })
      .catch(() => {
        setError('Unable to load treatment plan')
        setLoading(false)
      })
  }, [patientId])

  if (loading) {
    return (
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className="text-xs font-semibold text-gray-900">Treatment Plan</p>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className="text-xs font-semibold text-gray-900">Treatment Plan</p>
        </div>
        <div className="p-5 text-center">
          <p className="text-xs text-gray-400">{error}</p>
        </div>
      </div>
    )
  }

  // No plan exists — show creation CTA
  if (!plan) {
    return (
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className="text-xs font-semibold text-gray-900">Treatment Plan</p>
        </div>
        <div className="p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-600 mb-1">No Treatment Plan</p>
          <p className="text-xs text-gray-400 mb-4">Ask Miwa to create a structured treatment plan with measurable goals.</p>
          <button
            onClick={() => navigate('/consult', {
              state: {
                contextType: 'patient',
                contextId: parseInt(patientId),
                prefill: 'Create a treatment plan with measurable goals for this client',
              },
            })}
            className="btn-primary text-xs"
          >
            Create Treatment Plan
          </button>
        </div>
      </div>
    )
  }

  // Plan exists — render goals with progress tracking
  const goals = plan.goals || []
  const countByStatus = goals.reduce((acc, g) => {
    const key = (g.status || 'active').toLowerCase()
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const statusOrder = ['active', 'met', 'stalled', 'revised', 'discontinued']
  const summaryParts = statusOrder
    .filter(s => countByStatus[s])
    .map(s => `${countByStatus[s]} ${getStatusStyle(s).label.toLowerCase()}`)

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-900">Treatment Plan</p>
            {plan.last_reviewed && (
              <p className="text-[10px] text-gray-400">Last reviewed {formatDate(plan.last_reviewed)}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => navigate('/consult', {
            state: {
              contextType: 'patient',
              contextId: parseInt(patientId),
              prefill: 'Review and update the treatment plan for this client',
            },
          })}
          className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors"
        >
          Review with Miwa
        </button>
      </div>

      {/* Summary stats */}
      {summaryParts.length > 0 && (
        <div className="px-5 py-2.5 bg-gray-50/50 border-b border-gray-100">
          <p className="text-xs text-gray-500 font-medium">
            {summaryParts.join(' \u00b7 ')}
          </p>
        </div>
      )}

      {/* Goal cards */}
      <div className="p-4 space-y-3">
        {goals.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">No goals defined yet.</p>
        ) : (
          goals.map((goal, i) => (
            <GoalCard
              key={goal.id || i}
              goal={goal}
              isExpanded={expandedGoal === (goal.id || i)}
              onToggle={() => setExpandedGoal(expandedGoal === (goal.id || i) ? null : (goal.id || i))}
            />
          ))
        )}
      </div>
    </div>
  )
}
