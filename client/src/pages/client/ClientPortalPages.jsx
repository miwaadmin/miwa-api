import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { API_BASE, apiFetch, clientApiFetch } from '../../lib/api'
import { useClientAuth } from '../../context/ClientAuthContext'
import { MiwaLogo } from '../../components/Sidebar'

const tabs = [
  { to: '/client/home', label: 'Home' },
  { to: '/client/messages', label: 'Messages' },
  { to: '/client/assessments', label: 'Check-ins' },
  { to: '/client/homework', label: 'Homework' },
  { to: '/client/documents', label: 'Docs' },
  { to: '/client/resources', label: 'Safety' },
]

function fmtDateTime(value) {
  if (!value) return ''
  try { return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  catch { return value }
}

function fmtDate(value) {
  if (!value) return ''
  try { return new Date(value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
  catch { return value }
}

export function ClientProtectedRoute({ children }) {
  const { client, isLoading } = useClientAuth()
  if (isLoading) return <ClientShell><Loading label="Loading your portal..." /></ClientShell>
  if (!client) return <Navigate to="/client/login" replace />
  return children
}

export function ClientLogin() {
  const { client, login } = useClientAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  if (client) return <Navigate to="/client/home" replace />

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API_BASE}/client-auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unable to sign in.')
      login(data.token, data.client)
      navigate('/client/home', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ClientShell centered>
      <div className="w-full max-w-sm px-5">
        <HeaderMark title="Client portal" subtitle="Sign in through the client door." />
        <form onSubmit={submit} className="mt-7 rounded-2xl bg-white border border-gray-200 p-5 space-y-4 shadow-sm">
          <Field label="Email" type="email" value={form.email} onChange={email => setForm(f => ({ ...f, email }))} autoFocus />
          <Field label="Password" type="password" value={form.password} onChange={password => setForm(f => ({ ...f, password }))} />
          {error && <p className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="w-full rounded-xl bg-gray-950 text-white font-semibold py-3 disabled:opacity-50" disabled={loading}>
            {loading ? 'Signing in...' : 'Continue as Client'}
          </button>
        </form>
        <div className="mt-4 flex justify-center gap-4 text-sm font-semibold">
          <Link className="text-indigo-700" to="/client/join">Create account</Link>
          <Link className="text-indigo-700" to="/client/reset-password">Reset password</Link>
        </div>
        <Link className="mt-4 block text-center text-sm font-semibold text-indigo-700" to="/login">Continue as Clinician</Link>
      </div>
    </ClientShell>
  )
}

export function ClientAcceptInvite() {
  const [params] = useSearchParams()
  const { login } = useClientAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ code: '', display_name: '', password: '', accepted_terms: true })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const token = params.get('token') || ''

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API_BASE}/client-auth/accept-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: token || form.code.trim(), ...form }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unable to accept invite.')
      login(data.token, data.client)
      navigate('/client/home', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ClientShell centered>
      <div className="w-full max-w-sm px-5">
        <HeaderMark title="Set up Miwa" subtitle="Create your private client portal sign-in." />
        <form onSubmit={submit} className="mt-7 rounded-2xl bg-white border border-gray-200 p-5 space-y-4 shadow-sm">
          {!token && <Field label="Invite code" value={form.code} onChange={code => setForm(f => ({ ...f, code }))} placeholder="Paste the code from your clinician" autoFocus />}
          <Field label="Display name" value={form.display_name} onChange={display_name => setForm(f => ({ ...f, display_name }))} placeholder="What should we call you?" />
          <Field label="Password" type="password" value={form.password} onChange={password => setForm(f => ({ ...f, password }))} />
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 space-y-2">
            <p>Miwa is not for emergencies. Your therapist may not respond instantly.</p>
            <p>Secure messages may become part of your clinical communication history.</p>
            <p>Email and SMS notifications only say there is a secure item in Miwa. They do not include clinical details.</p>
            <p>For crisis needs, call 988, 911, or local emergency services.</p>
          </div>
          <label className="flex gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
            <input type="checkbox" checked={form.accepted_terms} onChange={e => setForm(f => ({ ...f, accepted_terms: e.target.checked }))} />
            <span>I accept the portal terms, privacy notice, and consent information.</span>
          </label>
          {error && <p className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="w-full rounded-xl bg-gray-950 text-white font-semibold py-3 disabled:opacity-50" disabled={loading || (!token && !form.code.trim())}>
            {loading ? 'Creating portal...' : 'Accept Invite'}
          </button>
        </form>
      </div>
    </ClientShell>
  )
}

