/**
 * MobilePatientDetail -- purpose-built mobile patient detail view.
 * Deep-link: /m/clients/:id
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { apiFetch } from '../../lib/api'

/* ── Helpers ────────────────────────────────────────────────────── */

function formatDate(dateStr) {
  if (!dateStr) return '\u2014'
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return dateStr }
}

function formatShortDate(dateStr) {
  if (!dateStr) return '\u2014'
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return dateStr }
}

function truncate(text, max = 60) {
  if (!text) return ''
  const clean = text.replace(/\n+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max).replace(/\s\S*$/, '') + '\u2026' : clean
}

function severityColor(severity) {
  if (!severity) return 'bg-gray-100 text-gray-600'
  const s = severity.toLowerCase()
  if (s.includes('minimal') || s.includes('none') || s.includes('no ')) return 'bg-emerald-100 text-emerald-700'
  if (s.includes('mild')) return 'bg-amber-100 text-amber-700'
  if (s.includes('moderate')) return 'bg-orange-100 text-orange-700'
  if (s.includes('severe') || s.includes('active')) return 'bg-red-100 text-red-700'
  return 'bg-gray-100 text-gray-600'
}

function trendArrow(trend) {
  if (trend === 'IMPROVING') return { arrow: '\u2193', label: 'Improving', cls: 'text-emerald-600' }
  if (trend === 'WORSENING') return { arrow: '\u2191', label: 'Worsening', cls: 'text-red-600' }
  if (trend === 'STABLE') return { arrow: '\u2192', label: 'Stable', cls: 'text-amber-600' }
  return null
}

/* ── Spinner ────────────────────────────────────────────────────── */

function Spinner() {
  return (
    <div className="flex items-center justify-center h-full min-h-[50vh]">
      <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

/* ── Error Banner ───────────────────────────────────────────────── */

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="mx-4 mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-center justify-between">
      <p className="text-sm text-red-700">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-sm font-semibold text-red-700 active:text-red-900 ml-3 shrink-0">
          Retry
        </button>
      )}
    </div>
  )
}

/* ── Main Component ─────────────────────────────────────────────── */

