import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ReferenceArea, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { API_BASE } from '../lib/api'

const API = API_BASE

const SOUL_COLORS = ['#6366F1', '#8B5CF6', '#EC4899', '#14B8A6', '#F59E0B', '#10B981']

const RELATIONAL_TEMPLATE_LABELS = {
  'ras': 'RAS — Relationship Satisfaction',
  'das-4': 'DAS-4 — Dyadic Adjustment',
  'score-15': 'SCORE-15 — Family Functioning',
  'fad-gf': 'FAD-GF — Family Assessment',
}

// ── Severity helpers ──────────────────────────────────────────────────────────
function getSeverityBadge(level, color) {
  if (!level) return null
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
      style={{ background: color || '#6B7280' }}
    >
      {level}
    </span>
  )
}

function TrendArrow({ trend, baseline, current }) {
  const dir = current > baseline ? '↑' : current < baseline ? '↓' : '→'
  if (trend === 'IMPROVING') return <span className="text-emerald-600 font-bold text-sm">{dir} Improving</span>
  if (trend === 'WORSENING') return <span className="text-red-600 font-bold text-sm">{dir} Worsening</span>
  if (trend === 'STABLE') return <span className="text-amber-600 font-bold text-sm">→ Stable</span>
  return <span className="text-gray-400 text-sm">Insufficient data</span>
}

