import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { renderClinical } from '../lib/renderClinical'

// Shared clinical markdown renderer (app-wide styling)
const renderMarkdown = renderClinical

function TypingIndicator() {
  return (
    <div className="flex items-end gap-3 message-enter">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-teal-500 flex items-center justify-center flex-shrink-0">
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      </div>
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-white/10 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-5">
          <div className="w-2 h-2 rounded-full bg-gray-400 typing-dot" />
          <div className="w-2 h-2 rounded-full bg-gray-400 typing-dot" />
          <div className="w-2 h-2 rounded-full bg-gray-400 typing-dot" />
        </div>
      </div>
    </div>
  )
}

function Message({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex items-end gap-3 message-enter ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-teal-500 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 shadow-sm text-sm leading-relaxed ${
          isUser
            ? 'bg-brand-600 text-white rounded-br-sm'
            : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-white/10 text-gray-800 dark:text-slate-100 rounded-bl-sm'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div
            className="prose-clinical"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
          />
        )}
        {msg.created_at && (
          <div className={`text-xs mt-1.5 ${isUser ? 'text-brand-200' : 'text-gray-400'}`}>
            {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── General prompt pool (randomized each page load) ────────────────────────
const GENERAL_PROMPT_POOL = [
  "Help me think through a differential for a client presenting with mood instability and erratic sleep",
  "What distinguishes ADHD from Bipolar II in adults presenting with attention difficulties?",
  "Walk me through differential considerations for a client with dissociative symptoms",
  "How do I differentiate PTSD from Borderline Personality Disorder in a client with complex trauma?",
  "My client disclosed suicidal ideation today — walk me through my documentation obligations",
  "A client just disclosed abuse — when does mandatory reporting apply in my state?",
  "My client threatened harm to a third party — what are my duty-to-warn obligations?",
  "What evidence-based approaches work best for treatment-resistant depression?",
  "Walk me through the phases of EMDR for a client with complex, multi-incident trauma",
  "What DBT skills are most effective for emotional dysregulation in young adults?",
  "What does the research say about CBT vs ACT for generalized anxiety?",
  "Help me write a defensible suicide risk assessment note for the chart",
  "What should be in a safety plan for a client with passive ideation but no plan or intent?",
  "How do I document a client's refusal of a higher level of care?",
  "How do I approach culturally adapted CBT for a client with collectivist family values?",
  "My client has significant immigration-related stressors — how does this intersect with depression?",
  "I'm feeling countertransference with a client — help me think through it",
  "How do I approach termination with a client who is making progress but resisting ending?",
  "What are the ICD-10-CM codes for PTSD with dissociation vs complex PTSD?",
  "What codes apply for depression with anxious distress specifier?",
  "What are early signs that a client may need a higher level of care?",
  "Help me think through a parallel process dynamic I'm noticing in supervision",
  "What should I consider when my client discloses their therapist previously breached confidentiality?",
]

function pickRandom(arr, n) {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n)
}

// Strip ICD codes, leading "Client presents with…" preamble, and truncate cleanly
function cleanClinicalText(text, max = 55) {
  if (!text) return null
  const stripped = text
    .replace(/\n/g, ' ')
    .replace(/\b[A-Z]\d{2}\.?\w*\b\s*/g, '')           // remove ICD codes
    .replace(/^(client\s+)?presents?\s+with\s+/i, '')   // strip "Client presents with"
    .replace(/^(client\s+)?is\s+presenting\s+with\s+/i, '')
    .replace(/^(client\s+)?reported?\s+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (stripped.length <= max) return stripped
  const cut = stripped.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 25 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]$/, '')
}

function buildPatientPrompts(patient) {
  const prompts = []
  const concerns = cleanClinicalText(patient.presenting_concerns, 55)
  const dx       = cleanClinicalText(patient.diagnoses, 50)
  const goal     = cleanClinicalText(patient.treatment_goals, 55)

  prompts.push(
    concerns
      ? `Help me build a case conceptualization for a client presenting with ${concerns.toLowerCase()}`
      : `Walk me through a case conceptualization framework for this client`
  )

  prompts.push(
    dx
      ? `What evidence-based interventions are most effective for ${dx}?`
      : `What assessment tools would help clarify this client's diagnosis?`
  )

  prompts.push(
    goal
      ? `My client wants to ${goal.replace(/^\d+\.\s*/, '').toLowerCase()} — what interventions best support this?`
      : `What treatment modalities are most indicated for this client's profile?`
  )

  prompts.push(
    patient.risk_screening
      ? `My client endorsed safety concerns at intake — walk me through an ongoing monitoring framework`
      : `What countertransference dynamics should I watch for with this client?`
  )

  return prompts
}

const STYLE_OPTIONS = [
  { id: 'balanced',  label: 'Balanced',  desc: 'Thorough but concise' },
  { id: 'concise',   label: 'Concise',   desc: 'Short, bullet-first answers' },
  { id: 'detailed',  label: 'Detailed',  desc: 'Deep explanations & research' },
]

export default function Supervisor() {
  const location = useLocation()
  const { therapist, refreshTherapist } = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [patients, setPatients] = useState([])
  const [contextType, setContextType] = useState('general')
  const [contextId, setContextId] = useState('')
  const [responseStyle, setResponseStyle] = useState(
    () => therapist?.assistant_verbosity || localStorage.getItem('miwa_response_style') || 'balanced'
  )
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  // Pick 4 random general prompts once per mount
  const generalPrompts = useRef(pickRandom(GENERAL_PROMPT_POOL, 4))

  // Handle navigation state (from PatientDetail "Discuss in AI Chat" and chat widget Full view)
  useEffect(() => {
    if (location.state?.contextType === 'patient') {
      setContextType('patient')
      setContextId(String(location.state.contextId))
    }
    if (location.state?.initialPrompt) {
      setInput(location.state.initialPrompt)
      setTimeout(() => textareaRef.current?.focus(), 80)
    }
  }, [location.state])

  useEffect(() => {
    Promise.all([
      apiFetch('/ai/chat-history?limit=50').then(r => r.json()),
      apiFetch('/patients').then(r => r.json()),
    ]).then(([history, pts]) => {
      setMessages(Array.isArray(history) ? history : [])
      setPatients(Array.isArray(pts) ? pts : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, streaming])

  useEffect(() => {
    if (therapist?.assistant_verbosity) {
      setResponseStyle(therapist.assistant_verbosity)
      localStorage.setItem('miwa_response_style', therapist.assistant_verbosity)
    }
  }, [therapist?.assistant_verbosity])

  const handleStyleChange = async (style) => {
    setResponseStyle(style)
    localStorage.setItem('miwa_response_style', style)
    try {
      const res = await apiFetch('/auth/me', {
        method: 'PUT',
        body: JSON.stringify({ assistant_verbosity: style }),
      })
      const data = await res.json()
      if (res.ok) refreshTherapist(data.therapist, data.token)
    } catch {
      // keep local preference even if server save fails
    }
  }

  const sendText = useCallback(async (text) => {
    if (!text.trim() || streaming) return

    setInput('')
    setError('')

    const userMsg = { id: Date.now(), role: 'user', content: text, created_at: new Date().toISOString() }
    setMessages(m => [...m, userMsg])
    setStreaming(true)
    setStreamingText('')

    try {
      const payload = {
        message: text,
        contextType: contextType !== 'general' ? contextType : null,
        contextId: contextId ? parseInt(contextId) : null,
        responseStyle,
      }

      const res = await apiFetch('/ai/chat', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Chat failed')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let buffer = ''

      const processEvent = (rawEvent) => {
        const lines = rawEvent.split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.text) {
              accumulated += data.text
              setStreamingText(accumulated)
            }
            if (data.type === 'done' || data.done) {
              setMessages(m => [...m, {
                id: Date.now() + 1,
                role: 'assistant',
                content: accumulated,
                created_at: new Date().toISOString(),
              }])
              setStreamingText('')
              setStreaming(false)
            }
            if (data.error) throw new Error(data.error)
          } catch (e) {
            // skip parse errors for partial chunks
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (value) {
          buffer += decoder.decode(value, { stream: !done })
          let separatorIndex
          while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, separatorIndex).trim()
            buffer = buffer.slice(separatorIndex + 2)
            if (rawEvent) processEvent(rawEvent)
          }
        }
        if (done) {
          const tail = buffer.trim()
          if (tail) processEvent(tail)
          break
        }
      }
      setStreaming(false)
    } catch (err) {
      setError(err.message)
      setStreaming(false)
      setStreamingText('')
    }
  }, [streaming, contextType, contextId, responseStyle])

  const sendMessage = useCallback(() => sendText(input.trim()), [input, sendText])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const clearHistory = async () => {
    if (!confirm('Clear all chat history? This cannot be undone.')) return
    await apiFetch('/ai/chat-history', { method: 'DELETE' })
    setMessages([])
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar — hidden on mobile */}
      <div className="hidden md:flex flex-shrink-0 px-6 py-3 bg-white border-b border-gray-100 items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-teal-500 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">Miwa</div>
            <div className="text-xs text-gray-500">25+ years clinical experience · DSM-5-TR · ICD-10-CM</div>
          </div>
        </div>

        <div className="flex items-center gap-4 ml-auto flex-wrap">
          {/* Response style pills */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-400 font-medium mr-0.5">Style:</label>
            {STYLE_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => handleStyleChange(opt.id)}
                title={opt.desc}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium border transition-all ${
                  responseStyle === opt.id
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-brand-300 hover:text-brand-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Context selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 font-medium">Context:</label>
            <select
              className="text-xs border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-gray-700 dark:text-slate-100 bg-white dark:bg-slate-900 focus:outline-none focus:border-brand-400"
              value={contextType}
              onChange={e => { setContextType(e.target.value); setContextId('') }}
            >
              <option value="general">General</option>
              <option value="patient">Patient</option>
            </select>
            {contextType === 'patient' && (
              <select
                className="text-xs border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-gray-700 dark:text-slate-100 bg-white dark:bg-slate-900 focus:outline-none focus:border-brand-400"
                value={contextId}
                onChange={e => setContextId(e.target.value)}
              >
                <option value="">Select patient...</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>{p.client_id}</option>
                ))}
              </select>
            )}
          </div>

          <button
            onClick={clearHistory}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50"
          >
            Clear history
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-4 bg-gray-50">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 && !streaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-100 to-teal-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900 mb-2">
              {therapist?.full_name
                ? `Hello, ${therapist.full_name.split(' ')[0]}.`
                : 'Hello.'}
            </h3>

            {/* Context-aware subtitle */}
            {contextType === 'patient' && contextId ? (() => {
              const pt = patients.find(p => String(p.id) === String(contextId))
              return (
                <p className="text-sm text-gray-500 max-w-sm mb-5">
                  Consulting on <span className="font-semibold text-brand-600">{pt?.client_id || 'this client'}</span>. Miwa has read their sessions, notes, and history.
                </p>
              )
            })() : (
              <p className="text-sm text-gray-500 max-w-sm mb-5">
                I'm Miwa. What would you like to consult on today?
              </p>
            )}

            {/* Starter prompts */}
            {(() => {
              const isPatient = contextType === 'patient' && contextId
              const pt = isPatient ? patients.find(p => String(p.id) === String(contextId)) : null
              const suggestions = pt ? buildPatientPrompts(pt) : generalPrompts.current
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
                  {suggestions.map(s => (
                    <button
                      key={s}
                      onClick={() => sendText(s)}
                      className={`text-left text-xs rounded-xl p-3 border transition-all hover:shadow-sm ${
                        isPatient
                          ? 'bg-brand-50 border-brand-100 text-brand-700 hover:border-brand-300 hover:bg-brand-100'
                          : 'text-gray-600 dark:text-slate-300 bg-white dark:bg-slate-800 border-gray-200 dark:border-white/10 hover:border-brand-300 hover:text-brand-700 dark:hover:text-brand-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )
            })()}

            {/* Style reminder */}
            <p className="text-[11px] text-gray-400 mt-4">
              Response style: <span className="font-medium text-gray-500 capitalize">{responseStyle}</span>
              {' · '}
              <button
                className="underline hover:text-brand-500"
                onClick={() => {
                  const idx = STYLE_OPTIONS.findIndex(o => o.id === responseStyle)
                  handleStyleChange(STYLE_OPTIONS[(idx + 1) % STYLE_OPTIONS.length].id)
                }}
              >
                change
              </button>
            </p>
          </div>
        ) : (
          <>
            {messages.map(msg => (
              <Message key={msg.id} msg={msg} />
            ))}
            {streaming && streamingText && (
              <div className="flex items-end gap-3 message-enter">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-teal-500 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div className="max-w-[75%] rounded-2xl rounded-bl-sm px-4 py-3 bg-white border border-gray-200 shadow-sm text-sm text-gray-800 leading-relaxed">
                  <div
                    className="prose-clinical"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingText) }}
                  />
                  <span className="inline-block w-1.5 h-4 bg-brand-400 ml-0.5 animate-pulse rounded-sm" />
                </div>
              </div>
            )}
            {streaming && !streamingText && <TypingIndicator />}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="flex-shrink-0 mx-6 mb-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700 flex items-center gap-2">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error.includes('API key') ? (
            <span>{error} <Link to="/settings" className="underline font-medium">Go to Settings</Link></span>
          ) : error}
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-slate-950 border-t border-gray-100 dark:border-white/10">
        {/* Mobile context controls */}
        <div className="flex md:hidden items-center gap-2 mb-2">
          <select
            className="text-xs border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-gray-700 dark:text-slate-100 bg-white dark:bg-slate-900 focus:outline-none focus:border-brand-400 flex-1"
            value={contextType}
            onChange={e => { setContextType(e.target.value); setContextId('') }}
          >
            <option value="general">General context</option>
            <option value="patient">Patient context</option>
          </select>
          {contextType === 'patient' && (
            <select
              className="text-xs border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-gray-700 dark:text-slate-100 bg-white dark:bg-slate-900 focus:outline-none focus:border-brand-400 flex-1"
              value={contextId}
              onChange={e => setContextId(e.target.value)}
            >
              <option value="">Select patient...</option>
              {patients.map(p => (
                <option key={p.id} value={p.id}>{p.client_id}</option>
              ))}
            </select>
          )}
          <button
            onClick={clearHistory}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50 whitespace-nowrap"
          >
            Clear
          </button>
        </div>
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              className="w-full resize-none rounded-xl border border-gray-300 dark:border-white/10 px-4 py-3 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 bg-white dark:bg-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-opacity-20 transition-colors pr-12"
              placeholder="Ask Miwa a clinical question... (Shift+Enter for new line, Enter to send)"
              value={input}
              onChange={e => {
                setInput(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
              }}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={streaming}
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming}
            className="flex-shrink-0 w-11 h-11 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
          >
            {streaming ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center mt-2">
          Miwa provides AI clinical support only, not a replacement for licensed supervision or professional judgment.
        </p>
      </div>
    </div>
  )
}
