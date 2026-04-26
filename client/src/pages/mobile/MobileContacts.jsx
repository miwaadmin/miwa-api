/**
 * MobileContacts — native view of the therapist's trusted contacts.
 *
 * Stacks contact cards in a mobile-friendly list with category chips
 * up top and a search bar. Tap a card to expand inline (notes, email,
 * phone with tap-to-call / tap-to-email links). "+" FAB opens an Add
 * Contact sheet.
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'

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

function catMeta(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1]
}

function initials(name) {
  return (name || '?').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

function ContactRow({ c, expanded, onToggle, onEdit, onDelete, onTogglePin }) {
  const cat = catMeta(c.category)
  return (
    <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left active:bg-gray-50"
      >
        <div
          className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm"
          style={{ background: `linear-gradient(135deg, ${cat.color}, ${cat.color}cc)` }}
        >
          {initials(c.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
            {c.pinned ? <span className="text-amber-500 flex-shrink-0">★</span> : null}
            {c.public ? (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0">
                Public
              </span>
            ) : null}
          </div>
          {(c.title || c.agency) && (
            <p className="text-[11px] text-gray-500 truncate">
              {[c.title, c.agency].filter(Boolean).join(' · ')}
            </p>
          )}
          <span
            className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mt-1"
            style={{ background: `${cat.color}18`, color: cat.color, border: `1px solid ${cat.color}33` }}
          >
            {cat.label}
          </span>
        </div>
        <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-3">
          {c.specialty && (
            <p className="text-[12px] text-gray-600 italic leading-relaxed">{c.specialty}</p>
          )}

          <div className="space-y-2">
            {c.email && (
              <a href={`mailto:${c.email}`}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-gray-200 active:bg-gray-100 min-h-[44px]">
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-brand-700 truncate">{c.email}</span>
              </a>
            )}
            {c.phone && (
              <a href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-gray-200 active:bg-gray-100 min-h-[44px]">
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <span className="text-sm text-brand-700">{c.phone}</span>
              </a>
            )}
          </div>

          {c.notes && (
            <div className="rounded-xl bg-white border border-gray-200 px-3 py-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Notes</p>
              <p className="text-[13px] text-gray-700 leading-relaxed">{c.notes}</p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onTogglePin(c)}
              className={`flex-1 text-xs font-semibold px-3 py-2.5 rounded-xl min-h-[40px] ${
                c.pinned ? 'bg-amber-100 text-amber-700 active:bg-amber-200' : 'bg-white text-gray-600 border border-gray-200 active:bg-gray-50'
              }`}
            >
              {c.pinned ? '★ Unpin' : '☆ Pin'}
            </button>
            <button
              onClick={() => onEdit(c)}
              className="flex-1 text-xs font-semibold text-gray-700 bg-white border border-gray-200 active:bg-gray-50 px-3 py-2.5 rounded-xl min-h-[40px]"
            >
              Edit
            </button>
            <button
              onClick={() => onDelete(c)}
              className="text-xs font-semibold text-red-700 bg-white border border-red-200 active:bg-red-50 px-3 py-2.5 rounded-xl min-h-[40px]"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function EditSheet({ contact, onSave, onClose }) {
  const [form, setForm] = useState(contact || EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name?.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    try {
      await onSave(form)
    } catch (err) {
      setError(err.message)
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <form onSubmit={handleSave}>
          <div className="sticky top-0 bg-white px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <button type="button" onClick={onClose} className="text-sm text-gray-500 px-2">Cancel</button>
            <h2 className="text-base font-bold text-gray-900">{contact?.id ? 'Edit contact' : 'Add contact'}</h2>
            <button type="submit" disabled={saving} className="text-sm font-bold text-brand-600 px-2 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          <div className="p-5 space-y-3">
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

            <Field label="Name" required>
              <input value={form.name} onChange={e => update('name', e.target.value)} className="input" placeholder="Detective Marie Sadanaga" autoFocus />
            </Field>
            <Field label="Title">
              <input value={form.title || ''} onChange={e => update('title', e.target.value)} className="input" placeholder="Detective, DV/SA Unit" />
            </Field>
            <Field label="Agency / Practice">
              <input value={form.agency || ''} onChange={e => update('agency', e.target.value)} className="input" placeholder="LAPD" />
            </Field>
            <Field label="Specialty">
              <input value={form.specialty || ''} onChange={e => update('specialty', e.target.value)} className="input" placeholder="IPV and sexual assault cases" />
            </Field>
            <Field label="Email">
              <input type="email" inputMode="email" autoCapitalize="none" value={form.email || ''} onChange={e => update('email', e.target.value)} className="input" placeholder="name@agency.org" />
            </Field>
            <Field label="Phone">
              <input type="tel" inputMode="tel" value={form.phone || ''} onChange={e => update('phone', e.target.value)} className="input" placeholder="(555) 123-4567" />
            </Field>
            <Field label="Category">
              <select value={form.category} onChange={e => update('category', e.target.value)} className="input bg-white">
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Notes">
              <textarea rows={3} value={form.notes || ''} onChange={e => update('notes', e.target.value)} className="input" placeholder="How you know them, response times…" />
            </Field>

            <div className="space-y-2 pt-2">
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={!!form.pinned} onChange={e => update('pinned', e.target.checked)} className="mt-0.5" />
                Pin to top
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={!!form.public} onChange={e => update('public', e.target.checked)} className="mt-0.5" />
                <span>
                  Show on public /network page
                  <span className="block text-xs text-gray-500 mt-0.5">Notes stay private; only name, title, agency, specialty, email, phone, category are visible publicly.</span>
                </span>
              </label>
            </div>
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

export default function MobileContacts() {
  const navigate = useNavigate()
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

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
    <div className="flex flex-col h-full bg-gray-50">
      <div className="px-4 py-3 bg-white border-b border-gray-100 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Contacts</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">Your trusted referral network</p>
        </div>
        <button
          onClick={() => navigate('/m/more')}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 active:bg-gray-100"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {contacts.length > 0 && (
        <div className="bg-white px-4 pt-3 pb-3 border-b border-gray-100">
          <input
            type="search"
            inputMode="search"
            placeholder="Search contacts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-[15px] bg-gray-50 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
          />
          <div className="flex gap-2 overflow-x-auto no-scrollbar mt-3 -mx-1 px-1">
            <button
              onClick={() => setFilter('all')}
              className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                filter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'
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
                  className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                    active ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200'
                  }`}
                  style={active ? { background: c.color } : {}}
                >
                  {c.label} ({count})
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 pb-28">
        {loading ? (
          <p className="text-sm text-gray-400 italic text-center pt-8">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center pt-10">
            <p className="text-sm text-gray-600 font-semibold mb-1">
              {contacts.length === 0 ? "You haven't added any contacts yet." : 'No contacts match your filter.'}
            </p>
            {contacts.length === 0 && (
              <button onClick={() => setEditing(EMPTY)} className="mt-4 rounded-xl bg-brand-600 text-white text-sm font-bold px-5 py-3 active:bg-brand-700">
                + Add your first contact
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(c => (
              <ContactRow
                key={c.id}
                c={c}
                expanded={expandedId === c.id}
                onToggle={() => setExpandedId(prev => prev === c.id ? null : c.id)}
                onEdit={() => { setEditing(c); setExpandedId(null) }}
                onDelete={handleDelete}
                onTogglePin={handleTogglePin}
              />
            ))}
          </div>
        )}
      </div>

      {/* FAB */}
      {contacts.length > 0 && (
        <button
          onClick={() => setEditing(EMPTY)}
          className="fixed right-4 z-30 w-14 h-14 rounded-full flex items-center justify-center shadow-xl active:scale-95 transition-transform"
          style={{
            bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
            background: 'linear-gradient(135deg, #6047EE, #2dd4bf)',
          }}
          aria-label="Add contact"
        >
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}

      {editing && (
        <EditSheet contact={editing} onSave={handleSave} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
