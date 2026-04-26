import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { patientInitials } from '../lib/avatar'

/**
 * TodaysSchedule — the Dashboard's "Your Day" appointment list.
 *
 * Each card shows the time, patient, and appointment type in the collapsed
 * state. Clicking an appointment expands it inline to reveal:
 *   - the AI-written pre-session brief narrative (the hero paragraph),
 *   - any risk flags,
 *   - between-session check-ins with mood scores + notes,
 *   - assessment trend pills (PHQ-9, GAD-7, etc.),
 *   - a shortcut to open the full chart.
 *
 * The narrative is what used to live in the separate "Pre-Session Briefs"
 * card — folding it here keeps everything a clinician needs for the day
 * in one place. No more scrolling between sections.
 */

// ── formatting ──────────────────────────────────────────────────────────────

function fmtTime(iso, tz) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
    })
  } catch { return iso }
}

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  } catch { return iso }
}

function typeTheme(type) {
  const t = (type || '').toLowerCase()
  if (t.includes('crisis') || t.includes('emergency')) {
    return { accent: '#ef4444', bg: '#fef2f2', border: '#fecaca', label: 'text-red-700' }
  }
  if (t.includes('couple') || t.includes('family')) {
    return { accent: '#ec4899', bg: '#fdf2f8', border: '#fbcfe8', label: 'text-pink-700' }
  }
  if (t.includes('group')) {
    return { accent: '#8b5cf6', bg: '#f5f3ff', border: '#ddd6fe', label: 'text-violet-700' }
  }
  if (t.includes('intake') || t.includes('consult')) {
    return { accent: '#0ea5e9', bg: '#f0f9ff', border: '#bae6fd', label: 'text-sky-700' }
  }
  return { accent: '#6047EE', bg: '#f5f3ff', border: '#e0d4fc', label: 'text-brand-700' }
}

// ── inline brief bits ──────────────────────────────────────────────────────

function TrendPill({ type, t }) {
  const prev = t.previous != null ? t.previous : '—'
  const curr = t.latest
  const tone = t.trend === 'worsening'
    ? 'text-red-700 bg-red-50 border-red-100'
    : t.trend === 'improving'
      ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
      : 'text-amber-700 bg-amber-50 border-amber-100'
  const arrow = t.trend === 'worsening' ? '↑' : t.trend === 'improving' ? '↓' : '→'
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${tone}`}>
      <span className="uppercase tracking-wider">{type}</span>
      <span className="text-gray-400">{prev}</span>
      <span>{arrow}</span>
      <span className="font-bold">{curr}</span>
    </span>
  )
}

function MoodDot({ score }) {
  const tone = score == null
    ? 'bg-gray-200 text-gray-500'
    : score <= 2 ? 'bg-red-500 text-white'
    : score === 3 ? 'bg-amber-400 text-white'
    : 'bg-emerald-500 text-white'
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold flex-shrink-0 ${tone}`}>
      {score != null ? score : '—'}
    </span>
  )
}

