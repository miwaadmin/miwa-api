import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MiwaLogo } from '../components/Sidebar'

const API = import.meta.env.VITE_API_URL ?? '/api'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const navigate = useNavigate()

  const [form, setForm] = useState({ password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (form.password !== form.confirm) {
      return setError('Passwords do not match.')
    }
    if (form.password.length < 8) {
      return setError('Password must be at least 8 characters.')
    }
    setLoading(true)
    setError('')
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

  const inputCls = "w-full rounded-xl px-4 py-3 text-base bg-white border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"

  if (!token) {
    return (
      <div className="public-page min-h-screen flex items-center justify-center p-4"
        style={{ background: '#f4f2ff' }}>
        <div className="text-center">
          <p className="text-gray-600 mb-4">Invalid reset link.</p>
          <Link to="/forgot-password" className="text-indigo-600 font-bold hover:underline">
            Request a new one
          </Link>
        </div>
      </div>
    )
  }

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
          <h1 className="text-3xl font-extrabold text-gray-900 mt-4 tracking-tight">Set new password</h1>
          <p className="text-gray-500 text-base mt-2">
            Choose a strong password for your account
          </p>
        </div>

        <div className="rounded-2xl p-7 bg-white shadow-xl border border-gray-100">
          {success ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: 'linear-gradient(135deg, #5746ed22, #0ac5a222)' }}>
                <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">Password updated!</h2>
              <p className="text-gray-500 text-sm">Redirecting you to sign in…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  New password
                </label>
                <input
                  type="password"
                  required
                  autoFocus
                  className={inputCls}
                  placeholder="Min. 8 characters"
                  value={form.password}
                  onChange={e => set('password', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Confirm new password
                </label>
                <input
                  type="password"
                  required
                  className={inputCls}
                  placeholder="••••••••"
                  value={form.confirm}
                  onChange={e => set('confirm', e.target.value)}
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
                {loading ? 'Updating…' : 'Update Password'}
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
