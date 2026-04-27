import { useState } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { MiwaLogo } from '../components/Sidebar'
import { API_BASE } from '../lib/api'

const API = API_BASE

export default function Login() {
  const { therapist, login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [unverified, setUnverified] = useState(false)
  const [resendStatus, setResendStatus] = useState('idle') // idle | sending | sent
  const [loading, setLoading] = useState(false)

  if (therapist) return <Navigate to="/dashboard" replace />

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setUnverified(false)
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
          setError(data.error || 'Login failed')
        }
        return
      }
      login(data.token, data.therapist)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResendVerification = async () => {
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

  const inputCls = "w-full rounded-xl px-4 py-3 text-base bg-white border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
  const labelCls = "block text-sm font-semibold text-gray-700 mb-1.5"

  return (
    <div className="public-page min-h-screen flex items-center justify-center p-4"
      style={{ background: '#f4f2ff' }}>

      {/* Subtle background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(96,71,238,0.15), transparent)' }} />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(10,197,162,0.15), transparent)' }} />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Link to="/">
            <MiwaLogo size={56} />
          </Link>
          <h1 className="text-3xl font-extrabold text-gray-900 mt-4 tracking-tight">Welcome back</h1>
          <p className="text-gray-500 text-base mt-2">Sign in to your Miwa account</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-7 bg-white shadow-xl border border-gray-100">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelCls}>Email</label>
              <input
                type="email"
                required
                autoFocus
                className={inputCls}
                placeholder="you@example.com"
                value={form.email}
                onChange={e => set('email', e.target.value)}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={labelCls} style={{ margin: 0 }}>Password</label>
                <Link to="/forgot-password" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors">
                  Forgot password?
                </Link>
              </div>
              <input
                type="password"
                required
                className={inputCls}
                placeholder="••••••••"
                value={form.password}
                onChange={e => set('password', e.target.value)}
              />
            </div>

            {error && !unverified && (
              <div className="rounded-xl px-4 py-3 text-base text-red-700 bg-red-50 border border-red-200 font-medium">
                {error}
              </div>
            )}

            {unverified && (
              <div className="rounded-xl px-4 py-3 text-base text-amber-800 bg-amber-50 border border-amber-200">
                <p className="font-semibold mb-2">Email not verified</p>
                <p className="text-sm leading-relaxed mb-3">{error}</p>
                {resendStatus === 'sent' ? (
                  <p className="text-sm font-medium text-emerald-700">
                    A fresh verification link is on its way to {form.email}.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resendStatus === 'sending'}
                    className="text-sm font-bold text-amber-900 underline hover:no-underline disabled:opacity-60">
                    {resendStatus === 'sending' ? 'Sending…' : 'Resend verification email'}
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl text-base font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 mt-2"
              style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-base text-gray-500 mt-6">
          New to Miwa?{' '}
          <Link to="/register" className="text-indigo-600 hover:text-indigo-700 font-bold transition-colors">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  )
}
