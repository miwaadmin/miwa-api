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

function looksLikeTreatmentPlan(text) {
  return /treatment plan|treatment goal|goal\s+\d|objective|interventions/i.test(text || '')
}

function Message({ msg, canSavePlan = false, onSavePlan, savingPlan = false, onFollowUp }) {
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
          <>
            <div
              className="prose-clinical"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
            />
            {canSavePlan && (
              <div className="mt-3 pt-3 border-t border-white/10 flex justify-end">
                <button
                  type="button"
                  onClick={() => onSavePlan?.(msg)}
                  disabled={savingPlan}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-500 hover:bg-teal-400 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-2 transition-colors"
                >
                  {savingPlan ? (
                    <span className="w-3.5 h-3.5 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M4.5 19.5h15a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5h-15A1.5 1.5 0 0 0 3 6v12a1.5 1.5 0 0 0 1.5 1.5Z" />
                    </svg>
                  )}
                  Save to client plan
                </button>
              </div>
            )}
            {onFollowUp && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-white/10">
                {FOLLOW_UP_ACTIONS.map(action => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => onFollowUp(action.prompt)}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-brand-300 hover:text-brand-700 dark:border-white/10 dark:text-slate-300 dark:hover:text-brand-200"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </>
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
  "My client disclosed suicidal ideation today, walk me through my documentation obligations",
  "A client just disclosed abuse, when does mandatory reporting apply in my state?",
  "My client threatened harm to a third party, what are my duty-to-warn obligations?",
  "What evidence-based approaches work best for treatment-resistant depression?",
  "Walk me through the phases of EMDR for a client with complex, multi-incident trauma",
  "What DBT skills are most effective for emotional dysregulation in young adults?",
  "What does the research say about CBT vs ACT for generalized anxiety?",
  "Help me write a defensible suicide risk assessment note for the chart",
  "What should be in a safety plan for a client with passive ideation but no plan or intent?",
  "How do I document a client's refusal of a higher level of care?",
  "How do I approach culturally adapted CBT for a client with collectivist family values?",
  "My client has significant immigration-related stressors, how does this intersect with depression?",
  "I'm feeling countertransference with a client, help me think through it",
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
      ? `My client wants to ${goal.replace(/^\d+\.\s*/, '').toLowerCase()}, what interventions best support this?`
      : `What treatment modalities are most indicated for this client's profile?`
  )

  prompts.push(
    patient.risk_screening
      ? `My client endorsed safety concerns at intake, walk me through an ongoing monitoring framework`
      : `What countertransference dynamics should I watch for with this client?`
  )

  return prompts
}

function patientLabel(patient) {
  return patient?.client_label || patient?.display_name || patient?.client_name || patient?.patient_name || patient?.client_id || 'Client'
}

function conversationPatientLabel(conversation) {
  const name = [conversation?.first_name, conversation?.last_name].filter(Boolean).join(' ').trim()
  return name || conversation?.client_id || null
}

function conversationTitle(conversation) {
  if (!conversation) return 'New consult'
  const client = conversationPatientLabel(conversation)
  if (client) return client
  return conversation.title || 'Consult session'
}

function conversationTime(value) {
  if (!value) return ''
  const date = new Date(value)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function truncate(text, max = 76) {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text
}

const STYLE_OPTIONS = [
  { id: 'balanced',  label: 'Balanced',  desc: 'Thorough but concise' },
  { id: 'concise',   label: 'Concise',   desc: 'Short, bullet-first answers' },
  { id: 'detailed',  label: 'Detailed',  desc: 'Deep explanations & research' },
]

const FOLLOW_UP_ACTIONS = [
  { label: 'Go deeper', prompt: 'Go deeper on that and explain the clinical reasoning behind it.' },
  { label: 'Make it practical', prompt: 'Turn that into a practical next-session plan with specific interventions.' },
  { label: 'Draft chart language', prompt: 'Draft concise chart language I could adapt for documentation.' },
  { label: 'Ask me what matters', prompt: 'Ask me the most important follow-up questions before we go further.' },
]

export default function Supervisor() {
  const location = useLocation()
  const { therapist, refreshTherapist } = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [error, setError] = useState('')
  const [patients, setPatients] = useState([])
  const [conversations, setConversations] = useState([])
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [contextType, setContextType] = useState('general')
  const [contextId, setContextId] = useState('')
  const [responseStyle, setResponseStyle] = useState(
    () => therapist?.assistant_verbosity || localStorage.getItem('miwa_response_style') || 'balanced'
  )
  const [imageAttachments, setImageAttachments] = useState([])
  const [savingPlanId, setSavingPlanId] = useState(null)
  const [planSaveNotice, setPlanSaveNotice] = useState('')
  const [liveEmbedded, setLiveEmbedded] = useState(false)
  const [liveEmbeddedStatus, setLiveEmbeddedStatus] = useState('Starting…')
  const [liveEmbeddedMessages, setLiveEmbeddedMessages] = useState([])
  const [liveEmbeddedMicMuted, setLiveEmbeddedMicMuted] = useState(false)
  const [liveEmbeddedAssistantSpeaking, setLiveEmbeddedAssistantSpeaking] = useState(false)
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  // Pick 4 random general prompts once per mount
  const generalPrompts = useRef(pickRandom(GENERAL_PROMPT_POOL, 4))
  const activeConversation = conversations.find(c => String(c.id) === String(activeConversationId))

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

  const loadConversations = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const data = await apiFetch('/ai/consult-conversations?limit=60').then(r => r.json())
      setConversations(Array.isArray(data) ? data : [])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    Promise.all([
      loadConversations(),
      apiFetch('/patients').then(r => r.json()),
    ]).then(([, pts]) => {
      setMessages([])
      setPatients(Array.isArray(pts) ? pts : [])
      setLoading(false)
    }).catch(() => {
      setMessages([])
      setLoading(false)
      setHistoryLoading(false)
    })
  }, [loadConversations])

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

  const addImageFiles = useCallback((files) => {
    const list = Array.from(files || []).filter(file => file.type?.startsWith('image/')).slice(0, 3)
    if (!list.length) return
    list.forEach(file => {
      if (file.size > 5 * 1024 * 1024) {
        setError('Image is too large. Please use an image under 5 MB.')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        setImageAttachments(prev => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random()}`,
            name: file.name || 'image',
            mimeType: file.type,
            dataUrl: reader.result,
          },
        ].slice(0, 3))
      }
      reader.onerror = () => setError('Could not read that image.')
      reader.readAsDataURL(file)
    })
  }, [])

  const handlePaste = useCallback((e) => {
    const files = Array.from(e.clipboardData?.files || []).filter(file => file.type?.startsWith('image/'))
    if (files.length) addImageFiles(files)
  }, [addImageFiles])

  const handleDrop = useCallback((e) => {
    const files = Array.from(e.dataTransfer?.files || []).filter(file => file.type?.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    addImageFiles(files)
  }, [addImageFiles])

  const startFreshConsult = useCallback(() => {
    setActiveConversationId(null)
    setMessages([])
    setInput('')
    setStreamingText('')
    setError('')
    setImageAttachments([])
    setTimeout(() => textareaRef.current?.focus(), 80)
  }, [])

  const openConversation = useCallback(async (conversation) => {
    if (!conversation || streaming) return
    setLoading(true)
    setError('')
    try {
      const history = await apiFetch(`/ai/chat-history?limit=80&conversationId=${encodeURIComponent(conversation.id)}`).then(r => r.json())
      setActiveConversationId(conversation.id)
      setMessages(Array.isArray(history) ? history : [])
      setContextType(conversation.context_type || 'general')
      setContextId(conversation.context_id ? String(conversation.context_id) : '')
    } catch (err) {
      setError(err.message || 'Could not open that consult session')
    } finally {
      setLoading(false)
    }
  }, [streaming])

  const sendText = useCallback(async (text) => {
    const attachmentsToSend = imageAttachments
    const cleanText = text.trim()
    const messageText = cleanText || (attachmentsToSend.length ? 'Please describe what is visible in this image and help me think through any clinically relevant details.' : '')
    if (!messageText || streaming) return

    setInput('')
    setError('')

    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: attachmentsToSend.length ? `${messageText}\n\n[Attached ${attachmentsToSend.length} image${attachmentsToSend.length === 1 ? '' : 's'}]` : messageText,
      created_at: new Date().toISOString(),
    }
    setMessages(m => [...m, userMsg])
    setStreaming(true)
    setStreamingText('')

    try {
      const payload = {
        message: messageText,
        conversationId: activeConversationId,
        contextType: contextType !== 'general' ? contextType : null,
        contextId: contextId ? parseInt(contextId) : null,
        responseStyle,
        imageAttachments: attachmentsToSend.map(({ name: _name, id: _id, ...attachment }) => attachment),
      }
      setImageAttachments([])

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
              if (data.conversation_id) setActiveConversationId(data.conversation_id)
              setMessages(m => [...m, {
                id: Date.now() + 1,
                role: 'assistant',
                content: accumulated,
                created_at: new Date().toISOString(),
              }])
              setStreamingText('')
              setStreaming(false)
              loadConversations()
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
  }, [streaming, activeConversationId, contextType, contextId, responseStyle, loadConversations, imageAttachments])

  const sendMessage = useCallback(() => sendText(input.trim()), [input, sendText])

  const savePlanToClient = useCallback(async (msg) => {
    if (!msg?.content || contextType !== 'patient' || !contextId) return
    const patientId = parseInt(contextId, 10)
    if (!patientId) return
    const msgKey = msg.id || msg.created_at || msg.content.slice(0, 24)
    setSavingPlanId(msgKey)
    setPlanSaveNotice('')
    setError('')
    try {
      const res = await apiFetch(`/ai/treatment-plan/${patientId}/import`, {
        method: 'POST',
        body: JSON.stringify({ content: msg.content, conversationId: activeConversationId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save treatment plan')
      setPlanSaveNotice(`Saved to client profile with ${data.goals_created || 0} goals.`)
    } catch (err) {
      setError(err.message || 'Could not save treatment plan')
    } finally {
      setSavingPlanId(null)
    }
  }, [contextType, contextId, activeConversationId])

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
    setActiveConversationId(null)
    setConversations([])
  }

  // Listen for messages/status/stopped events from MiwaChat embedded mode
  useEffect(() => {
    const onMsg = e => {
      const msg = e?.detail?.message
      if (msg) setLiveEmbeddedMessages(prev => [...prev, msg])
    }
    const onStatus = e => {
      const status = e?.detail?.status
      if (status) setLiveEmbeddedStatus(status)
    }
    const onStopped = () => {
      setLiveEmbedded(false)
      setLiveEmbeddedMessages([])
      setLiveEmbeddedStatus('Starting…')
      setLiveEmbeddedMicMuted(false)
      setLiveEmbeddedAssistantSpeaking(false)
    }
    const onMicState = e => {
      const muted = !!e?.detail?.muted
      setLiveEmbeddedMicMuted(muted)
    }
    const onAssistantState = e => {
      const speaking = !!e?.detail?.speaking
      setLiveEmbeddedAssistantSpeaking(speaking)
    }
    window.addEventListener('miwa-live-embedded-message', onMsg)
    window.addEventListener('miwa-live-embedded-status', onStatus)
    window.addEventListener('miwa-live-embedded-stopped', onStopped)
    window.addEventListener('miwa-live-embedded-mic-state', onMicState)
    window.addEventListener('miwa-live-embedded-assistant-state', onAssistantState)
    return () => {
      window.removeEventListener('miwa-live-embedded-message', onMsg)
      window.removeEventListener('miwa-live-embedded-status', onStatus)
      window.removeEventListener('miwa-live-embedded-stopped', onStopped)
      window.removeEventListener('miwa-live-embedded-mic-state', onMicState)
      window.removeEventListener('miwa-live-embedded-assistant-state', onAssistantState)
    }
  }, [])

  const startConsultLive = useCallback(() => {
    setLiveEmbedded(true)
    setLiveEmbeddedMessages([])
    setLiveEmbeddedStatus('Starting…')
    window.dispatchEvent(new CustomEvent('miwa-live-start-embedded', { detail: { mode: 'conversation' } }))
  }, [])

  return (
    <div className="flex h-full min-h-0 bg-gray-50 dark:bg-slate-950">
      <aside className="hidden lg:flex w-72 xl:w-80 shrink-0 flex-col border-r border-gray-200 dark:border-white/10 bg-white dark:bg-slate-950">
        <div className="p-4 border-b border-gray-100 dark:border-white/10">
          <button
            onClick={startFreshConsult}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-3 py-2.5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New consult
          </button>
        </div>

        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Consult history</h2>
          <button onClick={loadConversations} className="text-xs text-gray-400 hover:text-brand-600">Refresh</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-4 space-y-1">
          {historyLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm font-medium text-gray-600 dark:text-slate-300">No consults yet</p>
              <p className="text-xs text-gray-400 mt-1">Past sessions will appear here after Miwa responds.</p>
            </div>
          ) : (
            conversations.map(conversation => {
              const selected = String(activeConversationId) === String(conversation.id)
              return (
                <button
                  key={conversation.id}
                  onClick={() => openConversation(conversation)}
                  className={`w-full text-left rounded-xl px-3 py-3 transition-colors border ${
                    selected
                      ? 'bg-brand-50 dark:bg-brand-500/10 border-brand-200 dark:border-brand-500/30'
                      : 'bg-transparent border-transparent hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-semibold truncate ${selected ? 'text-brand-700 dark:text-brand-200' : 'text-gray-800 dark:text-slate-100'}`}>
                      {conversationTitle(conversation)}
                    </p>
                    <span className="text-[11px] text-gray-400 shrink-0">{conversationTime(conversation.updated_at)}</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 leading-snug line-clamp-2">
                    {truncate(conversation.last_message || conversation.title || 'Consult session')}
                  </p>
                  {conversation.message_count ? (
                    <p className="text-[10px] text-gray-400 mt-1.5">{conversation.message_count} messages</p>
                  ) : null}
                </button>
              )
            })
          )}
        </div>
      </aside>

      <div className="flex flex-col min-w-0 flex-1 h-full">
      {/* Top bar, hidden on mobile */}
      <div className="hidden md:flex flex-shrink-0 px-6 py-3 bg-white border-b border-gray-100 items-center gap-4 dark:bg-slate-900 dark:border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-teal-500 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <span>Miwa</span>
              <span title="Miwa is online" className="h-2 w-2 rounded-full bg-teal-500 shadow-[0_0_0_3px_rgba(20,184,166,0.15)]" />
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400">
              {activeConversation ? conversationTitle(activeConversation) : 'Consult Live is ready to think with you'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 ml-auto flex-wrap">
          <button
            type="button"
            onClick={() => {
              if (liveEmbedded) {
                window.dispatchEvent(new CustomEvent('miwa-live-stop'))
                setLiveEmbedded(false)
                setLiveEmbeddedMessages([])
                setLiveEmbeddedStatus('Starting…')
              } else {
                startConsultLive()
              }
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors ${
              liveEmbedded
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-emerald-500 hover:bg-emerald-600'
            }`}
            title={liveEmbedded ? 'Stop Miwa Live' : 'Start Miwa Live on the Consult page'}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6.75 6.75 0 0 0 6.75-6.75M12 18.75A6.75 6.75 0 0 1 5.25 12M12 18.75V21m0 0h3m-3 0H9m3-5.25a3.75 3.75 0 0 1-3.75-3.75V6.75a3.75 3.75 0 1 1 7.5 0V12A3.75 3.75 0 0 1 12 15.75Z" />
            </svg>
            {liveEmbedded ? 'Stop live' : 'Miwa Live'}
          </button>

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
                    : 'bg-white text-gray-500 border-gray-200 hover:border-brand-300 hover:text-brand-600 dark:bg-slate-900 dark:text-slate-300 dark:border-white/10 dark:hover:text-brand-200'
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
                  <option key={p.id} value={p.id}>{patientLabel(p)}</option>
                ))}
              </select>
            )}
          </div>

          <button
            onClick={clearHistory}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10"
          >
            Clear history
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-4 bg-gray-50 dark:bg-slate-950">
        {liveEmbedded ? (
          <div className="flex flex-col h-full -mx-3 md:-mx-6 -my-4">
            {/* Live header bar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white dark:bg-slate-900 dark:border-white/10 flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-semibold text-gray-800 dark:text-white">Miwa Live</span>
                {liveEmbeddedAssistantSpeaking ? (
                  <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    <span className="flex items-end gap-[2px] h-3">
                      {[0, 1, 2].map(i => (
                        <span
                          key={i}
                          className="w-[2px] rounded-full bg-emerald-500 dark:bg-emerald-300"
                          style={{
                            height: `${6 + (i % 2) * 4}px`,
                            animation: `pulse ${0.5 + i * 0.12}s ease-in-out infinite alternate`,
                          }}
                        />
                      ))}
                    </span>
                    Miwa is speaking…
                  </span>
                ) : (
                  <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
                    Listening…
                  </span>
                )}
                <span className="hidden sm:inline text-xs text-gray-500 dark:text-slate-400 truncate">{liveEmbeddedStatus}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('miwa-live-embedded-toggle-mute'))}
                  disabled={liveEmbeddedAssistantSpeaking}
                  title={liveEmbeddedMicMuted ? 'Unmute your live mic' : 'Mute your live mic'}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    liveEmbeddedAssistantSpeaking
                      ? 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400 cursor-not-allowed'
                      : liveEmbeddedMicMuted
                        ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-300 dark:hover:bg-red-500/30'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:bg-transparent dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5'
                  }`}
                >
                  {liveEmbeddedMicMuted ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 5l14 14M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6M19 11a7 7 0 01-.11 1.23M12 19v3m-4 0h8" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4m-4 0h8" />
                    </svg>
                  )}
                  {liveEmbeddedAssistantSpeaking ? 'Auto-muted' : liveEmbeddedMicMuted ? 'Muted' : 'Mute'}
                </button>
                <button
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('miwa-live-stop'))
                    setLiveEmbedded(false)
                    setLiveEmbeddedMessages([])
                    setLiveEmbeddedStatus('Starting…')
                    setLiveEmbeddedMicMuted(false)
                    setLiveEmbeddedAssistantSpeaking(false)
                  }}
                  className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 dark:bg-transparent dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  Stop live
                </button>
              </div>
            </div>
            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {liveEmbeddedMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <div className="flex items-end gap-1 h-10">
                    {[0, 1, 2, 3, 4].map(i => (
                      <div
                        key={i}
                        className="w-1.5 rounded-full bg-emerald-400"
                        style={{
                          height: `${20 + (i % 3) * 8}px`,
                          animation: `pulse ${0.6 + i * 0.1}s ease-in-out infinite alternate`,
                        }}
                      />
                    ))}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-slate-400">{liveEmbeddedStatus}</p>
                </div>
              ) : (
                liveEmbeddedMessages.map((msg, i) => (
                  <div key={msg.id ?? i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-tr-sm'
                        : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-slate-100 rounded-tl-sm'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : loading ? (
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
            <h3 className="text-base font-semibold text-gray-900 mb-2 dark:text-white">
              {therapist?.full_name
                ? `Hello, ${therapist.full_name.split(' ')[0]}.`
                : 'Hello.'}
            </h3>

            {/* Context-aware subtitle */}
            {contextType === 'patient' && contextId ? (() => {
              const pt = patients.find(p => String(p.id) === String(contextId))
              return (
                <p className="text-sm text-gray-500 max-w-sm mb-5 dark:text-slate-300">
                  Consulting on <span className="font-semibold text-brand-600">{patientLabel(pt)}</span>. Miwa has read their sessions, notes, and history.
                </p>
              )
            })() : (
              <p className="text-sm text-gray-500 max-w-md mb-5 dark:text-slate-300">
                I'm Miwa. Bring me the messy middle. I will reason with you, ask what matters, and help turn it into next steps.
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
            <p className="text-[11px] text-gray-400 mt-4 dark:text-slate-500">
              Response style: <span className="font-medium text-gray-500 capitalize dark:text-slate-300">{responseStyle}</span>
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
              <Message
                key={msg.id}
                msg={msg}
                canSavePlan={
                  msg.role === 'assistant'
                  && contextType === 'patient'
                  && !!contextId
                  && looksLikeTreatmentPlan(msg.content)
                }
                onSavePlan={savePlanToClient}
                savingPlan={savingPlanId === (msg.id || msg.created_at || msg.content?.slice(0, 24))}
                onFollowUp={streaming ? null : sendText}
              />
            ))}
            {streaming && streamingText && (
              <div className="flex items-end gap-3 message-enter">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-teal-500 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div className="max-w-[75%] rounded-2xl rounded-bl-sm px-4 py-3 bg-white border border-gray-200 shadow-sm text-sm text-gray-800 leading-relaxed dark:bg-slate-800 dark:border-white/10 dark:text-slate-100">
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

      {planSaveNotice && (
        <div className="flex-shrink-0 mx-6 mb-2 rounded-lg bg-teal-50 border border-teal-200 px-4 py-2 text-sm text-teal-800 flex items-center gap-2">
          <svg className="w-4 h-4 text-teal-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <span>{planSaveNotice}</span>
          {contextType === 'patient' && contextId && (
            <Link to={`/patients/${contextId}`} className="ml-auto text-xs font-semibold text-teal-700 hover:text-teal-900">
              Open profile
            </Link>
          )}
          <button onClick={() => setPlanSaveNotice('')} className="text-teal-500 hover:text-teal-700">
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
                <option key={p.id} value={p.id}>{patientLabel(p)}</option>
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
        {imageAttachments.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-4xl gap-2 overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-2">
            {imageAttachments.map(img => (
              <div key={img.id} className="relative flex-shrink-0">
                <img src={img.dataUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => setImageAttachments(prev => prev.filter(item => item.id !== img.id))}
                  className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-gray-900 text-[10px] text-white"
                  title="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <div className="flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => {
                addImageFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              className="h-11 w-11 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-40 flex items-center justify-center transition-colors"
              title="Attach image"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <rect x="4" y="5" width="16" height="14" rx="2" />
                <path strokeLinecap="round" strokeLinejoin="round" d="m8 14 2.5-2.5L14 15l1.5-1.5L18 16" />
                <circle cx="9" cy="9" r="1" />
              </svg>
            </button>
          </div>
          <div className="flex-1 relative" onPaste={handlePaste} onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
            <textarea
              ref={textareaRef}
              className="w-full resize-none rounded-xl border border-gray-300 dark:border-white/10 px-4 py-3 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 bg-white dark:bg-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-opacity-20 transition-colors pr-12"
              placeholder="Ask Miwa a clinical question, or paste/drop an image..."
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
            aria-label="Send message"
            onClick={sendMessage}
            disabled={(!input.trim() && imageAttachments.length === 0) || streaming}
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
    </div>
  )
}