export function ClientResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError(''); setMessage('')
    try {
      const res = await fetch(`${API_BASE}/client-auth/${token ? 'reset-password' : 'forgot-password'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(token ? { token, password } : { email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unable to continue.')
      setMessage(data.message || 'Check your email for the next step.')
      if (token) setTimeout(() => navigate('/client/login'), 1200)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ClientShell centered>
      <div className="w-full max-w-sm px-5">
        <HeaderMark title="Reset password" subtitle={token ? 'Choose a new client portal password.' : 'Get a secure recovery link.'} />
        <form onSubmit={submit} className="mt-7 rounded-2xl bg-white border border-gray-200 p-5 space-y-4 shadow-sm">
          {token
            ? <Field label="New password" type="password" value={password} onChange={setPassword} autoFocus />
            : <Field label="Email" type="email" value={email} onChange={setEmail} autoFocus />}
          {message && <p className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">{message}</p>}
          {error && <p className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="w-full rounded-xl bg-gray-950 text-white font-semibold py-3 disabled:opacity-50" disabled={loading || (token ? !password : !email)}>
            {loading ? 'Working...' : token ? 'Update Password' : 'Send Recovery Link'}
          </button>
        </form>
        <Link className="mt-4 block text-center text-sm font-semibold text-indigo-700" to="/client/login">Back to client login</Link>
      </div>
    </ClientShell>
  )
}

function usePortalHome() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = async () => {
    setLoading(true); setError('')
    try {
      const res = await clientApiFetch('/client-portal/home')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Unable to load portal.')
      setData(json)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])
  return { data, setData, loading, error, load }
}

export function ClientHome() {
  const portal = usePortalHome()
  if (portal.loading) return <ClientFrame><Loading label="Opening your home..." /></ClientFrame>
  if (portal.error) return <ClientFrame><Empty title="Could not load portal" body={portal.error} /></ClientFrame>
  const data = portal.data
  const next = (data.appointments || []).filter(a => new Date(a.scheduled_start) > new Date())[0]
  const unread = (data.messages || []).filter(m => m.sender_type === 'therapist' && !m.read_at)[0]
  const pendingAssessments = (data.assessments || []).filter(a => !a.completed_at && !a.expired)
  const incomplete = (data.homework || []).filter(h => !h.completed_at)

  return (
    <ClientFrame>
      <div className="px-4 py-5 space-y-4">
        <div>
          <p className="text-sm text-gray-500">Hi, {(data.client?.display_name || 'there').split(' ')[0]}</p>
          <h1 className="text-2xl font-bold text-gray-950">Your Miwa portal</h1>
        </div>
        {data.announcement && <section className="rounded-2xl bg-indigo-50 border border-indigo-100 p-4 text-sm font-semibold text-indigo-950">{data.announcement}</section>}
        {data.response_expectations && (
          <section className="rounded-2xl bg-white border border-gray-200 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Response expectations</p>
            <p className="mt-1 text-sm text-gray-700">{data.response_expectations.response_window}</p>
            {data.response_expectations.office_hours && <p className="mt-1 text-sm text-gray-700">{data.response_expectations.office_hours}</p>}
          </section>
        )}
        <Checklist data={data} />
        <HomeCard title="Next appointment" to="/client/appointments" value={next ? `${fmtDate(next.scheduled_start)} at ${new Date(next.scheduled_start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'No upcoming appointment'} />
        <HomeCard title="Unread message" to="/client/messages" value={unread ? unread.content : 'No unread messages'} />
        <HomeCard title="Check-ins" to="/client/assessments" value={pendingAssessments.length ? `${pendingAssessments.length} waiting for you` : 'Nothing due'} />
        <HomeCard title="Homework and resources" to="/client/homework" value={incomplete.length ? `${incomplete.length} incomplete` : 'All caught up'} />
        <HomeCard title="Forms and documents" to="/client/documents" value="Shared files and requested forms" />
        {data.care_goals?.length > 0 && (
          <section className="rounded-2xl bg-white border border-gray-200 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Care goals</p>
            <div className="mt-2 space-y-2">{data.care_goals.map(g => <p key={g.id} className="text-sm text-gray-800">{g.title}</p>)}</div>
          </section>
        )}
        <SafetyCard />
      </div>
    </ClientFrame>
  )
}

function Checklist({ data }) {
  const pendingAssessments = (data.assessments || []).filter(a => !a.completed_at && !a.expired).length
  const items = [
    ['Accept portal consent', true],
    ['Confirm contact preferences', !!data.checklist?.contact_preferences],
    ['View next appointment', !!data.checklist?.viewed_next_appointment || (data.appointments || []).length === 0],
    ['Send a secure message or read the welcome message', !!data.checklist?.first_message || (data.messages || []).length > 0],
    ['Complete pending forms or check-ins', pendingAssessments === 0],
  ]
  return (
    <section className="rounded-2xl bg-white border border-gray-200 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Getting started</p>
      <div className="mt-2 space-y-2">
        {items.map(([label, done]) => <p key={label} className="text-sm text-gray-700">{done ? 'Done: ' : 'Next: '}{label}</p>)}
      </div>
    </section>
  )
}

export function ClientPreview() {
  const { patientId } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    apiFetch(`/patients/${patientId}/client-portal/preview`).then(r => r.json()).then(setData).finally(() => setLoading(false))
  }, [patientId])
  return (
    <ClientShell>
      <main className="mx-auto w-full max-w-xl min-h-screen bg-gray-50 px-4 py-5 space-y-4">
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
          <p className="text-sm font-bold text-amber-900">Client View Preview</p>
          <p className="text-sm text-amber-800">Read-only. Messages and forms cannot be submitted from preview mode.</p>
        </div>
        {loading ? <Loading label="Loading preview..." /> : (
          <>
            <h1 className="text-2xl font-bold text-gray-950">Hi, {(data?.client?.display_name || 'there').split(' ')[0]}</h1>
            <SafetyCard />
            <section className="rounded-2xl bg-white border border-gray-200 p-4">
              <p className="font-semibold text-gray-950">Messages</p>
              {(data?.messages || []).length === 0 ? <p className="text-sm text-gray-500 mt-1">No messages yet.</p> : data.messages.slice(-3).map(m => <p key={m.id} className="mt-2 text-sm text-gray-700">{m.content}</p>)}
            </section>
            <section className="rounded-2xl bg-white border border-gray-200 p-4">
              <p className="font-semibold text-gray-950">Practice</p>
              {(data?.homework || []).length === 0 ? <p className="text-sm text-gray-500 mt-1">No practice items yet.</p> : data.homework.map(h => <p key={h.id} className="mt-2 text-sm text-gray-700">{h.title}</p>)}
            </section>
          </>
        )}
      </main>
    </ClientShell>
  )
}

