import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

/**
 * PreSessionBriefs — the dashboard hero for Miwa's continuity agent.
 *
 * Each card's centerpiece is an AI-written 60-second narrative: the
 * forward-looking "what you left off with, what changed, what to pick up."
 * The structured panels (check-ins, assessments, risk flags, goals) sit
 * underneath as a reference strip once the card is expanded.
 *
 * Data comes from GET /api/ai/briefs/upcoming. That endpoint now returns
 * the full brief body inline, so no second fetch is needed on expand.
 * The "Refresh" action calls POST /api/ai/briefs/regenerate/:apptId.
 */

function formatTime(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return '' }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (d.toDateString() === today.toDateString()) return 'Today'
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  } catch { return dateStr }
}

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
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border ${tone}`}>
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
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${tone}`}>
      {score != null ? score : '—'}
    </span>
  )
}

function BriefCard({ brief: wrapper, onRegenerate, isRegenerating }) {
  const [expanded, setExpanded] = useState(false)
  const brief = wrapper.brief || {}
  const narrative = brief.narrative
  const narrativeStatus = brief.narrative_status || (narrative ? 'ok' : 'pending')

  const checkins = brief.checkins || []
  const trajectory = brief.assessment_trajectory || {}
  const riskFlags = brief.risk_flags || []
  const openItems = brief.open_items || []
  const goals = brief.treatment_goals || []
  const focus = brief.suggested_focus || []

  const hasRisk = riskFlags.length > 0
  const hasWorsening = Object.values(trajectory).some(t => t.trend === 'worsening')

  const markViewed = useCallback(() => {
    if (wrapper.viewed_at) return
    apiFetch(`/ai/briefs/${wrapper.id}`).catch(() => {})
  }, [wrapper.id, wrapper.viewed_at])

  const handleToggle = () => {
    const next = !expanded
    setExpanded(next)
    if (next) markViewed()
  }

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${
      hasRisk ? 'border-red-200 bg-red-50/30'
      : hasWorsening ? 'border-amber-200 bg-amber-50/30'
      : 'border-indigo-100 bg-white'
    }`}>
      {/* Header — time + patient */}
      <button
        onClick={handleToggle}
        className="w-full text-left px-5 pt-4 pb-2"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                {formatDate(wrapper.scheduled_start)} · {formatTime(wrapper.scheduled_start)}
              </span>
              {wrapper.appointment_type && (
                <span className="text-[10px] text-gray-400 capitalize">
                  · {wrapper.appointment_type.replace(/_/g, ' ')}
                </span>
              )}
            </div>
            <h3 className="text-base font-semibold text-gray-900 truncate">
              {wrapper.patient_name}
            </h3>
          </div>
          <svg className={`w-4 h-4 text-gray-300 flex-shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Narrative (always visible — this is the hero) */}
      <div className="px-5 pb-3">
        {narrative ? (
          <p className="text-[13px] leading-relaxed text-gray-800 whitespace-pre-line">
            {narrative}
          </p>
        ) : narrativeStatus === 'error' ? (
          <p className="text-[12px] italic text-amber-700">
            Narrative synthesis failed — structured data below. Try Refresh.
          </p>
        ) : narrativeStatus === 'skipped' ? (
          <p className="text-[12px] italic text-gray-400">
            Narrative skipped. Tap Refresh to generate.
          </p>
        ) : (
          <p className="text-[12px] italic text-gray-400">Brief still synthesizing…</p>
        )}
      </div>

      {/* Compact badges row — always visible */}
      <div className="px-5 pb-3 flex flex-wrap gap-1.5">
        {Object.entries(trajectory).map(([type, t]) => (
          <TrendPill key={type} type={type} t={t} />
        ))}
        {riskFlags.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-100 border border-red-200 px-2 py-1 rounded-lg">
            ⚠ {riskFlags.length} risk flag{riskFlags.length === 1 ? '' : 's'}
          </span>
        )}
        {checkins.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 bg-sky-50 border border-sky-100 px-2 py-1 rounded-lg">
            {checkins.length} check-in{checkins.length === 1 ? '' : 's'}
          </span>
        )}
        {brief.days_since_last_session != null && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-gray-50 border border-gray-100 px-2 py-1 rounded-lg">
            {brief.days_since_last_session === 0 ? 'today' : `${brief.days_since_last_session}d since last`}
          </span>
        )}
      </div>

      {/* Expanded reference strip */}
      {expanded && (
        <div className="border-t border-gray-100 bg-white/60 px-5 py-4 space-y-4">
          {/* Risk flags — top of list when present */}
          {riskFlags.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-red-700 uppercase tracking-wider mb-2">
                Risk signals
              </p>
              <div className="space-y-1.5">
                {riskFlags.map((f, i) => (
                  <div key={i} className="text-[12px] text-red-900 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    {f}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Check-ins */}
          {checkins.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Between-session check-ins
              </p>
              <div className="space-y-1.5">
                {checkins.map((c, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-[12px] bg-white border border-gray-100 rounded-lg px-3 py-2">
                    <MoodDot score={c.mood_score} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider">
                        {c.completed_at ? new Date(c.completed_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'recent'}
                      </p>
                      {c.mood_notes && (
                        <p className="text-gray-800 mt-0.5 italic">"{c.mood_notes}"</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Open items */}
          {openItems.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Carry-forward from last session
              </p>
              <ul className="space-y-1">
                {openItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-gray-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 mt-1.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Active treatment goals */}
          {goals.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Active goals
              </p>
              <div className="space-y-1.5">
                {goals.map((g, i) => (
                  <div key={i} className="text-[12px] bg-white border border-gray-100 rounded-lg px-3 py-2">
                    <p className="text-gray-800">{g.goal}</p>
                    {g.progress && g.progress !== 'no data' && (
                      <p className="text-[10px] text-gray-400 mt-0.5">{g.progress}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggested focus */}
          {focus.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider mb-2">
                Suggested focus
              </p>
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

          {/* Refresh */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <p className="text-[10px] text-gray-400">
              {brief.sessions_reviewed || 0} session{brief.sessions_reviewed === 1 ? '' : 's'} ·{' '}
              {brief.checkins_reviewed || 0} check-in{brief.checkins_reviewed === 1 ? '' : 's'} ·{' '}
              {brief.assessments_reviewed || 0} assessment{brief.assessments_reviewed === 1 ? '' : 's'}
            </p>
            <button
              onClick={(e) => { e.stopPropagation(); onRegenerate(wrapper.appointment_id) }}
              disabled={isRegenerating}
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 flex items-center gap-1"
            >
              {isRegenerating ? '⟳ Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PreSessionBriefs() {
  const [briefs, setBriefs] = useState([])
  const [loading, setLoading] = useState(true)
  const [regeneratingId, setRegeneratingId] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/ai/briefs/upcoming')
      if (!r.ok) throw new Error('fetch failed')
      const data = await r.json()
      const list = Array.isArray(data) ? data : (data?.briefs || [])
      setBriefs(list)
    } catch {
      // silent — component hides when empty
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleRegenerate = useCallback(async (appointmentId) => {
    setRegeneratingId(appointmentId)
    try {
      const r = await apiFetch(`/ai/briefs/regenerate/${appointmentId}`, { method: 'POST' })
      if (!r.ok) throw new Error('regenerate failed')
      await load()
    } catch (err) {
      console.warn('regenerate failed', err)
    } finally {
      setRegeneratingId(null)
    }
  }, [load])

  if (loading || briefs.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-indigo-100">
          <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-xs font-semibold text-gray-900">Pre-session briefs</p>
          <p className="text-[10px] text-gray-400">
            {briefs.length} upcoming · synthesized from notes, check-ins, and assessments
          </p>
        </div>
      </div>

      {briefs.map(b => (
        <BriefCard
          key={b.id}
          brief={b}
          onRegenerate={handleRegenerate}
          isRegenerating={regeneratingId === b.appointment_id}
        />
      ))}
    </div>
  )
}
