import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { patientInitials } from '../lib/avatar'

const APP_CATALOG = [
  {
    id: 'genogram',
    name: 'Genogram',
    eyebrow: 'Family systems',
    description: 'Build a clinical family map with structure, emotional relationship lines, notes, life events, and chart-linked exports.',
    status: 'Available',
    accent: 'teal',
    features: ['Saved to client profile', 'AI draft from chart', 'PDF / PNG / SVG export'],
  },
]

function AppGlyph() {
  return (
    <svg className="w-9 h-9" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#ccfbf1" />
      <rect x="12" y="11" width="9" height="9" rx="1.5" fill="#0f766e" />
      <circle cx="32" cy="15.5" r="5" fill="#14b8a6" />
      <circle cx="16.5" cy="33" r="5" fill="#2dd4bf" />
      <rect x="28" y="28" width="9" height="9" rx="1.5" fill="#115e59" />
      <path d="M21 15.5h6M18 21v7M30 21l-8 8M21.5 33H28" stroke="#134e4a" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function clientLabel(patient) {
  return patient.display_name || [patient.first_name, patient.last_name].filter(Boolean).join(' ') || patient.client_id
}

function ClientPicker({ patients, query, setQuery, selectedId, setSelectedId }) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return patients
    return patients.filter((patient) => {
      const haystack = [
        patient.display_name,
        patient.first_name,
        patient.last_name,
        patient.client_id,
        patient.presenting_concerns,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [patients, query])

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.16em]">Choose Client</p>
          <h2 className="text-base font-bold text-gray-900 mt-1">Attach this app to a chart</h2>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-500">
          {patients.length} active
        </span>
      </div>

      <input
        className="input py-2.5 text-sm mb-3"
        placeholder="Search clients..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="max-h-[430px] overflow-y-auto space-y-2 pr-1">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center">
            <p className="text-sm font-semibold text-gray-700">No matching clients</p>
            <Link to="/patients" className="mt-2 inline-flex text-xs font-semibold text-brand-600 hover:text-brand-700">
              Go to Patients
            </Link>
          </div>
        ) : filtered.map((patient) => {
          const selected = Number(selectedId) === Number(patient.id)
          return (
            <button
              key={patient.id}
              type="button"
              onClick={() => setSelectedId(patient.id)}
              className={`w-full text-left rounded-xl border p-3 transition-all ${
                selected
                  ? 'border-brand-400 bg-brand-50 shadow-sm'
                  : 'border-gray-100 bg-white hover:border-brand-200 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold ${
                  selected ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'
                }`}>
                  {patientInitials(patient)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-900 truncate">{clientLabel(patient)}</p>
                  <p className="text-[11px] text-gray-400 font-mono truncate">{patient.client_id}</p>
                </div>
                {patient.case_type && (
                  <span className="rounded-full bg-white border border-gray-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    {patient.case_type}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function Apps() {
  const navigate = useNavigate()
  const [patients, setPatients] = useState([])
  const [selectedApp, setSelectedApp] = useState('genogram')
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch('/patients')
      .then(async (res) => {
        const body = await res.json().catch(() => [])
        if (!res.ok) throw new Error(body?.error || 'Unable to load clients')
        if (!cancelled) {
          setPatients(Array.isArray(body) ? body : [])
          if (Array.isArray(body) && body.length > 0) setSelectedPatientId(body[0].id)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load clients')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const selected = APP_CATALOG.find((app) => app.id === selectedApp) || APP_CATALOG[0]
  const selectedPatient = patients.find((patient) => Number(patient.id) === Number(selectedPatientId))

  function launch() {
    if (selected.id === 'genogram' && selectedPatientId) {
      navigate(`/patients/${selectedPatientId}/genogram`)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] font-bold text-brand-600 uppercase tracking-[0.18em]">Miwa Apps</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Apps</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Launch focused clinical tools and save their work back to the client profile.
          </p>
        </div>
        <Link to="/patients" className="btn-secondary text-xs">Manage Clients</Link>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
        <section className="space-y-4">
          {APP_CATALOG.map((app) => {
            const active = selectedApp === app.id
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => setSelectedApp(app.id)}
                className={`w-full text-left card overflow-hidden transition-all ${
                  active ? 'ring-2 ring-teal-400 ring-offset-2' : 'hover:-translate-y-0.5'
                }`}
              >
                <div className="p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="rounded-2xl bg-teal-50 border border-teal-100 p-3">
                        <AppGlyph />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[11px] font-bold text-teal-700 uppercase tracking-[0.16em]">{app.eyebrow}</p>
                          <span className="rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                            {app.status}
                          </span>
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 mt-1">{app.name}</h2>
                        <p className="text-sm text-gray-600 leading-relaxed mt-2 max-w-2xl">{app.description}</p>
                      </div>
                    </div>
                    {active && (
                      <span className="rounded-full bg-brand-600 text-white px-3 py-1 text-xs font-bold">
                        Selected
                      </span>
                    )}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {app.features.map((feature) => (
                      <span key={feature} className="rounded-full bg-gray-50 border border-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            )
          })}

          <div className="rounded-2xl border border-dashed border-gray-200 bg-white/70 p-5">
            <p className="text-sm font-bold text-gray-900">More apps can live here next.</p>
            <p className="text-sm text-gray-500 mt-1">
              Assessment builders, safety-plan tools, ecomaps, treatment-plan helpers, and trainee learning tools can use the same app launcher pattern.
            </p>
          </div>
        </section>

        <aside className="space-y-4">
          {loading ? (
            <div className="card p-6 text-sm text-gray-500">Loading clients...</div>
          ) : patients.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-sm font-bold text-gray-900">Add a client first</p>
              <p className="text-sm text-gray-500 mt-1">Apps save their work back to a client chart.</p>
              <Link to="/patients" className="mt-4 btn-primary text-xs">Open Patients</Link>
            </div>
          ) : (
            <>
              <ClientPicker
                patients={patients}
                query={query}
                setQuery={setQuery}
                selectedId={selectedPatientId}
                setSelectedId={setSelectedPatientId}
              />
              <div className="card p-5">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.16em]">Launch</p>
                <h2 className="text-base font-bold text-gray-900 mt-1">{selected.name}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {selectedPatient
                    ? `This will open ${selected.name} for ${clientLabel(selectedPatient)} and save to that client profile.`
                    : 'Choose a client to continue.'}
                </p>
                <button
                  type="button"
                  onClick={launch}
                  disabled={!selectedPatientId}
                  className="mt-4 btn-primary w-full justify-center"
                >
                  Open {selected.name}
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