function HomeCard({ title, value, to }) {
  return (
    <Link to={to} className="block rounded-2xl bg-white border border-gray-200 p-4 active:bg-gray-50">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{title}</p>
      <p className="mt-1 text-base font-semibold text-gray-950">{value}</p>
    </Link>
  )
}

export function ClientMessages() {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const endRef = useRef(null)
  useEffect(() => {
    try { setText(localStorage.getItem('miwa_client_message_draft') || '') } catch {}
  }, [])
  useEffect(() => {
    try { localStorage.setItem('miwa_client_message_draft', text) } catch {}
  }, [text])
  async function load() {
    const res = await clientApiFetch('/client-portal/messages')
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Unable to load messages.')
    setMessages(json.messages || [])
  }
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setLoading(false)) }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])
  async function send(e) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
      setText('')
      try { localStorage.removeItem('miwa_client_message_draft') } catch {}
    const res = await clientApiFetch('/client-portal/messages', { method: 'POST', body: JSON.stringify({ content: body }) })
    const json = await res.json()
      if (res.ok) {
        setMessages(m => [...m, json.message])
        if (json.safety_guidance) setError(json.safety_guidance)
      }
      else setError(json.error || 'Could not send message.')
  }
  return (
    <ClientFrame>
      <div className="px-4 py-4 pb-28">
        <h1 className="text-xl font-bold text-gray-950 mb-4">Messages</h1>
        {loading ? <Loading label="Loading messages..." /> : error ? <Empty title="Messages unavailable" body={error} /> : (
          <div className="space-y-3">
            {messages.map(m => {
              const mine = m.sender_type === 'client'
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[82%] rounded-3xl px-4 py-2.5 ${mine ? 'bg-teal-600 text-white rounded-br-md' : 'bg-gray-200 text-gray-950 rounded-bl-md'}`}>
                    <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                    <p className={`text-[10px] mt-1 ${mine ? 'text-teal-50' : 'text-gray-500'}`}>{fmtDateTime(m.created_at)}</p>
                  </div>
                </div>
              )
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>
      <form onSubmit={send} className="fixed bottom-16 left-0 right-0 bg-white border-t border-gray-200 px-3 py-3">
        <div className="mx-auto max-w-xl flex gap-2">
          <input className="flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-teal-500" value={text} onChange={e => setText(e.target.value)} placeholder="Message your clinician" />
          <button className="rounded-full bg-teal-600 text-white px-5 font-semibold">Send</button>
        </div>
      </form>
    </ClientFrame>
  )
}

export function ClientAssessments() {
  const [params] = useSearchParams()
  const activeToken = params.get('token')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (activeToken) {
      setLoading(false)
      return
    }
    clientApiFetch('/client-portal/assessments')
      .then(r => r.json())
      .then(j => setItems(j.assessments || []))
      .finally(() => setLoading(false))
  }, [activeToken])
  if (activeToken) return <AssessmentRunner token={activeToken} />
  const pending = items.filter(a => !a.completed_at && !a.expired)
  const done = items.filter(a => a.completed_at)
  return (
    <ClientFrame>
      <ListPage title="Check-ins" loading={loading} empty={!items.length} emptyTitle="No check-ins yet">
        {[...pending, ...done].map(a => (
          <Link key={a.id} to={a.completed_at ? '#' : `/client/assessments?token=${a.token}`} className="block rounded-2xl bg-white border border-gray-200 p-4">
            <p className="font-semibold text-gray-950">{a.name}</p>
            <p className="text-sm text-gray-500">{a.completed_at ? `Completed ${fmtDate(a.completed_at)}` : `Due by ${fmtDate(a.expires_at)}`}</p>
          </Link>
        ))}
      </ListPage>
    </ClientFrame>
  )
}

function AssessmentRunner({ token }) {
  const [template, setTemplate] = useState(null)
  const [responses, setResponses] = useState([])
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    clientApiFetch(`/client-portal/assessments/${token}`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!ok) throw new Error(j.error); setTemplate(j); setResponses(Array(j.questions.length).fill(null)) })
      .catch(e => setError(e.message))
  }, [token])
  async function submit() {
    const payload = responses.map((value, index) => ({ question_id: template.questions[index].id, value }))
    const res = await clientApiFetch(`/client-portal/assessments/${token}`, { method: 'POST', body: JSON.stringify({ responses: payload }) })
    const json = await res.json()
    if (res.ok) setDone(json)
    else setError(json.error || 'Could not submit.')
  }
  if (done) return <ClientFrame><div className="px-4 py-10"><Empty title="Check-in complete" body="Thanks. Your clinician can see your response." /><SafetyCard /></div></ClientFrame>
  return (
    <ClientFrame>
      <div className="px-4 py-5 space-y-4">
        {error ? <Empty title="Check-in unavailable" body={error} /> : !template ? <Loading label="Loading check-in..." /> : (
          <>
            <h1 className="text-xl font-bold text-gray-950">{template.name}</h1>
            <p className="text-sm text-gray-600">{template.instructions}</p>
            {template.questions.map((q, i) => (
              <section key={q.id} className="rounded-2xl bg-white border border-gray-200 p-4">
                <p className="text-sm font-semibold text-gray-950">{q.text}</p>
                <div className="mt-3 grid gap-2">
                  {template.options.map(opt => (
                    <button key={opt.value} onClick={() => setResponses(r => r.map((v, idx) => idx === i ? opt.value : v))} className={`rounded-xl border px-3 py-2 text-left text-sm ${responses[i] === opt.value ? 'border-teal-500 bg-teal-50 text-teal-900' : 'border-gray-200 bg-white'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <button onClick={submit} disabled={responses.some(v => v === null)} className="w-full rounded-xl bg-gray-950 text-white py-3 font-semibold disabled:opacity-40">Submit</button>
          </>
        )}
      </div>
    </ClientFrame>
  )
}

export function ClientHomework() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  async function load() {
    const res = await clientApiFetch('/client-portal/homework')
    const json = await res.json()
    setItems(json.homework || [])
  }
  useEffect(() => { load().finally(() => setLoading(false)) }, [])
  async function complete(id) {
    await clientApiFetch(`/client-portal/homework/${id}/complete`, { method: 'POST' })
    load()
  }
  return (
    <ClientFrame>
      <ListPage title="Homework" loading={loading} empty={!items.length} emptyTitle="No homework assigned">
        {items.map(h => (
          <section key={h.id} className="rounded-2xl bg-white border border-gray-200 p-4">
            <div className="flex justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-950">{h.title}</p>
                {h.description && <p className="mt-1 text-sm text-gray-600">{h.description}</p>}
                {h.resource_url && <a href={h.resource_url} className="mt-2 inline-block text-sm font-semibold text-indigo-700" target="_blank" rel="noreferrer">Open resource</a>}
              </div>
              {h.completed_at ? <span className="text-xs font-semibold text-emerald-700">Done</span> : <button onClick={() => complete(h.id)} className="h-9 rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white">Complete</button>}
            </div>
          </section>
        ))}
      </ListPage>
    </ClientFrame>
  )
}

export function ClientAppointments() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    clientApiFetch('/client-portal/appointments').then(r => r.json()).then(j => setItems(j.appointments || [])).finally(() => setLoading(false))
  }, [])
  return (
    <ClientFrame>
      <ListPage title="Appointments" loading={loading} empty={!items.length} emptyTitle="No appointments scheduled">
        {items.map(a => (
          <section key={a.id} className="rounded-2xl bg-white border border-gray-200 p-4">
            <p className="font-semibold text-gray-950">{fmtDateTime(a.scheduled_start)}</p>
            <p className="text-sm text-gray-500">{a.appointment_type?.replace(/_/g, ' ') || 'Session'} {a.location ? `- ${a.location}` : ''}</p>
            {a.meet_url && <a href={a.meet_url} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Join telehealth</a>}
            <AppointmentRequestButton appointmentId={a.id} />
          </section>
        ))}
      </ListPage>
    </ClientFrame>
  )
}

