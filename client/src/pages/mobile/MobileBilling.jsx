/**
 * MobileBilling — native subscription + plans screen.
 *
 * Status lives at the top in a clean card (plan, trial countdown,
 * next-billed amount, manage-subscription button). Plans stack below
 * as big tappable cards with the current plan visually pinned.
 *
 * Hits /billing/status, /billing/create-checkout-session (Stripe
 * Checkout), /billing/portal (Stripe Customer Portal) — same backend
 * as desktop Billing.jsx.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'

const PLANS = [
  {
    id: 'trainee',
    name: 'Trainee / Intern',
    price: '$39',
    period: '/mo',
    color: '#6366f1',
    desc: 'MFT Trainee, ACSW Trainee, LPCC Intern. Full access with supervisor verification.',
    features: [
      'Full Miwa AI copilot',
      'Unlimited clients & sessions',
      'Voice → clinical notes',
      'PHQ-9, GAD-7, PCL-5 assessments',
      'Pre-session briefs + risk monitor',
    ],
  },
  {
    id: 'associate',
    name: 'Associate',
    price: '$69',
    period: '/mo',
    badge: 'Most popular',
    color: '#0d9488',
    desc: 'AMFT, ACSW, APCC. Full access at associate pricing.',
    features: [
      'Everything in Trainee',
      'Proactive caseload alerts',
      'Letter generator (ESA, 504, etc.)',
      'Attorney + insurance pre-auth',
      'Priority support',
    ],
  },
  {
    id: 'solo',
    name: 'Licensed Therapist',
    price: '$129',
    period: '/mo',
    color: '#7c3aed',
    desc: 'LMFT, LCSW, LPCC. No verification required.',
    features: [
      'Everything in Associate',
      'All multi-step workflows',
      'Document intake parsing',
      'Scheduling via Miwa',
      'Export to PDF',
    ],
  },
  {
    id: 'group',
    name: 'Group Practice',
    price: '$399',
    period: '/mo',
    color: '#0f766e',
    desc: 'Min. 3 clinicians included. +$39/mo each. 10+? Contact us.',
    perSeat: true,
    features: [
      'Everything in Licensed',
      '3 clinicians included',
      'Practice-level dashboard',
      'Dedicated onboarding call',
    ],
  },
]

const STATUS_TONES = {
  active:   { label: 'Active',      color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
  trial:    { label: 'Free trial',  color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  past_due: { label: 'Past due',    color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  expired:  { label: 'Expired',     color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
}

function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '' }
}

function daysUntil(iso) {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

export default function MobileBilling() {
  const navigate = useNavigate()
  const [billing, setBilling]               = useState(null)
  const [loading, setLoading]               = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState('')
  const [portalLoading, setPortalLoading]   = useState(false)
  const [error, setError]                   = useState('')

  const params = new URLSearchParams(window.location.search)
  const justSubscribed = params.get('subscribed') === '1'

  useEffect(() => {
    setLoading(true)
    apiFetch('/billing/status')
      .then(r => r.json())
      .then(data => { setBilling(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [justSubscribed])

  const handleCheckout = async (planId) => {
    setCheckoutLoading(planId); setError('')
    try {
      const res = await apiFetch('/billing/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not start checkout')
      if (data.url) window.location.href = data.url
    } catch (err) {
      setError(err.message)
    } finally {
      setCheckoutLoading('')
    }
  }

  const handlePortal = async () => {
    setPortalLoading(true); setError('')
    try {
      const res = await apiFetch('/billing/portal', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not open billing portal')
      if (data.url) window.location.href = data.url
    } catch (err) {
      setError(err.message)
    } finally {
      setPortalLoading(false)
    }
  }

  const status = billing?.status || (billing?.is_trial ? 'trial' : (billing?.is_active ? 'active' : 'expired'))
  const statusTone = STATUS_TONES[status] || STATUS_TONES.expired
  const currentPlanId = billing?.plan || billing?.plan_id
  const trialDays = billing?.trial_end ? daysUntil(billing.trial_end) : null

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-gray-100 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Billing</h1>
        <button
          onClick={() => navigate('/m/more')}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 active:bg-gray-100"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-28">
        {/* Subscribed-return banner */}
        {justSubscribed && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 mb-4">
            <p className="text-sm font-bold text-emerald-900">🎉 Subscription activated</p>
            <p className="text-[13px] text-emerald-800 mt-1">You're all set. Welcome to Miwa.</p>
          </div>
        )}

        {/* Current status card */}
        {loading ? (
          <div className="rounded-2xl bg-white border border-gray-100 p-5 mb-4 animate-pulse">
            <div className="h-3 bg-gray-200 rounded w-1/3 mb-3" />
            <div className="h-6 bg-gray-200 rounded w-2/3 mb-2" />
            <div className="h-2 bg-gray-100 rounded w-1/4" />
          </div>
        ) : billing ? (
          <div className="rounded-2xl bg-white border border-gray-100 p-5 mb-4 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Your plan</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">
                  {PLANS.find(p => p.id === currentPlanId)?.name || 'No active plan'}
                </p>
              </div>
              <span
                className="inline-flex items-center text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border"
                style={{ color: statusTone.color, background: statusTone.bg, borderColor: statusTone.border }}
              >
                {statusTone.label}
              </span>
            </div>

            {status === 'trial' && trialDays != null && (
              <p className="text-sm text-gray-600 mb-3">
                {trialDays === 0 ? 'Trial ends today.' :
                  trialDays === 1 ? '1 day left in your free trial.' :
                  `${trialDays} days left in your free trial.`}
              </p>
            )}

            {billing.current_period_end && status === 'active' && (
              <p className="text-sm text-gray-600 mb-3">
                Renews {fmtDate(billing.current_period_end)}
              </p>
            )}

            {status === 'past_due' && (
              <p className="text-sm text-red-700 mb-3">
                Your last payment failed. Update your card to keep access.
              </p>
            )}

            {(status === 'active' || status === 'past_due') && (
              <button
                onClick={handlePortal}
                disabled={portalLoading}
                className="w-full rounded-xl py-3 text-sm font-bold text-white active:opacity-90 disabled:opacity-60"
                style={{ background: '#111113' }}
              >
                {portalLoading ? 'Opening…' : 'Manage subscription'}
              </button>
            )}
          </div>
        ) : null}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 mb-4">
            {error}
          </div>
        )}

        {/* Plans */}
        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3 px-1">
          {currentPlanId ? 'Change plan' : 'Choose a plan'}
        </p>
        <div className="space-y-3">
          {PLANS.map(p => {
            const current = p.id === currentPlanId
            const loading = checkoutLoading === p.id
            return (
              <div
                key={p.id}
                className={`rounded-2xl p-5 bg-white transition-all ${current ? 'ring-2 shadow-sm' : 'border border-gray-100'}`}
                style={current ? { borderColor: 'transparent', boxShadow: `0 0 0 2px ${p.color}` } : {}}
              >
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: p.color }}>
                      {p.badge || 'Plan'}
                    </p>
                    <p className="text-lg font-bold text-gray-900 mt-0.5">{p.name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xl font-bold text-gray-900">{p.price}</p>
                    <p className="text-[11px] text-gray-500">{p.period}</p>
                  </div>
                </div>
                <p className="text-[13px] text-gray-600 mb-3 leading-relaxed">{p.desc}</p>
                <ul className="space-y-1.5 mb-4">
                  {p.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-gray-700">
                      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke={p.color} strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                {current ? (
                  <div className="w-full rounded-xl py-3 text-sm font-bold text-center"
                    style={{ background: `${p.color}15`, color: p.color }}>
                    ✓ Current plan
                  </div>
                ) : p.id === 'group' ? (
                  <a
                    href="mailto:hello@miwa.care?subject=Miwa%20for%20Teams"
                    className="block w-full rounded-xl py-3 text-sm font-bold text-center active:opacity-90"
                    style={{ background: `${p.color}15`, color: p.color, border: `1px solid ${p.color}30` }}
                  >
                    Contact for waitlist
                  </a>
                ) : (
                  <button
                    onClick={() => handleCheckout(p.id)}
                    disabled={loading}
                    className="w-full rounded-xl py-3 text-sm font-bold text-white active:opacity-90 disabled:opacity-60"
                    style={{ background: p.color }}
                  >
                    {loading ? 'Opening checkout…' : currentPlanId ? 'Switch to this plan' : 'Start free trial'}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <p className="text-center text-[11px] text-gray-400 mt-6 max-w-xs mx-auto">
          Payments are processed by Stripe. Cancel any time. Monthly, no annual lock-in.
        </p>
      </div>
    </div>
  )
}
