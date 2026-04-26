/**
 * MobileResetPassword — native password-reset completion screen.
 *
 * Consumes the token from the reset email, lets the user pick a new
 * password with show/hide, and kicks them to /login on success.
 */
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL ?? '/api'

export default function MobileResetPassword() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''

  const [form, setForm] = useState({ password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [showPw, setShowPw] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return }
    if (form.password.length < 8)        { setError('Password must be at least 8 characters.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: form.password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Reset failed')
      setSuccess(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Invalid link
  if (!token) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
        style={{ background: 'linear-gradient(180deg, #f4f2ff 0%, #ffffff 60%)' }}
      >
        <div className="w-14 h-14 rounded-2xl mb-5 flex items-center justify-center bg-red-100">
          <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Invalid reset link</h1>
        <p className="text-sm text-gray-500 mb-6 max-w-xs">This link is missing or expired.</p>
        <Link to="/forgot-password" className="rounded-xl px-6 py-3 text-sm font-bold text-white active:opacity-90 shadow-sm"
          style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}>
          Request a new one
        </Link>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: 'linear-gradient(180deg, #f4f2ff 0%, #ffffff 60%)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-32 -left-32 w-[400px] h-[400px] rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(96,71,238,0.15), transparent 70%)' }} />
        <div className="absolute -bottom-32 -right-32 w-[400px] h-[400px] rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(10,197,162,0.15), transparent 70%)' }} />
      </div>

      <div className="flex-shrink-0 pt-12 px-6 text-center">
        <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center text-white text-xl font-bold shadow-md"
          style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}>
          M
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-5">
          {success ? 'Password reset' : 'Set a new password'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {success ? 'Taking you to sign in…' : 'Pick something you can remember.'}
        </p>
      </div>

      {success ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #10b981, #34d399)' }}>
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      ) : (
        <div className="flex-1 px-6 pt-8">
          <form onSubmit={handleSubmit} className="space-y-4 max-w-sm mx-auto">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">New password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={e => set('password', e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full rounded-xl px-4 py-3.5 pr-12 text-base bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
                  required
                  minLength={8}
                />
                <button type="button" onClick={() => setShowPw(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 active:text-gray-700 p-1.5"
                  aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? (
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

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Confirm password</label>
              <input
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                value={form.confirm}
                onChange={e => set('confirm', e.target.value)}
                className="w-full rounded-xl px-4 py-3.5 text-base bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
                required
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl py-4 text-base font-bold text-white active:opacity-90 disabled:opacity-60 shadow-sm"
              style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}
            >
              {loading ? 'Saving…' : 'Reset password'}
            </button>

            <p className="text-center text-sm text-gray-500 pt-2">
              <Link to="/login" className="font-bold text-brand-600 active:text-brand-800">
                ← Back to sign in
              </Link>
            </p>
          </form>
        </div>
      )}
    </div>
  )
}