function AppointmentRequestButton({ appointmentId }) {
  const [sent, setSent] = useState(false)
  async function requestChange() {
    await clientApiFetch(`/client-portal/appointments/${appointmentId}/request`, {
      method: 'POST',
      body: JSON.stringify({ request_type: 'reschedule', message: 'Client requested a schedule change.' }),
    })
    setSent(true)
  }
  return sent
    ? <p className="mt-3 text-sm font-semibold text-emerald-700">Request sent</p>
    : <button onClick={requestChange} className="mt-3 block rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700">Request cancel or reschedule</button>
}

export function ClientDocuments() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  function load() {
    clientApiFetch('/client-portal/documents').then(r => r.json()).then(j => setItems(j.documents || [])).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  async function uploadFile(file) {
    if (!file) return
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    form.append('document_label', file.name)
    const res = await fetch(`${API_BASE}/client-portal/documents`, { method: 'POST', credentials: 'include', body: form })
    setUploading(false)
    if (res.ok) load()
  }
  return (
    <ClientFrame>
      <ListPage title="Forms and documents" loading={loading} empty={!items.length} emptyTitle="No shared documents yet">
        <label className="block rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-center text-sm font-semibold text-gray-700">
          {uploading ? 'Uploading...' : 'Upload a requested file'}
          <input type="file" className="hidden" onChange={e => uploadFile(e.target.files?.[0])} />
        </label>
        {items.map(d => (
          <section key={d.id} className="rounded-2xl bg-white border border-gray-200 p-4">
            <p className="font-semibold text-gray-950">{d.document_label || d.original_name || 'Document'}</p>
            <p className="text-sm text-gray-500">{d.client_uploaded ? 'Uploaded from portal' : 'Shared by your clinician'}</p>
          </section>
        ))}
      </ListPage>
    </ClientFrame>
  )
}

