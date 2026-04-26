/**
 * MobileMiwa — full-screen Miwa chat optimized for mobile.
 * Streaming agent chat with voice input, quick action pills, auto-scroll.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, apiUpload } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { renderClinical } from '../../lib/renderClinical'

const QUICK_ACTIONS = [
  { label: 'Check in client', message: 'Check in my next client' },
  { label: 'Record session', route: '/m/record' },
  { label: 'Review caseload', message: 'Give me a caseload overview' },
  { label: "Today's briefs", message: "Show me today's pre-session briefs" },
]

// Shared clinical markdown renderer (app-wide styling)
const renderMarkdown = renderClinical

export default function MobileMiwa() {
  const { therapist } = useAuth()
  const navigate = useNavigate()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')

  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])

  // Auto-scroll to latest
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, streaming])

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 200)
  }, [])

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || streaming) return
    setInput('')
    setError('')

    const userMsg = { id: Date.now(), role: 'user', content: text }
    setMessages(m => [...m, userMsg])
    setStreaming(true)
    setStreamingText('')

    try {
      const res = await apiFetch('/agent/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          responseStyle: therapist?.assistant_verbosity || 'balanced',
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
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
              if (accumulated.trim()) {
                setMessages(m => [...m, { id: Date.now() + 1, role: 'assistant', content: accumulated }])
              }
              setStreamingText('')
              setStreaming(false)
            }
            if (data.error) throw new Error(data.error)
          } catch {}
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
          if (buffer.trim()) processEvent(buffer)
          if (streaming) {
            if (accumulated.trim()) {
              setMessages(m => [...m, { id: Date.now() + 2, role: 'assistant', content: accumulated }])
            }
            setStreamingText('')
            setStreaming(false)
          }
          break
        }
      }
    } catch (err) {
      setError(err.message || 'Something went wrong')
      setStreaming(false)
      setStreamingText('')
    }
  }, [streaming, therapist])

  const handleSubmit = (e) => {
    e?.preventDefault()
    sendMessage(input)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Voice input via MediaRecorder + Whisper transcription
  const toggleVoice = useCallback(async () => {
    if (listening) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      return
    }

    setListening(true)
    audioChunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4'

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setListening(false)

        if (audioChunksRef.current.length === 0) return

        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        const ext = mimeType.includes('webm') ? 'webm' : 'm4a'
        const formData = new FormData()
        formData.append('audio', blob, `voice.${ext}`)

        try {
          const res = await apiUpload('/agent/transcribe', formData)
          if (res.ok) {
            const data = await res.json()
            const text = data.transcript || data.text || ''
            if (text.trim()) {
              sendMessage(text)
            }
          }
        } catch {}
      }

      recorder.start(1000)
    } catch {
      setListening(false)
      setError('Microphone access denied')
    }
  }, [listening, sendMessage])

  const handleQuickAction = (action) => {
    if (action.route) {
      navigate(action.route)
    } else if (action.message) {
      sendMessage(action.message)
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* ── Messages area ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-2">
        {/* Quick action pills (shown when no messages) */}
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full -mt-8">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold mb-4"
              style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
            >
              M
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Hey, how can I help?</h2>
            <p className="text-sm text-gray-500 mb-6 text-center px-8">
              I can check in clients, review your schedule, generate notes, and more.
            </p>
            <div className="flex flex-wrap gap-2 justify-center px-2">
              {QUICK_ACTIONS.map((action, i) => (
                <button
                  key={i}
                  onClick={() => handleQuickAction(action)}
                  className="px-3.5 py-2 rounded-full border border-gray-200 bg-white text-sm text-gray-700 font-medium active:bg-gray-100 transition-colors shadow-sm"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quick pills row (shown above messages when there are messages) */}
        {messages.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1 scrollbar-hide">
            {QUICK_ACTIONS.map((action, i) => (
              <button
                key={i}
                onClick={() => handleQuickAction(action)}
                disabled={streaming}
                className="px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs text-gray-600 font-medium active:bg-gray-100 transition-colors shrink-0 disabled:opacity-50"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}

        {/* Message bubbles */}
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`mb-3 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-md'
                  : 'bg-white border border-gray-200 text-gray-800 rounded-bl-md shadow-sm'
              }`}
            >
              {msg.role === 'user' ? (
                <p className="text-sm leading-relaxed">{msg.content}</p>
              ) : (
                <div
                  className="text-sm leading-relaxed prose-mobile"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
              )}
            </div>
          </div>
        ))}

        {/* Streaming bubble */}
        {streaming && (
          <div className="mb-3 flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 bg-white border border-gray-200 shadow-sm">
              {streamingText ? (
                <div
                  className="text-sm leading-relaxed text-gray-800 prose-mobile"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingText) }}
                />
              ) : (
                <div className="flex gap-1 items-center py-1">
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ─────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-t border-gray-200 px-3 py-2.5">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          {/* Voice button */}
          <button
            type="button"
            onClick={toggleVoice}
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 ${
              listening
                ? 'bg-red-500 text-white animate-pulse'
                : 'bg-gray-100 text-gray-500 active:bg-gray-200'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </button>

          {/* Text input */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Miwa anything..."
              rows={1}
              className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 transition-colors max-h-24"
              style={{ fontSize: '16px' }}
              disabled={streaming}
            />
          </div>

          {/* Send button */}
          <button
            type="submit"
            disabled={!input.trim() || streaming}
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 ${
              input.trim() && !streaming
                ? 'bg-indigo-600 text-white active:bg-indigo-700'
                : 'bg-gray-100 text-gray-300'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  )
}
