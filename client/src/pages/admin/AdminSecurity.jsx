import { useEffect, useState } from 'react'
import { adminApiFetch } from '../../lib/api'
import { AdminBanners } from './adminUtils'
import {
  AdminButton,
  AdminCard,
  AdminPageHeader,
  AdminStatusBadge,
} from '../../components/admin'

function PolicyList({ title, items }) {
  return (
    <AdminCard title={title}>
      <div className="space-y-2">
        {(items || []).map(item => (
          <div key={item} className="flex items-start gap-2 text-sm text-gray-700">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-brand-500 flex-shrink-0" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </AdminCard>
  )
}

export default function AdminSecurity() {
  const [policy, setPolicy] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reason, setReason] = useState('')
  const [targetTherapistId, setTargetTherapistId] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await adminApiFetch('/admin/access-policy')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load access policy')
      setPolicy(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const requestBreakGlass = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await adminApiFetch('/admin/break-glass/request', {
        method: 'POST',
        body: JSON.stringify({
          therapist_id: targetTherapistId ? Number(targetTherapistId) : null,
          reason,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setNotice(data.error || 'Break-glass access is not enabled.')
        return
      }
      setNotice(data.message || 'Request recorded.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-500">Loading security policy...</div>

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <AdminPageHeader
        title="Security"
        subtitle="Review admin access boundaries and record break-glass access requests."
        actions={
          <AdminButton variant="secondary" size="sm" onClick={load}>
            Refresh
          </AdminButton>
        }
      />

      <AdminBanners notice={notice} error={error} />

      <AdminCard
        title="Default admin boundary"
        subtitle="Admin access is limited to operations by default. Client clinical data is not browsable from this console."
        highlight="success"
        action={<AdminStatusBadge status="pass" label="OK" />}
      >
        <p className="text-sm text-emerald-800 max-w-3xl">
          {policy?.default_admin_access || 'Account, billing, support, usage, and operational metadata only.'}
        </p>
      </AdminCard>

      <div className="grid lg:grid-cols-2 gap-4">
        <PolicyList title="Allowed by default" items={policy?.permitted_default_access} />
        <PolicyList title="Not allowed by default" items={policy?.prohibited_default_access} />
      </div>

      <AdminCard
        title="Break-glass access"
        subtitle="This is intentionally disabled. Any future PHI access should require a reason, time limit, elevated permission, and immutable audit log before showing records."
        action={<AdminStatusBadge status="warn" label="Disabled" />}
      >
        <div className="grid md:grid-cols-[180px_1fr_auto] gap-3 items-start">
          <input
            className="input text-sm"
            inputMode="numeric"
            placeholder="Therapist ID"
            aria-label="Therapist ID"
            value={targetTherapistId}
            onChange={e => setTargetTherapistId(e.target.value)}
          />
          <textarea
            className="textarea text-sm"
            rows={2}
            placeholder="Reason for access request"
            aria-label="Reason for access request"
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
          <AdminButton
            disabled={busy || reason.trim().length < 12}
            loading={busy}
            onClick={requestBreakGlass}
            size="sm"
          >
            Record request
          </AdminButton>
        </div>
      </AdminCard>
    </div>
  )
}
