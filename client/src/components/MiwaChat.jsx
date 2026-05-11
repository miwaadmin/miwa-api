/**
 * MiwaChat, floating chat panel available on every protected page.
 * Opens as a compact panel (bottom-right). Auto-detects patient context from URL.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { API_BASE, apiFetch, apiUpload } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { renderClinical } from '../lib/renderClinical'
import AssistantActionCard from './AssistantActionCards'
import { normalizeAssistantAction } from '../lib/assistantActions'
import { isAgencyCompanionMode } from '../lib/workspaceMode'

/**
 * Heuristic: should this message be run in the background instead of
 * blocking the chat?
 *
 * "Task" messages are ones where the user is delegating work, Miwa
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
 * The heuristic errs toward SYNC when uncertain, worst case, something
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
  // Default: sync (safer, background is opt-in via signal, not opt-out).
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

    // ── Clinical severity in parens: "(moderate)" → ",  moderate" ──
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
    .replace(/\s*[, –]\s*/g, ', ')

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

const ONBOARDING_STEPS = [
  {
    id: 'identity',
    title: 'First, how should I know you?',
    prompt: `Hi! I'm Miwa, your clinical copilot.

I'll keep this lightweight. A couple questions at a time, and you can skip anything.

First:
- What should I call you?
- What kind of license or training role do you have?
- Who do you usually work with?`,
  },
  {
    id: 'clinical_style',
    title: 'How do you think clinically?',
    prompt: `That helps. Next:

- What's your main therapeutic orientation or style?
- What kinds of cases do you want the most support thinking through?
- Anything you want me to watch for across your caseload?`,
  },
  {
    id: 'workflow',
    title: 'How should I help day to day?',
    prompt: `Got it. Now the workflow side:

- How do you like notes written: SOAP, DAP, BIRP, narrative, something else?
- What do you most want me to help with: prep, notes, assessments, risk review, admin, outreach?
- Any documentation habits or pet peeves I should learn?`,
  },
  {
    id: 'assistant_style',
    title: 'Last bit: how should I show up?',
    prompt: `Last bit.

- Should I be concise, balanced, or detailed?
- What tone works best for you: warm, clinical, direct, reflective?
- Any hard rules? Things I should never do or say?`,
    final: true,
  },
]

function formatOnboardingAnswers(answers) {
  return answers
    .map((answer, index) => {
      const step = ONBOARDING_STEPS.find(s => s.id === answer.stage) || ONBOARDING_STEPS[index]
      return `Step ${index + 1}: ${step?.title || answer.stage}\n${answer.response || ''}`
    })
    .join('\n\n---\n\n')
}

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

function pageSurface(pathname) {
  if (pathname === '/consult') return { surface: 'consult', label: 'Consult' }
  if (pathname.startsWith('/t/dashboard') || pathname.startsWith('/t/today')) return { surface: 'trainee_dashboard', label: 'Trainee Dashboard' }
  if (pathname.startsWith('/t/cases')) return { surface: 'trainee_cases', label: 'Cases' }
  if (pathname.startsWith('/t/drafts')) return { surface: 'trainee_drafts', label: 'Note Drafts' }
  if (pathname.startsWith('/t/supervision')) return { surface: 'trainee_supervision', label: 'Supervision' }
  if (pathname.startsWith('/t/hours')) return { surface: 'trainee_hours', label: 'Hours' }
  if (pathname.startsWith('/t/learning')) return { surface: 'consult', label: 'Consult' }
  if (pathname === '/dashboard') return { surface: 'dashboard', label: 'Dashboard' }
  if (pathname === '/schedule' || pathname === '/calendar') return { surface: 'schedule', label: 'Schedule' }
  if (pathname === '/patients') return { surface: 'patients', label: 'Patients' }
  if (pathname.match(/^\/patients\/\d+/)) return { surface: 'patient_detail', label: 'Client chart' }
  if (pathname === '/workspace' || pathname.includes('/sessions/')) return { surface: 'workspace', label: 'Workspace' }
  if (pathname === '/inbox') return { surface: 'inbox', label: 'Inbox' }
  if (pathname === '/briefs') return { surface: 'briefs', label: 'Briefs' }
  if (pathname === '/outcomes') return { surface: 'outcomes', label: 'Outcomes' }
  if (pathname === '/billing') return { surface: 'billing', label: 'Billing' }
  if (pathname === '/contacts') return { surface: 'contacts', label: 'Contacts' }
  if (pathname === '/settings') return { surface: 'settings', label: 'Settings' }
  return { surface: 'miwa', label: 'Miwa' }
}

