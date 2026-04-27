import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'
import { API_BASE } from '../lib/api'

const API = API_BASE

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = "w-full rounded-xl px-4 py-3 text-base bg-white border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"

  return (
    <div className="public-page min-h-screen flex items-center justify-center p-4"
      style={{ background: '#f4f2ff' }}>

      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(96,71,238,0.15), transparent)' }} />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(10,197,162,0.15), transparent)' }} />
      </div>

      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <Link to="/">
            <MiwaLogo size={56} />
          </Link>
          <h1 className="text-3xl font-extrabold text-gray-900 mt-4 tracking-tight">Forgot password?</h1>
          <p className="text-gray-500 text-base mt-2 text-center">
            Enter your email and we'll send you a reset link
          </p>
        </div>

        <div className="rounded-2xl p-7 bg-white shadow-xl border border-gray-100">
          {submitted ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: 'linear-gradient(135deg, #5746ed22, #0ac5a222)' }}>
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="url(#grad1)">
                  <defs>
                    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#5746ed" />
                      <stop offset="100%" stopColor="#0ac5a2" />
                    </linearGradient>
                  </defs>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">Check your email</h2>
              <p className="text-gray-500 text-sm">
                If an account exists for <strong>{email}</strong>, you'll receive a password reset link shortly.
              </p>
              <p className="text-gray-400 text-xs mt-3">
                Didn't get it? Check your spam folder.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  required
                  autoFocus
                  className={inputCls}
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>

              {error && (
                <div className="rounded-xl px-4 py-3 text-base text-red-700 bg-red-50 border border-red-200 font-medium">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl text-base font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 mt-2"
                style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
              >
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-base text-gray-500 mt-6">
          <Link to="/login" className="text-indigo-600 hover:text-indigo-700 font-bold transition-colors">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
