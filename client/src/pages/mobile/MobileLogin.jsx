/**
 * MobileLogin — App Store first impression.
 *
 * Full-screen native-feeling sign in. Big inputs, keyboard-optimized
 * autocomplete, soft gradient backdrop, no marketing chrome. When the
 * keyboard opens, the layout stays readable without a scroll trap.
 */
import { useState } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const API = import.meta.env.VITE_API_URL ?? '/api'

export default function MobileLogin() {
  const { therapist, login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [unverified, setUnverified] = useState(false)
  const [resendStatus, setResendStatus] = useState('idle')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  if (therapist) return <Navigate to="/m" replace />

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true); setError(''); setUnverified(false)
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.code === 'EMAIL_UNVERIFIED') {
          setUnverified(true)
          setError(data.error || 'Please verify your email before signing in.')
        } else {
          setError(data.error || 'Sign in failed')
        }
        return
      }
      login(data.token, data.therapist)
      navigate('/m', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (!form.email.trim()) return
    setResendStatus('sending')
    try {
      await fetch(`${API}/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.trim() }),
      })
    } catch {}
    setResendStatus('sent')
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'linear-gradient(180deg, #f4f2ff 0%, #ffffff 60%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Soft background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-32 -left-32 w-[400px] h-[400px] rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(96,71,238,0.15), transparent 70%)' }} />
        <div className="absolute -bottom-32 -right-32 w-[400px] h-[400px] rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(10,197,162,0.15), transparent 70%)' }} />
      </div>

      {/* Logo + greeting */}
      <div className="flex-shrink-0 pt-10 px-6 text-center">
        <div
          className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center text-white text-xl font-bold shadow-md"
          style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
        >
          M
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-5">Welcome back</h1>
        <p className="text-sm text-gray-500 mt-1">Sign in to your clinical workspace</p>
      </div>

      {/* Form */}
      <div className="flex-1 px-6 pt-8">
        <form onSubmit={handleSubmit} className="space-y-4 max-w-sm mx-auto">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl px-4 py-3.5 text-base bg-white border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 transition-all"
              required
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-semibold text-gray-700 mb-1.5">
              Password
              <Link to="/forgot-password" className="text-xs font-medium text-brand-600 active:text-brand-800">
                Forgot?
              </Link>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl px-4 py-3.5 pr-12 text-base bg-white border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 transition-all"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 active:text-gray-700 p-1.5"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className={`rounded-xl border p-3 text-sm ${unverified ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
              {error}
              {unverified && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendStatus === 'sending' || !form.email.trim()}
                    className="text-xs font-bold underline active:text-amber-700 disabled:opacity-50"
                  >
                    {resendStatus === 'sent' ? '✓ Verification email sent' : resendStatus === 'sending' ? 'Sending…' : 'Resend verification email'}
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl py-4 text-base font-bold text-white active:opacity-90 disabled:opacity-60 shadow-sm transition-opacity"
            style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="max-w-sm mx-auto mt-6 text-center">
          <p className="text-sm text-gray-500">
            New to Miwa?{' '}
            <Link to="/register" className="font-bold text-brand-600 active:text-brand-800">
              Create account
            </Link>
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-6 pt-4 pb-8 text-center">
        <p className="text-[11px] text-gray-400">
          HIPAA-conscious · Your clinical data stays yours
        </p>
      </div>
    </div>
  )
}
