import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

const PLANS = [
  {
    id: 'trainee',
    name: 'Trainee / Intern',
    price: '$39',
    period: '/mo',
    badge: null,
    color: '#6366f1',
    desc: 'MFT Trainee, ACSW Trainee, LPCC Intern. Full access with supervisor verification.',
    features: [
      'Agentic Miwa copilot',
      'Unlimited clients & sessions',
      'Voice → clinical notes (SOAP/BIRP/DAP)',
      'PHQ-9, GAD-7, PCL-5 assessments',
      'Supervision prep & case presentations',
    ],
  },
  {
    id: 'associate',
    name: 'Associate',
    price: '$69',
    period: '/mo',
    badge: 'Most popular',
    color: '#0d9488',
    desc: 'AMFT, ACSW, APCC — licensed associate. Full access at associate pricing.',
    features: [
      'Everything in Trainee',
      'Proactive caseload alerts',
      'Batch assessment sender',
      'Court, insurance & supervision reports',
      'Priority support',
    ],
  },
  {
    id: 'solo',
    name: 'Licensed Therapist',
    price: '$129',
    period: '/mo',
    badge: null,
    color: '#7c3aed',
    desc: 'LMFT, LCSW, LPCC — fully licensed. Full access, no verification needed.',
    features: [
      'Everything in Associate',
      'No verification required',
      'Document intake parsing (AI)',
      'Appointment scheduling via Miwa',
      'Export to PDF',
    ],
  },
]

