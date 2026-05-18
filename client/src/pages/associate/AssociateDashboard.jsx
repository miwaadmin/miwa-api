import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { recommendedAppsFor } from '../../lib/appRegistry'
import WorkspaceStatusDots, { sessionPipelineSteps } from '../../components/trainee/WorkspaceStatusDots'

function Card({ title, eyebrow, action, to, children }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          {eyebrow && <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700">{eyebrow}</p>}
          <h2 className="mt-1 text-base font-bold text-gray-950">{title}</h2>
        </div>
        {to && (
          <Link to={to} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50">
            {action || 'Open'}
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

function Metric({ label, value, tone = 'gray' }) {
  const tones = {
    gray: 'bg-gray-50 text-gray-950 border-gray-200',
    teal: 'bg-teal-50 text-teal-950 border-teal-100',
    amber: 'bg-amber-50 text-amber-950 border-amber-100',
    red: 'bg-red-50 text-red-950 border-red-100',
    indigo: 'bg-indigo-50 text-indigo-950 border-indigo-100',
  }
  return (
    <div className={`rounded-xl border p-4 ${tones[tone] || tones.gray}`}>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
    </div>
  )
}

function patientName(item) {
  return item?.display_name || item?.client_id || item?.name || 'Client'
}

export default function AssociateDashboard() {
  const { therapist } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState({
    loading: true,
    stats: null,
    sessions: [],
    patients: [],
    alerts: [],
    hours: null,
    error: '',
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [statsRes, sessionsRes, patientsRes, alertsRes, hoursRes] = await Promise.allSettled([
        apiFetch('/stats').then(r => r.ok ? r.json() : null),
        apiFetch('/sessions/unsigned').then(r => r.ok ? r.json() : null),
        apiFetch('/patients').then(r => r.ok ? r.json() : []),
        apiFetch('/patients/alerts').then(r => r.ok ? r.json() : []),
        apiFetch('/hours').then(r => r.ok ? r.json() : null),
      ])
      if (cancelled) return
      setState({
        loading: false,
        stats: statsRes.status === 'fulfilled' ? statsRes.value : null,
        sessions: sessionsRes.status === 'fulfilled' && Array.isArray(sessionsRes.value?.sessions) ? sessionsRes.value.sessions : [],
        patients: patientsRes.status === 'fulfilled' && Array.isArray(patientsRes.value) ? patientsRes.value : [],
        alerts: alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value) ? alertsRes.value : [],
        hours: hoursRes.status === 'fulfilled' ? hoursRes.value : null,
        error: [statsRes, sessionsRes, patientsRes].some(r => r.status === 'rejected') ? 'Some dashboard data is unavailable. Core shortcuts are still ready.' : '',
      })
    })()
    return () => { cancelled = true }
  }, [])

  const noteStats = useMemo(() => {
    const sessions = state.sessions || []
    return {
      drafts: sessions.filter(s => sessionPipelineSteps(s).filter(Boolean).length > 0 && !s.signed_at).length,
      unsigned: sessions.filter(s => !s.signed_at).length,
      review: sessions.filter(s => s.needs_supervision || /review|supervision/i.test(s.trainee_note_status || '')).length,
      risk: sessions.filter(s => !s.risk_safety_checked_at && !s.signed_at).length,
      copied: sessions.filter(s => s.copied_to_ehr_at).length,
    }
  }, [state.sessions])

  const totalBucket = Array.isArray(state.hours?.buckets)
    ? state.hours.buckets.find(bucket => bucket.id === 'total' || bucket.parent == null)
    : null
  const totalHours = Number(totalBucket?.hours || 0)
  const weeklyGoal = Number(therapist?.weekly_hours_goal || therapist?.associate_weekly_hours_goal || 10)
  const firstName = therapist?.first_name || therapist?.full_name?.split(' ')[0] || 'there'
  const recommended = recommendedAppsFor({ credentialType: therapist?.credential_type, limit: 6 })
  const activeAlerts = state.alerts.filter(alert => !alert.dismissed_at)
  const worsening = activeAlerts.filter(alert => /deterioration|worsening|risk/i.test(`${alert.alert_type || ''} ${alert.title || ''}`))

  if (state.loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {state.error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{state.error}</div>
      )}

      <section className="rounded-2xl border border-teal-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-teal-700">Associate Mode</p>
            <h1 className="mt-2 text-2xl font-bold text-gray-950">Good to see you, {firstName}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
              Supported independence for caseload management, documentation quality, portal workflows, outcomes, hours, and readiness for licensed practice.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => navigate('/workspace')} className="rounded-xl bg-gray-950 px-4 py-2 text-sm font-bold text-white hover:bg-gray-800">Start note</button>
            <button onClick={() => navigate('/schedule')} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">Open schedule</button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Clients" value={state.stats?.totalPatients || state.patients.length || 0} tone="teal" />
          <Metric label="Today" value={state.stats?.appointmentsToday || 0} tone="indigo" />
          <Metric label="Unsigned" value={noteStats.unsigned} tone={noteStats.unsigned ? 'amber' : 'gray'} />
          <Metric label="Alerts" value={activeAlerts.length} tone={activeAlerts.length ? 'red' : 'gray'} />
          <Metric label="Hours" value={Number.isFinite(totalHours) ? totalHours.toFixed(totalHours % 1 ? 1 : 0) : '0'} tone="teal" />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card title="Today" eyebrow="Sessions" to="/schedule" action="Schedule">
          {(state.stats?.appointmentsToday || 0) > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">{state.stats.appointmentsToday} session{state.stats.appointmentsToday === 1 ? '' : 's'} on deck today.</p>
              <div className="flex flex-wrap gap-2">
                <Link to="/workspace" className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-bold text-white">Start note</Link>
                <Link to="/briefs" className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700">View brief</Link>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No sessions found for today. Use Schedule to add sessions or Workspace to keep notes moving.</p>
          )}
        </Card>

        <Card title="Notes" eyebrow="Documentation" to="/workspace" action="Workspace">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Drafts" value={noteStats.drafts} />
            <Metric label="Unsigned" value={noteStats.unsigned} tone="amber" />
            <Metric label="Review" value={noteStats.review} tone="indigo" />
            <Metric label="Risk check" value={noteStats.risk} tone="red" />
          </div>
          {noteStats.copied > 0 && <p className="mt-3 text-xs text-gray-500">{noteStats.copied} note{noteStats.copied === 1 ? '' : 's'} already copied to an EHR workflow.</p>}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Risk" eyebrow="Caseload pulse" to="/outcomes" action="Outcomes">
          <div className="space-y-2">
            {activeAlerts.slice(0, 4).map(alert => (
              <button key={alert.id} onClick={() => navigate(alert.patient_id ? `/patients/${alert.patient_id}` : '/outcomes')} className="w-full rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-left">
                <p className="text-xs font-bold text-red-900">{alert.title || alert.alert_type || 'Risk review'}</p>
                <p className="mt-0.5 text-xs text-red-700">{patientName(alert)}</p>
              </button>
            ))}
            {activeAlerts.length === 0 && <p className="text-sm text-gray-500">No active alerts. Keep an eye on overdue assessments, no-shows, check-ins, and treatment-plan reviews.</p>}
            {worsening.length > 0 && <p className="text-xs font-semibold text-red-700">{worsening.length} worsening outcome or risk signal{worsening.length === 1 ? '' : 's'} to review.</p>}
          </div>
        </Card>

        <Card title="Hours" eyebrow="Licensure progress" to="/hours" action="Export">
          <div className="space-y-3">
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.min(100, (totalHours / 3000) * 100)}%` }} />
            </div>
            <p className="text-sm text-gray-600">{totalHours.toFixed(totalHours % 1 ? 1 : 0)} total hours tracked toward licensure. Weekly goal: {weeklyGoal}.</p>
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
              <span className="rounded-lg bg-gray-50 px-3 py-2">Direct hours</span>
              <span className="rounded-lg bg-gray-50 px-3 py-2">Supervision hours</span>
            </div>
          </div>
        </Card>

        <Card title="Portal" eyebrow="Client access" to="/portal" action="Portal">
          <div className="space-y-2 text-sm text-gray-600">
            <p>{state.patients.length} client chart{state.patients.length === 1 ? '' : 's'} available for portal invite workflows.</p>
            <p>Use client charts for invite codes, Inbox for secure messages, and portal activity for appointments, assessments, and homework.</p>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Card title="Apps" eyebrow="Recommended global tools" to="/apps" action="Apps">
          <div className="grid gap-2 sm:grid-cols-2">
            {recommended.map(app => (
              <button key={app.id} onClick={() => navigate(app.clientLinked && state.patients[0]?.id ? app.route({ patientId: state.patients[0].id }) : app.route({}))} className="rounded-xl border border-gray-200 p-3 text-left hover:border-teal-200 hover:bg-teal-50/40">
                <p className="text-sm font-bold text-gray-950">{app.name}</p>
                <p className="mt-1 line-clamp-2 text-xs text-gray-500">{app.recommendedWhen?.({ credentialType: 'associate' })}</p>
              </button>
            ))}
          </div>
        </Card>

        <Card title="Outcomes" eyebrow="Measurement based care" to="/outcomes" action="Review">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Overdue" value={activeAlerts.filter(a => /overdue/i.test(a.alert_type || a.title || '')).length} tone="amber" />
            <Metric label="Improving" value={activeAlerts.filter(a => /improvement|improving/i.test(a.alert_type || a.title || '')).length} tone="teal" />
            <Metric label="Worsening" value={worsening.length} tone="red" />
          </div>
          <p className="mt-3 text-sm text-gray-500">Track adherence, overdue measures, and clients moving in either direction.</p>
        </Card>
      </div>

      <Card title="Readiness" eyebrow="Path to Licensed Mode" to="/billing" action="Billing">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ['Documentation confidence', noteStats.unsigned === 0 ? 'Current' : `${noteStats.unsigned} to sign`],
            ['Hours progress', `${Math.min(100, Math.round((totalHours / 3000) * 100))}% tracked`],
            ['Portal workflow', 'Invite-ready'],
            ['Billing policy prep', 'Payments stay blocked until licensed'],
            ['Reports and exports', 'Organize records'],
            ['Supervision records', 'Keep questions and summaries together'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{label}</p>
              <p className="mt-1 text-sm font-semibold text-gray-950">{value}</p>
            </div>
          ))}
        </div>
      </Card>

      {state.sessions.length > 0 && (
        <Card title="Recent note pipeline" eyebrow="Workspace status" to="/workspace" action="Open">
          <div className="space-y-2">
            {state.sessions.slice(0, 4).map(session => (
              <Link key={session.id} to={`/patients/${session.patient_id}/sessions/${session.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2 hover:bg-gray-50">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-950">{patientName(session)}</p>
                  <p className="truncate text-xs text-gray-500">{session.trainee_note_status || 'Documentation in progress'}</p>
                </div>
                <WorkspaceStatusDots session={session} compact />
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
