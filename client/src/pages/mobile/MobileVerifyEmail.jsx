/**
 * MobileVerifyEmail — native email verification landing.
 *
 * Hit by the link in the verification email. Posts the token, logs the
 * user in on success, shows a clean error + resend flow on failure.
 */
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { API_BASE } from '../../lib/api'

const API = API_BASE

export default function MobileVerifyEmail() {
  const { therapist, login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token')

  const [state, setState] = useState('verifying') // verifying | success | error
  const [error, setError] = useState('')
  const [resendEmail, setResendEmail] = useState('')
  const [resendSent, setResendSent] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)

  if (therapist) return <Navigate to="/m" replace />

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
        setTimeout(() => navigate('/m', { replace: true }), 1200)
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
    setResendLoading(true)
    try {
      await fetch(`${API}/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resendEmail.trim() }),
      })
      setResendSent(true)
    } catch {}
    setResendLoading(false)
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
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

      <div className="w-14 h-14 rounded-2xl mb-6 flex items-center justify-center text-white text-xl font-bold shadow-md"
        style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}>
        M
      </div>

      {state === 'verifying' && (
        <>
          <div className="w-8 h-8 border-2 border-brand-300 border-t-transparent rounded-full animate-spin mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Verifying your email…</h1>
          <p className="text-sm text-gray-500">Just a moment.</p>
        </>
      )}

      {state === 'success' && (
        <>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg, #10b981, #34d399)' }}>
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">You're verified</h1>
          <p className="text-sm text-gray-500">Taking you to Miwa…</p>
        </>
      )}

      {state === 'error' && (
        <>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-red-100">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Verification link didn't work</h1>
          <p className="text-sm text-gray-600 max-w-xs mb-6">{error}</p>

          {resendSent ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 max-w-sm">
              ✓ New verification email sent. Check your inbox.
            </div>
          ) : (
            <form onSubmit={handleResend} className="w-full max-w-sm space-y-3">
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                value={resendEmail}
                onChange={e => setResendEmail(e.target.value)}
                placeholder="Enter your email to resend"
                className="w-full rounded-xl px-4 py-3.5 text-base bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
                required
              />
              <button
                type="submit"
                disabled={resendLoading || !resendEmail.trim()}
                className="w-full rounded-xl py-4 text-base font-bold text-white active:opacity-90 disabled:opacity-60 shadow-sm"
                style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}
              >
                {resendLoading ? 'Sending…' : 'Resend verification email'}
              </button>
            </form>
          )}

          <Link to="/login" className="mt-6 text-sm font-semibold text-brand-600 active:text-brand-800 py-3 px-4">
            ← Back to sign in
          </Link>
        </>
      )}
    </div>
  )
}
