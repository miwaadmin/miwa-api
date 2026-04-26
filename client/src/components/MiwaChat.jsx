/**
 * MiwaChat — floating chat panel available on every protected page.
 * Opens as a compact panel (bottom-right). Auto-detects patient context from URL.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { apiFetch, apiUpload } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { renderClinical } from '../lib/renderClinical'

/**
 * Heuristic: should this message be run in the background instead of
 * blocking the chat?
 *
 * "Task" messages are ones where the user is delegating work — Miwa
 * should go do it and report back, not chat synchronously. Examples:
 *   "Analyze my caseload"
 *   "Generate a quarterly outcomes report"
 *   "Find clients whose PHQ-9 is rising"
 *   "Draft a treatment plan summary for everyone on medication"
 *
 * Quick-Q messages stay on the sync chat path:
 *   "What does PHQ-9 mean?"
 *   "Yes"
 *   "Schedule Jane for 3pm tomorrow"   (action with approval flow)
 *
 * The heuristic errs toward SYNC when uncertain — worst case, something
 * that could have been background runs in-chat (slight wait). Routing a
 * quick question to the background would be much more annoying (user has
 * to go check the inbox for a two-word answer).
 */
function looksLikeBackgroundTask(text) {
  if (!text) return false
  const t = text.trim()

  // Very short messages are almost always conversational.
  if (t.length < 25) return false

  // Questions tend to be quick Qs, not tasks.
  // Exception: "Analyze X" phrased as "can you analyze X?" → still a task.
  // We only skip pure questions that DON'T contain an action verb.
  const startsWithInterrogative = /^\s*(what|why|how(?!\s+many)|who|when|where|is|are|does|do|can|could|will|would|should)\b/i.test(t)

  // Action verbs that almost always mean "go do this."
  const TASK_VERBS = /\b(analy[sz]e|generate|create|compile|draft|write|summari[sz]e|review|audit|find(?!\s+out\s+if)|identify|list|search|look\s+through|go\s+through|research|build|put\s+together|pull\s+together|run\s+(?:a|an)|produce|prepare|compose|figure\s+out|cross-reference|map\s+out)\b/i

  // Scope phrases that imply touching multiple patients / lots of data.
  const SCOPE_NOUNS = /\b(all\s+(?:my\s+)?clients?|all\s+(?:my\s+)?patients?|every\s+(?:client|patient)|entire\s+caseload|my\s+caseload|whole\s+caseload|quarterly|monthly|weekly\s+report|across\s+(?:the\s+)?caseload|trend(?:s)?|patterns?|report|breakdown|overview|outcomes?\s+(?:trend|chart|summary))\b/i

  // Explicit background hints.
  const BACKGROUND_HINT = /\b(in\s+the\s+background|take\s+your\s+time|no\s+rush|when\s+you\s+can|later|work\s+on\s+this)\b/i

  const hasTaskVerb = TASK_VERBS.test(t)
  const hasScope    = SCOPE_NOUNS.test(t)
  const isExplicit  = BACKGROUND_HINT.test(t)

  if (isExplicit) return true
  if (hasTaskVerb && hasScope) return true               // "analyze all my clients"
  if (hasTaskVerb && t.length > 80) return true          // long + action verb
  if (hasScope && t.length > 60) return true             // caseload-wide + not trivial
  // Pure question with no task verb → sync
  if (startsWithInterrogative && !hasTaskVerb) return false
  // Default: sync (safer — background is opt-in via signal, not opt-out).
  return false
}

// Convert ISO dates to spoken form: 2026-03-26 → "March 26th"
function formatDatesForSpeech(text) {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, _y, mo, dy) => {
    const m = parseInt(mo, 10), d = parseInt(dy, 10)
    const sfx = [11,12,13].includes(d) ? 'th' : d % 10 === 1 ? 'st' : d % 10 === 2 ? 'nd' : d % 10 === 3 ? 'rd' : 'th'
    return `${MONTHS[m - 1]} ${d}${sfx}`
  })
}

/**
 * Transform text into natural spoken language before sending to TTS.
 * Handles clinical notation, abbreviations, list formatting, and punctuation
 * so the nova voice reads smoothly instead of robotically.
 */
function stripForSpeech(text) {
  let s = text
    // ── Markdown / HTML ──────────────────────────────────────────
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,4}\s+/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    // Client code tokens → just the readable code
    .replace(/\[([A-Z0-9\-]+)\]/g, '$1')

    // ── Clinical assessment names: "PHQ-9" → "PHQ 9" ─────────────
    // Removes hyphen before the number so TTS reads the name then the number
    .replace(/\b(PHQ|GAD|PCL|DAS|RAS|CSSRS|FAD)-(\d)/gi, '$1 $2')

    // ── Score fractions: "14/27" → "14 out of 27" ─────────────────
    .replace(/(\d+)\/(\d+)/g, '$1 out of $2')

    // ── Percentages: "85%" → "85 percent" ─────────────────────────
    .replace(/(\d+\.?\d*)%/g, '$1 percent')

    // ── Score changes: "+5 points" → "up 5 points" ────────────────
    .replace(/\+(\d+)\s*(points?|pts?)/gi, 'up $1 $2')
    .replace(/-(\d+)\s*(points?|pts?)/gi, 'down $1 $2')

    // ── Clinical severity in parens: "(moderate)" → "— moderate" ──
    .replace(/\((mild|moderate|severe|minimal|critical|low|high)\)/gi, ', $1,')

    // ── Common abbreviations ───────────────────────────────────────
    .replace(/\be\.g\.\s*/gi, 'for example, ')
    .replace(/\bi\.e\.\s*/gi, 'that is, ')
    .replace(/\betc\.\s*/gi, 'and so on. ')
    .replace(/\bvs\.\s*/gi, 'versus ')
    .replace(/\bapprox\.\s*/gi, 'approximately ')
    .replace(/\bw\/\s*/gi, 'with ')
    .replace(/\bw\/o\s*/gi, 'without ')

    // ── Em/en dashes → natural spoken pause ───────────────────────
    .replace(/\s*[—–]\s*/g, ', ')

    // ── Ellipsis → pause ──────────────────────────────────────────
    .replace(/\.\.\./g, '. ')

    // ── Numbered list items: "1. " at line start → removed ────────
    .replace(/^\s*\d+\.\s+/gm, '')

    // ── Bullet points ──────────────────────────────────────────────
    .replace(/^\s*[-•*]\s*/gm, '')

    // ── Section label colons at line end → sentence break ─────────
    .replace(/:\s*\n/g, '. ')

    // ── Slash between words → "or" ─────────────────────────────────
    .replace(/\s*\/\s*/g, ' or ')

    // ── Newlines → spoken pauses ───────────────────────────────────
    .replace(/\n\n+/g, '. ')
    .replace(/\n/g, ' ')

    // ── Clean up double punctuation / spaces ──────────────────────
    .replace(/([.!?,])\s*\1+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()

  return formatDatesForSpeech(s)
}

