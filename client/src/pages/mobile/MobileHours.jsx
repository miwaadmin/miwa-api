/**
 * MobileHours -- compact practice-hour tracking for the native mobile shell.
 * The desktop Hours page has a wide grid; this screen keeps the phone view
 * focused on totals, gaps, and quick manual entry.
 */
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'

const todayIso = () => new Date().toISOString().slice(0, 10)

function collectBuckets(node, list = []) {
  if (!node) return list
  if (Array.isArray(node)) {
    node.forEach(item => collectBuckets(item, list))
    return list
  }
  if (typeof node === 'object') {
    if (node.id && (node.label || node.name)) {
      list.push({
        id: node.id,
        label: node.label || node.name,
        hours: Number(node.hours || node.total || node.completed || 0),
        required: Number(node.required || node.minimum || node.min || 0),
      })
    }
    Object.values(node).forEach(value => {
      if (value && typeof value === 'object') collectBuckets(value, list)
    })
  }
  return list
}

function pct(value, target) {
  if (!target) return 0
  return Math.min(100, Math.round((Number(value || 0) / Number(target)) * 100))
}

export default function MobileHours() {
  const [state, setState] = useState(null)
  const [buckets, setBuckets] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    bucket_id: '',
    date: todayIso(),
    hours: '1',
    notes: '',
  })

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [hoursRes, bucketsRes, entriesRes] = await Promise.all([
        apiFetch('/hours'),
        apiFetch('/hours/buckets'),
        apiFetch('/hours/entries'),
      ])
      const hoursData = await hoursRes.json().catch(() => ({}))
      if (!hoursRes.ok) throw new Error(hoursData.error || 'Could not load hours.')
      const bucketsData = await bucketsRes.json().catch(() => ({}))
      const entriesData = await entriesRes.json().catch(() => ({}))
      const nextBuckets = Array.isArray(bucketsData.buckets) ? bucketsData.buckets : []
      setState(hoursData)
      setBuckets(nextBuckets)
      setEntries(Array.isArray(entriesData.entries) ? entriesData.entries : [])
      setForm(prev => ({ ...prev, bucket_id: prev.bucket_id || nextBuckets[0]?.id || '' }))
    } catch (err) {
      setError(err.message || 'Could not load hours.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const summary = useMemo(() => {
    if (!state) return { total: 0, required: 0, buckets: [] }
    const total = Number(state.total_hours || state.total || state.hours || 0)
    const required = Number(state.required_hours || state.required || state.target_hours || 0)
    const bucketRows = collectBuckets(state)
      .filter((item, index, arr) => item.id && arr.findIndex(x => x.id === item.id) === index)
      .slice(0, 8)
    return { total, required, buckets: bucketRows }
  }, [state])

  const saveEntry = async () => {
    if (!form.bucket_id || !form.date || !form.hours) {
      setError('Choose a category, date, and hours.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/hours/entries', {
        method: 'POST',
        body: JSON.stringify({
          bucket_id: form.bucket_id,
          date: form.date,
          hours: Number(form.hours),
          notes: form.notes || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save hours.')
      setForm(prev => ({ ...prev, hours: '1', notes: '' }))
      await load()
    } catch (err) {
      setError(err.message || 'Could not save hours.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    )
  }

  if (error && !state) {
    return (
      <div className="mobile-native-page p-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-native-page space-y-4 p-4 pb-28">
      <section className="mobile-card p-4">
        <p className="mobile-kicker">Hours</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Practice hour tracking</h1>
        <p className="mt-1 text-sm text-gray-500">Keep the phone view focused on what changed and what needs logging.</p>
      </section>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="mobile-card p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="mobile-kicker">Logged</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">{summary.total.toFixed(1)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Target</p>
            <p className="text-xl font-bold text-gray-700">{summary.required ? summary.required.toFixed(0) : '--'}</p>
          </div>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-brand-600"
            style={{ width: `${pct(summary.total, summary.required)}%` }}
          />
        </div>
        {state?.uncountedScheduled > 0 && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            {state.uncountedScheduled} past scheduled appointment{state.uncountedScheduled === 1 ? '' : 's'} need completion before they count.
          </p>
        )}
      </section>

      <section className="mobile-card p-4">
        <p className="mobile-kicker mb-3">Quick log</p>
        <div className="space-y-3">
          <select
            value={form.bucket_id}
            onChange={e => setForm(f => ({ ...f, bucket_id: e.target.value }))}
            className="mobile-input"
          >
            {buckets.map(bucket => (
              <option key={bucket.id} value={bucket.id}>{bucket.label || bucket.name || bucket.id}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="date"
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="mobile-input"
            />
            <input
              type="number"
              min="0.25"
              max="24"
              step="0.25"
              value={form.hours}
              onChange={e => setForm(f => ({ ...f, hours: e.target.value }))}
              className="mobile-input"
            />
          </div>
          <textarea
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Notes, supervisor, site..."
            rows={3}
            className="mobile-input resize-none"
          />
          <button
            type="button"
            onClick={saveEntry}
            disabled={saving}
            className="mobile-primary-button"
          >
            {saving ? 'Saving...' : 'Log hours'}
          </button>
        </div>
      </section>

      {summary.buckets.length > 0 && (
        <section className="mobile-card p-4">
          <p className="mobile-kicker mb-3">Top categories</p>
          <div className="space-y-3">
            {summary.buckets.map(bucket => (
              <div key={bucket.id}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-gray-800">{bucket.label}</p>
                  <p className="shrink-0 text-xs font-bold text-gray-500">{bucket.hours.toFixed(1)}</p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-teal-500" style={{ width: `${bucket.required ? pct(bucket.hours, bucket.required) : Math.min(100, bucket.hours * 8)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mobile-card p-4">
        <p className="mobile-kicker mb-3">Recent entries</p>
        {entries.length ? (
          <div className="divide-y divide-gray-100">
            {entries.slice(0, 8).map(entry => (
              <div key={entry.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-semibold text-gray-900">{entry.bucket_id}</p>
                  <p className="text-sm font-bold text-gray-700">{Number(entry.hours || 0).toFixed(1)}h</p>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{entry.date}{entry.notes ? ` - ${entry.notes}` : ''}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">No manual hours logged yet.</p>
        )}
      </section>
    </div>
  )
}
