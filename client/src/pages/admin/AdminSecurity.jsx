import { useEffect, useState } from 'react'
import { adminApiFetch } from '../../lib/api'
import { AdminBanners } from './adminUtils'

function PolicyList({ title, items }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mt-3 space-y-2">
        {(items || []).map(item => (
          <div key={item} className="flex items-start gap-2 text-sm text-gray-700">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-brand-500 flex-shrink-0" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
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

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading security policy...</div>

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Security</h2>
          <p className="text-sm text-gray-500 mt-1">
            Admin access is limited to operations by default. Client clinical data is not browsable from this console.
          </p>
        </div>
        <button onClick={load} className="btn-secondary text-sm">Refresh</button>
      </div>

      <AdminBanners notice={notice} error={error} />

      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
            OK
          </div>
          <div>
            <h3 className="text-sm font-semibold text-emerald-950">Default admin boundary</h3>
            <p className="mt-1 text-sm text-emerald-800 max-w-3xl">
              {policy?.default_admin_access || 'Account, billing, support, usage, and operational metadata only.'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <PolicyList title="Allowed by default" items={policy?.permitted_default_access} />
        <PolicyList title="Not allowed by default" items={policy?.prohibited_default_access} />
      </div>

      <div className="card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Break-glass access</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-2xl">
              This is intentionally disabled. Any future PHI access should require a reason, time limit, elevated permission, and immutable audit log before showing records.
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
            Disabled
          </span>
        </div>

        <div className="mt-4 grid md:grid-cols-[180px_1fr_auto] gap-3 items-start">
          <input
            className="input text-sm"
            inputMode="numeric"
            placeholder="Therapist ID"
            value={targetTherapistId}
            onChange={e => setTargetTherapistId(e.target.value)}
          />
          <textarea
            className="textarea text-sm"
            rows={2}
            placeholder="Reason for access request"
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || reason.trim().length < 12}
            onClick={requestBreakGlass}
            className="btn-secondary text-sm disabled:opacity-50"
          >
            Record request
          </button>
        </div>
      </div>
    </div>
  )
}