export function ClientResources() {
  return (
    <ClientFrame>
      <div className="px-4 py-5 space-y-4">
        <h1 className="text-xl font-bold text-gray-950">Safety resources</h1>
        <SafetyCard />
        <section className="rounded-2xl bg-white border border-gray-200 p-4">
          <p className="font-semibold text-gray-950">988 Suicide & Crisis Lifeline</p>
          <p className="mt-1 text-sm text-gray-600">Call or text 988 in the United States for crisis support.</p>
          <a href="https://988lifeline.org/" target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-indigo-700">Visit 988lifeline.org</a>
        </section>
      </div>
    </ClientFrame>
  )
}

export function ClientSettings() {
  const { client, logout } = useClientAuth()
  const navigate = useNavigate()
  const [settings, setSettings] = useState(null)
  useEffect(() => {
    clientApiFetch('/client-portal/settings').then(r => r.json()).then(j => setSettings(j.client || null)).catch(() => {})
  }, [])
  async function save(next) {
    setSettings(next)
    await clientApiFetch('/client-portal/settings', { method: 'PUT', body: JSON.stringify(next) })
  }
  return (
    <ClientFrame>
      <div className="px-4 py-5 space-y-4">
        <h1 className="text-xl font-bold text-gray-950">Settings</h1>
        <section className="rounded-2xl bg-white border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Signed in as</p>
          <p className="font-semibold text-gray-950">{client?.email}</p>
        </section>
        {settings && (
          <section className="rounded-2xl bg-white border border-gray-200 p-4 space-y-3">
            <p className="font-semibold text-gray-950">Notifications</p>
            <Toggle label="Email notifications" checked={settings.notification_email_enabled} onChange={v => save({ ...settings, notification_email_enabled: v })} />
            <Toggle label="SMS notifications" checked={settings.notification_sms_enabled} onChange={v => save({ ...settings, notification_sms_enabled: v })} />
            <Toggle label="Appointment reminders" checked={settings.appointment_reminders_enabled} onChange={v => save({ ...settings, appointment_reminders_enabled: v })} />
            <Toggle label="Assessment reminders" checked={settings.assessment_reminders_enabled} onChange={v => save({ ...settings, assessment_reminders_enabled: v })} />
            <Toggle label="Homework reminders" checked={settings.homework_reminders_enabled} onChange={v => save({ ...settings, homework_reminders_enabled: v })} />
            <p className="text-xs text-gray-500">Notifications only say there is a secure item in Miwa. They do not include clinical details.</p>
          </section>
        )}
        <button onClick={() => logout().then(() => navigate('/client/login'))} className="w-full rounded-xl bg-gray-950 text-white py-3 font-semibold">Sign out</button>
      </div>
    </ClientFrame>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-sm text-gray-700">{label}</span>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="h-5 w-5" />
    </label>
  )
}

