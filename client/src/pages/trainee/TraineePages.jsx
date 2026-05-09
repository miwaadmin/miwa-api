import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { renderClinical } from '../../lib/renderClinical'
import Patients from '../Patients'
import Hours from '../Hours'

const COMPETENCY_LABELS = {
  assessment: 'Assessment',
  diagnosis: 'Diagnosis',
  'treatment planning': 'Treatment planning',
  'risk assessment': 'Risk assessment',
  'cultural humility': 'Cultural humility',
  documentation: 'Documentation',
  'ethics/law': 'Ethics/law',
  'crisis response': 'Crisis response',
  'family systems': 'Family systems',
  'trauma-informed care': 'Trauma-informed care',
  'termination/discharge': 'Termination/discharge',
}

function sitePolicyCopy(status) {
  if (status === 'allows_phi') return null
  if (status === 'no_phi_outside_tools') {
    return 'Use de-identified or minimum-necessary case details here unless your site specifically authorizes PHI in Miwa.'
  }
  return 'Keep case details de-identified until your site authorization is confirmed.'
}

function saveTextFile(filename, text) {
  const blob = new Blob([text || ''], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'miwa-export.txt'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function downloadTraineeExport(type, options = {}) {
  const qs = new URLSearchParams()
  if (options.patient_id) qs.set('patient_id', options.patient_id)
  const res = await apiFetch(`/agent/trainee/exports/${type}${qs.toString() ? `?${qs}` : ''}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Export failed')
  saveTextFile(data.filename, data.text)
  return data
}

function EmptyState({ title, body, to, cta }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
      <h2 className="text-base font-bold text-gray-950">{title}</h2>
      <p className="mt-1 text-sm text-gray-500">{body}</p>
      {to && (
        <Link to={to} className="mt-4 inline-flex rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">
          {cta}
        </Link>
      )}
    </div>
  )
}

function AgencyProfilePanel() {
  const [profile, setProfile] = useState(null)
  useEffect(() => {
    apiFetch('/agent/trainee/agency-profile')
      .then(r => r.ok ? r.json() : null)
      .then(setProfile)
      .catch(() => {})
  }, [])
  if (!profile?.profile) return null
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Agency EHR companion profile</p>
          <h2 className="mt-1 text-lg font-bold text-gray-950">{profile.profile.ehr_name}</h2>
          <p className="mt-1 text-sm text-gray-600">{profile.profile.copyStyle}</p>
        </div>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{profile.profile.preferred_note_format}</span>
      </div>
      {sitePolicyCopy(profile.site_policy_status) && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {sitePolicyCopy(profile.site_policy_status)}
        </div>
      )}
    </section>
  )
}

function EthicalEscalationPanel() {
  const [text, setText] = useState('')
  const [flags, setFlags] = useState([])
  const [scanning, setScanning] = useState(false)
  const scan = async (add = false) => {
    if (!text.trim()) return
    setScanning(true)
    try {
      const res = await apiFetch('/agent/trainee/escalation-scan', {
        method: 'POST',
        body: JSON.stringify({ text, add_to_supervision: add }),
      })
      const data = await res.json()
      if (res.ok) setFlags(data.flags || [])
    } finally {
      setScanning(false)
    }
  }
  return (
    <section className="rounded-2xl border border-red-100 bg-white p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-red-600">Ethical / legal escalation prompts</p>
      <h2 className="mt-1 text-sm font-bold text-gray-950">Scan a note, question, or stuck point</h2>
      <textarea
        className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-red-300 focus:outline-none focus:ring-2 focus:ring-red-100"
        rows={3}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste the clinical question or documentation uncertainty. Miwa will flag SI/HI, mandated reporting, Tarasoff, minors/custody, consent/ROI, scope, and crisis issues."
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={() => scan(false)} disabled={scanning || !text.trim()} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 disabled:opacity-50">Scan</button>
        <button onClick={() => scan(true)} disabled={scanning || !text.trim()} className="rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Scan and add to supervision</button>
      </div>
      {flags.length > 0 && (
        <div className="mt-3 space-y-2">
          {flags.map(flag => (
            <div key={flag.key} className="rounded-xl border border-red-100 bg-red-50 px-3 py-2">
              <div className="text-xs font-bold text-red-800">{flag.label} · {flag.cta}</div>
              <p className="mt-1 text-xs text-red-700">{flag.guidance}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function useTraineeData() {
  const [state, setState] = useState({ loading: true, stats: null, sessions: [], patients: [], hours: null, error: '' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [statsRes, draftsRes, patientsRes, hoursRes] = await Promise.allSettled([
          apiFetch('/stats').then(r => r.json()),
          apiFetch('/sessions/unsigned').then(r => r.json()),
          apiFetch('/patients').then(r => r.json()),
          apiFetch('/hours').then(r => r.ok ? r.json() : null),
        ])
        if (cancelled) return
        setState({
          loading: false,
          stats: statsRes.status === 'fulfilled' ? statsRes.value : null,
          sessions: draftsRes.status === 'fulfilled' && Array.isArray(draftsRes.value?.sessions) ? draftsRes.value.sessions : [],
          patients: patientsRes.status === 'fulfilled' && Array.isArray(patientsRes.value) ? patientsRes.value : [],
          hours: hoursRes.status === 'fulfilled' ? hoursRes.value : null,
          error: '',
        })
      } catch (err) {
        if (!cancelled) setState(s => ({ ...s, loading: false, error: err.message }))
      }
    })()
    return () => { cancelled = true }
  }, [])

  return state
}

export function TraineeToday() {
  const { therapist } = useAuth()
  const { loading, stats, sessions, patients, hours, error } = useTraineeData()
  const [brief, setBrief] = useState(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const navigate = useNavigate()
  const firstName = therapist?.first_name || therapist?.full_name?.split(' ')[0] || 'there'
  const totalBucket = Array.isArray(hours?.buckets) ? hours.buckets.find(bucket => bucket.id === 'total' || bucket.parent == null) : null
  const totalHours = Number(totalBucket?.hours || 0)
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const timeLabel = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  const greeting = (() => {
    const hour = now.getHours()
    if (hour < 12) return `Good morning, ${firstName}`
    if (hour < 17) return `Good afternoon, ${firstName}`
    return `Good evening, ${firstName}`
  })()

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    setBriefLoading(true)
    apiFetch('/agent/trainee/daily-brief')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) setBrief(data?.markdown || null) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setBriefLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <section
        className="rounded-2xl p-6 text-white relative overflow-hidden shadow-sm border border-brand-100/40"
        style={{ background: 'linear-gradient(135deg, #4a38d9 0%, #221a6e 55%, #059e85 100%)' }}
      >
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 85% 50%, rgba(45,212,191,0.18) 0%, transparent 60%)' }} />
        <div className="relative flex flex-col lg:flex-row lg:items-center gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-2 flex-wrap">
              <div className="w-1.5 h-1.5 rounded-full bg-teal-300 animate-pulse" />
              <span className="text-[11px] font-semibold text-teal-200 uppercase tracking-widest">Trainee workspace</span>
              <span className="text-white/25 text-base">·</span>
              <span className="text-sm font-semibold text-white/85 tracking-wide">{dateLabel}</span>
              <span className="text-white/25 text-base">·</span>
              <span className="text-base font-bold text-teal-200 tabular-nums tracking-wider">{timeLabel}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{greeting}</h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-white/70">
              Your companion workspace for clinical thinking, documentation, supervision prep, and hours tracking.
            </p>
            <div className="mt-4 flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => navigate('/workspace')}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-white text-brand-700 hover:bg-white/90 transition-colors shadow-sm"
              >
                Session Workspace
              </button>
              <button
                type="button"
                onClick={() => navigate('/t/supervision')}
                className="px-4 py-2 text-sm font-medium rounded-xl transition-colors hover:bg-white/15"
                style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }}
              >
                Supervision Prep
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:flex gap-3 flex-shrink-0">
            {[
              { value: stats?.totalPatients || patients.length || 0, label: 'Cases' },
              { value: stats?.appointmentsToday || 0, label: 'Today' },
              { value: sessions.length, label: 'Drafts' },
              { value: Number.isFinite(totalHours) ? totalHours.toFixed(totalHours % 1 ? 1 : 0) : '0', label: 'Hours' },
            ].map(s => (
              <div key={s.label} className="rounded-xl px-4 py-3 text-center min-w-[74px]"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div className="text-2xl font-bold leading-none">{s.value}</div>
                <div className="text-[11px] text-white/60 mt-1 uppercase tracking-wide">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="grid lg:grid-cols-3 gap-5">
        <section className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-950">Notes to draft or copy</h2>
              <p className="text-xs text-gray-500">Unsigned notes are your trainee drafting queue for now.</p>
            </div>
            <Link to="/t/drafts" className="text-xs font-bold text-brand-600 hover:text-brand-700">View drafts</Link>
          </div>
          {sessions.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No active note drafts. Quiet is allowed.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {sessions.slice(0, 5).map(session => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => navigate(`/patients/${session.patient_id}/sessions/${session.id}`)}
                  className="w-full px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-950">{session.display_name || session.client_id || 'Case'}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">Draft</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                      Copy to agency EHR
                    </span>
                  </div>
                  {session.preview && <p className="mt-1 text-sm text-gray-600 line-clamp-2">{session.preview}</p>}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-gray-950">Supervision prep</h2>
            <p className="mt-1 text-xs text-gray-500">Bring stuck points, risk questions, documentation questions, and hours issues.</p>
          </div>
          <div className="space-y-2">
            {[
              'What cases need supervision attention?',
              'What should I ask about documentation?',
              'Where am I feeling stuck clinically?',
            ].map(prompt => (
              <button
                key={prompt}
                type="button"
                onClick={() => navigate('/t/supervision', { state: { initialPrompt: prompt } })}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:border-brand-200 hover:bg-brand-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-bold text-gray-950">Miwa's trainee brief</h2>
            <p className="text-xs text-gray-500">Generated across cases, drafts, supervision needs, hours, and risk/ethics signals.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setBriefLoading(true)
              apiFetch('/agent/trainee/daily-brief')
                .then(r => r.ok ? r.json() : null)
                .then(data => setBrief(data?.markdown || null))
                .catch(() => {})
                .finally(() => setBriefLoading(false))
            }}
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
        {briefLoading ? (
          <div className="text-sm text-gray-500">Reading the trainee workspace...</div>
        ) : brief ? (
          <div className="prose-clinical text-sm" dangerouslySetInnerHTML={{ __html: renderClinical(brief) }} />
        ) : (
          <div className="text-sm text-gray-500">Ask Miwa for a daily brief once you have cases, notes, hours, or appointments.</div>
        )}
      </section>

      <EthicalEscalationPanel />
    </div>
  )
}

export function TraineeCases() {
  return (
    <div className="trainee-cases">
      <div className="px-6 pt-6 max-w-6xl mx-auto">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Cases</p>
        <p className="mt-1 text-sm text-gray-500">Case conceptualization, supervision questions, EHR status, and learning opportunities live here alongside the underlying chart.</p>
      </div>
      <CaseSnapshotBoard />
      <Patients />
    </div>
  )
}

function CaseSnapshotBoard() {
  const { patients, loading } = useTraineeData()
  const [selectedId, setSelectedId] = useState('')
  const [snapshot, setSnapshot] = useState('')
  const [caseForm, setCaseForm] = useState({
    case_conceptualization: '',
    modality_lens: '',
    supervision_questions: '',
    supervision_priority: '',
    agency_note_status: '',
  })
  const selected = patients.find(p => String(p.id) === String(selectedId))
  useEffect(() => {
    if (!selected) return
    setCaseForm({
      case_conceptualization: selected.case_conceptualization || '',
      modality_lens: selected.modality_lens || '',
      supervision_questions: selected.supervision_questions || '',
      supervision_priority: selected.supervision_priority || '',
      agency_note_status: selected.agency_note_status || '',
    })
    setSnapshot('')
  }, [selectedId])
  const generateSnapshot = async () => {
    if (!selectedId) return
    const res = await apiFetch(`/agent/trainee/cases/${selectedId}/snapshot`)
    const data = await res.json()
    if (res.ok) setSnapshot(data.markdown || '')
  }
  const saveCaseMeta = async () => {
    if (!selectedId) return
    await apiFetch(`/patients/${selectedId}`, { method: 'PUT', body: JSON.stringify(caseForm) })
  }
  if (loading || patients.length === 0) {
    return (
      <div className="px-6 py-5 max-w-6xl mx-auto">
        <EmptyState title="Add your first case" body="Use Cases instead of Patients in trainee mode. Track conceptualization, supervision questions, agency note status, and what you are learning." to="/patients/new" cta="Add case" />
      </div>
    )
  }
  return (
    <section className="px-6 py-5 max-w-6xl mx-auto">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1">
            <label className="text-xs font-bold uppercase tracking-wide text-gray-500">Agentic case snapshot</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm">
              <option value="">Choose a case</option>
              {patients.map(p => <option key={p.id} value={p.id}>{p.display_name || p.client_id}</option>)}
            </select>
          </div>
          <button onClick={generateSnapshot} disabled={!selectedId} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Generate snapshot</button>
          <button onClick={() => downloadTraineeExport('case-presentation', { patient_id: selectedId }).catch(() => {})} disabled={!selectedId} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 disabled:opacity-50">Export case presentation</button>
        </div>
        {selected && (
          <div className="grid lg:grid-cols-2 gap-3">
            <textarea className="rounded-xl border border-gray-200 px-3 py-2 text-sm" rows={4} value={caseForm.case_conceptualization} onChange={e => setCaseForm(f => ({ ...f, case_conceptualization: e.target.value }))} placeholder="Case conceptualization" />
            <textarea className="rounded-xl border border-gray-200 px-3 py-2 text-sm" rows={4} value={caseForm.modality_lens} onChange={e => setCaseForm(f => ({ ...f, modality_lens: e.target.value }))} placeholder="Modality / theory lens" />
            <textarea className="rounded-xl border border-gray-200 px-3 py-2 text-sm" rows={4} value={caseForm.supervision_questions} onChange={e => setCaseForm(f => ({ ...f, supervision_questions: e.target.value }))} placeholder="Questions to bring to supervision" />
            <div className="grid sm:grid-cols-2 gap-2">
              <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={caseForm.supervision_priority} onChange={e => setCaseForm(f => ({ ...f, supervision_priority: e.target.value }))}>
                <option value="">Supervision priority</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
              <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={caseForm.agency_note_status} onChange={e => setCaseForm(f => ({ ...f, agency_note_status: e.target.value }))}>
                <option value="">Agency note status</option>
                <option value="needs_draft">Needs draft</option>
                <option value="ready_to_copy">Ready to copy</option>
                <option value="copied_to_agency_ehr">Copied to agency EHR</option>
                <option value="needs_supervisor_review">Needs supervisor review</option>
              </select>
              <button onClick={saveCaseMeta} className="sm:col-span-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-bold text-brand-700">Save case learning fields</button>
            </div>
          </div>
        )}
        {snapshot && <div className="prose-clinical rounded-2xl border border-brand-100 bg-brand-50 p-4 text-sm" dangerouslySetInnerHTML={{ __html: renderClinical(snapshot) }} />}
      </div>
    </section>
  )
}

export function TraineeDrafts() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Note drafts</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-950">Drafts to review and copy</h1>
        <p className="mt-1 text-sm text-gray-500">
          Draft, tighten, discuss in supervision, then copy clean notes into the required agency EHR.
        </p>
      </div>
      <AgencyProfilePanel />
      <DraftQueue />
    </div>
  )
}

function DraftQueue() {
  const { loading, sessions } = useTraineeData()
  const navigate = useNavigate()
  if (loading) return <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Loading drafts...</div>
  if (!sessions.length) {
    return <EmptyState title="Draft a note for your agency EHR" body="Bring your clinical thinking here, not to random AI tools. Miwa keeps note drafting structured around supervision, risk, and copy-to-EHR readiness." to="/workspace" cta="Open session workspace" />
  }
  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
      {sessions.map(session => {
        const checklist = (() => {
          try { return session.copy_to_ehr_checklist_json ? JSON.parse(session.copy_to_ehr_checklist_json) : {} } catch { return {} }
        })()
        const happenedAt = session.session_date || session.created_at
        const copiedAt = session.copied_to_ehr_at
        const daysLate = happenedAt && !copiedAt
          ? Math.max(0, Math.floor((Date.now() - new Date(happenedAt).getTime()) / 86400000))
          : 0
        const complete = [
          checklist.draft_completed || session.draft_completed_at,
          checklist.reviewed_by_trainee || session.reviewed_by_trainee_at,
          checklist.risk_safety_checked || session.risk_safety_checked_at,
          checklist.copied_to_agency_ehr || session.copied_to_ehr_at,
        ].filter(Boolean).length
        return (
        <button
          key={session.id}
          type="button"
          onClick={() => navigate(`/patients/${session.patient_id}/sessions/${session.id}`)}
          className="w-full px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-gray-950">{session.display_name || session.client_id || 'Case'}</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">{session.trainee_note_status || 'Draft'}</span>
            {daysLate > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">{daysLate}d since session</span>}
            {session.needs_supervision && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">Bring to supervision</span>}
          </div>
          <p className="mt-1 text-xs text-gray-500">{complete}/4 copy-to-EHR checks complete. Open to make it more clinical, concise, aligned with goals, or ready to copy.</p>
        </button>
        )
      })}
    </div>
  )
}

function isUsefulSupervisionItem(item) {
  const title = String(item?.title || '')
  const details = String(item?.details || '')
  const leakedTaskText = /I'll work on this in the background|Tasks inbox|result will show up|you can close this chat/i
  if (leakedTaskText.test(`${title} ${details}`)) return false
  return true
}

export function TraineeSupervision() {
  const [agenda, setAgenda] = useState('')
  const [items, setItems] = useState([])
  const [feedback, setFeedback] = useState('')
  const [question, setQuestion] = useState({ title: '', details: '', priority: 'normal' })
  const [extracted, setExtracted] = useState(null)
  const [extracting, setExtracting] = useState(false)
  const [addingQuestion, setAddingQuestion] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const loadItems = () => {
    apiFetch('/agent/trainee/supervision-items')
      .then(r => r.ok ? r.json() : null)
      .then(data => setItems(Array.isArray(data?.items) ? data.items.filter(isUsefulSupervisionItem) : []))
      .catch(() => {})
  }
  const loadAgenda = () => {
    setLoading(true)
    apiFetch('/agent/trainee/supervision-agenda')
      .then(r => r.ok ? r.json() : null)
      .then(data => setAgenda(data?.markdown || ''))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadItems()
  }, [])

  const submitFeedback = async () => {
    if (!feedback.trim()) return
    setExtracting(true)
    try {
      const res = await apiFetch('/agent/trainee/supervisor-feedback', {
        method: 'POST',
        body: JSON.stringify({ feedback_text: feedback }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        setExtracted(data.extracted || null)
        setFeedback('')
        loadItems()
      }
    } finally {
      setExtracting(false)
    }
  }

  const addQuestion = async () => {
    if (!question.title.trim()) return
    setAddingQuestion(true)
    try {
      const res = await apiFetch('/agent/trainee/supervision-items', {
        method: 'POST',
        body: JSON.stringify({
          title: question.title,
          details: question.details || null,
          source: 'manual',
          priority: question.priority,
        }),
      })
      if (res.ok) {
        setQuestion({ title: '', details: '', priority: 'normal' })
        loadItems()
      }
    } finally {
      setAddingQuestion(false)
    }
  }

  const supervisionStats = useMemo(() => {
    const open = items.filter(item => item.status !== 'discussed').length
    const discussed = items.filter(item => item.status === 'discussed').length
    const urgent = items.filter(item => /risk|safety|mandated|crisis|urgent/i.test(`${item.title || ''} ${item.details || ''}`)).length
    return { open, discussed, urgent, total: items.length }
  }, [items])

  const markDiscussed = async (item) => {
    await apiFetch(`/agent/trainee/supervision-items/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'discussed' }),
    })
    loadItems()
  }

  const consultFromItem = (item) => {
    const prompt = [
      'Help me organize this question before I bring it to my supervisor.',
      item.title,
      item.details || '',
      'Give me the clinical issue, what I should ask, and what decision points I should be ready to discuss.',
    ].filter(Boolean).join('\n\n')
    navigate('/consult', { state: { initialPrompt: prompt } })
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5 text-gray-950 dark:text-slate-100">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-600 dark:text-brand-300">Supervision</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-950 dark:text-white">Supervision workspace</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600 dark:text-slate-300">
              Use this page before, during, and after meeting with your supervisor. Bring your questions in, mark what was discussed, write down what your supervisor said, then let Miwa organize the follow-up.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={loadAgenda} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">
              {loading ? 'Preparing...' : 'Prepare agenda'}
            </button>
            <button onClick={() => downloadTraineeExport('supervision-agenda').catch(() => {})} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5">
              Export agenda
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Open questions', supervisionStats.open],
            ['Discussed', supervisionStats.discussed],
            ['Risk or ethics flags', supervisionStats.urgent],
            ['Follow-up items', supervisionStats.total],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-slate-950/60">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</p>
              <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
          <div className="border-b border-gray-100 p-5 dark:border-white/10">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-600 dark:text-brand-300">Before supervision</p>
            <h2 className="mt-1 text-lg font-bold text-gray-950 dark:text-white">Questions and agenda</h2>
          </div>
          <div className="space-y-4 p-5">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-slate-950/60">
              <h3 className="text-sm font-bold text-gray-950 dark:text-white">Add something to bring up</h3>
              <input
                className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                value={question.title}
                onChange={e => setQuestion(q => ({ ...q, title: e.target.value }))}
                placeholder="Question, stuck point, case concern, or documentation issue"
              />
              <textarea
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                rows={3}
                value={question.details}
                onChange={e => setQuestion(q => ({ ...q, details: e.target.value }))}
                placeholder="Optional context: client, session, what you tried, what you want your supervisor to weigh in on."
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <select
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950"
                  value={question.priority}
                  onChange={e => setQuestion(q => ({ ...q, priority: e.target.value }))}
                >
                  <option value="normal">Normal</option>
                  <option value="high">High priority</option>
                  <option value="low">Low priority</option>
                </select>
                <button onClick={addQuestion} disabled={addingQuestion || !question.title.trim()} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                  {addingQuestion ? 'Adding...' : 'Add to supervision'}
                </button>
              </div>
            </div>
            {loading ? (
              <div className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-500 dark:border-white/10 dark:text-slate-400">
                Preparing your supervision agenda...
              </div>
            ) : agenda ? (
              <div className="max-h-80 overflow-y-auto rounded-xl border border-brand-100 bg-brand-50 p-4 dark:border-brand-400/30 dark:bg-brand-950/20">
                <div className="prose-clinical text-sm" dangerouslySetInnerHTML={{ __html: renderClinical(agenda) }} />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 p-5 text-sm leading-6 text-gray-600 dark:border-white/10 dark:text-slate-300">
                Click Prepare agenda when you want a clean list to walk into supervision with.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
          <div className="border-b border-gray-100 p-5 dark:border-white/10">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-600 dark:text-brand-300">During supervision</p>
            <h2 className="mt-1 text-lg font-bold text-gray-950 dark:text-white">What to ask and mark discussed</h2>
          </div>
          <div className="max-h-[34rem] space-y-3 overflow-y-auto p-5">
            {items.length ? items.slice(0, 12).map(item => (
              <div key={item.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-slate-950/60">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-gray-950 dark:text-white">{item.title}</h3>
                    {item.details && <p className="mt-1 line-clamp-3 text-sm leading-6 text-gray-600 dark:text-slate-300">{item.details}</p>}
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                    item.status === 'discussed'
                      ? 'bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-200'
                      : 'bg-brand-50 text-brand-700 dark:bg-brand-400/10 dark:text-brand-200'
                  }`}>
                    {item.status || 'open'}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => markDiscussed(item)} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700">
                    Discussed with supervisor
                  </button>
                  <button type="button" onClick={() => consultFromItem(item)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-white dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5">
                    Prep in Consult
                  </button>
                </div>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm leading-6 text-gray-600 dark:border-white/10 dark:text-slate-300">
                No questions yet. Add anything you want to bring to your supervisor before it disappears into the week.
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
          <div className="border-b border-gray-100 p-5 dark:border-white/10">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-600 dark:text-brand-300">After supervision</p>
            <h2 className="mt-1 text-lg font-bold text-gray-950 dark:text-white">Notes from supervision</h2>
          </div>
          <div className="p-5">
            <textarea
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
              rows={6}
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="Write what your supervisor said: feedback, clinical direction, documentation edits, questions to follow up on, or things to try next session."
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={submitFeedback} disabled={extracting || !feedback.trim()} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                {extracting ? 'Organizing...' : 'Save notes and create follow-ups'}
              </button>
              <button onClick={() => downloadTraineeExport('growth-summary').catch(() => {})} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 dark:border-white/10 dark:text-slate-200">Export growth summary</button>
              <button onClick={() => downloadTraineeExport('hours-summary').catch(() => {})} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 dark:border-white/10 dark:text-slate-200">Export hours summary</button>
            </div>
            {extracted && (
              <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950 dark:border-teal-400/20 dark:bg-teal-400/10 dark:text-teal-100">
                <p className="font-bold">Follow-up created</p>
                <p className="mt-1 text-xs leading-5">Miwa organized your supervisor's feedback into action items, learning goals, documentation reminders, and next-session prompts.</p>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          {[
            ['Action items', 'Tasks that come out of supervision: documentation edits, client follow-ups, risk steps, or admin items.'],
            ['Learning goals', 'Patterns your supervisor wants you to practice over time.'],
            ['Next session prompts', 'Things to bring back into the room with the client.'],
            ['Growth record', 'A running supervision record you can export for school, site, or licensure review.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
              <h3 className="text-sm font-bold text-gray-950 dark:text-white">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-slate-300">{body}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

export function TraineeHours() {
  return (
    <div>
      <div className="p-6 pb-0 max-w-6xl mx-auto">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Agency-ready hours</p>
            <p className="mt-1 text-sm text-gray-600">Track practicum/licensure hours, then export summaries for school, site, or supervisor review.</p>
          </div>
          <button onClick={() => downloadTraineeExport('hours-summary').catch(() => {})} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white">Export hours summary</button>
        </div>
      </div>
      <Hours />
    </div>
  )
}

function GrowthEventForm({ onSaved }) {
  const [form, setForm] = useState({ competency: 'documentation', title: '', details: '', confidence_rating: '' })
  const save = async () => {
    if (!form.title.trim()) return
    const res = await apiFetch('/agent/trainee/growth-events', { method: 'POST', body: JSON.stringify(form) })
    if (res.ok) {
      setForm({ competency: 'documentation', title: '', details: '', confidence_rating: '' })
      onSaved?.()
    }
  }
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-bold text-gray-950">Log a growth moment</h2>
      <div className="mt-3 grid md:grid-cols-3 gap-2">
        <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={form.competency} onChange={e => setForm(f => ({ ...f, competency: e.target.value }))}>
          {Object.keys(COMPETENCY_LABELS).map(key => <option key={key} value={key}>{COMPETENCY_LABELS[key]}</option>)}
        </select>
        <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm md:col-span-2" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Skill practiced, theme noticed, or modality learned" />
        <textarea className="rounded-xl border border-gray-200 px-3 py-2 text-sm md:col-span-2" rows={3} value={form.details} onChange={e => setForm(f => ({ ...f, details: e.target.value }))} placeholder="What happened, what feedback did you receive, and what will you try next?" />
        <div className="space-y-2">
          <input className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" type="number" min="1" max="5" value={form.confidence_rating} onChange={e => setForm(f => ({ ...f, confidence_rating: e.target.value }))} placeholder="Confidence 1-5" />
          <button onClick={save} disabled={!form.title.trim()} className="w-full rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Save growth event</button>
        </div>
      </div>
    </section>
  )
}

export function TransitionPanel() {
  const [plan, setPlan] = useState(null)
  const [selected, setSelected] = useState([])
  const [done, setDone] = useState(false)
  const load = () => apiFetch('/agent/trainee/transition-plan').then(r => r.ok ? r.json() : null).then(setPlan).catch(() => {})
  useEffect(() => { load() }, [])
  const toggle = id => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const convert = async () => {
    const res = await apiFetch('/agent/trainee/transition-to-licensed', { method: 'POST', body: JSON.stringify({ case_ids: selected }) })
    if (res.ok) {
      setDone(true)
      load()
    }
  }
  if (!plan) return null
  return (
    <section className="rounded-2xl border border-brand-100 bg-white p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Transition to licensed mode</p>
      <h2 className="mt-1 text-sm font-bold text-gray-950">Carry your clinical operating system forward</h2>
      <div className="mt-3 grid md:grid-cols-2 gap-3">
        <div className="rounded-xl bg-brand-50 p-3">
          <p className="text-xs font-bold text-brand-800">Preserved</p>
          <ul className="mt-2 space-y-1 text-xs text-brand-900">{plan.preserved?.map(item => <li key={item}>- {item}</li>)}</ul>
        </div>
        <div className="rounded-xl bg-teal-50 p-3">
          <p className="text-xs font-bold text-teal-800">Unlocked</p>
          <ul className="mt-2 space-y-1 text-xs text-teal-900">{plan.unlocks?.map(item => <li key={item}>- {item}</li>)}</ul>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-xs font-bold text-gray-700">Optional case conversion</p>
        {plan.convertible_cases?.slice(0, 8).map(c => (
          <label key={c.id} className="flex items-start gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-700">
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} className="mt-0.5" />
            <span><strong>{c.label}</strong>: {c.recommendation}</span>
          </label>
        ))}
      </div>
      <button onClick={convert} className="mt-3 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white">
        {done ? 'Transition saved' : 'Switch to private-practice mode'}
      </button>
    </section>
  )
}

export function TraineeLearning() {
  const navigate = useNavigate()
  const [growth, setGrowth] = useState({ events: [], competencies: [] })
  const loadGrowth = () => {
    apiFetch('/agent/trainee/growth-timeline')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setGrowth(data) })
      .catch(() => {})
  }
  useEffect(() => { loadGrowth() }, [])
  const prompts = [
    'Teach me why this intervention fits this presentation',
    'Compare CBT, DBT, EFT, and family systems for this case',
    'Help me build a case conceptualization I can bring to supervision',
    'What should I document if risk comes up in session?',
  ]
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Learning</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-950">Clinical growth workspace</h1>
        <p className="mt-1 text-sm text-gray-500">
          Ask Miwa to explain the why behind diagnosis, interventions, documentation, and supervision questions.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {prompts.map(prompt => (
          <button
            key={prompt}
            type="button"
            onClick={() => navigate('/consult', { state: { initialPrompt: prompt } })}
            className="rounded-2xl border border-gray-200 bg-white p-4 text-left text-sm font-semibold text-gray-800 hover:border-brand-200 hover:bg-brand-50"
          >
            {prompt}
          </button>
        ))}
      </div>
      <GrowthEventForm onSaved={loadGrowth} />
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-bold text-gray-950">Competency map</h2>
        <p className="mt-1 text-xs text-gray-500">Miwa builds this from supervision feedback and learning activity over time.</p>
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {Object.keys(COMPETENCY_LABELS).map(key => {
            const match = growth.competencies?.find(item => item.name === key)
            return (
              <div key={key} className="rounded-xl border border-gray-200 px-3 py-2">
                <div className="text-xs font-bold text-gray-900">{COMPETENCY_LABELS[key]}</div>
                <div className="mt-1 text-[11px] text-gray-500">{match?.count || 0} logged growth event{match?.count === 1 ? '' : 's'}</div>
              </div>
            )
          })}
        </div>
      </section>
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-bold text-gray-950">Clinical growth timeline</h2>
        <div className="mt-3 space-y-2">
          {growth.events?.length ? growth.events.slice(0, 8).map(event => (
            <div key={event.id} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
              <div className="text-xs font-bold text-gray-900">{event.title || event.competency || event.category}</div>
              {event.details && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{event.details}</p>}
            </div>
          )) : <p className="text-sm text-gray-500">Your modalities learned, recurring supervision themes, documentation struggles, confidence growth, and skills practiced will collect here.</p>}
        </div>
      </section>
    </div>
  )
}
