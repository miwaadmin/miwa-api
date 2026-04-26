/**
 * MobileConsult — mobile-first case consultation chat.
 *
 * Not the desktop Supervisor page squeezed into a phone. A full-screen
 * chat UI built for thumbs: one textarea pinned to the bottom, bubbles
 * that breathe, a few "think out loud" starter prompts that matter for
 * case conceptualization.
 *
 * Hits the same /ai/chat endpoint as MobileMiwa and Supervisor — it's
 * framed differently (consultation prompts + a "pick a client" shortcut)
 * so the therapist gets into case-focused work fast.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { renderClinical } from '../../lib/renderClinical'

const STARTERS = [
  { label: 'Case conceptualization', prompt: 'Help me with case conceptualization for a client.' },
  { label: 'Treatment plan review',  prompt: 'Walk me through reviewing a treatment plan for a client who feels stuck.' },
  { label: 'Risk / safety thinking', prompt: 'I want to think through a risk and safety concern for a client.' },
  { label: 'Prep for supervision',   prompt: 'Help me prep a case presentation for supervision.' },
]

function Bubble({ role, content, loading }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`rounded-3xl px-4 py-2.5 max-w-[82%] ${
          isUser
            ? 'text-white rounded-br-md'
            : 'bg-[#E9E9EB] text-gray-900 rounded-bl-md'
        }`}
        style={isUser ? { background: 'linear-gradient(180deg, #2A8AFE, #007AFF)' } : {}}
      >
        {loading ? (
          <div className="flex items-center gap-1 py-1 px-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-pulse" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-pulse" style={{ animationDelay: '300ms' }} />
          </div>
        ) : isUser ? (
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{content}</p>
        ) : (
          <div
            className="text-[14px] leading-relaxed prose-clinical"
            dangerouslySetInnerHTML={{ __html: renderClinical(content || '') }}
          />
        )}
      </div>
    </div>
  )
}

export default function MobileConsult() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [conversationId, setConversationId] = useState(null)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  // Keep scroll pinned to bottom as messages arrive
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  const send = useCallback(async (text) => {
    const body = (text ?? input).trim()
    if (!body || sending) return
    setInput('')
    setSending(true)
    const userMsg = { id: Date.now(), role: 'user', content: body }
    setMessages(prev => [...prev, userMsg])
    try {
      const r = await apiFetch('/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: body,
          conversation_id: conversationId,
          context: { kind: 'consult' },
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || 'Chat failed')
      if (data.conversation_id) setConversationId(data.conversation_id)
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        content: data.reply || data.content || data.message || '',
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        content: `Sorry — I couldn't respond. ${err.message}`,
      }])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [input, sending, conversationId])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const isEmpty = messages.length === 0 && !sending

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-white">
        <h1 className="text-lg font-bold text-gray-900">Consult</h1>
        <p className="text-[11px] text-gray-500 mt-0.5">Clinical thought partner — case conceptualization, supervision prep</p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pt-4 pb-4">
        {isEmpty ? (
          <div className="pt-8 pb-4 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-4 text-white font-bold text-lg"
              style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}>
              M
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">What are you thinking through?</h2>
            <p className="text-sm text-gray-500 max-w-xs mx-auto leading-relaxed mb-6">
              Walk a case out loud. I'll help you think — I won't decide for you.
            </p>

            <div className="space-y-2 max-w-sm mx-auto">
              {STARTERS.map(s => (
                <button
                  key={s.label}
                  onClick={() => send(s.prompt)}
                  className="w-full text-left rounded-xl bg-gray-50 active:bg-gray-100 px-4 py-3 border border-gray-100 transition-colors"
                >
                  <p className="text-sm font-semibold text-gray-900">{s.label}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">{s.prompt}</p>
                </button>
              ))}
              <button
                onClick={() => navigate('/m/clients')}
                className="w-full text-center rounded-xl bg-white active:bg-gray-50 px-4 py-3 border border-gray-200 transition-colors"
              >
                <p className="text-sm font-semibold text-indigo-700">Pick a client to consult on →</p>
              </button>
            </div>
          </div>
        ) : (
          <>
            {messages.map(m => <Bubble key={m.id} role={m.role} content={m.content} />)}
            {sending && <Bubble role="assistant" loading />}
          </>
        )}
      </div>

      {/* Input pill */}
      <div className="shrink-0 bg-white border-t border-gray-100 px-3 py-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}>
        <div className="flex items-end gap-2">
          <div className="flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 flex items-center min-h-[44px]">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about a case…"
              rows={1}
              className="flex-1 bg-transparent outline-none resize-none text-[14px] text-gray-900 placeholder-gray-400"
              style={{ maxHeight: 120 }}
            />
          </div>
          <button
            onClick={() => send()}
            disabled={sending || !input.trim()}
            className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-white disabled:opacity-40 active:scale-95 transition-transform"
            style={{ background: 'linear-gradient(180deg, #2A8AFE, #007AFF)' }}
            aria-label="Send"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
