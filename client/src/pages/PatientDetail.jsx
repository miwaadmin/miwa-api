import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { API_BASE, apiFetch, apiUpload } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ReferenceArea, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import NotesExportModal from '../components/NotesExportModal'
import LetterGenerator from '../components/LetterGenerator'
import TreatmentPlanPanel from '../components/TreatmentPlanPanel'
import { renderClinical } from '../lib/renderClinical'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

// Shared renderer — all AI output uses the same clinical styling app-wide
const renderMarkdown = renderClinical

// Strip markdown, bullets, numbers, normalize smart quotes → plain prose string
function cleanToPlain(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,4}\s*/gm, '')
    .replace(/^[-–—•*]\s*/gm, '')
    .replace(/^\d+[\.\)\:]\s*/gm, '')   // numbered list items
    .replace(/\b\d+\s+(?=[A-Z])/gm, '') // bare leading digit before capital word (e.g. "9 Anxiety")
    .replace(/--+/g, '')
    .replace(/['']/g, "'")              // normalize smart apostrophes
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Extract ICD-10 codes + pull clinical sentences (skip preamble/meta sentences)
function summarizeAnalysis(text) {
  if (!text) return null
  const codes = [...text.matchAll(/\b([A-Z]\d{2}\.?\d*[A-Z0-9]*)\b/g)]
    .map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i).filter(c => c.length >= 3).slice(0, 8)
  const plain = cleanToPlain(text)
  const skip = [
    /below is/i, /flagging/i, /provisional/i, /based on the note/i,
    /should be confirmed/i, /important:/i, /why it fits/i, /suggested icd/i,
    /structured clinical/i, /please note/i, /the following/i,
    /this analysis/i, /code.*listed/i, /diagnostic reasoning/i,
  ]
  const sentences = plain.match(/[^.!?]+[.!?]+/g) || []
  const clinical = sentences.filter(s => s.trim().length > 45 && !skip.some(p => p.test(s)))
  return { codes, snippet: clinical.slice(0, 3).join(' ').trim() || plain.slice(0, 380) }
}

// Clean paragraph summary from treatment plan — skip template preamble
function summarizeProfileText(text, max = 180) {
  const plain = cleanToPlain(text || '')
  if (!plain) return ''
  const firstSentence = (plain.match(/[^.!?]+[.!?]+/) || [plain])[0].trim()
  return firstSentence.length > max ? `${firstSentence.slice(0, max - 1).trim()}…` : firstSentence
}

function parseDiagnosisProfile(text) {
  const raw = cleanToPlain(text || '')
  if (!raw) return { primary: '', secondary: [], notes: '' }

  const primaryMatch = raw.match(/provisional primary:\s*([^.!?]+[.!?]?)/i)
  if (primaryMatch) {
    return {
      primary: primaryMatch[1].trim(),
      secondary: [],
      notes: 'Provisional diagnosis from intake. Refine after ongoing assessment.',
    }
  }

  const dxMatches = [...raw.matchAll(/\b([A-Z]\d{2}\.?\d*[A-Z0-9]*)\s+([^.;]{4,120})/g)]
  const unique = []
  dxMatches.forEach((match) => {
    const label = `${match[1]} ${match[2].trim()}`.replace(/\s{2,}/g, ' ')
    if (!unique.includes(label)) unique.push(label)
  })

  return {
    primary: unique[0] || raw.slice(0, 120),
    secondary: unique.slice(1, 3),
    notes: 'Provisional diagnosis from intake. Refine after ongoing assessment.',
  }
}

function summarizePlan(text) {
  if (!text) return null
  const plain = cleanToPlain(text)
  const skip = [
    // meta-commentary / preamble patterns
    /comprehensive/i, /individualized/i, /written in/i, /professional format/i,
    /appropriate for/i, /treatment plan for/i, /based on the clinical/i,
    /this plan/i, /client id/i, /age:/i, /gender:/i, /primary diagnos/i,
    /below is/i, /the following/i,
    // first-person preamble ("I've tied...", "I have included...", "I created...")
    /^i'?ve?\s+(tied|included|created|written|developed|outlined|provided|structured)/i,
    /^i\s+(have|will|would|am)\s+(tied|included|created|written|developed|outlined|provided)/i,
    // sentences describing plan contents rather than plan itself
    /goals.*objectives.*interventions/i,
    /measurable goals.*objectives/i,
    /objectives.*interventions.*monitoring/i,
    /barriers.*crisis plan/i,
    // header-like fragments
    /^presenting concerns:/i, /^session context:/i, /^note:/i,
    // pure diagnosis/code listing sentences (short, no verb)
    /^[A-Z][a-z]+ (disorder|depression|anxiety|disorder|disorder),?\s+(unspecified|nos|nec)/i,
  ]
  const sentences = plain.match(/[^.!?]+[.!?]+/g) || []
  // Must have a real verb to be a clinical sentence worth showing
  const hasMeaningContent = (s) => /\b(will|should|focus|address|target|reduce|increase|improve|develop|explore|process|strengthen|build|identify|practice|learn|engage|support|monitor|assess|establish|work|help)\b/i.test(s)
  const clinical = sentences.filter(s => {
    const trimmed = s.trim()
    return trimmed.length > 35 && !skip.some(p => p.test(trimmed)) && hasMeaningContent(trimmed)
  })
  // fallback: any sentence that passes skip filter, even without verb match
  if (clinical.length === 0) {
    const fallback = sentences.filter(s => s.trim().length > 35 && !skip.some(p => p.test(s.trim())))
    return fallback.slice(0, 3).join(' ').trim() || plain.slice(0, 380)
  }
  return clinical.slice(0, 3).join(' ').trim()
}

// Combine all note fields into a single flowing prose paragraph
function summarizeSessionNote(fmt, noteData) {
  if (!noteData) return null

  // Field labels per format — used to build natural transitions
  const FIELD_INTRO = {
    SOAP: { subjective: null, objective: 'Clinically,', assessment: 'Assessment indicates', plan: 'The plan includes' },
    BIRP: { subjective: null, objective: 'The therapist', assessment: 'In response,', plan: 'Going forward,' },
    DAP:  { subjective: null, assessment: 'Assessment indicates', plan: 'The plan includes' },
  }
  const intro = FIELD_INTRO[fmt] || FIELD_INTRO.SOAP

  // Extract the first 1-2 sentences from a field, max ~140 chars
  const extract = (text) => {
    if (!text) return null
    const clean = cleanToPlain(text)
    const sentences = clean.match(/[^.!?]+[.!?]+/g) || []
    const result = sentences.slice(0, 2).join(' ').trim()
    if (result.length > 0) return result.length > 150 ? result.slice(0, 150).replace(/\s\S*$/, '') + '…' : result
    return clean.length > 150 ? clean.slice(0, 150).replace(/\s\S*$/, '') + '…' : clean
  }

  const fieldOrder = fmt === 'DAP' ? ['subjective', 'assessment', 'plan'] : ['subjective', 'objective', 'assessment', 'plan']
  const parts = []
  for (const key of fieldOrder) {
    const snippet = extract(noteData[key])
    if (!snippet) continue
    const prefix = intro[key]
    parts.push(prefix ? `${prefix} ${snippet.charAt(0).toLowerCase()}${snippet.slice(1)}` : snippet)
  }

  return parts.join(' ') || null
}

// Build a narrative overview paragraph from structured patient + session data
function buildClientOverview(patient, sessions) {
  const parts = []
  const demo = [patient.age && `${patient.age}-year-old`, patient.gender].filter(Boolean).join(' ')
  if (demo) parts.push(`${patient.client_id} is a ${demo} client.`)
  if (patient.presenting_concerns) {
    const c = patient.presenting_concerns.trim()
    parts.push(`Presenting concerns include ${c.endsWith('.') ? c : c + '.'}`)
  }
  const latest = sessions[0]
  if (latest) {
    // Pull from notes_json if available, otherwise fallback fields
    let assessment = '', plan = ''
    try {
      if (latest.notes_json) {
        const nj = JSON.parse(latest.notes_json)
        const fmt = ['BIRP','SOAP','DAP'].find(f => nj[f]?.assessment) || 'SOAP'
        assessment = nj[fmt]?.assessment || ''
        plan = nj[fmt]?.plan || ''
      }
    } catch {}
    assessment = assessment || latest.assessment || ''
    plan = plan || latest.plan || ''
    if (assessment) parts.push(trimField(assessment, 220))
    if (plan) parts.push(`Current focus: ${trimField(plan, 160)}`)
  }
  return parts.join(' ')
}

// Trim a field value to ~180 chars, stripping note format prefixes (B:, I:, R:, S:, O:, A:, P:, D:)
function trimField(text, max = 180) {
  if (!text) return null
  const clean = text.trim().replace(/^[BIRSOPADP]:\s*/i, '').trim()
  return clean.length > max ? clean.slice(0, max).replace(/\s\S*$/, '') + '…' : clean
}

function fileTypeIcon(ft) {
  if (ft === 'PDF') return '📄'
  if (['DOCX', 'DOC'].includes(ft)) return '📝'
  if (['PNG', 'JPG', 'JPEG', 'WEBP'].includes(ft)) return '🖼️'
  return '📎'
}