export default function MobilePatientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { therapist } = useAuth()

  const [patient, setPatient] = useState(null)
  const [sessions, setSessions] = useState([])
  const [assessments, setAssessments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('sessions')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [patRes, sessRes, assessRes] = await Promise.allSettled([
        apiFetch(`/patients/${id}`).then(r => { if (!r.ok) throw new Error('Failed to load patient'); return r.json() }),
        apiFetch(`/patients/${id}/sessions`).then(r => r.ok ? r.json() : []),
        apiFetch(`/assessments?patient_id=${id}`).then(r => r.ok ? r.json() : []),
      ])

      if (patRes.status === 'rejected') throw new Error('Could not load patient')
      setPatient(patRes.value)
      setSessions(Array.isArray(sessRes.value) ? sessRes.value : [])
      setAssessments(Array.isArray(assessRes.value) ? assessRes.value : [])
    } catch (err) {
      setError(err.message || 'Something went wrong')
    }
    setLoading(false)
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return <Spinner />
  if (error && !patient) return <ErrorBanner message={error} onRetry={loadData} />

  const patientName = patient?.display_name || patient?.client_id || 'Patient'
  const lastSession = sessions[0]
  const lastSeenDate = lastSession?.session_date ? formatShortDate(lastSession.session_date) : null
  const caseType = patient?.client_type || 'individual'
  const presentingConcern = truncate(patient?.presenting_concerns, 40)

  /* ── Quick stats pills ─────────────────────────────────────────── */
  const statPills = [
    sessions.length > 0 && { label: `${sessions.length} session${sessions.length !== 1 ? 's' : ''}` },
    lastSeenDate && { label: `Last: ${lastSeenDate}` },
    caseType && { label: caseType.charAt(0).toUpperCase() + caseType.slice(1) },
    presentingConcern && { label: presentingConcern },
  ].filter(Boolean)

  /* ── Parse note for session list ───────────────────────────────── */
  function sessionAssessmentPreview(session) {
    try {
      if (session.notes_json) {
        const parsed = typeof session.notes_json === 'string' ? JSON.parse(session.notes_json) : session.notes_json
        const fmt = session.note_format || 'SOAP'
        const assessment = parsed[fmt]?.assessment || parsed.SOAP?.assessment || ''
        return truncate(assessment, 70)
      }
    } catch {}
    return truncate(session.assessment, 70)
  }

  /* ── Treatment plan data ───────────────────────────────────────── */
  const treatmentPlan = patient?.treatment_plan || null
  let planGoals = []
  if (treatmentPlan) {
    try {
      const parsed = typeof treatmentPlan === 'string' ? JSON.parse(treatmentPlan) : treatmentPlan
      if (Array.isArray(parsed.goals)) planGoals = parsed.goals
      else if (Array.isArray(parsed)) planGoals = parsed
    } catch {
      // treat as free text
    }
  }

  /* ── Diagnoses from patient ────────────────────────────────────── */
  const diagnoses = (() => {
    try {
      if (patient?.diagnoses) {
        const d = typeof patient.diagnoses === 'string' ? JSON.parse(patient.diagnoses) : patient.diagnoses
        return Array.isArray(d) ? d : []
      }
    } catch {}
    return []
  })()

  return (
    <div className="pb-24">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100">
        <div className="flex items-center justify-between px-4 h-14">
          <button
            onClick={() => navigate('/m/clients')}
            className="flex items-center gap-1 text-indigo-600 active:text-indigo-800 -ml-1 min-w-[44px] min-h-[44px] justify-center"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm font-medium">Clients</span>
          </button>
          <h1 className="text-base font-bold text-gray-900 truncate mx-3 flex-1 text-center">{patientName}</h1>
          <button
            onClick={() => setActiveTab('info')}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 active:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={loadData} />}

      {/* ── Quick Stats ──────────────────────────────────────────── */}
      {statPills.length > 0 && (
        <div className="px-4 pt-3 pb-1 overflow-x-auto">
          <div className="flex gap-2 min-w-min">
            {statPills.map((pill, i) => (
              <span key={i} className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 whitespace-nowrap">
                {pill.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Action Buttons ───────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2 overflow-x-auto">
        <div className="flex gap-2.5 min-w-min">
          <ActionCard
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />}
            label="New Session"
            color="indigo"
            onClick={() => navigate(`/m/clients/${id}/session/new`)}
          />
          <ActionCard
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />}
            label="Assessment"
            color="emerald"
            onClick={() => setActiveTab('assessments')}
          />
          <ActionCard
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />}
            label="Check-in"
            color="teal"
            onClick={async () => {
              try {
                await apiFetch(`/patients/${id}/send-checkin`, { method: 'POST' })
              } catch {}
            }}
          />
          <ActionCard
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />}
            label="Outcomes"
            color="amber"
            onClick={() => setActiveTab('assessments')}
          />
        </div>
      </div>

      {/* ── Tab Bar ──────────────────────────────────────────────── */}
      <div className="sticky top-14 z-10 bg-white border-b border-gray-100">
        <div className="flex">
          {['sessions', 'assessments', 'plan', 'info'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-sm font-semibold text-center transition-colors relative ${
                activeTab === tab ? 'text-indigo-600' : 'text-gray-400 active:text-gray-600'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {activeTab === tab && (
                <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-indigo-600 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ──────────────────────────────────────────── */}
      <div className="px-4 pt-3">
        {activeTab === 'sessions' && (
          <SessionsTab
            sessions={sessions}
            patientId={id}
            navigate={navigate}
            sessionAssessmentPreview={sessionAssessmentPreview}
          />
        )}
        {activeTab === 'assessments' && (
          <AssessmentsTab assessments={assessments} />
        )}
        {activeTab === 'plan' && (
          <PlanTab planGoals={planGoals} treatmentPlan={treatmentPlan} patientId={id} navigate={navigate} />
        )}
        {activeTab === 'info' && (
          <InfoTab patient={patient} diagnoses={diagnoses} navigate={navigate} />
        )}
      </div>
    </div>
  )
}

/* ── Action Card ────────────────────────────────────────────────── */

function ActionCard({ icon, label, color, onClick }) {
  const colorMap = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    teal: 'bg-teal-50 text-teal-600 border-teal-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
  }
  return (
    <button
      onClick={onClick}
      className={`shrink-0 flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border active:opacity-80 transition-opacity min-w-[80px] ${colorMap[color] || colorMap.indigo}`}
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">{icon}</svg>
      <span className="text-xs font-semibold whitespace-nowrap">{label}</span>
    </button>
  )
}

/* ── Sessions Tab ───────────────────────────────────────────────── */

function SessionsTab({ sessions, patientId, navigate, sessionAssessmentPreview }) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />}
        title="No sessions yet"
        action="New Session"
        onAction={() => navigate(`/m/clients/${patientId}/session/new`)}
      />
    )
  }

  return (
    <div className="space-y-2">
      {sessions.map(session => {
        const fmt = session.note_format || 'SOAP'
        const isSigned = !!session.signed_at
        const preview = sessionAssessmentPreview(session)
        return (
          <button
            key={session.id}
            onClick={() => navigate(`/m/clients/${patientId}/session/${session.id}`)}
            className="w-full text-left rounded-xl border border-gray-200 bg-white px-4 py-3 active:bg-gray-50 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-gray-900">
                {formatDate(session.session_date)}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                  {fmt}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  isSigned ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}>
                  {isSigned ? 'Signed' : 'Draft'}
                </span>
              </div>
            </div>
            {preview && (
              <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{preview}</p>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ── Assessments Tab ────────────────────────────────────────────── */

function AssessmentsTab({ assessments }) {
  if (assessments.length === 0) {
    return (
      <EmptyState
        icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />}
        title="No assessments yet"
      />
    )
  }

  // Group by template_type for trend tracking
  const byType = {}
  assessments.forEach(a => {
    const key = a.template_type || 'unknown'
    if (!byType[key]) byType[key] = []
    byType[key].push(a)
  })

  return (
    <div className="space-y-2">
      {assessments.map(a => {
        const typeAssessments = byType[a.template_type] || []
        const idx = typeAssessments.findIndex(x => x.id === a.id)
        const prev = typeAssessments[idx + 1] // previous chronologically (sorted most recent first)
        let trendInfo = null
        if (prev && a.total_score !== undefined && prev.total_score !== undefined) {
          if (a.total_score < prev.total_score) trendInfo = trendArrow('IMPROVING')
          else if (a.total_score > prev.total_score) trendInfo = trendArrow('WORSENING')
          else trendInfo = trendArrow('STABLE')
        }
        if (a.trend) trendInfo = trendArrow(a.trend)

        return (
          <div key={a.id} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-900">
                  {(a.template_type || '').toUpperCase().replace('-', '-')}
                </span>
                <span className="text-sm font-bold text-indigo-600">{a.total_score ?? '\u2014'}</span>
              </div>
              <span className="text-xs text-gray-400">{formatShortDate(a.completed_at || a.created_at)}</span>
            </div>
            <div className="flex items-center gap-2">
              {a.severity && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${severityColor(a.severity)}`}>
                  {a.severity}
                </span>
              )}
              {trendInfo && (
                <span className={`text-xs font-bold ${trendInfo.cls}`}>
                  {trendInfo.arrow} {trendInfo.label}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── Plan Tab ───────────────────────────────────────────────────── */

function PlanTab({ planGoals, treatmentPlan, patientId, navigate }) {
  if (!treatmentPlan && planGoals.length === 0) {
    return (
      <EmptyState
        icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />}
        title="No treatment plan"
        subtitle="Create a treatment plan from the desktop view or ask Miwa to generate one."
      />
    )
  }

  // Structured goals with progress
  if (planGoals.length > 0) {
    return (
      <div className="space-y-3">
        {planGoals.map((goal, i) => {
          const progress = goal.progress ?? goal.percent ?? 0
          const goalText = typeof goal === 'string' ? goal : (goal.description || goal.goal || goal.text || `Goal ${i + 1}`)
          return (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-sm font-medium text-gray-900 mb-2">{goalText}</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, Math.max(0, progress))}%`,
                      background: progress >= 75 ? '#10b981' : progress >= 40 ? '#f59e0b' : '#6366f1',
                    }}
                  />
                </div>
                <span className="text-xs font-bold text-gray-500 shrink-0 w-10 text-right">{progress}%</span>
              </div>
              {goal.objectives && Array.isArray(goal.objectives) && (
                <div className="mt-2 space-y-1">
                  {goal.objectives.slice(0, 3).map((obj, j) => (
                    <p key={j} className="text-xs text-gray-500 pl-2 border-l-2 border-gray-200">
                      {typeof obj === 'string' ? obj : obj.text || obj.description}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // Free-text treatment plan fallback
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
        {typeof treatmentPlan === 'string' ? treatmentPlan.slice(0, 600) : JSON.stringify(treatmentPlan).slice(0, 600)}
      </p>
    </div>
  )
}

/* ── Info Tab ───────────────────────────────────────────────────── */

function InfoTab({ patient, diagnoses, navigate }) {
  if (!patient) return null

  const fields = [
    { label: 'Client ID', value: patient.client_id },
    { label: 'Name', value: patient.display_name },
    { label: 'Age', value: patient.age },
    { label: 'Gender', value: patient.gender },
    { label: 'Pronouns', value: patient.pronouns },
    { label: 'Case Type', value: patient.client_type },
    { label: 'Phone', value: patient.phone, type: 'tel' },
    { label: 'Email', value: patient.email, type: 'email' },
    { label: 'Created', value: formatDate(patient.created_at) },
  ].filter(f => f.value)

  const riskFields = [
    { label: 'Suicidal Ideation', value: patient.suicidal_ideation },
    { label: 'Self-Harm', value: patient.self_harm },
    { label: 'Substance Use', value: patient.substance_use },
    { label: 'Domestic Violence', value: patient.domestic_violence },
    { label: 'Homicidal Ideation', value: patient.homicidal_ideation },
  ].filter(f => f.value && f.value !== 'none' && f.value !== 'None')

  return (
    <div className="space-y-4">
      {/* Demographics */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Demographics</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {fields.map(f => (
            <div key={f.label} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-xs text-gray-500">{f.label}</span>
              {f.type === 'tel' ? (
                <a href={`tel:${f.value}`} className="text-sm font-medium text-indigo-600">{f.value}</a>
              ) : f.type === 'email' ? (
                <a href={`mailto:${f.value}`} className="text-sm font-medium text-indigo-600">{f.value}</a>
              ) : (
                <span className="text-sm font-medium text-gray-900">{f.value}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Presenting Concerns */}
      {patient.presenting_concerns && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Presenting Concerns</h3>
          </div>
          <div className="px-4 py-3">
            <p className="text-sm text-gray-700 leading-relaxed">{patient.presenting_concerns}</p>
          </div>
        </div>
      )}

      {/* Diagnoses */}
      {diagnoses.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Diagnoses</h3>
          </div>
          <div className="px-4 py-3 space-y-1.5">
            {diagnoses.map((dx, i) => (
              <p key={i} className="text-sm text-gray-700">
                {typeof dx === 'string' ? dx : `${dx.code || ''} ${dx.description || dx.label || ''}`.trim()}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Diagnosis Profile (free text) */}
      {patient.diagnosis_profile && !diagnoses.length && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Diagnosis Profile</h3>
          </div>
          <div className="px-4 py-3">
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
              {typeof patient.diagnosis_profile === 'string'
                ? patient.diagnosis_profile.slice(0, 500)
                : ''}
            </p>
          </div>
        </div>
      )}

      {/* Risk Screening */}
      {riskFields.length > 0 && (
        <div className="rounded-xl border border-red-100 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-red-100 bg-red-50">
            <h3 className="text-xs font-bold text-red-600 uppercase tracking-wide">Risk Screening</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {riskFields.map(f => (
              <div key={f.label} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-gray-500">{f.label}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  f.value === 'yes' || f.value === 'active' || f.value === 'current'
                    ? 'bg-red-100 text-red-700'
                    : f.value === 'past' || f.value === 'history'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {f.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit on desktop link */}
      <button
        onClick={() => navigate(`/patients/${patient.id}`)}
        className="w-full py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-500 active:bg-gray-50 transition-colors"
      >
        Full profile on desktop &rarr;
      </button>
    </div>
  )
}

/* ── Empty State ────────────────────────────────────────────────── */

function EmptyState({ icon, title, subtitle, action, onAction }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-10 text-center">
      <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        {icon}
      </svg>
      <p className="text-sm font-medium text-gray-500">{title}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
      {action && onAction && (
        <button
          onClick={onAction}
          className="mt-4 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold active:bg-indigo-700 transition-colors"
        >
          {action}
        </button>
      )}
    </div>
  )
}
