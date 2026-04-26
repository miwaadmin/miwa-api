import { useEffect, useMemo, useState } from 'react'
import { adminApiFetch } from '../../lib/api'
import { formatDate, AdminBanners } from './adminUtils'

const STATUS_COLORS = {
  new: 'bg-amber-100 text-amber-800 border-amber-200',
  read: 'bg-blue-100 text-blue-800 border-blue-200',
  resolved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
}
const CATEGORY_LABELS = {
  bug: { label: 'Bug', cls: 'bg-rose-100 text-rose-800 border-rose-200' },
  feature: { label: 'Feature', cls: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  general: { label: 'General', cls: 'bg-gray-100 text-gray-700 border-gray-200' },
}

export default function AdminSupport() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [support, setSupport] = useState(null)
  const [filter, setFilter] = useState('open') // 'open' | 'all' | 'new' | 'read' | 'resolved'
  const [busyId, setBusyId] = useState(null)
  const [draftResponse, setDraftResponse] = useState({}) // { [feedbackId]: text }

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await adminApiFetch('/admin/support')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load support')
      setSupport(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const allFeedback = support?.feedback || []
  const filteredFeedback = useMemo(() => {
    if (filter === 'all') return allFeedback
    if (filter === 'open') return allFeedback.filter(f => f.status !== 'resolved')
    return allFeedback.filter(f => f.status === filter)
  }, [allFeedback, filter])

  const counts = useMemo(() => ({
    all: allFeedback.length,
    open: allFeedback.filter(f => f.status !== 'resolved').length,
    new: allFeedback.filter(f => f.status === 'new').length,
    read: allFeedback.filter(f => f.status === 'read').length,
    resolved: allFeedback.filter(f => f.status === 'resolved').length,
  }), [allFeedback])

  const updateFeedback = async (id, body) => {
    setBusyId(id)
    try {
      const res = await adminApiFetch(`/admin/feedback/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Update failed')
      }
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading support…</div>

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Support</h2>
        <button onClick={load} className="btn-secondary text-sm">Refresh</button>
      </div>

      <AdminBanners error={error} />

      {/* ── User Feedback ────────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">User Feedback</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Bug reports, feature requests, and general feedback submitted through Miwa chat.
            </p>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {[
              ['open', `Open (${counts.open})`],
              ['new', `New (${counts.new})`],
              ['read', `Read (${counts.read})`],
              ['resolved', `Resolved (${counts.resolved})`],
              ['all', `All (${counts.all})`],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                  filter === key
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filteredFeedback.length === 0 ? (
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-10 text-center">
            <p className="text-sm text-gray-500">
              {filter === 'open' ? 'No open feedback. Inbox zero.' : 'No feedback in this view.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[40rem] overflow-y-auto">
            {filteredFeedback.map(item => {
              const cat = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.general
              const statusCls = STATUS_COLORS[item.status] || STATUS_COLORS.new
              return (
                <div key={item.id} className="border border-gray-200 rounded-xl p-4 bg-white">
                  <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cat.cls}`}>
                        {cat.label}
                      </span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusCls}`}>
                        {item.status || 'new'}
                      </span>
                      <span className="text-[10px] text-gray-500">via {item.source || 'chat'}</span>
                    </div>
                    <span className="text-[11px] text-gray-500">{formatDate(item.created_at)}</span>
                  </div>

                  <p className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">{item.message}</p>

                  <div className="mt-2 text-xs text-gray-500">
                    {item.therapist_name || item.therapist_email || `therapist_id=${item.therapist_id || '?'}`}
                  </div>

                  {item.admin_response && (
                    <div className="mt-3 rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2">
                      <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider mb-1">
                        Your reply {item.status === 'resolved' && item.resolved_at ? '(emailed to user)' : '(saved, will email when you Resolve)'}
                      </p>
                      <p className="text-xs text-indigo-900 whitespace-pre-wrap">{item.admin_response}</p>
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {item.status === 'new' && (
                      <button
                        type="button"
                        onClick={() => updateFeedback(item.id, { status: 'read' })}
                        disabled={busyId === item.id}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                      >
                        Mark Read
                      </button>
                    )}
                    {item.status !== 'resolved' && (
                      <button
                        type="button"
                        onClick={() => updateFeedback(item.id, { status: 'resolved' })}
                        disabled={busyId === item.id}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                      >
                        Resolve
                      </button>
                    )}
                    {item.status === 'resolved' && (
                      <button
                        type="button"
                        onClick={() => updateFeedback(item.id, { status: 'read' })}
                        disabled={busyId === item.id}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100 disabled:opacity-50 transition-colors"
                      >
                        Reopen
                      </button>
                    )}

                    <details className="ml-auto">
                      <summary className="text-xs font-semibold text-brand-600 hover:text-brand-700 cursor-pointer">
                        {item.admin_response ? 'Edit reply' : 'Reply to user'}
                      </summary>
                      <div className="mt-2 space-y-2">
                        <textarea
                          rows={3}
                          value={draftResponse[item.id] ?? item.admin_response ?? ''}
                          onChange={e => setDraftResponse(d => ({ ...d, [item.id]: e.target.value }))}
                          className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/20"
                          placeholder="Write a short reply — the user will receive this by email when you mark this Resolved…"
                        />
                        <p className="text-[10px] text-gray-500 leading-relaxed">
                          Saves the reply. Emails the user when you click <strong>Resolve</strong> (or now, if it's already resolved and you re-resolve below).
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateFeedback(item.id, { admin_response: draftResponse[item.id] ?? '' })}
                            disabled={busyId === item.id}
                            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-800 hover:bg-gray-200 disabled:opacity-50 transition-colors"
                          >
                            Save reply (no email)
                          </button>
                          <button
                            type="button"
                            onClick={() => updateFeedback(item.id, {
                              admin_response: draftResponse[item.id] ?? item.admin_response ?? '',
                              status: 'resolved',
                            })}
                            disabled={busyId === item.id}
                            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                          >
                            Save + Resolve + Email
                          </button>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Existing sections ───────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Flagged accounts</h2>
          <div className="space-y-3 max-h-[30rem] overflow-y-auto">
            {(support?.flagged_accounts || []).length === 0 && (
              <p className="text-xs text-gray-400 italic">No flagged accounts.</p>
            )}
            {(support?.flagged_accounts || []).map(account => (
              <div key={account.id} className="border border-gray-100 rounded-xl p-3">
                <p className="text-sm font-medium text-gray-900">{account.full_name || account.email}</p>
                <p className="text-xs text-gray-500 mt-1">{account.email}</p>
                <p className="text-xs text-gray-600 mt-1">{account.account_status} · {account.subscription_status}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent support notes</h2>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {(support?.notes || []).length === 0 && (
                <p className="text-xs text-gray-400 italic">No support notes.</p>
              )}
              {(support?.notes || []).map(note => (
                <div key={note.id} className="border-b border-gray-100 pb-2 last:border-0">
                  <p className="text-sm text-gray-800">{note.note}</p>
                  <p className="text-xs text-gray-500 mt-1">{note.therapist_name || note.therapist_email} · {note.author_email || 'admin'} · {formatDate(note.created_at)}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent system events</h2>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {(support?.events || []).map(event => (
                <div key={event.id} className="border-b border-gray-100 pb-2 last:border-0">
                  <p className="text-sm text-gray-800">{event.event_type}</p>
                  <p className="text-xs text-gray-500 mt-1">{event.full_name || event.email || 'System'} · {event.status || '—'} · {formatDate(event.created_at)}</p>
                  {event.message && <p className="text-xs text-gray-600 mt-1">{event.message}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
