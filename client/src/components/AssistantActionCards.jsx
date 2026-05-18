import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { normalizeAssistantAction } from '../lib/assistantActions'

function StatusLine({ action }) {
  const map = {
    loading: 'Preparing this view...',
    empty: 'No matching clinical data found.',
    error: action.summary || 'This action could not be prepared.',
    needs_permission: 'You need permission to use this action.',
    completed: 'Completed.',
  }
  if (!map[action.status]) return null
  const tone = action.status === 'error' ? 'text-red-700 bg-red-50 border-red-100' : 'text-gray-600 bg-gray-50 border-gray-100'
  return <div className={`mt-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${tone}`}>{map[action.status]}</div>
}

function ActionButton({ children, onClick, variant = 'primary', disabled = false }) {
  const styles = variant === 'primary'
    ? 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300'
    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:text-gray-400'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${styles}`}
    >
      {children}
    </button>
  )
}

function CardShell({ action, accent, children }) {
  return (
    <div className="flex justify-start">
      <div className="w-[88%] max-w-[340px] rounded-2xl border bg-white shadow-sm overflow-hidden" style={{ borderColor: accent }}>
        <div className="px-3 py-2 border-b border-gray-100">
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Clinical action</div>
          <div className="text-sm font-semibold text-gray-900 leading-tight">{action.title}</div>
          {action.summary && <div className="mt-0.5 text-xs text-gray-500 leading-snug">{action.summary}</div>}
          <StatusLine action={action} />
        </div>
        {children}
      </div>
    </div>
  )
}

function go(path) {
  if (!path) return
  const onMobile = window.location.pathname.startsWith('/m')
  if (onMobile && path === '/schedule') {
    window.location.href = '/m/schedule'
    return
  }
  if (onMobile && path.startsWith('/patients/')) {
    window.location.href = path.replace('/patients/', '/m/clients/')
    return
  }
  window.location.href = path
}

function ShowClientCard({ action }) {
  const p = action.payload
  return (
    <CardShell action={action} accent="#bbf7d0">
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-gray-700">{p.displayName || p.clientName || 'Client'}</span>
          {p.clientId && <span className="font-mono text-[10px] text-gray-500">{p.clientId}</span>}
        </div>
        <div className="flex gap-2">
          <ActionButton onClick={() => go(`/patients/${p.patientId || p.id}`)} disabled={!p.patientId && !p.id}>Open chart</ActionButton>
          <ActionButton variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent('miwa-chat-prompt', { detail: { text: `Prepare for ${p.displayName || p.clientId}`, send: true } }))}>Prepare</ActionButton>
        </div>
      </div>
    </CardShell>
  )
}

function SchedulePickerCard({ action, onConfirmAction }) {
  const p = action.payload
  const start = p.scheduledStart ? new Date(p.scheduledStart).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time not set'
  return (
    <CardShell action={action} accent="#c7d2fe">
      <div className="px-3 py-2.5 space-y-2">
        <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-2.5 py-2 text-xs text-indigo-950">
          <div className="font-semibold">{p.clientName || p.clientId || 'Client'} · {p.appointmentType || 'session'}</div>
          <div className="mt-0.5 text-indigo-700">{start}{p.durationMinutes ? ` · ${p.durationMinutes} min` : ''}</div>
          {p.location && <div className="mt-0.5 text-indigo-700">{p.location}</div>}
        </div>
        <div className="flex gap-2">
          <ActionButton onClick={() => onConfirmAction?.(action)}>Confirm</ActionButton>
          <ActionButton variant="secondary" onClick={() => go('/schedule')}>Calendar</ActionButton>
        </div>
      </div>
    </CardShell>
  )
}

function RiskReviewCard({ action }) {
  const assessments = Array.isArray(action.payload.assessments) ? action.payload.assessments : []
  const latest = assessments[assessments.length - 1]
  return (
    <CardShell action={action} accent="#fed7aa">
      <div className="px-3 py-2.5 space-y-2">
        {latest ? (
          <div className="rounded-xl bg-orange-50 border border-orange-100 px-2.5 py-2 text-xs">
            <div className="font-semibold text-orange-950">{latest.type || 'Assessment'} · {latest.score ?? 'n/a'}{latest.severity ? ` · ${latest.severity}` : ''}</div>
            <div className="mt-0.5 text-orange-700">{latest.date || 'No date'}{latest.deteriorated ? ' · Deterioration flagged' : latest.improved ? ' · Improvement flagged' : ''}</div>
          </div>
        ) : (
          <div className="text-xs text-gray-500">No recent scores are available.</div>
        )}
        <div className="flex gap-2">
          <ActionButton onClick={() => window.dispatchEvent(new CustomEvent('miwa-chat-prompt', { detail: { text: `Create a risk review follow-up for ${action.payload.clientName || action.payload.clientId}`, send: false } }))}>Draft follow-up</ActionButton>
          <ActionButton variant="secondary" onClick={() => go(`/patients/${action.payload.patientId}`)} disabled={!action.payload.patientId}>Open chart</ActionButton>
        </div>
      </div>
    </CardShell>
  )
}