// ── Custom Chart Tooltip ──────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-600">{p.name}:</span>
          <span className="font-bold" style={{ color: p.color }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Assessment Form Modal ─────────────────────────────────────────────────────
function AssessmentModal({ patient, onClose, onSubmit }) {
  const [templateType, setTemplateType] = useState('phq-9')
  const [templates, setTemplates] = useState({})
  const [responses, setResponses] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    fetch(`${API}/assessments/templates`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const map = {}
        data.forEach(t => { map[t.id] = t })
        setTemplates(map)
      })
  }, [])

  const template = templates[templateType]

  function handleResponse(qIndex, value) {
    setResponses(prev => ({ ...prev, [qIndex]: { index: qIndex, value } }))
  }

  async function handleSubmit() {
    if (!template) return
    const allAnswered = template.questions.every((_, i) => responses[i] !== undefined)
    if (!allAnswered) return alert('Please answer all questions before submitting.')

    setSubmitting(true)
    const orderedResponses = template.questions.map((q, i) => ({
      questionId: q.id,
      value: responses[i].value,
    }))

    try {
      const res = await fetch(`${API}/assessments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patient.id,
          template_type: templateType,
          responses: orderedResponses,
          notes,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSubmit(data)
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const totalScore = template
    ? template.questions.reduce((sum, _, i) => sum + (responses[i]?.value ?? 0), 0)
    : 0
  const answeredCount = Object.keys(responses).length
  const totalQuestions = template?.questions.length || 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Administer Assessment</h2>
            <p className="text-sm text-gray-500">Client: {patient?.display_name || patient?.client_id}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Type selector */}
        <div className="px-6 pt-4 pb-2 flex gap-3 flex-wrap">
          {['phq-9', 'gad-7', 'pcl-5', 'cssrs'].map(t => (
            <button
              key={t}
              onClick={() => { setTemplateType(t); setResponses({}) }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                templateType === t
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {template && (
          <>
            <div className="px-6 py-2">
              <p className="text-xs text-indigo-700 font-medium bg-indigo-50 rounded-lg px-3 py-2">{template.instructions}</p>
            </div>

            {/* Questions */}
            <div className="flex-1 overflow-y-auto px-6 pb-2 space-y-4">
              {template.questions.map((q, i) => (
                <div key={q.id} className={`rounded-xl border p-4 transition-all ${responses[i] !== undefined ? 'border-indigo-200 bg-indigo-50/40' : 'border-gray-200 bg-white'}`}>
                  <p className="text-sm font-medium text-gray-800 mb-3">
                    <span className="text-indigo-400 font-bold mr-2">{i + 1}.</span>
                    {q.text}
                    {i === 8 && templateType === 'phq-9' && (
                      <span className="ml-2 text-xs text-red-600 font-semibold">⚠️ Risk item</span>
                    )}
                    {templateType === 'cssrs' && i >= 1 && (
                      <span className="ml-2 text-xs text-red-600 font-semibold">⚠️ Active ideation</span>
                    )}
                  </p>
                  <div className={templateType === 'cssrs' ? 'grid grid-cols-2 gap-2' : template.options.length <= 4 ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-1.5'}>
                    {template.options.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => handleResponse(i, opt.value)}
                        className={`text-left px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                          responses[i]?.value === opt.value
                            ? templateType === 'cssrs' && opt.value === 1
                              ? 'bg-red-600 text-white border-red-600'
                              : 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                        }`}
                      >
                        {templateType === 'cssrs'
                          ? <span className="font-bold">{opt.label}</span>
                          : <><span className="font-bold mr-1">{opt.value}</span> — {opt.label}</>
                        }
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Clinician Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Any clinical observations..."
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-indigo-400"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                <span className="font-semibold text-gray-900">{answeredCount}/{totalQuestions}</span> answered
                {answeredCount > 0 && (
                  <span className="ml-3 font-semibold text-indigo-700">Running score: {totalScore}</span>
                )}
              </div>
              <button
                onClick={handleSubmit}
                disabled={submitting || answeredCount < totalQuestions}
                className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all ${
                  answeredCount === totalQuestions && !submitting
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                {submitting ? 'Submitting…' : 'Submit Assessment'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Alert Card ────────────────────────────────────────────────────────────────
function AlertCard({ alert, onDismiss, onRead }) {
  const navigate = useNavigate()

  const severityConfig = {
    CRITICAL: {
      leftBar: 'bg-red-500',
      bg: 'bg-white',
      border: 'border-gray-200',
      icon: '🚨',
      badge: 'bg-red-100 text-red-700 ring-1 ring-red-200',
      label: 'Critical',
      titleColor: 'text-red-700',
    },
    WARNING:  { leftBar: 'bg-amber-400', bg: 'bg-white', border: 'border-gray-200', icon: '⚠️', badge: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200', label: 'Warning', titleColor: 'text-gray-900' },
    SUCCESS:  { leftBar: 'bg-emerald-400', bg: 'bg-white', border: 'border-gray-200', icon: '✅', badge: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200', label: 'Positive', titleColor: 'text-gray-900' },
    INFO:     { leftBar: 'bg-blue-400', bg: 'bg-white', border: 'border-gray-200', icon: 'ℹ️', badge: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200', label: 'Info', titleColor: 'text-gray-900' },
  }
  const cfg = severityConfig[alert.severity] || severityConfig.INFO

  function handleCardClick(e) {
    // Don't navigate if clicking action buttons
    if (e.target.closest('button')) return
    if (alert.patient_id) navigate(`/patients/${alert.patient_id}`)
  }

  return (
    <div
      className={`rounded-2xl border overflow-hidden ${cfg.bg} ${cfg.border} ${!alert.is_read ? 'shadow-md' : 'opacity-70'} cursor-pointer hover:shadow-lg transition-shadow`}
      onClick={handleCardClick}
    >
      <div className="flex">
        {/* Left color bar */}
        <div className={`w-1 flex-shrink-0 ${cfg.leftBar}`} />
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1">
              <span className="text-2xl flex-shrink-0 mt-0.5">{cfg.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                  <span className="text-xs font-semibold text-gray-600">Client: {alert.display_name || alert.client_id}</span>
                  {!alert.is_read && (
                    <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
                  )}
                </div>
                <p className={`text-sm font-bold ${cfg.titleColor}`}>{alert.title}</p>
                <p className="text-sm text-gray-600 mt-0.5">{alert.description}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <p className="text-xs text-gray-400">{new Date(alert.created_at).toLocaleString()}</p>
                  {alert.patient_id && (
                    <span className="text-xs text-indigo-500 font-medium">View client →</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1 flex-shrink-0">
              {!alert.is_read && (
                <button
                  onClick={e => { e.stopPropagation(); onRead(alert.id) }}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium whitespace-nowrap"
                >
                  Mark read
                </button>
              )}
              <button
                onClick={e => { e.stopPropagation(); onDismiss(alert.id) }}
                className="text-xs text-gray-400 hover:text-red-500 font-medium"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Outcomes Page ────────────────────────────────────────────────────────
export default function Outcomes() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState('alerts')
  const [alerts, setAlerts] = useState([])
  const [practiceStats, setPracticeStats] = useState(null)
  const [mbcAdherence, setMbcAdherence] = useState(null)
  const [patients, setPatients] = useState([])
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [progressData, setProgressData] = useState(null)
  const [showAssessmentModal, setShowAssessmentModal] = useState(false)
  const [modalPatient, setModalPatient] = useState(null)
  const [loadingProgress, setLoadingProgress] = useState(false)
  const [alertFilter, setAlertFilter] = useState('all') // all | unread | critical

  // New state
  const [caseloadData, setCaseloadData] = useState([])
  const [overdueData, setOverdueData] = useState([])
  const [supervisionNotes, setSupervisionNotes] = useState([])
  const [newSupervisionNote, setNewSupervisionNote] = useState('')
  const [newSupervisionNoteType, setNewSupervisionNoteType] = useState('observation')
  const [submittingSupervisionNote, setSubmittingSupervisionNote] = useState(false)
  const [digestData, setDigestData] = useState(null)
  const [loadingDigest, setLoadingDigest] = useState(false)
  const [digestCopied, setDigestCopied] = useState(false)

  // Load alerts
  const loadAlerts = useCallback(async () => {
    const res = await fetch(`${API}/assessments/alerts`, { credentials: 'include' })
    const data = await res.json()
    if (res.ok) setAlerts(data)
  }, [])

  // Load practice stats + MBC adherence
  const loadPractice = useCallback(async () => {
    const res = await fetch(`${API}/assessments/practice`, { credentials: 'include' })
    const data = await res.json()
    if (res.ok) setPracticeStats(data)
    // MBC adherence — non-fatal
    try {
      const mbcRes = await fetch(`${API}/assessments/mbc-adherence`, { credentials: 'include' })
      if (mbcRes.ok) setMbcAdherence(await mbcRes.json())
    } catch {}
  }, [])

  // Load patients list
  const loadPatients = useCallback(async () => {
    const res = await fetch(`${API}/patients`, { credentials: 'include' })
    const data = await res.json()
    if (res.ok) setPatients(data)
  }, [])

  // Load progress for selected patient
  const loadProgress = useCallback(async (patientId) => {
    setLoadingProgress(true)
    const res = await fetch(`${API}/assessments/progress/${patientId}`, { credentials: 'include' })
    const data = await res.json()
    if (res.ok) setProgressData(data)
    setLoadingProgress(false)
  }, [])

  // Load caseload data
  const loadCaseload = useCallback(async () => {
    const res = await fetch(`${API}/assessments/caseload`, { credentials: 'include' })
    const data = await res.json()
    if (res.ok) setCaseloadData(data)
  }, [])

  // Load overdue data — filter out locally dismissed entries (7-day snooze)
  const loadOverdue = useCallback(async () => {
    const res = await fetch(`${API}/assessments/overdue`, { credentials: 'include' })
    const data = await res.json()
    if (!res.ok) return
    try {
      const dismissed = JSON.parse(localStorage.getItem('overdue_dismissed') || '{}')
      const now = Date.now()
      const active = data.filter(o => {
        const exp = dismissed[String(o.patient_id)]
        return !exp || now > exp
      })
      setOverdueData(active)
    } catch {
      setOverdueData(data)
    }
  }, [])

  const dismissOverdue = useCallback((patientId) => {
    try {
      const dismissed = JSON.parse(localStorage.getItem('overdue_dismissed') || '{}')
      dismissed[String(patientId)] = Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
      localStorage.setItem('overdue_dismissed', JSON.stringify(dismissed))
    } catch {}
    setOverdueData(prev => prev.filter(x => x.patient_id !== patientId))
  }, [])

  // Load supervision notes for selected patient
  const loadSupervisionNotes = useCallback(async (patientId) => {
    if (!patientId) return
    const res = await fetch(`${API}/assessments/supervision/${patientId}`, { credentials: 'include' })
    const data = await res.json()
    if (res.ok) setSupervisionNotes(data)
  }, [])

  useEffect(() => {
    loadAlerts()
    loadPractice()
    loadPatients()
    loadOverdue()
  }, [])

  // Auto-select patient + tab from URL params (e.g. /outcomes?patient=21&tab=client)
  useEffect(() => {
    if (patients.length === 0) return
    const patientParam = searchParams.get('patient')
    const tabParam = searchParams.get('tab')
    if (patientParam) {
      const match = patients.find(p => String(p.id) === patientParam)
      if (match) {
        setSelectedPatient(match)
        setActiveTab(tabParam || 'client')
      }
    }
  }, [patients])

  useEffect(() => {
    if (activeTab === 'caseload') loadCaseload()
  }, [activeTab])

  useEffect(() => {
    if (selectedPatient) {
      loadProgress(selectedPatient.id)
      loadSupervisionNotes(selectedPatient.id)
    }
  }, [selectedPatient])

  async function handleDismissAlert(id) {
    await fetch(`${API}/assessments/alerts/${id}`, { method: 'DELETE', credentials: 'include' })
    setAlerts(prev => prev.filter(a => a.id !== id))
    loadPractice()
  }

  async function handleReadAlert(id) {
    await fetch(`${API}/assessments/alerts/${id}/read`, { method: 'PATCH', credentials: 'include' })
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_read: 1 } : a))
    loadPractice()
  }

  async function handleMarkAllRead() {
    const unread = alerts.filter(a => !a.is_read)
    await Promise.all(unread.map(a =>
      fetch(`${API}/assessments/alerts/${a.id}/read`, { method: 'PATCH', credentials: 'include' })
    ))
    setAlerts(prev => prev.map(a => ({ ...a, is_read: 1 })))
    loadPractice()
  }

  async function handleDismissAll() {
    const toDismiss = filteredAlerts
    await Promise.all(toDismiss.map(a =>
      fetch(`${API}/assessments/alerts/${a.id}`, { method: 'DELETE', credentials: 'include' })
    ))
    const dismissedIds = new Set(toDismiss.map(a => a.id))
    setAlerts(prev => prev.filter(a => !dismissedIds.has(a.id)))
    loadPractice()
  }

  function handleAssessmentSubmit(result) {
    setShowAssessmentModal(false)
    if (result.risk_flags?.length > 0) {
      alert(`⚠️ Risk flag detected! Score: ${result.total_score} (${result.severity_level}).\n\nPlease review immediately.`)
    }
    loadAlerts()
    loadPractice()
    if (selectedPatient) loadProgress(selectedPatient.id)
  }

  async function handleAddSupervisionNote() {
    if (!newSupervisionNote.trim() || !selectedPatient) return
    setSubmittingSupervisionNote(true)
    try {
      const res = await fetch(`${API}/assessments/supervision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: selectedPatient.id,
          note_text: newSupervisionNote.trim(),
          note_type: newSupervisionNoteType,
        }),
      })
      if (res.ok) {
        setNewSupervisionNote('')
        loadSupervisionNotes(selectedPatient.id)
      }
    } catch {}
    setSubmittingSupervisionNote(false)
  }

  async function handleDeleteSupervisionNote(noteId) {
    if (!confirm('Delete this supervision note?')) return
    await fetch(`${API}/assessments/supervision/${noteId}`, { method: 'DELETE', credentials: 'include' })
    loadSupervisionNotes(selectedPatient.id)
  }

  async function loadDigest() {
    setLoadingDigest(true)
    try {
      const res = await fetch(`${API}/digest/preview`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (res.ok) setDigestData(data)
    } catch {}
    setLoadingDigest(false)
  }

  function copyDigest() {
    if (!digestData) return
    const text = [
      `Miwa Practice Digest — ${digestData.period}`,
      `Generated: ${new Date(digestData.generatedAt).toLocaleDateString()}`,
      '',
      `Total Patients: ${digestData.stats.totalPatients}`,
      `Sessions (last 7 days): ${digestData.stats.totalSessions7Days}`,
      `Total Assessments: ${digestData.stats.totalAssessments}`,
      `Critical Alerts: ${digestData.stats.criticalAlerts}`,
      `Recent Improvements: ${digestData.stats.improvements}`,
      `Overdue Assessments: ${digestData.stats.overdueCount}`,
      '',
      digestData.riskClients.length > 0
        ? `Clients with critical alerts:\n${digestData.riskClients.map(c => `  - ${c.display_name || c.client_id} (${c.alert_count} alert${c.alert_count !== 1 ? 's' : ''})`).join('\n')}`
        : 'No clients with critical alerts.',
    ].join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setDigestCopied(true)
      setTimeout(() => setDigestCopied(false), 2000)
    })
  }

  function handlePrintProgress() {
    if (!progressData) return
    const printContent = `
      <html><head><title>Progress Report — ${progressData.display_name || progressData.client_id}</title>
      <style>
        body { font-family: sans-serif; max-width: 800px; margin: 40px auto; color: #111; }
        h1 { font-size: 1.5rem; margin-bottom: 4px; }
        .meta { color: #555; font-size: 0.9rem; margin-bottom: 24px; }
        .scores { display: flex; gap: 24px; margin-bottom: 24px; }
        .score-card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; min-width: 160px; }
        .score-card h3 { margin: 0 0 8px; font-size: 0.85rem; color: #666; text-transform: uppercase; }
        .score-card .value { font-size: 2rem; font-weight: bold; }
        .score-card .severity { font-size: 0.85rem; color: #555; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; font-size: 0.85rem; }
        th { background: #f5f5f5; font-weight: 600; }
        @media print { body { margin: 20px; } }
      </style></head><body>
      <h1>Progress Report</h1>
      <div class="meta">Client: ${progressData.display_name || progressData.client_id} &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString()}</div>
      <div class="scores">
        ${progressData.phq9.current !== null ? `
        <div class="score-card">
          <h3>PHQ-9</h3>
          <div class="value">${progressData.phq9.current}</div>
          <div class="severity">${progressData.phq9.severity} &nbsp; Baseline: ${progressData.phq9.baseline ?? '—'}</div>
        </div>` : ''}
        ${progressData.gad7.current !== null ? `
        <div class="score-card">
          <h3>GAD-7</h3>
          <div class="value">${progressData.gad7.current}</div>
          <div class="severity">${progressData.gad7.severity} &nbsp; Baseline: ${progressData.gad7.baseline ?? '—'}</div>
        </div>` : ''}
      </div>
      <h2 style="font-size:1rem;margin-bottom:8px;">Assessment Timeline</h2>
      <table>
        <thead><tr><th>Date</th><th>PHQ-9</th><th>PHQ-9 Severity</th><th>GAD-7</th><th>GAD-7 Severity</th></tr></thead>
        <tbody>
          ${progressData.timeline.map(t => `
          <tr>
            <td>${t.date}</td>
            <td>${t.phq9 ?? '—'}</td>
            <td>${t.phq9_severity ?? '—'}</td>
            <td>${t.gad7 ?? '—'}</td>
            <td>${t.gad7_severity ?? '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      </body></html>
    `
    const win = window.open('', '_blank')
    win.document.write(printContent)
    win.document.close()
    win.print()
  }

  const filteredAlerts = alerts.filter(a => {
    if (alertFilter === 'unread') return !a.is_read
    if (alertFilter === 'critical') return a.severity === 'CRITICAL'
    return true
  })

  const unreadCount = alerts.filter(a => !a.is_read).length
  const criticalCount = alerts.filter(a => a.severity === 'CRITICAL' && !a.is_read).length

  const tabs = [
    { id: 'alerts', label: 'Alerts', badge: unreadCount },
    { id: 'client', label: 'Client Progress' },
    { id: 'practice', label: 'Practice Overview' },
    { id: 'caseload', label: 'Caseload Risk' },
  ]

  const NATIONAL_AVERAGES = {
    phq9: { avg: 7.2, label: 'Mild', source: 'Population study avg' },
    gad7: { avg: 5.8, label: 'Mild', source: 'Population study avg' },
    cbtReduction: 50,
  }

  const supervisionTypeConfig = {
    observation: { label: 'Observation', color: 'bg-blue-100 text-blue-700' },
    recommendation: { label: 'Recommendation', color: 'bg-amber-100 text-amber-700' },
    concern: { label: 'Concern', color: 'bg-red-100 text-red-700' },
  }

  return (
    <div className="min-h-full bg-gray-50/50">
      {/* Page header */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Outcome Tracking</h1>
            <p className="text-sm text-gray-500 mt-0.5">PHQ-9 · GAD-7 · PCL-5 · C-SSRS · Clinical Progress</p>
          </div>
          {criticalCount > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
              <span className="text-red-600 text-sm font-bold">🚨 {criticalCount} Critical</span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 border-b border-gray-100">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === tab.id
                  ? 'text-indigo-700 border-b-2 border-indigo-600 -mb-px bg-indigo-50/60'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.id === 'caseload' && (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
              {tab.label}
              {tab.badge > 0 && (
                <span className="text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 md:px-8 py-6">

        {/* ── ALERTS TAB ── */}
        {activeTab === 'alerts' && (
          <div className="max-w-3xl mx-auto space-y-4">
            {/* Filter bar */}
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { id: 'all', label: 'All' },
                { id: 'unread', label: 'Unread' },
                { id: 'critical', label: '🚨 Critical' },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setAlertFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    alertFilter === f.id
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-3">
                <span className="text-xs text-gray-400">{filteredAlerts.length} alert{filteredAlerts.length !== 1 ? 's' : ''}</span>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                  >
                    Mark all as read
                  </button>
                )}
                {filteredAlerts.length > 0 && (
                  <button
                    onClick={handleDismissAll}
                    className="text-xs text-red-500 hover:text-red-700 font-semibold"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {filteredAlerts.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-5xl mb-3">✅</div>
                <p className="font-semibold">No alerts</p>
                <p className="text-sm mt-1">Your caseload looks stable</p>
              </div>
            ) : (
              filteredAlerts.map(alert => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  onDismiss={handleDismissAlert}
                  onRead={handleReadAlert}
                />
              ))
            )}

            {/* Overdue section */}
            {overdueData.length > 0 && (
              <div className="mt-8">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">📋</span>
                  <h3 className="text-sm font-bold text-gray-700">Overdue Assessments ({overdueData.length})</h3>
                </div>
                <div className="space-y-2">
                  {overdueData.map(o => (
                    <div key={o.patient_id} className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                      <div>
                        <span className="text-sm font-semibold text-gray-800">{o.display_name || o.client_id}</span>
                        <span className="text-xs text-amber-700 ml-2">
                          {o.days_overdue ? `${o.days_overdue}d overdue` : 'Never assessed'}
                        </span>
                        <div className="text-xs text-gray-500 mt-0.5">Missing: {o.template_types_overdue.join(', ').toUpperCase()}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/patients/${o.patient_id}`)}
                          className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition-colors"
                        >
                          Schedule
                        </button>
                        <button
                          onClick={() => dismissOverdue(o.patient_id)}
                          title="Snooze for 7 days"
                          className="px-3 py-1.5 bg-white border border-amber-300 text-amber-700 rounded-lg text-xs font-semibold hover:bg-amber-100 transition-colors"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CLIENT PROGRESS TAB ── */}
        {activeTab === 'client' && (
          <div className="space-y-6">
            {/* Patient selector + Administer button */}
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={selectedPatient?.id || ''}
                onChange={e => {
                  const p = patients.find(pt => pt.id === +e.target.value)
                  setSelectedPatient(p || null)
                  setProgressData(null)
                  setSupervisionNotes([])
                }}
                className="flex-1 min-w-[200px] max-w-sm border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white"
              >
                <option value="">— Select a client —</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>{p.display_name || p.client_id}</option>
                ))}
              </select>

              {selectedPatient && (
                <>
                  <button
                    onClick={() => { setModalPatient(selectedPatient); setShowAssessmentModal(true) }}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Administer Assessment
                  </button>
                  <button
                    onClick={handlePrintProgress}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition-colors"
                    title="Export/print progress report"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Export PDF
                  </button>
                </>
              )}
            </div>

            {!selectedPatient && (
              <div className="text-center py-20 text-gray-400">
                <div className="text-5xl mb-3">📊</div>
                <p className="font-semibold text-lg">Select a client to view progress</p>
                <p className="text-sm mt-1">PHQ-9 and GAD-7 timelines will appear here</p>
              </div>
            )}

            {selectedPatient && loadingProgress && (
              <div className="text-center py-16">
                <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            )}

            {selectedPatient && progressData && !loadingProgress && (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* PHQ-9 Current */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">PHQ-9 Current</p>
                    {progressData.phq9.current !== null ? (
                      <>
                        <p className="text-3xl font-bold text-gray-900">{progressData.phq9.current}</p>
                        <div className="mt-1">{getSeverityBadge(progressData.phq9.severity, progressData.phq9.color)}</div>
                        <div className="mt-2"><TrendArrow trend={progressData.phq9.trend} baseline={progressData.phq9.baseline} current={progressData.phq9.current} /></div>
                      </>
                    ) : <p className="text-gray-400 text-sm">No data</p>}
                  </div>

                  {/* PHQ-9 Baseline */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">PHQ-9 Baseline</p>
                    {progressData.phq9.baseline !== null ? (
                      <>
                        <p className="text-3xl font-bold text-gray-900">{progressData.phq9.baseline}</p>
                        <p className="text-xs text-gray-400 mt-1">{progressData.phq9.count} assessments</p>
                        {progressData.phq9.current !== null && progressData.phq9.baseline !== null && (
                          <p className={`text-sm font-bold mt-2 ${progressData.phq9.current < progressData.phq9.baseline ? 'text-emerald-600' : progressData.phq9.current > progressData.phq9.baseline ? 'text-red-600' : 'text-gray-500'}`}>
                            {progressData.phq9.current < progressData.phq9.baseline ? '↓' : progressData.phq9.current > progressData.phq9.baseline ? '↑' : '→'} {Math.abs(progressData.phq9.current - progressData.phq9.baseline)} pts from baseline
                          </p>
                        )}
                      </>
                    ) : <p className="text-gray-400 text-sm">No data</p>}
                  </div>

                  {/* GAD-7 Current */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">GAD-7 Current</p>
                    {progressData.gad7.current !== null ? (
                      <>
                        <p className="text-3xl font-bold text-gray-900">{progressData.gad7.current}</p>
                        <div className="mt-1">{getSeverityBadge(progressData.gad7.severity, progressData.gad7.color)}</div>
                        <div className="mt-2"><TrendArrow trend={progressData.gad7.trend} baseline={progressData.gad7.baseline} current={progressData.gad7.current} /></div>
                      </>
                    ) : <p className="text-gray-400 text-sm">No data</p>}
                  </div>

                  {/* GAD-7 Baseline */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">GAD-7 Baseline</p>
                    {progressData.gad7.baseline !== null ? (
                      <>
                        <p className="text-3xl font-bold text-gray-900">{progressData.gad7.baseline}</p>
                        <p className="text-xs text-gray-400 mt-1">{progressData.gad7.count} assessments</p>
                        {progressData.gad7.current !== null && progressData.gad7.baseline !== null && (
                          <p className={`text-sm font-bold mt-2 ${progressData.gad7.current < progressData.gad7.baseline ? 'text-emerald-600' : progressData.gad7.current > progressData.gad7.baseline ? 'text-red-600' : 'text-gray-500'}`}>
                            {progressData.gad7.current < progressData.gad7.baseline ? '↓' : progressData.gad7.current > progressData.gad7.baseline ? '↑' : '→'} {Math.abs(progressData.gad7.current - progressData.gad7.baseline)} pts from baseline
                          </p>
                        )}
                      </>
                    ) : <p className="text-gray-400 text-sm">No data</p>}
                  </div>
                </div>

                {/* Progress Chart */}
                {progressData.timeline.length > 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-700">
                        Progress Timeline — {progressData.display_name || progressData.client_id}
                      </h3>
                      <button
                        onClick={() => navigate(`/patients/${selectedPatient.id}`)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"
                      >
                        View full profile
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                    <ResponsiveContainer width="100%" height={360}>
                      <LineChart data={progressData.timeline} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        {/* PHQ-9 severity zones */}
                        <ReferenceArea y1={0}  y2={4}  fill="#10B981" fillOpacity={0.07} />
                        <ReferenceArea y1={5}  y2={9}  fill="#F59E0B" fillOpacity={0.07} />
                        <ReferenceArea y1={10} y2={14} fill="#F97316" fillOpacity={0.07} />
                        <ReferenceArea y1={15} y2={27} fill="#EF4444" fillOpacity={0.07} />

                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                        <YAxis domain={[0, 27]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />

                        {/* Clinical significance threshold lines */}
                        <ReferenceLine y={10} stroke="#6366F1" strokeDasharray="6 3" strokeWidth={1}
                          label={{ value: 'PHQ-9 Clinical threshold', position: 'right', fontSize: 10, fill: '#6366F1' }} />

                        {progressData.phq9.count > 0 && (
                          <Line
                            type="monotone"
                            dataKey="phq9"
                            stroke="#6366F1"
                            strokeWidth={2.5}
                            dot={{ fill: '#6366F1', r: 5, strokeWidth: 2, stroke: '#fff' }}
                            activeDot={{ r: 7 }}
                            name="PHQ-9 Depression"
                            connectNulls={false}
                          />
                        )}
                        {progressData.gad7.count > 0 && (
                          <Line
                            type="monotone"
                            dataKey="gad7"
                            stroke="#8B5CF6"
                            strokeWidth={2.5}
                            dot={{ fill: '#8B5CF6', r: 5, strokeWidth: 2, stroke: '#fff' }}
                            activeDot={{ r: 7 }}
                            name="GAD-7 Anxiety"
                            connectNulls={false}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>

                    {/* Severity zone legend */}
                    <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-gray-50">
                      {[
                        { label: 'Minimal (0–4)', color: '#10B981' },
                        { label: 'Mild (5–9)', color: '#F59E0B' },
                        { label: 'Moderate (10–14)', color: '#F97316' },
                        { label: 'Severe (15+)', color: '#EF4444' },
                      ].map(z => (
                        <div key={z.label} className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded" style={{ background: z.color, opacity: 0.4 }} />
                          <span className="text-xs text-gray-500">{z.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
                    <div className="text-4xl mb-3">📋</div>
                    <p className="font-semibold text-gray-700">No assessments yet</p>
                    <p className="text-sm text-gray-500 mt-1">Click "Administer Assessment" to get started</p>
                  </div>
                )}

                {/* ── Soul / Relational Data (couple & family clients) ── */}
                {(() => {
                  const clientType = selectedPatient?.client_type
                  const byMember = progressData?.byMember
                  if (!byMember || !clientType || clientType === 'individual') return null
                  const souls = Object.keys(byMember)
                  if (souls.length === 0) return null

                  // Collect all relational instrument types present across any soul
                  const allInstruments = [...new Set(souls.flatMap(s => Object.keys(byMember[s] || {})))]
                  if (allInstruments.length === 0) return null

                  return allInstruments.map(instrument => {
                    const label = RELATIONAL_TEMPLATE_LABELS[instrument] || instrument.toUpperCase()
                    // Build chart data: merge timelines from all souls onto shared dates
                    const dateMap = {}
                    souls.forEach(soul => {
                      const timeline = byMember[soul]?.[instrument]?.timeline || []
                      timeline.forEach(pt => {
                        if (!dateMap[pt.date]) dateMap[pt.date] = { date: pt.date }
                        dateMap[pt.date][soul] = pt.score
                      })
                    })
                    const chartData = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date))

                    return (
                      <div key={instrument} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold text-gray-700">{label}</h3>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${clientType === 'couple' ? 'bg-violet-50 text-violet-600' : 'bg-teal-50 text-teal-600'}`}>
                            {clientType === 'couple' ? 'Couple' : 'Family'}
                          </span>
                        </div>

                        {/* Per-soul summary row */}
                        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(souls.length, 3)}, 1fr)` }}>
                          {souls.map((soul, si) => {
                            const soulData = byMember[soul]?.[instrument]
                            if (!soulData) return null
                            return (
                              <div key={soul} className="rounded-xl border border-gray-100 p-3">
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: SOUL_COLORS[si % SOUL_COLORS.length] }} />
                                  <span className="text-xs font-bold text-gray-700">{soul}</span>
                                </div>
                                {soulData.current !== null ? (
                                  <>
                                    <p className="text-2xl font-bold text-gray-900">{soulData.current}</p>
                                    {soulData.severity_level && (
                                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white mt-1 inline-block"
                                        style={{ background: soulData.severity_color || '#6B7280' }}>
                                        {soulData.severity_level}
                                      </span>
                                    )}
                                    {soulData.baseline !== null && soulData.current !== soulData.baseline && (
                                      <p className={`text-xs font-semibold mt-1 ${
                                        soulData.trend === 'IMPROVING' ? 'text-emerald-600' :
                                        soulData.trend === 'WORSENING' ? 'text-red-600' : 'text-gray-500'
                                      }`}>
                                        {soulData.current > soulData.baseline ? '↑' : soulData.current < soulData.baseline ? '↓' : '→'} {Math.abs(soulData.current - soulData.baseline)} pts from baseline ({soulData.baseline})
                                      </p>
                                    )}
                                  </>
                                ) : <p className="text-xs text-gray-400">No data</p>}
                              </div>
                            )
                          })}
                        </div>

                        {/* Multi-soul line chart */}
                        {chartData.length > 0 && (
                          <ResponsiveContainer width="100%" height={260}>
                            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                              <Tooltip content={<CustomTooltip />} />
                              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                              {souls.map((soul, si) => (
                                <Line
                                  key={soul}
                                  type="monotone"
                                  dataKey={soul}
                                  stroke={SOUL_COLORS[si % SOUL_COLORS.length]}
                                  strokeWidth={2.5}
                                  dot={{ fill: SOUL_COLORS[si % SOUL_COLORS.length], r: 4, strokeWidth: 2, stroke: '#fff' }}
                                  activeDot={{ r: 6 }}
                                  connectNulls={false}
                                />
                              ))}
                            </LineChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    )
                  })
                })()}

                {/* Supervision Notes */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                  <h3 className="text-sm font-bold text-gray-700 mb-4">Supervision Notes</h3>

                  {/* Add note form */}
                  <div className="space-y-3 mb-5">
                    <div className="flex gap-2">
                      {['observation', 'recommendation', 'concern'].map(t => (
                        <button
                          key={t}
                          onClick={() => setNewSupervisionNoteType(t)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all capitalize ${
                            newSupervisionNoteType === t
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={newSupervisionNote}
                      onChange={e => setNewSupervisionNote(e.target.value)}
                      rows={3}
                      placeholder="Add a supervision note, clinical observation, or recommendation…"
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-indigo-400"
                    />
                    <button
                      onClick={handleAddSupervisionNote}
                      disabled={!newSupervisionNote.trim() || submittingSupervisionNote}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                        newSupervisionNote.trim() && !submittingSupervisionNote
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      {submittingSupervisionNote ? 'Adding…' : 'Add Note'}
                    </button>
                  </div>

                  {/* Notes timeline */}
                  {supervisionNotes.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">No supervision notes yet</p>
                  ) : (
                    <div className="space-y-3">
                      {supervisionNotes.map(note => {
                        const cfg = supervisionTypeConfig[note.note_type] || supervisionTypeConfig.observation
                        return (
                          <div key={note.id} className="flex gap-3 group">
                            <div className="flex-shrink-0 w-2 h-2 rounded-full bg-gray-300 mt-2" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
                                <span className="text-xs text-gray-400">{new Date(note.created_at).toLocaleDateString()}</span>
                                {note.author_name && <span className="text-xs text-gray-400">by {note.author_name}</span>}
                              </div>
                              <p className="text-sm text-gray-700">{note.note_text}</p>
                            </div>
                            <button
                              onClick={() => handleDeleteSupervisionNote(note.id)}
                              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 flex-shrink-0 transition-all"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── PRACTICE OVERVIEW TAB ── */}
        {activeTab === 'practice' && (
          <div className="space-y-6 max-w-4xl">
            {/* Quick action */}
            <button
              onClick={() => {
                if (patients.length === 0) return alert('Add patients first')
                setModalPatient(patients[0])
                setShowAssessmentModal(true)
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Administer Assessment
            </button>

            {practiceStats ? (
              <>
                {/* Stats grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'Total Assessments', value: practiceStats.totalAssessments, color: 'text-indigo-600', icon: '📋' },
                    { label: 'Clients Tracked', value: practiceStats.activeClients, color: 'text-violet-600', icon: '👥' },
                    { label: 'Improvements', value: practiceStats.improvements, color: 'text-emerald-600', icon: '📈' },
                    { label: 'Unread Alerts', value: alerts.filter(a => !a.is_read).length, color: alerts.filter(a => a.severity === 'CRITICAL').length > 0 ? 'text-red-600' : 'text-amber-600', icon: alerts.filter(a => a.severity === 'CRITICAL').length > 0 ? '🚨' : '🔔' },
                  ].map(stat => (
                    <div key={stat.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                      <div className="text-2xl mb-2">{stat.icon}</div>
                      <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
                      <p className="text-xs text-gray-500 font-medium mt-1">{stat.label}</p>
                    </div>
                  ))}
                </div>

                {/* Treatment response stats */}
                <div className="grid md:grid-cols-4 gap-4">
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">MBC Adherence</p>
                    {mbcAdherence?.adherence_rate !== null && mbcAdherence?.adherence_rate !== undefined ? (
                      <>
                        <p className={`text-3xl font-bold ${mbcAdherence.adherence_rate >= 70 ? 'text-emerald-600' : mbcAdherence.adherence_rate >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                          {mbcAdherence.adherence_rate}%
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {mbcAdherence.sessions_with_mbc} of {mbcAdherence.total_sessions} sessions have assessments
                        </p>
                      </>
                    ) : (
                      <p className="text-gray-400 text-sm">No completed sessions yet</p>
                    )}
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Remission Rate</p>
                    {practiceStats.remissionRate !== null ? (
                      <>
                        <p className="text-3xl font-bold text-emerald-600">{practiceStats.remissionRate}%</p>
                        <p className="text-xs text-gray-500 mt-1">Patients achieving PHQ-9 ≤ 9 from baseline ≥ 10</p>
                      </>
                    ) : (
                      <p className="text-gray-400 text-sm">Insufficient data</p>
                    )}
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Avg Sessions to Remission</p>
                    {practiceStats.avgSessionsToRemission !== null ? (
                      <>
                        <p className="text-3xl font-bold text-indigo-600">{practiceStats.avgSessionsToRemission}</p>
                        <p className="text-xs text-gray-500 mt-1">Sessions from baseline to PHQ-9 ≤ 9</p>
                      </>
                    ) : (
                      <p className="text-gray-400 text-sm">Insufficient data</p>
                    )}
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Non-Responders</p>
                    <p className="text-3xl font-bold text-amber-600">{practiceStats.nonResponders?.length ?? 0}</p>
                    <p className="text-xs text-gray-500 mt-1">4+ PHQ-9 assessments, &lt;20% improvement</p>
                  </div>
                </div>

                {/* Non-responders callout */}
                {practiceStats.nonResponders?.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                    <h3 className="text-sm font-bold text-amber-900 mb-3">Non-Responders — Consider treatment adjustment</h3>
                    <div className="space-y-2">
                      {practiceStats.nonResponders.map(nr => (
                        <div key={nr.patient_id} className="flex items-center justify-between bg-white rounded-xl px-4 py-2.5 border border-amber-100">
                          <div>
                            <span className="text-sm font-semibold text-gray-800">{nr.display_name || nr.client_id}</span>
                            <span className="text-xs text-gray-500 ml-2">{nr.assessments_count} assessments</span>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold text-gray-800">{nr.baseline_score} → {nr.latest_score}</div>
                            <div className={`text-xs font-semibold ${nr.percent_change > 0 ? 'text-red-600' : 'text-amber-600'}`}>
                              {nr.percent_change > 0 ? '+' : ''}{nr.percent_change}% change
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Avg scores + Benchmark */}
                <div className="grid md:grid-cols-2 gap-4">
                  {[
                    {
                      label: 'Average PHQ-9 Score',
                      value: practiceStats.avgPhq9,
                      national: NATIONAL_AVERAGES.phq9.avg,
                      nationalLabel: NATIONAL_AVERAGES.phq9.label,
                      max: 27,
                      count: practiceStats.phq9Count,
                      color: '#6366F1',
                      description: 'Depression severity across your caseload',
                      benchmarkNote: 'vs. national community avg 7.2 (Mild)',
                    },
                    {
                      label: 'Average GAD-7 Score',
                      value: practiceStats.avgGad7,
                      national: NATIONAL_AVERAGES.gad7.avg,
                      nationalLabel: NATIONAL_AVERAGES.gad7.label,
                      max: 21,
                      count: practiceStats.gad7Count,
                      color: '#8B5CF6',
                      description: 'Anxiety severity across your caseload',
                      benchmarkNote: 'vs. national community avg 5.8 (Mild)',
                    },
                  ].map(s => (
                    <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{s.label}</p>
                      {s.value !== null ? (
                        <>
                          <div className="flex items-end gap-2 mb-3">
                            <span className="text-4xl font-bold" style={{ color: s.color }}>{s.value}</span>
                            <span className="text-gray-400 text-sm mb-1">/ {s.max}</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
                            <div
                              className="h-2 rounded-full transition-all"
                              style={{ width: `${(s.value / s.max) * 100}%`, background: s.color }}
                            />
                          </div>
                          <p className="text-xs text-gray-500">{s.description} · {s.count} client{s.count !== 1 ? 's' : ''} tracked</p>
                          {/* National benchmark comparison */}
                          <div className="mt-3 pt-3 border-t border-gray-50">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-500">Your practice</span>
                              <span className="text-gray-500">National avg</span>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                              <span className="font-bold text-sm" style={{ color: s.color }}>{s.value}</span>
                              <div className="flex-1 mx-3 h-px bg-gray-200 relative">
                                <div
                                  className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-gray-400"
                                  style={{ left: `${(s.national / s.max) * 100}%` }}
                                />
                              </div>
                              <span className="font-bold text-sm text-gray-500">{s.national}</span>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">{s.benchmarkNote}</p>
                          </div>
                        </>
                      ) : (
                        <p className="text-gray-400 text-sm">No data yet</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Benchmark info callout */}
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                  <p className="text-xs font-semibold text-blue-700 mb-1">Benchmark Note</p>
                  <p className="text-xs text-blue-600">National community averages are from large population studies. Clinical populations typically score higher. Expected PHQ-9 reduction with CBT: ~50% over 12 weeks (Cuijpers et al.).</p>
                </div>

                {/* PHQ-9 severity distribution */}
                {practiceStats.phq9Count > 0 && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <h3 className="text-sm font-bold text-gray-700 mb-4">PHQ-9 Severity Distribution (Current Scores)</h3>
                    <div className="space-y-3">
                      {[
                        { label: 'Minimal (0–4)', key: 'Minimal', color: '#10B981' },
                        { label: 'Mild (5–9)', key: 'Mild', color: '#F59E0B' },
                        { label: 'Moderate (10–14)', key: 'Moderate', color: '#F97316' },
                        { label: 'Moderately Severe (15–19)', key: 'Moderately Severe', color: '#EF4444' },
                        { label: 'Severe (20–27)', key: 'Severe', color: '#7F1D1D' },
                      ].map(row => {
                        const count = practiceStats.phq9Distribution[row.key] || 0
                        const pct = practiceStats.phq9Count > 0 ? Math.round((count / practiceStats.phq9Count) * 100) : 0
                        return (
                          <div key={row.key} className="flex items-center gap-3">
                            <span className="text-xs text-gray-500 w-48 flex-shrink-0">{row.label}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-3">
                              <div
                                className="h-3 rounded-full transition-all"
                                style={{ width: `${pct}%`, background: row.color }}
                              />
                            </div>
                            <span className="text-xs font-bold text-gray-700 w-8 text-right">{count}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Monthly Digest Preview */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-gray-700">Monthly Digest Preview</h3>
                    <div className="flex gap-2">
                      {digestData && (
                        <button
                          onClick={copyDigest}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                            digestCopied ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-indigo-300'
                          }`}
                        >
                          {digestCopied
                            ? <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                            : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy Digest</>
                          }
                        </button>
                      )}
                      <button
                        onClick={loadDigest}
                        disabled={loadingDigest}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                      >
                        {loadingDigest
                          ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Loading…</>
                          : digestData ? 'Refresh' : 'Generate Preview'
                        }
                      </button>
                    </div>
                  </div>

                  {digestData ? (
                    <div className="space-y-4">
                      <p className="text-xs text-gray-400">Period: {digestData.period} &nbsp;·&nbsp; Generated: {new Date(digestData.generatedAt).toLocaleString()}</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {[
                          { label: 'Total Patients', value: digestData.stats.totalPatients, icon: '👥' },
                          { label: 'Sessions (7d)', value: digestData.stats.totalSessions7Days, icon: '📅' },
                          { label: 'Assessments', value: digestData.stats.totalAssessments, icon: '📋' },
                          { label: 'Critical Alerts', value: digestData.stats.criticalAlerts, icon: '🚨', red: digestData.stats.criticalAlerts > 0 },
                          { label: 'Improvements (30d)', value: digestData.stats.improvements, icon: '📈' },
                          { label: 'Overdue', value: digestData.stats.overdueCount, icon: '⏰', amber: digestData.stats.overdueCount > 0 },
                        ].map(s => (
                          <div key={s.label} className={`rounded-xl p-3 ${s.red ? 'bg-red-50' : s.amber ? 'bg-amber-50' : 'bg-gray-50'}`}>
                            <div className="text-lg">{s.icon}</div>
                            <div className={`text-xl font-bold ${s.red ? 'text-red-700' : s.amber ? 'text-amber-700' : 'text-gray-800'}`}>{s.value}</div>
                            <div className="text-xs text-gray-500">{s.label}</div>
                          </div>
                        ))}
                      </div>
                      {digestData.riskClients.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-red-700 mb-2">Clients with Critical Alerts:</p>
                          <div className="flex flex-wrap gap-2">
                            {digestData.riskClients.map(c => (
                              <span key={c.patient_id} className="px-2 py-1 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium">
                                {c.display_name || c.client_id} ({c.alert_count} alert{c.alert_count !== 1 ? 's' : ''})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-400">
                      <div className="text-3xl mb-2">📬</div>
                      <p className="text-sm">Click "Generate Preview" to see your practice digest</p>
                    </div>
                  )}
                </div>

                {/* Critical alerts callout */}
                {alerts.filter(a => a.severity === 'CRITICAL').length > 0 && (
                  <div className="bg-white border-2 border-red-200 rounded-2xl overflow-hidden flex shadow-sm">
                    <div className="w-1.5 bg-red-500 flex-shrink-0" />
                    <div className="flex items-center gap-4 p-5 flex-1">
                      <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-xl">🚨</span>
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-gray-900">{alerts.filter(a => a.severity === 'CRITICAL').length} Critical Alert{alerts.filter(a => a.severity === 'CRITICAL').length !== 1 ? 's' : ''} Require Attention</p>
                        <p className="text-sm text-red-600 mt-0.5">Suicide risk flags are present. Review immediately.</p>
                      </div>
                      <button
                        onClick={() => { setAlertFilter('critical'); setActiveTab('alerts') }}
                        className="ml-auto px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 transition-colors flex-shrink-0 shadow"
                      >
                        View Critical Alerts
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-16">
                <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            )}
          </div>
        )}

        {/* ── CASELOAD RISK TAB ── */}
        {activeTab === 'caseload' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-700">Caseload Risk Overview</h2>
              <button
                onClick={loadCaseload}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Refresh
              </button>
            </div>

            {caseloadData.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <div className="text-5xl mb-3">👥</div>
                <p className="font-semibold text-lg">No caseload data yet</p>
                <p className="text-sm mt-1">Administer PHQ-9 or GAD-7 assessments to see risk overview</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">PHQ-9</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">GAD-7</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Assessed</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Alert</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {caseloadData.map(row => (
                      <tr
                        key={row.patient_id}
                        className={`hover:bg-gray-50 cursor-pointer transition-colors ${row.has_critical_alert ? 'bg-red-50/40' : ''}`}
                        onClick={() => navigate(`/patients/${row.patient_id}`)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {row.has_critical_alert && <span className="text-base">🚨</span>}
                            <span className="font-semibold text-gray-800">{row.display_name || row.client_id}</span>
                            {row.never_assessed && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Never assessed</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.phq9_latest !== null ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <span className="font-bold text-gray-900">{row.phq9_latest}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded-full text-white font-semibold" style={{ background: row.phq9_color || '#6B7280' }}>
                                {row.phq9_severity}
                              </span>
                            </div>
                          ) : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.gad7_latest !== null ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <span className="font-bold text-gray-900">{row.gad7_latest}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded-full text-white font-semibold" style={{ background: row.gad7_color || '#6B7280' }}>
                                {row.gad7_severity}
                              </span>
                            </div>
                          ) : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.last_assessed ? (
                            <div>
                              <div className="text-xs text-gray-600">{new Date(row.last_assessed).toLocaleDateString()}</div>
                              {row.days_since_assessment !== null && (
                                <div className={`text-xs ${row.days_since_assessment > 30 ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}>
                                  {row.days_since_assessment}d ago
                                </div>
                              )}
                            </div>
                          ) : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.has_critical_alert
                            ? <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">CRITICAL</span>
                            : row.days_since_assessment > 30
                              ? <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Overdue</span>
                              : <span className="text-xs text-gray-400">OK</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={e => { e.stopPropagation(); navigate(`/patients/${row.patient_id}`) }}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                          >
                            View →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Assessment Modal */}
      {showAssessmentModal && modalPatient && (
        <AssessmentModal
          patient={modalPatient}
          onClose={() => setShowAssessmentModal(false)}
          onSubmit={handleAssessmentSubmit}
        />
      )}
    </div>
  )
}
