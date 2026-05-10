import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminApiFetch } from '../../lib/api'
import { formatDate, AdminBanners } from './adminUtils'
import {
  AdminButton,
  AdminCard,
  AdminPageHeader,
  AdminStat,
  AdminStatusBadge,
  ConfirmModal,
} from '../../components/admin'

function LaunchReadinessCard({ readiness, loading, error, onRefresh }) {
  const checks = readiness?.checks || []
  const blockers = checks.filter(c => c.status === 'fail')
  const visibleChecks = [
    ...blockers,
    ...checks.filter(c => c.status === 'warn'),
    ...checks.filter(c => c.status === 'pass'),
  ]

  const overallStatus = !readiness
    ? 'warn'
    : readiness.ok
    ? 'pass'
    : blockers.length
    ? 'fail'
    : 'warn'

  const highlight = overallStatus === 'pass' ? 'success' : 'warning'

  return (
    <AdminCard
      title="Launch readiness"
      subtitle="Production configuration checks for HIPAA-sensitive launch, billing, storage, AI, and email."
      highlight={highlight}
      action={
        <>
          {readiness && <AdminStatusBadge status={overallStatus} />}
          <AdminButton size="sm" variant="secondary" onClick={onRefresh} loading={loading}>
            {loading ? 'Checking…' : 'Refresh'}
          </AdminButton>
        </>
      }
    >
      {readiness?.time && (
        <p className="text-xs text-gray-400 mb-4">Last checked {formatDate(readiness.time)}</p>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {readiness && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Pass', value: readiness.summary?.pass || 0, color: 'text-emerald-700', border: 'border-emerald-100' },
              { label: 'Warn', value: readiness.summary?.warn || 0, color: 'text-amber-700',   border: 'border-amber-100' },
              { label: 'Fail', value: readiness.summary?.fail || 0, color: 'text-red-700',     border: 'border-red-100' },
            ].map(({ label, value, color, border }) => (
              <div key={label} className={`rounded-xl border ${border} bg-white/70 p-3`}>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
                <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            {visibleChecks.map(check => (
              <div
                key={check.id}
                className="rounded-xl border border-gray-100 bg-white px-4 py-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{check.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{check.detail}</p>
                </div>
                <AdminStatusBadge status={check.status} />
              </div>
            ))}
          </div>
        </>
      )}
    </AdminCard>
  )
}

export default function AdminOverview() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [overview, setOverview] = useState(null)
  const [readiness, setReadiness] = useState(null)
  const [readinessLoading, setReadinessLoading] = useState(false)
  const [readinessError, setReadinessError] = useState('')
  const [backupStatus, setBackupStatus] = useState(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupResult, setBackupResult] = useState(null)
  const [backupError, setBackupError] = useState('')
  const [postgresStatus, setPostgresStatus] = useState(null)
  const [opsBusy, setOpsBusy] = useState('')
  const [opsMessage, setOpsMessage] = useState('')
  const [opsError, setOpsError] = useState('')
  const [resetModalOpen, setResetModalOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await adminApiFetch('/admin/overview')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load overview')
      setOverview(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadReadiness = async () => {
    setReadinessLoading(true)
    setReadinessError('')
    try {
      const r = await adminApiFetch('/admin/readiness')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed to load readiness checks')
      setReadiness(d)
    } catch (err) {
      setReadinessError(err.message)
    } finally {
      setReadinessLoading(false)
    }
  }

  const loadBackupStatus = async () => {
    try {
      const r = await adminApiFetch('/admin/backup/status')
      const d = await r.json()
      if (r.ok) setBackupStatus(d)
    } catch {}
  }

  const runBackup = async () => {
    setBackupBusy(true)
    setBackupError('')
    setBackupResult(null)
    try {
      const r = await adminApiFetch('/admin/backup/run', { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Backup failed')
      setBackupResult(d)
    } catch (err) {
      setBackupError(err.message)
    } finally {
      setBackupBusy(false)
    }
  }

  const checkPostgres = async () => {
    setOpsBusy('postgres')
    setOpsError('')
    setOpsMessage('')
    try {
      const r = await adminApiFetch('/admin/postgres/status')
      const d = await r.json()
      setPostgresStatus(d)
      if (!r.ok) throw new Error(d?.error?.message || d.message || 'PostgreSQL check failed')
      setOpsMessage(`PostgreSQL OK: ${d.database || 'miwa'}`)
    } catch (err) {
      setOpsError(err.message)
    } finally {
      setOpsBusy('')
    }
  }

  const sendEmailDiagnostic = async () => {
    const to = window.prompt('Send the Miwa diagnostic email to:')
    if (!to) return
    setOpsBusy('email')
    setOpsError('')
    setOpsMessage('')
    try {
      const r = await adminApiFetch('/admin/email-diag', {
        method: 'POST',
        body: JSON.stringify({ to }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Email diagnostic failed')
      setOpsMessage(`Email sent through ${d.result?.provider || 'configured provider'}`)
    } catch (err) {
      setOpsError(err.message)
    } finally {
      setOpsBusy('')
    }
  }

  const handleResetDatabase = async ({ typed, reason }) => {
    try {
      const r = await adminApiFetch('/admin/reset-database', {
        method: 'POST',
        body: JSON.stringify({ confirmation: typed, reason }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Reset failed')
      setResetModalOpen(false)
      alert(d.message || 'Database reset complete')
      load()
    } catch (err) {
      alert('Reset failed: ' + err.message)
    }
  }

  useEffect(() => { load(); loadReadiness(); loadBackupStatus(); checkPostgres() }, [])

  const topCards = useMemo(() => ([
    ['Accounts created', overview?.totals?.total_therapists || 0, '/admin/accounts'],
    ['Online now',       overview?.totals?.online_now        || 0, '/admin/accounts'],
    ['Active last 24h',  overview?.totals?.active_last_24h   || 0, '/admin/accounts'],
    ['Trial accounts',   overview?.totals?.trial_accounts    || 0, '/admin/accounts'],
    ['Paid accounts',    overview?.totals?.paid_accounts     || 0, '/admin/billing'],
    ['At-risk accounts', overview?.totals?.at_risk_accounts  || 0, '/admin/support'],
    ['Patients',         overview?.totals?.total_patients    || 0, '/admin/accounts'],
    ['Sessions',         overview?.totals?.total_sessions    || 0, '/admin/usage'],
    ['Intake uploads',   overview?.totals?.total_intake_uploads  || 0, '/admin/usage'],
    ['Workspace uses',   overview?.totals?.total_workspace_uses  || 0, '/admin/usage'],
  ]), [overview])

  if (loading) return <div className="p-8 text-sm text-gray-500">Loading overview…</div>

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">

      <AdminPageHeader
        title="Overview"
        subtitle="Platform health, activity, and operations."
        actions={
          <AdminButton variant="secondary" size="sm" onClick={load}>
            Refresh
          </AdminButton>
        }
      />

      <AdminBanners error={error} />

      <LaunchReadinessCard
        readiness={readiness}
        loading={readinessLoading}
        error={readinessError}
        onRefresh={loadReadiness}
      />

      {/* ── Stats grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {topCards.map(([label, value, link]) => (
          <AdminStat
            key={label}
            label={label}
            value={value}
            onClick={link ? () => navigate(link) : undefined}
          />
        ))}
      </div>

      {/* ── Launch operations ────────────────────────────────────────────── */}
      <AdminCard
        title="Launch operations"
        subtitle="Quick production checks for the API, database, and transactional email path."
        action={
          <AdminStatusBadge
            status={postgresStatus?.ok ? 'pass' : 'warn'}
            label={postgresStatus?.ok ? 'Postgres OK' : 'Postgres unchecked'}
          />
        }
      >
        <div className="flex items-center gap-2 flex-wrap">
          <AdminButton
            size="sm"
            variant="secondary"
            onClick={checkPostgres}
            loading={opsBusy === 'postgres'}
          >
            {opsBusy === 'postgres' ? 'Checking…' : 'Check PostgreSQL'}
          </AdminButton>
          <AdminButton
            size="sm"
            variant="secondary"
            onClick={sendEmailDiagnostic}
            loading={opsBusy === 'email'}
          >
            {opsBusy === 'email' ? 'Sending…' : 'Send test email'}
          </AdminButton>
          <a
            href="https://api.miwa.care/health"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Open API health
            <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>

        {postgresStatus?.time && (
          <p className="mt-4 text-xs text-gray-400">
            Last database check: {formatDate(postgresStatus.time)}
          </p>
        )}
        {opsMessage && (
          <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
            {opsMessage}
          </div>
        )}
        {opsError && (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {opsError}
          </div>
        )}
      </AdminCard>

      {/* ── Database backup ──────────────────────────────────────────────── */}
      <AdminCard
        title="Database backup"
        subtitle={`Encrypted nightly snapshot emailed to ${backupStatus?.backup_to_email || '—'} via Gmail (HIPAA-covered).`}
        action={
          <AdminStatusBadge
            status={backupStatus?.enabled ? 'pass' : 'warn'}
            label={backupStatus?.enabled ? 'Enabled' : 'Disabled'}
          />
        }
        footer={backupStatus?.schedule_human ? `Schedule: ${backupStatus.schedule_human}` : undefined}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <AdminButton
            variant="primary"
            size="sm"
            onClick={runBackup}
            loading={backupBusy}
            disabled={!backupStatus?.enabled}
          >
            {backupBusy ? 'Backing up…' : 'Back up now'}
          </AdminButton>
          <a
            href="/api/admin/backup/download"
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            title="Stream the encrypted backup file directly to your computer (no email)."
          >
            Download .miwabk
          </a>
        </div>

        {backupResult && (
          <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs text-emerald-800 space-y-0.5">
            <p className="font-semibold">Backup complete in {backupResult.tookMs}ms</p>
            <p>File: <code className="font-mono">{backupResult.filename}</code></p>
            <p>
              Plain: {(backupResult.plainSize / 1024).toFixed(1)} KB &middot;
              Encrypted: {(backupResult.encryptedSize / 1024).toFixed(1)} KB
            </p>
            <p className="mt-1 text-emerald-700">
              SHA-256:{' '}
              <code className="font-mono text-[10px] break-all">{backupResult.sha256}</code>
            </p>
          </div>
        )}

        {backupError && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700">
            <p className="font-semibold">Backup failed</p>
            <p className="mt-0.5">{backupError}</p>
          </div>
        )}
      </AdminCard>

      {/* ── Funnel + Recent activity ─────────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-6">
        <AdminCard title="Funnel">
          <div className="space-y-3">
            {[
              ['Signed up',             overview?.funnel?.signed_up         || 0],
              ['Active last 30d',       overview?.funnel?.active_last_30d   || 0],
              ['Created patient profiles', overview?.funnel?.with_patients  || 0],
              ['Created sessions',      overview?.funnel?.with_sessions     || 0],
              ['Uploaded intake sources', overview?.funnel?.with_intake_uploads || 0],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <span className="text-sm text-gray-500">{label}</span>
                <span className="text-sm font-semibold text-gray-900 tabular-nums">{value}</span>
              </div>
            ))}
          </div>
        </AdminCard>

        <AdminCard title="Recent activity">
          <div className="space-y-3 max-h-72 overflow-y-auto -mr-2 pr-2">
            {(overview?.recent_events || []).map(event => (
              <div key={event.id} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                <p className="text-sm font-medium text-gray-800">{event.event_type}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {event.full_name || event.email || 'System'}
                  {' · '}
                  {event.status || '—'}
                  {' · '}
                  {formatDate(event.created_at)}
                </p>
                {event.message && (
                  <p className="text-xs text-gray-600 mt-1">{event.message}</p>
                )}
              </div>
            ))}
          </div>
        </AdminCard>
      </div>

      {/* ── Danger zone ─────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Danger zone
        </p>
        <AdminCard highlight="danger">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-sm font-semibold text-gray-900">Reset database</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Permanently deletes all clinical records and test data. Use only for demo resets.
                Cannot be undone.
              </p>
            </div>
            <AdminButton
              variant="danger"
              size="sm"
              onClick={() => setResetModalOpen(true)}
            >
              Reset database
            </AdminButton>
          </div>
        </AdminCard>
      </div>

      <ConfirmModal
        isOpen={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        onConfirm={handleResetDatabase}
        title="Reset database"
        body="This permanently deletes all patient profiles, sessions, intake uploads, and clinical records. This action cannot be undone."
        confirmWord="RESET DATABASE"
        reasonLabel="Reason for reset"
        reasonMinLength={12}
      />
    </div>
  )
}
