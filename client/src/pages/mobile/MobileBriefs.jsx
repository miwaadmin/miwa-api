/**
 * MobileBriefs — mobile research-brief reading list.
 *
 * Mobile version of Briefs.jsx. Lists all generated research briefs in
 * a stack, with save/open tracking. Tap a brief to expand inline and
 * read the full rendered markdown + source articles. "Generate new"
 * button at top kicks off a fresh brief.
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { renderClinical } from '../../lib/renderClinical'

function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '' }
}

function briefTypeTone(t) {
  if (t === 'crisis') return { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', label: 'Crisis alert' }
  if (t === 'topical') return { color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', label: 'Topical' }
  return { color: '#6047EE', bg: '#eef2ff', border: '#c7d2fe', label: 'Research brief' }
}

export default function MobileBriefs() {
  const navigate = useNavigate()
  const [briefs, setBriefs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await apiFetch('/research/briefs')
      if (!res.ok) throw new Error('Failed to load briefs')
      const data = await res.json()
      setBriefs(Array.isArray(data) ? data : (data?.briefs || []))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleGenerate = async () => {
    setGenerating(true); setError('')
    try {
      const res = await apiFetch('/research/generate', { method: 'POST' })
      if (!res.ok) throw new Error('Couldn\'t generate a new brief')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleToggleSave = async (b) => {
    try {
      await apiFetch(`/research/briefs/${b.id}/save`, { method: 'POST' })
      setBriefs(list => list.map(x => x.id === b.id ? { ...x, saved: !x.saved } : x))
    } catch {}
  }

  const handleDelete = async (b) => {
    if (!window.confirm('Delete this brief?')) return
    try {
      await apiFetch(`/research/briefs/${b.id}`, { method: 'DELETE' })
      setBriefs(list => list.filter(x => x.id !== b.id))
    } catch {}
  }

  const handleToggle = async (b) => {
    if (expandedId === b.id) {
      setExpandedId(null); return
    }
    setExpandedId(b.id)
    if (!b.opened_at) {
      try { await apiFetch(`/research/briefs/${b.id}/open`, { method: 'POST' }) } catch {}
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-gray-100 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Research Briefs</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">AI-synthesized clinical research summaries</p>
        </div>
        <button
          onClick={() => navigate('/m/more')}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 active:bg-gray-100"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Generate button */}
      <div className="px-4 pt-3 pb-2 bg-white border-b border-gray-100">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full rounded-xl py-3 text-sm font-bold text-white active:opacity-90 disabled:opacity-60 shadow-sm flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}
        >
          {generating ? (
            <>
              <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              Generate new brief
            </>
          )}
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {loading ? (
          <div className="space-y-3">
            {[0, 1].map(i => (
              <div key={i} className="rounded-2xl bg-white border border-gray-100 p-4 animate-pulse">
                <div className="h-3 bg-gray-200 rounded w-1/3 mb-3" />
                <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
                <div className="h-2 bg-gray-100 rounded w-full mb-1" />
                <div className="h-2 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
            {error} <button onClick={load} className="underline font-semibold ml-1">Retry</button>
          </div>
        ) : briefs.length === 0 ? (
          <div className="text-center pt-10">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <p className="text-base font-semibold text-gray-900 mb-1">No briefs yet.</p>
            <p className="text-sm text-gray-500 max-w-xs mx-auto">
              Tap "Generate new brief" above to pull fresh peer-reviewed research tailored to your caseload.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {briefs.map(b => {
              const tone = briefTypeTone(b.brief_type)
              const expanded = expandedId === b.id
              return (
                <div key={b.id} className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
                  <button
                    onClick={() => handleToggle(b)}
                    className="w-full text-left p-4 active:bg-gray-50"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border"
                        style={{ color: tone.color, background: tone.bg, borderColor: tone.border }}
                      >
                        {tone.label}
                      </span>
                      {!b.opened_at && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                          New
                        </span>
                      )}
                      {b.saved && <span className="text-amber-500 text-xs">★</span>}
                      <span className="ml-auto text-[10px] text-gray-400">{fmtDate(b.created_at)}</span>
                    </div>
                    <p className="text-[14px] font-semibold text-gray-900 leading-snug">{b.title}</p>
                    {b.articles?.length > 0 && (
                      <p className="text-[11px] text-gray-500 mt-1">
                        {b.articles.length} article{b.articles.length === 1 ? '' : 's'}
                      </p>
                    )}
                  </button>

                  {expanded && (
                    <div className="border-t border-gray-100 bg-gray-50 px-4 py-4 space-y-4">
                      <div
                        className="text-[14px] text-gray-800 leading-relaxed prose-clinical"
                        dangerouslySetInnerHTML={{ __html: renderClinical(b.content || '') }}
                      />

                      {b.articles?.length > 0 && (
                        <div className="pt-3 border-t border-gray-200">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">
                            Source articles
                          </p>
                          <div className="space-y-2">
                            {b.articles.map((a, i) => (
                              <a
                                key={a.pmid || a.url || i}
                                href={a.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-start gap-2 text-xs text-brand-600 active:text-brand-800"
                              >
                                <span className="flex-shrink-0 mt-0.5">↗</span>
                                <span>
                                  {a.source === 'pubmed' && (
                                    <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1 py-0.5 rounded mr-1">PubMed</span>
                                  )}
                                  {a.title} {a.journal && <span className="text-gray-400">— {a.journal}</span>}
                                </span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                        <button
                          onClick={() => handleToggleSave(b)}
                          className={`flex-1 text-xs font-semibold px-3 py-2.5 rounded-xl min-h-[40px] ${
                            b.saved ? 'bg-amber-100 text-amber-700 active:bg-amber-200' : 'bg-white text-gray-600 border border-gray-200 active:bg-gray-50'
                          }`}
                        >
                          {b.saved ? '★ Saved' : '☆ Save'}
                        </button>
                        <button
                          onClick={() => handleDelete(b)}
                          className="text-xs font-semibold text-red-700 bg-white border border-red-200 active:bg-red-50 px-4 py-2.5 rounded-xl min-h-[40px]"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
