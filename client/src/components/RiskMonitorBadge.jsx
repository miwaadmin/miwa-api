import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/api'

/**
 * RiskMonitorBadge
 *
 * Non-blocking, inline risk-language watcher for the session-note editor.
 * Debounces keystrokes, calls /api/ai/risk-scan, and surfaces a clinical
 * nudge when risk content is detected AND the corresponding screener isn't
 * already documented for this patient.
 *
 * Props:
 *   text       — concatenated note text being monitored
 *   patientId  — enables screener-coverage lookup
 *   signed     — when true, the component is inert (no scanning, no badges)
 *
 * Design notes:
 *   - Debounce: 2s idle after last change (avoids scanning on every keystroke)
 *   - Minimum text length: 50 chars (short drafts aren't worth scanning)
 *   - Dismissals are session-local only — they don't persist across notes
 *   - The server already handles "covered" screeners; we just display what
 *     comes back. Everything returned has `covered: false` and should show.
 */

const DEBOUNCE_MS = 2000
const MIN_TEXT_LENGTH = 50

export default function RiskMonitorBadge({ text, patientId, signed }) {
  const [risks, setRisks] = useState([])
  const [dismissed, setDismissed] = useState(new Set())
  const [scanning, setScanning] = useState(false)
  const [lastScanLen, setLastScanLen] = useState(0)

  const timerRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    // Don't scan signed notes — nothing the therapist can do about a flag
    // on a locked record.
    if (signed) return

    if (!text || text.length < MIN_TEXT_LENGTH) {
      setRisks([])
      return
    }

    // Skip if text hasn't grown meaningfully since last scan (avoid redundant
    // scans on formatting tweaks or whitespace changes).
    if (Math.abs(text.length - lastScanLen) < 20 && lastScanLen > 0) return

    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      // Cancel any in-flight scan
      if (abortRef.current) abortRef.current.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl

      setScanning(true)
      try {
        const r = await apiFetch('/ai/risk-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, patient_id: patientId }),
          signal: ctrl.signal,
        })
        if (!r.ok) throw new Error('scan failed')
        const data = await r.json()
        if (ctrl.signal.aborted) return
        setRisks(Array.isArray(data.risks) ? data.risks : [])
        setLastScanLen(text.length)
      } catch (err) {
        if (err.name !== 'AbortError') {
          // Silent — non-blocking. Therapist should not see errors for this.
        }
      } finally {
        if (!ctrl.signal.aborted) setScanning(false)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, patientId, signed])

  useEffect(() => () => {
    // Cleanup on unmount
    clearTimeout(timerRef.current)
    if (abortRef.current) abortRef.current.abort()
  }, [])

  const activeRisks = risks.filter(r => !dismissed.has(r.id))

  if (signed) return null
  if (activeRisks.length === 0 && !scanning) return null

  return (
    <div className="space-y-2">
      {scanning && activeRisks.length === 0 && (
        <div className="text-[11px] text-gray-400 italic flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-gray-300 animate-pulse" />
          Watching for risk language…
        </div>
      )}

      {activeRisks.map(risk => (
        <div
          key={risk.id}
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2.5"
          role="alert"
        >
          <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-amber-900 uppercase tracking-wider mb-0.5">
              {risk.label}
            </p>
            <p className="text-[12px] text-amber-900 leading-relaxed">
              {risk.nudge}
            </p>
            {risk.snippet && (
              <p className="text-[10px] text-amber-700/80 italic mt-1 truncate">
                "…{risk.snippet}…"
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setDismissed(prev => new Set(prev).add(risk.id))}
            className="flex-shrink-0 text-[10px] font-semibold text-amber-700 hover:text-amber-900 px-1.5 py-0.5 rounded hover:bg-amber-100"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
