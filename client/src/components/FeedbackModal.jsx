// FeedbackModal — floating form for submitting feedback, bug reports, or
// help requests. Works for both therapist app users and client portal users.
// Handles its own POST call so callers don't need to wire an apiFetch variant.
//
// Props:
//   isOpen       – boolean, controls visibility
//   onClose      – () => void, called when the modal is dismissed
//   apiFetchFn   – the apiFetch / clientApiFetch function for the current context;
//                  defaults to the therapist apiFetch if omitted
import { useState } from 'react'
import { apiFetch } from '../lib/api'

const CATEGORIES = [
  { value: 'bug', label: 'Bug — something is broken' },
  { value: 'feature_request', label: 'Feature request — I want Miwa to do something new' },
  { value: 'help', label: 'Help — I have a question' },
  { value: 'other', label: 'Other feedback' },
]

export default function FeedbackModal({ isOpen, onClose, apiFetchFn }) {
  const fetch = apiFetchFn || apiFetch

  const [category, setCategory] = useState('help')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [includePage, setIncludePage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ticketId, setTicketId] = useState(null)

  function resetForm() {
    setCategory('help')
    setSubject('')
    setMessage('')
    setIncludePage(false)
    setError('')
    setTicketId(null)
    setBusy(false)
  }

  function handleClose() {
    resetForm()
    onClose()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = message.trim()
    if (trimmed.length < 10) {
      setError('Please write at least 10 characters so we have enough to go on.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const context = includePage ? { page: window.location.pathname } : null
      const res = await fetch('/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category,
          subject: subject.trim() || null,
          message: trimmed,
          context,
          source: 'form',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not submit feedback.')
      setTicketId(data.ticket_id)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Send feedback</h2>
            <p className="text-xs text-gray-500 mt-0.5">We read every submission — usually within a day or two.</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {ticketId ? (
          <div data-testid="feedback-success" className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-5 text-center">
            <svg className="w-8 h-8 text-emerald-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-semibold text-emerald-900 mb-1">Thanks for the note!</p>
            <p className="text-xs text-emerald-700 mb-3">
              Your ticket is <span className="font-mono font-bold">{ticketId}</span> — we'll follow up if we have questions.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-700"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700" role="alert">
                {error}
              </p>
            )}

            {/* Category */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                What's this about?
              </label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-400"
                data-testid="feedback-category"
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            {/* Subject */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Subject <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                maxLength={200}
                placeholder="One-line summary"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-400"
                data-testid="feedback-subject"
              />
            </div>

            {/* Message */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Message <span className="text-gray-400">(min 10 chars)</span>
              </label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={4}
                placeholder="Tell us what happened, what you expected, or what you'd like to see…"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-400"
                data-testid="feedback-message"
                required
              />
            </div>

            {/* Include page context */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includePage}
                onChange={e => setIncludePage(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-400"
                data-testid="feedback-include-page"
              />
              <span className="text-xs text-gray-600">
                Include current page URL
                <span className="ml-1 text-gray-400">({window.location.pathname})</span>
              </span>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-indigo-600 text-white py-2.5 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              data-testid="feedback-submit"
            >
              {busy ? 'Sending…' : 'Send feedback'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
