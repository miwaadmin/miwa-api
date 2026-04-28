/**
 * MobileWorkspace — mobile action hub.
 *
 * The desktop Workspace.jsx is a 1,700-line intake + document import
 * command center. On mobile, that unified surface doesn't work — each
 * flow deserves its own screen. This page surfaces the workspace's
 * primary actions as big tappable cards that route to the purpose-
 * built mobile flows (record, new client, intake import).
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'

function fmtRelative(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return ''
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) } catch { return '' }
}

function ActionCard({ icon, title, desc, onClick, accent = '#6047EE' }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl bg-white border border-gray-200 p-5 text-left active:scale-[0.99] transition-all flex items-center gap-4"
      style={{ minHeight: 88 }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${accent}18` }}
      >
        <div style={{ color: accent }}>{icon}</div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-bold text-gray-900">{title}</p>
        <p className="text-[12px] text-gray-600 leading-relaxed mt-0.5">{desc}</p>
      </div>
      <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}

export default function MobileWorkspace() {
  const navigate = useNavigate()
  const [recent, setRecent] = useState([])
  const [importingBusy, setImportingBusy] = useState(false)
  const [importError, setImportError] = useState('')

  const loadRecent = useCallback(async () => {
    try {
      const r = await apiFetch('/patients?recent=1&limit=4')
      if (!r.ok) return
      const data = await r.json()
      setRecent(Array.isArray(data) ? data.slice(0, 4) : [])
    } catch {}
  }, [])

  useEffect(() => { loadRecent() }, [loadRecent])

  // Direct file upload from mobile — handles both audio and PDF intakes.
  // The server routes to the right handler based on MIME type.
  const handleIntakeUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportingBusy(true); setImportError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const isAudio = /^audio\//.test(file.type) || /\.(m4a|mp3|wav|webm)$/i.test(file.name)
      const endpoint = isAudio ? '/api/ai/audio-import' : '/api/ai/intake-import'
      const res = await fetch(endpoint, { method: 'POST', credentials: 'include', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || data?.error || 'Import failed')
      // Navigate into the new/parsed patient record
      if (data.patient_id) {
        navigate(`/m/clients/${data.patient_id}`)
      } else {
        navigate('/m/clients')
      }
    } catch (err) {
      setImportError(err.message)
    } finally {
      setImportingBusy(false)
      e.target.value = '' // allow re-upload same file
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-gray-100 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Workspace</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">Start something new</p>
        </div>
        <button
          onClick={() => navigate('/m/more')}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 active:bg-gray-100"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-28">
        {importError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 mb-3">
            {importError}
          </div>
        )}

        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3 px-1">Quick actions</p>
        <div className="space-y-3 mb-6">
          {/* Voice-first session note */}
          <ActionCard
            accent="#6047EE"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            }
            title="Voice note"
            desc="Dictate a session recap. Miwa drafts SOAP, BIRP, DAP."
            onClick={() => navigate('/m/record')}
          />

          {/* New patient */}
          <ActionCard
            accent="#0d9488"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            }
            title="New client"
            desc="Create a new patient chart from scratch."
            onClick={() => navigate('/m/clients')}
          />

          {/* Intake upload */}
          <label
            className="w-full rounded-2xl bg-white border border-gray-200 p-5 text-left active:scale-[0.99] transition-all flex items-center gap-4 cursor-pointer"
            style={{ minHeight: 88 }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: '#7c3aed18' }}
            >
              {importingBusy ? (
                <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-6 h-6 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold text-gray-900">
                {importingBusy ? 'Parsing intake…' : 'Import intake'}
              </p>
              <p className="text-[12px] text-gray-600 leading-relaxed mt-0.5">
                Upload a PDF or audio recording of an intake. Miwa pulls out presenting concerns, history, risk.
              </p>
            </div>
            <input
              type="file"
              accept=".pdf,.docx,.txt,audio/*,.m4a,.mp3,.wav,.webm"
              className="hidden"
              onChange={handleIntakeUpload}
              disabled={importingBusy}
            />
          </label>

          {/* Briefs shortcut */}
          <ActionCard
            accent="#f59e0b"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
            title="Generate a research brief"
            desc="Pull fresh peer-reviewed research for your caseload."
            onClick={() => navigate('/m/briefs')}
          />
        </div>

        {/* Recent clients */}
        {recent.length > 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3 px-1">Recent clients</p>
            <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden divide-y divide-gray-100">
              {recent.map(p => {
                const name = p.display_name || p.client_id || 'Client'
                const initials = (name || '?').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
                return (
                  <button
                    key={p.id}
                    onClick={() => navigate(`/m/clients/${p.id}`)}
                    className="w-full flex items-center gap-3 px-4 py-3 active:bg-gray-50 text-left"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs"
                      style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
                      <p className="text-[11px] text-gray-500">
                        {p.updated_at ? fmtRelative(p.updated_at) : p.created_at ? fmtRelative(p.created_at) : ''}
                      </p>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
