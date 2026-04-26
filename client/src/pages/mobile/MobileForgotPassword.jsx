/**
 * MobileForgotPassword — native password-reset request screen.
 *
 * Mirrors MobileLogin's visual shell: soft gradient backdrop, safe-area
 * padding, compact back header, big tappable input + submit.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL ?? '/api'

export default function MobileForgotPassword() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
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

      {/* Back header */}
      <div className="flex-shrink-0 px-4 pt-4">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white/80 flex items-center justify-center active:bg-white shadow-sm"
          aria-label="Back"
        >
          <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      <div className="flex-shrink-0 pt-6 px-6 text-center">
        <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center text-white text-xl font-bold shadow-md"
          style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}>
          M
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-5">
          {submitted ? 'Check your email' : 'Forgot password?'}
        </h1>
        <p className="text-sm text-gray-500 mt-1 max-w-xs mx-auto">
          {submitted
            ? <>If an account exists for <span className="font-semibold text-gray-900">{email}</span>, a reset link is on its way.</>
            : "Enter your email and we'll send you a reset link"}
        </p>
      </div>

      <div className="flex-1 px-6 pt-8">
        {submitted ? (
          <div className="max-w-sm mx-auto text-center">
            <p className="text-sm text-gray-400 mt-4 mb-8">Didn't get it? Check your spam folder, or request another.</p>
            <button
              onClick={() => { setSubmitted(false); setEmail('') }}
              className="text-brand-600 active:text-brand-800 font-semibold text-sm py-3 px-4"
            >
              Try a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 max-w-sm mx-auto">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email address</label>
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
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
              {loading ? 'Sending…' : 'Send reset link'}
            </button>

            <p className="text-center text-sm text-gray-500 pt-2">
              <Link to="/login" className="font-bold text-brand-600 active:text-brand-800">
                ← Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
