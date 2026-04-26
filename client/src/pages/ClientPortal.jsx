/**
 * ClientPortal — mobile-first client-facing portal.
 *
 * Rebuilt from scratch for phones. Safe-area aware, iOS-style tab bar
 * at the bottom (Home / Check-ins / Appointments / Messages), large
 * tap targets, warm copy. Works identically on desktop (centered
 * 600px column) because the underlying structure is mobile-first.
 *
 * Same endpoints as before:
 *   GET  /public/portal/:token            — load portal data
 *   POST /public/portal/:token/message    — send message to therapist
 *   POST /public/portal/:token/checkin    — log a mood entry
 *
 * PWA-ready: full-screen, no browser chrome assumptions, tap targets
 * all ≥44px. Clients can add this page to their home screen for quick
 * access; no app install required.
 */
import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL ?? '/api'

const ASSESSMENT_LABELS = {
  'phq-9':  'Depression screen',
  'gad-7':  'Anxiety screen',
  'pcl-5':  'Post-trauma screen',
  'cssrs':  'Safety screen',
  'ras':    'Recovery self-rating',
  'fad-gf': 'Family functioning',
  'score-15': 'Relationship check',
}

const MOODS = [
  { score: 1, emoji: '😞', label: 'Very difficult', color: '#dc2626' },
  { score: 2, emoji: '🙁', label: 'Rough',          color: '#f97316' },
  { score: 3, emoji: '😐', label: 'So-so',          color: '#eab308' },
  { score: 4, emoji: '🙂', label: 'Getting by',     color: '#22c55e' },
  { score: 5, emoji: '😊', label: 'Pretty good',    color: '#10b981' },
]

function friendlyAssessment(type) {
  return ASSESSMENT_LABELS[type] || (type ? type.toUpperCase() : 'Screening')
}

function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  catch { return '' }
}

function fmtDateTime(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  catch { return '' }
}

function timeFromNow(iso) {
  if (!iso) return ''
  const diff = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(diff)) return ''
  const hrs = Math.round(diff / (60 * 60 * 1000))
  const days = Math.round(diff / (24 * 60 * 60 * 1000))
  if (hrs < 0)  return `${Math.abs(hrs)}h ago`
  if (hrs < 1)  return 'soon'
  if (hrs < 24) return `in ${hrs}h`
  if (days === 1) return 'tomorrow'
  return `in ${days}d`
}

// ══════════════════════════════════════════════════════════════════════════
// Main container
// ══════════════════════════════════════════════════════════════════════════

