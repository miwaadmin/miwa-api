import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { renderClinical } from '../lib/renderClinical'

/**
 * /tasks/:id — full-page view of a single background agent task.
 * Shows the prompt, timing, full tool-call log, and the complete result.
 */
export default function TaskDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await apiFetch(`/agent/tasks/${id}`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `Failed to load task (${res.status})`)
        }
        const data = await res.json()
        if (mounted) setTask(data)
      } catch (err) {
        if (mounted) setError(err.message)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    // Auto-refresh every 5s if task is still running
    const interval = setInterval(() => {
      if (task && ['queued', 'running'].includes(task.status)) load()
    }, 5_000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [id, task?.status])

  const handleCancel = async () => {
    try {
      await apiFetch(`/agent/tasks/${id}/cancel`, { method: 'POST' })
      // Re-fetch
      const res = await apiFetch(`/agent/tasks/${id}`)
      if (res.ok) setTask(await res.json())
    } catch {}
  }

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 text-gray-500 text-sm">
          <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          Loading task…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <button onClick={() => navigate(-1)} className="text-sm text-brand-600 mb-4">← Back</button>
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>
      </div>
    )
  }

  if (!task) return null

  const toolCalls = Array.isArray(task.tool_calls) ? task.tool_calls : []
  const isRunning = task.status === 'queued' || task.status === 'running'

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <button onClick={() => navigate(-1)} className="text-sm text-brand-600 mb-4 hover:underline">← Back</button>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900 mb-2">{task.title}</h1>
            <StatusRow task={task} />
          </div>
          {isRunning && (
            <button
              onClick={handleCancel}
              className="text-sm text-red-600 hover:text-red-700 font-semibold"
            >
              Cancel task
            </button>
          )}
        </div>

        {/* Prompt */}
        <div className="mb-4">
          <div className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">Your prompt</div>
          <div className="text-sm text-gray-700 italic bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">
            {task.prompt}
          </div>
        </div>

        {/* Result */}
        {task.status === 'done' && task.result_text && (
          <div className="mb-4">
            <div className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">Result</div>
            <div
              className="prose-clinical text-sm rounded-lg border border-gray-200 p-4"
              dangerouslySetInnerHTML={{ __html: renderClinical(task.result_text) }}
            />
          </div>
        )}

        {task.status === 'failed' && task.error_message && (
          <div className="mb-4">
            <div className="text-[11px] font-bold uppercase tracking-widest text-red-600 mb-1.5">Error</div>
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 whitespace-pre-wrap">
              {task.error_message}
            </div>
          </div>
        )}

        {task.status === 'needs_input' && (
          <div className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Miwa hit a step that needs your approval (e.g., sending a message or scheduling).
            Open Miwa chat to finish this task interactively.
          </div>
        )}

        {isRunning && (
          <div className="mb-4 flex items-center gap-2 text-sm text-brand-600">
            <div className="w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            Working — {task.iterations} step{task.iterations === 1 ? '' : 's'} so far.
          </div>
        )}
      </div>

      {/* Tool call log */}
      {toolCalls.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Tool calls ({toolCalls.length})</h2>
          <div className="space-y-2">
            {toolCalls.map((tc, i) => (
              <details key={i} className="text-xs bg-gray-50 rounded-lg p-2">
                <summary className="cursor-pointer font-semibold text-gray-800">
                  <span className="inline-block w-6 text-gray-500">#{i + 1}</span> {tc.tool}
                  {tc.needs_input && <span className="ml-2 text-amber-700">(halted — needs input)</span>}
                </summary>
                <div className="mt-2 space-y-1">
                  <div>
                    <span className="text-gray-500">Input:</span>
                    <pre className="bg-white rounded p-1.5 mt-0.5 text-[11px] overflow-x-auto">{JSON.stringify(tc.input, null, 2)}</pre>
                  </div>
                  <div>
                    <span className="text-gray-500">Result:</span>
                    <pre className="bg-white rounded p-1.5 mt-0.5 text-[11px] overflow-x-auto">{JSON.stringify(tc.result, null, 2)}</pre>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusRow({ task }) {
  const chip = {
    queued:      'bg-gray-100 text-gray-600',
    running:     'bg-brand-50 text-brand-600',
    done:        'bg-emerald-50 text-emerald-700',
    failed:      'bg-red-50 text-red-700',
    cancelled:   'bg-gray-100 text-gray-500',
    needs_input: 'bg-amber-50 text-amber-700',
  }[task.status] || 'bg-gray-100 text-gray-600'

  const dur = task.completed_at && task.started_at
    ? `${Math.max(1, Math.round((new Date(task.completed_at) - new Date(task.started_at)) / 1000))}s`
    : null

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <span className={`font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${chip}`}>
        {task.status.replace('_', ' ')}
      </span>
      <span>•</span>
      <span>{new Date(task.created_at).toLocaleString()}</span>
      {dur && (
        <>
          <span>•</span>
          <span>ran for {dur}</span>
        </>
      )}
      {task.iterations > 0 && (
        <>
          <span>•</span>
          <span>{task.iterations} step{task.iterations === 1 ? '' : 's'}</span>
        </>
      )}
    </div>
  )
}
