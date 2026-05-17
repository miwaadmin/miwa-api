import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'

function formatDate(dateStr) {
  if (!dateStr) return null
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return null
  }
}

function getInitials(name) {
  if (!name) return '??'
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
}

const COLORS = [
  'bg-indigo-100 text-indigo-600',
  'bg-emerald-100 text-emerald-600',
  'bg-amber-100 text-amber-600',
  'bg-rose-100 text-rose-600',
  'bg-cyan-100 text-cyan-600',
  'bg-violet-100 text-violet-600',
  'bg-orange-100 text-orange-600',
  'bg-teal-100 text-teal-600',
]

function nameColor(name) {
  let hash = 0
  for (let i = 0; i < (name || '').length; i += 1) hash = (hash + name.charCodeAt(i)) * 31
  return COLORS[Math.abs(hash) % COLORS.length]
}

const blankForm = {
  display_name: '',
  client_type: 'individual',
  phone: '',
  email: '',
  presenting_concerns: '',
}

export default function MobileClients() {
  const navigate = useNavigate()
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creatingDemo, setCreatingDemo] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(blankForm)

  const loadPatients = () => {
    setLoading(true)
    apiFetch('/patients')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load clients.')))
      .then(data => setPatients(Array.isArray(data) ? data : []))
      .catch(err => setError(err.message || 'Could not load clients.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadPatients() }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return patients
    const q = search.toLowerCase()
    return patients.filter(p =>
      (p.client_id || '').toLowerCase().includes(q) ||
      (p.display_name || '').toLowerCase().includes(q) ||
      (p.presenting_concerns || '').toLowerCase().includes(q)
    )
  }, [patients, search])

  const saveClient = async () => {
    if (!form.display_name.trim()) {
      setError('Add a client name before saving.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/patients', {
        method: 'POST',
        body: JSON.stringify({
          display_name: form.display_name.trim(),
          client_type: form.client_type,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          presenting_concerns: form.presenting_concerns.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not create client.')
      setShowNew(false)
      setForm(blankForm)
      navigate(`/m/clients/${data.id}`)
    } catch (err) {
      setError(err.message || 'Could not create client.')
    } finally {
      setSaving(false)
    }
  }

  const createDemoPatient = async () => {
    setCreatingDemo(true)
    setError('')
    try {
      const res = await apiFetch('/seed/demo-patient', { method: 'POST', body: JSON.stringify({}) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not create demo patient.')
      const patientId = data.patient?.id || data.patient_id || data.id
      if (patientId) navigate(`/m/clients/${patientId}`)
      else loadPatients()
    } catch (err) {
      setError(err.message || 'Could not create demo patient.')
    } finally {
      setCreatingDemo(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 py-3">
        {error && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
            {error}
          </div>
        )}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients..."
            className="mobile-input h-12 pl-9"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-gray-300 text-white"
              aria-label="Clear search"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {!loading && (
          <div className="mt-2 flex items-center justify-between gap-3 px-1">
            <p className="text-xs text-gray-400">
              {filtered.length} client{filtered.length !== 1 ? 's' : ''}
            </p>
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="min-h-[40px] rounded-full bg-brand-600 px-3 text-xs font-bold text-white"
            >
              + New client
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <svg className="mb-3 h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm text-gray-500">{search ? 'No clients match your search' : 'No clients yet'}</p>
            {!search && (
              <div className="mt-5 flex w-full max-w-xs flex-col gap-3">
                <button type="button" onClick={() => setShowNew(true)} className="mobile-primary-button">
                  Add your first client
                </button>
                <button
                  type="button"
                  onClick={createDemoPatient}
                  disabled={creatingDemo}
                  className="min-h-[48px] rounded-[14px] border border-gray-200 bg-white text-sm font-bold text-gray-700 disabled:opacity-60"
                >
                  {creatingDemo ? 'Creating demo patient...' : 'Create demo patient'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(patient => {
              const name = patient.display_name || patient.client_id || 'Unknown'
              const initials = getInitials(name)
              const lastDate = formatDate(patient.last_session_date || patient.updated_at)
              return (
                <button
                  key={patient.id}
                  onClick={() => navigate(`/m/clients/${patient.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-gray-50"
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${nameColor(name)}`}>
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-gray-900">
                        {name}
                        {patient.is_sample && (
                          <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700">
                            Sample
                          </span>
                        )}
                      </p>
                      {lastDate && <span className="shrink-0 text-[11px] text-gray-400">{lastDate}</span>}
                    </div>
                    {patient.presenting_concerns && (
                      <p className="mt-0.5 truncate text-xs text-gray-500">{patient.presenting_concerns}</p>
                    )}
                  </div>
                  <svg className="h-4 w-4 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {showNew && (
        <div className="mobile-modal-backdrop fixed inset-0 z-50 flex items-end bg-black/45">
          <div className="mobile-modal-sheet flex max-h-[86dvh] w-full flex-col rounded-t-3xl shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-lg font-bold text-gray-900">New client</h2>
              <button type="button" onClick={() => setShowNew(false)} className="h-10 w-10 rounded-full text-gray-500 active:bg-gray-100" aria-label="Close new client">
                x
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Client name</span>
                <input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="Client display name" className="mobile-input" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Client type</span>
                <select value={form.client_type} onChange={e => setForm(f => ({ ...f, client_type: e.target.value }))} className="mobile-input">
                  <option value="individual">Individual</option>
                  <option value="couple">Couple</option>
                  <option value="family">Family</option>
                  <option value="child">Child / adolescent</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Phone</span>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Optional" inputMode="tel" className="mobile-input" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Email</span>
                <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Optional" inputMode="email" className="mobile-input" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Presenting concerns</span>
                <textarea value={form.presenting_concerns} onChange={e => setForm(f => ({ ...f, presenting_concerns: e.target.value }))} placeholder="Brief clinical context..." rows={3} className="mobile-input resize-none" />
              </label>
            </div>
            <div className="shrink-0 border-t border-gray-100 px-5 pt-3" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))' }}>
              <button type="button" onClick={saveClient} disabled={saving} className="mobile-primary-button">
                {saving ? 'Saving...' : 'Save client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
