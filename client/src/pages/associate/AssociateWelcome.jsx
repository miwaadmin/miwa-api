import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import FeedbackModal from '../../components/FeedbackModal'

const PRACTICE_OPTIONS = [
  'Agency or community clinic',
  'Group practice',
  'Private practice under supervision',
  'School-based',
  'Other',
]

const PRIORITIES = ['Notes', 'Clients', 'Schedule', 'Consult', 'Outcomes', 'Portal', 'Apps', 'Reports', 'Hours']
const TOTAL_STEPS = 6

function StepShell({ step, title, body, children, onBack, onNext, nextLabel = 'Next', nextDisabled = false }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col p-6">
      <div className="mb-8 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-teal-700">Associate setup</p>
          <h1 className="mt-2 text-2xl font-bold text-gray-950">{title}</h1>
          {body && <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">{body}</p>}
        </div>
        <div className="text-sm font-bold text-gray-400">{step} / {TOTAL_STEPS}</div>
      </div>

      <div className="mb-6 h-2 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">{children}</div>

      <div className="mt-6 flex justify-between gap-3">
        <button type="button" onClick={onBack} disabled={step === 1} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 disabled:opacity-40">
          Back
        </button>
        <button type="button" onClick={onNext} disabled={nextDisabled} className="rounded-xl bg-gray-950 px-5 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-50">
          {nextLabel}
        </button>
      </div>
    </div>
  )
}

