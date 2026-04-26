/**
 * MobileTaskDetail — native view of a single background agent task.
 *
 * Full-screen page with a back header, prompt card, status badge, and
 * result surface that renders clinical markdown. Auto-polls every 5s
 * while the task is queued or running, then stops.
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { renderClinical } from '../../lib/renderClinical'

const STATUS_TONES = {
  queued:   { label: 'Queued',    color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
  running:  { label: 'Running…',  color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  done:     { label: 'Done',      color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
  failed:   { label: 'Failed',    color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  canceled: { label: 'Canceled',  color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
}

function fmtTime(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
  catch { return '' }
}

export default function MobileTaskDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const res = await apiFetch(`/agent/tasks/${id}`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `Failed (${res.status})`)
        }
        const data = await res.json()
        if (mounted) { setTask(data); setError('') }
      } catch (err) {
        if (mounted) setError(err.message)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    const interval = setInterval(() => {
      if (task && ['queued', 'running'].includes(task.status)) load()
    }, 5_000)
    return () => { mounted = false; clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, task?.status])

  const handleCancel = async () => {
    try {
      await apiFetch(`/agent/tasks/${id}/cancel`, { method: 'POST' })
      const res = await apiFetch(`/agent/tasks/${id}`)
      if (res.ok) setTask(await res.json())
    } catch {}
  }

  const tone = STATUS_TONES[task?.status] || STATUS_TONES.queued
  const result = task?.result || task?.output || ''

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100 flex items-center gap-2 px-3 h-12">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center active:bg-gray-100"
          aria-label="Back"
        >
          <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">Background task</p>
          <p className="text-[11px] text-gray-500 truncate">
            {task?.created_at ? `Started ${fmtTime(task.created_at)}` : 'Loading…'}
          </p>
        </div>
        {task?.status && (
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border"
            style={{ color: tone.color, background: tone.bg, borderColor: tone.border }}
          >
            {tone.label}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-6">
        {loading && !task ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-800">
            {error}
          </div>
        ) : task ? (
          <div className="space-y-4">
            {/* Prompt */}
            {task.prompt && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2 px-1">You asked</p>
                <div className="rounded-2xl bg-white border border-gray-100 p-4 text-[14px] text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {task.prompt}
                </div>
              </div>
            )}

            {/* Result */}
            {result && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2 px-1">Result</p>
                <div
                  className="rounded-2xl bg-white border border-gray-100 p-4 text-[14px] text-gray-800 leading-relaxed prose-clinical"
                  dangerouslySetInnerHTML={{ __html: renderClinical(result) }}
                />
              </div>
            )}

            {/* Running indicator */}
            {['queued', 'running'].includes(task.status) && (
              <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4 flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <p className="text-sm text-blue-900 flex-1">
                  Working on it. Pulls in fresh data every 5 seconds — feel free to leave and come back.
                </p>
              </div>
            )}

            {/* Error */}
            {task.error && (
              <div className="rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-900">
                <p className="font-semibold mb-1">This task hit an error</p>
                <p>{task.error}</p>
              </div>
            )}

            {/* Cancel */}
            {['queued', 'running'].includes(task.status) && (
              <button
                onClick={handleCancel}
                className="w-full rounded-xl py-3 text-sm font-semibold text-red-700 border border-red-200 bg-white active:bg-red-50"
              >
                Cancel this task
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
