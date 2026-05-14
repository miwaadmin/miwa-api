import { useEffect, useMemo, useState } from 'react'
import { adminApiFetch } from '../../lib/api'
import { formatDate, AdminBanners } from './adminUtils'
import {
  AdminButton,
  AdminCard,
  AdminPageHeader,
  AdminStatusBadge,
} from '../../components/admin'

const CATEGORY_LABELS = {
  bug: 'Bug',
  feature_request: 'Feature request',
  help: 'Help',
  other: 'Other',
  // legacy values from early feedback form
  feature: 'Feature',
  general: 'General',
}

function feedbackStatus(status) {
  if (status === 'resolved') return 'pass'
  if (status === 'read') return 'warn'
  return 'fail'
}

export default function AdminSupport() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [support, setSupport] = useState(null)
  const [filter, setFilter] = useState('open') // 'open' | 'all' | 'new' | 'read' | 'resolved'
  const [categoryFilter, setCategoryFilter] = useState('all') // 'all' | category value
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
    let list = allFeedback
    if (filter !== 'all') {
      list = filter === 'open'
        ? list.filter(f => f.status !== 'resolved')
        : list.filter(f => f.status === filter)
    }
    if (categoryFilter !== 'all') {
      list = list.filter(f => f.category === categoryFilter)
    }
    return list
  }, [allFeedback, filter, categoryFilter])

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

  if (loading) return <div className="p-8 text-sm text-gray-500">Loading support...</div>

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <AdminPageHeader
        title="Support"
        subtitle="Review clinician feedback, flagged accounts, support notes, and recent system events."
        actions={
          <AdminButton variant="secondary" size="sm" onClick={load}>
            Refresh
          </AdminButton>
        }
      />

      <AdminBanners error={error} />

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Support feedback may contain PHI if a clinician typed it into a ticket. Keep replies minimum-necessary and do not copy clinical details into admin notes.
      </div>

      <AdminCard
        title="User feedback"
        subtitle="Bug reports, feature requests, and general feedback submitted through Miwa chat."
        action={
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1 flex-wrap justify-end">
              {[
                ['open', `Open (${counts.open})`],
                ['new', `New (${counts.new})`],
                ['read', `Read (${counts.read})`],
                ['resolved', `Resolved (${counts.resolved})`],
                ['all', `All (${counts.all})`],
              ].map(([key, label]) => (
                <AdminButton
                  key={key}
                  size="sm"
                  variant={filter === key ? 'primary' : 'secondary'}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </AdminButton>
              ))}
            </div>
            <div className="flex items-center gap-1 flex-wrap justify-end">
              {[
                ['all', 'All categories'],
                ['bug', 'Bug'],
                ['feature_request', 'Feature'],
                ['help', 'Help'],
                ['other', 'Other'],
              ].map(([key, label]) => (
                <AdminButton
                  key={key}
                  size="sm"
                  variant={categoryFilter === key ? 'primary' : 'secondary'}
                  onClick={() => setCategoryFilter(key)}
                >
                  {label}
                </AdminButton>
              ))}
            </div>
          </div>
        }
      >
        {filteredFeedback.length === 0 ? (
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-10 text-center">
            <p className="text-sm text-gray-500">
              {filter === 'open' ? 'No open feedback. Inbox zero.' : 'No feedback in this view.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[40rem] overflow-y-auto -mr-2 pr-2">
            {filteredFeedback.map(item => {
              const categoryLabel = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.general
              return (
                <div key={item.id} className="border border-gray-200 rounded-xl p-4 bg-white">
                  <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <AdminStatusBadge status="warn" label={categoryLabel} />
                      <AdminStatusBadge status={feedbackStatus(item.status)} label={item.status || 'new'} />
                      <span className="text-[10px] text-gray-500">via {item.source || 'chat'}</span>
                    </div>
                    <span className="text-[11px] text-gray-500">{formatDate(item.created_at)}</span>
                  </div>

                  {item.subject && (
                    <p className="text-sm font-semibold text-gray-800 mb-1">{item.subject}</p>
                  )}

                  <p className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">{item.message}</p>

                  <div className="mt-2 text-xs text-gray-500">
                    {item.therapist_name || item.therapist_email
                      ? `${item.therapist_name || item.therapist_email} (clinician)`
                      : item.client_account_id
                      ? `client_account_id=${item.client_account_id} (portal user)`
                      : `therapist_id=${item.therapist_id || '?'}`}
                  </div>

                  {(() => {
                    if (!item.context_json) return null
                    try {
                      const ctx = JSON.parse(item.context_json)
                      return (
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                          {Object.entries(ctx).map(([k, v]) => (
                            <span key={k} className="text-[10px] text-gray-400">
                              <span className="font-medium text-gray-500">{k}:</span> {String(v)}
                            </span>
                          ))}
                        </div>
                      )
                    } catch { return null }
                  })()}

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
                      <AdminButton
                        size="sm"
                        onClick={() => updateFeedback(item.id, { status: 'read' })}
                        disabled={busyId === item.id}
                      >
                        Mark read
                      </AdminButton>
                    )}
                    {item.status !== 'resolved' && (
                      <AdminButton
                        size="sm"
                        variant="primary"
                        onClick={() => updateFeedback(item.id, { status: 'resolved' })}
                        disabled={busyId === item.id}
                      >
                        Resolve
                      </AdminButton>
                    )}
                    {item.status === 'resolved' && (
                      <AdminButton
                        size="sm"
                        onClick={() => updateFeedback(item.id, { status: 'read' })}
                        disabled={busyId === item.id}
                      >
                        Reopen
                      </AdminButton>
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
                          placeholder="Write a short reply, the user will receive this by email when you mark this Resolved..."
                        />
                        <p className="text-[10px] text-gray-500 leading-relaxed">
                          Saves the reply. Emails the user when you click <strong>Resolve</strong> (or now, if it's already resolved and you re-resolve below).
                        </p>
                        <div className="flex items-center gap-2">
                          <AdminButton
                            size="sm"
                            onClick={() => updateFeedback(item.id, { admin_response: draftResponse[item.id] ?? '' })}
                            disabled={busyId === item.id}
                          >
                            Save reply (no email)
                          </AdminButton>
                          <AdminButton
                            size="sm"
                            variant="primary"
                            onClick={() => updateFeedback(item.id, {
                              admin_response: draftResponse[item.id] ?? item.admin_response ?? '',
                              status: 'resolved',
                            })}
                            disabled={busyId === item.id}
                          >
                            Save + resolve + email
                          </AdminButton>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>

      <div className="grid lg:grid-cols-2 gap-6">
        <AdminCard title="Flagged accounts" subtitle="Accounts that may need admin review.">
          <div className="space-y-3 max-h-[30rem] overflow-y-auto -mr-2 pr-2">
            {(support?.flagged_accounts || []).length === 0 && (
              <p className="text-xs text-gray-400 italic">No flagged accounts.</p>
            )}
            {(support?.flagged_accounts || []).map(account => (
              <div key={account.id} className="border border-gray-100 rounded-xl p-3">
                <p className="text-sm font-medium text-gray-900">{account.full_name || account.email}</p>
                <p className="text-xs text-gray-500 mt-1">{account.email}</p>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <AdminStatusBadge status={account.account_status === 'suspended' ? 'suspended' : 'active'} />
                  <AdminStatusBadge
                    status={account.subscription_status === 'trial' || account.subscription_status === 'past_due' ? account.subscription_status : 'active'}
                    label={account.subscription_status}
                  />
                </div>
              </div>
            ))}
          </div>
        </AdminCard>

        <div className="space-y-6">
          <AdminCard title="Recent support notes" subtitle="Internal notes added by admins.">
            <div className="space-y-3 max-h-64 overflow-y-auto -mr-2 pr-2">
              {(support?.notes || []).length === 0 && (
                <p className="text-xs text-gray-400 italic">No support notes.</p>
              )}
              {(support?.notes || []).map(note => (
                <div key={note.id} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                  <p className="text-sm text-gray-800">{note.note}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {note.therapist_name || note.therapist_email} | {note.author_email || 'admin'} | {formatDate(note.created_at)}
                  </p>
                </div>
              ))}
            </div>
          </AdminCard>

          <AdminCard title="Recent system events" subtitle="Latest account and system activity related to support.">
            <div className="space-y-3 max-h-64 overflow-y-auto -mr-2 pr-2">
              {(support?.events || []).map(event => (
                <div key={event.id} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                  <p className="text-sm text-gray-800">{event.event_type}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {event.full_name || event.email || 'System'} | {event.status || ', '} | {formatDate(event.created_at)}
                  </p>
                  {event.message && <p className="text-xs text-gray-600 mt-1">{event.message}</p>}
                </div>
              ))}
            </div>
          </AdminCard>
        </div>
      </div>
    </div>
  )
}