const STATUS_LABELS = {
  active:   { label: 'Active',      color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
  trial:    { label: 'Free Trial',  color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  past_due: { label: 'Past Due',    color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  expired:  { label: 'Expired',     color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb' },
}

export default function Billing() {
  const { therapist } = useAuth()

  const [billing, setBilling]               = useState(null)
  const [billingLoading, setBillingLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState('')
  const [portalLoading, setPortalLoading]   = useState(false)
  const [error, setError]                   = useState('')

  // Detect Stripe redirect returns
  const params        = new URLSearchParams(window.location.search)
  const justSubscribed = params.get('subscribed') === '1'
  const justCanceled   = params.get('canceled')   === '1'

  useEffect(() => {
    setBillingLoading(true)
    apiFetch('/billing/status')
      .then(r => r.json())
      .then(data => { setBilling(data); setBillingLoading(false) })
      .catch(() => setBillingLoading(false))
  }, [justSubscribed])

  const handleSubscribe = async (planId) => {
    setCheckoutLoading(planId)
    setError('')
    try {
      const res  = await apiFetch('/billing/create-checkout-session', {
        method: 'POST',
        body: JSON.stringify({ plan: planId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not start checkout')
      window.location.href = data.url
    } catch (err) {
      setError(err.message)
      setCheckoutLoading('')
    }
  }

  const handleManageBilling = async () => {
    setPortalLoading(true)
    setError('')
    try {
      const res  = await apiFetch('/billing/portal', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not open billing portal')
      window.location.href = data.url
    } catch (err) {
      setError(err.message)
      setPortalLoading(false)
    }
  }

  const trialUsed      = billing?.workspace_uses  ?? 0
  const trialLimit     = billing?.trial_limit      ?? 10
  const trialRemaining = billing?.trial_remaining  ?? trialLimit
  const trialPct       = Math.min(100, Math.round((trialUsed / trialLimit) * 100))
  const isActive       = billing?.is_active
  const status         = billing?.subscription_status ?? 'trial'
  const statusStyle    = STATUS_LABELS[status] ?? STATUS_LABELS.trial
  const currentTier    = billing?.subscription_tier

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Billing</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your Miwa subscription and payment information.</p>
      </div>

      {/* ── Stripe redirect banners ───────────────────────────────────────── */}
      {justSubscribed && (
        <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 flex items-center gap-3">
          <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-green-800">Subscription activated!</p>
            <p className="text-xs text-green-600">You now have unlimited access to Miwa. Welcome aboard!</p>
          </div>
        </div>
      )}
      {justCanceled && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Checkout canceled. No charge was made. You can subscribe any time below.
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {billingLoading ? (
        <div className="card p-8 flex items-center justify-center gap-3 text-gray-400 text-sm">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-brand-400 rounded-full animate-spin" />
          Loading billing info…
        </div>
      ) : (
        <>
          {/* ── Current plan card ──────────────────────────────────────────── */}
          <div className="card p-6">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-900">Current Plan</h2>
                <p className="text-xs text-gray-500 mt-0.5">Your subscription and usage at a glance.</p>
              </div>
              {/* Status badge */}
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full border"
                style={{ color: statusStyle.color, background: statusStyle.bg, borderColor: statusStyle.border }}
              >
                {statusStyle.label}
              </span>
            </div>

            {isActive ? (
              /* ── Active subscriber ── */
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 capitalize">
                      {currentTier ? `${currentTier} Plan` : 'Miwa Subscription'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">Unlimited workspace generations</p>
                  </div>
                  <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>

                <div className="rounded-xl border border-gray-200 p-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment & Invoices</p>
                  <p className="text-sm text-gray-600">
                    Payments, invoices, and card details are managed securely through Stripe.
                  </p>
                  <button
                    onClick={handleManageBilling}
                    disabled={portalLoading}
                    className="mt-2 flex items-center gap-2 text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors disabled:opacity-60"
                  >
                    {portalLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
                        Opening portal…
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Open Billing Portal →
                      </>
                    )}
                  </button>
                  <p className="text-xs text-gray-400">Update card, download invoices, or cancel. All from Stripe's secure portal.</p>
                </div>
              </div>
            ) : (
              /* ── Trial / expired ── */
              <div className="space-y-4">
                {/* Usage bar */}
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700">
                      {status === 'expired' ? 'Trial ended' : 'Free trial usage'}
                    </span>
                    <span className={`text-xs font-bold ${trialRemaining === 0 ? 'text-red-600' : 'text-brand-600'}`}>
                      {trialRemaining === 0
                        ? 'No generations left'
                        : `${trialRemaining} of ${trialLimit} remaining`}
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        trialPct >= 100 ? 'bg-red-400' : trialPct >= 70 ? 'bg-amber-400' : 'bg-brand-500'
                      }`}
                      style={{ width: `${trialPct}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    {trialUsed} workspace generation{trialUsed !== 1 ? 's' : ''} used.
                    {trialRemaining === 0
                      ? ' Subscribe below to continue using Miwa.'
                      : ` Subscribe anytime to unlock unlimited access.`}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── Plans (only shown when not active) ─────────────────────────── */}
          {!isActive && (
            <div className="card p-6 space-y-4">
              <div className="flex items-start gap-3 mb-1">
                <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Choose a Plan</h2>
                  <p className="text-xs text-gray-500 mt-0.5">All plans include unlimited workspace generations and the full AI suite.</p>
                </div>
              </div>

              <div className="space-y-3">
                {PLANS.map(plan => (
                  <div
                    key={plan.id}
                    className="rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-sm font-bold text-gray-900">{plan.name}</span>
                          {plan.badge && (
                            <span
                              className="text-xs font-semibold px-2 py-0.5 rounded-full"
                              style={{ background: `${plan.color}18`, color: plan.color }}
                            >
                              {plan.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mb-2">{plan.desc}</p>
                        <ul className="space-y-1">
                          {plan.features.map(f => (
                            <li key={f} className="flex items-center gap-1.5 text-xs text-gray-600">
                              <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: plan.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <div className="text-right">
                          <span className="text-2xl font-extrabold text-gray-900">{plan.price}</span>
                          <span className="text-xs text-gray-400">{plan.period}</span>
                          {plan.perSeat && (
                            <p className="text-xs mt-0.5 font-medium" style={{ color: plan.color }}>+$39/mo per seat</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleSubscribe(plan.id)}
                          disabled={!!checkoutLoading}
                          className="text-xs font-semibold px-4 py-2 rounded-lg text-white transition-opacity disabled:opacity-60 whitespace-nowrap"
                          style={{ background: plan.color }}
                        >
                          {checkoutLoading === plan.id ? 'Redirecting…' : 'Subscribe →'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-gray-400 text-center">
                Secure payments via Stripe · Cancel anytime · No contracts
              </p>
            </div>
          )}

          {/* ── Upgrade option for active users ────────────────────────────── */}
          {isActive && (
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Need to change plans?</p>
                  <p className="text-xs text-gray-500 mt-0.5">Upgrade, downgrade, or cancel from the Stripe billing portal.</p>
                </div>
                <button
                  onClick={handleManageBilling}
                  disabled={portalLoading}
                  className="btn-secondary text-sm flex-shrink-0 disabled:opacity-60"
                >
                  {portalLoading ? 'Opening…' : 'Manage Plan'}
                </button>
              </div>
            </div>
          )}

          {/* ── Account info ───────────────────────────────────────────────── */}
          <div className="card p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Billing Account</p>
            <dl className="space-y-2 text-sm">
              <div className="flex gap-3">
                <dt className="text-gray-400 w-28 flex-shrink-0 text-xs">Email</dt>
                <dd className="text-gray-700 font-medium text-xs">{therapist?.email}</dd>
              </div>
              {therapist?.full_name && (
                <div className="flex gap-3">
                  <dt className="text-gray-400 w-28 flex-shrink-0 text-xs">Name</dt>
                  <dd className="text-gray-700 font-medium text-xs">{therapist.full_name}</dd>
                </div>
              )}
              <div className="flex gap-3">
                <dt className="text-gray-400 w-28 flex-shrink-0 text-xs">Plan status</dt>
                <dd className="text-xs font-semibold" style={{ color: statusStyle.color }}>
                  {statusStyle.label}
                </dd>
              </div>
            </dl>
          </div>
        </>
      )}
    </div>
  )
}
