import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { MiwaLogo } from '../components/Sidebar'
import { API_BASE } from '../lib/api'

const API = API_BASE

export default function VerifyEmail() {
  const { therapist, login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token')

  const [state, setState] = useState('verifying') // verifying | success | error
  const [error, setError] = useState('')
  const [resendEmail, setResendEmail] = useState('')
  const [resendSent, setResendSent] = useState(false)

  // If they're already signed in, just send them to the dashboard.
  if (therapist) return <Navigate to="/dashboard" replace />

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setState('error')
      setError('No verification token in the link. Make sure you copied the entire URL from your email.')
      return
    }

    ;(async () => {
      try {
        const res = await fetch(`${API}/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setState('error')
          setError(data.error || 'Verification failed.')
          return
        }
        login(data.token, data.therapist)
        setState('success')
        setTimeout(() => navigate('/dashboard', { replace: true }), 1200)
      } catch (err) {
        if (cancelled) return
        setState('error')
        setError(err.message || 'Network error. Please try again.')
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const handleResend = async (e) => {
    e.preventDefault()
    if (!resendEmail.trim()) return
    try {
      await fetch(`${API}/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resendEmail.trim() }),
      })
    } catch {}
    setResendSent(true)
  }

  return (
    <div className="public-page min-h-screen flex items-center justify-center p-4" style={{ background: '#f4f2ff' }}>
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center mb-6">
          <Link to="/"><MiwaLogo size={56} /></Link>
        </div>
        <div className="rounded-2xl p-8 bg-white shadow-xl border border-gray-100">

          {state === 'verifying' && (
            <>
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-indigo-50 border-2 border-indigo-200">
                <svg className="w-8 h-8 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Verifying…</h2>
              <p className="text-gray-600 text-base">Confirming your email address.</p>
            </>
          )}

          {state === 'success' && (
            <>
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-emerald-50 border-2 border-emerald-200">
                <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Email verified</h2>
              <p className="text-gray-600 text-base">Welcome to Miwa. Taking you to your dashboard…</p>
            </>
          )}

          {state === 'error' && (
            <>
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-rose-50 border-2 border-rose-200">
                <svg className="w-8 h-8 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Verification failed</h2>
              <p className="text-gray-600 text-base mb-6 leading-relaxed">{error}</p>

              {!resendSent ? (
                <form onSubmit={handleResend} className="space-y-3 text-left">
                  <label className="block text-sm font-semibold text-gray-700">
                    Send a fresh verification link
                  </label>
                  <input
                    type="email"
                    required
                    value={resendEmail}
                    onChange={e => setResendEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-xl px-4 py-3 text-base bg-white border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400"
                  />
                  <button
                    type="submit"
                    className="w-full py-3 rounded-xl text-base font-bold text-white transition-all hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}>
                    Send Link
                  </button>
                </form>
              ) : (
                <p className="text-emerald-600 text-base font-medium">
                  If a Miwa account exists for that email and still needs verification, a fresh link is on its way.
                </p>
              )}

              <Link to="/login" className="block mt-6 text-indigo-600 font-semibold hover:underline">
                Back to Sign In
              </Link>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
