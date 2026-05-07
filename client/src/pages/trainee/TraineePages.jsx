import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import Patients from '../Patients'
import Hours from '../Hours'
import Supervisor from '../Supervisor'

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
  const navigate = useNavigate()
  const firstName = therapist?.first_name || therapist?.full_name?.split(' ')[0] || 'there'
  const totalHours = Number(hours?.totals?.overall?.hours || hours?.grandTotal || 0)

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
    return <EmptyState title="No note drafts waiting" body="Unsigned session notes will appear here as draft work." to="/workspace" cta="Open session workspace" />
  }
  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
      {sessions.map(session => (
        <button
          key={session.id}
          type="button"
          onClick={() => navigate(`/patients/${session.patient_id}/sessions/${session.id}`)}
          className="w-full px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-gray-950">{session.display_name || session.client_id || 'Case'}</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">Draft</span>
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">Ready for review</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">Open to make it more clinical, concise, aligned with goals, or ready to copy.</p>
        </button>
      ))}
    </div>
  )
}

export function TraineeSupervision() {
  return <Supervisor />
}

export function TraineeHours() {
  return <Hours />
}

export function TraineeLearning() {
  const navigate = useNavigate()
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
    </div>
  )
}
