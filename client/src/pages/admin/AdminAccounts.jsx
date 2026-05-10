import { useEffect, useState } from 'react'
import { adminApiFetch } from '../../lib/api'
import {
  formatDate,
  handleAccountPatch,
  handleResetPassword,
  handleAddNote,
  handleDeleteAccount,
  AdminBanners,
} from './adminUtils'
import {
  AdminButton,
  AdminCard,
  AdminPageHeader,
  AdminStatusBadge,
  ConfirmModal,
} from '../../components/admin'

function subscriptionStatus(status) {
  if (status === 'active' || status === 'trial' || status === 'past_due') return status
  return 'warn'
}

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
  const [resetDataId, setResetDataId] = useState(null)
  const [confirmAction, setConfirmAction] = useState(null)
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

  const doResetData = async ({ typed, reason }) => {
    if (!confirmAction) return
    const { id, email } = confirmAction
    setResetDataId(id)
    setError('')
    setNotice('')
    try {
      const res = await adminApiFetch(`/admin/therapists/${id}/reset-data`, {
        method: 'POST',
        body: JSON.stringify({ confirmation: typed, reason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to reset data')
      setNotice(data.message || `Cleared all clinical data for ${email}.`)
      setConfirmAction(null)
      load()
    } catch (err) {
      setError(err.message)
      throw err
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

  const doDelete = async ({ typed, reason }) => {
    if (!confirmAction) return
    const { id, email } = confirmAction
    setDeletingId(id)
    try {
      await handleDeleteAccount(id, email, {
        setNotice,
        setError,
        reason,
        confirmation: typed,
        onDone: () => {
          setConfirmAction(null)
          load()
        },
      })
    } finally {
      setDeletingId(null)
    }
  }

  const modalTitle = confirmAction?.type === 'wipe' ? 'Wipe account data' : 'Delete account'
  const modalBody = confirmAction?.type === 'wipe'
    ? 'This deletes every patient, session, assessment, appointment, and check-in for this account. The account itself is preserved.'
    : 'This permanently deletes the account and associated data. This action cannot be undone.'
  const confirmWord = confirmAction
    ? `${confirmAction.type === 'wipe' ? 'WIPE' : 'DELETE'} ${confirmAction.email}`
    : ''

  if (loading && accounts.length === 0) return <div className="p-8 text-sm text-gray-500">Loading accounts...</div>

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <AdminPageHeader
        title="Accounts"
        subtitle="Manage therapist accounts, subscription metadata, roles, and internal support notes."
        actions={
          <AdminButton variant="secondary" size="sm" onClick={load}>
            Refresh
          </AdminButton>
        }
      />

      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        Account administration is metadata-only by default. Client charts, notes, transcripts, diagnoses, and uploaded clinical files are not shown here.
      </div>

      <AdminBanners notice={notice} error={error} />

      <AdminCard title="Filters" subtitle="Search and narrow the account list.">
        <div className="grid md:grid-cols-4 gap-3">
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
      </AdminCard>

      <div className="space-y-4">
        {accounts.map(account => (
          <AdminCard
            key={account.id}
            title={account.full_name || 'Unnamed therapist'}
            subtitle={`${account.email} | Created ${formatDate(account.created_at)} | Last seen ${formatDate(account.last_seen_at)}`}
            action={
              <div className="flex gap-2 flex-wrap justify-end">
                <AdminStatusBadge status={account.account_status === 'suspended' ? 'suspended' : 'active'} />
                <AdminStatusBadge
                  status={subscriptionStatus(account.subscription_status)}
                  label={account.subscription_status || 'Unknown'}
                />
              </div>
            }
          >
            <div className="space-y-5">
              <div className="flex gap-2 flex-wrap">
                <AdminButton size="sm" onClick={() => doReset(account.id)} loading={resettingId === account.id}>
                  {resettingId === account.id ? 'Resetting...' : 'Reset password'}
                </AdminButton>
                <AdminButton
                  size="sm"
                  onClick={() => doPatch(account.id, { account_status: account.account_status === 'suspended' ? 'active' : 'suspended' })}
                  loading={savingId === account.id}
                >
                  {account.account_status === 'suspended' ? 'Reactivate' : 'Suspend'}
                </AdminButton>
                <AdminButton
                  size="sm"
                  onClick={() => doPatch(account.id, { is_admin: !account.is_admin })}
                  loading={savingId === account.id}
                >
                  {account.is_admin ? 'Remove admin' : 'Make admin'}
                </AdminButton>
              </div>

              <div className="grid md:grid-cols-4 gap-3 text-sm text-gray-700">
                <div>Role: {account.user_role}</div>
                <div>Account: {account.account_status}</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span>Credential: {account.credential_type || 'licensed'}</span>
                  {account.credential_type === 'trainee' && (
                    <AdminStatusBadge
                      status={account.credential_verified ? 'pass' : 'warn'}
                      label={account.credential_verified ? 'Verified' : 'Pending'}
                    />
                  )}
                </div>
                <div>Subscription: {account.subscription_status}{account.subscription_tier ? ` | ${account.subscription_tier}` : ''}</div>
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
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder="Internal support note..."
                  value={noteDrafts[account.id] || ''}
                  onChange={e => setNoteDrafts(c => ({ ...c, [account.id]: e.target.value }))}
                />
                <AdminButton size="sm" onClick={() => doAddNote(account.id)}>
                  Add support note
                </AdminButton>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                  Danger zone
                </p>
                <div className="flex gap-2 flex-wrap">
                  <AdminButton
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirmAction({ type: 'wipe', id: account.id, email: account.email })}
                    loading={resetDataId === account.id}
                    title="Delete every patient, session, assessment, appointment, and check-in for this account. Account itself is preserved."
                  >
                    {resetDataId === account.id ? 'Wiping...' : 'Wipe data'}
                  </AdminButton>
                  <AdminButton
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirmAction({ type: 'delete', id: account.id, email: account.email })}
                    loading={deletingId === account.id}
                  >
                    {deletingId === account.id ? 'Deleting...' : 'Delete account'}
                  </AdminButton>
                </div>
              </div>
            </div>
          </AdminCard>
        ))}
      </div>

      <ConfirmModal
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={confirmAction?.type === 'wipe' ? doResetData : doDelete}
        title={modalTitle}
        body={modalBody}
        confirmWord={confirmWord}
        reasonLabel={confirmAction?.type === 'wipe' ? 'Reason for wiping this account data' : 'Reason for deleting this account'}
        reasonMinLength={12}
      />
    </div>
  )
}
