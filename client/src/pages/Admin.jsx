import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZoneName: 'short',
    })
  } catch { return value }
}

const tabs = ['overview', 'accounts', 'usage', 'support', 'billing']

const STATUS_STYLES = {
  new:      'bg-rose-50 text-rose-600 border-rose-100',
  read:     'bg-amber-50 text-amber-600 border-amber-100',
  resolved: 'bg-emerald-50 text-emerald-600 border-emerald-100',
}
const CATEGORY_STYLES = {
  bug:     'bg-red-50 text-red-500 border-red-100',
  feature: 'bg-violet-50 text-violet-600 border-violet-100',
  general: 'bg-gray-100 text-gray-500 border-gray-200',
}

function formatCents(cents) {
  const n = (cents || 0) / 100
  return `$${n.toFixed(n >= 10 ? 2 : 3)}`
}

function AiCostsPanel({ data, onUnpause }) {
  const [busyId, setBusyId] = useState(null)
  if (!data) {
    return (
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">AI spend — this month</h2>
        <p className="text-xs text-gray-500">No cost data yet. Once any clinician talks to Miwa, this fills in.</p>
      </div>
    )
  }

  const totals = data.totals || {}
  const byProvider = data.by_provider || []
  const byKind = data.by_kind || []
  const topSpenders = data.top_spenders || []
  const paused = data.paused_accounts || []

  async function unpause(tid) {
    setBusyId(tid)
    try {
      await apiFetch(`/admin/ai-costs/${tid}/unpause`, { method: 'POST' })
      if (onUnpause) await onUnpause()
    } catch {}
    setBusyId(null)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Total spend (MTD)</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{formatCents(totals.total_cents)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">API calls</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{(totals.call_count || 0).toLocaleString()}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Tokens in</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{((totals.input_tokens || 0) / 1000).toFixed(1)}k</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Tokens out</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{((totals.output_tokens || 0) / 1000).toFixed(1)}k</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">By provider</h3>
          <div className="space-y-2">
            {byProvider.length === 0 && <p className="text-xs text-gray-400">No calls yet this month</p>}
            {byProvider.map(p => (
              <div key={p.provider} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-gray-900 capitalize">{p.provider}</span>
                <span className="flex items-center gap-3 text-xs text-gray-500">
                  <span>{(p.tokens || 0).toLocaleString()} tokens</span>
                  <span>{(p.calls || 0)} calls</span>
                  <span className="font-semibold text-gray-900">{formatCents(p.cost_cents)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Top tasks</h3>
          <div className="space-y-2">
            {byKind.length === 0 && <p className="text-xs text-gray-400">No calls yet this month</p>}
            {byKind.map(k => (
              <div key={k.kind} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-gray-700 text-xs">{k.kind}</span>
                <span className="flex items-center gap-3 text-xs text-gray-500">
                  <span>{k.calls} calls</span>
                  <span className="font-semibold text-gray-900">{formatCents(k.cost_cents)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Top spenders this month</h3>
        <div className="space-y-2">
          {topSpenders.length === 0 && <p className="text-xs text-gray-400">No spenders yet</p>}
          {topSpenders.map(s => (
            <div key={s.therapist_id} className="flex items-center justify-between gap-3 border-b border-gray-100 pb-2 last:border-0 text-sm">
              <div>
                <p className="font-medium text-gray-900">{s.full_name || s.email || `Therapist ${s.therapist_id}`}</p>
                <p className="text-xs text-gray-500">
                  {s.subscription_tier || s.subscription_status || 'trial'}
                  {s.ai_budget_paused ? ' · PAUSED' : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">{formatCents(s.cost_cents)}</p>
                <p className="text-xs text-gray-500">{(s.tokens || 0).toLocaleString()} tokens</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {paused.length > 0 && (
        <div className="card p-5 border-rose-200 bg-rose-50/30">
          <h3 className="text-sm font-semibold text-rose-900 mb-3">Paused accounts ({paused.length})</h3>
          <p className="text-xs text-rose-700 mb-3">These clinicians hit their monthly AI budget. They auto-unpause on the 1st, or you can clear the flag manually.</p>
          <div className="space-y-2">
            {paused.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-gray-900">{p.full_name || p.email}</p>
                  <p className="text-xs text-gray-500">{p.email} · {p.subscription_tier || p.subscription_status}</p>
                </div>
                <button
                  disabled={busyId === p.id}
                  onClick={() => unpause(p.id)}
                  className="btn-secondary text-xs px-3 py-1.5"
                >
                  {busyId === p.id ? 'Clearing…' : 'Unpause'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StripeMigrationCard({ onComplete }) {
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function runMigration() {
    setRunning(true)
    setError('')
    try {
      const res = await apiFetch('/admin/reset-stripe-all', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Migration failed')
      setResult(data)
      setConfirming(false)
      if (onComplete) await onComplete()
    } catch (err) {
      setError(err.message)
    }
    setRunning(false)
  }

  return (
    <div className="card p-5 border-amber-200 bg-amber-50/30">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Stripe test → live migration</h2>
          <p className="text-xs text-gray-600 mt-1 max-w-xl">
            Clears all stale test-mode Stripe customer IDs and resets any active subscriptions
            back to trial. Run this <strong>once</strong> after switching to live Stripe keys.
            Users will create a fresh live-mode customer on their next checkout.
          </p>
        </div>
        {!confirming && !result && (
          <button onClick={() => setConfirming(true)} className="btn-secondary text-xs px-3 py-1.5">
            Run migration
          </button>
        )}
      </div>

      {confirming && (
        <div className="mt-4 p-3 rounded-lg bg-white border border-amber-200 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-amber-900 font-medium">
            This will clear <strong>all</strong> Stripe customer IDs and reset active subscriptions. Continue?
          </p>
          <div className="flex items-center gap-2">
            <button disabled={running} onClick={() => setConfirming(false)} className="btn-secondary text-xs px-3 py-1.5">
              Cancel
            </button>
            <button disabled={running} onClick={runMigration} className="btn-primary text-xs px-3 py-1.5">
              {running ? 'Running…' : 'Yes, migrate'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-rose-600">{error}</p>
      )}

      {result && (
        <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-100 text-xs text-emerald-900">
          Migration complete — cleared {result.cleared_customers} customer IDs and reset {result.reset_subscriptions} active subscriptions.
        </div>
      )}
    </div>
  )
}

function FeedbackCard({ fb, onUpdate }) {
  const [saving, setSaving] = useState(false)
  const [response, setResponse] = useState(fb.admin_response || '')
  const [expanded, setExpanded] = useState(fb.status === 'new')

  async function patch(patch) {
    setSaving(true)
    try {
      await apiFetch(`/admin/feedback/${fb.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      await onUpdate()
    } catch {}
    setSaving(false)
  }

  return (
    <div className={`rounded-xl border p-4 ${fb.status === 'new' ? 'border-indigo-100 bg-indigo-50/30' : 'border-gray-100 bg-white'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${STATUS_STYLES[fb.status] || STATUS_STYLES.new}`}>
            {fb.status}
          </span>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${CATEGORY_STYLES[fb.category] || CATEGORY_STYLES.general}`}>
            {fb.category}
          </span>
          <span className="text-xs text-gray-400">{fb.source === 'chat' ? '💬 via Miwa chat' : '📝 via form'}</span>
        </div>
        <span className="text-xs text-gray-400">{formatDate(fb.created_at)}</span>
      </div>

      <p className="text-xs text-gray-500 mt-1.5 font-medium">{fb.therapist_name || fb.therapist_email || 'Unknown user'}</p>
      <p className="text-sm text-gray-800 mt-2 leading-relaxed">{fb.message}</p>

      <button onClick={() => setExpanded(e => !e)} className="text-xs text-indigo-500 hover:text-indigo-700 mt-2 font-medium">
        {expanded ? 'Hide response ▲' : 'Respond / change status ▼'}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          <textarea
            className="textarea text-sm w-full"
            rows={2}
            placeholder="Internal note or response (optional)…"
            value={response}
            onChange={e => setResponse(e.target.value)}
          />
          <div className="flex items-center gap-2 flex-wrap">
            {fb.status !== 'read' && (
              <button disabled={saving} onClick={() => patch({ status: 'read', admin_response: response })}
                className="btn-secondary text-xs px-3 py-1.5">Mark read</button>
            )}
            {fb.status !== 'resolved' && (
              <button disabled={saving} onClick={() => patch({ status: 'resolved', admin_response: response })}
                className="btn-primary text-xs px-3 py-1.5">Mark resolved</button>
            )}
            {response !== fb.admin_response && (
              <button disabled={saving} onClick={() => patch({ admin_response: response })}
                className="btn-secondary text-xs px-3 py-1.5">Save note</button>
            )}
          </div>
          {fb.admin_response && (
            <p className="text-xs text-gray-500 mt-1 italic">Saved: {fb.admin_response}</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function Admin() {
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [overview, setOverview] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [usage, setUsage] = useState(null)
  const [support, setSupport] = useState(null)
  const [billing, setBilling] = useState(null)
  const [aiCosts, setAiCosts] = useState(null)
  const [resettingId, setResettingId] = useState(null)
  const [savingAccountId, setSavingAccountId] = useState(null)
  const [noteDrafts, setNoteDrafts] = useState({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [subscriptionFilter, setSubscriptionFilter] = useState('')

  const loadAdminData = async () => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams()
      if (search) qs.set('q', search)
      if (statusFilter) qs.set('status', statusFilter)
      if (subscriptionFilter) qs.set('subscription', subscriptionFilter)
      const accountPath = `/admin/therapists${qs.toString() ? `?${qs}` : ''}`

      const [overviewRes, accountsRes, usageRes, supportRes, billingRes, aiCostsRes] = await Promise.all([
        apiFetch('/admin/overview'),
        apiFetch(accountPath),
        apiFetch('/admin/usage'),
        apiFetch('/admin/support'),
        apiFetch('/admin/billing'),
        apiFetch('/admin/ai-costs'),
      ])
      const [overviewData, accountsData, usageData, supportData, billingData, aiCostsData] = await Promise.all([
        overviewRes.json(), accountsRes.json(), usageRes.json(), supportRes.json(), billingRes.json(), aiCostsRes.json(),
      ])
      if (!overviewRes.ok) throw new Error(overviewData.error || 'Failed to load admin overview')
      if (!accountsRes.ok) throw new Error(accountsData.error || 'Failed to load accounts')
      if (!usageRes.ok) throw new Error(usageData.error || 'Failed to load usage')
      if (!supportRes.ok) throw new Error(supportData.error || 'Failed to load support')
      if (!billingRes.ok) throw new Error(billingData.error || 'Failed to load billing')
      // ai-costs may not exist on older deployments — non-fatal
      setOverview(overviewData)
      setAccounts(Array.isArray(accountsData) ? accountsData : [])
      setUsage(usageData)
      setSupport(supportData)
      setBilling(billingData)
      setAiCosts(aiCostsRes.ok ? aiCostsData : null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAdminData() }, [search, statusFilter, subscriptionFilter])

  const topCards = useMemo(() => ([
    ['Accounts created', overview?.totals?.total_therapists || 0],
    ['Online now', overview?.totals?.online_now || 0],
    ['Active last 24h', overview?.totals?.active_last_24h || 0],
    ['Trial accounts', overview?.totals?.trial_accounts || 0],
    ['Paid accounts', overview?.totals?.paid_accounts || 0],
    ['At-risk accounts', overview?.totals?.at_risk_accounts || 0],
    ['Patients', overview?.totals?.total_patients || 0],
    ['Sessions', overview?.totals?.total_sessions || 0],
    ['Intake uploads', overview?.totals?.total_intake_uploads || 0],
    ['Workspace uses', overview?.totals?.total_workspace_uses || 0],
  ]), [overview])

  const handleResetPassword = async (therapistId) => {
    setResettingId(therapistId)
    setNotice('')
    setError('')
    try {
      const res = await apiFetch(`/admin/therapists/${therapistId}/reset-password`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to reset password')
      setNotice(`Temporary password for ${data.therapist.email}: ${data.temporary_password}`)
      await loadAdminData()
    } catch (err) {
      setError(err.message)
    } finally {
      setResettingId(null)
    }
  }

  const handleAccountPatch = async (therapistId, patch) => {
    setSavingAccountId(therapistId)
    setNotice('')
    setError('')
    try {
      const res = await apiFetch(`/admin/therapists/${therapistId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update account')
      setNotice('Account updated.')
      await loadAdminData()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingAccountId(null)
    }
  }

  const handleAddNote = async (therapistId) => {
    const note = (noteDrafts[therapistId] || '').trim()
    if (!note) return
    try {
      const res = await apiFetch(`/admin/therapists/${therapistId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add note')
      setNotice('Support note added.')
      setNoteDrafts(current => ({ ...current, [therapistId]: '' }))
      await loadAdminData()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <div className="p-6 max-w-6xl mx-auto text-sm text-gray-500">Loading admin backend…</div>

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Admin Console</h1>
          <p className="text-sm text-gray-500 mt-1">Operator view for accounts, product usage, support, and billing.</p>
        </div>
        <button onClick={loadAdminData} className="btn-secondary text-sm">Refresh all</button>
      </div>

      {notice && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 whitespace-pre-wrap">{notice}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2 flex-wrap">
        {tabs.map(item => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`px-4 py-2 rounded-xl text-sm font-medium capitalize border ${tab === item ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-gray-200 text-gray-600'}`}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {topCards.map(([label, value]) => (
              <div key={label} className="card p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Funnel</h2>
              <div className="space-y-2 text-sm text-gray-700">
                <div>Signed up: {overview?.funnel?.signed_up || 0}</div>
                <div>Active last 30d: {overview?.funnel?.active_last_30d || 0}</div>
                <div>Created patient profiles: {overview?.funnel?.with_patients || 0}</div>
                <div>Created sessions: {overview?.funnel?.with_sessions || 0}</div>
                <div>Uploaded intake sources: {overview?.funnel?.with_intake_uploads || 0}</div>
              </div>
            </div>
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent activity</h2>
              <div className="space-y-3 max-h-72 overflow-y-auto">
                {(overview?.recent_events || []).map(event => (
                  <div key={event.id} className="border-b border-gray-100 pb-2 last:border-0">
                    <p className="text-sm text-gray-800 font-medium">{event.event_type}</p>
                    <p className="text-xs text-gray-500 mt-1">{event.full_name || event.email || 'System'} · {event.status || '—'} · {formatDate(event.created_at)}</p>
                    {event.message && <p className="text-xs text-gray-600 mt-1">{event.message}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'accounts' && (
        <div className="space-y-4">
          <div className="card p-4 grid md:grid-cols-4 gap-3">
            <input className="input" placeholder="Search name or email" value={search} onChange={e => setSearch(e.target.value)} />
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
                    <button onClick={() => handleResetPassword(account.id)} disabled={resettingId === account.id} className="btn-secondary text-xs">{resettingId === account.id ? 'Resetting…' : 'Reset password'}</button>
                    <button onClick={() => handleAccountPatch(account.id, { account_status: account.account_status === 'suspended' ? 'active' : 'suspended' })} disabled={savingAccountId === account.id} className="btn-secondary text-xs">{account.account_status === 'suspended' ? 'Reactivate' : 'Suspend'}</button>
                    <button onClick={() => handleAccountPatch(account.id, { is_admin: !account.is_admin })} disabled={savingAccountId === account.id} className="btn-secondary text-xs">{account.is_admin ? 'Remove admin' : 'Make admin'}</button>
                  </div>
                </div>
                <div className="grid md:grid-cols-4 gap-3 text-sm text-gray-700">
                  <div>Role: {account.user_role}</div>
                  <div>Account: {account.account_status}</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span>Credential: {account.credential_type || 'licensed'}</span>
                    {account.credential_type === 'trainee' && (
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${account.credential_verified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {account.credential_verified ? '✓ Verified' : '⏳ Pending'}
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
                  <select className="input" defaultValue={account.subscription_status} onChange={e => handleAccountPatch(account.id, { subscription_status: e.target.value })}>
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                    <option value="past_due">Past due</option>
                    <option value="expired">Expired</option>
                  </select>
                  <select className="input" defaultValue={account.subscription_tier || ''} onChange={e => handleAccountPatch(account.id, { subscription_tier: e.target.value || null })}>
                    <option value="">No tier</option>
                    <option value="solo">Solo</option>
                    <option value="trainee">Trainee</option>
                    <option value="group">Group</option>
                  </select>
                  <input className="input" type="number" min="1" defaultValue={account.trial_limit || 10} onBlur={e => handleAccountPatch(account.id, { trial_limit: Number(e.target.value || 10) })} />
                </div>
                <div className="space-y-2">
                  <textarea className="textarea" rows={2} placeholder="Internal support note…" value={noteDrafts[account.id] || ''} onChange={e => setNoteDrafts(current => ({ ...current, [account.id]: e.target.value }))} />
                  <button onClick={() => handleAddNote(account.id)} className="btn-secondary text-xs">Add support note</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'usage' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              ['Sessions last 7d', usage?.summary?.sessions_last_7d || 0],
              ['Sessions last 30d', usage?.summary?.sessions_last_30d || 0],
              ['Profiles last 30d', usage?.summary?.patient_profiles_last_30d || 0],
              ['Intake uploads last 30d', usage?.summary?.intake_uploads_last_30d || 0],
              ['Record uploads last 30d', usage?.summary?.record_uploads_last_30d || 0],
              ['Total workspace uses', usage?.summary?.total_workspace_uses || 0],
            ].map(([label, value]) => (
              <div key={label} className="card p-4"><p className="text-xs uppercase tracking-wide text-gray-400">{label}</p><p className="mt-2 text-2xl font-bold text-gray-900">{value}</p></div>
            ))}
          </div>
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Feature adoption</h2>
              <div className="space-y-2 text-sm text-gray-700">
                <div>Therapists with patients: {usage?.feature_adoption?.therapists_with_patients || 0}</div>
                <div>Therapists with sessions: {usage?.feature_adoption?.therapists_with_sessions || 0}</div>
                <div>Therapists with intake uploads: {usage?.feature_adoption?.therapists_with_intake_uploads || 0}</div>
                <div>Therapists with record files: {usage?.feature_adoption?.therapists_with_record_files || 0}</div>
              </div>
            </div>
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Top users</h2>
              <div className="space-y-3 max-h-72 overflow-y-auto">
                {(usage?.top_users || []).map(user => (
                  <div key={user.id} className="flex items-center justify-between gap-3 text-sm border-b border-gray-100 pb-2 last:border-0">
                    <div>
                      <p className="font-medium text-gray-900">{user.full_name || user.email}</p>
                      <p className="text-xs text-gray-500">{user.email}</p>
                    </div>
                    <div className="text-right text-xs text-gray-600">
                      <div>{user.workspace_uses} workspace uses</div>
                      <div>{user.patient_count} patients · {user.session_count} sessions</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-6">

          {/* ── User Feedback ── */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">User Feedback</h2>
              <span className="text-xs bg-indigo-50 text-indigo-600 font-semibold px-2.5 py-1 rounded-full border border-indigo-100">
                {(support?.feedback || []).filter(f => f.status === 'new').length} new
              </span>
            </div>
            {(support?.feedback || []).length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No feedback yet.</p>
            ) : (
              <div className="space-y-3 max-h-[32rem] overflow-y-auto">
                {(support?.feedback || []).map(fb => (
                  <FeedbackCard key={fb.id} fb={fb} onUpdate={loadAdminData} />
                ))}
              </div>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Flagged accounts</h2>
              <div className="space-y-3 max-h-[30rem] overflow-y-auto">
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
      )}

      {tab === 'billing' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              ['Trial accounts', billing?.summary?.trial_accounts || 0],
              ['Paid accounts', billing?.summary?.active_paid_accounts || 0],
              ['Past due', billing?.summary?.past_due_accounts || 0],
              ['Expired', billing?.summary?.expired_accounts || 0],
              ['Stripe connected', billing?.summary?.stripe_connected_accounts || 0],
            ].map(([label, value]) => (
              <div key={label} className="card p-4"><p className="text-xs uppercase tracking-wide text-gray-400">{label}</p><p className="mt-2 text-2xl font-bold text-gray-900">{value}</p></div>
            ))}
          </div>

          <StripeMigrationCard onComplete={loadAdminData} />

          <AiCostsPanel data={aiCosts} onUnpause={loadAdminData} />

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Trial ending soon</h2>
            <div className="space-y-3">
              {(billing?.trial_ending_soon || []).map(account => (
                <div key={account.id} className="flex items-center justify-between gap-3 border-b border-gray-100 pb-2 last:border-0 text-sm">
                  <div>
                    <p className="font-medium text-gray-900">{account.full_name || account.email}</p>
                    <p className="text-xs text-gray-500">{account.email}</p>
                  </div>
                  <div className="text-xs text-gray-600">{Math.max(0, (account.trial_limit || 10) - (account.workspace_uses || 0))} trial uses remaining</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
