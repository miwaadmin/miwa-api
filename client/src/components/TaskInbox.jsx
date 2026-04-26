import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import { renderClinical } from '../lib/renderClinical'

// SSE only works with cookie auth, not with the Bearer-token flow Capacitor
// native uses. On native we fall back to 10-second polling.
function isCapacitorNative() {
  try { return !!(window.Capacitor?.isNativePlatform?.()) } catch { return false }
}

/**
 * TaskInbox — floating badge + dropdown showing background agent tasks.
 *
 * Subscribes to /api/agent/tasks/stream (SSE) for live updates, with a
 * poll fallback if the stream drops. Three zones in the dropdown:
 *   1. Active  — queued / running
 *   2. Unread  — done / failed / needs_input AND read_at IS NULL
 *   3. History — recent closed-and-read tasks (last 10)
 *
 * Clicking a task expands its result inline. Clicking "View full" opens a
 * modal with the tool-call log + full markdown result.
 */

function formatTimeAgo(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function StatusChip({ status }) {
  const map = {
    queued:      { label: 'Queued', cls: 'bg-gray-100 text-gray-600' },
    running:     { label: 'Working…', cls: 'bg-brand-50 text-brand-600 animate-pulse' },
    done:        { label: 'Done', cls: 'bg-emerald-50 text-emerald-700' },
    failed:      { label: 'Failed', cls: 'bg-red-50 text-red-700' },
    cancelled:   { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500' },
    needs_input: { label: 'Needs input', cls: 'bg-amber-50 text-amber-700' },
  }
  const s = map[status] || { label: status, cls: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${s.cls}`}>
      {s.label}
    </span>
  )
}

function TaskRow({ task, expanded, onToggle, onCancel, onRead, onOpenDetail }) {
  const isTerminal = ['done', 'failed', 'cancelled', 'needs_input'].includes(task.status)
  const unread = isTerminal && !task.read_at
  return (
    <div
      className={`px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors ${unread ? 'bg-brand-50/30' : ''}`}
    >
      <div className="flex items-start gap-2 cursor-pointer" onClick={() => {
        onToggle(task.id)
        if (unread) onRead(task.id)
      }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {unread && <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0" />}
            <span className="text-sm font-semibold text-gray-900 truncate">{task.title}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <StatusChip status={task.status} />
            <span>•</span>
            <span>{formatTimeAgo(task.created_at)}</span>
            {task.iterations > 0 && (
              <>
                <span>•</span>
                <span>{task.iterations} step{task.iterations === 1 ? '' : 's'}</span>
              </>
            )}
          </div>
        </div>
        <button
          className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          {/* Prompt preview */}
          <div className="text-xs text-gray-500 italic line-clamp-2">
            “{task.prompt}”
          </div>

          {/* Result or error */}
          {task.status === 'done' && task.result_text && (
            <div
              className="prose-clinical text-sm max-h-48 overflow-y-auto rounded-lg bg-white border border-gray-200 p-3"
              dangerouslySetInnerHTML={{ __html: renderClinical(task.result_text) }}
            />
          )}
          {task.status === 'failed' && task.error_message && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
              {task.error_message}
            </div>
          )}
          {task.status === 'needs_input' && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              This task needs your input to finish. Open it in chat to continue.
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {(task.status === 'queued' || task.status === 'running') && (
              <button
                onClick={() => onCancel(task.id)}
                className="text-xs text-red-600 hover:text-red-700 font-semibold"
              >
                Cancel
              </button>
            )}
            {(task.status === 'done' || task.status === 'failed' || task.status === 'needs_input') && (
              <button
                onClick={() => onOpenDetail(task.id)}
                className="text-xs text-brand-600 hover:text-brand-700 font-semibold"
              >
                View full result →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function TaskInbox({ onOpenDetail }) {
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState([])
  const [counts, setCounts] = useState({ unread: 0, active: 0 })
  const [expanded, setExpanded] = useState(null)
  const esRef = useRef(null)
  const mountedRef = useRef(true)

  const fetchTasks = useCallback(async () => {
    try {
      const res = await apiFetch('/agent/tasks?limit=25')
      if (!res.ok) return
      const data = await res.json()
      if (mountedRef.current) setTasks(data.tasks || [])
    } catch { /* silent */ }
  }, [])

  const fetchCounts = useCallback(async () => {
    try {
      const res = await apiFetch('/agent/tasks/unread-count')
      if (!res.ok) return
      const data = await res.json()
      if (mountedRef.current) setCounts({ unread: data.unread || 0, active: data.active || 0 })
    } catch { /* silent */ }
  }, [])

  // Subscribe to SSE. Falls back to polling if SSE fails.
  useEffect(() => {
    mountedRef.current = true
    fetchCounts()
    fetchTasks()

    let pollInterval = null
    const startPolling = () => {
      if (pollInterval) return
      pollInterval = setInterval(() => {
        fetchCounts()
        if (open) fetchTasks()
      }, 10_000)
    }

    // Skip SSE on native: EventSource can't attach the Bearer header the
    // native app uses for auth, so polling is the only option there.
    if (isCapacitorNative()) {
      startPolling()
      return () => {
        mountedRef.current = false
        if (pollInterval) clearInterval(pollInterval)
      }
    }

    try {
      // Web: same-origin cookie auth works with EventSource.
      const es = new EventSource('/api/agent/tasks/stream', { withCredentials: true })
      esRef.current = es

      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'task_update') {
            // Apply the task update to our local list
            setTasks(prev => {
              const idx = prev.findIndex(t => t.id === msg.task.id)
              if (idx < 0) {
                // Task unknown — refetch full list to pick up the new row
                fetchTasks()
                return prev
              }
              const next = [...prev]
              next[idx] = { ...next[idx], ...msg.task }
              return next
            })
            fetchCounts()
            maybeNotifyCompletion(msg.task)
          } else if (msg.type === 'connected') {
            setCounts({ unread: msg.unread || 0, active: msg.active || 0 })
          }
        } catch { /* malformed event */ }
      }

      es.onerror = () => {
        // Browser will auto-reconnect; also start a polling fallback in case
        // the stream stays down.
        startPolling()
      }
    } catch {
      startPolling()
    }

    return () => {
      mountedRef.current = false
      if (esRef.current) esRef.current.close()
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [fetchCounts, fetchTasks, open])

  // Browser notification on task completion — if permission granted.
  const lastNotifiedRef = useRef(new Set())
  function maybeNotifyCompletion(task) {
    if (!['done', 'failed', 'needs_input'].includes(task.status)) return
    if (lastNotifiedRef.current.has(task.id)) return
    lastNotifiedRef.current.add(task.id)
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const verb = task.status === 'done' ? 'finished' : task.status === 'failed' ? 'failed' : 'needs input'
        const n = new Notification(`Miwa task ${verb}`, {
          body: task.title,
          icon: '/icons/icon-192.png',
          tag: `miwa-task-${task.id}`,
        })
        n.onclick = () => {
          window.focus()
          setOpen(true)
          n.close()
        }
      }
    } catch { /* notifications disabled */ }
  }

  // Request notification permission the first time the inbox is opened.
  useEffect(() => {
    if (open && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { Notification.requestPermission() } catch {}
    }
    if (open) fetchTasks()
  }, [open, fetchTasks])

  const handleCancel = async (id) => {
    try {
      await apiFetch(`/agent/tasks/${id}/cancel`, { method: 'POST' })
      fetchTasks()
      fetchCounts()
    } catch {}
  }

  const handleRead = async (id) => {
    try {
      await apiFetch(`/agent/tasks/${id}/read`, { method: 'POST' })
      fetchCounts()
    } catch {}
  }

  const handleReadAll = async () => {
    try {
      await apiFetch('/agent/tasks/read-all', { method: 'POST' })
      fetchTasks()
      fetchCounts()
    } catch {}
  }

  const active = tasks.filter(t => t.status === 'queued' || t.status === 'running')
  const unreadTerminal = tasks.filter(t => ['done','failed','needs_input'].includes(t.status) && !t.read_at)
  const history = tasks.filter(t => t.read_at || t.status === 'cancelled').slice(0, 10)

  const badgeNumber = counts.unread + counts.active

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${counts.active > 0 ? 'text-brand-600 bg-brand-50' : 'text-gray-500 hover:text-brand-600 hover:bg-brand-50'}`}
        title={
          counts.active > 0
            ? `${counts.active} task${counts.active !== 1 ? 's' : ''} running`
            : counts.unread > 0
              ? `${counts.unread} finished task${counts.unread !== 1 ? 's' : ''}`
              : 'Background tasks'
        }
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
        {badgeNumber > 0 && (
          <span className={`absolute top-0 right-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${counts.active > 0 ? 'bg-brand-500 text-white' : 'bg-emerald-500 text-white'}`}>
            {Math.min(badgeNumber, 99)}
          </span>
        )}
        {counts.active > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-[18px] h-[18px] rounded-full animate-ping bg-brand-400 opacity-50" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-[380px] max-h-[520px] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Tasks</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {counts.active === 0 && counts.unread === 0
                    ? 'No background tasks yet'
                    : `${counts.active} active · ${counts.unread} unread`}
                </p>
              </div>
              {counts.unread > 0 && (
                <button
                  onClick={handleReadAll}
                  className="text-xs text-brand-600 hover:text-brand-700 font-semibold"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="overflow-y-auto flex-1">
              {tasks.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-gray-500">
                  <p className="mb-2">🕊️ No tasks yet</p>
                  <p className="text-xs">
                    Type a question in Miwa chat and click <strong>Run in background</strong> to delegate work.
                  </p>
                </div>
              ) : (
                <>
                  {active.length > 0 && (
                    <>
                      <SectionHeader label="Active" />
                      {active.map(t => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          expanded={expanded === t.id}
                          onToggle={id => setExpanded(expanded === id ? null : id)}
                          onCancel={handleCancel}
                          onRead={handleRead}
                          onOpenDetail={onOpenDetail}
                        />
                      ))}
                    </>
                  )}
                  {unreadTerminal.length > 0 && (
                    <>
                      <SectionHeader label="Ready for you" />
                      {unreadTerminal.map(t => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          expanded={expanded === t.id}
                          onToggle={id => setExpanded(expanded === id ? null : id)}
                          onCancel={handleCancel}
                          onRead={handleRead}
                          onOpenDetail={onOpenDetail}
                        />
                      ))}
                    </>
                  )}
                  {history.length > 0 && (
                    <>
                      <SectionHeader label="Recent" />
                      {history.map(t => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          expanded={expanded === t.id}
                          onToggle={id => setExpanded(expanded === id ? null : id)}
                          onCancel={handleCancel}
                          onRead={handleRead}
                          onOpenDetail={onOpenDetail}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SectionHeader({ label }) {
  return (
    <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] font-bold uppercase tracking-widest text-gray-500">
      {label}
    </div>
  )
}