export default function ClientPortal() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('home')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true); setError('')
      try {
        const res = await fetch(`${API}/public/portal/${token}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Unable to load your portal.')
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  if (loading) {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="mt-3 text-sm text-gray-600">Loading your portal…</p>
        </div>
      </Shell>
    )
  }

  if (error) {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-5">
            <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">This link can't be opened</h1>
          <p className="text-sm text-gray-600 max-w-xs leading-relaxed">{error}</p>
        </div>
      </Shell>
    )
  }

  const unread = (data.messages || []).filter(m => m.sender === 'therapist' && !m.read_at).length

  return (
    <Shell>
      {/* Top header — client name + therapist name */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-100 flex items-center gap-3 px-4 h-14"
        style={{ paddingTop: 'env(safe-area-inset-top, 0)', paddingLeft: 'max(16px, env(safe-area-inset-left))', paddingRight: 'max(16px, env(safe-area-inset-right))' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #0ac5a2, #5746ed)' }}>
          M
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">Hi, {(data.client?.display_name || '').split(' ')[0] || 'there'}</p>
          <p className="text-[11px] text-gray-500 truncate">Your clinician: {data.therapist?.name || ''}</p>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto pb-20">
        {tab === 'home'       && <HomeTab       data={data} token={token} onUpdate={setData} />}
        {tab === 'assessments' && <AssessmentsTab data={data} />}
        {tab === 'appts'      && <AppointmentsTab data={data} />}
        {tab === 'messages'   && <MessagesTab   data={data} token={token} onUpdate={setData} />}
      </div>

      {/* Bottom tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur border-t border-gray-100 flex justify-around items-center"
        style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      >
        <TabButton id="home"        activeTab={tab} onClick={setTab} label="Home"       icon={HomeIcon} />
        <TabButton id="assessments" activeTab={tab} onClick={setTab} label="Check-ins"  icon={ClipIcon} />
        <TabButton id="appts"       activeTab={tab} onClick={setTab} label="Sessions"   icon={CalIcon} />
        <TabButton id="messages"    activeTab={tab} onClick={setTab} label="Messages"   icon={ChatIcon} badge={unread} />
      </nav>
    </Shell>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Shell
// ══════════════════════════════════════════════════════════════════════════

function Shell({ children }) {
  return (
    <div
      className="flex flex-col min-h-screen bg-gray-50"
      style={{ paddingTop: 'env(safe-area-inset-top, 0)' }}
    >
      <div className="mx-auto w-full max-w-xl flex flex-col min-h-screen">
        {children}
      </div>
    </div>
  )
}

function TabButton({ id, activeTab, onClick, label, icon: Icon, badge }) {
  const active = activeTab === id
  return (
    <button
      onClick={() => onClick(id)}
      className={`relative flex flex-col items-center gap-0.5 px-3 py-2.5 min-w-[64px] min-h-[56px] ${
        active ? 'text-teal-600' : 'text-gray-400 active:text-gray-600'
      }`}
    >
      <Icon active={active} />
      <span className="text-[10px] font-semibold">{label}</span>
      {badge > 0 && (
        <span className="absolute top-1 right-3 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Home tab
// ══════════════════════════════════════════════════════════════════════════

function HomeTab({ data, token, onUpdate }) {
  const [mood, setMood] = useState(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const nextAppt = (data.appointments || []).filter(a =>
    new Date(a.scheduled_start) > new Date() && a.status !== 'cancelled'
  ).sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start))[0]

  const latestMessage = (data.messages || []).filter(m => m.sender === 'therapist').sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  )[0]

  const pendingAssessments = (data.assessments || []).filter(a => !a.completed_at && !a.expired)

  const handleMoodSubmit = async () => {
    if (!mood) return
    setSubmitting(true); setErrorMsg('')
    try {
      const res = await fetch(`${API}/public/portal/${token}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood_score: mood, mood_notes: note.trim() || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not submit')
      setSubmitted(true)
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="px-4 py-5 space-y-4">
      {/* Mood check-in */}
      <section className="rounded-2xl bg-white border border-gray-200 p-5">
        {submitted ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-base font-semibold text-gray-900">Thanks for checking in</p>
            <p className="text-sm text-gray-500 mt-1">Your clinician will see this.</p>
          </div>
        ) : (
          <>
            <p className="text-xs font-bold uppercase tracking-widest text-teal-600 mb-1">Today</p>
            <h2 className="text-lg font-bold text-gray-900 mb-3">How are you feeling?</h2>
            <div className="grid grid-cols-5 gap-2 mb-3">
              {MOODS.map(m => {
                const selected = mood === m.score
                return (
                  <button
                    key={m.score}
                    onClick={() => setMood(m.score)}
                    className={`flex flex-col items-center py-3 rounded-2xl border-2 transition-all active:scale-95 ${
                      selected ? 'text-white shadow-md' : 'bg-white text-gray-700 border-gray-200'
                    }`}
                    style={selected ? { background: m.color, borderColor: m.color } : {}}
                  >
                    <span className="text-2xl">{m.emoji}</span>
                    <span className="text-[9px] font-bold uppercase mt-1">{m.score}/5</span>
                  </button>
                )
              })}
            </div>
            {mood && (
              <>
                <textarea
                  rows={2}
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  maxLength={500}
                  placeholder="Anything else? (optional)"
                  className="w-full rounded-xl px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400 resize-none mb-3"
                />
                {errorMsg && (
                  <div className="rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 p-2 mb-2">
                    {errorMsg}
                  </div>
                )}
                <button
                  onClick={handleMoodSubmit}
                  disabled={submitting}
                  className="w-full rounded-xl py-3 text-sm font-bold text-white active:opacity-90 disabled:opacity-50"
                  style={{ background: MOODS.find(m => m.score === mood)?.color || '#0ac5a2' }}
                >
                  {submitting ? 'Sending…' : 'Send to my clinician'}
                </button>
              </>
            )}
          </>
        )}
      </section>

      {/* Pending check-ins */}
      {pendingAssessments.length > 0 && (
        <section className="rounded-2xl bg-indigo-50 border border-indigo-100 p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-1">Waiting for you</p>
          <p className="text-sm text-indigo-950 leading-relaxed mb-3">
            Your clinician sent {pendingAssessments.length} check-in{pendingAssessments.length === 1 ? '' : 's'} to complete.
          </p>
          <div className="space-y-2">
            {pendingAssessments.slice(0, 3).map(a => (
              <a
                key={a.id}
                href={a.url}
                className="flex items-center justify-between px-3 py-3 rounded-xl bg-white border border-indigo-100 active:bg-indigo-50 min-h-[48px]"
              >
                <div>
                  <p className="text-sm font-semibold text-gray-900">{friendlyAssessment(a.template_type)}</p>
                  <p className="text-[11px] text-gray-500">~ 2 minutes</p>
                </div>
                <span className="text-indigo-600 font-bold text-sm">Start →</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Next appointment */}
      {nextAppt && (
        <section className="rounded-2xl bg-white border border-gray-200 p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600 mb-1">Next session</p>
          <p className="text-lg font-bold text-gray-900">
            {new Date(nextAppt.scheduled_start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <p className="text-sm text-gray-600">
            {new Date(nextAppt.scheduled_start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            {' · '}
            <span className="text-brand-600 font-medium">{timeFromNow(nextAppt.scheduled_start)}</span>
          </p>
          {nextAppt.meet_url && (
            <a
              href={nextAppt.meet_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white font-semibold text-sm px-4 py-2.5 active:bg-brand-700 min-h-[44px]"
            >
              Join session
            </a>
          )}
        </section>
      )}

      {/* Latest message from therapist */}
      {latestMessage && (
        <section className="rounded-2xl bg-white border border-gray-200 p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">Latest message</p>
          <p className="text-sm text-gray-800 leading-relaxed line-clamp-3">{latestMessage.message}</p>
          <p className="text-[10px] text-gray-400 mt-2">{fmtDateTime(latestMessage.created_at)}</p>
        </section>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Assessments tab
// ══════════════════════════════════════════════════════════════════════════

function AssessmentsTab({ data }) {
  const all = data.assessments || []
  const pending   = all.filter(a => !a.completed_at && !a.expired)
  const completed = all.filter(a => a.completed_at).sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))

  return (
    <div className="px-4 py-5 space-y-5">
      {pending.length > 0 && (
        <section>
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-2 px-1">Waiting for you</p>
          <div className="space-y-2">
            {pending.map(a => (
              <a
                key={a.id}
                href={a.url}
                className="flex items-center justify-between px-4 py-4 rounded-2xl bg-white border border-indigo-200 active:bg-indigo-50 min-h-[64px]"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{friendlyAssessment(a.template_type)}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Sent {fmtDate(a.created_at)} · ~ 2 minutes
                  </p>
                </div>
                <span className="text-indigo-600 font-bold text-sm flex-shrink-0 ml-2">Start →</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 px-1">Completed</p>
          <div className="space-y-2">
            {completed.map(a => (
              <div key={a.id} className="px-4 py-3 rounded-2xl bg-white border border-gray-200">
                <p className="text-sm font-semibold text-gray-900">{friendlyAssessment(a.template_type)}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Completed {fmtDate(a.completed_at)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {pending.length === 0 && completed.length === 0 && (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-base font-semibold text-gray-900">No check-ins yet</p>
          <p className="text-sm text-gray-500 mt-1">When your clinician sends one, it'll show up here.</p>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Appointments tab
// ══════════════════════════════════════════════════════════════════════════

function AppointmentsTab({ data }) {
  const now = new Date()
  const all = data.appointments || []
  const upcoming = all.filter(a => new Date(a.scheduled_start) > now && a.status !== 'cancelled')
    .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start))
  const past = all.filter(a => new Date(a.scheduled_start) <= now || a.status === 'cancelled')
    .sort((a, b) => new Date(b.scheduled_start) - new Date(a.scheduled_start))

  return (
    <div className="px-4 py-5 space-y-5">
      {upcoming.length > 0 && (
        <section>
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600 mb-2 px-1">Upcoming</p>
          <div className="space-y-2">
            {upcoming.map(a => <ApptRow key={a.id} a={a} upcoming />)}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 px-1">Past</p>
          <div className="space-y-2">
            {past.slice(0, 15).map(a => <ApptRow key={a.id} a={a} />)}
          </div>
        </section>
      )}

      {all.length === 0 && (
        <div className="text-center py-16">
          <p className="text-base font-semibold text-gray-900">No sessions scheduled</p>
          <p className="text-sm text-gray-500 mt-1">Your clinician will schedule sessions with you.</p>
        </div>
      )}
    </div>
  )
}

function ApptRow({ a, upcoming }) {
  const d = new Date(a.scheduled_start)
  const cancelled = a.status === 'cancelled'
  return (
    <div className={`px-4 py-4 rounded-2xl bg-white border ${upcoming ? 'border-brand-200' : 'border-gray-200'} ${cancelled ? 'opacity-60' : ''}`}
      style={{ minHeight: 64 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            {' · '}
            {d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
          {a.appointment_type && (
            <p className="text-[11px] text-gray-500 capitalize mt-0.5">
              {a.appointment_type.replace(/_/g, ' ')}
            </p>
          )}
          {cancelled && (
            <p className="text-[10px] text-red-600 font-bold uppercase tracking-wider mt-1">Cancelled</p>
          )}
        </div>
        {upcoming && a.meet_url && !cancelled && (
          <a
            href={a.meet_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 rounded-lg bg-brand-600 text-white font-semibold text-xs px-3 py-2 active:bg-brand-700 min-h-[36px] flex items-center"
          >
            Join
          </a>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Messages tab
// ══════════════════════════════════════════════════════════════════════════

function MessagesTab({ data, token, onUpdate }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const endRef = useRef(null)
  const inputRef = useRef(null)

  const messages = [...(data.messages || [])].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleSend = async (e) => {
    e?.preventDefault?.()
    if (!text.trim() || sending) return
    setSending(true); setErr('')
    const body = text.trim()
    try {
      const res = await fetch(`${API}/public/portal/${token}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: body }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not send')
      onUpdate(prev => ({
        ...prev,
        messages: [...(prev.messages || []), {
          id: json.message_id || Date.now(),
          sender: 'client',
          message: body,
          created_at: new Date().toISOString(),
          read_at: null,
        }],
      }))
      setText('')
      inputRef.current?.focus()
    } catch (error) {
      setErr(error.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 200px)' }}>
      <div className="flex-1 px-4 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-base font-semibold text-gray-900">No messages yet</p>
            <p className="text-sm text-gray-500 mt-1 max-w-xs mx-auto">
              Send your clinician a message. They'll see it and reply when they're able to.
            </p>
          </div>
        ) : (
          messages.map(m => {
            const isClient = m.sender === 'client'
            return (
              <div key={m.id} className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] rounded-3xl px-4 py-2.5 ${
                  isClient
                    ? 'text-white rounded-br-md'
                    : 'bg-[#E9E9EB] text-gray-900 rounded-bl-md'
                }`}
                  style={isClient ? { background: 'linear-gradient(180deg, #0ac5a2, #0d9488)' } : {}}
                >
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{m.message}</p>
                  <p className={`text-[10px] mt-1.5 ${isClient ? 'text-teal-100' : 'text-gray-500'}`}>
                    {fmtDateTime(m.created_at)}
                  </p>
                </div>
              </div>
            )
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form onSubmit={handleSend}
        className="sticky bottom-0 bg-white border-t border-gray-100 px-3 py-3"
        style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}>
        {err && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 px-3 py-2 mb-2">
            {err}
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 flex items-center min-h-[44px]">
            <textarea
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e) }
              }}
              placeholder="Send your clinician a message…"
              rows={1}
              className="flex-1 bg-transparent outline-none resize-none text-[14px] text-gray-900 placeholder-gray-400"
              style={{ maxHeight: 120 }}
            />
          </div>
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-white disabled:opacity-40 active:scale-95 transition-transform"
            style={{ background: 'linear-gradient(180deg, #0ac5a2, #0d9488)' }}
            aria-label="Send"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Icons
// ══════════════════════════════════════════════════════════════════════════

function HomeIcon({ active }) {
  return (
    <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 0 : 1.75}>
      {active
        ? <path d="M11.47 3.841a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.061l-8.689-8.69a2.25 2.25 0 00-3.182 0l-8.69 8.69a.75.75 0 101.061 1.06l8.69-8.689z M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875h-3a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75h-3A1.875 1.875 0 013.75 19.875v-6.198a.75.75 0 00.091-.086L12 5.43z" />
        : <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      }
    </svg>
  )
}

function ClipIcon({ active }) {
  return (
    <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 0 : 1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function CalIcon({ active }) {
  return (
    <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 0 : 1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v4m8-4v4M3 10h18M5 6h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
    </svg>
  )
}

function ChatIcon({ active }) {
  return (
    <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 0 : 1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  )
}
