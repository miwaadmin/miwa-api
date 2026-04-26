import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

/**
 * Contacts — a therapist's private professional referral network.
 *
 * Each contact is a person (not an organization): detective, psychiatrist,
 * attorney, advocate, supervisor, housing coordinator, another therapist
 * for consultation. Pinned contacts show first. Full CRUD.
 */

const CATEGORIES = [
  { id: 'law_enforcement', label: 'Law Enforcement', color: '#1e40af' },
  { id: 'psychiatry',      label: 'Psychiatry',      color: '#7c3aed' },
  { id: 'legal',           label: 'Legal',           color: '#b45309' },
  { id: 'advocacy',        label: 'Advocacy',        color: '#be185d' },
  { id: 'medical',         label: 'Medical',         color: '#059669' },
  { id: 'housing',         label: 'Housing',         color: '#0891b2' },
  { id: 'supervision',     label: 'Supervision',     color: '#6d28d9' },
  { id: 'other',           label: 'Other',           color: '#6b7280' },
]

const EMPTY = {
  name: '', title: '', agency: '', specialty: '',
  email: '', phone: '', category: 'other', notes: '', pinned: false, public: false,
}

function CategoryBadge({ cat }) {
  const c = CATEGORIES.find(x => x.id === cat) || CATEGORIES[CATEGORIES.length - 1]
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: `${c.color}18`, color: c.color, border: `1px solid ${c.color}33` }}
    >
      {c.label}
    </span>
  )
}

