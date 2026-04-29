/**
 * Hours — practice hour tracking for trainees and associates.
 *
 * v1 mirrors the CSUN MFT practicum bucket structure (matches the layout
 * shown in csun.tevera.app's Track view). Direct service hours auto-tally
 * from completed appointments; supervision/training/advocacy hours are
 * logged manually.
 *
 * UNOFFICIAL — not BBS-approved, not a substitute for the supervisor's
 * signature on the official 32A. The disclaimer banner makes that clear.
 */
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

// Today as YYYY-MM-DD in the user's local time (matches how the server
// stores dates — see practice_hours.date column).
const todayLocalISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const fmtDate = iso => {
  try {
    const [y,m,d] = String(iso).split('-').map(Number)
    return new Date(y, m-1, d).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    })
  } catch { return iso }
}

export default function Hours() {
  const { therapist } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('progress')          // 'progress' | 'log'
  const [state, setState] = useState(null)            // bucket totals from server
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [entries, setEntries] = useState([])         // recent manual entries
  const [showEntryModal, setShowEntryModal] = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)
  const [exporting, setExporting] = useState(false)

  // Plan gate. If the user isn't a trainee/associate, redirect — server also
  // enforces this but we want graceful UX, not a 403.
  const cred = therapist?.credential_type || 'licensed'
  const eligible = cred === 'trainee' || cred === 'associate'

  const loadAll = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [hoursRes, entriesRes] = await Promise.all([
        apiFetch('/hours').then(r => r.json()),
        apiFetch('/hours/entries').then(r => r.json()),
      ])
      setState(hoursRes)
      setEntries(Array.isArray(entriesRes?.entries) ? entriesRes.entries : [])
    } catch (e) {
      setError(e.message || 'Failed to load hours')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (eligible) loadAll() }, [loadAll, eligible])

  // CSV download. apiFetch is used so credentials/auth-bearer headers go
  // along; the response body is converted to a Blob and an <a download>
  // is synthesized to trigger the save dialog. This works the same on
  // desktop and mobile-web; native Capacitor would need different handling
  // but the Hours page is desktop-first for now.
  const handleExportCsv = useCallback(async () => {
    setExporting(true)
    try {
      const res = await apiFetch('/hours/export.csv')
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const stamp = todayLocalISO()
      a.download = `miwa-hours-${stamp}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoke after a tick so Safari has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      alert(e.message || 'Could not download the CSV.')
    } finally {
      setExporting(false)
    }
  }, [])

  // Render an "ineligible" landing instead of an empty page when a licensed
  // clinician somehow lands here — same as the server's 403, but friendlier.
  if (!eligible) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="rounded-2xl bg-white border border-gray-200 p-8 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Hours tracking</h1>
          <p className="text-sm text-gray-600">
            Hour tracking is built for trainees and associates working toward
            licensure. Already licensed? You don't need to log hours anymore.
          </p>
          <button
            onClick={() => navigate('/dashboard')}
            className="mt-6 px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    )
  }

  const buckets = state?.buckets || []
  const rollups = buckets.filter(b => b.kind === 'rollup' && b.parent === 'total')
  const total   = buckets.find(b => b.id === 'total')

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Hours</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {state?.programLabel || 'CSUN MFT (Practicum)'} · auto-tallied from your completed appointments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={exporting}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold text-gray-700 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors flex items-center gap-2 disabled:opacity-60"
            title="Download a CSV with bucket totals + every manual entry. Hand it to your supervisor or paste into Tevera/the BBS form."
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            {exporting ? 'Preparing…' : 'Export CSV'}
          </button>
          <button
            onClick={() => { setEditingEntry(null); setShowEntryModal(true) }}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Log hours
          </button>
        </div>
      </div>

      {/* Unofficial disclaimer */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
        <svg className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-amber-800 leading-relaxed">
          <span className="font-semibold">Unofficial — for your reference only.</span>
          {' '}Use these totals to fill out your CSUN/BBS form. Your supervisor's
          signature on the official 32A is still required.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {[
          { id: 'progress', label: 'Progress' },
          { id: 'track',    label: 'Track grid' },
          { id: 'log',      label: `Log${entries.length ? ` (${entries.length})` : ''}` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="card p-12 flex justify-center text-sm text-gray-400">Loading hours…</div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>
      ) : tab === 'progress' ? (
        <ProgressView buckets={buckets} total={total} rollups={rollups} sessions={state?.totalSessions || 0} />
      ) : tab === 'track' ? (
        <TrackGridView />
      ) : (
        <LogView
          entries={entries}
          onEdit={entry => { setEditingEntry(entry); setShowEntryModal(true) }}
          onDelete={async id => {
            if (!window.confirm('Delete this entry? This can\'t be undone.')) return
            const res = await apiFetch(`/hours/entries/${id}`, { method: 'DELETE' })
            if (res.ok) loadAll()
            else alert('Failed to delete entry')
          }}
        />
      )}

      {/* Manual entry modal */}
      {showEntryModal && (
        <EntryModal
          entry={editingEntry}
          onClose={() => { setShowEntryModal(false); setEditingEntry(null) }}
          onSaved={() => { setShowEntryModal(false); setEditingEntry(null); loadAll() }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress view — top-level rollups with progress bars + leaf-bucket detail.
// ─────────────────────────────────────────────────────────────────────────────
function ProgressView({ buckets, total, rollups, sessions }) {
  return (
    <div className="space-y-5">
      {/* Big total card */}
      {total && (
        <div className="card p-6">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{total.label}</h2>
            <span className="text-xs text-gray-400">From {sessions} completed session{sessions === 1 ? '' : 's'} + manual entries</span>
          </div>
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-4xl font-extrabold text-gray-900">{total.hours.toLocaleString()}</span>
            {total.minHours && (
              <span className="text-sm text-gray-500">/ {total.minHours} hrs · {total.percentOfMin}%</span>
            )}
          </div>
          {total.minHours && <ProgressBar pct={total.percentOfMin} accent="#5746ed" tall />}
        </div>
      )}

      {/* Each top-level rollup */}
      {rollups.map(rollup => {
        const children = buckets.filter(b => b.parent === rollup.id)
        return (
          <div key={rollup.id} className="card p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-bold text-gray-900">{rollup.label}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {rollup.minHours
                    ? `Minimum ${rollup.minHours} hrs`
                    : rollup.maxHours
                      ? `Cap of ${rollup.maxHours} hrs`
                      : 'No minimum'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-extrabold text-gray-900">{rollup.hours}</p>
                {rollup.minHours && <p className="text-[11px] font-semibold" style={{ color: rollup.percentOfMin >= 100 ? '#059669' : '#6366f1' }}>{rollup.percentOfMin}% there</p>}
              </div>
            </div>
            {rollup.minHours && <ProgressBar pct={rollup.percentOfMin} accent={rollup.percentOfMin >= 100 ? '#059669' : '#6366f1'} />}
            {rollup.maxHours && (
              <div className="mt-2">
                <ProgressBar
                  pct={Math.min(100, Math.round((rollup.hours / rollup.maxHours) * 100))}
                  accent={rollup.hours >= rollup.maxHours ? '#dc2626' : '#f59e0b'}
                />
              </div>
            )}
            {/* Children */}
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
              {children.map(c => (
                <div key={c.id} className="flex items-center justify-between text-xs">
                  <span className="text-gray-700 leading-tight">{c.label}</span>
                  <span className="text-gray-500 tabular-nums flex items-center gap-2 flex-shrink-0">
                    {c.fromAppointments > 0 && (
                      <span className="text-[10px] uppercase tracking-wide text-emerald-600 font-semibold" title="Auto from appointments">auto</span>
                    )}
                    {c.fromManual > 0 && (
                      <span className="text-[10px] uppercase tracking-wide text-violet-600 font-semibold" title="From manual entries">log</span>
                    )}
                    <span className="font-semibold text-gray-900 w-12 text-right">{c.hours}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Track grid view — Tevera-style spreadsheet: leaf buckets as rows, days
// of the selected week as columns. Each cell shows the hours logged on
// that day for that category (auto from appointments + manual entries
// summed). Header lets the user navigate by week.
// ─────────────────────────────────────────────────────────────────────────────
function TrackGridView() {
  const [weekStart, setWeekStart] = useState(() => sundayOf(new Date()))
  const [grid, setGrid] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const days = useMemo(() => {
    const out = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      out.push(d)
    }
    return out
  }, [weekStart])

  const fromDate = useMemo(() => isoFromDate(days[0]), [days])
  const toDate   = useMemo(() => isoFromDate(days[6]), [days])

  useEffect(() => {
    setLoading(true); setError('')
    apiFetch(`/hours/grid?from=${fromDate}&to=${toDate}`)
      .then(r => r.json())
      .then(data => {
        if (data?.error) { setError(data.error); setGrid(null); return }
        setGrid(data)
      })
      .catch(e => setError(e.message || 'Failed to load grid'))
      .finally(() => setLoading(false))
  }, [fromDate, toDate])

  const goPrev = () => setWeekStart(d => { const n = new Date(d); n.setDate(d.getDate() - 7); return n })
  const goNext = () => setWeekStart(d => { const n = new Date(d); n.setDate(d.getDate() + 7); return n })
  const goToday = () => setWeekStart(sundayOf(new Date()))

  const buckets = grid?.buckets || []
  const leafBuckets = buckets.filter(b => b.kind !== 'rollup')
  const rollups     = buckets.filter(b => b.kind === 'rollup' && b.parent === 'total')

  // Per-day totals across all leaf buckets, for the column footer.
  const dayTotals = useMemo(() => {
    const out = {}
    if (!grid) return out
    for (const day of grid.days) {
      let sum = 0
      for (const b of leafBuckets) {
        sum += (grid.grid?.[b.id]?.[day]) || 0
      }
      out[day] = round2(sum)
    }
    return out
  }, [grid, leafBuckets])

  const weekTotal = useMemo(() => {
    if (!grid) return 0
    return round2(Object.values(dayTotals).reduce((s, v) => s + v, 0))
  }, [grid, dayTotals])

  const fmtDayHeader = d => {
    const w = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
    const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return { w, md, iso: isoFromDate(d) }
  }

  const fmtRange = () => {
    const a = days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const b = days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${a} – ${b}`
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 mr-2">
          <button onClick={goPrev} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 text-gray-500" aria-label="Previous week">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={goNext} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 text-gray-500" aria-label="Next week">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <h3 className="text-sm font-bold text-gray-900">{fmtRange()}</h3>
        <button onClick={goToday} className="ml-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50">This week</button>
        <div className="flex-1" />
        <p className="text-xs text-gray-500">Week total: <span className="font-bold text-gray-900">{weekTotal} hrs</span></p>
      </div>

      {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="card p-12 flex justify-center text-sm text-gray-400">Loading grid…</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-bold text-gray-500 uppercase tracking-wide sticky left-0 bg-gray-50 z-10 min-w-[240px]">Category</th>
                {days.map(d => {
                  const h = fmtDayHeader(d)
                  return (
                    <th key={h.iso} className="px-2 py-2 font-semibold text-gray-700 text-center min-w-[64px]">
                      <div className="text-[10px] text-gray-400">{h.w}</div>
                      <div className="text-[11px]">{h.md}</div>
                    </th>
                  )
                })}
                <th className="px-3 py-2 font-bold text-gray-700 text-right min-w-[60px] bg-gray-100">Row</th>
              </tr>
            </thead>
            <tbody>
              {/* One section per top-level rollup, with its leaf buckets indented */}
              {rollups.map(rollup => {
                const children = leafBuckets.filter(b => {
                  // Walk parent chain to see if this leaf eventually rolls up to `rollup`.
                  let pid = b.parent
                  while (pid && pid !== rollup.id) {
                    const parentNode = buckets.find(x => x.id === pid)
                    if (!parentNode) return false
                    pid = parentNode.parent
                  }
                  return pid === rollup.id
                })
                return (
                  <Fragment key={rollup.id}>
                    <tr className="bg-indigo-50/40 border-b border-indigo-100">
                      <td colSpan={days.length + 2} className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-indigo-700 sticky left-0 bg-indigo-50/40 z-10">
                        {rollup.label}
                        {rollup.minHours ? <span className="ml-2 text-gray-400 normal-case font-normal">min {rollup.minHours}</span> : null}
                        {rollup.maxHours ? <span className="ml-2 text-gray-400 normal-case font-normal">cap {rollup.maxHours}</span> : null}
                      </td>
                    </tr>
                    {children.map(b => {
                      const cells = days.map(d => grid.grid?.[b.id]?.[isoFromDate(d)] || 0)
                      const rowTotal = round2(cells.reduce((s, v) => s + v, 0))
                      return (
                        <tr key={b.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="text-left px-4 py-2 text-gray-800 sticky left-0 bg-white z-10">
                            <span className="pl-3">{b.label}</span>
                          </td>
                          {cells.map((v, i) => (
                            <td key={i} className={`px-2 py-2 text-center tabular-nums ${v > 0 ? 'text-gray-900 font-medium' : 'text-gray-300'}`}>
                              {v > 0 ? v : '·'}
                            </td>
                          ))}
                          <td className={`px-3 py-2 text-right tabular-nums font-semibold ${rowTotal > 0 ? 'text-indigo-700 bg-indigo-50/60' : 'text-gray-300 bg-gray-50'}`}>{rowTotal > 0 ? rowTotal : '·'}</td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
              {/* Day totals footer */}
              <tr className="bg-gray-100 border-t-2 border-gray-300">
                <td className="px-4 py-2 text-left font-bold text-gray-700 uppercase text-[10px] tracking-wider sticky left-0 bg-gray-100 z-10">Day total</td>
                {days.map(d => {
                  const v = dayTotals[isoFromDate(d)] || 0
                  return (
                    <td key={isoFromDate(d)} className={`px-2 py-2 text-center tabular-nums font-bold ${v > 0 ? 'text-indigo-700' : 'text-gray-300'}`}>
                      {v > 0 ? v : '·'}
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-right tabular-nums font-extrabold text-indigo-700 bg-indigo-100">{weekTotal > 0 ? weekTotal : '·'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Sunday of the week containing `d`, normalized to local 00:00:00.
function sundayOf(d) {
  const r = new Date(d)
  r.setDate(r.getDate() - r.getDay())
  r.setHours(0, 0, 0, 0)
  return r
}
function isoFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

// ─────────────────────────────────────────────────────────────────────────────
// Log view — recent manual entries with edit/delete affordances.
// ─────────────────────────────────────────────────────────────────────────────
function LogView({ entries, onEdit, onDelete }) {
  if (entries.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm font-semibold text-gray-700 mb-1">No manual entries yet</p>
        <p className="text-xs text-gray-500">
          Use <span className="font-semibold">Log hours</span> to add supervision, workshops, advocacy calls, and other non-appointment time.
        </p>
      </div>
    )
  }
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-2 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide">Date</th>
            <th className="px-4 py-2 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide">Category</th>
            <th className="px-4 py-2 text-right text-[11px] font-bold text-gray-500 uppercase tracking-wide">Hours</th>
            <th className="px-4 py-2 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide">Supervisor</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-700 text-xs">{fmtDate(e.date)}</td>
              <td className="px-4 py-3 text-gray-900 text-xs font-medium">{prettyBucket(e.bucket_id)}</td>
              <td className="px-4 py-3 text-right tabular-nums font-semibold">{e.hours}</td>
              <td className="px-4 py-3 text-gray-600 text-xs">{e.supervisor || '—'}</td>
              <td className="px-4 py-3 text-right">
                <button onClick={() => onEdit(e)} className="text-xs text-brand-600 hover:underline mr-3">Edit</button>
                <button onClick={() => onDelete(e.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry modal — add/edit a manual hour entry.
// ─────────────────────────────────────────────────────────────────────────────
function EntryModal({ entry, onClose, onSaved }) {
  const isEdit = !!entry?.id
  const [bucketOptions, setBucketOptions] = useState([])
  const [form, setForm] = useState({
    bucket_id:  entry?.bucket_id  || '',
    date:       entry?.date       || todayLocalISO(),
    hours:      entry?.hours != null ? String(entry.hours) : '',
    supervisor: entry?.supervisor || '',
    site:       entry?.site       || '',
    notes:      entry?.notes      || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => {
    apiFetch('/hours/buckets').then(r => r.json()).then(d => {
      const opts = Array.isArray(d?.buckets) ? d.buckets : []
      setBucketOptions(opts)
      if (!form.bucket_id && opts.length > 0) setForm(f => ({ ...f, bucket_id: opts[0].id }))
    }).catch(() => {})
    // eslint-disable-next-line
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    setError('')
    if (!form.bucket_id)              { setError('Pick a category.'); return }
    if (!form.date)                   { setError('Pick a date.'); return }
    const hrs = parseFloat(form.hours)
    if (!Number.isFinite(hrs) || hrs <= 0) { setError('Enter a valid hours amount.'); return }
    setSaving(true)
    try {
      const url = isEdit ? `/hours/entries/${entry.id}` : '/hours/entries'
      const res = await apiFetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify({
          bucket_id:  form.bucket_id,
          date:       form.date,
          hours:      hrs,
          supervisor: form.supervisor || null,
          site:       form.site       || null,
          notes:      form.notes      || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Save failed')
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // Group bucket options by parent for a clearer dropdown.
  const grouped = useMemo(() => {
    const out = {}
    for (const b of bucketOptions) {
      const key = b.parent || 'other'
      if (!out[key]) out[key] = []
      out[key].push(b)
    }
    return out
  }, [bucketOptions])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(6px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">{isEdit ? 'Edit hour entry' : 'Log hours'}</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>}

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Category</label>
            <select
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white"
              value={form.bucket_id}
              onChange={e => set('bucket_id', e.target.value)}
            >
              {Object.entries(grouped).map(([parent, opts]) => (
                <optgroup key={parent} label={parentLabel(parent)}>
                  {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date</label>
              <input
                type="date"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm"
                value={form.date}
                onChange={e => set('date', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Hours</label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                max="24"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm"
                placeholder="1.5"
                value={form.hours}
                onChange={e => set('hours', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Supervisor (optional)</label>
            <input
              type="text"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm"
              placeholder="e.g. Pamela Georgette"
              value={form.supervisor}
              onChange={e => set('supervisor', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Site (optional)</label>
            <input
              type="text"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm"
              placeholder="e.g. CSUN Strength United"
              value={form.site}
              onChange={e => set('site', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes (optional)</label>
            <textarea
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none"
              placeholder="Anything to remember"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
            />
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-60 transition-colors"
          >
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Log entry')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProgressBar({ pct, accent, tall }) {
  return (
    <div className={`w-full ${tall ? 'h-3' : 'h-2'} bg-gray-100 rounded-full overflow-hidden`}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: accent }}
      />
    </div>
  )
}

const PARENT_LABELS = {
  direct_service:        'Direct Service',
  relational:            'Relational',
  advocacy_interactive:  'Interactive Advocacy',
  supervision:           'Supervision',
  live_supervision:      'Live Supervision',
  other:                 'Other Hours',
  total:                 'Other',
}
function parentLabel(parent) { return PARENT_LABELS[parent] || 'Other' }

// Quick label lookup for the log table — keeps each row readable without
// fetching the full bucket structure twice.
const BUCKET_LABELS = {
  individual_adult:                 'Individual Adult Client',
  individual_child:                 'Individual Child Client',
  process_group_individuals:        'Process Group · Individuals',
  couples_therapy:                  'Couples Therapy',
  family_therapy:                   'Family Therapy',
  process_group_couples_families:   'Process Group · Couples/Families',
  advocacy_live_telephonic:         'Advocacy (live/telephonic)',
  sup_case_report:                  'Case Report Supervision',
  sup_field_individual:             'Field Site · Individual Supervision',
  sup_field_group:                  'Field Site · Group Supervision',
  sup_csun_class_group:             'CSUN Fieldwork Class · Group',
  live_sup_field_individual:        'Live · Field Site Individual',
  live_sup_field_group:             'Live · Field Site Group',
  live_sup_csun_class_group:        'Live · CSUN Fieldwork Class',
  other_progress_notes:             'Progress Notes / Reports',
  other_trainings:                  'Trainings & Workshops',
  other_advocacy_research:          'Advocacy (research)',
}
function prettyBucket(id) { return BUCKET_LABELS[id] || id }