// Shared clinical markdown renderer (app-wide styling)
const renderMarkdown = renderClinical

function TypingDots() {
  return (
    <div className="flex gap-1 items-center py-1">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  )
}

// Detect patient ID from current URL path
function usePatientContext() {
  const location = useLocation()
  const match = location.pathname.match(/^\/patients\/(\d+)/)
  return match ? match[1] : null
}

// Floating Miwa is always the agent — action-first, concise.
// Deep clinical analysis lives on the Consult page (/consult).

export default function MiwaChat() {
  const { therapist } = useAuth()
  const patientId = usePatientContext()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState('')
  const [patients, setPatients] = useState([])
  const [patientName, setPatientName] = useState(null)
  const [unread, setUnread] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  const [reportLink, setReportLink] = useState(null)
  const [pendingDisambiguation, setPendingDisambiguation] = useState(null) // { name, originalMessage, options }
  const [pendingBatchPicker, setPendingBatchPicker] = useState(null) // { assessmentType, patients, spreadOption }
  const [batchSelected, setBatchSelected] = useState([]) // selected patient IDs

  const [voiceEnabled, setVoiceEnabled] = useState(false)  // auto-speak mode
  const [listening, setListening] = useState(false)         // recording mic
  const [speaking, setSpeaking] = useState(false)           // TTS actively playing
  const [loadingAudio, setLoadingAudio] = useState(false)   // TTS request in-flight
  const [voiceSupported] = useState(() =>
    typeof window !== 'undefined' && !!window.MediaRecorder && !!window.speechSynthesis
  )

  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const prevOpenRef = useRef(false)
  const mediaRecorderRef = useRef(null)

  // ── Draggable floating button ────────────────────────────────────────────
  // Persists position per-user in localStorage. null = use default bottom-right.
  // Position stored as {x, y} in px from top-left.
  const [fabPos, setFabPos] = useState(() => {
    try {
      const stored = localStorage.getItem('miwa_fab_pos')
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })
  const dragStateRef = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0, moved: false })

  const handleFabMouseDown = useCallback((e) => {
    // Only start drag on primary button
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    dragStateRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
      moved: false,
    }
    e.preventDefault()
  }, [])

  const handleFabTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = e.touches[0]
    dragStateRef.current = {
      dragging: true,
      startX: t.clientX,
      startY: t.clientY,
      origX: rect.left,
      origY: rect.top,
      moved: false,
    }
  }, [])

  useEffect(() => {
    function move(clientX, clientY) {
      const s = dragStateRef.current
      if (!s.dragging) return
      const dx = clientX - s.startX
      const dy = clientY - s.startY
      // Mark as "moved" once pointer travels more than 4px — used to suppress click
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) s.moved = true
      const size = 56 // w-14
      const maxX = window.innerWidth - size - 4
      const maxY = window.innerHeight - size - 4
      const nx = Math.min(Math.max(4, s.origX + dx), maxX)
      const ny = Math.min(Math.max(4, s.origY + dy), maxY)
      setFabPos({ x: nx, y: ny })
    }
    function onMouseMove(e) { move(e.clientX, e.clientY) }
    function onTouchMove(e) {
      if (e.touches.length !== 1) return
      move(e.touches[0].clientX, e.touches[0].clientY)
    }
    function end() {
      const s = dragStateRef.current
      if (!s.dragging) return
      s.dragging = false
      if (s.moved) {
        // Persist new position
        try { localStorage.setItem('miwa_fab_pos', JSON.stringify(fabPos)) } catch {}
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', end)
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', end)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', end)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', end)
    }
  }, [fabPos])

  const handleFabClick = useCallback(() => {
    // Suppress the click that fires at the end of a drag
    if (dragStateRef.current.moved) {
      dragStateRef.current.moved = false
      return
    }
    setIsOpen(o => !o)
  }, [])
  const audioChunksRef = useRef([])
  const voiceEnabledRef = useRef(false)
  const speakRef = useRef(null)
  const audioRef = useRef(null)   // holds the current AudioBufferSourceNode for TTS
  const audioCtxRef = useRef(null) // Web Audio API context (unlocked during user gesture)

  // Keep voiceEnabled ref in sync
  useEffect(() => { voiceEnabledRef.current = voiceEnabled }, [voiceEnabled])

  // Cancel TTS when panel closes — use audioRef directly to avoid TDZ
  useEffect(() => {
    if (!isOpen) {
      if (audioRef.current) {
        try { audioRef.current.stop() } catch {}
        audioRef.current = null
      }
      setSpeaking(false)
      setLoadingAudio(false)
    }
  }, [isOpen])

  // Load patients list once
  useEffect(() => {
    apiFetch('/patients').then(r => r.json()).then(pts => {
      if (Array.isArray(pts)) setPatients(pts)
    }).catch(() => {})
  }, [])

  // ── Auto-onboarding: pop MiwaChat on first login if onboarding not done ──
  // Only runs once per session. Fetches /settings to see if onboarding_completed,
  // and if not, auto-opens + seeds an intro message from Miwa.
  const onboardingAttempted = useRef(false)
  useEffect(() => {
    if (!therapist || onboardingAttempted.current) return
    onboardingAttempted.current = true
    apiFetch('/settings').then(r => r.json()).then(settings => {
      if (settings?.onboarding_completed) return
      // Skip if we've already shown the onboarding intro this session
      if (sessionStorage.getItem('miwa_onboarding_shown')) return
      sessionStorage.setItem('miwa_onboarding_shown', '1')

      const firstName = therapist?.first_name || therapist?.full_name?.split(' ')[0] || 'there'
      const intro = `Hi ${firstName}! I'm Miwa, your clinical copilot. 👋

Before we get to work, I'd love to get to know you — how you think about therapy, how you like to work, and how I can show up as the most useful copilot possible. The more you tell me here, the less you'll have to explain later.

Answer in any order, any format (paragraph, bullets, stream-of-consciousness — whatever feels natural). Skip anything that doesn't apply. Takes about 5 minutes.

---

**🪪 About you**

1. **What should I call you?** (first name, Dr. Last Name, nickname — whatever you prefer)

2. **How long have you been practicing, and what kind of license do you hold?** (LMFT, LCSW, psychologist, associate, pre-license, etc. — optional but helpful context)

3. **Who do you typically work with?** Populations, age ranges, presenting concerns, modalities (individual, couples, family, group)?

---

**🧠 How you work**

4. **What's your therapeutic orientation?** Primary approach + any specific modalities you lean on (CBT, EFT, IFS, psychodynamic, narrative, family systems, somatic, integrative, etc.)

5. **How do you like to document?** SOAP, DAP, BIRP, narrative, something else? Anything you always want in a note, or anything you never want?

6. **What do you most want me to help with?** (e.g. faster notes, clinical second opinion, treatment planning, admin, outreach, tracking outcomes, supervision-style reflection, etc.)

---

**🎙️ How I should show up**

7. **Communication style** — concise and scannable, balanced, or detailed and thorough?

8. **Tone** — warm and collegial, clinical and precise, direct and punchy, reflective, something else?

9. **Hard rules or pet peeves** — things I should *never* do or say. (e.g. "never use client names, always codes" / "don't recommend meds" / "don't hedge, just tell me what you think" / "no emojis" / "push back when I'm wrong")

10. **Anything else I should know about you or your practice?** Values, training lineage, setting (private practice, agency, telehealth only), boundaries, things that matter to you clinically.

---

When you're done, I'll save this as your profile and refer back to it in every conversation. You can always update it later in **Settings → Assistant**.`

      setMessages([
        { id: 'onboarding-intro', role: 'assistant', content: intro, onboarding: true },
      ])
      setIsOpen(true)
    }).catch(() => {})
  }, [therapist])

  // Resolve patient name when on a patient page
  useEffect(() => {
    if (patientId && patients.length > 0) {
      const pt = patients.find(p => String(p.id) === String(patientId))
      setPatientName(pt?.client_id || null)
    } else {
      setPatientName(null)
    }
  }, [patientId, patients])

  // Scroll to bottom whenever messages/streaming update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, streaming])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
    prevOpenRef.current = isOpen
    if (isOpen) setUnread(false)
  }, [isOpen])

  const sendText = useCallback(async (text, contextOverride = null) => {
    if (!text.trim() || streaming) return
    setInput('')
    setError('')
    setPendingAction(null)
    setReportLink(null)
    setPendingDisambiguation(null)
    setPendingBatchPicker(null)
    setBatchSelected([])

    const userMsg = { id: Date.now(), role: 'user', content: text }
    setMessages(m => [...m, userMsg])
    setStreaming(true)
    setStreamingText('')

    // ── Auto-route long-running "do this for me" messages to the background
    //   task runner. This is the "agentic" behavior the user asked for:
    //   Miwa decides whether something is a task vs. a quick question, and
    //   backgrounds it automatically — no explicit button required.
    //
    //   Signals that a message is a TASK (run in background):
    //     • action verb at the start (analyze, generate, draft, compile,
    //       summarize, review, find, research, build, put together, etc.)
    //     • scope phrase ("all clients", "my caseload", "every patient")
    //     • explicit user ask ("in the background", "take your time", "later")
    //
    //   We SKIP background routing if:
    //     • message references a specific patient in context (contextOverride
    //       is set, or user is on a patient page) — those are interactive
    //     • it's a yes/no / clarifying question / short greeting
    //     • onboarding flow (handled below)
    //     • a pending-action flow (approval, picker, disambiguation)
    // Compute here because the existing onboarding branch below uses the
    // same check; we want to respect it but not depend on ordering.
    const lastMsgIsOnboarding = messages.length > 0 && messages[messages.length - 1]?.onboarding
    if (!lastMsgIsOnboarding && !contextOverride && !pendingAction && !pendingBatchPicker && !pendingDisambiguation) {
      const shouldRunAsTask = looksLikeBackgroundTask(text)
      if (shouldRunAsTask) {
        try {
          const res = await apiFetch('/agent/tasks', {
            method: 'POST',
            body: JSON.stringify({ prompt: text }),
          })
          if (res.ok) {
            const task = await res.json()
            setMessages(m => [...m, {
              id: Date.now() + 1,
              role: 'assistant',
              content: `🕊️ On it — I'll work on this in the background. I'll notify you as soon as it's done. You can close this chat and keep working; the result will show up in your Tasks inbox (top-right) when ready.\n\n*Task:* ${task.title}`,
            }])
            setStreaming(false)
            setStreamingText('')
            return
          }
          // If the task endpoint errored, fall through to sync chat so the
          // user still gets a response — background is an optimization, not a
          // hard requirement.
        } catch {
          // Same: fall through to sync chat on any failure.
        }
      }
    }

    // ── Onboarding branch: if the last Miwa message was the onboarding intro,
    //   route this response through /api/onboarding/soul to build SOUL.md.
    const lastIsOnboarding = messages.length > 0 && messages[messages.length - 1]?.onboarding
    if (lastIsOnboarding) {
      try {
        const res = await apiFetch('/onboarding/soul', {
          method: 'POST',
          body: JSON.stringify({ response: text }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Onboarding failed')
        setMessages(m => [...m, {
          id: Date.now() + 1,
          role: 'assistant',
          content: data.message || 'Saved. Ready when you are.',
        }])
      } catch (err) {
        setError(err.message || 'Could not save onboarding profile')
        setMessages(m => [...m, {
          id: Date.now() + 1,
          role: 'assistant',
          content: `I couldn't save your profile just now — but no worries, I'll remember what you said for this conversation. You can update it later in Settings.`,
        }])
      } finally {
        setStreaming(false)
        setStreamingText('')
      }
      return
    }

    // contextOverride lets disambiguation re-send with a specific patient locked in
    const effectivePatientId = contextOverride?.contextId ?? (patientId ? parseInt(patientId) : null)
    const effectiveContextType = effectivePatientId ? 'patient' : null

    try {
      const endpoint = '/agent/chat'
      const payload = {
        message: text,
        contextType: effectiveContextType,
        contextId: effectivePatientId,
        responseStyle: therapist?.assistant_verbosity || 'balanced',
      }

      const res = await apiFetch(endpoint, {
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
            if (data.type === 'approval_required') {
              if (accumulated.trim()) {
                setMessages(m => [...m, { id: Date.now() + 1, role: 'assistant', content: accumulated }])
                accumulated = ''
                setStreamingText('')
              }
              setPendingAction(data)
            }
            if (data.type === 'report_ready') {
              setReportLink(data)
            }
            if (data.type === 'clarify' && data.questions?.length) {
              setMessages(m => [...m, {
                id: Date.now() + 2,
                role: 'assistant',
                content: `${data.text || 'I need a little more detail.'}\n\n- ${data.questions.join('\n- ')}`,
              }])
            }
            if (data.type === 'disambiguate' && data.options?.length) {
              setPendingDisambiguation({
                name: data.name,
                originalMessage: data.originalMessage,
                options: data.options,
              })
            }
            if (data.type === 'client_created') {
              setMessages(m => [...m, {
                id: Date.now() + 9,
                role: 'system_action',
                actionType: 'client_created',
                clientId: data.clientId,
                displayName: data.displayName,
                clientType: data.clientType,
                sessionModality: data.sessionModality,
              }])
            }
            if (data.type === 'batch_assessment_picker' && data.patients?.length) {
              setPendingBatchPicker(data)
              setBatchSelected(data.patients.map(p => p.id)) // default all selected
            }
            if (data.type === 'done' || data.done) {
              if (accumulated.trim()) {
                if (voiceEnabledRef.current && speakRef.current) {
                  // Voice mode: hold text until audio starts to prevent the
                  // "text shows 15 sec before sound" problem.
                  // Cap TTS input to 350 chars → ~1-2 sec generation time,
                  // then text + audio appear together.
                  setStreamingText('')
                  // Keep streaming=true so user sees the typing indicator while
                  // the audio request is in-flight (1-2 sec).
                  speakRef.current(accumulated, 350).then(() => {
                    setMessages(m => [...m, { id: Date.now() + 3, role: 'assistant', content: accumulated }])
                    setStreaming(false)
                  }).catch(() => {
                    // TTS failed — show text anyway
                    setMessages(m => [...m, { id: Date.now() + 3, role: 'assistant', content: accumulated }])
                    setStreaming(false)
                  })
                } else {
                  setMessages(m => [...m, { id: Date.now() + 3, role: 'assistant', content: accumulated }])
                  setStreamingText('')
                  setStreaming(false)
                }
              } else {
                setStreamingText('')
                setStreaming(false)
              }
              if (!isOpen) setUnread(true)
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
  }, [streaming, patientId, therapist?.assistant_verbosity, isOpen])

  // External prompt bridge for guided actions from pages like Schedule
  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail
      const text = typeof detail === 'string' ? detail : String(detail?.text || '').trim()
      if (!text) return
      setInput(text)
      setError('')
      setIsOpen(true)
      setUnread(false)
      setTimeout(() => textareaRef.current?.focus(), 80)
      if (detail?.send) {
        setTimeout(() => sendText(text), 120)
      }
    }

    window.addEventListener('miwa-chat-prompt', handler)
    return () => window.removeEventListener('miwa-chat-prompt', handler)
  }, [sendText])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendText(input.trim())
    }
  }

  const confirmPendingAction = async (approved) => {
    if (!pendingAction?.actionId) return
    try {
      if (approved) {
        const res = await apiFetch('/agent/confirm', {
          method: 'POST',
          body: JSON.stringify({ actionId: pendingAction.actionId, approved: true }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not confirm action')
        setMessages(m => [...m, {
          id: Date.now(),
          role: 'assistant',
          content: data.appointment
            ? `✅ Scheduled — ${data.appointment.client_id} · ${data.appointment.scheduled_start ? new Date(data.appointment.scheduled_start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'time TBD'} · ${data.appointment.appointment_type}`
            : 'Done.',
        }])
        if (data.appointment) {
          window.dispatchEvent(new CustomEvent('miwa:appointment_created', { detail: data.appointment }))
        }
      } else {
        await apiFetch('/agent/confirm', {
          method: 'POST',
          body: JSON.stringify({ actionId: pendingAction.actionId, approved: false }),
        })
        setMessages(m => [...m, { id: Date.now(), role: 'assistant', content: 'Cancelled that action.' }])
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setPendingAction(null)
    }
  }

  const downloadReport = async (downloadUrl, title = 'miwa-report.pdf') => {
    try {
      const res = await apiFetch(downloadUrl)
      if (!res.ok) throw new Error('Could not download report')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = title
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message)
    }
  }

  const confirmBatchAssessments = async () => {
    if (!pendingBatchPicker || batchSelected.length === 0) return
    try {
      const res = await apiFetch('/agent/batch-assessments-confirm', {
        method: 'POST',
        body: JSON.stringify({
          selectedPatientIds: batchSelected,
          assessmentType: pendingBatchPicker.assessmentType,
          spreadOption: pendingBatchPicker.spreadOption || 'now',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Batch send failed')
      const count = data.sent ?? data.count ?? batchSelected.length
      setMessages(m => [...m, {
        id: Date.now(),
        role: 'assistant',
        content: `Queued ${count} ${pendingBatchPicker.assessmentType} link${count !== 1 ? 's' : ''} — ${pendingBatchPicker.spreadOption === 'spread' ? 'spread over 24 hours' : 'sending now'}.`,
      }])
      setPendingBatchPicker(null)
      setBatchSelected([])
    } catch (err) {
      setError(err.message)
    }
  }

  // ── Voice: TTS via Azure OpenAI ───────────────────────────────────────────
  // Using AudioContext instead of new Audio() because AudioContext that was
  // created + resumed inside a user gesture stays unlocked for async playback.
  // new Audio().play() called after an async gap is silently blocked by Chrome.

  const speak = useCallback(async (text, maxChars = 4096) => {
    const clean = stripForSpeech(text).slice(0, maxChars)
    if (!clean) return
    // Stop any in-progress playback
    if (audioRef.current) {
      try { audioRef.current.stop() } catch {}
      audioRef.current = null
    }
    // Show "generating audio" while the TTS request is in-flight
    setLoadingAudio(true)
    try {
      const res = await apiFetch('/agent/tts', {
        method: 'POST',
        body: JSON.stringify({ text: clean }),
      })
      if (!res.ok) throw new Error('TTS request failed')
      const arrayBuffer = await res.arrayBuffer()

      // Ensure context exists and is running
      let ctx = audioCtxRef.current
      if (!ctx || ctx.state === 'closed') {
        ctx = new (window.AudioContext || window.webkitAudioContext)()
        audioCtxRef.current = ctx
      }
      if (ctx.state === 'suspended') await ctx.resume()

      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)
      // setSpeaking(true) here — audio is actually starting RIGHT NOW
      setLoadingAudio(false)
      setSpeaking(true)
      source.onended = () => { setSpeaking(false); audioRef.current = null }
      source.start(0)
      audioRef.current = source
    } catch (err) {
      console.error('[Miwa TTS]', err)
      setLoadingAudio(false)
      setSpeaking(false)
    }
  }, [])

  // Keep speakRef current so sendText closure can call it
  useEffect(() => { speakRef.current = speak }, [speak])

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      try { audioRef.current.stop() } catch {}
      audioRef.current = null
    }
    setSpeaking(false)
    setLoadingAudio(false)
  }, [])

  // ── Voice: STT (Whisper) ──────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (listening || streaming) return
    stopSpeaking()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Find a Whisper-compatible recording format (varies by device/browser)
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']
        .find(t => MediaRecorder.isTypeSupported(t)) || ''
      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream) // use device default
      audioChunksRef.current = []
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        setListening(false)
        if (blob.size < 500) return // too short — ignore

        try {
          setStreaming(true)
          setStreamingText('Transcribing…')
          const form = new FormData()
          const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('mpeg') ? 'mp3' : mimeType.includes('wav') ? 'wav' : mimeType.includes('ogg') ? 'ogg' : 'webm'
          form.append('audio', blob, `recording.${ext}`)
          const res = await apiUpload('/agent/transcribe', form)
          const data = await res.json()
          if (!res.ok || !data.text) throw new Error(data.error || 'Transcription failed')
          setStreamingText('')
          setStreaming(false)
          if (voiceEnabledRef.current) {
            // Voice mode: auto-send transcript
            sendText(data.text)
          } else {
            // Manual mode: drop transcript into text box
            setInput(data.text)
            setTimeout(() => textareaRef.current?.focus(), 50)
          }
        } catch (err) {
          setStreaming(false)
          setStreamingText('')
          setError(err.message)
        }
      }

      mediaRecorder.start()
      setListening(true)
    } catch {
      setError('Microphone access denied — check browser permissions.')
    }
  }, [listening, streaming, stopSpeaking, sendText])

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    } else {
      setListening(false)
    }
  }, [])

  const firstName = therapist?.first_name || therapist?.full_name?.split(' ')[0] || 'there'

  return (
    <>
      {/* ── Floating button — draggable, position persisted in localStorage ── */}
      <button
        data-tour="miwa-chat"
        onClick={handleFabClick}
        onMouseDown={handleFabMouseDown}
        onTouchStart={handleFabTouchStart}
        aria-label="Open Miwa assistant (drag to move)"
        title="Click to open, drag to move"
        className={
          fabPos
            ? 'fixed z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-shadow duration-200 hover:scale-105 active:scale-95 cursor-grab active:cursor-grabbing'
            : 'fixed bottom-24 right-4 md:bottom-6 md:right-6 z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-shadow duration-200 hover:scale-105 active:scale-95 cursor-grab active:cursor-grabbing'
        }
        style={{
          background: 'linear-gradient(135deg, #5746ed, #0ac5a2)',
          boxShadow: isOpen
            ? '0 0 0 3px rgba(87,70,237,0.3), 0 8px 32px rgba(87,70,237,0.4)'
            : '0 4px 20px rgba(87,70,237,0.4)',
          ...(fabPos ? { left: fabPos.x + 'px', top: fabPos.y + 'px', touchAction: 'none' } : {}),
        }}
      >
        {isOpen ? (
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        ) : (
          /* Miwa logo — M with teal dot */
          <svg width="30" height="30" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M8 28 L8 16 C8 11 12.5 9 16.5 13.5 L20 19.5 L23.5 13.5 C27.5 9 32 11 32 16 L32 28"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              strokeOpacity="0.95"
            />
            <circle cx="20" cy="19.5" r="3" fill="#2dd4bf" />
            <circle cx="20" cy="19.5" r="5.5" fill="#2dd4bf" fillOpacity="0.25" />
            <circle cx="19.2" cy="18.5" r="1.1" fill="white" fillOpacity="0.65" />
          </svg>
        )}
        {unread && !isOpen && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white" />
        )}
      </button>

      {/* ── Chat panel ── */}
      {isOpen && (
        <div
          className="fixed z-50 flex flex-col overflow-hidden rounded-2xl shadow-2xl"
          style={{
            ...(() => {
              // Panel anchors to the FAB — whichever corner the FAB sits in,
              // the panel opens toward the opposite side so it stays on screen.
              // Default bottom-right when FAB hasn't been dragged.
              const base = {
                width: 'min(calc(100vw - 2rem), 390px)',
                height: 'min(calc(100vh - 8rem), 540px)',
              };
              if (!fabPos) return { ...base, bottom: '5.5rem', right: '1rem' };
              const FAB_SIZE = 56;
              const GAP = 12;
              const PANEL_W = Math.min(390, (typeof window !== 'undefined' ? window.innerWidth : 800) - 24);
              const PANEL_H = Math.min(540, (typeof window !== 'undefined' ? window.innerHeight : 700) - 24);
              const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
              const vh = typeof window !== 'undefined' ? window.innerHeight : 700;
              const fabCenterX = fabPos.x + FAB_SIZE / 2;
              // Vertical: prefer above FAB, fall back to below if no room
              let top;
              if (fabPos.y - GAP - PANEL_H >= GAP) {
                top = fabPos.y - GAP - PANEL_H;
              } else if (fabPos.y + FAB_SIZE + GAP + PANEL_H <= vh - GAP) {
                top = fabPos.y + FAB_SIZE + GAP;
              } else {
                top = Math.max(GAP, vh - PANEL_H - GAP);
              }
              // Horizontal: anchor panel's nearest edge to FAB's nearest edge,
              // then clamp so it never leaves the viewport.
              let left;
              if (fabCenterX > vw / 2) {
                left = fabPos.x + FAB_SIZE - PANEL_W;
              } else {
                left = fabPos.x;
              }
              left = Math.max(GAP, Math.min(left, vw - PANEL_W - GAP));
              return {
                width: PANEL_W + 'px',
                height: PANEL_H + 'px',
                left: left + 'px',
                top: top + 'px',
              };
            })(),
            background: 'white',
            border: '1px solid rgba(87,70,237,0.15)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.18), 0 0 0 1px rgba(87,70,237,0.1)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
          >
            <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M8 28 L8 16 C8 11 12.5 9 16.5 13.5 L20 19.5 L23.5 13.5 C27.5 9 32 11 32 16 L32 28"
                  stroke="white"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  strokeOpacity="0.95"
                />
                <circle cx="20" cy="19.5" r="3" fill="#2dd4bf" />
                <circle cx="19.2" cy="18.5" r="1.1" fill="white" fillOpacity="0.65" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white leading-tight">Miwa</div>
              {patientName ? (
                <div className="text-xs text-white/70 truncate">Consulting on {patientName}</div>
              ) : (
                <div className="text-xs text-white/70">Agent · Schedule · Assess · Report</div>
              )}
            </div>
            {/* Voice mode toggle — pill button, hard to miss */}
            {voiceSupported && (
              <button
                onClick={() => {
                  const next = !voiceEnabled
                  setVoiceEnabled(next)
                  if (next) {
                    // Create and resume AudioContext inside the user gesture so
                    // it stays unlocked for async TTS playback later.
                    const ctx = new (window.AudioContext || window.webkitAudioContext)()
                    audioCtxRef.current = ctx
                    ctx.resume().catch(() => {})
                  } else {
                    stopSpeaking()
                  }
                }}
                title={voiceEnabled ? 'Voice mode on — click to turn off' : 'Turn on voice mode'}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all flex-shrink-0 ${
                  voiceEnabled
                    ? 'bg-white text-brand-700 shadow-md'
                    : 'bg-white/15 text-white/80 hover:bg-white/25 hover:text-white'
                }`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                {voiceEnabled ? 'Voice on' : 'Voice'}
              </button>
            )}

            <button
              onClick={() => setIsOpen(false)}
              className="text-white/70 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10 flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50/60">
            {messages.length === 0 && !streaming ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-4">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 shadow-lg" style={{ background: 'linear-gradient(135deg,#5746ed,#0ac5a2)' }}>
                  <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
                    <path d="M8 28 L8 16 C8 11 12.5 9 16.5 13.5 L20 19.5 L23.5 13.5 C27.5 9 32 11 32 16 L32 28" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" strokeOpacity="0.95" />
                    <circle cx="20" cy="19.5" r="3" fill="#2dd4bf" />
                    <circle cx="20" cy="19.5" r="5.5" fill="#2dd4bf" fillOpacity="0.25" />
                    <circle cx="19.2" cy="18.5" r="1.1" fill="white" fillOpacity="0.65" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-gray-800">
                  Hi {firstName}! 👋
                </p>
                <p className="text-xs text-gray-500 mt-1 max-w-[260px]">
                  {patientName
                    ? `I can schedule, send an assessment, pull a report, or find resources for ${patientName}.`
                    : 'I can schedule sessions, send assessments, generate reports, search clinical resources, check your billing, or help you learn any feature. Just ask!'}
                </p>
                <p className="text-[10px] text-gray-400 mt-2 max-w-[260px] leading-relaxed">
                  💡 <strong className="text-gray-500">Found a bug or wishing for a feature?</strong> Just tell me — I'll send your feedback straight to the Miwa team.
                </p>
                <p className="text-[10px] text-gray-400 mt-2 max-w-[240px]">
                  For deep clinical consultation, use the{' '}
                  <a href="/consult" className="text-brand-500 hover:underline">Consult page →</a>
                </p>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('miwa-start-tour'))}
                  className="mt-3 px-3 py-1.5 rounded-lg text-[11px] font-medium text-brand-600 border border-brand-200 hover:bg-brand-50 transition-colors"
                >
                  Take an App Tour
                </button>
              </div>
            ) : (
              <>
                {messages.map(msg => {
                  const isUser = msg.role === 'user'

                  if (msg.role === 'system_action' && msg.actionType === 'client_created') {
                    return (
                      <div key={msg.id} className="flex items-start gap-2">
                        <div className="w-6 h-6 rounded-lg flex-shrink-0 mt-0.5 flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#059669,#0ac5a2)' }}>
                          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <div className="rounded-xl rounded-bl-sm px-3 py-2 text-xs shadow-sm border" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                          <p className="font-semibold" style={{ color: '#166534' }}>Client profile created</p>
                          <p style={{ color: '#15803d' }}>{msg.displayName} · <span className="font-mono">{msg.clientId}</span>{msg.clientType && msg.clientType !== 'individual' ? ` · ${msg.clientType}` : ''}{msg.sessionModality ? ` · ${msg.sessionModality}` : ''}</p>
                        </div>
                      </div>
                    )
                  }

                  // iMessage-style bubbles: blue gradient on the right for the
                  // user, soft gray on the left for Miwa. Tighter corners on the
                  // "tail" side (rounded-br-md / rounded-bl-md) gives the chat
                  // the conversational feel of a real messaging app.
                  return (
                    <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[82%] px-3.5 py-2 text-[13px] leading-relaxed ${
                          isUser
                            ? 'text-white rounded-3xl rounded-br-md shadow-sm'
                            : 'text-gray-900 rounded-3xl rounded-bl-md'
                        }`}
                        style={isUser
                          ? { background: 'linear-gradient(180deg, #2A8AFE 0%, #007AFF 100%)' }
                          : { background: '#E9E9EB' }
                        }
                      >
                        {isUser ? (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        ) : (
                          <div
                            className="prose-clinical"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
                {streaming && streamingText && (
                  <div className="flex justify-start">
                    <div
                      className="max-w-[82%] rounded-3xl rounded-bl-md px-3.5 py-2 text-[13px] text-gray-900 leading-relaxed"
                      style={{ background: '#E9E9EB' }}
                    >
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingText) }} />
                      <span className="inline-block w-1 h-3 bg-brand-400 ml-0.5 animate-pulse rounded-sm" />
                    </div>
                  </div>
                )}
                {streaming && !streamingText && (
                  <div className="flex justify-start">
                    <div
                      className="rounded-3xl rounded-bl-md px-4 py-2.5"
                      style={{ background: '#E9E9EB' }}
                    >
                      <TypingDots />
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Error */}
          {error && (
            <div className="flex-shrink-0 px-3 pb-1">
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="flex-1">{error}</span>
                <button onClick={() => setError('')} className="text-red-300 hover:text-red-500">✕</button>
              </div>
            </div>
          )}

          {/* Disambiguation picker */}
          {pendingDisambiguation && (
            <div className="flex-shrink-0 px-3 pb-2">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 shadow-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-xs font-semibold text-amber-700">Which "{pendingDisambiguation.name}"?</span>
                </div>
                <p className="text-xs text-amber-600 mb-2.5">
                  I found {pendingDisambiguation.options.length} clients with that name. Pick the right one:
                </p>
                <div className="flex flex-col gap-1.5">
                  {pendingDisambiguation.options.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        const orig = pendingDisambiguation.originalMessage
                        setPendingDisambiguation(null)
                        sendText(orig, { contextId: opt.id, contextType: 'patient' })
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-amber-200 hover:border-amber-400 hover:bg-amber-50/60 transition-all text-left group"
                    >
                      <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-amber-700 group-hover:bg-amber-200 transition-colors">
                        {opt.displayName?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-gray-800">{opt.displayName}</div>
                        <div className="text-[10px] text-gray-500 capitalize">{opt.clientId} · {opt.clientType}</div>
                      </div>
                      <svg className="w-3.5 h-3.5 text-gray-300 group-hover:text-amber-500 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setPendingDisambiguation(null)}
                  className="mt-2 text-[10px] text-amber-500 hover:text-amber-700 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Agent cards */}
          {pendingAction && (
            <div className="flex-shrink-0 px-3 pb-2">
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-3 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Approval required</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">{pendingAction.title || 'Confirm action'}</div>
                <div className="mt-1 text-xs text-gray-700 whitespace-pre-wrap">{pendingAction.preview}</div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => confirmPendingAction(true)} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700">Confirm</button>
                  <button onClick={() => confirmPendingAction(false)} className="px-3 py-1.5 rounded-lg bg-white text-gray-700 text-xs font-semibold border border-gray-200 hover:bg-gray-50">Cancel</button>
                </div>
              </div>
            </div>
          )}

          {reportLink && (
            <div className="flex-shrink-0 px-3 pb-2">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Report ready</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">{reportLink.title || 'Clinical report'}</div>
                <button onClick={() => downloadReport(reportLink.downloadUrl, `${reportLink.title || 'miwa-report'}.pdf`)} className="mt-3 inline-flex px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700">
                  Download PDF
                </button>
              </div>
            </div>
          )}

          {pendingBatchPicker && (
            <div className="flex-shrink-0 px-3 pb-2">
              <div className="rounded-2xl border border-violet-200 bg-violet-50 px-3 py-3 shadow-sm max-h-56 flex flex-col">
                <div className="text-xs font-semibold uppercase tracking-wide text-violet-700 flex-shrink-0">
                  Batch {pendingBatchPicker.assessmentType}
                </div>
                <p className="text-xs text-violet-600 mt-0.5 mb-2 flex-shrink-0">
                  Select clients to send to ({batchSelected.length} selected)
                </p>
                <div className="overflow-y-auto flex-1 flex flex-col gap-1 mb-2">
                  {pendingBatchPicker.patients.map(p => {
                    const isChecked = batchSelected.includes(p.id)
                    return (
                      <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white border border-violet-100 hover:border-violet-300 cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => setBatchSelected(sel =>
                            isChecked ? sel.filter(id => id !== p.id) : [...sel, p.id]
                          )}
                          className="accent-violet-600 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-gray-800">{p.name}</span>
                          <span className="text-[10px] text-gray-400 ml-1.5 font-mono">{p.clientId}</span>
                        </div>
                      </label>
                    )
                  })}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={confirmBatchAssessments}
                    disabled={batchSelected.length === 0}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Send to {batchSelected.length}
                  </button>
                  <button
                    onClick={() => { setPendingBatchPicker(null); setBatchSelected([]) }}
                    className="px-3 py-1.5 rounded-lg bg-white text-gray-700 text-xs font-semibold border border-gray-200 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Audio loading indicator — TTS request in-flight, not yet playing */}
          {loadingAudio && !speaking && (
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-gray-50 border-t border-gray-100">
              <div className="w-3 h-3 border-2 border-brand-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span className="text-xs text-gray-500 font-medium flex-1">Generating audio…</span>
              <button
                onClick={stopSpeaking}
                className="text-xs text-gray-400 hover:text-gray-600 font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Speaking indicator — audio is actually playing */}
          {speaking && (
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-brand-50 border-t border-brand-100">
              <div className="flex gap-0.5 items-end h-4">
                {[3,5,7,5,3].map((h, i) => (
                  <div
                    key={i}
                    className="w-0.5 bg-brand-500 rounded-full animate-bounce"
                    style={{ height: `${h}px`, animationDelay: `${i * 0.1}s` }}
                  />
                ))}
              </div>
              <span className="text-xs text-brand-600 font-medium flex-1">Miwa is speaking…</span>
              <button
                onClick={stopSpeaking}
                className="text-xs text-brand-400 hover:text-brand-700 font-medium transition-colors"
              >
                Stop
              </button>
            </div>
          )}

          {/* Listening indicator */}
          {listening && (
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-red-50 border-t border-red-100">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-red-600 font-medium flex-1">Listening… tap mic to stop</span>
            </div>
          )}

          {/* Input — iMessage-style pill. The textarea sits inside a rounded-full
              wrapper so the focus ring + visual border shape is the pill, not the
              underlying multiline element. Send + mic buttons sit outside the pill
              like Messages.app. */}
          <div className="flex-shrink-0 px-3 py-3 bg-white border-t border-gray-100">
            <div className="flex items-end gap-2">
              <div className="flex-1 flex items-end rounded-full border border-gray-200 bg-gray-50 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-400/20 transition-colors pl-4 pr-1 py-1">
                <textarea
                  ref={textareaRef}
                  className="flex-1 resize-none bg-transparent border-0 px-0 py-1.5 text-[13px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
                  placeholder={voiceEnabled ? 'Tap mic to speak, or type here…' : 'Ask Miwa a clinical question…'}
                  value={input}
                  onChange={e => {
                    setInput(e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'
                  }}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={streaming || listening}
                />
              </div>

              {/* Mic button — prominent, hard to miss */}
              {voiceSupported && (
                <button
                  onClick={listening ? stopListening : startListening}
                  disabled={streaming && !listening}
                  title={listening ? 'Tap to stop' : voiceEnabled ? 'Tap to speak' : 'Tap to dictate'}
                  className={`flex-shrink-0 rounded-full flex flex-col items-center justify-center gap-0.5 transition-all font-semibold ${
                    listening
                      ? 'w-10 h-10 bg-red-500 text-white shadow-lg shadow-red-500/40 scale-105'
                      : voiceEnabled
                      ? 'w-10 h-10 text-white shadow-md'
                      : 'w-10 h-10 bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                  style={voiceEnabled && !listening ? {
                    background: 'linear-gradient(135deg, #5746ed, #0ac5a2)',
                    boxShadow: '0 4px 14px rgba(87,70,237,0.4)',
                  } : undefined}
                >
                  {listening ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 fill-none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  )}
                </button>
              )}

              {/* Send button — sendText() auto-detects task-like messages and
                  routes them to the background runner transparently. */}
              <button
                onClick={() => sendText(input.trim())}
                disabled={!input.trim() || streaming || listening}
                className="flex-shrink-0 w-10 h-10 rounded-full disabled:opacity-30 disabled:cursor-not-allowed text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95"
                style={{ background: 'linear-gradient(180deg, #2A8AFE 0%, #007AFF 100%)' }}
              >
                {streaming && !listening ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>

            {/* Voice mode label */}
            {voiceEnabled && !listening && !speaking && (
              <p className="text-[10px] text-brand-400 mt-1.5 text-center">
                Voice mode on · Tap <strong>Speak</strong> to talk · Miwa responds with audio
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
