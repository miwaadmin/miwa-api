/**
 * MobileRegister — native-feeling account creation, 2-step wizard.
 *
 * Step 1: pick credential type (trainee / associate / licensed) via big
 *   tappable cards. Simpler than desktop's side-by-side layout.
 * Step 2: the form fields that actually apply to the chosen credential.
 *
 * Minimal marketing chrome — the App Store reviewer needs a clean happy
 * path. Post-submit, user lands on the "check your email" screen, same
 * as desktop.
 */
import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const API = import.meta.env.VITE_API_URL ?? '/api'

const CREDENTIAL_TYPES = [
  {
    id: 'trainee',
    label: 'Trainee / Intern',
    subtitle: 'MFT Trainee, ACSW Trainee, LPCC Intern',
    note: 'Requires supervisor verification',
    gradient: 'linear-gradient(135deg, #6366f1, #818cf8)',
  },
  {
    id: 'associate',
    label: 'Associate',
    subtitle: 'AMFT, ACSW, APCC — licensed associate',
    note: 'License number required',
    gradient: 'linear-gradient(135deg, #0d9488, #2dd4bf)',
  },
  {
    id: 'licensed',
    label: 'Licensed Therapist',
    subtitle: 'LMFT, LCSW, LPCC — fully licensed',
    note: 'Full access, no verification needed',
    gradient: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
  },
]

