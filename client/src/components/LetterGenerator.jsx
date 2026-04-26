import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

/**
 * LetterGenerator — modal for drafting ESA letters, school accommodation
 * requests, attorney summaries, insurance pre-auths, and return-to-work
 * letters from a patient's chart.
 *
 * Flow:
 *   1. Pick template
 *   2. Fill required options
 *   3. Generate → AI drafts from chart data
 *   4. Review + edit inline
 *   5. Save as draft OR finalize OR copy/download
 *
 * Props:
 *   isOpen, onClose  — modal controls
 *   patientId        — required
 *   patientName      — for header display
 */

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function TemplateCard({ template, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition-all w-full ${
        selected
          ? 'border-indigo-500 bg-indigo-50 shadow-sm'
          : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30'
      }`}
    >
      <p className={`text-sm font-semibold ${selected ? 'text-indigo-900' : 'text-gray-900'}`}>
        {template.name}
      </p>
      <p className="text-xs text-gray-500 mt-1 leading-relaxed">
        {template.description}
      </p>
    </button>
  )
}

function OptionField({ opt, value, onChange }) {
  const label = (
    <label className="text-xs font-semibold text-gray-700 mb-1 block">
      {opt.label}
      {opt.required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  )

  if (opt.type === 'textarea') {
    return (
      <div>
        {label}
        <textarea
          rows={4}
          value={value || ''}
          onChange={e => onChange(opt.key, e.target.value)}
          placeholder={opt.placeholder}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none"
        />
      </div>
    )
  }

  if (opt.type === 'select') {
    return (
      <div>
        {label}
        <select
          value={value || ''}
          onChange={e => onChange(opt.key, e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none"
        >
          <option value="">Select…</option>
          {(opt.options || []).map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>
    )
  }

  if (opt.type === 'checkbox') {
    return (
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={!!value}
          onChange={e => onChange(opt.key, e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-xs text-gray-700">
          {opt.label}
          {opt.required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
      </label>
    )
  }

  return (
    <div>
      {label}
      <input
        type="text"
        value={value || ''}
        onChange={e => onChange(opt.key, e.target.value)}
        placeholder={opt.placeholder}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none"
      />
    </div>
  )
}

export default function LetterGenerator({ isOpen, onClose, patientId, patientName }) {
  const [templates, setTemplates] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [options, setOptions] = useState({})
  const [phase, setPhase] = useState('pick')   // pick | generating | review
  const [draft, setDraft] = useState(null)
  const [editedContent, setEditedContent] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedStatus, setSavedStatus] = useState('')

  useEffect(() => {
    if (!isOpen) return
    apiFetch('/ai/letters/templates')
      .then(r => r.json())
      .then(data => setTemplates(data.templates || []))
      .catch(() => setError('Failed to load templates'))
  }, [isOpen])

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedId(null)
      setOptions({})
      setPhase('pick')
      setDraft(null)
      setEditedContent('')
      setError('')
      setSavedStatus('')
    }
  }, [isOpen])

  const selected = templates.find(t => t.id === selectedId)

  const updateOption = useCallback((key, value) => {
    setOptions(o => ({ ...o, [key]: value }))
  }, [])

  const handleGenerate = async () => {
    if (!selected) return
    // Validate required
    const missing = (selected.options || [])
      .filter(o => o.required)
      .filter(o => {
        const v = options[o.key]
        return o.type === 'checkbox' ? !v : (v == null || String(v).trim() === '')
      })
      .map(o => o.label)
    if (missing.length > 0) {
      setError(`Please fill: ${missing.join(', ')}`)
      return
    }
    setError('')
    setPhase('generating')
    try {
      const r = await apiFetch('/ai/letters/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          template_id: selected.id,
          options,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || 'Generation failed')
      setDraft(data)
      setEditedContent(data.content)
      setPhase('review')
    } catch (err) {
      setError(err.message)
      setPhase('pick')
    }
  }

  const handleSaveDraft = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const r = await apiFetch(`/ai/letters/${draft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editedContent }),
      })
      if (!r.ok) throw new Error('save failed')
      setSavedStatus('Draft saved')
      setTimeout(() => setSavedStatus(''), 2000)
    } catch {
      setError('Could not save draft')
    } finally {
      setSaving(false)
    }
  }

  const handleFinalize = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const r = await apiFetch(`/ai/letters/${draft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editedContent, status: 'finalized' }),
      })
      if (!r.ok) throw new Error('finalize failed')
      setSavedStatus('Finalized')
      setTimeout(() => setSavedStatus(''), 2000)
    } catch {
      setError('Could not finalize')
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard?.writeText(editedContent || '')
    setSavedStatus('Copied to clipboard')
    setTimeout(() => setSavedStatus(''), 1800)
  }

  const handleDownload = () => {
    const safeName = (draft?.title || `letter_${draft?.id || 'draft'}`).replace(/[^a-z0-9]+/gi, '_')
    downloadText(`${safeName}.txt`, editedContent || '')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Generate Clinical Letter</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              For {patientName}
              {phase === 'review' && draft && <> · {draft.template_name}</>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 rounded-lg p-1.5 hover:bg-gray-100"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          {phase === 'pick' && (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Choose a template
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                {templates.map(t => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    selected={selectedId === t.id}
                    onClick={() => { setSelectedId(t.id); setOptions({}) }}
                  />
                ))}
              </div>

              {selected && (
                <div className="mt-6">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Letter details
                  </p>
                  <div className="space-y-3">
                    {(selected.options || []).map(opt => (
                      <OptionField
                        key={opt.key}
                        opt={opt}
                        value={options[opt.key]}
                        onChange={updateOption}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {phase === 'generating' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-full border-4 border-indigo-100 border-t-indigo-500 animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-900">Drafting your letter</p>
                <p className="text-xs text-gray-500 mt-1">
                  Reading the chart and writing in your voice. ~15 seconds.
                </p>
              </div>
            </div>
          )}

          {phase === 'review' && draft && (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Review and edit
                </p>
                {savedStatus && (
                  <span className="text-[11px] text-emerald-700 font-semibold">{savedStatus}</span>
                )}
              </div>
              <textarea
                value={editedContent}
                onChange={e => setEditedContent(e.target.value)}
                className="w-full h-[50vh] rounded-lg border border-gray-200 px-4 py-3 text-sm font-serif leading-relaxed focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none"
              />
              <p className="text-[11px] text-gray-400 mt-2 italic">
                This is a draft generated from your chart data. Review every detail before sending —
                you are responsible for the final content.
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between flex-shrink-0 bg-gray-50">
          <button
            type="button"
            onClick={() => {
              if (phase === 'review') {
                setPhase('pick')
                setDraft(null)
              } else {
                onClose()
              }
            }}
            className="text-sm text-gray-600 hover:text-gray-900 font-semibold"
          >
            {phase === 'review' ? '← Generate another' : 'Cancel'}
          </button>

          <div className="flex items-center gap-2">
            {phase === 'pick' && (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!selected}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Generate draft
              </button>
            )}

            {phase === 'review' && (
              <>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-3 py-2 rounded-lg bg-white text-gray-700 text-sm font-semibold border border-gray-200 hover:bg-gray-100"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-3 py-2 rounded-lg bg-white text-gray-700 text-sm font-semibold border border-gray-200 hover:bg-gray-100"
                >
                  Download .txt
                </button>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={saving}
                  className="px-3 py-2 rounded-lg bg-gray-700 text-white text-sm font-semibold hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save draft'}
                </button>
                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={saving}
                  className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                  Finalize
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
