import { adminApiFetch } from '../../lib/api'

export function formatDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZoneName: 'short',
    })
  } catch { return value }
}

export async function handleAccountPatch(therapistId, patch, { setNotice, setError, onDone }) {
  setNotice?.('')
  setError?.('')
  try {
    const res = await adminApiFetch(`/admin/therapists/${therapistId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to update account')
    setNotice?.('Account updated.')
    onDone?.()
  } catch (err) {
    setError?.(err.message)
  }
}

export async function handleResetPassword(therapistId, { setNotice, setError, onDone }) {
  setNotice?.('')
  setError?.('')
  try {
    const res = await adminApiFetch(`/admin/therapists/${therapistId}/reset-password`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to reset password')
    setNotice?.(`Temporary password for ${data.therapist.email}: ${data.temporary_password}`)
    onDone?.()
  } catch (err) {
    setError?.(err.message)
  }
}

export async function handleAddNote(therapistId, note, { setNotice, setError, onDone }) {
  if (!note?.trim()) return
  try {
    const res = await adminApiFetch(`/admin/therapists/${therapistId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to add note')
    setNotice?.('Support note added.')
    onDone?.()
  } catch (err) {
    setError?.(err.message)
  }
}

export async function handleDeleteAccount(therapistId, email, { setNotice, setError, onDone }) {
  setNotice?.('')
  setError?.('')
  try {
    const res = await adminApiFetch(`/admin/therapists/${therapistId}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || data.reason || 'Failed to delete account')
    setNotice?.(`Account ${email} deleted successfully.`)
    onDone?.()
  } catch (err) {
    setError?.(err.message)
  }
}

/** Shared notice/error banner component */
export function AdminBanners({ notice, error }) {
  return (
    <>
      {notice && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 whitespace-pre-wrap">{notice}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    </>
  )
}