function ContactCard({ c, onEdit, onDelete, onTogglePin }) {
  const initials = (c.name || '?').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  const catColor = (CATEGORIES.find(x => x.id === c.category) || CATEGORIES[CATEGORIES.length - 1]).color

  return (
    <div className="rounded-2xl bg-white border border-gray-200 p-4 hover:shadow-md transition-all">
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm"
          style={{ background: `linear-gradient(135deg, ${catColor}, ${catColor}aa)` }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5 flex-wrap">
            <p className="font-bold text-gray-900 leading-tight truncate">{c.name}</p>
            {c.pinned ? (
              <span className="text-amber-500" title="Pinned">★</span>
            ) : null}
            {c.public ? (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200" title="Visible on public /network page">
                Public
              </span>
            ) : null}
          </div>
          {(c.title || c.agency) && (
            <p className="text-xs text-gray-600 truncate">
              {[c.title, c.agency].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="mt-1.5"><CategoryBadge cat={c.category} /></div>
        </div>
      </div>

      {c.specialty && (
        <p className="text-xs text-gray-500 italic mb-2 leading-relaxed">
          {c.specialty}
        </p>
      )}

      <div className="space-y-1 mb-3">
        {c.email && (
          <a href={`mailto:${c.email}`} className="block text-[13px] text-indigo-700 hover:underline truncate">
            ✉ {c.email}
          </a>
        )}
        {c.phone && (
          <a href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`} className="block text-[13px] text-indigo-700 hover:underline">
            📞 {c.phone}
          </a>
        )}
      </div>

      {c.notes && (
        <p className="text-xs text-gray-600 leading-relaxed bg-gray-50 rounded-lg px-3 py-2 mb-3 border border-gray-100">
          {c.notes}
        </p>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
        <button
          onClick={() => onTogglePin(c)}
          className={`text-[11px] font-semibold px-2 py-1 rounded-lg transition ${
            c.pinned
              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {c.pinned ? '★ Unpin' : '☆ Pin'}
        </button>
        <button
          onClick={() => onEdit(c)}
          className="text-[11px] font-semibold text-gray-600 hover:text-gray-900 px-2 py-1 rounded-lg hover:bg-gray-100"
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(c)}
          className="text-[11px] font-semibold text-red-600 hover:text-red-800 px-2 py-1 rounded-lg hover:bg-red-50 ml-auto"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function EditModal({ contact, onSave, onClose }) {
  const [form, setForm] = useState(contact || EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name?.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      await onSave(form)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <form onSubmit={handleSave}>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">
              {contact?.id ? 'Edit contact' : 'Add contact'}
            </h2>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1 rounded">✕</button>
          </div>
          <div className="p-5 space-y-3">
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

            <Field label="Name" required>
              <input value={form.name} onChange={e => update('name', e.target.value)} className="input" placeholder="Detective Marie Sadanaga" autoFocus />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Title">
                <input value={form.title || ''} onChange={e => update('title', e.target.value)} className="input" placeholder="Detective, DV/SA Unit" />
              </Field>
              <Field label="Agency / Practice">
                <input value={form.agency || ''} onChange={e => update('agency', e.target.value)} className="input" placeholder="LAPD" />
              </Field>
            </div>

            <Field label="Specialty">
              <input value={form.specialty || ''} onChange={e => update('specialty', e.target.value)} className="input" placeholder="IPV and sexual assault cases" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Email">
                <input type="email" value={form.email || ''} onChange={e => update('email', e.target.value)} className="input" placeholder="name@agency.org" />
              </Field>
              <Field label="Phone">
                <input value={form.phone || ''} onChange={e => update('phone', e.target.value)} className="input" placeholder="(555) 123-4567" />
              </Field>
            </div>

            <Field label="Category">
              <select value={form.category} onChange={e => update('category', e.target.value)} className="input bg-white">
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>

            <Field label="Notes">
              <textarea
                rows={3}
                value={form.notes || ''}
                onChange={e => update('notes', e.target.value)}
                className="input"
                placeholder="How you know them, when to reach out, response times…"
              />
            </Field>

            <div className="space-y-2 pt-1">
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={!!form.pinned}
                  onChange={e => update('pinned', e.target.checked)}
                  className="mt-0.5"
                />
                <span>Pin to top</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={!!form.public}
                  onChange={e => update('public', e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Show on the public <code className="text-[11px] bg-gray-100 px-1 rounded">/network</code> page
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Only name, title, agency, specialty, email, phone, and category will be shown. Your notes stay private.
                  </span>
                </span>
              </label>
            </div>
          </div>
          <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
            <button type="button" onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900 font-semibold px-3 py-2">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm px-5 py-2 disabled:opacity-50">
              {saving ? 'Saving…' : (contact?.id ? 'Save changes' : 'Add contact')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-700 block mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

export default function Contacts() {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const r = await apiFetch('/contacts')
      const d = await r.json()
      setContacts(Array.isArray(d.contacts) ? d.contacts : [])
    } catch {
      setContacts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async (form) => {
    const isEdit = !!form.id
    const r = await apiFetch(isEdit ? `/contacts/${form.id}` : '/contacts', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Save failed')
    setEditing(null)
    load()
  }

  const handleDelete = async (c) => {
    if (!window.confirm(`Delete ${c.name}?`)) return
    await apiFetch(`/contacts/${c.id}`, { method: 'DELETE' })
    load()
  }

  const handleTogglePin = async (c) => {
    await apiFetch(`/contacts/${c.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !c.pinned }),
    })
    load()
  }

  const filtered = contacts.filter(c => {
    if (filter !== 'all' && c.category !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      const hay = `${c.name} ${c.title || ''} ${c.agency || ''} ${c.specialty || ''} ${c.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return (
    <>
      <div className="max-w-[1200px] mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Trusted contacts</h1>
            <p className="text-sm text-gray-500">
              Your professional referral network — detectives, psychiatrists, attorneys, advocates, supervisors. Private to your account.
            </p>
          </div>
          <button
            onClick={() => setEditing(EMPTY)}
            className="btn-primary text-sm px-4 py-2"
          >
            + Add contact
          </button>
        </div>

        {/* Filter + search */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
              filter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            All ({contacts.length})
          </button>
          {CATEGORIES.map(c => {
            const count = contacts.filter(x => x.category === c.id).length
            if (count === 0) return null
            const active = filter === c.id
            return (
              <button
                key={c.id}
                onClick={() => setFilter(c.id)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                  active ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
                style={active ? { background: c.color } : {}}
              >
                {c.label} ({count})
              </button>
            )
          })}
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="ml-auto text-sm rounded-lg border border-gray-200 px-3 py-1.5 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none"
          />
        </div>

        {/* Grid */}
        {loading ? (
          <p className="text-sm text-gray-400 italic">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 p-10 text-center">
            <p className="text-sm text-gray-500 mb-4">
              {contacts.length === 0
                ? "You haven't added any contacts yet."
                : 'No contacts match your filter.'}
            </p>
            {contacts.length === 0 && (
              <button onClick={() => setEditing(EMPTY)} className="btn-primary text-sm px-4 py-2">
                + Add your first contact
              </button>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(c => (
              <ContactCard
                key={c.id}
                c={c}
                onEdit={setEditing}
                onDelete={handleDelete}
                onTogglePin={handleTogglePin}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EditModal contact={editing} onSave={handleSave} onClose={() => setEditing(null)} />
      )}
    </>
  )
}
