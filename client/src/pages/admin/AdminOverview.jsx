import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminApiFetch } from '../../lib/api'
import { formatDate, AdminBanners } from './adminUtils'

const READINESS_STYLES = {
  pass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  fail: 'border-red-200 bg-red-50 text-red-700',
}

function ReadinessBadge({ status }) {
  const label = status === 'pass' ? 'Pass' : status === 'warn' ? 'Warn' : 'Fail'
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${READINESS_STYLES[status] || READINESS_STYLES.warn}`}>
      {label}
    </span>
  )
}

function LaunchReadinessCard({ readiness, loading, error, onRefresh }) {
  const checks = readiness?.checks || []
  const blockers = checks.filter(c => c.status === 'fail')
  const warnings = checks.filter(c => c.status === 'warn')
  const visibleChecks = [...blockers, ...warnings, ...checks.filter(c => c.status === 'pass')]

  return (
    <div className={`card p-5 border ${readiness?.ok ? 'border-emerald-200 bg-emerald-50/30' : 'border-amber-200 bg-amber-50/30'}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Launch readiness</h2>
            {readiness && <ReadinessBadge status={readiness.ok ? 'pass' : blockers.length ? 'fail' : 'warn'} />}
          </div>
          <p className="text-xs text-gray-600 mt-1">
            Production configuration checks for HIPAA-sensitive launch, billing, storage, AI, and email.
          </p>
          {readiness?.time && <p className="text-[11px] text-gray-400 mt-1">Last checked {formatDate(readiness.time)}</p>}
        </div>
        <button onClick={onRefresh} disabled={loading} className="btn-secondary text-sm">
          {loading ? 'Checking...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {readiness && (
        <>
          <div className="grid grid-cols-3 gap-3 mt-4">
            <div className="rounded-xl border border-emerald-100 bg-white/70 p-3">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Pass</p>
              <p className="text-xl font-bold text-emerald-700">{readiness.summary?.pass || 0}</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-white/70 p-3">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Warn</p>
              <p className="text-xl font-bold text-amber-700">{readiness.summary?.warn || 0}</p>
            </div>
            <div className="rounded-xl border border-red-100 bg-white/70 p-3">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Fail</p>
              <p className="text-xl font-bold text-red-700">{readiness.summary?.fail || 0}</p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {visibleChecks.map(check => (
              <div key={check.id} className="rounded-xl border border-gray-100 bg-white px-3 py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{check.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{check.detail}</p>
                </div>
                <ReadinessBadge status={check.status} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
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

  useEffect(() => { load(); loadReadiness(); loadBackupStatus(); checkPostgres() }, [])

  const topCards = useMemo(() => ([
    ['Accounts created', overview?.totals?.total_therapists || 0, '/admin/accounts'],
    ['Online now', overview?.totals?.online_now || 0, '/admin/accounts'],
    ['Active last 24h', overview?.totals?.active_last_24h || 0, '/admin/accounts'],
    ['Trial accounts', overview?.totals?.trial_accounts || 0, '/admin/accounts'],
    ['Paid accounts', overview?.totals?.paid_accounts || 0, '/admin/billing'],
    ['At-risk accounts', overview?.totals?.at_risk_accounts || 0, '/admin/support'],
    ['Patients', overview?.totals?.total_patients || 0, '/admin/accounts'],
    ['Sessions', overview?.totals?.total_sessions || 0, '/admin/usage'],
    ['Intake uploads', overview?.totals?.total_intake_uploads || 0, '/admin/usage'],
    ['Workspace uses', overview?.totals?.total_workspace_uses || 0, '/admin/usage'],
  ]), [overview])

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading overview…</div>

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Overview</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              const confirmation = window.prompt('This deletes test data and clinical records. Type RESET DATABASE to continue.')
              if (confirmation !== 'RESET DATABASE') return
              const reason = window.prompt('Reason for resetting the database:')
              if (!reason || reason.trim().length < 12) {
                alert('Reset cancelled. A specific reason is required.')
                return
              }
              try {
                const r = await adminApiFetch('/admin/reset-database', {
                  method: 'POST',
                  body: JSON.stringify({ confirmation, reason }),
                })
                const d = await r.json()
                if (!r.ok) throw new Error(d.error || 'Reset failed')
                alert(d.message || 'Database reset complete')
                load()
              } catch (err) { alert('Reset failed: ' + err.message) }
            }}
            className="px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors"
          >
            Reset Database
          </button>
          <button onClick={load} className="btn-secondary text-sm">Refresh</button>
        </div>
      </div>

      <AdminBanners error={error} />

      <LaunchReadinessCard
        readiness={readiness}
        loading={readinessLoading}
        error={readinessError}
        onRefresh={loadReadiness}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {topCards.map(([label, value, link]) => (
          <div
            key={label}
            onClick={() => link && navigate(link)}
            className="card p-4 cursor-pointer hover:border-brand-300 hover:shadow-md transition-all"
          >
            <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Launch operations</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Quick production checks for the API, database, and transactional email path.
            </p>
          </div>
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
            postgresStatus?.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {postgresStatus?.ok ? 'POSTGRES OK' : 'POSTGRES NOT CONFIRMED'}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={checkPostgres}
            disabled={opsBusy === 'postgres'}
            className="px-4 py-2 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 disabled:opacity-50 transition-colors"
          >
            {opsBusy === 'postgres' ? 'Checking...' : 'Check PostgreSQL'}
          </button>
          <button
            type="button"
            onClick={sendEmailDiagnostic}
            disabled={opsBusy === 'email'}
            className="px-4 py-2 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 disabled:opacity-50 transition-colors"
          >
            {opsBusy === 'email' ? 'Sending...' : 'Send test email'}
          </button>
          <a
            href="https://api.miwa.care/health"
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-lg text-xs font-bold text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 transition-colors"
          >
            Open API health
          </a>
        </div>

        {postgresStatus?.time && (
          <p className="mt-3 text-xs text-gray-500">
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
      </div>

      {/* ── Backup card ─────────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Database Backup</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Encrypted nightly snapshot emailed to {backupStatus?.backup_to_email || '—'} via Gmail (HIPAA-covered).
            </p>
          </div>
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${backupStatus?.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {backupStatus?.enabled ? 'ENABLED' : 'DISABLED — set BACKUP_PASSPHRASE'}
          </span>
        </div>

        {backupStatus?.schedule_human && (
          <p className="text-xs text-gray-500 mb-3">Schedule: {backupStatus.schedule_human}</p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={runBackup}
            disabled={backupBusy || !backupStatus?.enabled}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {backupBusy ? 'Backing up…' : 'Back up now'}
          </button>
          <a
            href="/api/admin/backup/download"
            className="px-4 py-2 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-colors"
            title="Stream the encrypted backup file directly to your computer (no email)."
          >
            Download .miwabk
          </a>
        </div>

        {backupResult && (
          <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
            <p className="font-semibold">✓ Backup complete in {backupResult.tookMs}ms</p>
            <p className="mt-0.5">File: <code className="font-mono">{backupResult.filename}</code></p>
            <p>Plain: {(backupResult.plainSize / 1024).toFixed(1)} KB · Encrypted: {(backupResult.encryptedSize / 1024).toFixed(1)} KB</p>
            <p className="mt-1">SHA-256 (plaintext): <code className="font-mono text-[10px] break-all">{backupResult.sha256}</code></p>
          </div>
        )}

        {backupError && (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            <p className="font-semibold">Backup failed</p>
            <p className="mt-0.5">{backupError}</p>
          </div>
        )}
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
  )
}
