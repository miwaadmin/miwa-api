import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'

const DEFAULT_OPTIONS = [
  { value: 3, label: 'Do this well' },
  { value: 2, label: 'Doing OK' },
  { value: 1, label: 'Rarely' },
  { value: 0, label: 'Never' },
]

function shortDate(value) {
  if (!value) return 'Not taken yet'
  try {
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return value
  }
}

function groupQuestions(questions = []) {
  return questions.reduce((groups, question) => {
    const section = question.section || 'Self-care'
    if (!groups.has(section)) groups.set(section, [])
    groups.get(section).push(question)
    return groups
  }, new Map())
}

export default function ClinicianSelfCareCard({ compact = false }) {
  const [state, setState] = useState({ loading: true, template: null, latest: null, history: [], weekly: null, error: '' })
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [responses, setResponses] = useState({})
  const [formError, setFormError] = useState('')

  const load = () => {
    setState(prev => ({ ...prev, loading: true, error: '' }))
    apiFetch('/self-care')
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Unable to load self-care check-in')
        setState({
          loading: false,
          template: data.template,
          latest: data.latest || null,
          history: Array.isArray(data.history) ? data.history : [],
          weekly: data.weekly || null,
          error: '',
        })
      })
      .catch(err => setState(prev => ({ ...prev, loading: false, error: err.message })))
  }

  useEffect(() => {
    load()
  }, [])

  const grouped = useMemo(() => groupQuestions(state.template?.questions || []), [state.template])
  const questions = state.template?.questions || []
  const answeredCount = Object.keys(responses).length
  const latest = state.latest
  const weekly = state.weekly || {}
  const isDue = !!weekly.due
  const scoreLabel = latest ? `${latest.total_score}%` : '--'
  const nextDueLabel = weekly.next_due_at ? shortDate(weekly.next_due_at) : 'This week'

  const startAssessment = () => {
    const startingResponses = {}
    ;(latest?.responses || []).forEach(response => {
      if (response?.id && (Number.isFinite(response.value) || response.value === '?')) {
        startingResponses[response.id] = response.value
      }
    })
    setResponses(startingResponses)
    setFormError('')
    setOpen(true)
  }

  const submit = async () => {
    setFormError('')
    if (answeredCount === 0) {
      setFormError('Rate at least one item before saving.')
      return
    }
    setSaving(true)
    try {
      const payload = questions
        .filter(question => Object.prototype.hasOwnProperty.call(responses, question.id))
        .map(question => {
          const value = responses[question.id]
          const option = (state.template?.options || DEFAULT_OPTIONS).find(item => item.value === value)
          return { id: question.id, value, label: option?.label }
        })
      const res = await apiFetch('/self-care', {
        method: 'POST',
        body: JSON.stringify({ responses: payload }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unable to save self-care assessment')
      setOpen(false)
      setResponses({})
      load()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={`rounded-2xl border bg-white shadow-sm ${isDue ? 'border-teal-200' : 'border-gray-200'} ${compact ? 'p-5' : 'p-5'}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-teal-600">Clinician self-care</p>
          <h2 className="mt-1 text-base font-bold text-gray-950">Weekly self-care check-in</h2>
          <p className="mt-1 text-sm text-gray-500">
            {isDue
              ? 'Miwa is prompting a quick self-check this week.'
              : `Next weekly check-in: ${nextDueLabel}.`}
          </p>
        </div>
        <div className="flex items-center gap-3 sm:text-right">
          <div>
            <div className="text-3xl font-bold tabular-nums text-gray-950">{scoreLabel}</div>
            <div className="text-xs font-medium text-gray-500">{latest?.severity_level || 'No baseline yet'}</div>
          </div>
          <button
            type="button"
            onClick={startAssessment}
            disabled={!state.template}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${isDue ? 'bg-teal-600 text-white hover:bg-teal-700' : 'bg-gray-950 text-white hover:bg-gray-800'}`}
          >
            {latest ? 'Retake' : 'Start'}
          </button>
        </div>
      </div>

      {state.loading ? (
        <div className="mt-4 h-2 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full w-1/3 rounded-full bg-teal-500 animate-pulse" />
        </div>
      ) : state.error ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{state.error}</div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(state.history || []).slice(0, 6).map(item => (
            <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
              <div className="text-sm font-bold text-gray-900">{item.total_score}%</div>
              <div className="text-[11px] text-gray-500">{shortDate(item.created_at)}</div>
            </div>
          ))}
          {state.history.length === 0 && (
            <div className="text-sm text-gray-500">Your private self-care history will appear here after the first check-in.</div>
          )}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-teal-600">Private clinician check-in</p>
                <h2 className="mt-1 text-lg font-bold text-gray-950">{state.template?.name || 'Self-Care Assessment'}</h2>
                <p className="mt-1 text-sm text-gray-500">{answeredCount} of {questions.length} items rated</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto px-5 py-4 space-y-5">
              {Array.from(grouped.entries()).map(([section, items]) => (
                <section key={section} className="rounded-2xl border border-gray-100 p-4">
                  <h3 className="text-sm font-bold text-gray-950">{section}</h3>
                  <div className="mt-3 space-y-3">
                    {items.map(question => (
                      <div key={question.id} className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                        <p className="text-sm text-gray-700">{question.text}</p>
                        <div
                          className="grid gap-1 rounded-xl bg-gray-50 p-1"
                          style={{ gridTemplateColumns: `repeat(${(state.template?.options || DEFAULT_OPTIONS).length}, minmax(0, 1fr))` }}
                        >
                          {(state.template?.options || DEFAULT_OPTIONS).map(option => (
                            <button
                              key={`${question.id}-${option.value}`}
                              type="button"
                              onClick={() => setResponses(prev => ({ ...prev, [question.id]: option.value }))}
                              title={option.label}
                              className={`min-w-[44px] rounded-lg px-2 py-1.5 text-xs font-bold transition-colors ${
                                responses[question.id] === option.value
                                  ? 'bg-teal-600 text-white shadow-sm'
                                  : 'text-gray-500 hover:bg-white hover:text-gray-900'
                              }`}
                            >
                              {option.value}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <div className="border-t border-gray-100 px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-gray-500">
                3 = well, 2 = OK, 1 = rarely, 0 = never, ? = never occurred to me.
                {formError && <span className="ml-2 font-bold text-red-600">{formError}</span>}
              </div>
              <button
                type="button"
                onClick={submit}
                disabled={saving || answeredCount === 0}
                className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save check-in'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
