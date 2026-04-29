/**
 * HoursWidget — compact dashboard summary for trainees and associates.
 *
 * Renders nothing for licensed clinicians. For everyone else, it fetches
 * the current hour-tracking state (using whichever program the user last
 * picked on the Hours page) and shows the top-level total + the direct
 * service progress in a single horizontal card. Click-through goes to
 * the full Hours page.
 */
import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { mergeBucketTotals, getProgramLabel } from '../lib/hourBuckets'

export default function HoursWidget() {
  const { therapist } = useAuth()
  const cred = therapist?.credential_type || 'licensed'
  const eligible = cred === 'trainee' || cred === 'associate'

  // Pick up the same program the user last selected on the Hours page.
  const program = useMemo(() => {
    try { return localStorage.getItem('miwa.hours.program') || 'csun_mft' }
    catch { return 'csun_mft' }
  }, [])

  const [apiBuckets, setApiBuckets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!eligible) return
    let cancelled = false
    apiFetch(`/hours?program=${encodeURIComponent(program)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const arr = Array.isArray(data?.buckets) ? data.buckets : []
        setApiBuckets(arr)
      })
      .catch(() => { /* swallow — widget will render zeroes from skeleton */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [eligible, program])

  if (!eligible) return null

  // Always render once the auth gate passes — even with zeroes. Suppressing
  // on "no data" makes the widget invisible the first time a trainee opens
  // their account, which defeats its purpose as a wayfinding signpost.
  const buckets = mergeBucketTotals(program, apiBuckets)
  const total   = buckets.find(b => b.id === 'total')
  const direct  = buckets.find(b => b.kind === 'rollup' && b.parent === 'total' && /direct/i.test(b.label || ''))
  if (!total) return null

  const totalPct  = total.percentOfMin || 0
  const directPct = direct?.percentOfMin || 0

  return (
    <Link
      to="/hours"
      className="group block rounded-2xl border border-gray-200 bg-white p-4 hover:border-brand-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-fuchsia-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-fuchsia-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Practicum hours</p>
            <p className="text-[11px] text-gray-500">{getProgramLabel(program)}{loading ? ' · loading…' : ''}</p>
          </div>
        </div>
        <span className="text-xs text-brand-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">View →</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Mini label={total.label} hours={total.hours} target={total.minHours} pct={totalPct} accent="#9333ea" />
        {direct && <Mini label={direct.label} hours={direct.hours} target={direct.minHours} pct={directPct} accent="#0d9488" />}
      </div>
    </Link>
  )
}

function Mini({ label, hours, target, pct, accent }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-[11px] uppercase tracking-wide font-bold text-gray-500 truncate">{label}</p>
        <p className="text-[11px] font-semibold text-gray-400 ml-2 tabular-nums">{pct}%</p>
      </div>
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-xl font-extrabold text-gray-900 tabular-nums">{hours}</span>
        {target ? <span className="text-[11px] text-gray-400">/ {target}</span> : null}
      </div>
      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: accent }}
        />
      </div>
    </div>
  )
}
