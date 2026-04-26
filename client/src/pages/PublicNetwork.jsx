import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'

/**
 * PublicNetwork — a public-facing directory of professionals in Miwa's
 * extended network. Each person listed has been added by a clinician
 * using Miwa and explicitly flagged as safe to share publicly.
 *
 * Shown fields are safe for a public directory: name, title, agency,
 * specialty, email, phone, category. Notes (which can be personal) are
 * NEVER exposed publicly.
 */

const CATEGORIES = [
  { id: 'all',              label: 'All' },
  { id: 'law_enforcement',  label: 'Law Enforcement', color: '#1e40af' },
  { id: 'psychiatry',       label: 'Psychiatry',      color: '#7c3aed' },
  { id: 'legal',            label: 'Legal',           color: '#b45309' },
  { id: 'advocacy',         label: 'Advocacy',        color: '#be185d' },
  { id: 'medical',          label: 'Medical',         color: '#059669' },
  { id: 'housing',          label: 'Housing',         color: '#0891b2' },
  { id: 'supervision',      label: 'Supervision',     color: '#6d28d9' },
  { id: 'other',            label: 'Other',           color: '#6b7280' },
]

function CategoryPill({ cat }) {
  const c = CATEGORIES.find(x => x.id === cat) || CATEGORIES[CATEGORIES.length - 1]
  if (c.id === 'all') return null
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: `${c.color}15`, color: c.color, border: `1px solid ${c.color}33` }}
    >
      {c.label}
    </span>
  )
}

function Card({ c }) {
  const initials = (c.name || '?').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  const catColor = (CATEGORIES.find(x => x.id === c.category) || CATEGORIES[CATEGORIES.length - 1]).color || '#6b7280'

  return (
    <div className="rounded-2xl bg-white border border-gray-200 p-5 hover:shadow-md transition-all">
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold"
          style={{ background: `linear-gradient(135deg, ${catColor}, ${catColor}aa)` }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 leading-tight text-base">{c.name}</p>
          {(c.title || c.agency) && (
            <p className="text-sm text-gray-600">
              {[c.title, c.agency].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="mt-1.5"><CategoryPill cat={c.category} /></div>
        </div>
      </div>

      {c.specialty && (
        <p className="text-[13px] text-gray-600 leading-relaxed mb-3">
          {c.specialty}
        </p>
      )}

      <div className="space-y-1 pt-2 border-t border-gray-100">
        {c.email && (
          <a href={`mailto:${c.email}`} className="block text-sm text-indigo-700 hover:underline truncate">
            ✉ {c.email}
          </a>
        )}
        {c.phone && (
          <a href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`} className="block text-sm text-indigo-700 hover:underline">
            📞 {c.phone}
          </a>
        )}
      </div>
    </div>
  )
}

export default function PublicNetwork() {
  const [contacts, setContacts] = useState(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/public/network')
      .then(r => r.json())
      .then(d => setContacts(Array.isArray(d.contacts) ? d.contacts : []))
      .catch(() => setContacts([]))
  }, [])

  const filtered = useMemo(() => {
    if (!contacts) return []
    return contacts.filter(c => {
      if (filter !== 'all' && c.category !== filter) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = `${c.name} ${c.title || ''} ${c.agency || ''} ${c.specialty || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [contacts, filter, search])

  const countsByCategory = useMemo(() => {
    const counts = { all: (contacts || []).length }
    for (const c of (contacts || [])) {
      counts[c.category] = (counts[c.category] || 0) + 1
    }
    return counts
  }, [contacts])

  return (
    <PublicPageShell>
      <PublicNav />

      <div className="max-w-[1200px] mx-auto px-6 pt-32 pb-24">
        {/* Hero */}
        <div className="text-center mb-10">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-3">
            Our network
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 mb-4 leading-tight">
            People we trust to refer to.
          </h1>
          <p className="text-gray-700 text-lg max-w-2xl mx-auto leading-relaxed">
            Detectives, advocates, psychiatrists, attorneys, and other professionals vouched for by clinicians using Miwa. Each person here was added and flagged as public by a clinician who has worked with them directly.
          </p>
          <p className="text-gray-400 text-sm max-w-xl mx-auto mt-3 italic">
            Miwa does not vet or employ these professionals. We share their contact info here because someone in our network said they're worth knowing.
          </p>
        </div>

        {/* Filter + search */}
        {contacts && contacts.length > 0 && (
          <div className="flex items-center gap-2 mb-8 flex-wrap">
            {CATEGORIES.map(c => {
              const count = c.id === 'all' ? countsByCategory.all : (countsByCategory[c.id] || 0)
              if (c.id !== 'all' && count === 0) return null
              const active = filter === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => setFilter(c.id)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                    active ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                  style={active ? { background: c.color || '#111' } : {}}
                >
                  {c.label} ({count})
                </button>
              )
            })}
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, agency, or specialty…"
              className="ml-auto text-sm rounded-lg border border-gray-200 px-3 py-1.5 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none min-w-[240px]"
            />
          </div>
        )}

        {/* Grid */}
        {contacts === null ? (
          <p className="text-sm text-gray-400 italic text-center py-12">Loading network…</p>
        ) : contacts.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center">
            <p className="text-base text-gray-600 font-semibold mb-1">
              No contacts published yet.
            </p>
            <p className="text-sm text-gray-500">
              Clinicians using Miwa can mark contacts as public — they'll appear here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500 italic text-center py-12">
            No matches. Try a different filter or clear your search.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(c => <Card key={c.id} c={c} />)}
          </div>
        )}

        {/* Footer CTA */}
        <div className="mt-16 pt-10 border-t border-gray-200 text-center">
          <p className="text-sm text-gray-500 mb-4 max-w-xl mx-auto leading-relaxed">
            Are you a clinician who'd like to add a trusted colleague to the public network? Create a Miwa account, add them to your Contacts, and toggle "Show on public network."
          </p>
          <Link
            to="/register"
            className="inline-flex px-6 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90"
            style={{ background: '#111113' }}
          >
            Create a Miwa account
          </Link>
        </div>
      </div>

      <PublicFooter />
    </PublicPageShell>
  )
}
