import { useEffect, useState } from 'react'
import { adminApiFetch } from '../../lib/api'
import { AdminBanners } from './adminUtils'
import {
  AdminButton,
  AdminCard,
  AdminPageHeader,
  AdminStat,
} from '../../components/admin'

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

  if (loading) return <div className="p-8 text-sm text-gray-500">Loading usage...</div>

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <AdminPageHeader
        title="Usage"
        subtitle="Track clinical workspace activity, feature adoption, and top active accounts."
        actions={
          <AdminButton variant="secondary" size="sm" onClick={load}>
            Refresh
          </AdminButton>
        }
      />

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
          <AdminStat key={label} label={label} value={value} />
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <AdminCard title="Feature adoption" subtitle="How many therapists have used core clinical workflow features.">
          <div className="space-y-3">
            {[
              ['Therapists with patients', usage?.feature_adoption?.therapists_with_patients || 0],
              ['Therapists with sessions', usage?.feature_adoption?.therapists_with_sessions || 0],
              ['Therapists with intake uploads', usage?.feature_adoption?.therapists_with_intake_uploads || 0],
              ['Therapists with record files', usage?.feature_adoption?.therapists_with_record_files || 0],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <span className="text-sm text-gray-500">{label}</span>
                <span className="text-sm font-semibold text-gray-900 tabular-nums">{value}</span>
              </div>
            ))}
          </div>
        </AdminCard>

        <AdminCard title="Top users" subtitle="Accounts with the highest workspace usage.">
          <div className="space-y-3 max-h-72 overflow-y-auto -mr-2 pr-2">
            {(usage?.top_users || []).map(user => (
              <div key={user.id} className="flex items-center justify-between gap-3 text-sm border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                <div>
                  <p className="font-medium text-gray-900">{user.full_name || user.email}</p>
                  <p className="text-xs text-gray-500">{user.email}</p>
                </div>
                <div className="text-right text-xs text-gray-600">
                  <div>{user.workspace_uses} workspace uses</div>
                  <div>{user.patient_count} patients | {user.session_count} sessions</div>
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      </div>
    </div>
  )
}