export default function MobileRegister() {
  const { therapist } = useAuth()
  const [step, setStep] = useState(1)
  const [credType, setCredType] = useState('licensed')
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', password: '', confirm_password: '',
    referral_code: '', credential_number: '', school_email: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [resendStatus, setResendStatus] = useState('idle')

  if (therapist) return <Navigate to="/m" replace />

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.first_name.trim()) { setError('First name is required.'); return }
    if (!form.last_name.trim())  { setError('Last name is required.');  return }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (form.password !== form.confirm_password) { setError('Passwords do not match.'); return }
    if ((credType === 'associate' || credType === 'licensed') && !form.credential_number.trim()) {
      setError('License number is required for this credential.'); return
    }
    if (credType === 'trainee' && !form.school_email.trim()) {
      setError('School or program email is required for trainees.'); return
    }

    setLoading(true); setError('')
    try {
      const res = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          email: form.email,
          password: form.password,
          referral_code: form.referral_code || undefined,
          credential_type: credType,
          credential_number: form.credential_number || undefined,
          school_email: form.school_email || undefined,
          preferred_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Registration failed')
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResendStatus('sending')
    try {
      await fetch(`${API}/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email }),
      })
    } catch {}
    setResendStatus('sent')
  }

  // ── Post-submit: check your email ────────────────────────────────────────
  if (done) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-6"
        style={{ background: 'linear-gradient(180deg, #f4f2ff 0%, #ffffff 60%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
          style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}>
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 text-center">Check your email</h1>
        <p className="text-sm text-gray-600 text-center mt-2 max-w-xs">
          We sent a verification link to <span className="font-semibold text-gray-900">{form.email}</span>. Tap it to activate your Miwa account.
        </p>
        <p className="text-xs text-gray-400 text-center mt-2 max-w-xs">
          Can't find it? Check spam, or resend below.
        </p>

        <button
          onClick={handleResend}
          disabled={resendStatus === 'sending'}
          className="mt-6 text-sm font-semibold text-brand-600 active:text-brand-800 disabled:opacity-50 py-3 px-4"
        >
          {resendStatus === 'sent' ? '✓ Verification resent' : resendStatus === 'sending' ? 'Sending…' : 'Resend verification email'}
        </button>

        <Link
          to="/login"
          className="mt-2 text-sm text-gray-500 active:text-gray-900 py-3 px-4"
        >
          ← Back to sign in
        </Link>
      </div>
    )
  }

  // ── Main wizard ──────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'linear-gradient(180deg, #f4f2ff 0%, #ffffff 60%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Soft backdrop */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-32 -left-32 w-[400px] h-[400px] rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(96,71,238,0.15), transparent 70%)' }} />
        <div className="absolute -bottom-32 -right-32 w-[400px] h-[400px] rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(10,197,162,0.15), transparent 70%)' }} />
      </div>

      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 flex items-center justify-between">
        <button
          onClick={() => step === 2 ? setStep(1) : window.history.back()}
          className="w-10 h-10 rounded-full bg-white/80 flex items-center justify-center active:bg-white shadow-sm"
          aria-label="Back"
        >
          <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex gap-1.5">
          <div className={`w-6 h-1 rounded-full ${step >= 1 ? 'bg-brand-600' : 'bg-gray-200'}`} />
          <div className={`w-6 h-1 rounded-full ${step >= 2 ? 'bg-brand-600' : 'bg-gray-200'}`} />
        </div>
        <div className="w-10" />
      </div>

      {/* Logo + title */}
      <div className="flex-shrink-0 pt-4 px-6 text-center">
        <div
          className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center text-white text-lg font-bold shadow-md"
          style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
        >
          M
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-4">
          {step === 1 ? 'Create account' : 'Your details'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {step === 1 ? 'Which best describes you?' : 'One more step.'}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pt-6 pb-6">
        {step === 1 ? (
          <div className="space-y-3 max-w-sm mx-auto">
            {CREDENTIAL_TYPES.map(c => {
              const selected = credType === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => setCredType(c.id)}
                  className={`w-full text-left rounded-2xl p-4 active:scale-[0.99] transition-all ${
                    selected ? 'ring-2 ring-brand-500 shadow-sm' : 'ring-1 ring-gray-200'
                  }`}
                  style={{ background: 'white', minHeight: 80 }}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: c.gradient }}>
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900">{c.label}</p>
                      <p className="text-[12px] text-gray-600 leading-snug">{c.subtitle}</p>
                      <p className="text-[11px] text-gray-400 mt-1">{c.note}</p>
                    </div>
                    {selected && (
                      <svg className="w-5 h-5 text-brand-600 flex-shrink-0 mt-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                </button>
              )
            })}

            <button
              onClick={() => setStep(2)}
              className="w-full rounded-xl py-4 text-base font-bold text-white active:opacity-90 shadow-sm mt-4"
              style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}
            >
              Continue
            </button>

            <p className="text-center text-sm text-gray-500 pt-2">
              Have an account?{' '}
              <Link to="/login" className="font-bold text-brand-600 active:text-brand-800">
                Sign in
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 max-w-sm mx-auto">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">First name</label>
                <input
                  type="text" autoComplete="given-name" value={form.first_name}
                  onChange={e => set('first_name', e.target.value)}
                  className="w-full rounded-xl px-4 py-3 text-base bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Last name</label>
                <input
                  type="text" autoComplete="family-name" value={form.last_name}
                  onChange={e => set('last_name', e.target.value)}
                  className="w-full rounded-xl px-4 py-3 text-base bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
              <input
                type="email" autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off"
                value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl px-4 py-3.5 text-base bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
                required
              />
            </div>

            {credType === 'trainee' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  School or program email <span className="font-normal text-gray-400">(for verification)</span>
                </label>
                <input
                  type="email" inputMode="email" autoCapitalize="none" autoCorrect="off"
                  value={form.school_email} onChange={e => set('school_email', e.target.value)}
                  placeholder="you@university.edu"
                  className="w-full rounded-xl px-4 py-3.5 text-base bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
                  required
                />
              </div>
            )}

            {(credType === 'associate' || credType === 'licensed') && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">License number</label>
                <input
                  type="text" value={form.credential_number}
                  onChange={e => set('credential_number', e.target.value)}
                  placeholder="e.g. LMFT 12345"
                  className="w-full rounded-xl px-4 py-3.5 text-base bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
              <input
                type="password" autoComplete="new-password" value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder="At least 8 characters"
                className="w-full rounded-xl px-4 py-3.5 text-base bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
                required minLength={8}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Confirm password</label>
              <input
                type="password" autoComplete="new-password" value={form.confirm_password}
                onChange={e => set('confirm_password', e.target.value)}
                className="w-full rounded-xl px-4 py-3.5 text-base bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
                required
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl py-4 text-base font-bold text-white active:opacity-90 disabled:opacity-60 shadow-sm"
              style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>

            <p className="text-[11px] text-gray-400 text-center leading-relaxed">
              By creating an account you agree to our{' '}
              <Link to="/privacy" className="underline">Privacy Policy</Link>.
              Miwa is HIPAA-conscious and does not use clinical data to train AI models.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
