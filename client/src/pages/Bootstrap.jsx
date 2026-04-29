/**
 * Admin recovery.
 *
 * Public page, but every action requires the server JWT_SECRET through the
 * diagnostic auth gate. Operators can reset an existing admin password or
 * create the first admin account without terminal/database access.
 */
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { MiwaLogo } from '../components/Sidebar'
import { API_BASE } from '../lib/api'

const API = API_BASE

export default function Bootstrap() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [mode, setMode] = useState('reset')
  const [form, setForm] = useState({
    jwt_secret: '',
    email: '',
    password: '',
    first_name: '',
    last_name: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    const jwtSecret = form.jwt_secret.trim()
    if (!jwtSecret) { setError('JWT_SECRET is required'); return }
    if (!form.email || !form.password) { setError('Email and password are required'); return }
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return }
    setBusy(true)
    try {
      const res = await fetch(`${API}/auth/_diag/${mode === 'create' ? 'create-admin' : 'reset-password'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Miwa-Diag-Secret': jwtSecret,
        },
        body: JSON.stringify(mode === 'create'
          ? {
              diag_secret: jwtSecret,
              email: form.email.trim(),
              password: form.password,
              first_name: form.first_name.trim() || null,
              last_name: form.last_name.trim() || null,
            }
          : {
              diag_secret: jwtSecret,
              email: form.email.trim(),
              new_password: form.password,
            }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.code === 'RECOVERY_SECRET_MISMATCH') {
          const expected = Array.isArray(data.expected_lengths) && data.expected_lengths.length
            ? data.expected_lengths.join(' or ')
            : 'unknown'
          const recoveryStatus = data.admin_recovery_secret_configured
            ? 'ADMIN_RECOVERY_SECRET is configured.'
            : 'ADMIN_RECOVERY_SECRET is not configured.'
          throw new Error(`Recovery secret mismatch. Pasted length: ${data.provided_length}; server expects length: ${expected}. ${recoveryStatus}`)
        }
        if (res.status === 404) {
          throw new Error('Recovery secret does not match the running server. Paste JWT_SECRET or set a temporary ADMIN_RECOVERY_SECRET in Azure.')
        }
        if (res.status === 409 && mode === 'create') {
          throw new Error('That non-official account already exists. Use Reset password, or use the configured ADMIN_EMAIL for the official admin account.')
        }
        throw new Error(data.error || (mode === 'create' ? 'Account creation failed' : 'Password reset failed'))
      }
      setCreated(data)

      const loginRes = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: form.email.trim(), password: form.password }),
      })
      const loginData = await loginRes.json()
      if (loginRes.ok) {
        login(loginData.token, loginData.therapist)
        setTimeout(() => navigate('/dashboard', { replace: true }), 800)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <div className="public-page min-h-screen flex items-center justify-center p-4" style={{ background: '#f4f2ff' }}>
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-6"><Link to="/"><MiwaLogo size={56} /></Link></div>
          <div className="rounded-2xl p-8 bg-white shadow-xl border border-gray-100">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-emerald-50 border-2 border-emerald-200">
              <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {mode === 'create' ? 'Admin account created' : 'Admin password reset'}
            </h2>
            <p className="text-gray-600 text-base mb-1">
              <span className="font-medium text-indigo-600">{created.email}</span> &middot; admin &middot; verified
            </p>
            <p className="text-gray-500 text-sm mt-4">Signing you in...</p>
          </div>
        </div>
      </div>
    )
  }

  const inputCls = "w-full rounded-xl px-4 py-3 text-base bg-white border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
  const labelCls = "block text-sm font-semibold text-gray-700 mb-1.5"

  return (
    <div className="public-page min-h-screen flex items-center justify-center p-4 py-10" style={{ background: '#f4f2ff' }}>
      <div className="relative w-full max-w-lg">
        <div className="flex flex-col items-center mb-8">
          <Link to="/"><MiwaLogo size={56} /></Link>
          <h1 className="text-3xl font-extrabold text-gray-900 mt-4 tracking-tight">Admin recovery</h1>
          <p className="text-gray-500 text-base mt-2 text-center">
            Reset your admin password or create the first admin account.
          </p>
        </div>

        <div className="rounded-2xl p-7 bg-white shadow-xl border border-gray-100">
          <div className="rounded-xl px-4 py-3 text-sm bg-amber-50 border border-amber-200 text-amber-900 mb-5 leading-relaxed">
            Reset an existing admin password, or use Create admin to create/promote the configured official admin email. Paste the production <code className="font-mono text-xs bg-white px-1 py-0.5 rounded border border-amber-200">JWT_SECRET</code>, or a temporary <code className="font-mono text-xs bg-white px-1 py-0.5 rounded border border-amber-200">ADMIN_RECOVERY_SECRET</code>.
          </div>

          <div className="grid grid-cols-2 gap-2 mb-5">
            <button
              type="button"
              onClick={() => setMode('reset')}
              className={`rounded-xl px-3 py-2 text-sm font-bold border transition-colors ${mode === 'reset' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-200'}`}
            >
              Reset password
            </button>
            <button
              type="button"
              onClick={() => setMode('create')}
              className={`rounded-xl px-3 py-2 text-sm font-bold border transition-colors ${mode === 'create' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-200'}`}
            >
              Create admin
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelCls}>Recovery secret</label>
              <input
                type="password"
                required
                autoFocus
                className={inputCls}
                placeholder="Paste from Azure App Service"
                value={form.jwt_secret}
                onChange={e => set('jwt_secret', e.target.value)}
              />
            </div>

            {mode === 'create' && (
              <>
                <hr className="border-gray-100 my-2" />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>First name</label>
                    <input className={inputCls} value={form.first_name} onChange={e => set('first_name', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Last name</label>
                    <input className={inputCls} value={form.last_name} onChange={e => set('last_name', e.target.value)} />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className={labelCls}>Admin email</label>
              <input
                type="email"
                required
                className={inputCls}
                placeholder="you@example.com"
                value={form.email}
                onChange={e => set('email', e.target.value)}
              />
            </div>

            <div>
              <label className={labelCls}>{mode === 'create' ? 'Password' : 'New password'}</label>
              <input
                type="password"
                required
                minLength={8}
                className={inputCls}
                placeholder="At least 8 characters"
                value={form.password}
                onChange={e => set('password', e.target.value)}
              />
            </div>

            {error && (
              <div className="rounded-xl px-4 py-3 text-base text-red-700 bg-red-50 border border-red-200 font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3.5 rounded-xl text-base font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 mt-2"
              style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
            >
              {busy ? 'Working...' : (mode === 'create' ? 'Create admin account' : 'Reset admin password')}
            </button>
          </form>
        </div>

        <p className="text-center text-base text-gray-500 mt-6">
          <Link to="/admin/login" className="text-indigo-600 font-semibold hover:text-indigo-700">Back to admin sign in</Link>
        </p>
      </div>
    </div>
  )
}