export default function AssociateWelcome() {
  const navigate = useNavigate()
  const { therapist, refreshTherapist } = useAuth()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [form, setForm] = useState({
    practice_setting: '',
    credential_number: '',
    licensure_board: '',
    supervisor_name: '',
    supervisor_license: '',
    licensure_target_date: '',
    current_hours: '',
    weekly_hours_goal: '10',
    export_preference: 'monthly',
    dashboard_focus: ['Notes', 'Clients', 'Hours', 'Portal'],
  })

  useEffect(() => {
    let cancelled = false
    apiFetch('/onboarding/associate/state')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return
        if (data?.completed) {
          navigate('/a/dashboard', { replace: true })
          return
        }
        setStep(Math.min(Math.max(Number(data?.step || 1), 1), TOTAL_STEPS))
        setForm(prev => ({ ...prev, ...(data?.data || {}) }))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [navigate])

  const selectedPriorities = useMemo(() => new Set(form.dashboard_focus || []), [form.dashboard_focus])

  async function saveStep(nextStep = step) {
    setSaving(true)
    try {
      const res = await apiFetch(`/onboarding/associate/step/${nextStep}`, {
        method: 'PUT',
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setStep(Math.min(Math.max(Number(data.step || nextStep), 1), TOTAL_STEPS))
      }
    } finally {
      setSaving(false)
    }
  }

  async function complete() {
    setSaving(true)
    try {
      await apiFetch('/onboarding/associate/complete', { method: 'POST', body: JSON.stringify(form) })
      refreshTherapist?.()
      navigate('/a/dashboard', { replace: true, state: { associateOnboardingComplete: true } })
    } finally {
      setSaving(false)
    }
  }

  async function next() {
    if (step >= TOTAL_STEPS) return complete()
    await saveStep(step)
    setStep(prev => Math.min(TOTAL_STEPS, prev + 1))
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    )
  }

  const common = {
    step,
    onBack: () => setStep(prev => Math.max(1, prev - 1)),
    onNext: next,
    nextLabel: saving ? 'Saving...' : step === TOTAL_STEPS ? 'Open dashboard' : 'Next',
    nextDisabled: saving,
  }

  if (step === 1) {
    return (
      <StepShell
        {...common}
        title="Welcome to Associate Mode"
        body="Set up Associate Mode around your current clinical work, supervision, and path to licensure."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['Autonomous', 'Run your caseload, notes, portal, outcomes, and schedule with fewer trainee guardrails.'],
            ['Supervision-aware', 'Keep review flags, consult questions, and readiness records close to the work.'],
            ['Licensure-ready', 'Track hours, exports, documentation confidence, and the path toward Licensed Mode.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <h2 className="text-sm font-bold text-gray-950">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">{body}</p>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setFeedbackOpen(true)} className="mt-5 text-xs font-bold text-teal-700">Send setup feedback</button>
        <FeedbackModal isOpen={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      </StepShell>
    )
  }

  if (step === 2) {
    return (
      <StepShell {...common} title="Practice setting" body="Tell Miwa where your supervised clinical work lives right now.">
        <div className="grid gap-3 md:grid-cols-2">
          {PRACTICE_OPTIONS.map(option => (
            <button key={option} type="button" onClick={() => setForm(prev => ({ ...prev, practice_setting: option }))} className={`rounded-2xl border p-4 text-left text-sm font-bold ${form.practice_setting === option ? 'border-teal-400 bg-teal-50 text-teal-950' : 'border-gray-200 text-gray-800 hover:bg-gray-50'}`}>
              {option}
            </button>
          ))}
        </div>
      </StepShell>
    )
  }

  if (step === 3) {
    return (
      <StepShell {...common} title="Licensure and supervision" body="Save the details you need close at hand for records, reports, and readiness.">
        <div className="grid gap-4 md:grid-cols-2">
          <input className="input" value={form.credential_number || ''} onChange={e => setForm(prev => ({ ...prev, credential_number: e.target.value }))} placeholder="Registration or license number" />
          <input className="input" value={form.licensure_board || ''} onChange={e => setForm(prev => ({ ...prev, licensure_board: e.target.value }))} placeholder="Board or track" />
          <input className="input" value={form.supervisor_name || ''} onChange={e => setForm(prev => ({ ...prev, supervisor_name: e.target.value }))} placeholder="Supervisor name" />
          <input className="input" value={form.supervisor_license || ''} onChange={e => setForm(prev => ({ ...prev, supervisor_license: e.target.value }))} placeholder="Supervisor license" />
          <label className="text-sm font-semibold text-gray-600">
            Optional target licensure date
            <input className="input mt-1" type="date" value={form.licensure_target_date || ''} onChange={e => setForm(prev => ({ ...prev, licensure_target_date: e.target.value }))} />
          </label>
        </div>
      </StepShell>
    )
  }

  if (step === 4) {
    return (
      <StepShell {...common} title="Hours tracking" body="Set the working targets Associate Dashboard should keep visible.">
        <div className="grid gap-4 md:grid-cols-2">
          <input className="input" type="number" min="0" step="0.25" value={form.current_hours || ''} onChange={e => setForm(prev => ({ ...prev, current_hours: e.target.value }))} placeholder="Current total hours" />
          <input className="input" type="number" min="0" step="0.25" value={form.weekly_hours_goal || ''} onChange={e => setForm(prev => ({ ...prev, weekly_hours_goal: e.target.value }))} placeholder="Weekly hours goal" />
          <select className="input md:col-span-2" value={form.export_preference || 'monthly'} onChange={e => setForm(prev => ({ ...prev, export_preference: e.target.value }))}>
            <option value="monthly">Monthly export review</option>
            <option value="supervision">Before supervision</option>
            <option value="licensure">Licensure application packet</option>
          </select>
        </div>
      </StepShell>
    )
  }

  if (step === 5) {
    return (
      <StepShell {...common} title="Dashboard priorities" body="Pick the work surfaces you want Associate Mode to keep close.">
        <div className="flex flex-wrap gap-2">
          {PRIORITIES.map(priority => {
            const active = selectedPriorities.has(priority)
            return (
              <button
                key={priority}
                type="button"
                onClick={() => setForm(prev => {
                  const next = new Set(prev.dashboard_focus || [])
                  if (next.has(priority)) next.delete(priority)
                  else next.add(priority)
                  return { ...prev, dashboard_focus: Array.from(next) }
                })}
                className={`rounded-xl border px-4 py-2 text-sm font-bold ${active ? 'border-teal-400 bg-teal-50 text-teal-950' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
              >
                {priority}
              </button>
            )
          })}
        </div>
      </StepShell>
    )
  }

  return (
    <StepShell {...common} title="Ready" body="Associate Mode is set up for supported independence: confident, supervision-aware, and focused on the path to licensure.">
      <div className="rounded-2xl border border-teal-100 bg-teal-50 p-5">
        <h2 className="text-base font-bold text-teal-950">Your dashboard is ready.</h2>
        <p className="mt-2 text-sm leading-6 text-teal-800">
          You will land in Associate Dashboard, with shared access to Workspace, Clients, Schedule, Consult, Outcomes, Apps, Portal, Hours, Billing, Resources, and Settings.
        </p>
      </div>
    </StepShell>
  )
}
