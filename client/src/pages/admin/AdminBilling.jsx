import { useEffect, useState } from 'react'
import { adminApiFetch } from '../../lib/api'
import { AdminBanners } from './adminUtils'

export default function AdminBilling() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [billing, setBilling] = useState(null)
  const [allAccounts, setAllAccounts] = useState([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await adminApiFetch('/admin/billing')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load billing')
      setBilling(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadAllAccounts = async () => {
    setLoadingAccounts(true)
    try {
      const res = await adminApiFetch('/admin/accounts?limit=999')
      const data = await res.json()
      if (res.ok) {
        setAllAccounts(data.accounts || [])
      }
    } catch (err) {
      console.error('Failed to load accounts:', err)
    } finally {
      setLoadingAccounts(false)
    }
  }

  useEffect(() => { load() }, [])

  const filteredAccounts = allAccounts.filter(acc => {
    const query = searchQuery.toLowerCase()
    return (
      acc.full_name?.toLowerCase().includes(query) ||
      acc.email?.toLowerCase().includes(query)
    )
  })

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading billing…</div>

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Billing</h2>
        <button onClick={load} className="btn-secondary text-sm">Refresh</button>
      </div>

      <AdminBanners error={error} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          ['Trial accounts', billing?.summary?.trial_accounts || 0],
          ['Paid accounts', billing?.summary?.active_paid_accounts || 0],
          ['Past due', billing?.summary?.past_due_accounts || 0],
          ['Expired', billing?.summary?.expired_accounts || 0],
          ['Stripe connected', billing?.summary?.stripe_connected_accounts || 0],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

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

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">All accounts</h2>
          <button
            onClick={loadAllAccounts}
            className="btn-secondary text-sm"
            disabled={loadingAccounts}
          >
            {loadingAccounts ? 'Loading…' : (allAccounts.length > 0 ? 'Refresh' : 'Load')}
          </button>
        </div>

        {allAccounts.length === 0 ? (
          <p className="text-sm text-gray-500">Click "Load" to view all accounts with their billing status</p>
        ) : (
          <>
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search by name or email…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input text-sm"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 font-semibold text-gray-600">Name</th>
                    <th className="text-left py-2 px-3 font-semibold text-gray-600">Email</th>
                    <th className="text-left py-2 px-3 font-semibold text-gray-600">Status</th>
                    <th className="text-left py-2 px-3 font-semibold text-gray-600">Stripe</th>
                    <th className="text-left py-2 px-3 font-semibold text-gray-600">Trial uses</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="text-center py-4 text-gray-500">No accounts match your search</td>
                    </tr>
                  ) : (
                    filteredAccounts.map(account => {
                      const isOnTrial = account.on_trial
                      const hasStripe = !!account.stripe_customer_id
                      const trialsRemaining = account.trial_limit ? Math.max(0, account.trial_limit - (account.workspace_uses || 0)) : null

                      return (
                        <tr key={account.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 px-3">
                            <p className="font-medium text-gray-900">{account.full_name || '—'}</p>
                          </td>
                          <td className="py-3 px-3 text-gray-600">{account.email}</td>
                          <td className="py-3 px-3">
                            {isOnTrial ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                                Trial
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">
                                Active
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            {hasStripe ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700">
                                ✓ Connected
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-gray-600">
                            {trialsRemaining !== null ? (
                              <span>{trialsRemaining}</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-gray-500">
              Showing {filteredAccounts.length} of {allAccounts.length} account{allAccounts.length !== 1 ? 's' : ''}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
