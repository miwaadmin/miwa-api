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

function formatMoney(cents) {
  const amount = Number(cents || 0) / 100
  return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

export default function Billing() {
  const { therapist } = useAuth()

  const [billing, setBilling]               = useState(null)
  const [billingLoading, setBillingLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState('')
  const [portalLoading, setPortalLoading]   = useState(false)
  const [error, setError]                   = useState('')
  const [clientBilling, setClientBilling]   = useState(null)
  const [clientBillingLoading, setClientBillingLoading] = useState(true)
  const [patients, setPatients]             = useState([])
  const [clientInvoices, setClientInvoices] = useState([])
  const [clientAction, setClientAction]     = useState('')
  const [clientBillingMessage, setClientBillingMessage] = useState('')
  const [clientInvoiceForm, setClientInvoiceForm] = useState({
    patient_id: '',
    amount_dollars: '',
    service_date: new Date().toISOString().slice(0, 10),
    generic_description: 'Professional services',
    internal_note: '',
  })
  const [clientSettingsForm, setClientSettingsForm] = useState({
    default_rate_dollars: '',
    no_show_fee_dollars: '',
    cancellation_notice_hours: 24,
    card_on_file_enabled: true,
    autopay_enabled: false,
  })

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

  const loadClientBilling = async () => {
    setClientBillingLoading(true)
    try {
      const [statusRes, patientRes, invoiceRes] = await Promise.all([
        apiFetch('/billing/client-payments/status'),
        apiFetch('/patients'),
        apiFetch('/billing/client-payments/invoices'),
      ])
      const statusData = await statusRes.json()
      const patientData = await patientRes.json()
      const invoiceData = await invoiceRes.json()
      if (statusRes.ok) {
        setClientBilling(statusData)
        setClientSettingsForm({
          default_rate_dollars: statusData.settings?.default_rate_dollars || '',
          no_show_fee_dollars: statusData.settings?.no_show_fee_dollars || '',
          cancellation_notice_hours: statusData.settings?.policy?.cancellation_notice_hours || 24,
          card_on_file_enabled: statusData.settings?.card_on_file_enabled !== false,
          autopay_enabled: !!statusData.settings?.autopay_enabled,
        })
      }
      if (patientRes.ok) setPatients(Array.isArray(patientData) ? patientData : [])
      if (invoiceRes.ok) setClientInvoices(Array.isArray(invoiceData) ? invoiceData : [])
    } catch {
      // Keep subscription billing usable if client-payment status is unavailable.
    } finally {
      setClientBillingLoading(false)
    }
  }

  useEffect(() => { loadClientBilling() }, [])

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

  const handleConnectStripe = async () => {
    setClientAction('connect')
    setClientBillingMessage('')
    try {
      const res = await apiFetch('/billing/client-payments/connect/start', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not start Stripe Connect')
      window.location.href = data.url
    } catch (err) {
      setClientBillingMessage(err.message)
      setClientAction('')
    }
  }

  const handleRefreshConnect = async () => {
    setClientAction('refresh-connect')
    setClientBillingMessage('')
    try {
      const res = await apiFetch('/billing/client-payments/connect/refresh', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not refresh Stripe status')
      setClientBillingMessage('Stripe payment status refreshed.')
      await loadClientBilling()
    } catch (err) {
      setClientBillingMessage(err.message)
    } finally {
      setClientAction('')
    }
  }

  const handleSaveClientBillingSettings = async () => {
    setClientAction('save-settings')
    setClientBillingMessage('')
    try {
      const res = await apiFetch('/billing/client-payments/settings', {
        method: 'POST',
        body: JSON.stringify(clientSettingsForm),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save client billing settings')
      setClientBillingMessage('Client billing settings saved.')
      await loadClientBilling()
    } catch (err) {
      setClientBillingMessage(err.message)
    } finally {
      setClientAction('')
    }
  }

  const handleCreateClientInvoice = async () => {
    setClientAction('create-invoice')
    setClientBillingMessage('')
    try {
      const res = await apiFetch('/billing/client-payments/invoices', {
        method: 'POST',
        body: JSON.stringify({
          ...clientInvoiceForm,
          patient_id: clientInvoiceForm.patient_id || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create invoice')
      setClientBillingMessage(`Payment request ${data.invoice_number} created.`)
      setClientInvoiceForm(prev => ({ ...prev, amount_dollars: '', internal_note: '' }))
      await loadClientBilling()
    } catch (err) {
      setClientBillingMessage(err.message)
    } finally {
      setClientAction('')
    }
  }

  const handleSendPaymentLink = async (invoiceId) => {
    setClientAction(`pay-${invoiceId}`)
    setClientBillingMessage('')
    try {
      const res = await apiFetch(`/billing/client-payments/invoices/${invoiceId}/checkout`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create payment link')
      window.location.href = data.url
    } catch (err) {
      setClientBillingMessage(err.message)
      setClientAction('')
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

          <div className="card p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a5 5 0 00-10 0v2M5 9h14l-1 11H6L5 9z" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-900">Client Payments</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Collect client payments through each clinician's own Stripe account. Keep clinical details in Miwa; Stripe receives generic invoice language only.
                </p>
              </div>
              <button onClick={loadClientBilling} className="btn-secondary text-xs">Refresh</button>
            </div>

            {clientBillingMessage && (
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                {clientBillingMessage}
              </div>
            )}

            {clientBillingLoading ? (
              <div className="text-sm text-gray-400">Loading client payment setup...</div>
            ) : (
              <>
                {!clientBilling?.eligibility?.eligible ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    {clientBilling?.eligibility?.reason || 'This account is not eligible for direct client billing.'}
                  </div>
                ) : (
                  <div className="grid md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-gray-200 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-400">Stripe Connect</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900 capitalize">
                        {(clientBilling?.connect?.status || 'not_connected').replaceAll('_', ' ')}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        Charges {clientBilling?.connect?.charges_enabled ? 'enabled' : 'not ready'} · payouts {clientBilling?.connect?.payouts_enabled ? 'enabled' : 'pending'}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button onClick={handleConnectStripe} disabled={!!clientAction} className="btn-primary text-xs">
                          {clientAction === 'connect' ? 'Opening...' : clientBilling?.connect?.account_id ? 'Resume' : 'Connect'}
                        </button>
                        {clientBilling?.connect?.account_id && (
                          <button onClick={handleRefreshConnect} disabled={!!clientAction} className="btn-secondary text-xs">
                            Check
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 p-4 md:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-gray-400">Policy defaults</p>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <label className="text-xs text-gray-500">
                          Session rate
                          <input
                            className="input mt-1 text-sm"
                            type="number"
                            min="0"
                            step="0.01"
                            value={clientSettingsForm.default_rate_dollars}
                            onChange={e => setClientSettingsForm(prev => ({ ...prev, default_rate_dollars: e.target.value }))}
                            placeholder="150"
                          />
                        </label>
                        <label className="text-xs text-gray-500">
                          No-show fee
                          <input
                            className="input mt-1 text-sm"
                            type="number"
                            min="0"
                            step="0.01"
                            value={clientSettingsForm.no_show_fee_dollars}
                            onChange={e => setClientSettingsForm(prev => ({ ...prev, no_show_fee_dollars: e.target.value }))}
                            placeholder="75"
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-600">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={clientSettingsForm.card_on_file_enabled}
                            onChange={e => setClientSettingsForm(prev => ({ ...prev, card_on_file_enabled: e.target.checked }))}
                          />
                          Allow card on file
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={clientSettingsForm.autopay_enabled}
                            onChange={e => setClientSettingsForm(prev => ({ ...prev, autopay_enabled: e.target.checked }))}
                          />
                          Enable opt-in autopay
                        </label>
                      </div>
                      <button onClick={handleSaveClientBillingSettings} disabled={!!clientAction} className="btn-secondary text-xs mt-3">
                        {clientAction === 'save-settings' ? 'Saving...' : 'Save defaults'}
                      </button>
                    </div>
                  </div>
                )}

                {clientBilling?.eligibility?.eligible && (
                  <div className="rounded-xl border border-gray-200 p-4 space-y-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-400">Create payment request</p>
                      <p className="text-xs text-gray-500 mt-1">Payment requests are invoice records. Link them to a client/session when appropriate.</p>
                    </div>
                    <div className="grid md:grid-cols-4 gap-3">
                      <select
                        className="input text-sm md:col-span-2"
                        value={clientInvoiceForm.patient_id}
                        onChange={e => setClientInvoiceForm(prev => ({ ...prev, patient_id: e.target.value }))}
                      >
                        <option value="">No linked client</option>
                        {patients.map(patient => (
                          <option key={patient.id} value={patient.id}>
                            {patient.display_name || [patient.first_name, patient.last_name].filter(Boolean).join(' ') || patient.client_id}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input text-sm"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Amount"
                        value={clientInvoiceForm.amount_dollars}
                        onChange={e => setClientInvoiceForm(prev => ({ ...prev, amount_dollars: e.target.value }))}
                      />
                      <input
                        className="input text-sm"
                        type="date"
                        value={clientInvoiceForm.service_date}
                        onChange={e => setClientInvoiceForm(prev => ({ ...prev, service_date: e.target.value }))}
                      />
                    </div>
                    <div className="grid md:grid-cols-3 gap-3">
                      <input
                        className="input text-sm"
                        value={clientInvoiceForm.generic_description}
                        onChange={e => setClientInvoiceForm(prev => ({ ...prev, generic_description: e.target.value }))}
                        placeholder="Professional services"
                      />
                      <input
                        className="input text-sm md:col-span-2"
                        value={clientInvoiceForm.internal_note}
                        onChange={e => setClientInvoiceForm(prev => ({ ...prev, internal_note: e.target.value }))}
                        placeholder="Internal note, not sent to Stripe"
                      />
                    </div>
                    <button onClick={handleCreateClientInvoice} disabled={!!clientAction} className="btn-primary text-sm">
                      {clientAction === 'create-invoice' ? 'Creating...' : 'Create payment request'}
                    </button>
                  </div>
                )}

                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-gray-400">Recent client invoices</p>
                    <span className="text-xs text-gray-400">{clientInvoices.length} shown</span>
                  </div>
                  {clientInvoices.length === 0 ? (
                    <p className="p-4 text-sm text-gray-500">No client payment requests yet.</p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {clientInvoices.slice(0, 8).map(invoice => (
                        <div key={invoice.id} className="p-4 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{invoice.invoice_number}</p>
                            <p className="text-xs text-gray-500 truncate">
                              {invoice.display_name || invoice.client_id || 'Unlinked client'} · {invoice.generic_description}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="text-right">
                              <p className="text-sm font-semibold text-gray-900">{formatMoney(invoice.amount_cents)}</p>
                              <p className="text-xs text-gray-500 capitalize">{invoice.status}</p>
                            </div>
                            {['open', 'failed'].includes(invoice.status) && (
                              <button
                                onClick={() => handleSendPaymentLink(invoice.id)}
                                disabled={!!clientAction}
                                className="btn-secondary text-xs"
                              >
                                {clientAction === `pay-${invoice.id}` ? 'Opening...' : 'Pay link'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
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
