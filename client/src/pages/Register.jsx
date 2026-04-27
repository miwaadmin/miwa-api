import { useState } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { MiwaLogo } from '../components/Sidebar'
import { API_BASE } from '../lib/api'

const API = API_BASE

const CREDENTIAL_TYPES = [
  {
    id: 'trainee',
    label: 'Trainee / Intern',
    subtitle: 'MFT Trainee, ACSW Trainee, LPCC Intern',
    note: 'Requires supervisor verification',
    noteColor: '#818cf8',
    gradient: 'linear-gradient(135deg, #6366f1, #818cf8)',
  },
  {
    id: 'associate',
    label: 'Associate',
    subtitle: 'AMFT, ACSW, APCC — licensed associate',
    note: 'License number required',
    noteColor: '#2dd4bf',
    gradient: 'linear-gradient(135deg, #0d9488, #2dd4bf)',
  },
  {
    id: 'licensed',
    label: 'Licensed Therapist',
    subtitle: 'LMFT, LCSW, LPCC — fully licensed',
    note: 'Full access, no verification needed',
    noteColor: '#a78bfa',
    gradient: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
  },
]

export default function Register() {
  const { therapist, login } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(1)
  const [credType, setCredType] = useState('licensed')
  const [form, setForm] = useState({
    first_name: '', last_name: '',
    email: '', password: '', confirm_password: '',
    referral_code: '',
    credential_number: '',
    school_email: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  if (therapist) return <Navigate to="/dashboard" replace />

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.first_name.trim()) { setError('First name is required.'); return }
    if (!form.last_name.trim()) { setError('Last name is required.'); return }
    if (form.password !== form.confirm_password) { setError('Passwords do not match.'); return }
    if ((credType === 'associate' || credType === 'licensed') && !form.credential_number.trim()) {
      setError('License number is required for associate and licensed accounts.')
      return
    }
    if (credType === 'trainee' && !form.school_email.trim()) {
      setError('School or program email is required for trainee accounts.')
      return
    }

    setLoading(true)
    setError('')
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

      // No auto-login. The user must click the verification link in their
      // inbox before signing in. Show the "check your email" screen for any
      // registration outcome (success or duplicate-email — they look the same
      // from the form's perspective, by design).
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const resendVerification = async () => {
    try {
      await fetch(`${API}/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email }),
      })
    } catch {}
  }

  const inputCls = "w-full rounded-xl px-4 py-3 text-base bg-white border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
  const labelCls = "block text-sm font-semibold text-gray-700 mb-1.5"

  // ── "Check your email" screen — shown after every registration submit ─────
  if (done) {
    return (
      <div className="public-page min-h-screen flex items-center justify-center p-4"
        style={{ background: '#f4f2ff' }}>
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-6">
            <Link to="/"><MiwaLogo size={56} /></Link>
          </div>
          <div className="rounded-2xl p-8 bg-white shadow-xl border border-gray-100">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-indigo-50 border-2 border-indigo-200">
              <svg className="w-8 h-8 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Check your email</h2>
            <p className="text-gray-600 text-base mb-4 leading-relaxed">
              We sent a verification link to your inbox. Click it to activate your account and sign in.
            </p>
            <p className="text-gray-400 text-sm mb-6">
              Sent to: <span className="text-indigo-600 font-medium">{form.email}</span>
            </p>
            <p className="text-gray-500 text-sm mb-6 leading-relaxed">
              Didn't get it? Check your spam folder, or
              {' '}<button
                type="button"
                onClick={resendVerification}
                className="text-indigo-600 font-semibold hover:underline">
                resend the link
              </button>.
            </p>
            <Link to="/login"
              className="block w-full py-3 rounded-xl text-base font-bold text-white text-center transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}>
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="public-page min-h-screen flex items-center justify-center p-4 py-10"
      style={{ background: '#f4f2ff' }}>

      {/* Subtle background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(96,71,238,0.15), transparent)' }} />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(10,197,162,0.15), transparent)' }} />
      </div>

      <div className="relative w-full max-w-lg">
        <div className="flex flex-col items-center mb-8">
          <Link to="/">
            <MiwaLogo size={56} />
          </Link>
          <h1 className="text-3xl font-extrabold text-gray-900 mt-4 tracking-tight">Create your account</h1>
          <p className="text-gray-500 text-base mt-2 text-center">Set up access in under a minute.</p>
        </div>

        {/* ── Step 1: Credential type selector ─────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Free trial reassurance */}
            <div className="rounded-2xl px-5 py-4 text-center border border-emerald-200 bg-emerald-50/60">
              <p className="text-base font-bold text-emerald-800">Start free — no credit card required</p>
              <p className="text-sm text-emerald-600 mt-0.5">Full access during your trial. Choose your role to get started.</p>
            </div>

            <p className="text-center text-gray-500 text-sm uppercase tracking-widest font-bold mb-1">
              What best describes you?
            </p>

            {CREDENTIAL_TYPES.map(ct => (
              <button
                key={ct.id}
                type="button"
                onClick={() => { setCredType(ct.id); setStep(2) }}
                className="w-full rounded-2xl p-5 text-left transition-all hover:scale-[1.01] active:scale-[0.99] bg-white border border-gray-200 hover:border-gray-300 hover:shadow-lg shadow-md"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <span className="text-lg font-bold text-gray-900">{ct.label}</span>
                    <p className="text-gray-500 text-sm mt-0.5">{ct.subtitle}</p>
                    <p className="text-sm mt-1 font-semibold" style={{ color: ct.noteColor }}>{ct.note}</p>
                  </div>
                  <svg className="w-6 h-6 flex-shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}

            <p className="text-center text-base text-gray-500 mt-6">
              Already have an account?{' '}
              <Link to="/login" className="text-indigo-600 hover:text-indigo-700 font-bold transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        )}

        {/* ── Step 2: Registration form ─────────────────────────────────────── */}
        {step === 2 && (
          <>
            {/* Back + selected type badge */}
            <div className="flex items-center gap-3 mb-5">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors border border-gray-200">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              {(() => {
                const ct = CREDENTIAL_TYPES.find(c => c.id === credType)
                return (
                  <span className="text-sm font-bold px-4 py-1.5 rounded-full text-white"
                    style={{ background: ct.gradient }}>
                    {ct.label} · Free trial
                  </span>
                )
              })()}
            </div>

            <div className="rounded-2xl p-7 bg-white shadow-xl border border-gray-100">
              <form onSubmit={handleSubmit} className="space-y-4">

                {/* Name */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>First Name <span className="text-red-500">*</span></label>
                    <input type="text" required className={inputCls}
                      placeholder="Jane" value={form.first_name}
                      onChange={e => set('first_name', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Last Name <span className="text-red-500">*</span></label>
                    <input type="text" required className={inputCls}
                      placeholder="Smith" value={form.last_name}
                      onChange={e => set('last_name', e.target.value)} />
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className={labelCls}>Email</label>
                  <input type="email" required className={inputCls}
                    placeholder="you@practice.com" value={form.email}
                    onChange={e => set('email', e.target.value)} />
                </div>

                {/* Password */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Password</label>
                    <input type="password" required minLength={8} className={inputCls}
                      placeholder="Min 8 chars" value={form.password}
                      onChange={e => set('password', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Confirm</label>
                    <input type="password" required className={inputCls}
                      placeholder="••••••••" value={form.confirm_password}
                      onChange={e => set('confirm_password', e.target.value)} />
                  </div>
                </div>

                {/* ── Credential-type-specific fields ──────────────────────── */}

                {(credType === 'associate' || credType === 'licensed') && (
                  <div>
                    <label className={labelCls}>
                      {credType === 'associate' ? 'Associate Number' : 'License Number'} <span className="text-red-500">*</span>
                    </label>
                    <input type="text" required className={inputCls}
                      placeholder={credType === 'associate' ? 'AMFT123456 / ACSW123456 / APCC123456' : 'LMFT12345 / LCSW12345 / LPCC12345'}
                      value={form.credential_number}
                      onChange={e => set('credential_number', e.target.value)} />
                  </div>
                )}

                {credType === 'trainee' && (
                  <div className="rounded-xl p-4 space-y-3 bg-indigo-50 border border-indigo-100">
                    <p className="text-sm font-bold text-indigo-700 uppercase tracking-wider">Program Verification</p>
                    <p className="text-sm text-indigo-600/70 leading-relaxed">
                      Enter your school or program email (e.g. @usc.edu). We'll send a one-click confirmation link. Your account is active immediately.
                    </p>
                    <div>
                      <label className={labelCls}>School Email <span className="text-red-500">*</span></label>
                      <input type="email" required className={inputCls}
                        placeholder="yourname@university.edu" value={form.school_email}
                        onChange={e => set('school_email', e.target.value)} />
                    </div>
                  </div>
                )}

                {/* Referral code */}
                <div>
                  <label className={labelCls}>
                    Referral Code <span className="text-gray-400 normal-case font-normal">(optional)</span>
                  </label>
                  <input type="text" className={`${inputCls} font-mono tracking-widest`}
                    placeholder="e.g. MIWA-AB12-CD34" value={form.referral_code}
                    onChange={e => set('referral_code', e.target.value.toUpperCase())}
                    maxLength={14} />
                </div>

                {error && (
                  <div className="rounded-xl px-4 py-3 text-base text-red-700 bg-red-50 border border-red-200 font-medium">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 rounded-xl text-base font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}>
                  {loading ? 'Creating account…' : 'Create Account'}
                </button>
              </form>
            </div>

            <p className="text-center text-base text-gray-500 mt-6">
              Already have an account?{' '}
              <Link to="/login" className="text-indigo-600 hover:text-indigo-700 font-bold transition-colors">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
