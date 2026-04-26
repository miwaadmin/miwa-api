import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import OvernightUpdates from '../components/OvernightUpdates'
import TodaysSchedule from '../components/TodaysSchedule'
import { renderClinical } from '../lib/renderClinical'
import { patientInitials } from '../lib/avatar'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return dateStr }
}

const quickActions = [
  {
    label: 'Session Workspace',
    to: '/workspace',
    desc: 'Start an intake or note from a session summary',
    color: 'text-brand-600 bg-brand-50 group-hover:bg-brand-100',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    label: 'New Patient',
    to: '/patients',
    desc: 'Add a new client before generating the first note',
    color: 'text-teal-600 bg-teal-50 group-hover:bg-teal-100',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
      </svg>
    ),
  },
  {
    label: 'Consult Miwa',
    to: '/consult',
    desc: 'Clinical questions, case planning, and next steps',
    color: 'text-violet-600 bg-violet-50 group-hover:bg-violet-100',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    label: 'Patient Records',
    to: '/patients',
    desc: 'Sessions, notes, documents, and chart history',
    color: 'text-emerald-600 bg-emerald-50 group-hover:bg-emerald-100',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

function getGreeting(name) {
  const hour = new Date().getHours()
  const first = name ? name.split(' ')[0] : ''
  const who = first ? `, ${first}` : ''
  if (hour < 12) return `Good morning${who}`
  if (hour < 17) return `Good afternoon${who}`
  return `Good evening${who}`
}

// The daily briefing markdown starts with "# Good morning, {name}\n{date}" —
// that duplicates the hero banner above it. Slice off everything before the
// first "## " header so the body starts with "Today at a Glance".
function stripBriefingGreeting(md) {
  if (!md) return md
  const firstH2 = md.indexOf('\n## ')
  if (firstH2 === -1) return md
  return md.slice(firstH2 + 1).trim()
}

// Remove the "## Overnight Updates" section from the AI-generated markdown —
// that section is now rendered by the <OvernightUpdates /> React component
// with structured data (per-patient cards, trend indicators). Leaving it in
// the markdown would duplicate the content in a less-readable list form.
function stripOvernightSection(md) {
  if (!md) return md
  const start = md.search(/^##\s+Overnight Updates/mi)
  if (start === -1) return md
  // Find the next "## " heading or end of document.
  const rest = md.slice(start + 2)
  const nextIdx = rest.search(/\n##\s+/)
  const endOfSection = nextIdx === -1 ? md.length : start + 2 + nextIdx + 1
  return (md.slice(0, start) + md.slice(endOfSection)).trim()
}

// Split the briefing at the SECOND "## " heading. The first section is
// "Today's Schedule"; everything after that (Needs Attention, Good News,
// the generated-at footer) goes in the "after" chunk. Used to nest the
// <OvernightUpdates /> cards between the two halves so the Your Day card
// reads as one coherent morning brief instead of two disjoint cards.
function splitBriefingAtSecondHeading(md) {
  if (!md) return { before: '', after: '' }
  const headings = [...md.matchAll(/^##\s+/gm)]
  if (headings.length < 2) return { before: md, after: '' }
  const secondIdx = headings[1].index
  return {
    before: md.slice(0, secondIdx).trim(),
    after: md.slice(secondIdx).trim(),
  }
}

export default function Dashboard() {
  const [stats, setStats] = useState({ totalPatients: 0, totalSessions: 0, sessionsThisWeek: 0, sessionsThisMonth: 0, appointmentsToday: 0, unsignedNotes: 0, recentSessions: [] })
  const [alerts, setAlerts] = useState([])
  const [dailyBriefing, setDailyBriefing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  // Live running clock for the purple hero — ticks every second
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const navigate = useNavigate()
  const { therapist } = useAuth()
  const greeting = getGreeting(therapist?.full_name)
  const recentSessions = Array.isArray(stats.recentSessions) ? stats.recentSessions : []
  const isNewAccount = stats.totalPatients === 0 && stats.totalSessions === 0
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const timeLabel = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })

  const loadDashboard = useCallback(() => {
    setLoading(true)
    setLoadError('')
    // Track dashboard visits for progressive disclosure
    const visits = parseInt(localStorage.getItem('miwa_dashboard_visits') || '0', 10)
    localStorage.setItem('miwa_dashboard_visits', String(visits + 1))

    Promise.allSettled([
      apiFetch('/stats').then(r => r.json()),
      apiFetch('/settings').then(r => r.json()),
      apiFetch('/patients/alerts').then(r => r.json()),
      apiFetch('/research/daily-briefing').then(r => r.json()),
    ]).then(([statsResult, , alertsResult, dailyResult]) => {
      if (dailyResult?.status === 'rejected') {
        console.warn('[dashboard] daily-briefing fetch rejected:', dailyResult.reason)
      } else if (dailyResult?.value?.error) {
        console.warn('[dashboard] daily-briefing returned error:', dailyResult.value.error)
      }
      if (dailyResult?.status === 'fulfilled' && dailyResult.value && dailyResult.value.markdown) {
        setDailyBriefing(dailyResult.value)
      }
      if (statsResult.status === 'fulfilled' && statsResult.value) {
        setStats({
          totalPatients: 0,
          totalSessions: 0,
          sessionsThisWeek: 0,
          sessionsThisMonth: 0,
          appointmentsToday: 0,
          unsignedNotes: 0,
          recentSessions: [],
          ...statsResult.value,
        })
      } else {
        setLoadError('Unable to load dashboard data right now. Showing local shortcuts so you can keep working.')
      }
      if (alertsResult.status === 'fulfilled' && Array.isArray(alertsResult.value)) {
        setAlerts(alertsResult.value.slice(0, 5))
      }
      setLoading(false)
    }).catch(() => {
      setLoadError('Unable to load dashboard data right now. Showing local shortcuts so you can keep working.')
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  // Refresh whenever the tab gains focus or becomes visible. Catches the
  // common case of: open Dashboard → switch to Settings tab → generate a
  // demo client → switch back to Dashboard tab. Without this, the Dashboard
  // would keep showing the stale state from before the demo existed.
  useEffect(() => {
    const onFocus = () => loadDashboard()
    const onVisible = () => { if (document.visibilityState === 'visible') loadDashboard() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadDashboard])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Loading dashboard…</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {loadError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm flex items-center gap-3 flex-wrap">
          <span className="flex-1 min-w-0">{loadError}</span>
          <button
            type="button"
            onClick={loadDashboard}
            className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors flex-shrink-0"
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Pre-Session Briefs + Research Brief removed from the dashboard —
          the brief narrative now lives inline inside each appointment card
          in the Your Day section below (click an appointment to expand). */}

      {/* ── Hero Banner with embedded daily briefing (all purple) ── */}
      <div
        className="rounded-2xl p-6 text-white relative overflow-hidden shadow-sm border border-brand-100/40"
        style={{ background: 'linear-gradient(135deg, #4a38d9 0%, #221a6e 55%, #059e85 100%)' }}
      >
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 85% 50%, rgba(45,212,191,0.18) 0%, transparent 60%)' }} />

        <div className="relative">
          {/* Top row: greeting + stats + actions */}

          <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
            {/* Left: copy */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                <span className="text-[11px] font-semibold text-teal-300 uppercase tracking-widest">
                  {isNewAccount ? 'Getting started' : 'Active'}
                </span>
                <span className="text-white/25 text-base">·</span>
                <span className="text-sm font-semibold text-white/85 tracking-wide">
                  {dateLabel}
                </span>
                <span className="text-white/25 text-base">·</span>
                <span className="text-base font-bold text-teal-300 tabular-nums tracking-wider">
                  {timeLabel}
                </span>
              </div>
              <h2 className="text-xl font-bold tracking-tight">{greeting}</h2>
              <p className="text-white/55 text-sm mt-0.5">
                {isNewAccount ? 'Your calm, review-first AI therapist copilot' : (() => {
                  // Contextual nudge — surface the single most actionable thing,
                  // not a static restatement of the tile numbers above.
                  const u = stats.unsignedNotes || 0
                  const t = stats.appointmentsToday || 0
                  const w = stats.sessionsThisWeek || 0
                  if (u > 0) return `${u} note${u === 1 ? '' : 's'} from past sessions need${u === 1 ? 's' : ''} signing.`
                  if (t > 0) return `${t} session${t === 1 ? '' : 's'} on deck today.`
                  if (w > 0) return `${w} session${w === 1 ? '' : 's'} done this week. All notes signed.`
                  return 'All caught up. Quiet day.'
                })()}
              </p>

              <div className="mt-4 flex gap-2 flex-wrap">
                <button
                  onClick={() => navigate('/workspace')}
                  className="px-4 py-2 text-sm font-semibold rounded-xl bg-white text-brand-700 hover:bg-white/90 transition-colors shadow-sm"
                >
                  Session Workspace
                </button>
                <button
                  onClick={() => navigate('/consult')}
                  className="px-4 py-2 text-sm font-medium rounded-xl transition-colors hover:bg-white/15"
                  style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }}
                >
                  Consult Miwa
                </button>
              </div>
            </div>

            {/* Right: stats — daily-focused. Patients = caseload, Today =
                what's on the calendar, This Week = Mon-Sun progress, Unsigned
                = backlog. Unsigned is clickable; the others are passive
                read-outs. */}
            <div className="flex gap-3 flex-shrink-0">
              {[
                { value: stats.totalPatients || 0, label: 'Patients' },
                { value: stats.appointmentsToday || 0, label: 'Today' },
                { value: stats.sessionsThisWeek || 0, label: 'This Week' },
              ].map(s => (
                <div key={s.label} className="rounded-xl px-4 py-3 text-center min-w-[64px]"
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div className="text-2xl font-bold leading-none">{s.value}</div>
                  <div className="text-[11px] text-white/55 mt-1">{s.label}</div>
                </div>
              ))}
              {stats.unsignedNotes > 0 ? (
                <button
                  type="button"
                  onClick={() => navigate('/unsigned')}
                  className="rounded-xl px-4 py-3 text-center min-w-[64px] transition-all hover:opacity-90 hover:scale-[1.02] active:scale-95"
                  style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)' }}
                  title="See all unsigned session notes"
                >
                  <div className="text-2xl font-bold leading-none text-amber-300">{stats.unsignedNotes}</div>
                  <div className="text-[11px] text-amber-300/70 mt-1">Unsigned</div>
                </button>
              ) : (
                <div className="rounded-xl px-4 py-3 text-center min-w-[64px]"
                  style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)' }}
                  title="All session notes are signed">
                  <div className="text-2xl font-bold leading-none text-emerald-300">0</div>
                  <div className="text-[11px] text-emerald-300/70 mt-1">Unsigned</div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Your Day — unified morning brief card, now 100% card-based.
          Today's Schedule and Overnight Updates are both structured React
          components that read from dedicated endpoints. The AI-generated
          markdown briefing is intentionally no longer rendered here — every
          section it used to contain (schedule, overnight updates, needs
          attention, good news) has been replaced by a proper component or
          surfaced elsewhere (alert badges, dedicated alerts card below). */}
      <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-base">☀️</span>
          <span className="text-[11px] font-bold text-brand-600 uppercase tracking-widest">
            Your Day
          </span>
          <div className="ml-auto flex items-center gap-2">
            {dailyBriefing?.stats?.session_count > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-brand-50 text-brand-700 border border-brand-100">
                {dailyBriefing.stats.session_count} session{dailyBriefing.stats.session_count === 1 ? '' : 's'}
              </span>
            )}
            {dailyBriefing?.stats?.critical_alerts > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-red-50 text-red-700 border border-red-100">
                🚨 {dailyBriefing.stats.critical_alerts}
              </span>
            )}
            {dailyBriefing?.stats?.warning_alerts > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-700 border border-amber-100">
                ⚠️ {dailyBriefing.stats.warning_alerts}
              </span>
            )}
          </div>
        </div>

        {/* Morning narrative — AI-written caseload synthesis */}
        {dailyBriefing?.narrative && (
          <div className="mb-5 rounded-xl bg-gradient-to-br from-indigo-50 to-emerald-50/50 border border-indigo-100 px-4 py-3">
            <p className="text-[13px] leading-relaxed text-gray-800 whitespace-pre-line">
              {dailyBriefing.narrative}
            </p>
          </div>
        )}

        {/* Caseload status — per-client pulse */}
        {Array.isArray(dailyBriefing?.caseload) && dailyBriefing.caseload.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] font-bold text-brand-600 uppercase tracking-widest">
                Caseload pulse
              </span>
              <span className="text-[10px] text-gray-400">
                {dailyBriefing.caseload.length} active client{dailyBriefing.caseload.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {dailyBriefing.caseload.slice(0, 6).map(c => {
                const tone = c.status === 'needs_attention'
                  ? { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-900', label: 'text-red-700', icon: '⚠' }
                  : c.status === 'improving'
                  ? { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900', label: 'text-emerald-700', icon: '↓' }
                  : c.status === 'new_referral'
                  ? { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-900', label: 'text-sky-700', icon: '✦' }
                  : c.status === 'overdue'
                  ? { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', label: 'text-amber-700', icon: '⏰' }
                  : { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-800', label: 'text-gray-500', icon: '·' }
                return (
                  <button
                    key={c.patient_id}
                    onClick={() => window.location.href = `/patients/${c.patient_id}`}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-all hover:scale-[1.01] ${tone.bg} ${tone.border}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`text-xs ${tone.label}`}>{tone.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-semibold truncate ${tone.text}`}>{c.name}</p>
                        <p className={`text-[10px] uppercase tracking-wider font-bold mt-0.5 ${tone.label}`}>
                          {c.status.replace('_', ' ')}
                        </p>
                        {c.signals?.length > 0 && (
                          <p className="text-[11px] text-gray-600 mt-0.5 truncate">
                            {c.signals.join(' · ')}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
            {dailyBriefing.caseload.length > 6 && (
              <p className="text-[11px] text-gray-400 text-center mt-2 italic">
                +{dailyBriefing.caseload.length - 6} more — view full caseload
              </p>
            )}
          </div>
        )}

        {/* Today's Schedule — per-appointment cards */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-bold text-brand-600 uppercase tracking-widest">
              Today's Schedule
            </span>
          </div>
          <TodaysSchedule />
        </div>

        {/* Overnight Updates — per-patient cards */}
        <div className="mt-5 pt-5 border-t border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-bold text-brand-600 uppercase tracking-widest">
              Overnight Updates
            </span>
            <span className="text-[10px] text-gray-400">last 14 hours</span>
          </div>
          <OvernightUpdates onEmpty={() => (
            <p className="text-xs text-gray-400 italic">No new assessments submitted overnight.</p>
          )} />
        </div>
      </div>

      {/* ── Alerts ── */}
      {alerts.length > 0 && (
        <div className="space-y-4">
          {alerts.length > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-sm font-semibold text-red-900">Proactive Alerts ({alerts.length})</h3>
                </div>
              </div>
              <div className="space-y-2">
                {alerts.map(alert => {
                  const typeIcons = {
                    DETERIORATION: '↑', IMPROVEMENT: '↓',
                    OVERDUE_ASSESSMENT: '⏰', RISK_REVIEW_DUE: '⚠'
                  }
                  return (
                    <div key={alert.id} className="rounded-xl bg-white p-3 flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 flex-1 min-w-0">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                          alert.severity === 'CRITICAL' ? 'bg-red-100 text-red-600' :
                          alert.severity === 'HIGH' ? 'bg-orange-100 text-orange-600' :
                          alert.severity === 'MEDIUM' ? 'bg-yellow-100 text-yellow-600' :
                          'bg-blue-100 text-blue-600'
                        }`}>
                          {typeIcons[alert.alert_type] || '!'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded whitespace-nowrap ${
                              alert.alert_type === 'IMPROVEMENT' ? 'bg-green-100 text-green-700' :
                              alert.alert_type === 'DETERIORATION' ? 'bg-red-100 text-red-700' :
                              alert.alert_type === 'OVERDUE_ASSESSMENT' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {alert.alert_type.replace(/_/g, ' ')}
                            </span>
                            <span className="text-xs text-gray-500 font-medium">{alert.display_name || alert.client_id}</span>
                          </div>
                          <p className="text-sm font-medium text-gray-900">{alert.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{alert.description}</p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => navigate('/consult', { state: { contextType: 'patient', contextId: alert.patient_id } })}
                          className="text-[10px] px-2.5 py-1 rounded-lg font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 transition-colors"
                        >
                          Ask Miwa
                        </button>
                        <button
                          onClick={() => {
                            apiFetch(`/patients/alerts/${alert.id}/dismiss`, { method: 'POST' })
                            setAlerts(prev => prev.filter(a => a.id !== alert.id))
                            window.dispatchEvent(new CustomEvent('miwa:alert_dismissed'))
                          }}
                          className="text-[10px] px-2 py-1 rounded-lg font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── New User Onboarding Guide ── */}
      {isNewAccount && (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(96,71,238,0.15)' }}>
          <div className="px-5 py-4" style={{ background: 'linear-gradient(135deg, rgba(96,71,238,0.06) 0%, rgba(10,197,162,0.06) 100%)' }}>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xl">👋</span>
              <h3 className="text-base font-bold text-gray-900">Welcome! Here's how to get started in 3 steps</h3>
            </div>
            <p className="text-sm text-gray-500 ml-9">Complete these steps and you'll have your first clinical note in under 5 minutes.</p>
          </div>
          <div className="p-5 bg-white space-y-3">
            {[
              {
                step: 1,
                title: 'Add your first client',
                desc: 'Go to Patients and click "+ New Patient". Enter a client ID, display name, and presenting concerns.',
                to: '/patients',
                cta: 'Add Patient',
                done: stats.totalPatients > 0,
              },
              {
                step: 2,
                title: 'Record a session note',
                desc: 'Open your client → "New Session". Type bullets or dictate — Miwa generates SOAP, BIRP, and DAP notes.',
                to: '/workspace',
                cta: 'Open Workspace',
                done: stats.totalSessions > 0,
              },
              {
                step: 3,
                title: 'Ask Miwa a clinical question',
                desc: 'Open the Consult chat and ask anything — case conceptualization, treatment planning, or "Who needs a PHQ-9?"',
                to: '/consult',
                cta: 'Chat with Miwa',
                done: false,
              },
            ].map(item => (
              <div key={item.step} className={`flex items-start gap-3 p-3.5 rounded-xl transition-colors ${item.done ? 'bg-green-50/50' : 'bg-gray-50 hover:bg-gray-100'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                  item.done ? 'bg-green-500 text-white' : 'bg-brand-100 text-brand-700'
                }`}>
                  {item.done ? '✓' : item.step}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${item.done ? 'text-green-700 line-through' : 'text-gray-900'}`}>{item.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                </div>
                {!item.done && (
                  <Link to={item.to} className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg text-brand-600 bg-brand-50 hover:bg-brand-100 transition-colors">
                    {item.cta}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick Actions (hidden after 5 dashboard visits) ── */}
      {(() => {
        const visits = parseInt(localStorage.getItem('miwa_dashboard_visits') || '0', 10)
        if (visits > 5) return null
        return (
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Quick Actions</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {quickActions.map(action => (
            <Link
              key={action.to + action.label}
              to={action.to}
              className="group rounded-2xl p-4 bg-white border border-gray-100 hover:border-gray-200 hover:shadow-md transition-all duration-200"
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 transition-colors ${action.color}`}>
                {action.icon}
              </div>
              <div className="text-sm font-semibold text-gray-900 group-hover:text-brand-600 transition-colors leading-tight">{action.label}</div>
              <div className="text-xs text-gray-400 mt-1 leading-relaxed">{action.desc}</div>
            </Link>
          ))}
        </div>
      </div>
        )
      })()}

      {/* ── Recent Sessions ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Recent Sessions</p>
          <Link to="/patients" className="text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors">
            View all →
          </Link>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          {recentSessions.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              {stats.totalPatients === 0 ? (
                <>
                  <p className="text-sm text-gray-500 mb-4">No clients yet. Add a patient to get started.</p>
                  <Link to="/patients" className="btn-primary">Add Patient</Link>
                </>
              ) : stats.totalSessions === 0 ? (
                <>
                  <p className="text-sm text-gray-500 mb-4">
                    {stats.totalPatients === 1 ? 'Your client has' : `Your ${stats.totalPatients} clients have`} no sessions yet. Open Workspace to record one.
                  </p>
                  <Link to="/workspace" className="btn-primary">Open Workspace</Link>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-500 mb-4">
                    No sessions in the last 7 days. {stats.totalSessions} session{stats.totalSessions === 1 ? '' : 's'} on record.
                  </p>
                  <Link to="/patients" className="btn-primary">View All Patients</Link>
                </>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {recentSessions.map(session => {
                const displayFormat = session.note_format === 'INTAKE' ? 'Intake' : session.note_format
                return (
                  <li key={session.id}>
                    <Link
                      to={`/patients/${session.patient_id}/sessions/${session.id}`}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/80 transition-colors group"
                    >
                      <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-brand-600">
                          {patientInitials({ display_name: session.display_name, client_id: session.client_id })}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900 group-hover:text-brand-600 transition-colors">{session.display_name || session.client_id}</span>
                          {displayFormat && displayFormat !== 'SOAP' && (
                            <span className="text-[10px] font-bold text-brand-500 bg-brand-50 px-1.5 py-0.5 rounded-md border border-brand-100">{displayFormat}</span>
                          )}
                          {session.signed_at ? (
                            <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-100">Signed</span>
                          ) : (
                            <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-100">Unsigned</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 truncate mt-0.5">{session.assessment || 'No assessment recorded'}</p>
                      </div>
                      <span className="text-xs text-gray-300 flex-shrink-0">{formatDate(session.session_date || session.created_at)}</span>
                      <svg className="w-4 h-4 text-gray-300 group-hover:text-brand-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

    </div>
  )
}
