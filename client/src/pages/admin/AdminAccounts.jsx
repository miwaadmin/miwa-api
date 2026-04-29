import { useEffect, useState } from 'react'
import { adminApiFetch } from '../../lib/api'
import { formatDate, handleAccountPatch, handleResetPassword, handleAddNote, handleDeleteAccount, AdminBanners } from './adminUtils'

export default function AdminAccounts() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [accounts, setAccounts] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [subscriptionFilter, setSubscriptionFilter] = useState('')
  const [resettingId, setResettingId] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [resetDataId, setResetDataId] = useState(null)
  const [resetDataConfirmId, setResetDataConfirmId] = useState(null)
  const [noteDrafts, setNoteDrafts] = useState({})

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams()
      if (search) qs.set('q', search)
      if (statusFilter) qs.set('status', statusFilter)
      if (subscriptionFilter) qs.set('subscription', subscriptionFilter)
      const path = `/admin/therapists${qs.toString() ? `?${qs}` : ''}`
      const res = await adminApiFetch(path)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load accounts')
      setAccounts(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [search, statusFilter, subscriptionFilter])

  const doReset = async (id) => {
    setResettingId(id)
    await handleResetPassword(id, { setNotice, setError, onDone: load })
    setResettingId(null)
  }

  // Wipe one therapist's patients/sessions/etc. without touching their account.
  // Confirmation gate is two-step (button → confirm) since the action is destructive.
  const doResetData = async (id, email) => {
    const confirmation = window.prompt(`Type WIPE ${email} to confirm the clinical data wipe.`)
    if (confirmation !== `WIPE ${email}`) {
      setError(`Data wipe cancelled. Confirmation must match: WIPE ${email}`)
      setResetDataConfirmId(null)
      return
    }
    const reason = window.prompt('Reason for wiping this account data:')
    if (!reason || reason.trim().length < 12) {
      setError('Data wipe cancelled. A specific reason is required.')
      setResetDataConfirmId(null)
      return
    }
    setResetDataId(id)
    setError('')
    setNotice('')
    try {
      const res = await adminApiFetch(`/admin/therapists/${id}/reset-data`, {
        method: 'POST',
        body: JSON.stringify({ confirmation, reason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to reset data')
      setNotice(data.message || `Cleared all clinical data for ${email}.`)
      setResetDataConfirmId(null)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setResetDataId(null)
    }
  }

  const doPatch = async (id, patch) => {
    setSavingId(id)
    await handleAccountPatch(id, patch, { setNotice, setError, onDone: load })
    setSavingId(null)
  }

  const doAddNote = async (id) => {
    const note = (noteDrafts[id] || '').trim()
    if (!note) return
    await handleAddNote(id, note, {
      setNotice,
      setError,
      onDone: () => {
        setNoteDrafts(c => ({ ...c, [id]: '' }))
        load()
      },
    })
  }

  const doDelete = async (id, email) => {
    const confirmation = window.prompt(`Type DELETE ${email} to permanently delete this account.`)
    if (confirmation !== `DELETE ${email}`) {
      setError(`Account deletion cancelled. Confirmation must match: DELETE ${email}`)
      setDeleteConfirmId(null)
      return
    }
    const reason = window.prompt('Reason for deleting this account:')
    if (!reason || reason.trim().length < 12) {
      setError('Account deletion cancelled. A specific reason is required.')
      setDeleteConfirmId(null)
      return
    }
    setDeletingId(id)
    await handleDeleteAccount(id, email, {
      setNotice,
      setError,
      reason,
      confirmation,
      onDone: () => {
        setDeleteConfirmId(null)
        load()
      },
    })
    setDeletingId(null)
  }

  if (loading && accounts.length === 0) return <div className="p-6 text-sm text-gray-500">Loading accounts…</div>

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <h2 className="text-lg font-bold text-gray-900">Accounts</h2>
      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        Account administration is metadata-only by default. Client charts, notes, transcripts, diagnoses, and uploaded clinical files are not shown here.
      </div>

      <AdminBanners notice={notice} error={error} />

      <div className="card p-4 grid md:grid-cols-4 gap-3">
        <input
          className="input"
          type="search"
          placeholder="Search name or email"
          aria-label="Search accounts by name or email"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All account statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <select className="input" value={subscriptionFilter} onChange={e => setSubscriptionFilter(e.target.value)}>
          <option value="">All subscription states</option>
          <option value="trial">Trial</option>
          <option value="active">Active</option>
          <option value="past_due">Past due</option>
          <option value="expired">Expired</option>
        </select>
        <div className="text-xs text-gray-500 flex items-center">{accounts.length} accounts</div>
      </div>

      <div className="space-y-4">
        {accounts.map(account => (
          <div key={account.id} className="card p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{account.full_name || 'Unnamed therapist'}</h3>
                <p className="text-xs text-gray-500 mt-1">{account.email}</p>
                <p className="text-xs text-gray-400 mt-1">Created {formatDate(account.created_at)} · Last seen {formatDate(account.last_seen_at)}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => doReset(account.id)} disabled={resettingId === account.id} className="btn-secondary text-xs">
                  {resettingId === account.id ? 'Resetting…' : 'Reset password'}
                </button>
                <button onClick={() => doPatch(account.id, { account_status: account.account_status === 'suspended' ? 'active' : 'suspended' })} disabled={savingId === account.id} className="btn-secondary text-xs">
                  {account.account_status === 'suspended' ? 'Reactivate' : 'Suspend'}
                </button>
                <button onClick={() => doPatch(account.id, { is_admin: !account.is_admin })} disabled={savingId === account.id} className="btn-secondary text-xs">
                  {account.is_admin ? 'Remove admin' : 'Make admin'}
                </button>
                {resetDataConfirmId === account.id ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => doResetData(account.id, account.email)}
                      disabled={resetDataId === account.id}
                      className="btn-danger text-xs"
                      title="Delete every patient, session, assessment, appointment, and check-in for this account. Account itself is preserved."
                    >
                      {resetDataId === account.id ? 'Wiping…' : 'Confirm wipe data'}
                    </button>
                    <button onClick={() => setResetDataConfirmId(null)} className="btn-secondary text-xs">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setResetDataConfirmId(account.id)}
                    className="btn-secondary text-xs text-amber-700 hover:text-amber-900"
                    title="Delete every patient, session, assessment, appointment, and check-in for this account. Account itself is preserved."
                  >
                    Wipe Data
                  </button>
                )}
                {deleteConfirmId === account.id ? (
                  <div className="flex gap-2">
                    <button onClick={() => doDelete(account.id, account.email)} disabled={deletingId === account.id} className="btn-danger text-xs">
                      {deletingId === account.id ? 'Deleting…' : 'Confirm delete'}
                    </button>
                    <button onClick={() => setDeleteConfirmId(null)} className="btn-secondary text-xs">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirmId(account.id)} className="btn-secondary text-xs text-red-600 hover:text-red-700">
                    Delete
                  </button>
                )}
              </div>
            </div>
            <div className="grid md:grid-cols-4 gap-3 text-sm text-gray-700">
              <div>Role: {account.user_role}</div>
              <div>Account: {account.account_status}</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span>Credential: {account.credential_type || 'licensed'}</span>
                {account.credential_type === 'trainee' && (
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${account.credential_verified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {account.credential_verified ? '✓ Verified' : 'Pending'}
                  </span>
                )}
              </div>
              <div>Subscription: {account.subscription_status}{account.subscription_tier ? ` · ${account.subscription_tier}` : ''}</div>
              <div>Workspace uses: {account.workspace_uses}/{account.trial_limit}</div>
              <div>Patients: {account.patient_count}</div>
              <div>Sessions: {account.session_count}</div>
              <div>Intake uploads: {account.intake_source_count}</div>
              <div>Record files: {account.record_file_count}</div>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <select className="input" defaultValue={account.subscription_status} onChange={e => doPatch(account.id, { subscription_status: e.target.value })}>
                <option value="trial">Trial</option>
                <option value="active">Active</option>
                <option value="past_due">Past due</option>
                <option value="expired">Expired</option>
              </select>
              <select className="input" defaultValue={account.subscription_tier || ''} onChange={e => doPatch(account.id, { subscription_tier: e.target.value || null })}>
                <option value="">No tier</option>
                <option value="solo">Solo</option>
                <option value="trainee">Trainee</option>
                <option value="group">Group</option>
              </select>
              <input
                className="input"
                type="number"
                min="1"
                aria-label={`Trial session limit for ${account.email || 'account'}`}
                title="Trial session limit"
                defaultValue={account.trial_limit || 10}
                onBlur={e => doPatch(account.id, { trial_limit: Number(e.target.value || 10) })}
              />
            </div>
            <div className="space-y-2">
              <textarea className="textarea" rows={2} placeholder="Internal support note…" value={noteDrafts[account.id] || ''} onChange={e => setNoteDrafts(c => ({ ...c, [account.id]: e.target.value }))} />
              <button onClick={() => doAddNote(account.id)} className="btn-secondary text-xs">Add support note</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
