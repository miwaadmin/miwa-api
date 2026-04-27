import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import PublicPageShell from '../components/PublicPageShell'
import PublicNav from '../components/PublicNav'
import PublicFooter from '../components/PublicFooter'
import { API_BASE } from '../lib/api'

/**
 * PublicLethalityScreen — an anonymous, unauthenticated web version of
 * the 11-question LAP-MD (Lethality Assessment Program, Maryland Model)
 * developed by the Maryland Network Against Domestic Violence, based on
 * Dr. Jacquelyn Campbell's Danger Assessment research.
 *
 * Anyone can reach this URL directly — a survivor, an advocate, a family
 * member, a clinician at another agency — and take the screen. The
 * server generates AI-personalized guidance on submit, plus a curated
 * list of matched safety resources. No account required, no PII stored.
 *
 * Privacy note: we deliberately pair this with a big banner on every
 * screen explaining that no personally-identifying information is saved.
 */

const QUESTIONS = [
  { id: 1,  text: 'Have they ever used a weapon against you or threatened you with a weapon?' },
  { id: 2,  text: 'Do you think they might try to kill you?' },
  { id: 3,  text: 'Have they ever tried to choke/strangle you (cut off breathing)?' },
  { id: 4,  text: 'Have they threatened to kill you or your children?' },
  { id: 5,  text: 'Do they have a gun, or can they easily get one?' },
  { id: 6,  text: 'Are they violently or constantly jealous, or do they control most of your daily activities?' },
  { id: 7,  text: 'Have you left them or separated after living together or being married?' },
  { id: 8,  text: 'Are they unemployed?' },
  { id: 9,  text: 'Have they ever tried to kill themselves?' },
  { id: 10, text: 'Do you have a child/children that they know are not theirs?' },
  { id: 11, text: 'Do they follow or spy on you, or leave threatening messages?' },
]

function SafetyBanner() {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3 mb-8">
      <span className="text-2xl flex-shrink-0">🚨</span>
      <div>
        <p className="font-bold text-red-900 mb-1">If you are in immediate danger, leave this page and call 911.</p>
        <p className="text-sm text-red-800/90 leading-relaxed">
          You can also call or text the National Domestic Violence Hotline anytime: <strong>1-800-799-7233</strong>, or text <strong>START</strong> to <strong>88788</strong>. They are available 24/7.
        </p>
        <p className="text-xs text-red-700/75 mt-1.5 italic">
          Miwa does not save your name, IP address, or anything you write on this page.
        </p>
      </div>
    </div>
  )
}

