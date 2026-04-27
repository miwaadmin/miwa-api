import { useState } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'
import { MiwaLogo } from '../components/Sidebar'
import { API_BASE } from '../lib/api'

const API = API_BASE

export default function AdminLogin() {
  const { admin, adminLogin } = useAdminAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (admin) return <Navigate to="/admin" replace />

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/auth/admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Admin login failed')
      adminLogin(data.token, data.therapist)
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const inputCls = "w-full rounded-xl px-4 py-3 text-base bg-[#1a1456]/60 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
  const labelCls = "block text-sm font-semibold text-white/70 mb-1.5"

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #0a0818 0%, #1a1456 40%, #0a0818 100%)' }}>

      {/* Decorative blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(96,71,238,0.2), transparent)' }} />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(45,212,191,0.1), transparent)' }} />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo + branding */}
        <div className="flex flex-col items-center mb-8">
          <MiwaLogo size={56} />
          <h1 className="text-3xl font-extrabold text-white mt-4 tracking-tight">Admin Portal</h1>
          <p className="text-white/40 text-base mt-2">Manage accounts, usage, and billing</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-7 border border-white/10"
          style={{ background: 'rgba(26,20,86,0.5)', backdropFilter: 'blur(20px)' }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelCls}>Email</label>
              <input
                type="email"
                required
                autoFocus
                className={inputCls}
                placeholder="admin@miwa.care"
                value={form.email}
                onChange={e => set('email', e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Password</label>
              <input
                type="password"
                required
                className={inputCls}
                placeholder="••••••••"
                value={form.password}
                onChange={e => set('password', e.target.value)}
              />
            </div>

            {error && (
              <div className="rounded-xl px-4 py-3 text-sm text-red-300 bg-red-500/10 border border-red-500/20 font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl text-base font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 mt-2"
              style={{ background: 'linear-gradient(135deg, #5746ed 0%, #2dd4bf 100%)' }}
            >
              {loading ? 'Signing in…' : 'Sign In to Admin'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-white/30 mt-6">
          <Link to="/" className="text-white/50 hover:text-white/70 transition-colors">
            ← Back to Miwa
          </Link>
        </p>
      </div>
    </div>
  )
}
