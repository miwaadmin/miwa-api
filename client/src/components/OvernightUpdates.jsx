import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { patientInitials } from '../lib/avatar'

/**
 * OvernightUpdates — Dashboard card showing recent patient-submitted
 * assessments grouped by patient with trend context.
 *
 * Replaces the old flat-list markdown rendering where each row read like
 *   "↓ David Nguyen completed PHQ-9: score 7 (Mild)"
 * which was dense, repeated names across rows, buried severe scores, and
 * never showed the previous value (the only thing a therapist actually
 * cares about — is this getting better or worse?).
 *
 * Now each patient = one card. Severity drives color. Each score shows
 * previous → current with an explicit "worsening" / "improved" label.
 * Whole card links to the patient detail page.
 */

// ── Severity theming ─────────────────────────────────────────────────────────
function severityTheme(severity) {
  const s = (severity || '').toLowerCase()
  if (s === 'severe' || s === 'moderately severe') {
    return {
      dot:    '#ef4444',      // red-500
      bg:     '#fef2f2',      // red-50
      border: '#fecaca',      // red-200
      label:  'text-red-700',
      chip:   'bg-red-100 text-red-700',
    }
  }
  if (s === 'moderate') {
    return {
      dot:    '#f59e0b',
      bg:     '#fffbeb',
      border: '#fde68a',
      label:  'text-amber-700',
      chip:   'bg-amber-100 text-amber-700',
    }
  }
  if (s === 'mild') {
    return {
      dot:    '#10b981',
      bg:     '#f0fdf4',
      border: '#bbf7d0',
      label:  'text-emerald-700',
      chip:   'bg-emerald-100 text-emerald-700',
    }
  }
  // minimal / within normal limits / unknown
  return {
    dot:    '#6b7280',
    bg:     '#f9fafb',
    border: '#e5e7eb',
    label:  'text-gray-600',
    chip:   'bg-gray-100 text-gray-600',
  }
}

function statusLabel(status) {
  switch (status) {
    case 'worsening':  return { text: 'NEEDS ATTENTION', cls: 'bg-red-100 text-red-700' }
    case 'mixed':      return { text: 'MIXED TREND',     cls: 'bg-amber-100 text-amber-700' }
    case 'improving':  return { text: 'IMPROVING',       cls: 'bg-emerald-100 text-emerald-700' }
    case 'stable':     return { text: 'STABLE',          cls: 'bg-gray-100 text-gray-600' }
    default:           return { text: status?.toUpperCase() || '', cls: 'bg-gray-100 text-gray-600' }
  }
}

function trendIndicator(score) {
  if (score.trend === 'new') {
    return { icon: '·', label: 'first submission', cls: 'text-gray-500' }
  }
  // For PHQ/GAD/PCL, HIGHER numbers = worse. So trend=up is bad.
  if (score.trend === 'up') {
    const cls = score.is_deterioration || Math.abs(score.delta) >= 2
      ? 'text-red-600 font-semibold'
      : 'text-amber-700'
    return { icon: '↑', label: 'worsening', cls }
  }
  if (score.trend === 'down') {
    return { icon: '↓', label: 'improved', cls: 'text-emerald-600 font-semibold' }
  }
  return { icon: '·', label: 'no change', cls: 'text-gray-500' }
}

// ── Patient card ─────────────────────────────────────────────────────────────
function PatientCard({ patient, onClick }) {
  const theme = severityTheme(patient.worst_severity)
  const statusBadge = statusLabel(patient.status)
  const displayName = patient.display_name || patient.client_id || 'Client'
  const initials = patientInitials(patient)

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-2xl p-4 transition-all hover:scale-[1.01] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-400"
      style={{
        background: theme.bg,
        border: `1px solid ${theme.border}`,
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar with severity dot */}
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${theme.dot}, ${theme.dot}cc)` }}
            >
              {initials}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white"
              style={{ background: theme.dot }}
            />
          </div>

          <div className="min-w-0">
            <p className={`text-sm font-semibold truncate ${theme.label}`}>{displayName}</p>
            {patient.worst_severity && (
              <p className="text-[11px] text-gray-500 mt-0.5 uppercase tracking-wide">
                Worst: {patient.worst_severity}
              </p>
            )}
          </div>
        </div>

        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap ${statusBadge.cls}`}>
          {statusBadge.text}
        </span>
      </div>

      {/* Scores grid */}
      <div className="space-y-1.5">
        {patient.scores.map(score => {
          const trend = trendIndicator(score)
          return (
            <div key={score.assessment_id} className="flex items-center justify-between text-sm gap-2">
              <span className="font-mono font-semibold text-gray-700 w-14 flex-shrink-0">{score.type}</span>
              <span className="font-mono text-gray-800 flex-shrink-0">
                {score.previous !== null ? (
                  <>
                    <span className="text-gray-400">{score.previous}</span>
                    <span className="text-gray-400 mx-1">→</span>
                    <span className="font-bold">{score.current}</span>
                  </>
                ) : (
                  <span className="font-bold">{score.current}</span>
                )}
              </span>
              <span className={`flex items-center gap-1 text-xs flex-1 justify-end ${trend.cls}`}>
                <span className="font-bold">{trend.icon}</span>
                <span>{trend.label}</span>
              </span>
            </div>
          )
        })}
      </div>
    </button>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function OvernightUpdates({ onEmpty }) {
  const [updates, setUpdates] = useState(null) // null = loading, [] = loaded empty
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      setError('')
      const res = await apiFetch('/research/overnight-updates')
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to load')
      const data = await res.json()
      setUpdates(Array.isArray(data.updates) ? data.updates : [])
    } catch (err) {
      setError(err.message)
      setUpdates([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (updates === null) {
    // Loading state — subtle skeleton
    return (
      <div className="space-y-3">
        {[0, 1].map(i => (
          <div key={i} className="rounded-2xl p-4 bg-gray-50 border border-gray-200 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-gray-200 rounded w-1/3" />
                <div className="h-2 bg-gray-200 rounded w-1/4" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl p-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 flex items-center justify-between">
        <span>Couldn't load overnight updates right now.</span>
        <button onClick={load} className="text-xs font-semibold text-amber-900 hover:underline">Retry</button>
      </div>
    )
  }

  if (updates.length === 0) {
    // Let the parent decide how to render the empty case (hide the section, etc).
    if (onEmpty) return onEmpty()
    return (
      <div className="rounded-xl p-4 text-sm text-gray-500 bg-gray-50 border border-gray-200 text-center">
        No overnight assessments. All quiet.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {updates.map(patient => (
        <PatientCard
          key={patient.patient_id}
          patient={patient}
          onClick={() => navigate(`/patients/${patient.patient_id}`)}
        />
      ))}
    </div>
  )
}
