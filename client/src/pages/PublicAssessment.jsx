/**
 * PublicAssessment — client-facing screener page (SMS/email link).
 *
 * Rebuilt mobile-first. Full-screen, safe-area aware, progress bar,
 * one-question-at-a-time swipe-ish flow, warm copy. Looks identical
 * on desktop (centered card) and phone (full-bleed). No app required.
 *
 * Flow:
 *   1. Load assessment via token (anonymous)
 *   2. Show instructions + member label + "Begin" CTA
 *   3. Questions stack, each with big tappable option buttons
 *   4. Submit → result screen with score + crisis resources if flagged
 *
 * This page is what your clients see — zero friction, no login, no
 * install, every question is thumb-reachable.
 */
import { useEffect, useMemo, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { API_BASE } from '../lib/api'

function Spinner() {
  return <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
}

export default function PublicAssessment() {
  const { token } = useParams()

  const [loading, setLoading]       = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [assessment, setAssessment] = useState(null)
  const [responses, setResponses]   = useState({})
  const [result, setResult]         = useState(null)
  const [phase, setPhase]           = useState('intro') // intro | questions
  const questionsTopRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')
      try {
        const res = await fetch(`${API_BASE}/public/assess/${token}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Unable to load this link.')
        if (!cancelled) setAssessment(data)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [token])

  const answeredCount = Object.keys(responses).length
  const totalQuestions = assessment?.questions?.length || 0
  const progressPct = totalQuestions ? (answeredCount / totalQuestions) * 100 : 0

  const handleAnswer = (qIndex, value) => {
    setResponses(prev => ({ ...prev, [qIndex]: { index: qIndex, value } }))
    // Auto-advance scroll to next question for smooth UX
    setTimeout(() => {
      const next = document.getElementById(`q-${qIndex + 1}`)
      if (next) next.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 200)
  }

  async function handleSubmit() {
    if (!assessment) return
    if (!assessment.questions.every((_, i) => responses[i] !== undefined)) {
      setError('Please answer every question before submitting.')
      return
    }
    setSubmitting(true); setError('')
    try {
      const orderedResponses = assessment.questions.map((q, i) => ({
        questionId: q.id,
        value: responses[i].value,
      }))
      const res = await fetch(`${API_BASE}/public/assess/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: orderedResponses }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not submit.')
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6"
        style={{ background: 'linear-gradient(180deg, #f4f2ff 0%, #ffffff 60%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <Spinner />
        <p className="mt-3 text-sm text-gray-600">Loading your assessment…</p>
      </div>
    )
  }

  // ── Invalid link ──────────────────────────────────────────────────────────
  if (error && !assessment) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
        style={{ background: 'linear-gradient(180deg, #f4f2ff 0%, #ffffff 60%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="w-14 h-14 rounded-2xl mb-5 flex items-center justify-center bg-amber-100">
          <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">This link can't be opened</h1>
        <p className="text-sm text-gray-600 max-w-xs leading-relaxed">{error}</p>
        <p className="text-xs text-gray-400 mt-4 max-w-xs">
          If your clinician sent this recently, try the link again. Otherwise let them know it's not working.
        </p>
      </div>
    )
  }

  // ── Result ────────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="min-h-screen flex flex-col"
        style={{ background: 'linear-gradient(180deg, #f4f2ff 0%, #ffffff 60%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5"
            style={{ background: 'linear-gradient(135deg, #10b981, #34d399)' }}>
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Thank you</h1>
          <p className="text-base text-gray-600 max-w-sm leading-relaxed">
            Your responses were saved. Your clinician can review them in your chart.
          </p>

          {typeof result.total_score === 'number' && (
            <div className="mt-6 rounded-2xl bg-white border border-gray-200 px-6 py-4 w-full max-w-xs">
              <p className="text-[11px] uppercase tracking-widest text-gray-400 font-bold mb-1">Your score</p>
              <p className="text-3xl font-bold text-gray-900">{result.total_score}</p>
              {result.severity_level && (
                <p className="text-sm text-gray-500 mt-0.5">{result.severity_level}</p>
              )}
            </div>
          )}

          {result.show_crisis_resources && (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 max-w-md text-left">
              <p className="font-bold text-red-900 mb-2">If you may be in immediate danger</p>
              <p className="text-sm text-red-800 leading-relaxed mb-3">
                Please reach out to someone right now.
              </p>
              <div className="space-y-2">
                <a href="tel:988" className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-red-200 active:bg-red-50 min-h-[44px]">
                  <span className="text-red-600 font-bold text-base">📞 988</span>
                  <span className="text-sm text-red-900">Suicide & Crisis Lifeline</span>
                </a>
                <a href="sms:741741?body=HOME" className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-red-200 active:bg-red-50 min-h-[44px]">
                  <span className="text-red-600 font-bold text-base">💬 Text HOME to 741741</span>
                </a>
                <a href="tel:911" className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-red-200 active:bg-red-50 min-h-[44px]">
                  <span className="text-red-600 font-bold text-base">🚨 911</span>
                  <span className="text-sm text-red-900">For emergencies</span>
                </a>
              </div>
            </div>
          )}

          <p className="text-[11px] text-gray-400 mt-8">You can close this page.</p>
        </div>
      </div>
    )
  }

  // ── Intro screen ──────────────────────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <div className="min-h-screen flex flex-col"
        style={{ background: 'linear-gradient(180deg, #f4f2ff 0%, #ffffff 60%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex-1 flex flex-col justify-center px-6 py-10">
          <div className="max-w-md mx-auto w-full">
            <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center text-white text-lg font-bold shadow-md mb-5"
              style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}>
              M
            </div>

            <p className="text-xs font-bold uppercase tracking-widest text-brand-600 text-center mb-2">
              {assessment?.name || 'Assessment'}
            </p>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 text-center mb-3">
              A quick check-in from your clinician
            </h1>
            <p className="text-base text-gray-600 text-center leading-relaxed mb-6">
              Your answers stay between you and your clinician. Nothing is shared anywhere else.
            </p>

            {assessment?.member_label && (
              <div className="rounded-2xl bg-white border border-gray-200 p-4 mb-4 text-center">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">For</p>
                <p className="text-base font-semibold text-gray-900">{assessment.member_label}</p>
              </div>
            )}

            {assessment?.instructions && (
              <div className="rounded-2xl bg-indigo-50 border border-indigo-100 p-4 mb-6">
                <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 mb-1">Instructions</p>
                <p className="text-sm text-indigo-950 leading-relaxed">{assessment.instructions}</p>
              </div>
            )}

            <div className="rounded-2xl bg-white border border-gray-200 p-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{totalQuestions} questions</p>
                  <p className="text-xs text-gray-500">Usually takes 2–3 minutes</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => { setPhase('questions'); setTimeout(() => questionsTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 10) }}
              className="w-full rounded-xl py-4 text-base font-bold text-white active:opacity-90 shadow-sm"
              style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}
            >
              Begin
            </button>

            <p className="text-[11px] text-gray-400 text-center mt-4 leading-relaxed max-w-xs mx-auto">
              Your responses are encrypted and sent securely to your clinician.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Questions ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-gray-50"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div ref={questionsTopRef} />

      {/* Sticky progress */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 py-3">
        <div className="max-w-xl mx-auto">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-semibold text-gray-700">
              {answeredCount}/{totalQuestions} answered
            </span>
            <span className="text-gray-400">{Math.round(progressPct)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #6047EE, #2dd4bf)' }}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-4">
        <div className="max-w-xl mx-auto space-y-3">
          {assessment.questions.map((q, i) => {
            const answered = responses[i] !== undefined
            return (
              <div
                key={q.id}
                id={`q-${i}`}
                className={`rounded-2xl bg-white border p-4 scroll-mt-20 transition-colors ${answered ? 'border-emerald-200' : 'border-gray-200'}`}
              >
                <div className="flex items-start gap-2 mb-3">
                  <span className={`text-xs font-bold flex-shrink-0 mt-0.5 ${answered ? 'text-emerald-600' : 'text-brand-600'}`}>
                    {i + 1}.
                  </span>
                  <p className="text-[15px] font-medium text-gray-900 leading-snug">{q.text}</p>
                </div>
                <div className="space-y-2 pl-5">
                  {assessment.options?.map(opt => {
                    const selected = responses[i]?.value === opt.value
                    return (
                      <button
                        key={opt.value}
                        onClick={() => handleAnswer(i, opt.value)}
                        className={`w-full text-left px-4 py-3 rounded-xl text-[15px] font-medium border transition-all min-h-[48px] active:scale-[0.99] ${
                          selected
                            ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                            : 'bg-white text-gray-700 border-gray-200'
                        }`}
                      >
                        <span className="font-bold mr-2">{opt.value}</span>
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Sticky submit bar */}
      <div className="sticky bottom-0 z-20 bg-white border-t border-gray-100 px-4 py-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}>
        <div className="max-w-xl mx-auto">
          <button
            onClick={handleSubmit}
            disabled={submitting || answeredCount < totalQuestions}
            className="w-full rounded-xl py-4 text-base font-bold text-white active:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            style={{
              background: answeredCount === totalQuestions && !submitting
                ? 'linear-gradient(135deg, #6047EE, #2dd4bf)'
                : '#9ca3af',
            }}
          >
            {submitting
              ? 'Submitting…'
              : answeredCount < totalQuestions
                ? `Answer ${totalQuestions - answeredCount} more to submit`
                : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}