function BriefPanel({ brief, patientId, onOpenChart }) {
  const trajectory = brief.assessment_trajectory || {}
  const checkins = brief.checkins || []
  const riskFlags = brief.risk_flags || []
  const focus = brief.suggested_focus || []
  const narrative = brief.narrative
  const narrativeStatus = brief.narrative_status

  return (
    <div className="border-t border-gray-100 bg-white/60 px-5 py-4 space-y-4">
      {/* Narrative — the hero */}
      {narrative ? (
        <p className="text-[13px] leading-relaxed text-gray-800 whitespace-pre-line">
          {narrative}
        </p>
      ) : narrativeStatus === 'error' ? (
        <p className="text-[12px] italic text-amber-700">
          Narrative synthesis failed — structured data below.
        </p>
      ) : (
        <p className="text-[12px] italic text-gray-400">Brief still synthesizing…</p>
      )}

      {/* Badge strip */}
      {(Object.keys(trajectory).length > 0 || riskFlags.length > 0 || checkins.length > 0 || brief.days_since_last_session != null) && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(trajectory).map(([type, t]) => (
            <TrendPill key={type} type={type} t={t} />
          ))}
          {riskFlags.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-md">
              ⚠ {riskFlags.length} risk flag{riskFlags.length === 1 ? '' : 's'}
            </span>
          )}
          {checkins.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-100 px-1.5 py-0.5 rounded-md">
              {checkins.length} check-in{checkins.length === 1 ? '' : 's'}
            </span>
          )}
          {brief.days_since_last_session != null && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded-md">
              {brief.days_since_last_session === 0 ? 'today' : `${brief.days_since_last_session}d since last`}
            </span>
          )}
        </div>
      )}

      {/* Risk callouts */}
      {riskFlags.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-red-700 uppercase tracking-wider">Risk signals</p>
          {riskFlags.map((f, i) => (
            <div key={i} className="text-[12px] text-red-900 bg-red-50 border border-red-100 rounded-md px-2.5 py-1.5">
              {f}
            </div>
          ))}
        </div>
      )}

      {/* Check-ins */}
      {checkins.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Between-session check-ins</p>
          {checkins.map((c, i) => (
            <div key={i} className="flex items-start gap-2.5 text-[12px] bg-white border border-gray-100 rounded-md px-2.5 py-1.5">
              <MoodDot score={c.mood_score} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">{fmtDate(c.completed_at)}</p>
                {c.mood_notes && <p className="text-gray-800 italic mt-0.5">"{c.mood_notes}"</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Suggested focus */}
      {focus.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-1.5">Suggested focus</p>
          <ul className="space-y-1">
            {focus.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-emerald-900">
                <span className="text-emerald-500">→</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer: open chart */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <p className="text-[10px] text-gray-400">
          {brief.sessions_reviewed || 0} session{brief.sessions_reviewed === 1 ? '' : 's'} ·{' '}
          {brief.checkins_reviewed || 0} check-in{brief.checkins_reviewed === 1 ? '' : 's'} ·{' '}
          {brief.assessments_reviewed || 0} assessment{brief.assessments_reviewed === 1 ? '' : 's'}
        </p>
        <button
          onClick={(e) => { e.stopPropagation(); onOpenChart(patientId) }}
          className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
        >
          Open chart →
        </button>
      </div>
    </div>
  )
}

// ── card ───────────────────────────────────────────────────────────────────

function AppointmentCard({ appt, brief, expanded, onToggle, onOpenChart }) {
  const theme = typeTheme(appt.appointment_type)
  const name = appt.display_name || appt.client_id || 'Client'
  const initials = patientInitials(appt)
  const time = fmtTime(appt.scheduled_start)
  const typeLabel = (appt.appointment_type || 'Session').replace(/_/g, ' ')
  const hasBrief = !!brief

  return (
    <div
      className={`rounded-2xl transition-all overflow-hidden ${expanded ? 'shadow-md' : 'hover:shadow-md'}`}
      style={{ background: theme.bg, border: `1px solid ${theme.border}` }}
    >
      <button
        onClick={() => hasBrief ? onToggle() : onOpenChart(appt.patient_id)}
        className="w-full text-left p-4 flex items-center gap-4 focus:outline-none"
      >
        <div className="flex-shrink-0 text-center min-w-[70px]">
          <div className={`font-mono font-bold text-sm ${theme.label}`}>{time}</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">
            {appt.duration_minutes}m
          </div>
        </div>

        <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
          style={{ background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent}cc)` }}
        >
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold truncate ${theme.label}`}>{name}</p>
          <p className="text-[11px] text-gray-500 capitalize truncate mt-0.5">{typeLabel}</p>
        </div>

        {hasBrief && (
          <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-white/80 text-brand-700 border border-brand-200 whitespace-nowrap">
            {expanded ? '✦ Brief open' : '✦ Brief ready'}
          </span>
        )}

        {hasBrief && (
          <svg
            className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {hasBrief && expanded && (
        <BriefPanel brief={brief} patientId={appt.patient_id} onOpenChart={onOpenChart} />
      )}
    </div>
  )
}

// ── main ───────────────────────────────────────────────────────────────────

export default function TodaysSchedule({ onEmpty }) {
  const [state, setState] = useState({ loading: true, error: '', appointments: null, briefsByApptId: {} })
  const [expandedId, setExpandedId] = useState(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      setState(s => ({ ...s, loading: true, error: '' }))
      const [schedRes, briefsRes] = await Promise.allSettled([
        apiFetch('/research/todays-schedule').then(r => r.json()),
        apiFetch('/ai/briefs/upcoming').then(r => r.json()),
      ])
      const appointments = schedRes.status === 'fulfilled' && Array.isArray(schedRes.value?.appointments)
        ? schedRes.value.appointments
        : []

      // Briefs endpoint returns a list of wrappers with `brief` + `appointment_id`.
      const briefsList = briefsRes.status === 'fulfilled' && Array.isArray(briefsRes.value)
        ? briefsRes.value
        : []
      const briefsByApptId = {}
      for (const w of briefsList) {
        if (w?.appointment_id && w.brief) {
          briefsByApptId[w.appointment_id] = w.brief
        }
      }

      setState({ loading: false, error: '', appointments, briefsByApptId })
    } catch (err) {
      setState({ loading: false, error: err.message, appointments: [], briefsByApptId: {} })
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (state.loading) {
    return (
      <div className="space-y-2">
        {[0, 1].map(i => (
          <div key={i} className="rounded-2xl p-4 bg-gray-50 border border-gray-200 animate-pulse flex items-center gap-4">
            <div className="w-16 h-8 bg-gray-200 rounded" />
            <div className="w-10 h-10 rounded-full bg-gray-200" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-gray-200 rounded w-1/3" />
              <div className="h-2 bg-gray-200 rounded w-1/4" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="rounded-xl p-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 flex items-center justify-between">
        <span>Couldn't load today's schedule.</span>
        <button onClick={load} className="text-xs font-semibold text-amber-900 hover:underline">Retry</button>
      </div>
    )
  }

  if (!state.appointments || state.appointments.length === 0) {
    if (onEmpty) return onEmpty()
    return (
      <div className="rounded-xl p-4 text-sm text-gray-500 bg-gray-50 border border-gray-200 text-center">
        No sessions scheduled today. Good day to catch up on notes.
      </div>
    )
  }

  const briefCount = Object.keys(state.briefsByApptId).length

  return (
    <div className="space-y-2">
      {state.appointments.map(a => (
        <AppointmentCard
          key={a.appointment_id}
          appt={a}
          brief={state.briefsByApptId[a.appointment_id]}
          expanded={expandedId === a.appointment_id}
          onToggle={() => setExpandedId(prev => prev === a.appointment_id ? null : a.appointment_id)}
          onOpenChart={(patientId) => navigate(`/patients/${patientId}`)}
        />
      ))}
      {briefCount > 0 && (
        <p className="text-[11px] text-brand-600 text-center mt-2 italic">
          ✦ {briefCount} pre-session brief{briefCount === 1 ? '' : 's'} ready — tap a card to open
        </p>
      )}
    </div>
  )
}
