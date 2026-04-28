import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { patientInitials } from '../lib/avatar'

function formatDate(dateStr) {
  if (!dateStr) return null
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return null }
}

const CLIENT_TYPE_DEFAULTS = {
  individual: [],
  couple: ['Soul-1', 'Soul-2'],
  family: ['Soul-1', 'Soul-2', 'Soul-3'],
}

function PatientModal({ patient, onClose, onSave }) {
  const defaultMembers = (() => {
    if (!patient?.members) return CLIENT_TYPE_DEFAULTS[patient?.client_type || 'individual'] || []
    try {
      const parsed = JSON.parse(patient.members)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })()
  const [form, setForm] = useState(
    patient || { client_id: '', first_name: '', last_name: '', age: '', gender: '', presenting_concerns: '', diagnoses: '', notes: '', client_type: 'individual', display_name: '', phone: '' }
  )
  const [members, setMembers] = useState(defaultMembers)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const clientType = form.client_type || 'individual'

  const handleTypeChange = (type) => {
    setForm(f => ({ ...f, client_type: type }))
    setMembers(CLIENT_TYPE_DEFAULTS[type] || [])
  }

  const addSoul = () => setMembers(m => [...m, `Soul-${m.length + 1}`])
  const removeSoul = (i) => setMembers(m => m.filter((_, idx) => idx !== i))
  const renameSoul = (i, val) => setMembers(m => m.map((s, idx) => idx === i ? val : s))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const method = patient ? 'PUT' : 'POST'
      const url = patient ? `/patients/${patient.id}` : `/patients`
      const payload = {
        ...form,
        age: form.age ? parseInt(form.age) : null,
        members: clientType !== 'individual' ? JSON.stringify(members) : null,
      }
      const res = await apiFetch(url, { method, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      onSave(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-gray-900">{patient ? 'Edit Client' : 'Add New Client'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {/* Client Type */}
          <div>
            <label className="label">Client Type</label>
            <div className="flex gap-2">
              {[['individual','Individual'],['couple','Couple'],['family','Family']].map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => handleTypeChange(val)}
                  className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium border transition-colors ${
                    clientType === val
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {clientType === 'individual' && (
              <>
                <div>
                  <label className="label">First name</label>
                  <input
                    className="input"
                    value={form.first_name || ''}
                    onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                    placeholder="e.g. Sarah"
                    autoComplete="given-name"
                  />
                </div>
                <div>
                  <label className="label">Last name</label>
                  <input
                    className="input"
                    value={form.last_name || ''}
                    onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                    placeholder="e.g. Martinez"
                    autoComplete="family-name"
                  />
                </div>
              </>
            )}
            <div className="col-span-2">
              <label className="label">Chart code <span className="text-xs font-normal text-gray-400">(optional)</span></label>
              <input
                className="input"
                value={form.client_id || ''}
                onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}
                placeholder={clientType === 'individual' ? 'e.g. CLT-001' : clientType === 'couple' ? 'e.g. CPL-001' : 'e.g. FAM-001'}
              />
              <p className="text-xs text-gray-400 mt-1">Miwa creates one automatically if left blank.</p>
            </div>

            {/* Display name — used in UI and by Miwa agent, never sent to AI */}
            <div>
              <label className="label">
                {clientType === 'individual' ? 'Preferred name' : clientType === 'couple' ? 'Couple label' : 'Family label'}
                <span className="ml-1 text-xs font-normal text-gray-400">{clientType === 'individual' ? '(optional)' : '(for Miwa)'}</span>
              </label>
              <input
                className="input"
                value={form.display_name || ''}
                onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                placeholder={clientType === 'individual' ? 'e.g. "Sarah"' : clientType === 'couple' ? 'e.g. "Sarah and Alex"' : 'e.g. "The Garcias"'}
              />
              <p className="text-xs text-gray-400 mt-1">{clientType === 'individual' ? 'Used in Miwa screens when different from legal name.' : 'How this couple or family appears in your caseload.'}</p>
            </div>

            {/* Phone for SMS assessment delivery */}
            <div>
              <label className="label">
                Mobile number
                <span className="ml-1 text-xs font-normal text-gray-400">(SMS assessments)</span>
              </label>
              <input
                className="input"
                type="tel"
                value={form.phone || ''}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="(555) 123-4567"
              />
              <p className="text-xs text-gray-400 mt-1">Used only to send assessment links.</p>
            </div>
            {clientType === 'individual' && (
              <>
                <div>
                  <label className="label">Age</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="120"
                    value={form.age || ''}
                    onChange={e => setForm(f => ({ ...f, age: e.target.value }))}
                    placeholder="e.g. 34"
                  />
                </div>
                <div>
                  <label className="label">Gender</label>
                  <select
                    className="input"
                    value={form.gender || ''}
                    onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}
                  >
                    <option value="">Select...</option>
                    <option>Male</option>
                    <option>Female</option>
                    <option>Non-binary</option>
                    <option>Transgender male</option>
                    <option>Transgender female</option>
                    <option>Gender fluid</option>
                    <option>Prefer not to say</option>
                    <option>Other</option>
                  </select>
                </div>
              </>
            )}
          </div>

          {/* Souls — for couple / family */}
          {clientType !== 'individual' && (
            <div>
              <label className="label">
                Souls
                <span className="ml-1 text-xs font-normal text-gray-400">(each member tracked individually)</span>
              </label>
              <div className="space-y-2">
                {members.map((soul, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className="input flex-1"
                      value={soul}
                      onChange={e => renameSoul(i, e.target.value)}
                      placeholder={`Soul-${i + 1}`}
                    />
                    {members.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSoul(i)}
                        className="p-2 text-gray-300 hover:text-red-400 transition-colors"
                        title="Remove"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addSoul}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add soul
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="label">Presenting Concerns</label>
            <textarea
              className="textarea"
              rows={3}
              value={form.presenting_concerns || ''}
              onChange={e => setForm(f => ({ ...f, presenting_concerns: e.target.value }))}
              placeholder="e.g. Anxiety, depression, relationship conflict, trauma history..."
            />
          </div>
          <div>
            <label className="label">Current Diagnoses</label>
            <textarea
              className="textarea"
              rows={2}
              value={form.diagnoses || ''}
              onChange={e => setForm(f => ({ ...f, diagnoses: e.target.value }))}
              placeholder="e.g. F41.1 GAD, F32.1 MDD, moderate"
            />
          </div>
          <div>
            <label className="label">Additional Notes</label>
            <textarea
              className="textarea"
              rows={2}
              value={form.notes || ''}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Relevant history, cultural considerations, family context..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : patient ? 'Save Changes' : 'Add Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Patients() {
  const [patients, setPatients] = useState([])
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('recent') // 'recent' | 'name' | 'sessions'
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | 'add' | patient object
  const [selected, setSelected] = useState(new Set())
  const [deleting, setDeleting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const navigate = useNavigate()

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const selectAll = () => setSelected(new Set(sortedPatients.map(p => p.id)))
  const selectNone = () => setSelected(new Set())

  const handleBatchDelete = async () => {
    if (selected.size === 0) return
    if (!confirm(`Archive ${selected.size} client(s)? Miwa keeps retained clinical records but removes them from your active caseload.`)) return
    setDeleting(true)
    try {
      const res = await apiFetch('/patients/batch', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [...selected] }),
      })
      const data = await res.json()
      if (res.ok) {
        setSelected(new Set())
        load(search)
      } else {
        alert(data.error || 'Delete failed')
      }
    } catch (err) {
      alert(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const load = useCallback(async (q = '') => {
    setLoading(true)
    setLoadError('')
    try {
      const url = q ? `/patients?search=${encodeURIComponent(q)}` : `/patients`
      const res = await apiFetch(url)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setPatients([])
        setLoadError(data?.error || `Unable to load clients (${res.status})`)
        return
      }
      setPatients(Array.isArray(data) ? data : [])
      if (!Array.isArray(data)) setLoadError('Unable to load clients. Please refresh and sign in again if needed.')
    } catch (err) {
      setPatients([])
      setLoadError(err.message || 'Unable to load clients')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => load(search), 300)
    return () => clearTimeout(timer)
  }, [search, load])

  const sortedPatients = (Array.isArray(patients) ? [...patients] : []).sort((a, b) => {
    if (sortBy === 'name') return (a.display_name || a.client_id || '').localeCompare(b.display_name || b.client_id || '')
    if (sortBy === 'sessions') return (b.session_count || 0) - (a.session_count || 0)
    // 'recent': patients with a last_session_date first, then by updated_at
    if (a.last_session_date && b.last_session_date)
      return new Date(b.last_session_date) - new Date(a.last_session_date)
    if (a.last_session_date) return -1
    if (b.last_session_date) return 1
    return new Date(b.updated_at) - new Date(a.updated_at)
  })

  const handleSave = (patient) => {
    setModal(null)
    load(search)
  }

  const handleDelete = async (patient) => {
    if (!confirm(`Archive ${patient.display_name || patient.client_id}? Miwa keeps retained clinical records but removes this client from your active caseload.`)) return
    try {
      const res = await apiFetch(`/patients/${patient.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || `Delete failed (${res.status})`)
        return
      }
      load(search)
    } catch (err) {
      alert(err.message || 'Delete failed. Please try again.')
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 relative min-w-48">
          <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            className="input pl-9"
            placeholder="Search by name, chart code, concerns, or diagnoses..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-auto text-sm"
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          title="Sort patients"
        >
          <option value="recent">Sort: Recent Session</option>
          <option value="name">Sort: Name A–Z</option>
          <option value="sessions">Sort: Most Sessions</option>
        </select>
        <button onClick={() => setModal('add')} className="btn-primary flex-shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Patient
        </button>
      </div>

      {/* Patient List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : patients.length === 0 ? (
        <div className="card p-12 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-gray-500 text-sm">{loadError || (search ? 'No patients match your search.' : 'No patients yet. Add your first patient.')}</p>
          {!search && (
            <button onClick={() => setModal('add')} className="mt-4 btn-primary mx-auto">
              Add First Patient
            </button>
          )}
        </div>
      ) : (
        <>
        {/* Batch action bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 mb-2">
            <input
              type="checkbox"
              checked={selected.size === sortedPatients.length}
              onChange={() => selected.size === sortedPatients.length ? selectNone() : selectAll()}
              className="w-4 h-4 rounded border-gray-300 text-indigo-600 accent-indigo-600"
            />
            <span className="text-sm font-semibold text-gray-700 flex-1">
              {selected.size} selected
            </span>
            <button onClick={selectNone} className="text-xs text-gray-500 hover:text-gray-700 font-medium">
              Deselect all
            </button>
            <button
              onClick={handleBatchDelete}
              disabled={deleting}
              className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {deleting ? 'Archiving...' : `Archive ${selected.size} client${selected.size > 1 ? 's' : ''}`}
            </button>
          </div>
        )}

        <div className="card divide-y divide-gray-50">
          {sortedPatients.map(patient => (
            <div key={patient.id} className={`flex items-center gap-4 px-5 py-4 hover:bg-gray-50/70 transition-colors group ${selected.has(patient.id) ? 'bg-indigo-50/50' : ''}`}>
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={selected.has(patient.id)}
                onChange={() => toggleSelect(patient.id)}
                className="w-4 h-4 rounded border-gray-300 text-indigo-600 accent-indigo-600 flex-shrink-0"
              />
              {/* Avatar */}
              <div
                className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0 cursor-pointer border border-brand-100"
                onClick={() => navigate(`/patients/${patient.id}`)}
              >
                <span className="text-sm font-bold text-brand-600">
                  {patientInitials(patient)}
                </span>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/patients/${patient.id}`)}>
                <div className="flex items-center gap-2 flex-wrap">
                  {patient.display_name ? (
                    <>
                      <span className="text-sm font-semibold text-gray-900">{patient.display_name}</span>
                      <span className="text-xs text-gray-400 font-mono">{patient.client_id}</span>
                    </>
                  ) : (
                    <span className="text-sm font-semibold text-gray-900">{patient.client_id}</span>
                  )}
                  {patient.client_type && patient.client_type !== 'individual' && (
                    <span className={`badge ${patient.client_type === 'couple' ? 'bg-violet-50 text-violet-600' : 'bg-teal-50 text-teal-600'}`}>
                      {patient.client_type === 'couple' ? 'Couple' : 'Family'}
                    </span>
                  )}
                  {patient.age && <span className="badge bg-gray-100 text-gray-500">Age {patient.age}</span>}
                  {patient.gender && <span className="badge bg-gray-100 text-gray-500">{patient.gender}</span>}
                  <span className="badge bg-gray-100 text-gray-500">
                    {patient.session_count || 0} session{patient.session_count !== 1 ? 's' : ''}
                  </span>
                </div>
                {patient.presenting_concerns && (
                  <p className="text-xs text-gray-400 truncate mt-0.5">{patient.presenting_concerns}</p>
                )}
                {patient.last_session_date && (
                  <p className="text-xs text-gray-300 mt-0.5">Last seen {formatDate(patient.last_session_date)}</p>
                )}
              </div>

              {/* Actions — subtle always, vivid on hover */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => navigate(`/patients/${patient.id}/sessions/new`)}
                  className="p-2 rounded-lg text-gray-300 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                  title="New Session"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
                <button
                  onClick={() => setModal(patient)}
                  className="p-2 rounded-lg text-gray-300 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                  title="Edit"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(patient)}
                  className="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Archive"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      {modal && (
        <PatientModal
          patient={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
