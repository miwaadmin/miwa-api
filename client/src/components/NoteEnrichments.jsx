import { useState, useCallback } from 'react'
import { apiFetch } from '../lib/api'

// ── Collapsible section wrapper ─────────────────────────────────────────────
function Section({ title, icon, count, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-base">{icon}</span>
        <span className="text-sm font-semibold text-gray-800 flex-1">{title}</span>
        {count > 0 && (
          <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
            {count}
          </span>
        )}
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4 space-y-2">{children}</div>}
    </div>
  )
}

// ── Confidence badge ────────────────────────────────────────────────────────
function ConfidenceBadge({ level }) {
  const colors = {
    high:   'bg-emerald-100 text-emerald-700 border-emerald-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low:    'bg-gray-100 text-gray-500 border-gray-200',
  }
  return (
    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${colors[level] || colors.low}`}>
      {level}
    </span>
  )
}

// ── Severity color mapping for risk flags ───────────────────────────────────
function severityClasses(severity) {
  switch (severity) {
    case 'critical': return { card: 'border-red-300 bg-red-50', icon: 'text-red-600', text: 'text-red-800' }
    case 'warning':  return { card: 'border-amber-300 bg-amber-50', icon: 'text-amber-600', text: 'text-amber-800' }
    case 'info':
    default:         return { card: 'border-blue-200 bg-blue-50', icon: 'text-blue-500', text: 'text-blue-800' }
  }
}

// ── Accept / Dismiss button pair ────────────────────────────────────────────
function ActionButtons({ id, status, onAccept, onDismiss }) {
  if (status === 'accepted') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Accepted
      </span>
    )
  }
  if (status === 'dismissed') return null // parent will fade the card
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onAccept(id)}
        className="p-1 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
        title="Accept suggestion"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </button>
      <button
        onClick={() => onDismiss(id)}
        className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        title="Dismiss suggestion"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────
export default function NoteEnrichments({ sessionId, therapistId, onPlanAppend }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)       // full enrichment response
  const [statuses, setStatuses] = useState({})  // { suggestionId: 'accepted'|'dismissed' }
  const [copiedCode, setCopiedCode] = useState(null)

  // ── Fetch enrichments ───────────────────────────────────────────────────
  const handleEnrich = useCallback(async () => {
    setLoading(true)
    setError('')
    setData(null)
    setStatuses({})
    try {
      const res = await apiFetch('/ai/enrich-session', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Enrichment failed (${res.status})`)
      }
      const result = await res.json()
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  // ── Accept / Dismiss handlers ───────────────────────────────────────────
  const handleAccept = useCallback(async (suggestionId) => {
    setStatuses(s => ({ ...s, [suggestionId]: 'accepted' }))
    try {
      await apiFetch('/ai/enrich-session/accept', {
        method: 'POST',
        body: JSON.stringify({ sessionId, suggestionId }),
      })
    } catch {
      // Revert on failure
      setStatuses(s => { const n = { ...s }; delete n[suggestionId]; return n })
    }
  }, [sessionId])

  const handleDismiss = useCallback(async (suggestionId) => {
    setStatuses(s => ({ ...s, [suggestionId]: 'dismissed' }))
    try {
      await apiFetch('/ai/enrich-session/dismiss', {
        method: 'POST',
        body: JSON.stringify({ sessionId, suggestionId }),
      })
    } catch {
      setStatuses(s => { const n = { ...s }; delete n[suggestionId]; return n })
    }
  }, [sessionId])

  // ── Copy ICD-10 code to clipboard ─────────────────────────────────────
  const copyCode = (code) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code)
      setTimeout(() => setCopiedCode(null), 1500)
    }).catch(() => {})
  }

  // ── Extract enrichment arrays from API response ───────────────────────
  // API returns { enrichments: { suggested_icd10, risk_flags, ... }, enrichmentIds }
  const e = data?.enrichments || data || {}
  const icd10      = e?.suggested_icd10       ?? e?.icd10_suggestions  ?? []
  const risks      = e?.risk_flags            ?? []
  const threads    = e?.continuity_threads    ?? []
  const goals      = e?.goal_alignment        ?? []
  const planSugg   = e?.smart_plan_suggestions ?? e?.plan_suggestions  ?? []

  // Filter out dismissed items from visible lists
  const visibleItems = (items) => items.filter(i => statuses[i.id] !== 'dismissed')

  return (
    <div className="space-y-3">
      {/* ── Trigger button ─────────────────────────────────────────────── */}
      {!data && !loading && (
        <button
          type="button"
          onClick={handleEnrich}
          className="w-full flex items-center justify-center gap-3 px-5 py-4 rounded-xl text-white font-bold transition-all shadow-lg hover:shadow-xl hover:scale-[1.01]"
          style={{ background: 'linear-gradient(135deg, #5746ed 0%, #7c3aed 50%, #0ac5a2 100%)' }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          Enrich Note — ICD-10, Risk Flags, Continuity
        </button>
      )}

      {/* ── Loading state ──────────────────────────────────────────────── */}
      {loading && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-6 flex flex-col items-center gap-3">
          <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-sm font-semibold text-indigo-800">Enriching session note...</p>
            <p className="text-xs text-indigo-500 mt-0.5">Analyzing codes, risks, continuity, goals, and plan suggestions</p>
          </div>
        </div>
      )}

      {/* ── Error state ────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2">
          <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={handleEnrich} className="text-xs text-indigo-600 hover:underline mt-1">Try again</button>
          </div>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────── */}
      {data && !loading && (
        <div className="space-y-3">
          {/* Re-run button */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Enrichment Suggestions</p>
            <button
              type="button"
              onClick={handleEnrich}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Re-enrich
            </button>
          </div>

          {/* 1. ICD-10 Suggestions */}
          {icd10.length > 0 && (
            <Section title="ICD-10 Suggestions" icon="&#128203;" count={visibleItems(icd10).length}>
              <div className="flex flex-wrap gap-2">
                {visibleItems(icd10).map(item => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 transition-opacity ${
                      statuses[item.id] === 'accepted' ? 'ring-2 ring-emerald-300' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => copyCode(item.code)}
                      className="text-sm font-bold text-indigo-700 hover:text-indigo-900 transition-colors"
                      title="Click to copy code"
                    >
                      {copiedCode === item.code ? (
                        <span className="text-emerald-600">Copied!</span>
                      ) : (
                        item.code
                      )}
                    </button>
                    <span className="text-xs text-gray-600">{item.description}</span>
                    <ConfidenceBadge level={item.confidence} />
                    <ActionButtons
                      id={item.id}
                      status={statuses[item.id]}
                      onAccept={handleAccept}
                      onDismiss={handleDismiss}
                    />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 2. Risk Flags */}
          {risks.length > 0 && (
            <Section title="Risk Flags" icon="&#9888;&#65039;" count={visibleItems(risks).length}>
              <div className="space-y-2">
                {visibleItems(risks).map(item => {
                  const sc = severityClasses(item.severity)
                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border px-4 py-3 ${sc.card} transition-opacity ${
                        statuses[item.id] === 'accepted' ? 'ring-2 ring-emerald-300' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <svg className={`w-4 h-4 mt-0.5 flex-shrink-0 ${sc.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold ${sc.text}`}>{item.flag}</p>
                          {item.suggestion && (
                            <p className="text-xs text-gray-600 mt-1">{item.suggestion}</p>
                          )}
                        </div>
                        <ActionButtons
                          id={item.id}
                          status={statuses[item.id]}
                          onAccept={handleAccept}
                          onDismiss={handleDismiss}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {/* 3. Continuity Threads */}
          {threads.length > 0 && (
            <Section title="Continuity Threads" icon="&#128279;" count={visibleItems(threads).length}>
              <div className="space-y-2">
                {visibleItems(threads).map(item => (
                  <div
                    key={item.id}
                    className={`rounded-xl border border-gray-200 bg-white px-4 py-3 transition-opacity ${
                      statuses[item.id] === 'accepted' ? 'ring-2 ring-emerald-300' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{item.theme}</p>
                        {item.appearances && item.appearances.length > 0 && (
                          <p className="text-xs text-indigo-600 mt-1">
                            Also appeared in: {item.appearances.map(a =>
                              new Date(a).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                            ).join(', ')}
                          </p>
                        )}
                        {item.context && (
                          <p className="text-xs text-gray-500 mt-1">{item.context}</p>
                        )}
                      </div>
                      <ActionButtons
                        id={item.id}
                        status={statuses[item.id]}
                        onAccept={handleAccept}
                        onDismiss={handleDismiss}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 4. Goal Alignment */}
          {goals.length > 0 && (
            <Section title="Goal Alignment" icon="&#127919;" count={visibleItems(goals).length}>
              <div className="space-y-2">
                {visibleItems(goals).map(item => (
                  <div
                    key={item.id}
                    className={`rounded-xl border border-gray-200 bg-white px-4 py-3 transition-opacity ${
                      statuses[item.id] === 'accepted' ? 'ring-2 ring-emerald-300' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{item.goal}</p>
                        {item.session_content && (
                          <p className="text-xs text-gray-600 mt-1">
                            <span className="font-medium text-gray-500">Session link:</span> {item.session_content}
                          </p>
                        )}
                        {item.progress && (
                          <p className="text-xs text-emerald-600 font-medium mt-1">{item.progress}</p>
                        )}
                      </div>
                      <ActionButtons
                        id={item.id}
                        status={statuses[item.id]}
                        onAccept={handleAccept}
                        onDismiss={handleDismiss}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 5. Smart Plan Suggestions */}
          {planSugg.length > 0 && (
            <Section title="Smart Plan Suggestions" icon="&#128161;" count={visibleItems(planSugg).length}>
              <div className="space-y-2">
                {visibleItems(planSugg).map(item => (
                  <div
                    key={item.id}
                    className={`rounded-xl border border-gray-200 bg-white px-4 py-3 transition-opacity ${
                      statuses[item.id] === 'accepted' ? 'ring-2 ring-emerald-300' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{item.suggestion}</p>
                        {item.rationale && (
                          <p className="text-xs text-gray-500 mt-1">{item.rationale}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {statuses[item.id] !== 'accepted' && statuses[item.id] !== 'dismissed' && onPlanAppend && (
                          <button
                            type="button"
                            onClick={() => {
                              onPlanAppend(item.suggestion)
                              handleAccept(item.id)
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 transition-colors"
                            title="Add to Plan field"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Add to Plan
                          </button>
                        )}
                        <ActionButtons
                          id={item.id}
                          status={statuses[item.id]}
                          onAccept={handleAccept}
                          onDismiss={handleDismiss}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Empty state — no suggestions at all */}
          {icd10.length === 0 && risks.length === 0 && threads.length === 0 && goals.length === 0 && planSugg.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 text-center">
              <p className="text-sm text-gray-500">No enrichment suggestions found for this session.</p>
              <p className="text-xs text-gray-400 mt-1">Try adding more detail to the note fields and re-enriching.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