function QuestionRow({ q, critical, value, onChange }) {
  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        critical
          ? 'border-amber-300 bg-amber-50/40'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start gap-3 mb-3">
        <span className={`text-sm font-bold flex-shrink-0 ${critical ? 'text-amber-700' : 'text-gray-500'}`}>
          {q.id}.
        </span>
        <p className="text-[15px] text-gray-900 leading-snug">{q.text}</p>
      </div>
      <div className="flex items-center gap-2 pl-8 flex-wrap">
        {[
          { v: 1,    label: 'Yes',   color: 'rgb(220 38 38)' },
          { v: 0,    label: 'No',    color: 'rgb(55 65 81)'  },
          { v: null, label: 'Unsure / not answered', color: 'rgb(107 114 128)' },
        ].map(({ v, label, color }) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
              value === v
                ? 'text-white border-transparent shadow-sm'
                : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
            }`}
            style={value === v ? { background: color } : {}}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ResourceBlock({ title, items, tone = 'indigo' }) {
  const toneMap = {
    indigo: 'border-indigo-200 bg-indigo-50/50',
    red:    'border-red-200    bg-red-50/60',
    amber:  'border-amber-200  bg-amber-50/50',
    teal:   'border-teal-200   bg-teal-50/50',
    green:  'border-emerald-200 bg-emerald-50/50',
    gray:   'border-gray-200   bg-gray-50',
  }
  if (!items || items.length === 0) return null
  return (
    <div className={`rounded-2xl border p-5 ${toneMap[tone]}`}>
      <p className="text-xs font-bold uppercase tracking-widest text-gray-700 mb-3">{title}</p>
      <div className="space-y-3">
        {items.map((r, i) => (
          <div key={i} className="rounded-lg bg-white border border-gray-100 p-3">
            <p className="font-semibold text-gray-900 text-sm">{r.name}</p>
            {r.phone && (
              <p className="text-sm text-gray-900 mt-1">
                <a href={`tel:${r.phone.replace(/[^0-9+]/g, '')}`} className="font-bold text-red-700 hover:underline">
                  📞 {r.phone}
                </a>
                {r.text && <span className="text-gray-600 ml-3">· Text <strong>{r.text}</strong></span>}
                {r.available && <span className="text-gray-500 ml-2 text-xs italic">· {r.available}</span>}
              </p>
            )}
            {r.description && <p className="text-[13px] text-gray-600 mt-1 leading-relaxed">{r.description}</p>}
            {r.url && (
              <a href={r.url} target="_blank" rel="noopener noreferrer"
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 mt-1.5 inline-block">
                Visit website →
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PublicLethalityScreen() {
  const [answers, setAnswers] = useState(() => Array(11).fill(undefined))
  const [openText, setOpenText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const updateAnswer = useCallback((idx, val) => {
    setAnswers(prev => {
      const next = [...prev]
      next[idx] = val
      return next
    })
  }, [])

  const unanswered = answers.filter(a => a === undefined).length
  const canSubmit = unanswered === 0 && !submitting

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      const r = await fetch(`${API_BASE}/public/lethality-screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, openText: openText.trim() || undefined }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || 'Submit failed')
      setResult(data)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleReset = () => {
    setAnswers(Array(11).fill(undefined))
    setOpenText('')
    setResult(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Result view ──────────────────────────────────────────────────────────
  if (result) {
    const tone = result.highDanger ? 'red' : 'teal'
    return (
      <PublicPageShell>
        <PublicNav />
        <div className="max-w-3xl mx-auto px-6 pt-32 pb-24">
          <SafetyBanner />

          {/* Header */}
          <div className={`rounded-2xl p-6 mb-8 ${
            result.highDanger
              ? 'bg-gradient-to-br from-red-50 to-amber-50 border border-red-200'
              : 'bg-gradient-to-br from-teal-50 to-emerald-50 border border-teal-200'
          }`}>
            <p className={`text-xs font-bold uppercase tracking-widest mb-2 ${
              result.highDanger ? 'text-red-700' : 'text-teal-700'
            }`}>
              Your screen result
            </p>
            <h1 className={`text-3xl md:text-4xl font-bold mb-3 ${
              result.highDanger ? 'text-red-900' : 'text-teal-900'
            }`}>
              {result.highDanger
                ? 'The screen shows elevated risk.'
                : 'The screen is below the high-danger threshold.'}
            </h1>
            <p className="text-gray-700 text-[15px] leading-relaxed">{result.reason}</p>
          </div>

          {/* AI guidance */}
          {result.guidance && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 mb-8">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">
                What this could mean for you
              </p>
              <p className="text-gray-800 text-[15px] leading-relaxed whitespace-pre-line">
                {result.guidance}
              </p>
            </div>
          )}

          {/* Resources */}
          <div className="space-y-4 mb-8">
            <ResourceBlock title="Talk to someone right now" items={result.resources.hotlines} tone="red" />
            <ResourceBlock title="Safety planning tools" items={result.resources.safety_planning} tone="indigo" />
            <ResourceBlock title="Legal protection" items={result.resources.legal_protection} tone="amber" />
            <ResourceBlock title="Shelter & housing" items={result.resources.shelter} tone="teal" />
            <ResourceBlock title="Financial support" items={result.resources.financial} tone="green" />
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={handleReset}
              className="text-sm text-gray-600 hover:text-gray-900 font-semibold"
            >
              ← Take the screen again
            </button>
            <Link
              to="/resources"
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-800"
            >
              More Miwa resources →
            </Link>
          </div>
        </div>
        <PublicFooter />
      </PublicPageShell>
    )
  }

  // ── Form view ────────────────────────────────────────────────────────────
  return (
    <PublicPageShell>
      <PublicNav />
      <div className="max-w-3xl mx-auto px-6 pt-32 pb-20">
        {/* Hero */}
        <div className="text-center mb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-3">
            Lethality Assessment · Maryland Model
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 mb-4 leading-tight">
            A few questions about your safety.
          </h1>
          <p className="text-gray-700 text-lg max-w-2xl mx-auto leading-relaxed">
            This is the same 11-question screen used by police and victim advocates across the country, developed by the Maryland Network Against Domestic Violence.
          </p>
          <p className="text-gray-500 text-sm max-w-xl mx-auto mt-3 leading-relaxed">
            Answer as honestly as you can — for whichever partner or ex-partner worries you most. It takes about 3 minutes.
          </p>
        </div>

        <SafetyBanner />

        <form onSubmit={handleSubmit} className="space-y-3">
          {QUESTIONS.map((q, i) => (
            <QuestionRow
              key={q.id}
              q={q}
              critical={i < 3}
              value={answers[i]}
              onChange={(v) => updateAnswer(i, v)}
            />
          ))}

          {/* Open text */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 mt-4">
            <label className="block text-[15px] text-gray-900 mb-2">
              Is there anything else that worries you about your safety?
              <span className="text-gray-400 text-sm font-normal"> (optional)</span>
            </label>
            <textarea
              rows={3}
              value={openText}
              onChange={(e) => setOpenText(e.target.value)}
              maxLength={2000}
              placeholder="Anything you'd want an advocate to know…"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="pt-4 flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs text-gray-500">
              {unanswered === 0
                ? 'All questions answered — ready to submit.'
                : `${unanswered} question${unanswered === 1 ? '' : 's'} remaining.`}
            </p>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-8 py-3.5 rounded-xl text-base font-bold text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: '#111113' }}
            >
              {submitting ? 'Calculating…' : 'See my result'}
            </button>
          </div>
        </form>

        {/* Footnote */}
        <div className="mt-12 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 leading-relaxed">
            This screen is not a diagnosis, not a prediction, and not medical advice. It is a starting point for a conversation with someone who is trained to help. It was developed by the Maryland Network Against Domestic Violence, derived from research by Dr. Jacquelyn Campbell (Johns Hopkins). The full questionnaire and scoring rules are intentionally fixed — changing the wording invalidates the instrument.
          </p>
        </div>
      </div>
      <PublicFooter />
    </PublicPageShell>
  )
}
