import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { renderClinical } from '../lib/renderClinical'

function briefDateLabel(brief) {
  const source = brief?.local_date || brief?.created_at
  if (!source) return 'Undated brief'
  const date = brief.local_date ? new Date(`${brief.local_date}T00:00:00`) : new Date(source)
  if (Number.isNaN(date.getTime())) return source
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function BriefCard({ brief, savedContext = false, onSave, onUnsave, busy }) {
  const saved = Boolean(brief.saved)
  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">
            {briefDateLabel(brief)}
          </p>
          <h3 className="mt-1 text-base font-bold text-gray-950">{brief.title || 'Daily brief'}</h3>
        </div>
        {savedContext ? (
          <button
            type="button"
            onClick={() => onUnsave(brief)}
            disabled={busy}
            className="self-start rounded-full border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
          >
            Unsave
          </button>
        ) : saved ? (
          <span className="self-start rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
            Saved ✓
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onSave(brief)}
            disabled={busy}
            className="self-start rounded-full bg-brand-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            Save
          </button>
        )}
      </div>
      {brief.content ? (
        <div
          className="prose-clinical mt-4 max-w-none text-sm text-gray-700"
          dangerouslySetInnerHTML={{ __html: renderClinical(brief.content) }}
        />
      ) : (
        <p className="mt-4 text-sm text-gray-500">This brief does not have content yet.</p>
      )}
    </article>
  )
}

export default function Brief() {
  const [data, setData] = useState({ this_week: [], saved: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const savedIds = useMemo(() => new Set((data.saved || []).map(brief => brief.id)), [data.saved])

  async function loadBriefs() {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/brief')
      if (!res.ok) throw new Error('Briefs failed to load')
      const body = await res.json()
      setData({
        this_week: Array.isArray(body.this_week) ? body.this_week : [],
        saved: Array.isArray(body.saved) ? body.saved : [],
      })
    } catch {
      setError('Could not load your brief right now.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBriefs()
  }, [])

  async function saveBrief(brief) {
    setBusyId(brief.id)
    try {
      const res = await apiFetch(`/brief/${brief.id}/save`, { method: 'POST' })
      if (!res.ok) throw new Error('save failed')
      const body = await res.json()
      const updated = body.brief || { ...brief, saved: true }
      setData(current => ({
        this_week: current.this_week.map(item => item.id === brief.id ? updated : item),
        saved: [updated, ...current.saved.filter(item => item.id !== brief.id)],
      }))
    } catch {
      setError('Could not save that brief.')
    } finally {
      setBusyId(null)
    }
  }

  async function unsaveBrief(brief) {
    setBusyId(brief.id)
    try {
      const res = await apiFetch(`/brief/${brief.id}/unsave`, { method: 'POST' })
      if (!res.ok) throw new Error('unsave failed')
      const body = await res.json()
      const updated = body.brief || { ...brief, saved: false, saved_at: null }
      setData(current => ({
        this_week: current.this_week.map(item => item.id === brief.id ? updated : item),
        saved: current.saved.filter(item => item.id !== brief.id),
      }))
    } catch {
      setError('Could not unsave that brief.')
    } finally {
      setBusyId(null)
    }
  }

  const thisWeek = data.this_week.map(brief => ({
    ...brief,
    saved: brief.saved || savedIds.has(brief.id),
  }))

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-600">Brief</p>
          <h1 className="mt-2 text-3xl font-bold text-gray-950">Your Brief</h1>
          <p className="mt-2 text-sm text-gray-500">Daily updates Miwa generates for you</p>
        </header>

        {error && (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-950">This Week</h2>
              <p className="text-sm text-gray-500">Monday through today in your local workspace timezone.</p>
            </div>
          </div>
          {loading ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Loading your brief…</div>
          ) : thisWeek.length ? (
            <div className="space-y-3">
              {thisWeek.map(brief => (
                <BriefCard
                  key={brief.id}
                  brief={brief}
                  onSave={saveBrief}
                  onUnsave={unsaveBrief}
                  busy={busyId === brief.id}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
              No brief yet today — Miwa generates one each morning
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-gray-950">Saved Briefs</h2>
            <p className="text-sm text-gray-500">Saved briefs persist here in newest-first order.</p>
          </div>
          {!loading && data.saved.length ? (
            <div className="space-y-3">
              {data.saved.map(brief => (
                <BriefCard
                  key={brief.id}
                  brief={{ ...brief, saved: true }}
                  savedContext
                  onSave={saveBrief}
                  onUnsave={unsaveBrief}
                  busy={busyId === brief.id}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
              No saved briefs yet
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
