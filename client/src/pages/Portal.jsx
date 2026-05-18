import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { isClinicianCredential, isTraineeCredential } from '../lib/workspaceMode'

function patientLabel(patient) {
  return patient.display_name || [patient.first_name, patient.last_name].filter(Boolean).join(' ') || patient.client_id
}

export default function Portal() {
  const { therapist } = useAuth()
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    apiFetch('/patients')
      .then(async res => {
        const body = await res.json().catch(() => [])
        if (!res.ok) throw new Error(body?.error || 'Unable to load clients')
        if (!cancelled) setPatients(Array.isArray(body) ? body : [])
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Unable to load clients') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const canInvite = isClinicianCredential(therapist)
  const sample = useMemo(() => patients.slice(0, 6), [patients])

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700">Client portal</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-950">Portal</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
            Manage portal readiness across invite codes, secure messages, appointment requests, assessments, and homework activity.
          </p>
        </div>
        <Link to="/inbox" className="rounded-xl bg-gray-950 px-4 py-2 text-sm font-bold text-white hover:bg-gray-800">Secure inbox</Link>
      </div>

      {error && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>}

      {isTraineeCredential(therapist) && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
          <h2 className="text-sm font-bold text-indigo-950">Portal access is available for trainee mode.</h2>
          <p className="mt-1 text-sm text-indigo-800">
            Trainees can use portal tools that are already enabled for their workflow. Invite-code generation stays limited to associate and licensed clinician accounts.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['Clients', patients.length],
          ['Invite-ready', canInvite ? patients.length : 0],
          ['Messages', 'Inbox'],
          ['Activity', 'Portal'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-2xl font-bold text-gray-950">{value}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-gray-950">Invite-code workflows</h2>
            <p className="mt-1 text-sm text-gray-500">
              Associate and licensed clinicians generate single-use portal codes from a client chart. Trainees remain blocked from invite-code generation.
            </p>
          </div>
          <Link to="/patients" className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50">Clients</Link>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {loading ? (
            <p className="text-sm text-gray-500">Loading clients...</p>
          ) : sample.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5 text-sm text-gray-500">
              Add a client before generating portal access.
            </div>
          ) : sample.map(patient => (
            <Link key={patient.id} to={`/patients/${patient.id}`} className="rounded-xl border border-gray-100 px-4 py-3 hover:border-teal-200 hover:bg-teal-50/30">
              <p className="text-sm font-bold text-gray-950">{patientLabel(patient)}</p>
              <p className="mt-1 text-xs text-gray-500">{canInvite ? 'Open chart to generate or review invite code.' : 'Portal invite codes are not enabled for this credential.'}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        {[
          ['Secure messages', 'Use Inbox for client portal messages. Keep clinical communication inside Miwa.'],
          ['Appointment requests', 'Review client requests and schedule changes from the portal workflow.'],
          ['Assessments and homework', 'Track pending measures, completed homework, and measurement-based care activity.'],
        ].map(([title, body]) => (
          <div key={title} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-gray-950">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">{body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
