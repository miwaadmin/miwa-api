import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { renderClinical } from '../../lib/renderClinical'
import Patients from '../Patients'
import Hours from '../Hours'
import Supervisor from '../Supervisor'

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

function StatCard({ label, value, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700 border-brand-100',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    teal: 'bg-teal-50 text-teal-800 border-teal-200',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  }
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone] || tones.brand}`}>
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wide opacity-75">{label}</div>
    </div>
  )
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
  const navigate = useNavigate()
  const firstName = therapist?.first_name || therapist?.full_name?.split(' ')[0] || 'there'
  const totalBucket = Array.isArray(hours?.buckets) ? hours.buckets.find(bucket => bucket.id === 'total' || bucket.parent == null) : null
  const totalHours = Number(totalBucket?.hours || 0)

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
      <section className="rounded-2xl border border-brand-100 bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Agency companion workspace</p>
        <div className="mt-2 flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-950">Good to see you, {firstName}.</h1>
            <p className="mt-1 text-sm text-gray-600">
              Your agency has an EHR. You still need a clinical brain.
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 max-w-xl">
            Miwa is HIPAA-ready. Your ability to enter agency client PHI depends on your site's policies and authorization.
          </div>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Cases" value={stats?.totalPatients || patients.length || 0} />
        <StatCard label="Today" value={stats?.appointmentsToday || 0} tone="teal" />
        <StatCard label="Note drafts" value={sessions.length} tone={sessions.length ? 'amber' : 'slate'} />
        <StatCard label="Hours logged" value={Number.isFinite(totalHours) ? totalHours.toFixed(totalHours % 1 ? 1 : 0) : '0'} tone="brand" />
      </div>

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
    </div>
  )
}

export function TraineeCases() {
  return (
    <div className="trainee-cases">
      <div className="px-6 pt-6 max-w-6xl mx-auto">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Cases</p>
        <p className="mt-1 text-sm text-gray-500">Use case language here while Miwa keeps the underlying clinical records intact.</p>
      </div>
      <Patients />
    </div>
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

export function TraineeSupervision() {
  const [agenda, setAgenda] = useState('')
  const [items, setItems] = useState([])
  const [feedback, setFeedback] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [loading, setLoading] = useState(false)
  const loadItems = () => {
    apiFetch('/agent/trainee/supervision-items')
      .then(r => r.ok ? r.json() : null)
      .then(data => setItems(Array.isArray(data?.items) ? data.items : []))
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
    loadAgenda()
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
        setFeedback('')
        loadItems()
      }
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex-shrink-0 border-b border-gray-200 bg-white px-6 py-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Supervision agent</p>
            <h1 className="text-xl font-bold text-gray-950">Weekly supervision agenda</h1>
          </div>
          <button onClick={loadAgenda} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">
            {loading ? 'Preparing...' : 'Prepare agenda'}
          </button>
        </div>
        {agenda && (
          <div className="max-w-6xl mx-auto mt-3 rounded-2xl border border-brand-100 bg-brand-50 p-4 text-sm text-gray-800 whitespace-pre-wrap max-h-56 overflow-y-auto">
            {agenda}
          </div>
        )}
        <div className="max-w-6xl mx-auto mt-3 grid lg:grid-cols-2 gap-3">
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-bold text-gray-950">Ask my supervisor queue</h2>
            <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
              {items.length ? items.slice(0, 8).map(item => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => apiFetch(`/agent/trainee/supervision-items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'discussed' }) }).then(loadItems)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-gray-900">{item.title}</span>
                    <span className="text-[10px] font-bold uppercase text-brand-600">{item.status}</span>
                  </div>
                  {item.details && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{item.details}</p>}
                </button>
              )) : <p className="text-sm text-gray-500">Add stuck points, risk flags, note questions, or chat insights here as they come up.</p>}
            </div>
          </section>
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-bold text-gray-950">Supervisor feedback loop</h2>
            <textarea
              className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              rows={4}
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="Paste supervisor feedback. Miwa will turn it into action items, documentation reminders, learning goals, next-session prompts, and follow-ups."
            />
            <button onClick={submitFeedback} disabled={extracting || !feedback.trim()} className="mt-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {extracting ? 'Extracting...' : 'Convert feedback'}
            </button>
          </section>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Supervisor />
      </div>
    </div>
  )
}

export function TraineeHours() {
  return <Hours />
}

export function TraineeLearning() {
  const navigate = useNavigate()
  const [growth, setGrowth] = useState({ events: [], competencies: [] })
  useEffect(() => {
    apiFetch('/agent/trainee/growth-timeline')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setGrowth(data) })
      .catch(() => {})
  }, [])
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