function SafetyCard() {
  return (
    <section className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-700">If this is urgent</p>
      <p className="mt-1 text-sm text-amber-950">Miwa messages are not crisis support and may not be read immediately. If you may hurt yourself or someone else, call 911 or go to the nearest emergency room. In the U.S., call or text 988 for the Suicide & Crisis Lifeline.</p>
    </section>
  )
}

function CrisisButton() {
  return (
    <Link to="/client/resources" className="fixed right-4 bottom-20 z-40 rounded-full bg-gray-950 px-4 py-3 text-sm font-semibold text-white shadow-lg">
      Need help now?
    </Link>
  )
}

function ClientFrame({ children }) {
  return (
    <ClientShell>
      <main className="mx-auto w-full max-w-xl min-h-screen pb-20 bg-gray-50">{children}</main>
      <CrisisButton />
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 border-t border-gray-200">
        <div className="mx-auto flex max-w-xl justify-around px-2 py-2">
          {tabs.map(t => <Link key={t.to} to={t.to} className="px-2 py-2 text-[11px] font-semibold text-gray-600">{t.label}</Link>)}
        </div>
      </nav>
    </ClientShell>
  )
}

function ClientShell({ children, centered }) {
  return <div className={`min-h-screen bg-gray-50 ${centered ? 'flex items-center justify-center' : ''}`}>{children}</div>
}

function HeaderMark({ title, subtitle }) {
  return (
    <div className="text-center">
      <Link to="/" className="inline-flex"><MiwaLogo size={52} /></Link>
      <h1 className="mt-4 text-2xl font-bold text-gray-950">{title}</h1>
      <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', ...props }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-gray-700">{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base outline-none focus:border-teal-500" {...props} />
    </label>
  )
}

function Loading({ label }) {
  return <div className="py-16 text-center text-sm text-gray-500">{label}</div>
}

function Empty({ title, body }) {
  return <div className="rounded-2xl bg-white border border-gray-200 p-5 text-center"><p className="font-semibold text-gray-950">{title}</p>{body && <p className="mt-1 text-sm text-gray-500">{body}</p>}</div>
}

function ListPage({ title, loading, empty, emptyTitle, children }) {
  return (
    <div className="px-4 py-5 space-y-3">
      <h1 className="text-xl font-bold text-gray-950">{title}</h1>
      {loading ? <Loading label="Loading..." /> : empty ? <Empty title={emptyTitle} /> : children}
    </div>
  )
}
