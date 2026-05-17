import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'

function formatTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function patientLabel(message) {
  return message?.patient?.display_name || message?.patient?.client_id || 'Client'
}

export default function Inbox() {
  const [messages, setMessages] = useState([])
  const [appointmentRequests, setAppointmentRequests] = useState([])
  const [patients, setPatients] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [reply, setReply] = useState('')
  const [composePatientId, setComposePatientId] = useState('')
  const [composeText, setComposeText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const selected = useMemo(
    () => messages.find(m => String(m.id) === String(selectedId)) || messages[0] || null,
    [messages, selectedId],
  )

  const thread = useMemo(() => {
    if (!selected) return []
    return messages
      .filter(m => String(m.patient_id) === String(selected.patient_id))
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  }, [messages, selected])

  async function load() {
    setError('')
    setLoading(true)
    try {
      const [msgRes, ptRes] = await Promise.all([
        apiFetch('/inbox/messages?limit=100'),
        apiFetch('/patients'),
      ])
      const reqRes = await apiFetch('/inbox/appointment-requests?status=pending')
      const msgData = await msgRes.json()
      const ptData = await ptRes.json()
      const reqData = await reqRes.json().catch(() => ({}))
      if (!msgRes.ok) throw new Error(msgData.error || 'Could not load inbox')
      setMessages(Array.isArray(msgData.messages) ? msgData.messages : [])
      setAppointmentRequests(Array.isArray(reqData.requests) ? reqData.requests : [])
      setPatients(Array.isArray(ptData) ? ptData : [])
      setSelectedId(current => current || msgData.messages?.[0]?.id || null)
    } catch (err) {
      setError(err.message || 'Could not load inbox')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function markRead(message) {
    if (!message || message.read_at || message.sender !== 'client') return
    try {
      await apiFetch(`/inbox/messages/${message.id}/read`, { method: 'POST' })
      setMessages(items => items.map(m => (
        m.id === message.id ? { ...m, read_at: new Date().toISOString() } : m
      )))
    } catch {}
  }

  async function sendMessage(patientId, text, clear) {
    const body = text.trim()
    if (!patientId || !body || sending) return
    setSending(true)
    setError('')
    try {
      const res = await apiFetch('/inbox/messages', {
        method: 'POST',
        body: JSON.stringify({ patient_id: patientId, message: body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not send message')
      await load()
      clear()
      setSelectedId(data.message?.id || selectedId)
    } catch (err) {
      setError(err.message || 'Could not send message')
    } finally {
      setSending(false)
    }
  }

  async function resolveAppointmentRequest(requestId, status, therapistResponse = '') {
    setError('')
    try {
      const res = await apiFetch(`/inbox/appointment-requests/${requestId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, therapist_response: therapistResponse }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not update appointment request')
      await load()
    } catch (err) {
      setError(err.message || 'Could not update appointment request')
    }
  }

  function askMiwa(text) {
    window.dispatchEvent(new CustomEvent('miwa-chat-prompt', { detail: { text, send: true } }))
  }

  const unreadCount = messages.filter(m => m.sender === 'client' && !m.read_at).length

  return (
    <div className="inbox-page min-h-full bg-gray-50 text-gray-900 dark:bg-slate-950 dark:text-white">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-teal-600 dark:text-teal-300">Secure portal inbox</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">Client Messages</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
              Keep clinical communication inside Miwa. SMS and email can notify; the conversation stays in the portal.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => askMiwa('Summarize unread secure client messages, flag any risk language, and suggest follow-up tasks.')}
              className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-100 dark:hover:bg-violet-500/25"
            >
              Ask Miwa to triage
            </button>
            <button
              type="button"
              onClick={load}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
            >
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-100">
            {error}
          </div>
        )}

        <div className="mt-5 rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900 dark:border-teal-400/20 dark:bg-teal-500/10 dark:text-teal-100">
          <p className="font-semibold">How this works with SMS</p>
          <p className="mt-1 text-xs leading-relaxed text-teal-800 dark:text-teal-100/80">
            SMS is best for prompts and notifications, like "you have a message" or "complete this check-in." The inbox is the HIPAA-compliant clinical thread where the actual conversation, replies, risk review, and follow-up history live.
          </p>
        </div>

        {appointmentRequests.length > 0 && (
          <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-50">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-bold">Appointment requests</h3>
                <p className="text-xs text-amber-800 dark:text-amber-100/80">{appointmentRequests.length} pending client request{appointmentRequests.length === 1 ? '' : 's'}</p>
              </div>
            </div>
            <div className="mt-3 grid gap-3">
              {appointmentRequests.map(request => (
                <AppointmentRequestCard
                  key={request.id}
                  request={request}
                  onResolve={resolveAppointmentRequest}
                />
              ))}
            </div>
          </section>
        )}

        <div className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
          <aside className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900/80 dark:shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-white/10">
              <div>
                <h3 className="text-sm font-semibold">Inbox</h3>
                <p className="text-xs text-slate-400">{unreadCount} unread · {messages.length} total</p>
              </div>
              <button
                type="button"
                onClick={async () => { await apiFetch('/inbox/read-all', { method: 'POST' }); load() }}
                className="text-xs font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-300 dark:hover:text-teal-200"
              >
                Mark all read
              </button>
            </div>

            <div className="max-h-[560px] overflow-y-auto">
              {loading ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">Loading messages...</div>
              ) : messages.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-teal-300">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8m-18 8h18a2 2 0 002-2V8a2 2 0 00-2-2H3a2 2 0 00-2 2v6a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="mt-3 text-sm font-semibold">No secure messages yet</p>
                  <p className="mt-1 text-xs text-slate-400">Start a portal message below, or send a portal link from a client record.</p>
                </div>
              ) : messages.map(message => {
                const active = String(selected?.id) === String(message.id)
                const unread = message.sender === 'client' && !message.read_at
                return (
                  <button
                    type="button"
                    key={message.id}
                    onClick={() => { setSelectedId(message.id); markRead(message) }}
                    className={`w-full border-b border-white/10 px-4 py-3 text-left transition-colors ${active ? 'bg-violet-500/15' : 'hover:bg-white/[0.04]'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{patientLabel(message)}</p>
                      {unread && <span className="h-2 w-2 rounded-full bg-teal-300" />}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">{message.message}</p>
                    <p className="mt-2 text-[11px] text-slate-500">
                      {message.sender === 'client' ? 'Client' : 'You'} · {formatTime(message.created_at)}
                    </p>
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="rounded-2xl border border-white/10 bg-slate-900/80 shadow-xl">
            {selected ? (
              <>
                <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-lg font-bold">{patientLabel(selected)}</h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      {selected.patient?.client_type || 'individual'} · {selected.patient?.client_id}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => askMiwa(`Summarize the secure message thread with ${patientLabel(selected)} and suggest any follow-up tasks.`)} className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">
                      Summarize thread
                    </button>
                    <button onClick={() => askMiwa(`Draft a warm, clinically appropriate reply to ${patientLabel(selected)} based on the current secure message thread. Ask me before sending.`)} className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">
                      Draft reply
                    </button>
                    <button onClick={() => askMiwa(`Review ${patientLabel(selected)}'s recent message for risk language and suggest next steps.`)} className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">
                      Risk scan
                    </button>
                  </div>
                </div>

                <div className="max-h-[470px] space-y-3 overflow-y-auto px-5 py-4">
                  {thread.map(message => {
                    const isTherapist = message.sender === 'therapist'
                    return (
                      <div key={message.id} className={`flex ${isTherapist ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${isTherapist ? 'bg-blue-600 text-white' : 'bg-white/8 text-slate-100'}`}>
                          <p className="whitespace-pre-wrap">{message.message}</p>
                          <p className={`mt-2 text-[10px] ${isTherapist ? 'text-blue-100' : 'text-slate-500'}`}>
                            {isTherapist ? 'You' : 'Client'} · {formatTime(message.created_at)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="border-t border-white/10 px-5 py-4">
                  <textarea
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                    rows={3}
                    className="w-full resize-none rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-400/20"
                    placeholder={`Reply securely to ${patientLabel(selected)}...`}
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">Sends inside the Miwa client portal.</p>
                    <button
                      type="button"
                      onClick={() => sendMessage(selected.patient_id, reply, () => setReply(''))}
                      disabled={!reply.trim() || sending}
                      className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Send Secure Message
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="px-5 py-10 text-center text-slate-400">Select a message or start a new secure message.</div>
            )}
          </section>
        </div>

        <section className="mt-4 rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-xl">
          <h3 className="text-sm font-bold">Start Secure Message</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-[280px_1fr_auto]">
            <select
              value={composePatientId}
              onChange={e => setComposePatientId(e.target.value)}
              className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white focus:border-teal-400 focus:outline-none"
            >
              <option value="">Select client...</option>
              {patients.map(patient => (
                <option key={patient.id} value={patient.id}>
                  {patient.display_name || patient.client_id} · {patient.client_id}
                </option>
              ))}
            </select>
            <input
              value={composeText}
              onChange={e => setComposeText(e.target.value)}
              className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-teal-400 focus:outline-none"
              placeholder="Write a brief secure portal message..."
            />
            <button
              type="button"
              onClick={() => sendMessage(composePatientId, composeText, () => { setComposeText(''); setComposePatientId('') })}
              disabled={!composePatientId || !composeText.trim() || sending}
              className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function AppointmentRequestCard({ request, onResolve }) {
  const [response, setResponse] = useState('')
  const [busy, setBusy] = useState('')
  const clientName = request.display_name || request.client_id || 'Client'

  async function act(status) {
    setBusy(status)
    try {
      await onResolve(request.id, status, response.trim())
      setResponse('')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-white p-3 text-gray-900 shadow-sm dark:border-amber-400/20 dark:bg-slate-950/70 dark:text-white">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-bold">{clientName}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
            {request.request_type === 'cancel' ? 'Cancel request' : 'Reschedule request'} · {formatTime(request.scheduled_start || request.created_at)}
          </p>
          {request.message && <p className="mt-2 text-sm text-gray-700 dark:text-slate-200">{request.message}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => act('approved')}
            disabled={!!busy}
            className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy === 'approved' ? 'Saving...' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={() => act('declined')}
            disabled={!!busy}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 disabled:opacity-50 dark:border-white/10 dark:text-slate-200"
          >
            Decline
          </button>
        </div>
      </div>
      <input
        value={response}
        onChange={e => setResponse(e.target.value)}
        className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-gray-400 focus:border-teal-500 dark:border-white/10 dark:bg-slate-950"
        placeholder="Optional response visible to client"
      />
      <button
        type="button"
        onClick={() => act('countered')}
        disabled={!!busy || !response.trim()}
        className="mt-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 disabled:opacity-40 dark:border-white/10 dark:text-slate-200"
      >
        {busy === 'countered' ? 'Saving...' : 'Send counter offer'}
      </button>
    </div>
  )
}
