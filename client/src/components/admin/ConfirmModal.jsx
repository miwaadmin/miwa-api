import { useEffect, useRef, useState } from 'react'
import AdminButton from './AdminButton'

/**
 * Controlled modal for destructive or high-stakes admin actions.
 *
 * Props:
 *   isOpen          – boolean, whether the modal is shown
 *   onClose         – () => void
 *   onConfirm       – async ({ typed, reason }) => void
 *                     Called when the user clicks Confirm. Throw to keep the
 *                     modal open (busy state resets automatically).
 *   title           – string, modal heading
 *   body            – string, descriptive warning text
 *   confirmWord     – string | undefined
 *                     If provided, the user must type this exact string before
 *                     Confirm is enabled.
 *   reasonLabel     – string, label for the reason textarea (default "Reason")
 *   reasonMinLength – number, minimum characters for the reason field; 0 = no field
 *   variant         – 'danger' | 'primary' (controls Confirm button color)
 */
export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm action',
  body,
  confirmWord,
  reasonLabel = 'Reason',
  reasonMinLength = 0,
  variant = 'danger',
}) {
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      setTyped('')
      setReason('')
      setBusy(false)
      const t = setTimeout(() => inputRef.current?.focus(), 60)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handle = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const confirmWordOk = !confirmWord || typed === confirmWord
  const reasonOk = reasonMinLength === 0 || reason.trim().length >= reasonMinLength
  const canSubmit = confirmWordOk && reasonOk && !busy

  const handleConfirm = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      await onConfirm({ typed, reason })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          {variant === 'danger' && (
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 id="confirm-modal-title" className="text-base font-semibold text-gray-900">{title}</h2>
            {body && <p className="text-sm text-gray-500 mt-1 leading-relaxed">{body}</p>}
          </div>
        </div>

        {/* Confirm-word input */}
        {confirmWord && (
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Type{' '}
              <code className="font-mono bg-gray-100 text-red-700 px-1.5 py-0.5 rounded">
                {confirmWord}
              </code>{' '}
              to continue
            </label>
            <input
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) handleConfirm() }}
              className="input"
              placeholder={confirmWord}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        {/* Reason field */}
        {reasonMinLength > 0 && (
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              {reasonLabel}{' '}
              <span className="text-gray-400 font-normal">(min {reasonMinLength} characters)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="textarea"
              rows={3}
              placeholder="Describe why this action is needed…"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-1">
          <AdminButton variant="secondary" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </AdminButton>
          <AdminButton
            variant={variant}
            size="md"
            onClick={handleConfirm}
            disabled={!canSubmit}
            loading={busy}
          >
            Confirm
          </AdminButton>
        </div>
      </div>
    </div>
  )
}
