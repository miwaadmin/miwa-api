import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { formatDateOnlyInTimezone } from '../lib/dateUtils'
import { apiFetch } from '../lib/api'
import { renderClinical } from '../lib/renderClinical'

// Shared clinical markdown renderer (app-wide styling)
const renderBriefMarkdown = renderClinical

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconBook() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  )
}

function IconNews() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
    </svg>
  )
}

function IconSparkle() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  )
}

function IconChevron({ className = '' }) {
  return (
    <svg className={`w-4 h-4 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function IconArrow() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  )
}

function IconRefresh({ spin = false }) {
  return (
    <svg className={`w-4 h-4 ${spin ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ color = 'brand' }) {
  const colors = {
    brand: 'border-brand-500 border-t-transparent',
    amber: 'border-amber-400 border-t-transparent',
    white: 'border-white/40 border-t-white',
  }
  return <div className={`w-4 h-4 border-2 rounded-full animate-spin ${colors[color]}`} />
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent = 'violet' }) {
  const accents = {
    violet: 'from-violet-500/10 to-violet-500/5 border-violet-100',
    amber:  'from-amber-500/10 to-amber-500/5 border-amber-100',
    brand:  'from-brand-500/10 to-brand-500/5 border-brand-100',
  }
  const dots = {
    violet: 'bg-violet-400',
    amber:  'bg-amber-400',
    brand:  'bg-brand-400',
  }
  return (
    <div className={`card p-4 bg-gradient-to-br ${accents[accent]}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${dots[accent]}`} />
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Research Synthesis Tab ────────────────────────────────────────────────────

function ResearchTab() {
  const { therapist } = useAuth()
  const [briefs, setBriefs] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generatingType, setGeneratingType] = useState(null)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    apiFetch('/research/briefs')
      .then(r => r.json())
      .then(data => { setBriefs(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const [genError, setGenError] = useState(null)

  async function handleGenerate(type = 'weekly') {
    setGenerating(true)
    setGeneratingType(type)
    setGenError(null)
    try {
      const res = await apiFetch('/research/generate', {
        method: 'POST',
        body: JSON.stringify({ type }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')

      // Refresh the briefs list
      const briefsRes = await apiFetch('/research/briefs')
      const briefsData = await briefsRes.json()
      setBriefs(Array.isArray(briefsData) ? briefsData : [])
    } catch (err) {
      console.error('[briefs] Generate failed:', err)
      setGenError(err.message)
    } finally {
      setGenerating(false)
      setGeneratingType(null)
    }
  }

  async function handleDelete(briefId) {
    setBriefs(prev => prev.filter(b => b.id !== briefId))
    try {
      await apiFetch(`/research/briefs/${briefId}`, { method: 'DELETE' })
    } catch {}
  }

  async function handleToggleSave(briefId) {
    try {
      const res = await apiFetch(`/research/briefs/${briefId}/save`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setBriefs(prev => prev.map(b => b.id === briefId ? { ...b, saved: data.saved } : b))
      }
    } catch {}
  }

  async function handleOpen(briefId) {
    // Mark as opened on first expand (fire-and-forget)
    const brief = briefs.find(b => b.id === briefId)
    if (brief && !brief.opened_at) {
      setBriefs(prev => prev.map(b => b.id === briefId ? { ...b, opened_at: new Date().toISOString() } : b))
      try { await apiFetch(`/research/briefs/${briefId}/open`, { method: 'POST' }) } catch {}
    }
  }

  const typeLabel = { weekly: 'Daily', daily: 'Daily', crisis: 'Crisis' }
  const latestBrief = briefs[0]
  const timezone = therapist?.preferred_timezone || 'America/Los_Angeles'
  const latestDate = latestBrief
    ? formatDateOnlyInTimezone(latestBrief.created_at, timezone)
    : null

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <div className="flex flex-col items-center gap-3">
        <Spinner color="brand" />
        <p className="text-sm text-gray-400">Loading briefs…</p>
      </div>
    </div>
  )

  return (
    <div>
      {/* Stats + Actions row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Total Briefs" value={briefs.length} sub="all time" accent="violet" />
        <StatCard
          label="Last Generated"
          value={latestDate || '—'}
          sub={latestBrief ? typeLabel[latestBrief.brief_type] + ' brief' : 'No briefs yet'}
          accent="brand"
        />
        <div className="card p-4 flex flex-col justify-between col-span-2 sm:col-span-1">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Generate</p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => handleGenerate('daily')}
              disabled={generating}
              className="btn-primary text-xs px-3 py-2 justify-center disabled:opacity-50"
            >
              {generating && generatingType === 'daily' ? (
                <><Spinner color="white" /> Generating…</>
              ) : (
                <><IconSparkle /> Daily Brief</>
              )}
            </button>
            <button
              onClick={() => handleGenerate('crisis')}
              disabled={generating}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors disabled:opacity-50 shadow-sm"
            >
              {generating && generatingType === 'crisis' ? (
                <><Spinner color="white" /> Generating…</>
              ) : '⚠ Crisis Brief'}
            </button>
          </div>
        </div>
      </div>

      {/* Generating banner */}
      {generating && (
        <div className="mb-5 flex items-start gap-3 px-4 py-3.5 rounded-xl bg-brand-50 border border-brand-100 text-brand-700 text-sm">
          <Spinner color="brand" />
          <span>
            {generatingType === 'crisis'
              ? 'Searching for crisis intervention research and synthesizing with AI. Takes ~30 seconds…'
              : 'Searching PubMed, fetching articles, synthesizing with AI. Takes ~30 seconds…'}
          </span>
        </div>
      )}

      {/* Error banner */}
      {genError && (
        <div className="mb-5 flex items-start gap-3 px-4 py-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <span className="font-semibold">Generation failed:</span> {genError}
        </div>
      )}

      {/* Brief list */}
      {briefs.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-brand-50 flex items-center justify-center mx-auto mb-5 shadow-sm">
            <svg className="w-8 h-8 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="font-bold text-gray-900 text-base mb-2">No briefs yet</h3>
          <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto leading-relaxed">
            Generate your first daily brief and Miwa will search PubMed and synthesize the latest peer-reviewed research for your specialty.
          </p>
          <button onClick={() => handleGenerate('daily')} disabled={generating} className="btn-primary">
            <IconSparkle /> Generate first brief
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {briefs.map((brief, idx) => {
            const isExpanded = expanded === brief.id
            const isCrisis = brief.brief_type === 'crisis'
            return (
              <div
                key={brief.id}
                className="card overflow-hidden transition-all"
                style={{ borderLeft: isCrisis ? '3px solid #f43f5e' : '3px solid #7c3aed' }}
              >
                <button
                  className="w-full text-left px-5 py-4 flex items-start justify-between gap-4 hover:bg-gray-50/60 transition-colors"
                  onClick={() => {
                    const next = isExpanded ? null : brief.id
                    setExpanded(next)
                    if (next) handleOpen(brief.id)
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {/* Type badge */}
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
                        isCrisis
                          ? 'bg-rose-50 text-rose-600 border border-rose-100'
                          : 'bg-violet-50 text-violet-600 border border-violet-100'
                      }`}>
                        {isCrisis ? '⚠' : '✦'} {typeLabel[brief.brief_type] || brief.brief_type}
                      </span>
                      {/* Date */}
                      <span className="text-xs text-gray-400 font-medium">
                        {formatDateOnlyInTimezone(brief.created_at, timezone)}
                      </span>
                      {/* Saved badge */}
                      {brief.saved && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                          ★ Saved
                        </span>
                      )}
                      {/* Unread dot */}
                      {!brief.opened_at && (
                        <span className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0" title="Unread" />
                      )}
                      {/* Latest badge */}
                      {idx === 0 && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-brand-600 bg-brand-50 border border-brand-100 px-2 py-0.5 rounded-full">
                          Latest
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-gray-900 text-sm leading-snug mb-2">{brief.title}</h3>
                    {brief.topics?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {brief.topics.map((t, i) => (
                          <span key={i} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className={`flex-shrink-0 mt-1 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                    <IconChevron className="text-gray-400" />
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 py-5 bg-gray-50/40">
                    <div className="prose-clinical mb-6"
                      dangerouslySetInnerHTML={{ __html: renderBriefMarkdown(brief.content) }} />
                    {brief.articles?.length > 0 && (
                      <div>
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Sources</p>
                        <div className="space-y-2">
                          {brief.articles.map((a, i) => (
                            <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white border border-gray-100">
                              <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <span className="text-[9px] font-bold text-gray-500">{i + 1}</span>
                              </div>
                              <div className="min-w-0 flex-1">
                                {a.url ? (
                                  <a href={a.url} target="_blank" rel="noopener noreferrer"
                                    className="text-xs text-brand-600 hover:text-brand-700 hover:underline transition-colors font-medium line-clamp-2">
                                    {a.title || a.url}
                                  </a>
                                ) : (
                                  <span className="text-xs text-gray-600">{a.title || a}</span>
                                )}
                                {a.source && <p className="text-[11px] text-gray-400 mt-0.5">{a.source}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleSave(brief.id) }}
                        className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                          brief.saved
                            ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                            : 'text-gray-500 hover:text-amber-600 hover:bg-amber-50'
                        }`}
                      >
                        {brief.saved ? '★ Saved — won\'t expire' : '☆ Save this brief'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(brief.id) }}
                        className="text-xs text-red-400 hover:text-red-600 font-medium px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        Delete brief
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
  )
}

// ── Mental Health News Tab ────────────────────────────────────────────────────

function NewsTab() {
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  function loadNews() {
    return apiFetch('/research/news?limit=5')
      .then(r => r.json())
      .then(data => { setArticles(Array.isArray(data) ? data : []) })
      .catch(() => { setArticles([]) })
  }

  useEffect(() => { loadNews().finally(() => setLoading(false)) }, [])

  async function handleRefresh() {
    setRefreshing(true)
    await apiFetch('/research/news/refresh', { method: 'POST' })
    setTimeout(() => { loadNews().finally(() => setRefreshing(false)) }, 18000)
  }

  function timeSince(dt) {
    if (!dt) return ''
    const diff = Date.now() - new Date(dt).getTime()
    const h = Math.floor(diff / 3600000)
    if (h < 1) return 'Just now'
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  // Category colors for source badges
  const sourceColors = [
    'bg-violet-50 text-violet-700 border-violet-100',
    'bg-amber-50 text-amber-700 border-amber-100',
    'bg-teal-50 text-teal-700 border-teal-100',
    'bg-blue-50 text-blue-700 border-blue-100',
    'bg-rose-50 text-rose-700 border-rose-100',
  ]
  const sourceColorMap = {}
  let colorIdx = 0

  function getSourceColor(source) {
    if (!source) return sourceColors[0]
    if (!sourceColorMap[source]) {
      sourceColorMap[source] = sourceColors[colorIdx % sourceColors.length]
      colorIdx++
    }
    return sourceColorMap[source]
  }

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <div className="flex flex-col items-center gap-3">
        <Spinner color="amber" />
        <p className="text-sm text-gray-400">Loading news…</p>
      </div>
    </div>
  )

  return (
    <div>
      {/* Stats + Actions row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Articles" value={articles.length} sub="in feed" accent="amber" />
        <StatCard
          label="Last Refreshed"
          value={articles[0] ? timeSince(articles[0].fetched_at) : '—'}
          sub="refreshes daily"
          accent="brand"
        />
        <div className="card p-4 flex flex-col justify-between col-span-2 sm:col-span-1">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Actions</p>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-secondary text-xs px-3 py-2 justify-center disabled:opacity-50"
          >
            <IconRefresh spin={refreshing} />
            {refreshing ? 'Fetching…' : 'Refresh feed'}
          </button>
        </div>
      </div>

      {/* Refreshing banner */}
      {refreshing && (
        <div className="mb-5 flex items-start gap-3 px-4 py-3.5 rounded-xl bg-amber-50 border border-amber-100 text-amber-700 text-sm">
          <Spinner color="amber" />
          Fetching latest news and summarizing with AI. Takes ~15 seconds…
        </div>
      )}

      {/* Article grid */}
      {articles.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-100 to-amber-50 flex items-center justify-center mx-auto mb-5 shadow-sm">
            <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
            </svg>
          </div>
          <h3 className="font-bold text-gray-900 text-base mb-2">No news yet</h3>
          <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto leading-relaxed">
            Click Refresh to fetch the latest mental health news from trusted clinical sources.
          </p>
          <button onClick={handleRefresh} disabled={refreshing} className="btn-secondary">
            <IconRefresh /> Fetch news
          </button>
        </div>
      ) : (
        <>
          {/* Featured top article */}
          {articles[0] && (
            <a
              href={articles[0].url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block card p-6 mb-4 hover:shadow-lg transition-all"
              style={{ borderLeft: '3px solid #f59e0b' }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full uppercase tracking-widest">
                  ★ Featured
                </span>
                {articles[0].source && (
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${getSourceColor(articles[0].source)}`}>
                    {articles[0].source}
                  </span>
                )}
                <span className="text-xs text-gray-400">{timeSince(articles[0].fetched_at)}</span>
              </div>
              <h3 className="text-base font-bold text-gray-900 group-hover:text-amber-700 transition-colors leading-snug mb-2">
                {articles[0].title}
              </h3>
              {articles[0].summary && (
                <div className="prose-clinical text-sm text-gray-500"
                  dangerouslySetInnerHTML={{ __html: renderClinical(articles[0].summary) }} />
              )}
              <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 group-hover:text-amber-700 transition-colors">
                <span>Read article</span>
                <IconArrow />
              </div>
            </a>
          )}

          {/* Rest of the grid */}
          <div className="grid gap-3 sm:grid-cols-2">
            {articles.slice(1).map((a, i) => (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group card p-4 hover:shadow-md transition-all flex flex-col"
              >
                <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                  {a.source && (
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${getSourceColor(a.source)}`}>
                      {a.source}
                    </span>
                  )}
                  <span className="text-xs text-gray-400">{timeSince(a.fetched_at)}</span>
                </div>
                <h3 className="text-sm font-semibold text-gray-900 group-hover:text-amber-700 transition-colors leading-snug mb-2 flex-1">
                  {a.title}
                </h3>
                {a.summary && (
                  <div className="prose-clinical text-xs text-gray-500 mb-3"
                    dangerouslySetInnerHTML={{ __html: renderClinical(a.summary) }} />
                )}
                <div className="flex items-center gap-1 text-xs font-medium text-amber-600 group-hover:text-amber-700 transition-colors mt-auto">
                  <span>Read article</span>
                  <IconArrow />
                </div>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main Briefs Page ──────────────────────────────────────────────────────────

export default function Briefs() {
  const [tab, setTab] = useState('research')

  const tabs = [
    {
      id: 'research',
      label: 'Research Synthesis',
      shortLabel: 'Research',
      icon: <IconBook />,
      accent: 'violet',
    },
    {
      id: 'news',
      label: 'Mental Health News',
      shortLabel: 'News',
      icon: <IconNews />,
      accent: 'amber',
    },
  ]

  const activeTab = tabs.find(t => t.id === tab)

  const accentStyles = {
    violet: {
      pill: 'bg-violet-600 text-white shadow-sm',
      inactive: 'text-gray-500 hover:text-violet-600 hover:bg-violet-50',
      headerBg: 'from-violet-500/5 via-brand-500/5 to-transparent',
      dot: 'bg-violet-400',
      label: 'text-violet-600',
    },
    amber: {
      pill: 'bg-amber-500 text-white shadow-sm',
      inactive: 'text-gray-500 hover:text-amber-600 hover:bg-amber-50',
      headerBg: 'from-amber-500/5 via-amber-400/3 to-transparent',
      dot: 'bg-amber-400',
      label: 'text-amber-600',
    },
  }

  const accent = accentStyles[activeTab?.accent || 'violet']

  return (
    <div className="max-w-5xl mx-auto px-5 py-8">

      {/* Page header */}
      <div className={`rounded-2xl bg-gradient-to-r ${accent.headerBg} border border-gray-100 p-6 mb-6 transition-all duration-300`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
              activeTab?.accent === 'amber'
                ? 'bg-gradient-to-br from-amber-100 to-amber-50 text-amber-600'
                : 'bg-gradient-to-br from-violet-100 to-brand-50 text-violet-600'
            }`}>
              {activeTab?.icon}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] font-bold uppercase tracking-widest ${accent.label}`}>
                  Clinical Intelligence
                </span>
              </div>
              <h1 className="text-xl font-bold text-gray-900">
                {activeTab?.id === 'news' ? 'Mental Health News' : 'Research Synthesis'}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {activeTab?.id === 'news'
                  ? 'Daily clinical news from trusted sources, refreshed every morning'
                  : 'Peer-reviewed research synthesized into actionable clinical briefs'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6">
        {tabs.map(t => {
          const isActive = tab === t.id
          const tabAccent = accentStyles[t.accent]
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                isActive ? tabAccent.pill : tabAccent.inactive
              }`}
            >
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">{t.shortLabel}</span>
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div key={tab}>
        {tab === 'research' ? <ResearchTab /> : <NewsTab />}
      </div>
    </div>
  )
}
