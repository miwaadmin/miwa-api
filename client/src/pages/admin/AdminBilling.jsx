import { useEffect, useState } from 'react'
import { adminApiFetch } from '../../lib/api'
import { AdminBanners } from './adminUtils'
import {
  AdminButton,
  AdminCard,
  AdminPageHeader,
  AdminStat,
  AdminStatusBadge,
} from '../../components/admin'

export default function AdminBilling() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [billing, setBilling] = useState(null)
  const [stripeStatus, setStripeStatus] = useState(null)
  const [allAccounts, setAllAccounts] = useState([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [billingRes, stripeRes] = await Promise.all([
        adminApiFetch('/admin/billing'),
        adminApiFetch('/admin/stripe/status'),
      ])
      const data = await billingRes.json()
      const stripeData = await stripeRes.json()
      if (!billingRes.ok) throw new Error(data.error || 'Failed to load billing')
      if (stripeRes.ok) setStripeStatus(stripeData)
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
      const res = await adminApiFetch('/admin/therapists')
      const data = await res.json()
      if (res.ok) {
        setAllAccounts(Array.isArray(data) ? data : [])
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

  if (loading) return <div className="p-8 text-sm text-gray-500">Loading billing...</div>

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <AdminPageHeader
        title="Billing"
        subtitle="Review Stripe readiness, subscription health, and billing status across accounts."
        actions={
          <AdminButton variant="secondary" size="sm" onClick={load}>
            Refresh
          </AdminButton>
        }
      />

      <AdminBanners error={error} />

      <AdminCard
        title="Stripe launch check"
        subtitle="Confirms the API key, webhook secret, app URL, and plan prices without showing secrets."
        action={
          <AdminStatusBadge
            status={stripeStatus?.ok ? 'pass' : 'warn'}
            label={stripeStatus?.ok ? 'Ready' : 'Needs review'}
          />
        }
      >
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ['Mode', stripeStatus?.mode || 'unknown'],
            ['API account', stripeStatus?.account?.reachable ? 'reachable' : 'not verified'],
            ['Webhook', stripeStatus?.webhook?.configured ? 'configured' : 'missing'],
            ['App URL', stripeStatus?.app_url?.canonical ? 'miwa.care' : 'review'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-gray-100 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-3 font-semibold">Plan</th>
                <th className="py-2 pr-3 font-semibold">Env</th>
                <th className="py-2 pr-3 font-semibold">Type</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Currency</th>
                <th className="py-2 pr-3 font-semibold">Review reason</th>
              </tr>
            </thead>
            <tbody>
              {(stripeStatus?.prices || []).map(price => {
                const ready = price.status === 'ready' || (
                  price.configured &&
                  price.exists !== false &&
                  price.active !== false &&
                  price.recurring !== false
                )
                return (
                  <tr key={price.env} className="border-b border-gray-100">
                    <td className="py-2 pr-3 font-medium text-gray-900">{price.name}</td>
                    <td className="py-2 pr-3 text-gray-500">{price.env}</td>
                    <td className="py-2 pr-3 text-gray-600">{price.type}</td>
                    <td className="py-2 pr-3">
                      <AdminStatusBadge
                        status={ready ? 'pass' : price.configured ? 'warn' : 'fail'}
                        label={ready ? 'ready' : price.configured ? 'review' : 'missing'}
                      />
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{price.currency || '-'}</td>
                    <td className="py-2 pr-3 text-gray-500 max-w-xs">{price.review_reason || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </AdminCard>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          ['Trial accounts', billing?.summary?.trial_accounts || 0],
          ['Paid accounts', billing?.summary?.active_paid_accounts || 0],
          ['Past due', billing?.summary?.past_due_accounts || 0],
          ['Expired', billing?.summary?.expired_accounts || 0],
          ['Stripe connected', billing?.summary?.stripe_connected_accounts || 0],
        ].map(([label, value]) => (
          <AdminStat key={label} label={label} value={value} />
        ))}
      </div>

      <AdminCard title="Trial ending soon" subtitle="Accounts nearing the end of their trial usage allowance.">
        <div className="space-y-3">
          {(billing?.trial_ending_soon || []).map(account => (
            <div key={account.id} className="flex items-center justify-between gap-3 border-b border-gray-100 pb-2 last:border-0 text-sm">
              <div>
                <p className="font-medium text-gray-900">{account.full_name || account.email}</p>
                <p className="text-xs text-gray-500">{account.email}</p>
              </div>
              <div className="text-xs text-gray-600">
                {Math.max(0, (account.trial_limit || 10) - (account.workspace_uses || 0))} trial uses remaining
              </div>
            </div>
          ))}
        </div>
      </AdminCard>

      <AdminCard
        title="All accounts"
        subtitle="Load and search account billing status on demand."
        action={
          <AdminButton onClick={loadAllAccounts} size="sm" loading={loadingAccounts}>
            {loadingAccounts ? 'Loading...' : (allAccounts.length > 0 ? 'Refresh' : 'Load')}
          </AdminButton>
        }
      >
        {allAccounts.length === 0 ? (
          <p className="text-sm text-gray-500">Click "Load" to view all accounts with their billing status</p>
        ) : (
          <>
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search by name or email..."
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
                            <p className="font-medium text-gray-900">{account.full_name || ', '}</p>
                          </td>
                          <td className="py-3 px-3 text-gray-600">{account.email}</td>
                          <td className="py-3 px-3">
                            <AdminStatusBadge status={isOnTrial ? 'trial' : 'active'} />
                          </td>
                          <td className="py-3 px-3">
                            {hasStripe ? (
                              <AdminStatusBadge status="pass" label="Connected" />
                            ) : (
                              <span className="text-xs text-gray-400">, </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-gray-600">
                            {trialsRemaining !== null ? (
                              <span>{trialsRemaining}</span>
                            ) : (
                              <span className="text-gray-400">, </span>
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
      </AdminCard>
    </div>
  )
}