function AssessmentBatchCard({ action }) {
  const clients = Array.isArray(action.payload.patients) ? action.payload.patients : []
  return (
    <CardShell action={action} accent="#ddd6fe">
      <div className="px-3 py-2.5 space-y-2">
        <div className="text-xs text-gray-600">{clients.length} client{clients.length === 1 ? '' : 's'} matched for {action.payload.assessmentType || 'assessment'}.</div>
        <div className="max-h-24 overflow-y-auto rounded-xl border border-violet-100 bg-violet-50/60">
          {clients.slice(0, 6).map(client => (
            <div key={client.id || client.clientId} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs border-b border-violet-100 last:border-0">
              <span className="truncate text-gray-800">{client.name || client.displayName || client.clientId}</span>
              <span className="font-mono text-[10px] text-gray-500">{client.clientId}</span>
            </div>
          ))}
        </div>
        <div className="text-[11px] text-gray-500">Use the picker below to confirm recipients.</div>
      </div>
    </CardShell>
  )
}

function FollowUpTaskCard({ action }) {
  const [status, setStatus] = useState(action.status)
  const [message, setMessage] = useState('')
  const p = action.payload

  const createTask = async () => {
    setStatus('loading')
    setMessage('')
    try {
      const res = await apiFetch('/assistant/actions/follow-up-task', {
        method: 'POST',
        body: JSON.stringify({
          description: p.description || action.summary || action.title,
          scheduledFor: p.scheduledFor,
          clientId: p.clientId,
          taskType: p.taskType || 'follow_up',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not create follow-up')
      setStatus('completed')
      setMessage('Follow-up added.')
    } catch (err) {
      setStatus('error')
      setMessage(err.message)
    }
  }

  return (
    <CardShell action={{ ...action, status, summary: message || action.summary }} accent="#99f6e4">
      <div className="px-3 py-2.5 space-y-2">
        <div className="text-xs text-gray-700">{p.description || 'Create a follow-up task'}</div>
        {p.scheduledFor && <div className="text-[11px] text-gray-500">{new Date(p.scheduledFor).toLocaleString()}</div>}
        <ActionButton onClick={createTask} disabled={status === 'loading' || status === 'completed'}>
          {status === 'completed' ? 'Added' : 'Add follow-up'}
        </ActionButton>
      </div>
    </CardShell>
  )
}

function PrepareSessionCard({ action }) {
  const focus = Array.isArray(action.payload.focusAreas) ? action.payload.focusAreas : []
  return (
    <CardShell action={action} accent="#bae6fd">
      <div className="px-3 py-2.5 space-y-2">
        {focus.length > 0 ? (
          <div className="space-y-1">
            {focus.slice(0, 4).map(item => <div key={item} className="rounded-lg bg-sky-50 border border-sky-100 px-2 py-1.5 text-xs text-sky-950">{item}</div>)}
          </div>
        ) : (
          <div className="text-xs text-gray-500">Brief is ready to review.</div>
        )}
        <ActionButton variant="secondary" onClick={() => go('/schedule')}>Open schedule</ActionButton>
      </div>
    </CardShell>
  )
}

export default function AssistantActionCard({ action, onConfirmAction }) {
  const normalized = normalizeAssistantAction(action)
  if (normalized.kind === 'show_client' || normalized.kind === 'open_case') return <ShowClientCard action={normalized} />
  if (normalized.kind === 'schedule_picker') return <SchedulePickerCard action={normalized} onConfirmAction={onConfirmAction} />
  if (normalized.kind === 'risk_review') return <RiskReviewCard action={normalized} />
  if (normalized.kind === 'assessment_batch_preview') return <AssessmentBatchCard action={normalized} />
  if (normalized.kind === 'create_follow_up_task') return <FollowUpTaskCard action={normalized} />
  if (normalized.kind === 'prepare_session') return <PrepareSessionCard action={normalized} />
  return null
}
