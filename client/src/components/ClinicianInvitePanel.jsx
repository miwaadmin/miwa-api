// Clinician-side invite-code panel for the client portal. Mounted in
// PatientDetail.jsx, visible only when the current therapist's
// credential_type === 'licensed'. Trainees/associates never render this.
//
// States:
// - No active invite: a "Generate portal invite code" button.
// - Pending: the code is displayed as a large monospace pill with copy +
//   revoke actions and an "Expires in N days" subtitle.
// - Claimed: shows the linked client portal account email + claim date.
//
// Miwa does not send the code anywhere — the clinician hands it to the
// client out-of-band (verbal, text, email — clinician's choice).
import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

function daysUntil(iso) {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms)) return null
  if (ms < 0) return 0
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

export default function ClinicianInvitePanel({ patientId, patientName }) {
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function load() {
    if (!patientId) return
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(`/client-invites?patient_id=${patientId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load invite state.')
      setInvites(Array.isArray(data.invites) ? data.invites : [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [patientId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    setBusy(true)
    setError('')
    setCopied(false)
    try {
      const res = await apiFetch('/client-invites', {
        method: 'POST',
        body: JSON.stringify({ patient_id: patientId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate invite code.')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function revoke(inviteId) {
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch(`/client-invites/${inviteId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not revoke invite.')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy to clipboard. Long-press the code to select it.')
    }
  }

  const pending = invites.find(i => i.status === 'pending')
  const claimed = invites.find(i => i.status === 'claimed')

  return (
    <section
      data-testid="clinician-invite-panel"
      className="mb-5 rounded-2xl border border-gray-200 bg-white px-5 py-4"
    >
      <header className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Invite to portal</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Give {patientName || 'this client'} a code to sign up for the client portal. Miwa does not send the code — you hand it off however works best.
          </p>
        </div>
      </header>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700" role="alert">{error}</p>
      )}

      {loading ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : claimed ? (
        <div
          data-testid="invite-claimed-state"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          <p className="font-semibold">Linked to portal account</p>
          <p className="text-xs text-emerald-800 mt-0.5">
            {claimed.claimed_email || 'Email on file'}
            {claimed.claimed_at && (
              <> · claimed {new Date(claimed.claimed_at).toLocaleDateString()}</>
            )}
          </p>
        </div>
      ) : pending ? (
        <div data-testid="invite-pending-state" className="space-y-3">
          <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <code
              data-testid="invite-code"
              className="font-mono text-lg font-bold tracking-wider text-indigo-900 select-all"
            >
              {pending.code}
            </code>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => copyCode(pending.code)}
                className="rounded-lg bg-white border border-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                {copied ? 'Copied!' : 'Copy code'}
              </button>
              <button
                type="button"
                onClick={() => revoke(pending.id)}
                disabled={busy}
                className="rounded-lg bg-white border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                Revoke
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Expires in {daysUntil(pending.expires_at) ?? 0} day{daysUntil(pending.expires_at) === 1 ? '' : 's'}.
            Share this code with your client — they'll use it to sign up at miwa.care/portal.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          data-testid="invite-generate-button"
          className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? 'Generating…' : 'Generate portal invite code'}
        </button>
      )}
    </section>
  )
}
