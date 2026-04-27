/**
 * CheckinForm — between-session mood check-in (SMS/email link).
 *
 * Rebuilt mobile-first. Full-screen, safe-area aware. The mood score is
 * picked via big emoji/number buttons sized for thumbs. Optional free
 * text for context. Uses the same /public/checkin/:token endpoint.
 *
 * This is what your client sees when you send them a mid-week SMS —
 * zero friction, under 20 seconds to complete.
 */
import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { API_BASE } from '../lib/api'

const API = API_BASE

const MOODS = [
  { score: 1,  emoji: '😞', label: 'Very difficult' },
  { score: 2,  emoji: '🙁', label: 'Rough' },
  { score: 3,  emoji: '😐', label: 'So-so' },
  { score: 4,  emoji: '🙂', label: 'Getting by' },
  { score: 5,  emoji: '😊', label: 'Pretty good' },
]

const ACCENT_FOR_MOOD = {
  1: '#dc2626', 2: '#f97316', 3: '#eab308', 4: '#22c55e', 5: '#10b981',
}

export default function CheckinForm() {
  const { token } = useParams()
  const [state, setState] = useState('loading') // loading | form | done | expired | already_done | error
  const [message, setMessage] = useState('')
  const [mood, setMood] = useState(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    fetch(`${API}/public/checkin/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.already_completed) { setState('already_done'); return }
        if (data.error) { setState(data.error.includes('expired') ? 'expired' : 'error'); setErrorMsg(data.error); return }
        setMessage(data.message || '')
        setState('form')
      })
      .catch(() => { setState('error'); setErrorMsg('Could not load your check-in. Please try again.') })
  }, [token])

  const handleSubmit = async () => {
    if (!mood) return
    setSubmitting(true); setErrorMsg('')
    try {
      const res = await fetch(`${API}/public/checkin/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood_score: mood, mood_notes: notes.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      setState('done')
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Shared shell ──────────────────────────────────────────────────────────
  const Shell = ({ children }) => (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: 'linear-gradient(180deg, #f4f2ff 0%, #ffffff 60%)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-32 -left-32 w-[400px] h-[400px] rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(96,71,238,0.15), transparent 70%)' }} />
        <div className="absolute -bottom-32 -right-32 w-[400px] h-[400px] rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(10,197,162,0.15), transparent 70%)' }} />
      </div>
      {children}
    </div>
  )

  // ── Loading ───────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="mt-3 text-sm text-gray-600">Loading your check-in…</p>
        </div>
      </Shell>
    )
  }

  // ── Already done ──────────────────────────────────────────────────────────
  if (state === 'already_done') {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-14 h-14 rounded-2xl mb-5 flex items-center justify-center bg-emerald-100">
            <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Already checked in</h1>
          <p className="text-sm text-gray-600 max-w-xs">
            You've already submitted this check-in. Your clinician has it.
          </p>
        </div>
      </Shell>
    )
  }

  // ── Expired / error ───────────────────────────────────────────────────────
  if (state === 'expired' || state === 'error') {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-14 h-14 rounded-2xl mb-5 flex items-center justify-center bg-amber-100">
            <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            {state === 'expired' ? 'This check-in has expired' : "Couldn't load your check-in"}
          </h1>
          <p className="text-sm text-gray-600 max-w-xs leading-relaxed">{errorMsg}</p>
          <p className="text-xs text-gray-400 mt-4 max-w-xs">
            Let your clinician know so they can send a new one.
          </p>
        </div>
      </Shell>
    )
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (state === 'done') {
    const accent = mood ? ACCENT_FOR_MOOD[mood] : '#10b981'
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mb-5"
            style={{ background: accent }}
          >
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Thanks for checking in</h1>
          <p className="text-base text-gray-600 max-w-sm leading-relaxed">
            Your clinician has your update. If today was a tough one, you're not alone — and they'll see it.
          </p>

          {mood && mood <= 2 && (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 max-w-md text-left">
              <p className="font-bold text-red-900 mb-2">If things feel really heavy right now</p>
              <div className="space-y-2">
                <a href="tel:988" className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-red-200 active:bg-red-50 min-h-[44px]">
                  <span className="text-red-600 font-bold text-base">📞 988</span>
                  <span className="text-sm text-red-900">Suicide & Crisis Lifeline</span>
                </a>
                <a href="sms:741741?body=HOME" className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-red-200 active:bg-red-50 min-h-[44px]">
                  <span className="text-red-600 font-bold text-base">💬 Text HOME to 741741</span>
                </a>
              </div>
            </div>
          )}

          <p className="text-[11px] text-gray-400 mt-8">You can close this page.</p>
        </div>
      </Shell>
    )
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  const accent = mood ? ACCENT_FOR_MOOD[mood] : '#6047EE'

  return (
    <Shell>
      <div className="flex-1 flex flex-col px-6 py-8 max-w-md w-full mx-auto">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center text-white text-lg font-bold shadow-md mb-4"
            style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}>
            M
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">How are you today?</h1>
          {message ? (
            <p className="text-sm text-gray-600 leading-relaxed max-w-xs mx-auto">{message}</p>
          ) : (
            <p className="text-sm text-gray-600 leading-relaxed max-w-xs mx-auto">
              Quick check-in from your clinician. Takes 20 seconds.
            </p>
          )}
        </div>

        {/* Mood picker */}
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 text-center">
            Tap the one that fits
          </p>
          <div className="grid grid-cols-5 gap-2">
            {MOODS.map(m => {
              const selected = mood === m.score
              const color = ACCENT_FOR_MOOD[m.score]
              return (
                <button
                  key={m.score}
                  onClick={() => setMood(m.score)}
                  className={`flex flex-col items-center justify-center py-3 rounded-2xl border-2 transition-all active:scale-[0.95] ${
                    selected ? 'text-white shadow-md' : 'bg-white text-gray-700 border-gray-200'
                  }`}
                  style={selected ? { background: color, borderColor: color } : {}}
                >
                  <span className="text-3xl mb-1">{m.emoji}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider">{m.score}/5</span>
                </button>
              )
            })}
          </div>
          {mood && (
            <p className="text-center text-sm font-semibold mt-3" style={{ color: accent }}>
              {MOODS.find(m => m.score === mood)?.label}
            </p>
          )}
        </div>

        {/* Optional notes */}
        <div className="mb-5">
          <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
            Anything you'd want your clinician to know? <span className="font-normal lowercase tracking-normal text-gray-400 normal-case">(optional)</span>
          </label>
          <textarea
            rows={4}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={500}
            placeholder="Write as much or as little as you want…"
            className="w-full rounded-xl px-4 py-3 text-[15px] bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 resize-none"
          />
          <p className="text-[10px] text-gray-400 text-right mt-1">{notes.length}/500</p>
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 mb-4">
            {errorMsg}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || !mood}
          className="w-full rounded-xl py-4 text-base font-bold text-white active:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm mt-auto"
          style={{
            background: mood && !submitting
              ? `linear-gradient(135deg, ${accent}, ${accent}dd)`
              : '#9ca3af',
          }}
        >
          {submitting ? 'Sending…' : mood ? 'Send to my clinician' : 'Pick how you feel'}
        </button>

        <p className="text-[11px] text-gray-400 text-center mt-4 leading-relaxed">
          Your response is encrypted and shared only with your clinician.
        </p>
      </div>
    </Shell>
  )
}
