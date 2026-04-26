import { useEffect, useState } from 'react'
import { adminApiFetch } from '../../lib/api'
import { AdminBanners } from './adminUtils'

export default function AdminUsage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [usage, setUsage] = useState(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await adminApiFetch('/admin/usage')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load usage')
      setUsage(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading usage…</div>

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Usage</h2>
        <button onClick={load} className="btn-secondary text-sm">Refresh</button>
      </div>

      <AdminBanners error={error} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          ['Sessions last 7d', usage?.summary?.sessions_last_7d || 0],
          ['Sessions last 30d', usage?.summary?.sessions_last_30d || 0],
          ['Profiles last 30d', usage?.summary?.patient_profiles_last_30d || 0],
          ['Intake uploads last 30d', usage?.summary?.intake_uploads_last_30d || 0],
          ['Record uploads last 30d', usage?.summary?.record_uploads_last_30d || 0],
          ['Total workspace uses', usage?.summary?.total_workspace_uses || 0],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
          </div>
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
  )
}