// Unified clinical profile experience. Subsumes the old CaseIntelligencePanel
// and the right-column "Clinical Profile" duplicate. Two render modes:
//   • mode="compact" — thin status strip used above an active session viewer
//   • mode="full"    — full living-profile panel: status + AI clinical summary
//                       + outcome progress + next focus + quality gates +
//                       recommended actions + ICD-10 + evidence collapsible
// Diagnosis and intake fields stay in the left-column profile card; this panel
// owns *live, evolving* clinical state only.
function ClinicalProfilePanel({
  patientId,
  patient = null,
  sessions = [],
  clientSummary = '',
  summaryLoading = false,
  onGenerateSummary = null,
  newSessionHref = null,
  mode = 'full',
}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    apiFetch(`/patients/${patientId}/case-intelligence`)
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error || 'Unable to load clinical profile')
        setData(body)
      })
      .catch((err) => setError(err.message || 'Unable to load clinical profile'))
      .finally(() => setLoading(false))
  }, [patientId])

  useEffect(() => { load() }, [load])

  const status = data?.status || {}
  const riskLevel = status.risk_level || 'none'
  const documentationReadiness = status.documentation_readiness || 'unknown'
  const treatmentPlanStatus = status.treatment_plan_status || 'not_started'
  const riskTone = {
    none: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    watch: 'bg-amber-50 text-amber-700 border-amber-200',
    elevated: 'bg-orange-50 text-orange-700 border-orange-200',
    acute: 'bg-red-50 text-red-700 border-red-200',
  }[riskLevel]

  const readinessTone = documentationReadiness === 'ready'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-amber-50 text-amber-700 border-amber-200'

  // ── Compact mode ─────────────────────────────────────────────────────────
  // One-line status strip; lives above the active session viewer so the
  // clinician keeps the live state in view while reading a note.
  if (mode === 'compact') {
    if (loading) {
      return (
        <div className="card p-3 mb-4">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <span>Reading clinical state…</span>
          </div>
        </div>
      )
    }
    if (error || !data) {
      return (
        <div className="card p-3 mb-4 border-amber-100 bg-amber-50">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-amber-800">{error || 'Clinical state unavailable.'}</p>
            <button onClick={load} className="text-xs font-semibold text-amber-700 hover:text-amber-900">Retry</button>
          </div>
        </div>
      )
    }
    const focusFirst = (status.next_session_focus || [])[0]
    return (
      <div className="card p-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border ${riskTone}`}>Risk · {riskLevel}</span>
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border ${readinessTone}`}>Doc · {String(documentationReadiness).replace('_', ' ')}</span>
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200">Plan · {String(treatmentPlanStatus).replace('_', ' ')}</span>
          {focusFirst && (
            <span className="text-xs text-gray-600 ml-auto truncate max-w-[60%]" title={focusFirst}>
              <span className="text-gray-400 mr-1">Next focus:</span>{focusFirst}
            </span>
          )}
        </div>
      </div>
    )
  }

  // ── Full mode ────────────────────────────────────────────────────────────
  // ICD-10 codes harvested from the most recent session ai_feedback.
  const codes = sessions.length
    ? [...new Set((sessions.find(s => s.ai_feedback)?.ai_feedback || '').match(/\b([A-Z]\d{2}\.?\d*[A-Z0-9]*)\b/g) || [])].filter(c => c.length >= 3).slice(0, 8)
    : []

  return (
    <div className="card overflow-hidden mb-5">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] font-bold text-brand-500 uppercase tracking-[0.18em]">Miwa Clinical Profile</p>
          <h3 className="text-base font-bold text-gray-900 mt-1">Living clinical state</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {sessions.length} session{sessions.length !== 1 ? 's' : ''}
            {sessions[0] && <> · last seen {formatDate(sessions[0].session_date)}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {clientSummary && onGenerateSummary && (
            <button
              onClick={onGenerateSummary}
              disabled={summaryLoading}
              className="btn-secondary text-xs flex items-center gap-1.5"
              title="Regenerate the AI clinical summary"
            >
              {summaryLoading
                ? <><div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />Refreshing…</>
                : <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>Refresh summary</>
              }
            </button>
          )}
          <button onClick={load} className="text-xs font-semibold text-brand-600 hover:text-brand-700">Refresh state</button>
          {newSessionHref && (
            <Link to={newSessionHref} className="btn-primary text-xs">+ New Session</Link>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Status strip */}
        {(loading || error || !data) ? (
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 flex items-center gap-2">
            {loading
              ? <><div className="w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /><span className="text-xs text-gray-500">Reading chart data…</span></>
              : <><span className="text-xs text-amber-700">{error || 'Clinical state unavailable.'}</span>{!loading && <button onClick={load} className="ml-auto text-xs font-semibold text-amber-700 hover:text-amber-900">Retry</button>}</>
            }
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className={`rounded-xl border px-3 py-2 ${riskTone}`}>
              <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">Risk</p>
              <p className="text-sm font-bold capitalize">{riskLevel}</p>
            </div>
            <div className={`rounded-xl border px-3 py-2 ${readinessTone}`}>
              <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">Documentation</p>
              <p className="text-sm font-bold capitalize">{String(documentationReadiness).replace('_', ' ')}</p>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-700 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">Treatment Plan</p>
              <p className="text-sm font-bold capitalize">{String(treatmentPlanStatus).replace('_', ' ')}</p>
            </div>
          </div>
        )}

        {/* AI Clinical Summary — narrative across the whole chart */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Clinical Summary</p>
          {summaryLoading && !clientSummary ? (
            <div className="flex items-center gap-3 py-4">
              <div className="w-5 h-5 border-2 border-brand-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <p className="text-sm text-gray-500">Synthesizing {sessions.length} session{sessions.length !== 1 ? 's' : ''}…</p>
            </div>
          ) : clientSummary ? (
            <>
              {summaryLoading && (
                <div className="flex items-center gap-2 mb-2 text-xs text-brand-500">
                  <div className="w-3 h-3 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                  Updating…
                </div>
              )}
              <div className="prose-clinical text-sm text-gray-700"
                dangerouslySetInnerHTML={{ __html: renderClinical(clientSummary || '') }} />
            </>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-gray-400">No sessions recorded yet — add a session first.</p>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center rounded-xl border-2 border-solid border-gray-200">
              <svg className="w-8 h-8 text-brand-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <p className="text-sm font-medium text-gray-600 mb-1">No overview yet</p>
              <p className="text-xs text-gray-400 mb-4">Generate an AI summary across all {sessions.length} session{sessions.length !== 1 ? 's' : ''} for this client.</p>
              {onGenerateSummary && (
                <button onClick={onGenerateSummary} className="btn-primary text-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  Generate Client Overview
                </button>
              )}
            </div>
          )}
        </div>

        {/* Outcome Progress — assessment trajectory chart */}
        {patient?.id && <OutcomeProgressCard patientId={patient.id} patient={patient} />}

        {/* Next session focus + Quality gates (intelligence-driven) */}
        {!loading && !error && data && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Next session focus</p>
              {(status.next_session_focus || []).length > 0 ? (
                <div className="space-y-2">
                  {(status.next_session_focus || []).map((item, idx) => (
                    <div key={idx} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-700 leading-snug">
                      {item}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">No focus areas identified yet.</p>
              )}
            </div>

            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Quality gates</p>
              {(data.gaps || []).length === 0 ? (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  No launch-critical chart gaps detected.
                </div>
              ) : (
                <div className="space-y-2">
                  {(data.gaps || []).slice(0, 4).map((gap) => (
                    <div key={gap.id} className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-amber-900">{gap.title}</p>
                        <span className="text-[10px] font-bold uppercase text-amber-600">{gap.severity}</span>
                      </div>
                      <p className="text-xs text-amber-700 mt-1">{gap.action}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Recommended next actions */}
        {!loading && !error && data && (data.next_actions || []).length > 0 && (
          <div className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-3">
            <p className="text-xs font-bold text-brand-700 uppercase tracking-wide mb-2">Recommended actions</p>
            <ul className="space-y-1">
              {(data.next_actions || []).slice(0, 3).map((action) => (
                <li key={action.id} className="text-sm text-brand-900 leading-snug">{action.label}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ICD-10 codes from the most recent session AI analysis */}
        {codes.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">ICD-10 codes from recent analysis</p>
            <div className="flex flex-wrap gap-1.5">
              {codes.map(c => (
                <span key={c} className="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-100">{c}</span>
              ))}
            </div>
          </div>
        )}

        {/* Why Miwa thinks this — evidence trail, collapsed by default */}
        {!loading && !error && data && (data.evidence || []).length > 0 && (
          <details className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide list-none flex items-center justify-between select-none hover:bg-gray-50">
              <span>Why Miwa thinks this</span>
              <span className="text-gray-300">{(data.evidence || []).length} signals</span>
            </summary>
            <div className="border-t border-gray-100 divide-y divide-gray-50">
              {(data.evidence || []).map((item, idx) => (
                <div key={`${item.type}-${idx}`} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-gray-700">{item.label}</p>
                    {item.date && <span className="text-[10px] text-gray-400">{formatDate(item.date)}</span>}
                  </div>
                  {item.detail && <p className="text-xs text-gray-500 mt-1 leading-snug">{item.detail}</p>}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

function IntakeSourcesPanel({ patientId, onPatientUpdated }) {
  const [docs, setDocs] = useState([])
  const [uploading, setUploading] = useState(false)
  const [applyingId, setApplyingId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [label, setLabel] = useState('')
  const fileInputRef = useRef(null)

  const loadDocs = useCallback(() => {
    apiFetch(`/patients/${patientId}/documents`)
      .then(r => r.json())
      .then(d => setDocs((Array.isArray(d) ? d : []).filter(doc => doc.document_kind === 'intake_source')))
      .catch(() => {})
  }, [patientId])

  useEffect(() => { loadDocs() }, [loadDocs])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    setNotice('')
    const form = new FormData()
    form.append('file', file)
    form.append('document_kind', 'intake_source')
    if (label.trim()) form.append('document_label', label.trim())
    try {
      const res = await apiUpload(`/patients/${patientId}/documents`, form)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setLabel('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      setNotice('Intake source uploaded. You can now apply it to the clinical profile.')
      loadDocs()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleApply = async (docId) => {
    setApplyingId(docId)
    setError('')
    setNotice('')
    try {
      const res = await apiFetch('/ai/document-to-profile', {
        method: 'POST',
        body: JSON.stringify({ patientId, documentId: docId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to apply intake source to profile')
      onPatientUpdated?.(data.patient)
      setNotice('Clinical profile updated from the selected intake source.')
    } catch (err) {
      setError(err.message)
    } finally {
      setApplyingId(null)
    }
  }

  const handleDelete = async (docId) => {
    if (!confirm('Delete this intake source?')) return
    await apiFetch(`/patients/${patientId}/documents/${docId}`, { method: 'DELETE' })
    loadDocs()
  }

  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Intake Sources ({docs.length})</h3>
        <p className="text-xs text-gray-400 mt-0.5">Upload intake assessments, biopsychosocials, or referral forms that can populate the clinical profile.</p>
      </div>
      <div className="px-4 py-3 border-b border-gray-50 space-y-2">
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="Label (e.g. DMH Assessment, Intake Form)"
          className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
        <label className={`flex items-center gap-2 cursor-pointer w-full justify-center px-3 py-2 rounded-lg border-2 border-solid text-xs font-medium transition-colors ${uploading ? 'border-gray-200 text-gray-400 cursor-not-allowed' : 'border-brand-300 text-brand-600 hover:bg-brand-50'}`}>
          {uploading ? 'Uploading…' : 'Upload Intake Source'}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            disabled={uploading}
            accept=".pdf,.docx,.doc,.txt"
            onChange={handleUpload}
          />
        </label>
        {notice && <p className="text-xs text-green-600">{notice}</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
      {docs.length === 0 ? (
        <div className="p-4 text-center text-xs text-gray-400">No intake sources uploaded yet</div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {docs.map(doc => (
            <li key={doc.id} className="px-4 py-3 space-y-2 hover:bg-gray-50">
              <div className="flex items-center gap-3">
                <span className="text-lg">{fileTypeIcon(doc.file_type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-800 truncate">{doc.document_label || doc.original_name}</div>
                  <div className="text-xs text-gray-400 truncate">{doc.original_name}</div>
                </div>
                <button onClick={() => handleDelete(doc.id)} className="p-1 text-gray-300 hover:text-red-500 transition-all" title="Delete intake source">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>{doc.file_type}</span>
                  {!doc.is_image && <span className="text-teal-600">✓ AI readable</span>}
                </div>
                <button onClick={() => handleApply(doc.id)} disabled={applyingId === doc.id} className="btn-secondary text-xs">
                  {applyingId === doc.id ? 'Applying…' : 'Apply to Profile'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RecordFilesPanel({ patientId }) {
  const [docs, setDocs] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [label, setLabel] = useState('')
  const fileInputRef = useRef(null)

  const loadDocs = useCallback(() => {
    apiFetch(`/patients/${patientId}/documents`)
      .then(r => r.json())
      .then(d => setDocs((Array.isArray(d) ? d : []).filter(doc => doc.document_kind !== 'intake_source')))
      .catch(() => {})
  }, [patientId])

  useEffect(() => { loadDocs() }, [loadDocs])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(null)
    const form = new FormData()
    form.append('file', file)
    form.append('document_kind', 'record')
    if (label.trim()) form.append('document_label', label.trim())
    try {
      const res = await apiUpload(`/patients/${patientId}/documents`, form)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setLabel('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      loadDocs()
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (docId) => {
    if (!confirm('Delete this file?')) return
    await apiFetch(`/patients/${patientId}/documents/${docId}`, { method: 'DELETE' })
    loadDocs()
  }

  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Record Files ({docs.length})</h3>
        <p className="text-xs text-gray-400 mt-0.5">Store consent forms, releases, handouts, and other supporting files without changing the clinical profile.</p>
      </div>
      <div className="px-4 py-3 border-b border-gray-50 space-y-2">
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="Label (e.g. Consent Form, ROI, Safety Plan)"
          className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
        <label className={`flex items-center gap-2 cursor-pointer w-full justify-center px-3 py-2 rounded-lg border-2 border-solid text-xs font-medium transition-colors ${uploading ? 'border-gray-200 text-gray-400 cursor-not-allowed' : 'border-brand-300 text-brand-600 hover:bg-brand-50'}`}>
          {uploading ? 'Uploading…' : 'Upload Record File'}
          <input ref={fileInputRef} type="file" className="hidden" disabled={uploading} accept=".pdf,.docx,.doc,.txt,.png,.jpg,.jpeg,.webp" onChange={handleUpload} />
        </label>
        {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
      </div>
      {docs.length === 0 ? (
        <div className="p-4 text-center text-xs text-gray-400">No record files uploaded yet</div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {docs.map(doc => (
            <li key={doc.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 group">
              <span className="text-lg">{fileTypeIcon(doc.file_type)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-800 truncate">{doc.document_label || doc.original_name}</div>
                {doc.document_label && <div className="text-xs text-gray-400 truncate">{doc.original_name}</div>}
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-400">{doc.file_type}</span>
                  {!doc.is_image && <span className="text-xs text-teal-600">✓ AI readable</span>}
                  {doc.is_image && <span className="text-xs text-amber-500">Image</span>}
                </div>
              </div>
              <button onClick={() => handleDelete(doc.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-all" title="Delete document">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TrendArrow({ trend, baseline, current }) {
  const dir = current > baseline ? '↑' : current < baseline ? '↓' : '→'
  if (trend === 'IMPROVING') return <span className="text-emerald-600 font-bold text-xs">{dir} Improving</span>
  if (trend === 'WORSENING') return <span className="text-red-600 font-bold text-xs">{dir} Worsening</span>
  if (trend === 'STABLE') return <span className="text-amber-600 font-bold text-xs">→ Stable</span>
  return <span className="text-gray-400 text-xs">—</span>
}

function ProgressTooltip({ active, payload, label }) {
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

const SOUL_COLORS = ['#6366F1', '#7C3AED', '#0D9488', '#D97706', '#DC2626', '#2563EB', '#DB2777']
const TEMPLATE_LABELS = {
  'phq-9': 'PHQ-9', 'gad-7': 'GAD-7', 'pcl-5': 'PCL-5', 'cssrs': 'C-SSRS',
  'ras': 'RAS', 'das-4': 'DAS-4', 'score-15': 'SCORE-15', 'fad-gf': 'FAD-GF',
}
const INDIVIDUAL_TEMPLATES = ['phq-9', 'gad-7', 'pcl-5', 'cssrs']
const RELATIONAL_TEMPLATES = ['ras', 'das-4', 'score-15', 'fad-gf']

// Assessment Modal for PatientDetail
function PatientAssessmentModal({ patient, onClose, onSubmit }) {
  const members = (() => { try { return patient?.members ? JSON.parse(patient.members) : [] } catch { return [] } })()
  const clientType = patient?.client_type || 'individual'
  const isRelational = clientType !== 'individual' && members.length > 0

  const [templateType, setTemplateType] = useState(isRelational ? 'ras' : 'phq-9')
  const [templates, setTemplates] = useState({})
  const [responses, setResponses] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [notes, setNotes] = useState('')
  const [worstEvent, setWorstEvent] = useState('') // PCL-5 "worst event" field
  const [memberLabel, setMemberLabel] = useState(isRelational ? members[0] : '')

  useEffect(() => {
    fetch(`${API_BASE}/assessments/templates`, { credentials: 'include' })
      .then(r => r.json()).then(data => {
        const map = {}
        data.forEach(t => { map[t.id] = t })
        setTemplates(map)
      }).catch(() => {})
  }, [])

  const template = templates[templateType]
  const answeredCount = Object.keys(responses).length
  const totalQuestions = template?.questions.length || 0
  const totalScore = template
    ? template.questions.reduce((sum, _, i) => sum + (responses[i]?.value ?? 0), 0) : 0

  async function handleSubmit() {
    if (!template) return
    if (!template.questions.every((_, i) => responses[i] !== undefined)) return alert('Please answer all questions.')
    setSubmitting(true)
    const orderedResponses = template.questions.map((q, i) => ({ questionId: q.id, value: responses[i].value }))
    // Combine worst event + clinician notes for PCL-5
    const combinedNotes = templateType === 'pcl-5' && worstEvent.trim()
      ? `Worst event: ${worstEvent.trim()}${notes.trim() ? '\n' + notes.trim() : ''}`
      : notes
    try {
      const res = await fetch(`${API_BASE}/assessments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patient.id, template_type: templateType,
          responses: orderedResponses, notes: combinedNotes,
          member_label: memberLabel || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSubmit(data)
    } catch (err) { alert('Error: ' + err.message) }
    finally { setSubmitting(false) }
  }

  const TemplatePicker = ({ ids }) => (
    <div className="flex gap-2 flex-wrap">
      {ids.map(t => (
        <button key={t} onClick={() => { setTemplateType(t); setResponses({}) }}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${templateType === t ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}>
          {TEMPLATE_LABELS[t] || t.toUpperCase()}
        </button>
      ))}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Administer Assessment</h2>
            <p className="text-sm text-gray-500">Client: {patient?.client_id}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Soul picker — couple / family only */}
        {isRelational && (
          <div className="px-6 pt-3 pb-0">
            <p className="text-xs font-semibold text-gray-500 mb-1.5">Who is completing this?</p>
            <div className="flex gap-2 flex-wrap">
              {members.map((m, i) => (
                <button key={m} onClick={() => setMemberLabel(m)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${memberLabel === m ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}
                  style={memberLabel === m ? { background: SOUL_COLORS[i % SOUL_COLORS.length] } : {}}>
                  {m}
                </button>
              ))}
              <button onClick={() => setMemberLabel('whole-unit')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${memberLabel === 'whole-unit' ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                Whole {clientType === 'couple' ? 'Couple' : 'Family'}
              </button>
            </div>
          </div>
        )}

        {/* Template pickers */}
        <div className="px-6 pt-3 pb-1 space-y-2">
          {isRelational && (
            <>
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  {clientType === 'couple' ? 'Couple' : 'Family'} Instruments
                </p>
                <TemplatePicker ids={RELATIONAL_TEMPLATES} />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Individual Screeners</p>
                <TemplatePicker ids={INDIVIDUAL_TEMPLATES} />
              </div>
            </>
          )}
          {!isRelational && <TemplatePicker ids={INDIVIDUAL_TEMPLATES} />}
        </div>

        {template && (
          <>
            <div className="px-6 py-2">
              <p className="text-xs text-indigo-700 font-medium bg-indigo-50 rounded-lg px-3 py-2">{template.instructions}</p>
              {template.description && <p className="text-xs text-gray-400 mt-1">{template.description}</p>}
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-2 space-y-4">
              {/* PCL-5 worst event field */}
              {templateType === 'pcl-5' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <label className="block text-xs font-semibold text-amber-800 mb-1.5">
                    Worst event (optional)
                  </label>
                  <p className="text-xs text-amber-600 mb-2">
                    Briefly describe the type of traumatic event (e.g. "motor vehicle accident", "interpersonal violence") — do not include names, dates, or identifying details.
                  </p>
                  <input
                    type="text"
                    value={worstEvent}
                    onChange={e => setWorstEvent(e.target.value)}
                    placeholder="e.g. workplace accident, assault, natural disaster…"
                    className="w-full text-sm border border-amber-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-amber-400"
                    maxLength={200}
                  />
                </div>
              )}
              {template.questions.map((q, i) => (
                <div key={q.id} className={`rounded-xl border p-4 transition-all ${responses[i] !== undefined ? 'border-indigo-200 bg-indigo-50/40' : 'border-gray-200 bg-white'}`}>
                  <p className="text-sm font-medium text-gray-800 mb-3">
                    <span className="text-indigo-400 font-bold mr-2">{i + 1}.</span>{q.text}
                  </p>
                  <div className={templateType === 'cssrs' ? 'grid grid-cols-2 gap-2' : template.options.length <= 4 ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-1.5'}>
                    {template.options.map(opt => (
                      <button key={opt.value} onClick={() => setResponses(prev => ({ ...prev, [i]: { index: i, value: opt.value } }))}
                        className={`text-left px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                          responses[i]?.value === opt.value
                            ? templateType === 'cssrs' && opt.value === 1 ? 'bg-red-600 text-white border-red-600' : 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                        }`}>
                        {templateType === 'cssrs' ? <span className="font-bold">{opt.label}</span> : <><span className="font-bold mr-1">{opt.value}</span> — {opt.label}</>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Clinician Notes (optional)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Clinical observations…"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-indigo-400" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                {isRelational && memberLabel && (
                  <span className="font-semibold mr-3" style={{ color: SOUL_COLORS[members.indexOf(memberLabel) % SOUL_COLORS.length] || '#374151' }}>
                    {memberLabel}
                  </span>
                )}
                <span className="font-semibold text-gray-900">{answeredCount}/{totalQuestions}</span> answered
                {answeredCount > 0 && <span className="ml-3 font-semibold text-indigo-700">Score: {totalScore}</span>}
              </div>
              <button onClick={handleSubmit} disabled={submitting || answeredCount < totalQuestions}
                className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all ${answeredCount === totalQuestions && !submitting ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                {submitting ? 'Submitting…' : 'Submit Assessment'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function AssessmentLinkModal({ patient, onClose }) {
  const members = (() => { try { return patient?.members ? JSON.parse(patient.members) : [] } catch { return [] } })()
  const clientType = patient?.client_type || 'individual'
  const isRelational = clientType !== 'individual' && members.length > 0

  const [templates, setTemplates] = useState({})
  const [templateType, setTemplateType] = useState(isRelational ? 'ras' : 'phq-9')
  const [memberLabel, setMemberLabel] = useState(isRelational ? members[0] : '')
  const [expiresDays, setExpiresDays] = useState(7)
  const [generating, setGenerating] = useState(false)
  const [loadingLinks, setLoadingLinks] = useState(true)
  const [error, setError] = useState('')
  const [generatedUrl, setGeneratedUrl] = useState('')
  const [activeLinks, setActiveLinks] = useState([])
  const [copied, setCopied] = useState('')

  const templateIds = isRelational ? [...RELATIONAL_TEMPLATES, ...INDIVIDUAL_TEMPLATES] : INDIVIDUAL_TEMPLATES

  const loadLinks = useCallback(async () => {
    setLoadingLinks(true)
    try {
      const [templatesRes, linksRes] = await Promise.all([
        fetch(`${API_BASE}/assessments/templates`, { credentials: 'include' }),
        apiFetch(`/assessments/links?patient_id=${patient.id}`),
      ])

      const templatesData = await templatesRes.json()
      const templateMap = {}
      templatesData.forEach(t => { templateMap[t.id] = t })
      setTemplates(templateMap)

      const linksData = await linksRes.json()
      if (Array.isArray(linksData)) setActiveLinks(linksData)
    } catch {
      // keep modal usable even if list loading fails
    } finally {
      setLoadingLinks(false)
    }
  }, [patient.id])

  useEffect(() => { loadLinks() }, [loadLinks])

  const template = templates[templateType]

  async function handleCreateLink() {
    setError('')
    setGenerating(true)
    try {
      const res = await apiFetch('/assessments/links', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: patient.id,
          template_type: templateType,
          member_label: memberLabel || null,
          expires_days: expiresDays,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unable to create link.')
      setGeneratedUrl(data.url)
      await loadLinks()
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      setTimeout(() => setCopied(''), 1800)
    } catch {
      setError('Could not copy the link to clipboard.')
    }
  }

  const activeMemberLabel = isRelational ? memberLabel || members[0] : ''

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-3xl max-h-[92vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Send assessment link</h2>
            <p className="text-sm text-gray-500">Client: {patient?.client_id}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm text-teal-800">
            <p className="font-semibold mb-1">Client phone assessment link</p>
            <p>Miwa will save the completed assessment to this patient’s chart automatically when the client submits it.</p>
          </div>

          {isRelational && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">Who is this for?</p>
              <div className="flex gap-2 flex-wrap">
                {members.map((m, i) => (
                  <button key={m} onClick={() => setMemberLabel(m)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${memberLabel === m ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}
                    style={memberLabel === m ? { background: SOUL_COLORS[i % SOUL_COLORS.length] } : {}}>
                    {m}
                  </button>
                ))}
                <button onClick={() => setMemberLabel('whole-unit')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${memberLabel === 'whole-unit' ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                  Whole {clientType === 'couple' ? 'Couple' : 'Family'}
                </button>
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Assessment type</p>
            <div className="flex gap-2 flex-wrap">
              {templateIds.map(t => (
                <button key={t} onClick={() => setTemplateType(t)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${templateType === t ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}>
                  {TEMPLATE_LABELS[t] || t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Expires in</p>
            <div className="flex gap-2 flex-wrap">
              {[3, 7, 14].map(days => (
                <button key={days} onClick={() => setExpiresDays(days)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${expiresDays === days ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                  {days} days
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {generatedUrl && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Share this link</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={generatedUrl}
                  className="flex-1 min-w-0 text-xs bg-white border border-emerald-200 rounded-lg px-3 py-2 text-gray-700"
                />
                <button
                  onClick={() => copyUrl(generatedUrl)}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {copied === generatedUrl ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-emerald-700">Send this to the client on their phone. When they finish it, the result updates the chart automatically.</p>
            </div>
          )}

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Preview</p>
            <p className="text-sm text-gray-800 font-medium">{template?.name || TEMPLATE_LABELS[templateType] || templateType}</p>
            <p className="text-xs text-gray-500 mt-1">
              {template?.instructions || 'Loading assessment details…'}
              {activeMemberLabel ? ` Assigned to ${activeMemberLabel}.` : ''}
            </p>
          </div>

          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-gray-500">You can keep multiple links active for the same patient.</p>
            <button
              onClick={handleCreateLink}
              disabled={generating}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:text-gray-500"
            >
              {generating ? 'Creating…' : 'Create link'}
            </button>
          </div>

          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Active links</p>
              {loadingLinks && <span className="text-[11px] text-gray-400">Loading…</span>}
            </div>
            <div className="space-y-2">
              {activeLinks.length === 0 && !loadingLinks ? (
                <p className="text-sm text-gray-500">No links created yet.</p>
              ) : activeLinks.map(link => {
                const expired = new Date(link.expires_at) < new Date()
                const completed = !!link.completed_at
                const publicUrl = `${window.location.origin}/assess/${link.token}`
                return (
                  <div key={link.token} className="rounded-xl border border-gray-200 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">{TEMPLATE_LABELS[link.template_type] || link.template_type}</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${completed ? 'bg-emerald-100 text-emerald-700' : expired ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}`}>
                          {completed ? 'completed' : expired ? 'expired' : 'active'}
                        </span>
                        {link.member_label && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-600">
                            {link.member_label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Expires {formatDate(link.expires_at)}{link.completed_at ? ` · completed ${formatDate(link.completed_at)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!completed && (
                        <button
                          onClick={() => copyUrl(publicUrl)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
                        >
                          {copied === publicUrl ? 'Copied' : 'Copy'}
                        </button>
                      )}
                      {!completed && (
                        <button
                          onClick={async () => {
                            await apiFetch(`/assessments/links/${link.token}`, { method: 'DELETE' })
                            await loadLinks()
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-100"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Between-Session Check-in Modal ───────────────────────────────────────────
function CheckinSendModal({ patient, onClose }) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(null) // { url, sms_sent }
  const [error, setError] = useState('')
  const hasPhone = !!patient?.phone

  const handleSend = async () => {
    setSending(true)
    setError('')
    try {
      const res = await apiFetch('/assessments/checkin', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: patient.id,
          message: message.trim() || undefined,
          send_now: hasPhone,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send')
      setDone(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Send Check-in</h2>
            <p className="text-xs text-gray-500">{patient?.display_name || patient?.client_id}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {!done ? (
            <>
              <div className={`rounded-xl p-3 text-xs ${hasPhone ? 'bg-teal-50 text-teal-800 border border-teal-100' : 'bg-amber-50 text-amber-800 border border-amber-100'}`}>
                {hasPhone
                  ? `An SMS with a mood check-in link will be sent to ${patient.phone}.`
                  : 'This client has no phone number on file. A check-in link will be generated — copy and share it manually.'}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                  Message <span className="normal-case font-normal text-gray-400">(optional — defaults to standard message)</span>
                </label>
                <textarea
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-400/40 resize-none"
                  rows={3}
                  placeholder="Hi, checking in — how have you been feeling since our last session? Click the link to share a quick update."
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  maxLength={300}
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                  Cancel
                </button>
                <button onClick={handleSend} disabled={sending}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #0ac5a2, #5746ed)' }}>
                  {sending ? 'Sending…' : hasPhone ? 'Send SMS' : 'Generate Link'}
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(10,197,162,0.08)', border: '1px solid rgba(10,197,162,0.2)' }}>
                <p className="text-sm font-bold text-teal-700 mb-1">
                  {done.sms_sent ? '✓ SMS sent!' : '✓ Check-in link created'}
                </p>
                <p className="text-xs text-teal-600">
                  {done.sms_sent
                    ? 'The client will receive an SMS with a mood check-in link.'
                    : 'Copy the link below to share with your client.'}
                </p>
              </div>

              {!done.sms_sent && done.url && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Check-in Link</label>
                  <div className="flex gap-2">
                    <input readOnly value={done.url}
                      className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 bg-gray-50 font-mono" />
                    <button onClick={() => navigator.clipboard.writeText(done.url)}
                      className="px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors flex-shrink-0">
                      Copy
                    </button>
                  </div>
                </div>
              )}

              <button onClick={onClose}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Full Outcome Progress Card for PatientDetail
function OutcomeProgressCard({ patientId, patient }) {
  const [progress, setProgress] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [showCheckinModal, setShowCheckinModal] = useState(false)
  const [checkins, setCheckins] = useState([])

  const loadCheckins = useCallback(() => {
    if (!patientId) return
    apiFetch(`/assessments/checkin?patient_id=${patientId}`)
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setCheckins(d) }).catch(() => {})
  }, [patientId])

  useEffect(() => { loadCheckins() }, [loadCheckins])

  const clientType = patient?.client_type || 'individual'
  const members = (() => { try { return patient?.members ? JSON.parse(patient.members) : [] } catch { return [] } })()
  const isRelational = clientType !== 'individual' && members.length > 0

  const loadProgress = useCallback(() => {
    if (!patientId) return
    setLoading(true)
    fetch(`${API_BASE}/assessments/progress/${patientId}`, { credentials: 'include' })
      .then(r => r.json()).then(d => {
        if (d && !d.error) setProgress(d)
        setLoading(false)
      }).catch(() => setLoading(false))
  }, [patientId])

  useEffect(() => { loadProgress() }, [loadProgress])

  // Build merged chart data for a given instrument across all souls
  const buildSoulChartData = (byMember, templateType) => {
    const souls = Object.keys(byMember).filter(m => byMember[m][templateType])
    const allDates = new Set()
    for (const soul of souls) {
      for (const { date } of (byMember[soul][templateType]?.timeline || [])) allDates.add(date)
    }
    return [...allDates].sort().map(date => {
      const point = { date }
      for (const soul of souls) {
        const dayData = byMember[soul][templateType]?.timeline?.find(d => d.date === date)
        point[soul] = dayData?.score ?? null
      }
      return point
    })
  }

  // All instrument types present in byMember data
  const soulInstruments = progress?.byMember
    ? [...new Set(Object.values(progress.byMember).flatMap(types => Object.keys(types)))]
    : []

  if (loading) return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Outcome Progress</p>
      <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
        <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
        Loading…
      </div>
    </div>
  )

  if (!progress || progress.totalAssessments === 0) return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Outcome Progress</p>
      <div className="bg-gray-50 rounded-xl border border-solid border-gray-200 p-4 text-center">
        <p className="text-xs text-gray-500 mb-2">No assessments administered yet</p>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <button onClick={() => setShowModal(true)}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors">
            + Administer Assessment
          </button>
          <button onClick={() => setShowLinkModal(true)}
            className="text-xs px-3 py-1.5 bg-white text-indigo-700 border border-indigo-200 rounded-lg font-semibold hover:bg-indigo-50 transition-colors">
            + Send Link
          </button>
          <button onClick={() => setShowCheckinModal(true)}
            className="text-xs px-3 py-1.5 bg-white text-teal-700 border border-teal-200 rounded-lg font-semibold hover:bg-teal-50 transition-colors">
            + Check-in SMS
          </button>
        </div>
      </div>
      {showModal && patient && (
        <PatientAssessmentModal patient={patient} onClose={() => setShowModal(false)} onSubmit={() => { setShowModal(false); loadProgress() }} />
      )}
      {showLinkModal && patient && (
        <AssessmentLinkModal patient={patient} onClose={() => setShowLinkModal(false)} />
      )}
      {showCheckinModal && patient && (
        <CheckinSendModal patient={patient} onClose={() => { setShowCheckinModal(false); loadCheckins() }} />
      )}
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Link
          to={`/outcomes?patient=${patientId}&tab=client`}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 hover:border-indigo-400 transition-all uppercase tracking-wide"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Outcome Progress
          <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </Link>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowModal(true)}
            className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors">
            + Assess
          </button>
          <button onClick={() => setShowLinkModal(true)}
            className="text-xs px-2.5 py-1 bg-white text-indigo-700 border border-indigo-200 rounded-lg font-semibold hover:bg-indigo-50 transition-colors">
            Link
          </button>
          <button onClick={() => setShowCheckinModal(true)}
            className="text-xs px-2.5 py-1 bg-white text-teal-700 border border-teal-200 rounded-lg font-semibold hover:bg-teal-50 transition-colors">
            Check-in
          </button>
          <button onClick={() => setExpanded(e => !e)}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
            {expanded ? 'Collapse ↑' : 'View Charts ↓'}
          </button>
        </div>
      </div>

      {/* ── Individual view: PHQ-9 + GAD-7 summary ── */}
      {!isRelational && (
        <div className="space-y-1.5">
          {progress.phq9.current !== null && (
            <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
              <div>
                <span className="text-xs font-semibold text-gray-500">PHQ-9</span>
                {progress.phq9.baseline !== null && progress.phq9.baseline !== progress.phq9.current && (
                  <span className="text-xs text-gray-400 ml-1">({progress.phq9.baseline}→{progress.phq9.current})</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <TrendArrow trend={progress.phq9.trend} baseline={progress.phq9.baseline} current={progress.phq9.current} />
                <span className="text-sm font-bold text-gray-900">{progress.phq9.current}</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full text-white font-semibold" style={{ background: progress.phq9.color || '#6B7280' }}>
                  {progress.phq9.severity}
                </span>
              </div>
            </div>
          )}
          {progress.gad7.current !== null && (
            <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
              <div>
                <span className="text-xs font-semibold text-gray-500">GAD-7</span>
                {progress.gad7.baseline !== null && progress.gad7.baseline !== progress.gad7.current && (
                  <span className="text-xs text-gray-400 ml-1">({progress.gad7.baseline}→{progress.gad7.current})</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <TrendArrow trend={progress.gad7.trend} baseline={progress.gad7.baseline} current={progress.gad7.current} />
                <span className="text-sm font-bold text-gray-900">{progress.gad7.current}</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full text-white font-semibold" style={{ background: progress.gad7.color || '#6B7280' }}>
                  {progress.gad7.severity}
                </span>
              </div>
            </div>
          )}
          {progress.pcl5?.current !== null && progress.pcl5?.current !== undefined && (
            <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
              <div>
                <span className="text-xs font-semibold text-gray-500">PCL-5</span>
                {progress.pcl5.baseline !== null && progress.pcl5.baseline !== progress.pcl5.current && (
                  <span className="text-xs text-gray-400 ml-1">({progress.pcl5.baseline}→{progress.pcl5.current})</span>
                )}
                {progress.pcl5.provisionalPtsd && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-bold border border-orange-200">≥33 PTSD</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <TrendArrow trend={progress.pcl5.trend} baseline={progress.pcl5.baseline} current={progress.pcl5.current} />
                <span className="text-sm font-bold text-gray-900">{progress.pcl5.current}</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full text-white font-semibold" style={{ background: progress.pcl5.color || '#6B7280' }}>
                  {progress.pcl5.severity}
                </span>
              </div>
            </div>
          )}
          <p className="text-xs text-gray-400">{progress.totalAssessments} assessment{progress.totalAssessments !== 1 ? 's' : ''} on record</p>
        </div>
      )}

      {/* ── Relational view: per-soul summaries ── */}
      {isRelational && progress.byMember && (
        <div className="space-y-2">
          {soulInstruments.map(instrument => (
            <div key={instrument} className="rounded-xl border border-gray-100 overflow-hidden">
              <div className="bg-gray-50 px-3 py-1.5">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{TEMPLATE_LABELS[instrument] || instrument}</span>
              </div>
              <div className="divide-y divide-gray-50">
                {Object.entries(progress.byMember)
                  .filter(([, types]) => types[instrument])
                  .map(([soul, types], i) => {
                    const d = types[instrument]
                    return (
                      <div key={soul} className="flex items-center justify-between px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SOUL_COLORS[i % SOUL_COLORS.length] }} />
                          <span className="text-xs font-semibold text-gray-700">{soul}</span>
                          {d.baseline !== null && d.baseline !== d.current && (
                            <span className="text-xs text-gray-400">({d.baseline}→{d.current})</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <TrendArrow trend={d.trend} baseline={d.baseline} current={d.current} />
                          <span className="text-sm font-bold text-gray-900">{d.current}</span>
                          {d.severity && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-semibold" style={{ background: d.color || '#6B7280' }}>
                              {d.severity}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          ))}
          <p className="text-xs text-gray-400">{progress.totalAssessments} assessment{progress.totalAssessments !== 1 ? 's' : ''} on record</p>
        </div>
      )}

      {/* ── Expanded: charts ── */}
      {expanded && (
        <div className="mt-4 space-y-4">

          {/* Individual: PHQ-9 + GAD-7 dual-line chart */}
          {!isRelational && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {progress.phq9.count > 0 && (
                  <div className="bg-indigo-50 rounded-xl p-3">
                    <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide">PHQ-9 Change</p>
                    <p className={`text-lg font-bold mt-0.5 ${progress.phq9.current < progress.phq9.baseline ? 'text-emerald-600' : progress.phq9.current > progress.phq9.baseline ? 'text-red-600' : 'text-gray-700'}`}>
                      {progress.phq9.current < progress.phq9.baseline ? '↓' : progress.phq9.current > progress.phq9.baseline ? '↑' : '→'} {Math.abs((progress.phq9.current || 0) - (progress.phq9.baseline || 0))} pts
                    </p>
                    <p className="text-[10px] text-indigo-400 mt-0.5">{progress.phq9.count} assessments</p>
                  </div>
                )}
                {progress.gad7.count > 0 && (
                  <div className="bg-violet-50 rounded-xl p-3">
                    <p className="text-[10px] font-semibold text-violet-500 uppercase tracking-wide">GAD-7 Change</p>
                    <p className={`text-lg font-bold mt-0.5 ${progress.gad7.current < progress.gad7.baseline ? 'text-emerald-600' : progress.gad7.current > progress.gad7.baseline ? 'text-red-600' : 'text-gray-700'}`}>
                      {progress.gad7.current < progress.gad7.baseline ? '↓' : progress.gad7.current > progress.gad7.baseline ? '↑' : '→'} {Math.abs((progress.gad7.current || 0) - (progress.gad7.baseline || 0))} pts
                    </p>
                    <p className="text-[10px] text-violet-400 mt-0.5">{progress.gad7.count} assessments</p>
                  </div>
                )}
                {progress.pcl5?.count > 0 && (
                  <div className="bg-orange-50 rounded-xl p-3">
                    <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wide">PCL-5 Change</p>
                    <p className={`text-lg font-bold mt-0.5 ${progress.pcl5.current < progress.pcl5.baseline ? 'text-emerald-600' : progress.pcl5.current > progress.pcl5.baseline ? 'text-red-600' : 'text-gray-700'}`}>
                      {progress.pcl5.current < progress.pcl5.baseline ? '↓' : progress.pcl5.current > progress.pcl5.baseline ? '↑' : '→'} {Math.abs((progress.pcl5.current || 0) - (progress.pcl5.baseline || 0))} pts
                    </p>
                    {progress.pcl5.provisionalPtsd && <p className="text-[10px] text-orange-600 font-bold mt-0.5">≥33 Provisional PTSD</p>}
                    <p className="text-[10px] text-orange-400 mt-0.5">{progress.pcl5.count} assessments</p>
                  </div>
                )}
              </div>

              {/* PHQ-9 + GAD-7 dual-line timeline chart */}
              {(progress.phq9.count > 0 || progress.gad7.count > 0) && progress.timeline?.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Depression &amp; Anxiety Timeline</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={progress.timeline} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <ReferenceArea y1={0}  y2={4}  fill="#10B981" fillOpacity={0.06} />
                      <ReferenceArea y1={5}  y2={9}  fill="#F59E0B" fillOpacity={0.06} />
                      <ReferenceArea y1={10} y2={14} fill="#F97316" fillOpacity={0.06} />
                      <ReferenceArea y1={15} y2={27} fill="#EF4444" fillOpacity={0.06} />
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} tickLine={false} />
                      <YAxis domain={[0, 27]} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                      <Tooltip content={<ProgressTooltip />} />
                      <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }} />
                      <ReferenceLine y={10} stroke="#6366F1" strokeDasharray="4 3" strokeWidth={1} />
                      {progress.phq9.count > 0 && (
                        <Line type="monotone" dataKey="phq9" stroke="#6366F1" strokeWidth={2.5}
                          dot={{ fill: '#6366F1', r: 4, strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }}
                          name="PHQ-9" connectNulls={false} />
                      )}
                      {progress.gad7.count > 0 && (
                        <Line type="monotone" dataKey="gad7" stroke="#8B5CF6" strokeWidth={2.5}
                          dot={{ fill: '#8B5CF6', r: 4, strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }}
                          name="GAD-7" connectNulls={false} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* PCL-5 standalone chart (separate scale: 0-80) */}
              {progress.pcl5?.count > 1 && progress.timeline?.some(t => t.pcl5 !== undefined) && (
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">PCL-5 PTSD Symptom Timeline</p>
                    <span className="text-[10px] text-orange-600 font-semibold bg-orange-50 px-2 py-0.5 rounded-full border border-orange-100">Threshold ≥33</span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={progress.timeline.filter(t => t.pcl5 !== undefined)} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <ReferenceArea y1={0}  y2={31} fill="#10B981" fillOpacity={0.05} />
                      <ReferenceArea y1={32} y2={44} fill="#F59E0B" fillOpacity={0.05} />
                      <ReferenceArea y1={45} y2={59} fill="#F97316" fillOpacity={0.05} />
                      <ReferenceArea y1={60} y2={80} fill="#EF4444" fillOpacity={0.05} />
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} tickLine={false} />
                      <YAxis domain={[0, 80]} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                      <Tooltip content={<ProgressTooltip />} />
                      <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }} />
                      <ReferenceLine y={33} stroke="#EA580C" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: 'PTSD threshold', position: 'insideTopRight', fontSize: 8, fill: '#EA580C' }} />
                      <Line type="monotone" dataKey="pcl5" stroke="#EA580C" strokeWidth={2.5}
                        dot={{ fill: '#EA580C', r: 4, strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }}
                        name="PCL-5" connectNulls={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  {/* DSM-5 cluster breakdown from latest assessment */}
                  {progress.pcl5.clusters && (
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {[
                        { label: 'B — Intrusion', val: progress.pcl5.clusters.B, max: 20, color: '#6366F1' },
                        { label: 'C — Avoidance', val: progress.pcl5.clusters.C, max: 8,  color: '#8B5CF6' },
                        { label: 'D — Neg. Cog.', val: progress.pcl5.clusters.D, max: 28, color: '#EC4899' },
                        { label: 'E — Arousal',   val: progress.pcl5.clusters.E, max: 24, color: '#EA580C' },
                      ].map(({ label, val, max, color }) => (
                        <div key={label} className="bg-gray-50 rounded-xl p-2 text-center">
                          <p className="text-[9px] font-semibold text-gray-500 leading-tight mb-1">{label}</p>
                          <p className="text-base font-bold" style={{ color }}>{val}</p>
                          <p className="text-[9px] text-gray-400">/{max}</p>
                          <div className="mt-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.round((val / max) * 100)}%`, background: color }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Relational: one chart per instrument type */}
          {isRelational && progress.byMember && soulInstruments.map(instrument => {
            const chartData = buildSoulChartData(progress.byMember, instrument)
            const soulsWithData = Object.keys(progress.byMember).filter(m => progress.byMember[m][instrument])
            if (chartData.length < 2) return null
            return (
              <div key={instrument} className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  {TEMPLATE_LABELS[instrument] || instrument} — Soul Comparison
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }} />
                    {soulsWithData.map((soul, i) => (
                      <Line key={soul} type="monotone" dataKey={soul}
                        stroke={SOUL_COLORS[i % SOUL_COLORS.length]} strokeWidth={2.5}
                        dot={{ fill: SOUL_COLORS[i % SOUL_COLORS.length], r: 4, strokeWidth: 2, stroke: '#fff' }}
                        activeDot={{ r: 6 }} name={soul} connectNulls={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                {/* Soul legend with color dots */}
                <div className="flex flex-wrap gap-3 mt-2 pt-2 border-t border-gray-50">
                  {soulsWithData.map((soul, i) => {
                    const d = progress.byMember[soul][instrument]
                    return (
                      <div key={soul} className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: SOUL_COLORS[i % SOUL_COLORS.length] }} />
                        <span className="text-[10px] text-gray-600 font-medium">{soul}</span>
                        <span className="text-[10px] text-gray-400">{d.current ?? '—'}</span>
                        {d.severity && (
                          <span className="text-[10px] px-1 py-0.5 rounded text-white font-semibold" style={{ background: d.color || '#6B7280' }}>
                            {d.severity}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showModal && patient && (
        <PatientAssessmentModal patient={patient} onClose={() => setShowModal(false)} onSubmit={() => { setShowModal(false); loadProgress() }} />
      )}
      {showLinkModal && patient && (
        <AssessmentLinkModal patient={patient} onClose={() => setShowLinkModal(false)} />
      )}
      {showCheckinModal && patient && (
        <CheckinSendModal patient={patient} onClose={() => { setShowCheckinModal(false); loadCheckins() }} />
      )}

      {/* ── Check-in history strip ── */}
      {checkins.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Between-Session Check-ins</p>
          <div className="space-y-1.5">
            {checkins.slice(0, 5).map(c => (
              <div key={c.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                {c.completed_at ? (
                  <>
                    <span className="text-lg font-bold w-10 text-center flex-shrink-0"
                      style={{ color: c.mood_score <= 4 ? '#ef4444' : c.mood_score <= 6 ? '#eab308' : '#22c55e' }}>
                      {c.mood_score}/10
                    </span>
                    <div className="flex-1 min-w-0">
                      {c.mood_notes && <p className="text-xs text-gray-600 truncate">"{c.mood_notes}"</p>}
                      <p className="text-[11px] text-gray-400">{new Date(c.completed_at).toLocaleDateString()}</p>
                    </div>
                    <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex-shrink-0">Completed</span>
                  </>
                ) : (
                  <>
                    <span className="text-lg text-gray-300 w-10 text-center flex-shrink-0">—</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500 truncate">{c.message?.slice(0, 60)}</p>
                      <p className="text-[11px] text-gray-400">Sent {new Date(c.created_at).toLocaleDateString()}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                      new Date(c.expires_at) < new Date()
                        ? 'text-gray-400 bg-gray-100'
                        : 'text-amber-600 bg-amber-50'
                    }`}>
                      {new Date(c.expires_at) < new Date() ? 'Expired' : 'Pending'}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function PatientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { therapist } = useAuth()
  // ?session_active=<appt_id> is set when the clinician launches a telehealth
  // session from Schedule. We show a session-in-progress banner with a quick
  // path to write the note when they come back.
  const [searchParams, setSearchParams] = useSearchParams()
  const sessionActiveAppt = searchParams.get('session_active')
  const [patient, setPatient] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeSession, setActiveSession] = useState(null)
  const [sessionTab, setSessionTab] = useState('note') // 'note' | 'analysis' | 'plan'
  const [clientSummary, setClientSummary] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summarySignature, setSummarySignature] = useState('')
  const [copied, setCopied] = useState(false)
  const [sessionFilter, setSessionFilter] = useState('all') // 'all' | 'INTAKE' | 'SOAP' | 'BIRP' | 'DAP'
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({})
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [showExportModal, setShowExportModal] = useState(false)
  const [showLetterModal, setShowLetterModal] = useState(false)

  useEffect(() => {
    Promise.all([
      apiFetch(`/patients/${id}`).then(r => r.json()),
      apiFetch(`/patients/${id}/sessions`).then(r => r.json()),
    ]).then(([p, s]) => {
      setPatient(p)
      setClientSummary(p?.client_overview || '')
      setSummarySignature(p?.client_overview_signature || '')
      const sess = Array.isArray(s) ? s : []
      setSessions(sess)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [id])

  const handlePatientUpdated = useCallback((updatedPatient) => {
    if (updatedPatient) {
      setPatient(updatedPatient)
      setClientSummary(updatedPatient.client_overview || '')
      setSummarySignature(updatedPatient.client_overview_signature || '')
    }
  }, [])

  const startEditingProfile = () => {
    const parts = (patient.display_name || '').trim().split(/\s+/)
    setProfileForm({
      first_name: patient.first_name || parts[0] || '',
      last_name: patient.last_name || parts.slice(1).join(' ') || '',
      phone: patient.phone || '',
      sms_consent: !!patient.sms_consent,
      age_range: patient.age_range || '',
      gender: patient.gender || '',
      session_modality: patient.session_modality || 'in-person',
      session_duration: String(patient.session_duration || 50),
    })
    setProfileError('')
    setEditingProfile(true)
  }

  const saveProfileEdits = async () => {
    setProfileSaving(true)
    setProfileError('')
    try {
      const first_name = (profileForm.first_name || '').trim()
      const last_name = (profileForm.last_name || '').trim()
      const display_name = [first_name, last_name].filter(Boolean).join(' ') || null
      const res = await apiFetch(`/patients/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          client_id: patient.client_id,
          first_name: first_name || null,
          last_name: last_name || null,
          display_name,
          phone: profileForm.phone || null,
          sms_consent: profileForm.phone && profileForm.sms_consent ? 1 : 0,
          age_range: profileForm.age_range || null,
          gender: profileForm.gender || null,
          session_modality: profileForm.session_modality || 'in-person',
          session_duration: parseInt(profileForm.session_duration) || 50,
        }),
      })
      const updated = await res.json()
      if (!res.ok) {
        throw new Error(updated?.error || updated?.message || 'Unable to save client profile.')
      }
      setPatient(updated)
      setEditingProfile(false)
    } catch (err) {
      setProfileError(err.message || 'Unable to save client profile.')
    } finally {
      setProfileSaving(false)
    }
  }

  const diagnosisProfile = parseDiagnosisProfile(patient?.diagnoses)
  const getSessionDisplayFormat = (session) => {
    if (!session) return 'SOAP'
    if (session.note_format === 'INTAKE') return 'Intake'
    return session.note_format || 'SOAP'
  }
  const getSessionContentFormat = (session) => {
    if (!session) return 'SOAP'
    if (session.note_format !== 'INTAKE') return session.note_format || 'SOAP'
    try {
      const parsed = session.notes_json ? JSON.parse(session.notes_json) : null
      return parsed?.WORKSPACE?.generatedNoteFormat || 'SOAP'
    } catch {
      return 'SOAP'
    }
  }
  const profileHighlights = [
    patient?.presenting_concerns && ['Presenting Concerns', summarizeProfileText(patient.presenting_concerns, 220)],
    patient?.risk_screening && ['Intake Risk Notes', summarizeProfileText(patient.risk_screening, 200)],
    patient?.mental_health_history && ['History Context', summarizeProfileText(patient.mental_health_history, 220)],
    patient?.strengths_protective_factors && ['Strengths', summarizeProfileText(patient.strengths_protective_factors, 180)],
    patient?.treatment_goals && ['Initial Goals', summarizeProfileText(patient.treatment_goals, 180)],
  ].filter(Boolean)
  const computedSummarySignature = JSON.stringify({
    notes: patient?.notes || '',
    diagnoses: patient?.diagnoses || '',
    presenting: patient?.presenting_concerns || '',
    sessions: sessions.map(s => [s.id, s.updated_at || s.created_at, s.note_format, s.assessment, s.plan]),
  })

  const generateClientSummary = async (pat, sess, { persistSummary = false } = {}) => {
    if (!pat || sess.length === 0) return
    setSummaryLoading(true)
    setClientSummary('')
    try {
      const res = await apiFetch('/ai/client-summary', {
        method: 'POST',
        body: JSON.stringify({ patientId: id, patient: pat, sessions: sess }),
      })
      if (!res.ok) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulatedSummary = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.text) {
              accumulatedSummary += data.text
              setClientSummary(accumulatedSummary)
            }
          } catch {}
        }
      }
      const finalSummary = accumulatedSummary.trim()
      if (persistSummary) {
        const summaryText = finalSummary
        const saveRes = await apiFetch(`/patients/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            client_id: pat.client_id,
            client_overview: summaryText,
            client_overview_signature: computedSummarySignature,
          }),
        })
        const updatedPatient = await saveRes.json()
        if (saveRes.ok) {
          setPatient(updatedPatient)
          setClientSummary(updatedPatient.client_overview || summaryText)
          setSummarySignature(updatedPatient.client_overview_signature || computedSummarySignature)
        }
      }
    } catch {}
    setSummaryLoading(false)
  }


  useEffect(() => {
    if (!patient || sessions.length === 0 || summaryLoading) return
    if (!clientSummary || summarySignature !== computedSummarySignature) {
      generateClientSummary(patient, sessions, { persistSummary: true })
    }
  }, [patient?.id, sessions.length, computedSummarySignature])

  const buildCopyText = useCallback((session) => {
    if (!session) return ''
    const lines = []
    lines.push(`Session Date: ${formatDate(session.session_date)}`)
    if (session.icd10_codes) lines.push(`ICD-10: ${session.icd10_codes}`)
    lines.push('')
    // Prefer notes_json, then legacy fields
    let notesJson = null
    try { notesJson = session.notes_json ? JSON.parse(session.notes_json) : null } catch {}
    const FORMAT_LABEL = { SOAP: { subjective:'Subjective', objective:'Objective', assessment:'Assessment', plan:'Plan' }, BIRP: { subjective:'Behavior', objective:'Intervention', assessment:'Response', plan:'Plan' }, DAP: { subjective:'Data', assessment:'Assessment', plan:'Plan' } }
    if (notesJson) {
      for (const fmt of ['SOAP','BIRP','DAP']) {
        const n = notesJson[fmt] || {}
        if (!Object.values(n).some(v => v && v.trim())) continue
        lines.push(`=== ${fmt} Note ===`)
        for (const [key, label] of Object.entries(FORMAT_LABEL[fmt] || {})) {
          if (n[key]) { lines.push(`${label}:`); lines.push(n[key]); lines.push('') }
        }
      }
    } else {
      const fmt = session.note_format || 'SOAP'
      const labels = FORMAT_LABEL[fmt] || FORMAT_LABEL.SOAP
      lines.push(`=== ${fmt} Note ===`)
      for (const [key, label] of Object.entries(labels)) {
        const val = key === 'subjective' ? session.subjective : key === 'objective' ? session.objective : key === 'assessment' ? session.assessment : session.plan
        if (val) { lines.push(`${label}:`); lines.push(val); lines.push('') }
      }
    }
    return lines.join('\n')
  }, [])

  const handleCopySession = (session) => {
    const text = buildCopyText(session)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  const handleDeleteSession = async (sessionId) => {
    if (!confirm('Delete this session? This cannot be undone.')) return
    await apiFetch(`/patients/${id}/sessions/${sessionId}`, { method: 'DELETE' })
    setSessions(s => s.filter(x => x.id !== sessionId))
    if (activeSession?.id === sessionId) setActiveSession(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!patient || patient.error) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Patient not found.</p>
        <Link to="/patients" className="mt-3 btn-primary inline-flex">Back to Patients</Link>
      </div>
    )
  }

  return (
    <>
    <div className="p-6 max-w-6xl mx-auto">
      {/* Session-in-progress banner — shown when the clinician launched a telehealth
          session from Schedule. Gives them a one-click path to write the note when
          they come back to this tab after ending the Meet. */}
      {sessionActiveAppt && (
        <div className="mb-4 rounded-2xl p-4 flex items-center gap-4 text-white shadow-md"
          style={{ background: 'linear-gradient(135deg, #059669, #0ac5a2)' }}>
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">Session in progress</p>
            <p className="text-xs text-white/90 mt-0.5">
              Your Google Meet is open in another tab. When you end the call, come back here to write the session note.
            </p>
            <p className="text-[11px] text-white/75 mt-1.5 leading-relaxed">
              <strong>Tip:</strong> right-click the Meet video → <em>Picture in Picture</em> to float it on top while you take notes here.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              to={`/patients/${id}/sessions/new`}
              className="text-xs font-bold px-3 py-2 rounded-lg bg-white text-emerald-700 hover:bg-emerald-50 transition-colors whitespace-nowrap"
            >
              Write Note
            </Link>
            <button
              type="button"
              onClick={() => {
                const next = new URLSearchParams(searchParams)
                next.delete('session_active')
                setSearchParams(next, { replace: true })
              }}
              className="text-xs font-semibold px-2 py-2 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
              aria-label="Dismiss session banner"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-3">
        <Link to="/patients" className="hover:text-brand-600 transition-colors">Patients</Link>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-900 font-medium">
          {patient.display_name || patient.client_id}
          {patient.display_name && <span className="text-gray-400 font-mono text-xs ml-1.5">{patient.client_id}</span>}
        </span>
      </nav>

      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Patient Details</h1>
          <p className="text-sm text-gray-500 mt-1">Clinical Profile, Intake Sources, Session History, and Record Files</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLetterModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-100 transition-colors"
            title="Generate a clinical letter from this client's chart"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Generate Letter
          </button>
          <button
            onClick={() => setShowExportModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            title="Export session notes"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Notes
          </button>
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 border border-brand-100 px-3 py-1 text-xs font-semibold">HIPAA-conscious</span>
        </div>
      </div>

      {/* ── Chat with Miwa banner ── */}
      <div
        className="rounded-2xl p-4 mb-5 flex items-center gap-4 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #4a38d9 0%, #1e1857 60%, #059e85 100%)' }}
      >
        <div className="absolute -right-6 -top-6 w-28 h-28 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(45,212,191,0.2) 0%, transparent 70%)' }} />
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)' }}>
          <svg className="w-6 h-6 text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">Chat with Miwa about {patient.display_name || patient.client_id}</p>
          <p className="text-xs text-white/60 mt-0.5">Ask clinical questions, get case conceptualization, or explore treatment options — Miwa reads all session notes and documents for this client.</p>
        </div>
        <button
          onClick={() => navigate('/consult', { state: { contextType: 'patient', contextId: parseInt(id), clientId: patient.client_id } })}
          className="flex-shrink-0 px-4 py-2 text-sm font-semibold rounded-xl transition-all hover:scale-105"
          style={{ background: 'white', color: '#4a38d9', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
        >
          Open Chat →
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Clinical profile + source materials */}
        <div className="space-y-4">
          {/* Clinical Profile */}
          <div className="card overflow-hidden">
            {/* Header with avatar + name inside the gradient — no overlap issues */}
            <div className="px-5 py-4 relative" style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}>
              <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 80% 50%, rgba(255,255,255,0.12), transparent)' }} />
              <div className="relative flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.35)' }}>
                  <span className="text-lg font-bold text-white">
                    {patient.display_name
                      ? patient.display_name.substring(0, 1).toUpperCase()
                      : patient.client_id?.substring(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-bold text-white text-base leading-tight">
                        {patient.display_name || patient.client_id}
                      </div>
                      {patient.display_name && (
                        <div className="text-[10px] font-mono text-white/50">{patient.client_id}</div>
                      )}
                      {patient.client_type && patient.client_type !== 'individual' && (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md"
                          style={{ background: 'rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.9)' }}>
                          {patient.client_type}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-white/70">
                      {[patient.age_range && `Age ${patient.age_range}`, patient.gender].filter(Boolean).join(' · ') || 'Client'}
                      {patient.phone && <span className="ml-1.5 opacity-60">· {patient.phone}</span>}
                    </div>
                  </div>
                <button
                  onClick={startEditingProfile}
                  title="Edit profile"
                  className="flex-shrink-0 p-1.5 rounded-lg hover:bg-white/20 text-white/60 hover:text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="px-5 pb-5 pt-4 space-y-4">

              {/* Top meta row: Case Type + Referral */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Case Type</p>
                  <p className="mt-0.5 text-sm text-gray-800">{patient.case_type || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Referral</p>
                  <p className="mt-0.5 text-sm text-gray-800">{patient.referral_source || '—'}</p>
                </div>
              </div>

              {/* Session preferences row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Modality</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    {patient.session_modality === 'telehealth' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        Telehealth
                      </span>
                    ) : patient.session_modality === 'hybrid' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                        Hybrid
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                        In-person
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Session Length</p>
                  <p className="mt-0.5 text-sm text-gray-800 font-medium">
                    {patient.session_duration ? `${patient.session_duration} min` : '50 min'}
                  </p>
                </div>
              </div>

              {/* Souls — couple / family only */}
              {patient.client_type && patient.client_type !== 'individual' && (() => {
                const souls = (() => { try { return patient.members ? JSON.parse(patient.members) : [] } catch { return [] } })()
                if (!souls.length) return null
                return (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                      {patient.client_type === 'couple' ? 'Couple' : 'Family'} — Souls
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {souls.map((soul, i) => (
                        <span key={soul} className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white"
                          style={{ background: SOUL_COLORS[i % SOUL_COLORS.length] }}>
                          {soul}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Provisional Diagnosis */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Provisional Diagnosis</p>
                {diagnosisProfile.primary ? (
                  <div className="rounded-xl border border-teal-100 bg-teal-50 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-teal-500">Primary</p>
                    <p className="mt-0.5 text-sm font-medium text-teal-800 leading-snug">{diagnosisProfile.primary}</p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">No diagnosis recorded</p>
                )}
                {diagnosisProfile.secondary.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {diagnosisProfile.secondary.map((dx, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-full text-xs font-medium bg-white text-gray-600 border border-gray-200">{dx}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Presenting Concerns — brief 1-liner */}
              {patient.presenting_concerns && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Presenting Concerns</p>
                  <p className="text-sm text-gray-700 leading-snug">{summarizeProfileText(patient.presenting_concerns, 160)}</p>
                </div>
              )}

              {/* Intake Details collapsible — everything else */}
              <details className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
                <summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide list-none flex items-center justify-between select-none hover:bg-gray-100 transition-colors">
                  <span>Intake Details</span>
                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-gray-200">
                  {[
                    ['Living Situation', patient.living_situation],
                    ['Intake Risk Notes', patient.risk_screening],
                    ['Strengths', patient.strengths_protective_factors],
                    ['Initial Goals', patient.treatment_goals],
                    ['Mental Health History', patient.mental_health_history],
                    ['Medical History', patient.medical_history],
                    ['Medications', patient.medications],
                    ['Substance Use', patient.substance_use],
                    ['Family / Social History', patient.family_social_history],
                    ['Trauma History', patient.trauma_history],
                    ['Mental Status', patient.mental_status_observations],
                    ['Functional Impairments', patient.functional_impairments],
                    ['Created', formatDate(patient.created_at)],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
                      <p className="mt-0.5 text-xs text-gray-700 leading-snug">{value}</p>
                    </div>
                  ))}
                </div>
              </details>

              {/* Action buttons */}
              <div className="flex gap-2 pt-1">
                <Link to={`/patients/${id}/sessions/new`} className="btn-primary flex-1 justify-center text-xs">
                  + New Session
                </Link>
                <button
                  onClick={() => navigate('/consult', { state: { contextType: 'patient', contextId: parseInt(id), clientId: patient.client_id } })}
                  className="btn-secondary flex-1 justify-center text-xs"
                >
                  🧠 Ask Miwa
                </button>
              </div>
            </div>{/* end px-5 pb-5 */}
          </div>{/* end card */}

          {/* Session History — immediately after clinical profile */}
          <div className="card">
            <div className="px-4 py-3 border-b border-gray-100 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Session History ({sessions.length})</h3>
              </div>
              {sessions.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {['all', 'INTAKE', 'SOAP', 'BIRP', 'DAP', 'GIRP'].map(f => (
                    <button
                      key={f}
                      onClick={() => setSessionFilter(f)}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                        sessionFilter === f
                          ? 'bg-brand-600 text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {f === 'all' ? 'All' : f}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {sessions.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-xs text-gray-500 mb-3">No sessions recorded yet</p>
                <Link to={`/patients/${id}/sessions/new`} className="btn-primary text-xs">
                  Record First Session
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {sessions.filter(s => {
                  if (sessionFilter === 'all') return true
                  if (sessionFilter === 'INTAKE') return s.note_format === 'INTAKE'
                  // Match direct ongoing sessions OR intake sessions that generated this note format
                  return s.note_format === sessionFilter || getSessionContentFormat(s) === sessionFilter
                }).map((session, idx) => {
                  const sessionDisplayFormat = getSessionDisplayFormat(session)
                  const sessionNum = sessions.length - sessions.indexOf(session) // newest = highest number
                  const hasAnalysis = !!session.ai_feedback
                  const hasPlan = !!session.treatment_plan
                  return (
                    <li
                      key={session.id}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${activeSession?.id === session.id ? 'bg-brand-50' : ''}`}
                      onClick={() => navigate(`/patients/${id}/sessions/${session.id}`)}
                    >
                      <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-teal-700">
                        {sessionNum}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium text-gray-900">{formatDate(session.session_date)}</span>
                          {sessionDisplayFormat && (
                            <span className="text-[10px] font-bold text-brand-400 bg-brand-50 px-1.5 py-0.5 rounded">{sessionDisplayFormat}</span>
                          )}
                          {hasAnalysis && <span className="text-[10px] text-indigo-500" title="Has AI Analysis">🧠</span>}
                          {hasPlan && <span className="text-[10px] text-teal-500" title="Has Treatment Plan">📋</span>}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{session.assessment || 'No assessment recorded'}</div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <IntakeSourcesPanel patientId={id} onPatientUpdated={handlePatientUpdated} />

          <RecordFilesPanel patientId={id} />

          <TreatmentPlanPanel patientId={id} />
        </div>

        {/* Right: Living clinical profile (full when no session selected, compact strip when reading one) + session detail */}
        <div className="lg:col-span-2">
          {activeSession && (
            <ClinicalProfilePanel mode="compact" patientId={id} />
          )}

          {activeSession ? (
            <div className="card overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 180px)' }}>
              {/* Session header */}
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    {getSessionDisplayFormat(activeSession)} — {formatDate(activeSession.session_date)}
                    {activeSession.note_format === 'INTAKE' && (
                      <span className="ml-2 text-xs font-semibold text-brand-500">{getSessionContentFormat(activeSession)} note available</span>
                    )}
                  </h3>
                  {activeSession.icd10_codes && (
                    <p className="text-xs text-teal-600 font-medium mt-0.5">{activeSession.icd10_codes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopySession(activeSession)}
                    className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                    title="Copy session note to clipboard"
                  >
                    {copied
                      ? <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    }
                  </button>
                  <Link to={`/patients/${id}/sessions/${activeSession.id}`} className="btn-secondary text-xs">
                    Edit Session
                  </Link>
                  <button
                    onClick={() => handleDeleteSession(activeSession.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete session"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-100 flex-shrink-0">
                {[
                  { id: 'note',     label: 'Session Note',   dot: !!(activeSession.notes_json || activeSession.subjective) },
                  { id: 'analysis', label: 'AI Analysis',    dot: !!activeSession.ai_feedback },
                  { id: 'plan',     label: 'Treatment Plan', dot: !!activeSession.treatment_plan },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setSessionTab(tab.id)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                      sessionTab === tab.id
                        ? 'text-brand-600 border-brand-600 bg-brand-50/40'
                        : 'text-gray-400 border-transparent hover:text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {tab.label}
                    {tab.dot && <span className={`w-1.5 h-1.5 rounded-full ${sessionTab === tab.id ? 'bg-brand-500' : 'bg-green-400'}`} />}
                  </button>
                ))}
              </div>

              {/* Tab content — scrollable */}
              <div className="flex-1 overflow-y-auto p-5">

                {/* SESSION NOTE TAB */}
                {sessionTab === 'note' && (() => {
                  let notesJson = null
                  try { notesJson = activeSession.notes_json ? JSON.parse(activeSession.notes_json) : null } catch {}

                  // Determine format and note data
                  let fmt = getSessionContentFormat(activeSession)
                  let noteData = null
                  if (notesJson) {
                    const workspaceNote = notesJson.WORKSPACE?.intakeNote
                    if (activeSession.note_format === 'INTAKE' && workspaceNote) {
                      noteData = { subjective: workspaceNote, objective: '', assessment: '', plan: '' }
                    }
                    const filledFmt = ['BIRP', 'SOAP', 'DAP'].find(f => {
                      const n = notesJson[f] || {}
                      return Object.values(n).some(v => v && v.trim())
                    })
                    if (filledFmt) { fmt = filledFmt; noteData = notesJson[filledFmt] }
                  }
                  if (!noteData) {
                    noteData = {
                      subjective: activeSession.subjective,
                      objective:  activeSession.objective,
                      assessment: activeSession.assessment,
                      plan:       activeSession.plan,
                    }
                  }

                  const hasAnyContent = Object.values(noteData).some(v => v && v.trim())
                  if (!hasAnyContent) return <p className="text-sm text-gray-400">No notes recorded for this session.</p>

                  const paragraph = summarizeSessionNote(fmt, noteData)

                  return (
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                          {fmt} Note Summary
                        </p>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {paragraph || 'Session notes recorded — click below to view the full note.'}
                        </p>
                      </div>
                      <Link
                        to={`/patients/${id}/sessions/${activeSession.id}`}
                        className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
                      >
                        View &amp; edit full note →
                      </Link>
                    </div>
                  )
                })()}

                {/* AI ANALYSIS TAB */}
                {sessionTab === 'analysis' && (() => {
                  const summary = summarizeAnalysis(activeSession.ai_feedback)
                  if (!summary) return (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-12 h-12 rounded-full bg-brand-50 border border-brand-100 flex items-center justify-center mb-3">
                        <svg className="w-6 h-6 text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-gray-600 mb-1">No AI Analysis yet</p>
                      <p className="text-xs text-gray-400 mb-4">Open the session and click Generate to create one.</p>
                      <Link to={`/patients/${id}/sessions/${activeSession.id}`} className="btn-secondary text-xs">Open Session →</Link>
                    </div>
                  )
                  return (
                    <div className="space-y-4">
                      {/* ICD-10 code chips */}
                      {summary.codes.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">ICD-10 Codes</p>
                          <div className="flex flex-wrap gap-2">
                            {summary.codes.map(c => (
                              <span key={c} className="px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-100">{c}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Clinical summary snippet — rendered as markdown so
                          **bold**, bullet lists, etc. from the AI display
                          correctly rather than as literal asterisks. */}
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Clinical Summary</p>
                        <div className="prose-clinical text-sm text-gray-700"
                          dangerouslySetInnerHTML={{ __html: renderClinical(summary.snippet || '') }} />
                      </div>
                      <Link to={`/patients/${id}/sessions/${activeSession.id}`} className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium">
                        View full analysis →
                      </Link>
                    </div>
                  )
                })()}

                {/* TREATMENT PLAN TAB */}
                {sessionTab === 'plan' && (() => {
                  const summary = summarizePlan(activeSession.treatment_plan)
                  if (!summary) return (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-12 h-12 rounded-full bg-teal-50 border border-teal-100 flex items-center justify-center mb-3">
                        <svg className="w-6 h-6 text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-gray-600 mb-1">No Treatment Plan yet</p>
                      <p className="text-xs text-gray-400 mb-4">Open the session and click Generate to create one.</p>
                      <Link to={`/patients/${id}/sessions/${activeSession.id}`} className="btn-secondary text-xs">Open Session →</Link>
                    </div>
                  )
                  return (
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Treatment Plan Overview</p>
                        <p className="text-sm text-gray-700 leading-relaxed">{summary}</p>
                      </div>
                      <Link to={`/patients/${id}/sessions/${activeSession.id}`} className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium">
                        View full treatment plan →
                      </Link>
                    </div>
                  )
                })()}

              </div>
            </div>
          ) : (
            // No session selected — show the unified Clinical Profile panel.
            // Diagnosis is intentionally omitted here; it lives once in the
            // left-column profile card and is the single source of truth.
            <ClinicalProfilePanel
              mode="full"
              patientId={id}
              patient={patient}
              sessions={sessions}
              clientSummary={clientSummary}
              summaryLoading={summaryLoading}
              onGenerateSummary={() => generateClientSummary(patient, sessions)}
              newSessionHref={`/patients/${id}/sessions/new`}
            />
          )}
        </div>
      </div>
    </div>

    {/* ── Edit Profile Modal ── */}
    {editingProfile && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">Edit Client Profile</h2>
              <p className="text-xs text-gray-400 mt-0.5 font-mono">{patient.client_id}</p>
            </div>
            <button onClick={() => setEditingProfile(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            {profileError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {profileError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">First Name</label>
                <input
                  autoFocus
                  type="text"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/20 transition-colors"
                  placeholder="First name"
                  value={profileForm.first_name}
                  onChange={e => setProfileForm(f => ({ ...f, first_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Last Name</label>
                <input
                  type="text"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/20 transition-colors"
                  placeholder="Last name"
                  value={profileForm.last_name}
                  onChange={e => setProfileForm(f => ({ ...f, last_name: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Phone Number</label>
              <input
                type="tel"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/20 transition-colors"
                placeholder="+1 (555) 000-0000"
                value={profileForm.phone}
                onChange={e => setProfileForm(f => ({
                  ...f,
                  phone: e.target.value,
                  // Changing the number invalidates a prior consent attestation
                  sms_consent: e.target.value === patient.phone ? f.sms_consent : false,
                }))}
              />
              {profileForm.phone && (
                <label className="mt-2 flex items-start gap-2 p-3 rounded-xl border border-gray-200 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-400"
                    checked={!!profileForm.sms_consent}
                    onChange={e => setProfileForm(f => ({ ...f, sms_consent: e.target.checked }))}
                  />
                  <span className="text-xs text-gray-700 leading-relaxed">
                    I have obtained this client's consent to receive SMS messages from Miwa on my behalf for assessments,
                    check-ins, and appointment-related communication. SMS will be blocked until this is confirmed.
                    {' '}<a href="/sms-policy" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 hover:underline">Learn more</a>
                  </span>
                </label>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Age Range</label>
                <input
                  type="text"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/20 transition-colors"
                  placeholder="e.g. 30-35"
                  value={profileForm.age_range}
                  onChange={e => setProfileForm(f => ({ ...f, age_range: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Gender</label>
                <select
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/20 transition-colors bg-white"
                  value={profileForm.gender}
                  onChange={e => setProfileForm(f => ({ ...f, gender: e.target.value }))}
                >
                  <option value="">Select…</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Transgender">Transgender</option>
                  <option value="Other">Other</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </div>
            </div>

            {/* Session preferences */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Session Modality</label>
              <div className="flex gap-2">
                {[
                  { value: 'in-person', label: 'In-person' },
                  { value: 'telehealth', label: 'Telehealth' },
                  { value: 'hybrid', label: 'Hybrid' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setProfileForm(f => ({ ...f, session_modality: opt.value }))}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                      profileForm.session_modality === opt.value
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Session Length (minutes)</label>
              <div className="flex gap-2">
                {[45, 50, 53, 55, 60, 90].map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setProfileForm(f => ({ ...f, session_duration: String(d) }))}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                      profileForm.session_duration === String(d)
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300'
                    }`}
                  >
                    {d}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
            <button onClick={() => setEditingProfile(false)} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-200 transition-colors">
              Cancel
            </button>
            <button
              onClick={saveProfileEdits}
              disabled={profileSaving}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-60 transition-colors"
            >
              {profileSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Notes Export Modal */}
    <NotesExportModal
      isOpen={showExportModal}
      onClose={() => setShowExportModal(false)}
      sessions={sessions}
      patientName={patient?.display_name || patient?.client_id || 'Patient'}
      therapistName={therapist?.display_name || 'Therapist'}
    />

    {/* Clinical Letter Generator */}
    <LetterGenerator
      isOpen={showLetterModal}
      onClose={() => setShowLetterModal(false)}
      patientId={parseInt(id)}
      patientName={patient?.display_name || patient?.client_id || 'this client'}
    />
    </>
  )
}