function isLiveGoodbye(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return false
  return /\b(?:bye|goodbye|talk to you later|i(?:'| wi)?ll talk to you later|i will talk to you later|talk later|see you later|see ya|that(?:'| i)?s all for now|that is all for now|we(?:'| a)?re done|we are done|end the live session|stop live)\b/.test(normalized)
}

const PAGE_ACTIONS = {
  trainee_today: [
    ['Daily brief', 'Tell me what I need to handle today as a trainee, including notes, supervision, risk/ethics, hours, and agency EHR copy status.'],
    ['Supervision prep', 'What should I bring to supervision this week? Focus on stuck cases, documentation questions, risk/ethics, and hours.'],
    ['Hours gaps', 'Review what hours I may need to log or reconcile from recent scheduled sessions.'],
  ],
  trainee_cases: [
    ['Supervision cases', 'Which cases should I bring to supervision, and what should I ask?'],
    ['Quiet cases', 'Which cases have gone quiet or may need follow-up?'],
    ['Case snapshots', 'Help me create concise case snapshots for supervision prep.'],
  ],
  trainee_drafts: [
    ['Draft queue', 'Which note drafts still need review or copying to the agency EHR?'],
    ['Clean note', 'Help me make the current note more concise, clinical, and ready to copy into the agency EHR.'],
    ['Documentation gaps', 'What documentation gaps might my supervisor notice?'],
  ],
  trainee_supervision: [
    ['Agenda', 'Generate a supervision agenda from my cases, risk/ethics items, documentation questions, and hours issues.'],
    ['Case presentation', 'Help me prepare a concise case presentation for supervision.'],
    ['Supervisor questions', 'What should I ask my supervisor based on my current cases and notes?'],
  ],
  trainee_hours: [
    ['Hours review', 'Review my hours progress and tell me what needs logging or reconciliation.'],
    ['Supervisor export', 'Help me prepare a clear hours summary for my supervisor or program.'],
    ['Category check', 'Which hour categories need attention based on my current progress?'],
  ],
  trainee_learning: [
    ['Teach why', 'Teach me why an intervention fits a case, using Socratic questions where helpful.'],
    ['Compare modalities', 'Compare CBT, DBT, EFT, and family systems lenses for a trainee case.'],
    ['Risk documentation', 'Teach me what to document if risk comes up in session.'],
  ],
  dashboard: [
    ['Morning cockpit', 'Do a morning clinical cockpit check: review today, documentation debt, risk watch, overdue assessments, and the next best action. Ask me before creating anything permanent.'],
    ['Risk watch', 'Review my caseload for risk signals and tell me who needs attention first.'],
    ['Documentation cleanup', 'Show me what documentation needs signing or cleanup and suggest the fastest order to handle it.'],
  ],
  schedule: [
    ['Prep my day', 'Prep my day from the schedule: summarize priorities per session, forms or notes to review, and any risk or assessment reminders.'],
    ['Find open slots', 'Look at my schedule and help me find available time slots for follow-ups or documentation.'],
    ['Unscheduled clients', 'Which active clients may need to be scheduled or followed up with?'],
  ],
  patients: [
    ['Rank urgency', 'Review the clients on this Patients page and rank who needs clinical attention first, including risk, assessments, and follow-up needs.'],
    ['Overdue assessments', 'Find clients who may be overdue for PHQ-9, GAD-7, PCL-5, or risk check-ins and show a batch preview before creating anything.'],
    ['Draft outreach', 'Help me draft warm outreach for clients who may need follow-up. Ask me before sending anything.'],
  ],
  patient_detail: [
    ['Prepare session', 'Prepare me for this client: summarize themes, recent risk or assessment concerns, likely focus, and follow-up tasks.'],
    ['Risk review', 'Review this client for risk language, assessment concerns, and protective factors.'],
    ['Draft message', 'Draft a warm secure portal message for this client and ask me before sending.'],
  ],
  workspace: [
    ['Draft note', 'Help me turn the current session material into a concise clinical note.'],
    ['Treatment plan', 'Review the current session context and suggest treatment-plan updates or measurable goals.'],
    ['Follow-up tasks', 'Identify follow-up tasks from the current workspace context.'],
  ],
  inbox: [
    ['Triage unread', 'Summarize unread secure client messages, flag risk language, and suggest follow-up tasks.'],
    ['Draft replies', 'Help me draft replies to recent secure client messages. Ask me before sending anything.'],
    ['Create tasks', 'Turn the current inbox into follow-up tasks for anything clinically or administratively important.'],
  ],
  briefs: [
    ['Summarize latest', 'Summarize the latest clinical brief and tell me what is actionable for my practice.'],
    ['Find evidence', 'Help me find relevant clinical resources or research for a current client concern.'],
    ['Apply to caseload', 'Connect the latest brief to my caseload and suggest who it might help.'],
  ],
  outcomes: [
    ['Outcomes review', 'Review outcomes across my caseload and identify improvement, deterioration, and assessment gaps.'],
    ['Assessment catch-up', 'Find which clients need fresh measures and suggest a batch plan.'],
    ['Supervision summary', 'Create a supervision-style outcomes summary from the current data.'],
  ],
  consult: [
    ['Think through a case', 'Help me think through a case conceptualization and ask only the highest-yield follow-up questions.'],
    ['Supervision prep', 'Help me prepare a concise supervision question from the clinical concern I am describing.'],
    ['Risk consult', 'Help me think through risk, protective factors, documentation, and next-step options.'],
  ],
}

// Floating Miwa is always the agent, action-first, concise.
// Deep clinical analysis lives on the Consult page (/consult).

export default function MiwaChat() {
  const { therapist } = useAuth()
  const agencyMode = isAgencyCompanionMode(therapist)
  const location = useLocation()
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
  const [assistantState, setAssistantState] = useState(null)
  const [onboardingStage, setOnboardingStage] = useState(null)
  const [onboardingAnswers, setOnboardingAnswers] = useState([])
  const [imageAttachments, setImageAttachments] = useState([])

  const [voiceEnabled, setVoiceEnabled] = useState(false)  // auto-speak mode
  const [listening, setListening] = useState(false)         // recording mic
  const [speaking, setSpeaking] = useState(false)           // TTS actively playing
  const [loadingAudio, setLoadingAudio] = useState(false)   // TTS request in-flight
  const [liveVoice, setLiveVoice] = useState(false)
  const [liveVoiceMode, setLiveVoiceMode] = useState('conversation')
  const [liveVoiceStatus, setLiveVoiceStatus] = useState('')
  const [liveTranscript, setLiveTranscript] = useState('')
  const [liveMicMuted, setLiveMicMuted] = useState(false)
  const [liveAssistantSpeaking, setLiveAssistantSpeaking] = useState(false)
  const [voiceSupported] = useState(() =>
    typeof window !== 'undefined' && !!window.MediaRecorder && !!window.speechSynthesis
  )
  const realtimeSupported = typeof window !== 'undefined' && !!window.RTCPeerConnection && !!navigator.mediaDevices?.getUserMedia

  const currentPageContext = useMemo(() => {
    const meta = pageSurface(location.pathname)
    const visibleClients = meta.surface === 'patients'
      ? patients.slice(0, 12).map(p => p.display_name || p.client_id).filter(Boolean)
      : []
    return {
      ...meta,
      path: location.pathname,
      patientId: patientId ? Number(patientId) : null,
      patientName,
      credentialType: therapist?.credential_type || 'licensed',
      workspaceMode: agencyMode ? 'agency_companion' : 'private_practice',
      responseStyle: therapist?.assistant_verbosity || 'balanced',
      visibleClients,
      suggestedActions: (PAGE_ACTIONS[meta.surface] || []).map(([label]) => label),
    }
  }, [agencyMode, location.pathname, patientId, patientName, patients, therapist?.assistant_verbosity, therapist?.credential_type])

  const contextActions = PAGE_ACTIONS[currentPageContext.surface] || PAGE_ACTIONS.dashboard

  const buildLiveGreetingInstructions = useCallback((mode) => {
    if (mode !== 'conversation') return null
    const firstName = therapist?.first_name || therapist?.full_name?.split(' ')[0] || 'there'
    const actions = currentPageContext?.suggestedActions?.length
      ? `If they ask what you can do here, offer these current workspace actions: ${currentPageContext.suggestedActions.join(', ')}.`
      : ''
    return [
      `Start this new live voice session by saying only: "Hi ${firstName}, I'm here with you. What would you like to work on right now?"`,
      'Do not mention EHR names, agency names, training programs, page labels, site policy, PHI policy, workspace mode, or internal metadata in the greeting.',
      'Do not ask onboarding questions.',
      actions,
    ].join(' ')
  }, [currentPageContext, therapist])

  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const prevOpenRef = useRef(false)
  const mediaRecorderRef = useRef(null)

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

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = input ? `${Math.min(el.scrollHeight, 112)}px` : '32px'
  }, [input])

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

  // Panel-drag state — same pattern as FAB. null = auto-anchor to FAB
  // (the historical behavior); {x, y} = pinned by the user. Persisted to
  // localStorage as miwa_panel_pos so the panel "remembers" where the
  // clinician put it across page navigations and reloads.
  const [panelPos, setPanelPos] = useState(() => {
    try {
      const stored = localStorage.getItem('miwa_panel_pos')
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })
  const panelDragStateRef = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0, moved: false })

  const handlePanelHeaderMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    // Don't start a drag if the click landed on an interactive child
    // (the voice-mode toggle, voice-on switch, close button). Without
    // this guard, clicking those buttons starts a 0-pixel "drag" which
    // is harmless but feels wrong.
    if (e.target.closest('button, input, textarea, select, a')) return
    const panel = e.currentTarget.closest('[data-miwa-panel]')
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    panelDragStateRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
      moved: false,
    }
    e.preventDefault()
  }, [])

  const handlePanelHeaderTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return
    if (e.target.closest('button, input, textarea, select, a')) return
    const panel = e.currentTarget.closest('[data-miwa-panel]')
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const t = e.touches[0]
    panelDragStateRef.current = {
      dragging: true,
      startX: t.clientX,
      startY: t.clientY,
      origX: rect.left,
      origY: rect.top,
      moved: false,
    }
  }, [])

  // Double-click the header to release the pinned position and snap
  // back to the auto-anchored layout next to the FAB.
  const handlePanelHeaderDoubleClick = useCallback((e) => {
    if (e.target.closest('button, input, textarea, select, a')) return
    setPanelPos(null)
    try { localStorage.removeItem('miwa_panel_pos') } catch {}
  }, [])

  useEffect(() => {
    function move(clientX, clientY) {
      const s = panelDragStateRef.current
      if (!s.dragging) return
      const dx = clientX - s.startX
      const dy = clientY - s.startY
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) s.moved = true
      // Use the actual rendered panel size for clamping so the user can't
      // drag the chrome off-screen on small viewports.
      const panelEl = document.querySelector('[data-miwa-panel]')
      const w = panelEl?.offsetWidth || 390
      const h = panelEl?.offsetHeight || 540
      const maxX = Math.max(4, window.innerWidth - w - 4)
      const maxY = Math.max(4, window.innerHeight - h - 4)
      const nx = Math.min(Math.max(4, s.origX + dx), maxX)
      const ny = Math.min(Math.max(4, s.origY + dy), maxY)
      setPanelPos({ x: nx, y: ny })
    }
    function onMouseMove(e) { move(e.clientX, e.clientY) }
    function onTouchMove(e) {
      if (e.touches.length !== 1) return
      move(e.touches[0].clientX, e.touches[0].clientY)
    }
    function end() {
      const s = panelDragStateRef.current
      if (!s.dragging) return
      s.dragging = false
      if (s.moved) {
        try { localStorage.setItem('miwa_panel_pos', JSON.stringify(panelPos)) } catch {}
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
  }, [panelPos])

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
      // Mark as "moved" once pointer travels more than 4px, used to suppress click
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
  const realtimePcRef = useRef(null)
  const realtimeStreamRef = useRef(null)
  const realtimeAudioElRef = useRef(null)
  const realtimeAssistantRef = useRef('')
  const liveStartingRef = useRef(false)
  const liveManualMuteRef = useRef(false)
  const liveAssistantSpeakingRef = useRef(false)
  const liveAutoUnmuteTimerRef = useRef(null)
  const liveOutputAudioCtxRef = useRef(null)
  const liveOutputMonitorRef = useRef(null)
  const liveOutputHeardAudioRef = useRef(false)
  const liveOutputSilentSinceRef = useRef(null)
  const liveResponseInProgressRef = useRef(false)
  const liveAssistantMessageCommittedRef = useRef(false)
  const liveEndingRef = useRef(false)

  // Keep voiceEnabled ref in sync
  useEffect(() => { voiceEnabledRef.current = voiceEnabled }, [voiceEnabled])

  // Cancel TTS when panel closes, use audioRef directly to avoid TDZ
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
    apiFetch('/assistant/state?surface=miwa_chat').then(r => r.json()).then(state => {
      setAssistantState(state)
      if (state?.account?.onboarding?.completed) return
      // Skip if we've already shown the onboarding intro this session
      if (sessionStorage.getItem('miwa_onboarding_shown')) return
      sessionStorage.setItem('miwa_onboarding_shown', '1')

      apiFetch('/onboarding/progress').then(r => r.json()).then(progress => {
        const answers = Array.isArray(progress?.answers) ? progress.answers : []
        const nextIndex = Math.min(answers.length, ONBOARDING_STEPS.length - 1)
        const step = ONBOARDING_STEPS[nextIndex]
        setOnboardingAnswers(answers)
        setOnboardingStage(step.id)
        setMessages([
          { id: `onboarding-${step.id}`, role: 'assistant', content: step.prompt, onboarding: true, onboardingStage: step.id },
        ])
        setIsOpen(true)
      }).catch(() => {
        const step = ONBOARDING_STEPS[0]
        setOnboardingStage(step.id)
        setMessages([
          { id: `onboarding-${step.id}`, role: 'assistant', content: step.prompt, onboarding: true, onboardingStage: step.id },
        ])
        setIsOpen(true)
      })
      return

      const firstName = therapist?.first_name || therapist?.full_name?.split(' ')[0] || 'there'
      const intro = `Hi ${firstName}! I'm Miwa, your clinical copilot. 👋

Before we get to work, I'd love to get to know you, how you think about therapy, how you like to work, and how I can show up as the most useful copilot possible. The more you tell me here, the less you'll have to explain later.

Answer in any order, any format (paragraph, bullets, stream-of-consciousness, whatever feels natural). Skip anything that doesn't apply. Takes about 5 minutes.

---

**🪪 About you**

1. **What should I call you?** (first name, Dr. Last Name, nickname, whatever you prefer)

2. **How long have you been practicing, and what kind of license do you hold?** (LMFT, LCSW, psychologist, associate, pre-license, etc., optional but helpful context)

3. **Who do you typically work with?** Populations, age ranges, presenting concerns, modalities (individual, couples, family, group)?

---

**🧠 How you work**

4. **What's your therapeutic orientation?** Primary approach + any specific modalities you lean on (CBT, EFT, IFS, psychodynamic, narrative, family systems, somatic, integrative, etc.)

5. **How do you like to document?** SOAP, DAP, BIRP, narrative, something else? Anything you always want in a note, or anything you never want?

6. **What do you most want me to help with?** (e.g. faster notes, clinical second opinion, treatment planning, admin, outreach, tracking outcomes, supervision-style reflection, etc.)

---

**🎙️ How I should show up**

7. **Communication style**, concise and scannable, balanced, or detailed and thorough?

8. **Tone**, warm and collegial, clinical and precise, direct and punchy, reflective, something else?

9. **Hard rules or pet peeves**, things I should *never* do or say. (e.g. "never use client names, always codes" / "don't recommend meds" / "don't hedge, just tell me what you think" / "no emojis" / "push back when I'm wrong")

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
      setPatientName(pt?.client_label || pt?.display_name || pt?.client_name || pt?.patient_name || pt?.client_id || null)
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
    const attachmentsToSend = imageAttachments
    const cleanText = text.trim()
    const messageText = cleanText || (attachmentsToSend.length ? 'Please describe what is visible in this image and help me think through any clinically relevant details.' : '')
    if (!messageText || streaming) return
    setInput('')
    setError('')
    setPendingAction(null)
    setReportLink(null)
    setPendingDisambiguation(null)
    setPendingBatchPicker(null)
    setBatchSelected([])

    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: attachmentsToSend.length ? `${messageText}\n\n[Attached ${attachmentsToSend.length} image${attachmentsToSend.length === 1 ? '' : 's'}]` : messageText,
    }
    setMessages(m => [...m, userMsg])
    setStreaming(true)
    setStreamingText('')

    // ── Auto-route long-running "do this for me" messages to the background
    //   task runner. This is the "agentic" behavior the user asked for:
    //   Miwa decides whether something is a task vs. a quick question, and
    //   backgrounds it automatically, no explicit button required.
    //
    //   Signals that a message is a TASK (run in background):
    //     • action verb at the start (analyze, generate, draft, compile,
    //       summarize, review, find, research, build, put together, etc.)
    //     • scope phrase ("all clients", "my caseload", "every patient")
    //     • explicit user ask ("in the background", "take your time", "later")
    //
    //   We SKIP background routing if:
    //     • message references a specific patient in context (contextOverride
    //       is set, or user is on a patient page), those are interactive
    //     • it's a yes/no / clarifying question / short greeting
    //     • onboarding flow (handled below)
    //     • a pending-action flow (approval, picker, disambiguation)
    // Compute here because the existing onboarding branch below uses the
    // same check; we want to respect it but not depend on ordering.
    const lastMsgIsOnboarding = messages.length > 0 && messages[messages.length - 1]?.onboarding
    if (!attachmentsToSend.length && !lastMsgIsOnboarding && !contextOverride && !pendingAction && !pendingBatchPicker && !pendingDisambiguation) {
      const shouldRunAsTask = looksLikeBackgroundTask(messageText)
      if (shouldRunAsTask) {
        try {
          const res = await apiFetch('/agent/tasks', {
            method: 'POST',
            body: JSON.stringify({ prompt: messageText, context: currentPageContext }),
          })
          if (res.ok) {
            const task = await res.json()
            setMessages(m => [...m, {
              id: Date.now() + 1,
              role: 'assistant',
              content: `🕊️ On it, I'll work on this in the background. I'll notify you as soon as it's done. You can close this chat and keep working; the result will show up in your Tasks inbox (top-right) when ready.\n\n*Task:* ${task.title}`,
            }])
            setStreaming(false)
            setStreamingText('')
            return
          }
          // If the task endpoint errored, fall through to sync chat so the
          // user still gets a response, background is an optimization, not a
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
        const stageId = messages[messages.length - 1]?.onboardingStage || onboardingStage || ONBOARDING_STEPS[0].id
        const currentIndex = Math.max(0, ONBOARDING_STEPS.findIndex(step => step.id === stageId))
        const currentStep = ONBOARDING_STEPS[currentIndex] || ONBOARDING_STEPS[0]
        const saved = await apiFetch('/onboarding/progress', {
          method: 'POST',
          body: JSON.stringify({ stage: currentStep.id, response: messageText }),
        })
        const progress = await saved.json()
        if (!saved.ok) throw new Error(progress.error || 'Could not save onboarding answer')
        const nextAnswers = Array.isArray(progress.answers)
          ? progress.answers
          : [...onboardingAnswers, { stage: currentStep.id, response: messageText }]
        setOnboardingAnswers(nextAnswers)

        const nextStep = ONBOARDING_STEPS[currentIndex + 1]
        if (nextStep) {
          setOnboardingStage(nextStep.id)
          setMessages(m => [...m, {
            id: `onboarding-${nextStep.id}`,
            role: 'assistant',
            content: nextStep.prompt,
            onboarding: true,
            onboardingStage: nextStep.id,
          }])
          setStreaming(false)
          setStreamingText('')
          return
        }

        const res = await apiFetch('/onboarding/soul', {
          method: 'POST',
          body: JSON.stringify({ response: formatOnboardingAnswers(nextAnswers) }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Onboarding failed')
        setMessages(m => [...m, {
          id: Date.now() + 1,
          role: 'assistant',
          content: data.message || 'Saved. Ready when you are.',
        }])
        setOnboardingStage(null)
      } catch (err) {
        setError(err.message || 'Could not save onboarding profile')
        setMessages(m => [...m, {
          id: Date.now() + 1,
          role: 'assistant',
          content: `I couldn't save your profile just now, but no worries, I'll remember what you said for this conversation. You can update it later in Settings.`,
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
        message: messageText,
        contextType: effectiveContextType,
        contextId: effectivePatientId,
        pageContext: currentPageContext,
        responseStyle: therapist?.assistant_verbosity || 'balanced',
        imageAttachments: attachmentsToSend.map(({ name: _name, id: _id, ...attachment }) => attachment),
      }
      setImageAttachments([])

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
            if (data.type === 'assistant_action' && data.action) {
              const action = normalizeAssistantAction(data.action)
              setMessages(m => [...m, {
                id: action.id || Date.now() + Math.random(),
                role: 'assistant_action',
                action,
              }])
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
              // Superseded by the structured show_client assistant_action card.
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
                    // TTS failed, show text anyway
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
  }, [streaming, patientId, therapist?.assistant_verbosity, isOpen, onboardingStage, onboardingAnswers, currentPageContext])

  const addMessageToSupervision = useCallback(async (msg) => {
    try {
      const content = String(msg?.content || '').trim()
      if (!content) return
      if (msg?.role === 'system_action' || /I'll work on this in the background|Tasks inbox|result will show up|you can close this chat/i.test(content)) {
        setError('That is a system status message, so it was not added to supervision.')
        return
      }
      const res = await apiFetch('/agent/trainee/supervision-items', {
        method: 'POST',
        body: JSON.stringify({
          title: patientId ? 'Bring client question to supervision' : 'Bring clinical question to supervision',
          details: content.slice(0, 2000),
          patient_id: patientId || null,
          source: 'miwa_chat',
          priority: /\b(SI|HI|suicid|homicid|abuse|mandated|Tarasoff|custody|consent|ROI|crisis|scope)\b/i.test(content) ? 'high' : 'normal',
        }),
      })
      if (!res.ok) throw new Error('Could not add this to supervision')
      setMessages(m => [...m, {
        id: Date.now(),
        role: 'system_action',
        actionType: 'supervision_item_added',
        content: 'Added to your supervision queue.',
      }])
    } catch (err) {
      setError(err.message)
    }
  }, [patientId])

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
            // Prefer the human-readable display name; fall back to client_id
            // only if the row has no display_name set yet (very rare).
            ? `✅ Scheduled, ${data.appointment.display_name || data.appointment.client_id} · ${data.appointment.scheduled_start ? new Date(data.appointment.scheduled_start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'time TBD'} · ${data.appointment.appointment_type}`
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

  const confirmAssistantAction = async (action) => {
    const actionId = action?.payload?.actionId || action?.meta?.actionId
    if (!actionId) return
    try {
      const res = await apiFetch('/agent/confirm', {
        method: 'POST',
        body: JSON.stringify({ actionId, approved: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not confirm action')
      setPendingAction(null)
      setMessages(m => [...m, {
        id: Date.now(),
        role: 'assistant',
        content: data.appointment
          ? `Scheduled, ${data.appointment.display_name || data.appointment.client_id} · ${data.appointment.scheduled_start ? new Date(data.appointment.scheduled_start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'time TBD'} · ${data.appointment.appointment_type}`
          : 'Done.',
      }])
      if (data.appointment) {
        window.dispatchEvent(new CustomEvent('miwa:appointment_created', { detail: data.appointment }))
      }
    } catch (err) {
      setError(err.message)
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
        content: `Queued ${count} ${pendingBatchPicker.assessmentType} link${count !== 1 ? 's' : ''}, ${pendingBatchPicker.spreadOption === 'spread' ? 'spread over 24 hours' : 'sending now'}.`,
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || data.error || 'TTS request failed')
      }
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
      // setSpeaking(true) here, audio is actually starting RIGHT NOW
      setLoadingAudio(false)
      setSpeaking(true)
      source.onended = () => { setSpeaking(false); audioRef.current = null }
      source.start(0)
      audioRef.current = source
    } catch (err) {
      console.error('[Miwa TTS]', err)
      const message = String(err.message || '')
      setError(
        message.includes('VOICE_UNAVAILABLE') || message.includes('voice playback')
          ? 'Voice playback is not configured yet. I kept the text response here.'
          : 'Voice playback is temporarily unavailable. I kept the text response here.'
      )
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
  const applyLiveMicState = useCallback(() => {
    const muted = liveManualMuteRef.current || liveAssistantSpeakingRef.current
    realtimeStreamRef.current?.getAudioTracks?.().forEach(track => { track.enabled = !muted })
    setLiveMicMuted(muted)
  }, [])

  const setRealtimeAssistantSpeaking = useCallback((next) => {
    if (liveAutoUnmuteTimerRef.current) {
      clearTimeout(liveAutoUnmuteTimerRef.current)
      liveAutoUnmuteTimerRef.current = null
    }
    if (next) {
      liveOutputHeardAudioRef.current = false
      liveOutputSilentSinceRef.current = null
      liveAutoUnmuteTimerRef.current = setTimeout(() => {
        liveAutoUnmuteTimerRef.current = null
        liveAssistantSpeakingRef.current = false
        setLiveAssistantSpeaking(false)
        applyLiveMicState()
      }, 90000)
    }
    liveAssistantSpeakingRef.current = Boolean(next)
    setLiveAssistantSpeaking(Boolean(next))
    applyLiveMicState()
  }, [applyLiveMicState])

  const scheduleLiveAutoUnmute = useCallback((delayMs = 4500) => {
    if (liveAutoUnmuteTimerRef.current) clearTimeout(liveAutoUnmuteTimerRef.current)
    liveAutoUnmuteTimerRef.current = setTimeout(() => {
      liveAutoUnmuteTimerRef.current = null
      liveAssistantSpeakingRef.current = false
      setLiveAssistantSpeaking(false)
      applyLiveMicState()
    }, delayMs)
  }, [applyLiveMicState])

  const cleanupLiveOutputMonitor = useCallback(() => {
    if (liveOutputMonitorRef.current) {
      cancelAnimationFrame(liveOutputMonitorRef.current)
      liveOutputMonitorRef.current = null
    }
    if (liveOutputAudioCtxRef.current) {
      try { liveOutputAudioCtxRef.current.close() } catch {}
      liveOutputAudioCtxRef.current = null
    }
    liveOutputHeardAudioRef.current = false
    liveOutputSilentSinceRef.current = null
  }, [])

  const startLiveOutputMonitor = useCallback((remoteStream) => {
    cleanupLiveOutputMonitor()
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextCtor || !remoteStream) return
    try {
      const ctx = new AudioContextCtor()
      ctx.resume?.().catch?.(() => {})
      const source = ctx.createMediaStreamSource(remoteStream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      liveOutputAudioCtxRef.current = ctx
      const samples = new Uint8Array(analyser.fftSize)
      const threshold = 0.012
      const silenceMs = 1400

      const tick = () => {
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (let i = 0; i < samples.length; i += 1) {
          const centered = (samples[i] - 128) / 128
          sum += centered * centered
        }
        const rms = Math.sqrt(sum / samples.length)
        const now = performance.now()
        if (rms > threshold) {
          liveOutputHeardAudioRef.current = true
          liveOutputSilentSinceRef.current = null
          if (!liveAssistantSpeakingRef.current) setRealtimeAssistantSpeaking(true)
        } else if (liveAssistantSpeakingRef.current && liveOutputHeardAudioRef.current && !liveResponseInProgressRef.current) {
          if (!liveOutputSilentSinceRef.current) liveOutputSilentSinceRef.current = now
          if (now - liveOutputSilentSinceRef.current > silenceMs) {
            setRealtimeAssistantSpeaking(false)
            liveOutputHeardAudioRef.current = false
            liveOutputSilentSinceRef.current = null
          }
        }
        liveOutputMonitorRef.current = requestAnimationFrame(tick)
      }
      liveOutputMonitorRef.current = requestAnimationFrame(tick)
    } catch {
      cleanupLiveOutputMonitor()
    }
  }, [cleanupLiveOutputMonitor, setRealtimeAssistantSpeaking])

  const toggleLiveMicMute = useCallback(() => {
    liveManualMuteRef.current = !liveManualMuteRef.current
    applyLiveMicState()
  }, [applyLiveMicState])

  const stopLiveVoice = useCallback(() => {
    liveStartingRef.current = false
    try { realtimePcRef.current?.close() } catch {}
    realtimePcRef.current = null
    if (realtimeStreamRef.current) {
      realtimeStreamRef.current.getTracks().forEach(track => track.stop())
      realtimeStreamRef.current = null
    }
    if (realtimeAudioElRef.current) {
      realtimeAudioElRef.current.srcObject = null
      realtimeAudioElRef.current = null
    }
    cleanupLiveOutputMonitor()
    realtimeAssistantRef.current = ''
    if (liveAutoUnmuteTimerRef.current) {
      clearTimeout(liveAutoUnmuteTimerRef.current)
      liveAutoUnmuteTimerRef.current = null
    }
    liveManualMuteRef.current = false
    liveAssistantSpeakingRef.current = false
    liveResponseInProgressRef.current = false
    liveAssistantMessageCommittedRef.current = false
    liveEndingRef.current = false
    setLiveVoice(false)
    setLiveVoiceStatus('')
    setLiveMicMuted(false)
    setLiveAssistantSpeaking(false)
  }, [])

  const handleRealtimeEvent = useCallback((event, mode) => {
    if (!event?.type) return
    if (
      event.type === 'response.created'
      || event.type === 'response.audio.delta'
      || event.type === 'response.output_audio.delta'
      || event.type === 'output_audio_buffer.started'
    ) {
      liveResponseInProgressRef.current = true
      if (event.type === 'response.created') liveAssistantMessageCommittedRef.current = false
      setRealtimeAssistantSpeaking(true)
    }
    if (
      event.type === 'response.audio.done'
      || event.type === 'response.done'
      || event.type === 'output_audio_buffer.stopped'
    ) {
      if (event.type === 'response.done') liveResponseInProgressRef.current = false
      if (liveEndingRef.current) {
        window.setTimeout(() => stopLiveVoice(), 900)
      } else if (!liveResponseInProgressRef.current) {
        scheduleLiveAutoUnmute(liveOutputHeardAudioRef.current ? 900 : 12000)
      }
    }
    if (event.type === 'response.cancelled' || event.type === 'response.failed') {
      liveResponseInProgressRef.current = false
      scheduleLiveAutoUnmute(800)
    }
    if (event.type === 'conversation.item.input_audio_transcription.delta' && event.delta) {
      setLiveTranscript(prev => `${prev}${event.delta}`)
      return
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript) {
      const transcript = event.transcript.trim()
      setLiveTranscript(transcript)
      if (mode !== 'dictation' && isLiveGoodbye(transcript)) {
        setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: transcript }])
        liveEndingRef.current = true
        setLiveVoiceStatus('Ending Miwa Live...')
        window.setTimeout(() => stopLiveVoice(), liveResponseInProgressRef.current ? 1800 : 3000)
        return
      }
      if (mode === 'dictation') {
        setInput(prev => [prev, transcript].filter(Boolean).join(prev ? '\n' : ''))
      } else {
        setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: transcript }])
      }
      return
    }
    if ((event.type === 'response.audio_transcript.delta' || event.type === 'response.output_audio_transcript.delta') && event.delta) {
      realtimeAssistantRef.current += event.delta
      setStreamingText(realtimeAssistantRef.current)
      return
    }
    if (event.type === 'response.done' || event.type === 'response.audio_transcript.done' || event.type === 'response.output_audio_transcript.done') {
      const text = (event.transcript || realtimeAssistantRef.current || '').trim()
      if (text && !liveAssistantMessageCommittedRef.current) {
        liveAssistantMessageCommittedRef.current = true
        setMessages(prev => [...prev, { id: Date.now() + 1, role: 'assistant', content: text }])
        realtimeAssistantRef.current = ''
        setStreamingText('')
      }
    }
  }, [scheduleLiveAutoUnmute, setRealtimeAssistantSpeaking, stopLiveVoice])

  const startLiveVoice = useCallback(async (mode = 'conversation') => {
    if (streaming || !realtimeSupported || liveStartingRef.current) return
    if (liveVoice) stopLiveVoice()
    liveStartingRef.current = true
    stopSpeaking()
    setError('')
    setLiveTranscript('')
    setLiveVoiceMode(mode)
    setLiveVoiceStatus(mode === 'dictation' ? 'Starting live dictation...' : mode === 'translate' ? 'Starting clinical translation...' : 'Starting Miwa Live...')
    try {
      const pc = new RTCPeerConnection()
      realtimePcRef.current = pc
      const audioEl = document.createElement('audio')
      audioEl.autoplay = true
      realtimeAudioElRef.current = audioEl
      pc.ontrack = event => {
        audioEl.srcObject = event.streams[0]
        startLiveOutputMonitor(event.streams[0])
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      realtimeStreamRef.current = stream
      liveManualMuteRef.current = false
      liveAssistantSpeakingRef.current = false
      setLiveMicMuted(false)
      setLiveAssistantSpeaking(false)
      stream.getTracks().forEach(track => pc.addTrack(track, stream))

      const dc = pc.createDataChannel('oai-events')
      dc.addEventListener('open', () => {
        setLiveVoiceStatus(mode === 'dictation' ? 'Listening live. Transcript appears in the composer.' : 'Live. Speak naturally.')
        const greetingInstructions = buildLiveGreetingInstructions(mode)
        if (greetingInstructions) {
          try {
            dc.send(JSON.stringify({
              type: 'response.create',
              response: {
                instructions: greetingInstructions,
              },
            }))
          } catch {}
        }
      })
      dc.addEventListener('message', message => {
        try { handleRealtimeEvent(JSON.parse(message.data), mode) } catch {}
      })

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const params = new URLSearchParams({ mode })
      if (currentPageContext) params.set('pageContext', JSON.stringify(currentPageContext))
      const sdpRes = await fetch(`${API_BASE}/agent/realtime/call?${params.toString()}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      })
      if (!sdpRes.ok) {
        const contentType = sdpRes.headers.get('content-type') || ''
        const data = contentType.includes('application/json') ? await sdpRes.json().catch(() => ({})) : {}
        const detailCode = data.details?.openaiErrorCode || data.details?.openaiErrorType || data.details?.error || ''
        const detailText = detailCode ? ` (${detailCode})` : ''
        throw new Error(`${data.message || data.error || 'Miwa Live Voice could not connect to the realtime service.'}${detailText}`)
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() })
      setLiveVoice(true)
    } catch (err) {
      stopLiveVoice()
      const message = err?.name === 'TypeError' && /fetch/i.test(err?.message || '')
        ? 'Miwa Live Voice could not reach the realtime service. Please refresh and try again.'
        : (err.message || 'Miwa Live Voice could not start.')
      setError(message)
    } finally {
      liveStartingRef.current = false
    }
  }, [buildLiveGreetingInstructions, currentPageContext, handleRealtimeEvent, liveVoice, realtimeSupported, startLiveOutputMonitor, stopLiveVoice, stopSpeaking, streaming])

  useEffect(() => () => stopLiveVoice(), [stopLiveVoice])

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
        if (blob.size < 500) return // too short, ignore

        try {
          setStreaming(true)
          setStreamingText('Transcribing…')
          const form = new FormData()
          const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('mpeg') ? 'mp3' : mimeType.includes('wav') ? 'wav' : mimeType.includes('ogg') ? 'ogg' : 'webm'
          form.append('audio', blob, `recording.${ext}`)
          const res = await apiUpload('/agent/transcribe', form)
          const data = await res.json()
          if (!res.ok || !data.text) throw new Error(data.message || data.error || 'Transcription failed')
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
      setError('Microphone access denied, check browser permissions.')
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
      {/* ── Floating button, draggable, position persisted in localStorage ── */}
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
          /* Miwa logo, M with teal dot */
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
          data-miwa-panel
          className="miwa-chat-panel fixed z-50 flex flex-col overflow-hidden rounded-2xl shadow-2xl"
          style={{
            ...(() => {
              // Panel anchors to the FAB, whichever corner the FAB sits in,
              // the panel opens toward the opposite side so it stays on screen.
              // Default bottom-right when FAB hasn't been dragged.
              const base = {
                width: 'min(calc(100vw - 2rem), 390px)',
                height: 'min(calc(100vh - 8rem), 540px)',
              };
              // If the user grabbed the panel header and dragged it somewhere
              // explicit, honor that position over the FAB-anchored auto-layout.
              if (panelPos) {
                const PANEL_W = Math.min(390, (typeof window !== 'undefined' ? window.innerWidth : 800) - 24);
                const PANEL_H = Math.min(540, (typeof window !== 'undefined' ? window.innerHeight : 700) - 24);
                return {
                  width: PANEL_W + 'px',
                  height: PANEL_H + 'px',
                  left: panelPos.x + 'px',
                  top: panelPos.y + 'px',
                };
              }
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
          {/* Header — grab anywhere off the buttons to drag the panel
              around the viewport. Double-click empty header space to
              snap back to the auto-anchored position next to the FAB. */}
          <div
            className="flex items-center gap-3 px-4 py-3 flex-shrink-0 select-none"
            style={{
              background: 'linear-gradient(135deg, #5746ed, #0ac5a2)',
              cursor: panelDragStateRef.current.dragging ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
            onMouseDown={handlePanelHeaderMouseDown}
            onTouchStart={handlePanelHeaderTouchStart}
            onDoubleClick={handlePanelHeaderDoubleClick}
            title="Drag to reposition. Double-click to snap back."
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
              <div className="flex items-center gap-2 text-sm font-bold text-white leading-tight">
                <span>Miwa</span>
                <span title="Miwa is online" className="h-2 w-2 rounded-full bg-teal-300 shadow-[0_0_0_3px_rgba(45,212,191,0.18)]" />
              </div>
              {patientName ? (
                <div className="text-xs text-white/70 truncate">Consulting on {patientName}</div>
              ) : (
                <div className="text-xs text-white/70">Agent · Schedule · Assess · Report</div>
              )}
            </div>
            {/* Voice mode toggle, pill button, hard to miss */}
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
                title={voiceEnabled ? 'Voice mode on, click to turn off' : 'Turn on voice mode'}
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

            {realtimeSupported && liveVoice && (
              <button
                onClick={stopLiveVoice}
                title="Stop Miwa Live Voice"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all flex-shrink-0 bg-emerald-100 text-emerald-700 shadow-md hover:bg-emerald-50"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Stop live
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
          <div className="miwa-chat-scroll flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50/60">
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
                <p className="miwa-chat-empty-title text-sm font-semibold text-gray-800">
                  Hi {firstName}! 👋
                </p>
                <p className="miwa-chat-empty-copy text-xs text-gray-500 mt-1 max-w-[260px]">
                  {agencyMode
                    ? 'Bring your clinical thinking here, not to random AI tools. I can help with notes, supervision questions, hours, risk, and learning.'
                    : patientName
                    ? `I can schedule, send an assessment, pull a report, or find resources for ${patientName}.`
                    : `I can see you're on ${currentPageContext.label}. I can help with the actions that fit this page, or you can ask anything.`}
                </p>
                <div className="mt-3 grid w-full max-w-[290px] gap-1.5">
                  {contextActions.slice(0, 3).map(([label, prompt]) => (
                    <button
                      type="button"
                      key={label}
                      onClick={() => sendText(prompt)}
                      className="rounded-xl border border-brand-100 bg-white px-3 py-2 text-left text-[11px] font-semibold text-gray-700 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="miwa-chat-empty-copy text-[10px] text-gray-400 mt-2 max-w-[260px] leading-relaxed">
                  💡 <strong className="text-gray-500">Found a bug or wishing for a feature?</strong> Just tell me, I'll send your feedback straight to the Miwa team.
                </p>
                <p className="miwa-chat-empty-copy text-[10px] text-gray-400 mt-2 max-w-[240px]">
                  For deep clinical consultation, use the{' '}
                  <a href="/consult" className="text-brand-500 hover:underline">Consult page →</a>
                </p>
                {assistantState?.openLoops?.length > 0 && (
                  <div className="mt-3 w-full max-w-[280px] rounded-2xl border border-white/70 bg-white/80 text-left shadow-sm overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-100">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-brand-600">Persistent agenda</p>
                      <p className="text-[11px] text-gray-500">Miwa is keeping these open loops visible.</p>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {assistantState.openLoops.slice(0, 3).map(loop => (
                        <button
                          type="button"
                          key={loop.id}
                          onClick={() => { if (loop.action?.href) window.location.href = loop.action.href }}
                          className="w-full px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-gray-800 truncate">{loop.title}</span>
                            <span className={`text-[9px] font-bold uppercase ${loop.severity === 'high' ? 'text-red-600' : loop.severity === 'medium' ? 'text-amber-600' : 'text-sky-600'}`}>
                              {loop.severity}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{loop.detail}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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

                  if (msg.role === 'assistant_action' && msg.action) {
                    return (
                      <AssistantActionCard
                        key={msg.id}
                        action={msg.action}
                        onConfirmAction={confirmAssistantAction}
                      />
                    )
                  }

                  if (msg.role === 'system_action' && msg.actionType === 'supervision_item_added') {
                    return (
                      <div key={msg.id} className="flex justify-start">
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 shadow-sm">
                          Added to your supervision queue.
                        </div>
                      </div>
                    )
                  }

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
                      <div className={`max-w-[82%] ${isUser ? '' : 'space-y-1'}`}>
                        <div
                          className={`px-3.5 py-2 text-[13px] leading-relaxed ${
                            isUser
                              ? 'text-white rounded-3xl rounded-br-md shadow-sm'
                              : 'miwa-assistant-bubble text-gray-900 rounded-3xl rounded-bl-md'
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
                        {agencyMode && !isUser && (
                          <button
                            type="button"
                            onClick={() => addMessageToSupervision(msg)}
                            className="ml-2 rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[10px] font-bold text-amber-700 shadow-sm hover:bg-amber-50"
                          >
                            Ask supervisor
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                {streaming && streamingText && (
                  <div className="flex justify-start">
                    <div
                      className="miwa-assistant-bubble max-w-[82%] rounded-3xl rounded-bl-md px-3.5 py-2 text-[13px] text-gray-900 leading-relaxed"
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
                      className="miwa-assistant-bubble rounded-3xl rounded-bl-md px-4 py-2.5"
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

          {/* Audio loading indicator, TTS request in-flight, not yet playing */}
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

          {/* Speaking indicator, audio is actually playing */}
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

          {messages.length > 0 && !streaming && !pendingAction && !pendingBatchPicker && (
            <div className="flex-shrink-0 border-t border-gray-100 bg-white px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {currentPageContext.label} actions
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {contextActions.slice(0, 3).map(([label, prompt]) => (
                  <button
                    type="button"
                    key={label}
                    onClick={() => sendText(prompt)}
                    className="flex-shrink-0 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px] font-semibold text-gray-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Composer: one stable rounded surface, with fixed action buttons so
              long text does not balloon the UI. */}
          <div className="miwa-chat-inputbar flex-shrink-0 px-3 py-3 bg-white border-t border-gray-100">
            {realtimeSupported && (
              <div className="mb-2 rounded-2xl border border-gray-200 bg-gray-50 p-2">
                <div className="flex items-center gap-1.5">
                  {[
                    ['conversation', 'Live'],
                    ['dictation', 'Dictate'],
                    ['translate', 'Translate'],
                  ].map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => liveVoice && liveVoiceMode === mode ? stopLiveVoice() : startLiveVoice(mode)}
                      disabled={streaming || listening}
                      className={`h-7 rounded-lg px-2 text-[11px] font-semibold transition-colors ${
                        liveVoice && liveVoiceMode === mode
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  {liveVoice && (
                    <>
                      <button
                        type="button"
                        onClick={toggleLiveMicMute}
                        disabled={liveAssistantSpeaking}
                        className={`ml-auto h-7 rounded-lg px-2 text-[11px] font-semibold transition-colors ${
                          liveMicMuted
                            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                            : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                        }`}
                        title={liveMicMuted ? 'Unmute your live mic' : 'Mute your live mic'}
                      >
                        {liveAssistantSpeaking ? 'Auto-muted' : liveMicMuted ? 'Muted' : 'Mute'}
                      </button>
                      <button
                        type="button"
                        onClick={stopLiveVoice}
                        className="h-7 rounded-lg px-2 text-[11px] font-semibold bg-red-50 text-red-600 hover:bg-red-100"
                      >
                        Stop
                      </button>
                    </>
                  )}
                </div>
                {(liveVoiceStatus || liveTranscript) && (
                  <div className="mt-2 rounded-xl bg-white px-2.5 py-2 text-[11px] leading-relaxed text-gray-600 border border-gray-100">
                    {liveVoiceStatus && <div className="font-semibold text-gray-700">{liveVoiceStatus}</div>}
                    {liveVoice && liveAssistantSpeaking && (
                      <div className="mt-1 font-semibold text-amber-700">Mic muted while Miwa is speaking.</div>
                    )}
                    {liveVoice && liveMicMuted && !liveAssistantSpeaking && (
                      <div className="mt-1 font-semibold text-amber-700">Your live mic is muted.</div>
                    )}
                    {liveTranscript && (
                      <div className="mt-1 line-clamp-2">{liveTranscript}</div>
                    )}
                    {liveTranscript && liveVoiceMode !== 'dictation' && (
                      <button
                        type="button"
                        onClick={() => sendText(liveTranscript)}
                        disabled={streaming}
                        className="mt-2 text-[11px] font-semibold text-brand-600 hover:text-brand-700"
                      >
                        Send transcript through Miwa tools
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {imageAttachments.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto">
                {imageAttachments.map(img => (
                  <div key={img.id} className="relative flex-shrink-0 rounded-xl border border-gray-200 bg-gray-50 p-1">
                    <img src={img.dataUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() => setImageAttachments(prev => prev.filter(item => item.id !== img.id))}
                      className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-gray-900 text-white text-[10px] flex items-center justify-center"
                      title="Remove image"
                    >
                      x
                    </button>
                  </div>
                ))}
                {agencyMode && (
                  <div className="min-w-[180px] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-snug text-amber-800">
                    Only attach agency PHI if your site permits Miwa alongside the official EHR.
                  </div>
                )}
              </div>
            )}
            <div
              className="miwa-chat-composer flex items-end gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-2 shadow-sm focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-400/20 transition-colors"
              onPaste={handlePaste}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
            >
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
                disabled={streaming || listening}
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-40 flex items-center justify-center transition-colors"
                title="Attach image"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5V7.5A2.5 2.5 0 015.5 5h13A2.5 2.5 0 0121 7.5v9A2.5 2.5 0 0118.5 19h-13A2.5 2.5 0 013 16.5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-4.5-4.5L8 19" />
                </svg>
              </button>
              <div className="miwa-chat-inputpill flex-1 min-w-0">
                <textarea
                  ref={textareaRef}
                  className="miwa-chat-textarea block w-full resize-none bg-transparent border-0 px-2 py-1.5 text-[13px] leading-relaxed text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
                  placeholder={voiceEnabled ? 'Tap mic to speak, or type here...' : 'Ask Miwa, or paste/drop an image...'}
                  value={input}
                  onChange={e => {
                    setInput(e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = Math.min(e.target.scrollHeight, 112) + 'px'
                  }}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={streaming || listening}
                />
              </div>

              {/* Mic button, prominent, hard to miss */}
              {voiceSupported && (
                <button
                  onClick={listening ? stopListening : startListening}
                  disabled={streaming && !listening}
                  title={listening ? 'Tap to stop' : voiceEnabled ? 'Tap to speak' : 'Tap to dictate'}
                  className={`flex-shrink-0 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all font-semibold ${
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

              {/* Send button, sendText() auto-detects task-like messages and
                  routes them to the background runner transparently. */}
              <button
                onClick={() => sendText(input.trim())}
                disabled={(!input.trim() && imageAttachments.length === 0) || streaming || listening}
                className="flex-shrink-0 w-10 h-10 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95"
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

