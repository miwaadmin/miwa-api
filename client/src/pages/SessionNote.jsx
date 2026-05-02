import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { API_BASE, apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { generateExportHTML, exportToPDF, downloadText, exportAsText } from '../lib/exportNotes'
import NoteEnrichments from '../components/NoteEnrichments'
import RiskMonitorBadge from '../components/RiskMonitorBadge'
import ResourceMentionPicker, { formatResourceMention, detectResourceTrigger } from '../components/ResourceMentionPicker'
import { renderClinical } from '../lib/renderClinical'

// ── Dictation Panel ─────────────────────────────────────────────────────────
function DictationPanel({ onApply, onClose }) {
  const [phase, setPhase] = useState('idle') // idle | recording | processing | done | error
  const [errorMsg, setErrorMsg] = useState('')
  const [transcript, setTranscript] = useState('')
  const [sections, setSections] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  const startRecording = async () => {
    setErrorMsg('')
    setTranscript('')
    setSections(null)
    chunksRef.current = []
    setElapsed(0)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/ogg'
      const mr = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mr
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        clearInterval(timerRef.current)
        setPhase('processing')
        try {
          const blob = new Blob(chunksRef.current, { type: mimeType })
          const fd = new FormData()
          fd.append('audio', blob, 'dictation.webm')
          const API = API_BASE
          const res = await fetch(`${API}/ai/dictate-session`, {
            method: 'POST',
            credentials: 'include',
            body: fd,
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.message || data.error || 'Transcription failed')
          setTranscript(data.transcript || '')
          setSections(data.sections || null)
          setPhase('done')
        } catch (err) {
          setErrorMsg(err.message)
          setPhase('error')
        }
      }
      mr.start(1000)
      setPhase('recording')
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } catch (err) {
      setErrorMsg('Microphone access denied. Please allow microphone permission and try again.')
      setPhase('error')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
  }

  useEffect(() => () => {
    clearInterval(timerRef.current)
    mediaRecorderRef.current?.state === 'recording' && mediaRecorderRef.current.stop()
  }, [])

  const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${phase === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-brand-100'}`}>
            <svg className={`w-4 h-4 ${phase === 'recording' ? 'text-white' : 'text-brand-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">Dictate Session Note</div>
            <div className="text-xs text-gray-500">Speak your session summary — Miwa will fill in all note fields</div>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {phase === 'idle' && (
        <div className="text-center py-4">
          <p className="text-xs text-gray-500 mb-4">
            Briefly describe what happened in the session — the client's mood, what you worked on, how they responded, and your next steps.
          </p>
          <button
            onClick={startRecording}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            Start Recording
          </button>
        </div>
      )}

      {phase === 'recording' && (
        <div className="text-center py-4 space-y-3">
          <div className="flex items-center justify-center gap-3">
            <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span className="text-2xl font-mono font-bold text-gray-800">{fmtTime(elapsed)}</span>
          </div>
          <p className="text-xs text-gray-500">Recording… speak naturally about the session</p>
          <button
            onClick={stopRecording}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop Recording
          </button>
        </div>
      )}

      {phase === 'processing' && (
        <div className="text-center py-6 space-y-2">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-gray-700">Transcribing &amp; parsing note fields…</p>
          <p className="text-xs text-gray-400">This takes 10–20 seconds</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-3">
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{errorMsg}</div>
          <button onClick={() => setPhase('idle')} className="text-xs text-brand-600 hover:underline">Try again</button>
        </div>
      )}

      {phase === 'done' && sections && (
        <div className="space-y-3">
          {transcript && (
            <details className="group">
              <summary className="text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700 list-none flex items-center gap-1">
                <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                View transcript
              </summary>
              <div className="mt-2 rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 text-xs text-gray-600 leading-relaxed max-h-32 overflow-y-auto">
                {transcript}
              </div>
            </details>
          )}
          <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3">
            <p className="text-xs font-semibold text-green-800 mb-1">✓ Note fields ready — all formats populated</p>
            <p className="text-xs text-green-700">Miwa has parsed your dictation into SOAP, BIRP, DAP, GIRP, and DMH SIR fields. Review and edit before saving.</p>
          </div>
          <button
            onClick={() => { onApply(sections); onClose() }}
            className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors"
          >
            Apply to Note Fields
          </button>
          <button onClick={() => setPhase('idle')} className="w-full py-2 rounded-xl border border-gray-200 text-gray-500 text-sm hover:bg-gray-50 transition-colors">
            Discard &amp; Re-record
          </button>
        </div>
      )}
    </div>
  )
}

const API = API_BASE

const SESSION_TEMPLATES = {
  'phq-9': {
    name: 'PHQ-9',
    max: 27,
    questions: [
      'Little interest or pleasure in doing things',
      'Feeling down, depressed, or hopeless',
      'Trouble falling or staying asleep, or sleeping too much',
      'Feeling tired or having little energy',
      'Poor appetite or overeating',
      'Feeling bad about yourself',
      'Trouble concentrating',
      'Moving or speaking slowly / restlessness',
      'Thoughts that you would be better off dead \u26a0\ufe0f',
    ],
    options: [
      { value: 0, label: 'Not at all' },
      { value: 1, label: 'Several days' },
      { value: 2, label: 'More than half' },
      { value: 3, label: 'Nearly every day' },
    ],
    severityFn: (s) => s <= 4 ? 'Minimal' : s <= 9 ? 'Mild' : s <= 14 ? 'Moderate' : s <= 19 ? 'Mod. Severe' : 'Severe',
    colorFn: (s) => s <= 4 ? '#10B981' : s <= 9 ? '#F59E0B' : s <= 14 ? '#F97316' : s <= 19 ? '#EF4444' : '#7F1D1D',
  },
  'gad-7': {
    name: 'GAD-7',
    max: 21,
    questions: [
      'Feeling nervous, anxious, or on edge',
      'Not being able to stop or control worrying',
      'Worrying too much about different things',
      'Trouble relaxing',
      'Being so restless that it is hard to sit still',
      'Becoming easily annoyed or irritable',
      'Feeling afraid as if something awful might happen',
    ],
    options: [
      { value: 0, label: 'Not at all' },
      { value: 1, label: 'Several days' },
      { value: 2, label: 'More than half' },
      { value: 3, label: 'Nearly every day' },
    ],
    severityFn: (s) => s <= 4 ? 'Minimal' : s <= 9 ? 'Mild' : s <= 14 ? 'Moderate' : 'Severe',
    colorFn: (s) => s <= 4 ? '#10B981' : s <= 9 ? '#F59E0B' : s <= 14 ? '#F97316' : '#EF4444',
  },
  'pcl-5': {
    name: 'PCL-5',
    max: 80,
    instructions: 'In the past month, how much were you bothered by…',
    questions: [
      'Repeated, disturbing, and unwanted memories of the stressful experience',
      'Repeated, disturbing dreams of the stressful experience',
      'Suddenly feeling or acting as if the stressful experience were actually happening again',
      'Feeling very upset when something reminded you of the stressful experience',
      'Having strong physical reactions when something reminded you (heart pounding, trouble breathing, sweating)',
      'Avoiding memories, thoughts, or feelings related to the stressful experience',
      'Avoiding external reminders (people, places, conversations, activities, objects, or situations)',
      'Trouble remembering important parts of the stressful experience',
      'Having strong negative beliefs about yourself, other people, or the world',
      'Blaming yourself or someone else for the stressful experience or what happened after',
      'Having strong negative feelings such as fear, horror, anger, guilt, or shame',
      'Loss of interest in activities that you used to enjoy',
      'Feeling distant or cut off from other people',
      'Trouble experiencing positive feelings (unable to feel happiness or love)',
      'Irritable behavior, angry outbursts, or acting aggressively',
      'Taking too many risks or doing things that could cause you harm',
      'Being "superalert" or watchful or on guard',
      'Feeling jumpy or easily startled',
      'Having difficulty concentrating',
      'Trouble falling or staying asleep',
    ],
    options: [
      { value: 0, label: 'Not at all' },
      { value: 1, label: 'A little bit' },
      { value: 2, label: 'Moderately' },
      { value: 3, label: 'Quite a bit' },
      { value: 4, label: 'Extremely' },
    ],
    severityFn: (s) => s <= 31 ? 'Minimal' : s <= 44 ? 'Moderate' : s <= 59 ? 'Mod. Severe' : 'Severe',
    colorFn: (s) => s <= 31 ? '#10B981' : s <= 44 ? '#F59E0B' : s <= 59 ? '#F97316' : '#EF4444',
    ptsdThreshold: 33,
  },
  'cssrs': {
    name: 'C-SSRS',
    max: 6,
    instructions: 'Please answer YES or NO for the past month.',
    isYesNo: true,
    questions: [
      'Have you wished you were dead or wished you could go to sleep and not wake up?',
      'Have you had any actual thoughts of killing yourself? ⚠️',
      'Have you been thinking about how you might do this? ⚠️',
      'Have you had these thoughts and had some intention of acting on them? 🚨',
      'Have you started to work out the details of how to kill yourself? Do you intend to carry out this plan? 🚨',
      'Have you ever done anything, started to do anything, or prepared to do anything to end your life? 🚨',
    ],
    options: [
      { value: 0, label: 'No' },
      { value: 1, label: 'Yes' },
    ],
    severityFn: (s) => s === 0 ? 'No Ideation' : s === 1 ? 'Passive Ideation' : s <= 3 ? 'Active Ideation' : 'Active + Plan/Intent',
    colorFn: (s) => s === 0 ? '#10B981' : s === 1 ? '#F59E0B' : s <= 3 ? '#F97316' : '#EF4444',
  },
}

const renderMarkdown = renderClinical

const EMPTY_NOTES = {
  SOAP: { subjective: '', objective: '', assessment: '', plan: '' },
  BIRP: { subjective: '', objective: '', assessment: '', plan: '' },
  DAP:  { subjective: '', assessment: '', plan: '' },
  GIRP: { goals: '', intervention: '', response: '', plan: '' },
  DMH_SIR: {
    situation: '',
    interventions: '',
    response: '',
    risk_safety: '',
    functioning_medical_necessity: '',
    plan_homework: '',
  },
}

const NOTE_FORMATS = ['SOAP', 'BIRP', 'DAP', 'GIRP', 'DMH_SIR']

const FORMAT_FIELDS = {
  SOAP: [
    { key: 'subjective', label: 'S — Subjective', placeholder: "Client's self-report: What did the client say? How did they describe their week, symptoms, mood? Direct quotes when relevant.", color: 'border-l-blue-400' },
    { key: 'objective',  label: 'O — Objective',  placeholder: "Clinician's observations: Mental status, affect, behavior, appearance, cognition, insight, judgment, any screening scores.", color: 'border-l-green-400' },
    { key: 'assessment', label: 'A — Assessment', placeholder: "Clinical interpretation: Progress toward goals, diagnostic impressions, functional status, risk assessment, clinical formulation.", color: 'border-l-amber-400' },
    { key: 'plan',       label: 'P — Plan',       placeholder: "Next steps: Interventions used, homework assigned, next session plan, referrals, medication coordination, crisis plan if indicated.", color: 'border-l-purple-400' },
  ],
  BIRP: [
    { key: 'subjective', label: 'B — Behavior',     placeholder: "Client's behavior and presentation: mood, affect, appearance, reported symptoms, functioning since last session.", color: 'border-l-blue-400' },
    { key: 'objective',  label: 'I — Intervention', placeholder: "What you did as the clinician: techniques used, topics addressed, modalities applied (CBT, DBT, EMDR, etc.), therapeutic exercises.", color: 'border-l-green-400' },
    { key: 'assessment', label: 'R — Response',     placeholder: "Client's response to interventions: engagement, insight gained, emotional shifts, resistance, progress toward treatment goals.", color: 'border-l-amber-400' },
    { key: 'plan',       label: 'P — Plan',         placeholder: "Next steps: homework assigned, next session focus, referrals, medication coordination, safety planning if indicated.", color: 'border-l-purple-400' },
  ],
  DAP: [
    { key: 'subjective', label: 'D — Data',       placeholder: "All observable and reported information: client's self-report, clinician observations, mental status, affect, behavior, screening scores.", color: 'border-l-blue-400' },
    { key: 'assessment', label: 'A — Assessment', placeholder: "Clinical interpretation of the data: diagnostic impressions, progress toward goals, risk assessment, clinical formulation, functional status.", color: 'border-l-amber-400' },
    { key: 'plan',       label: 'P — Plan',       placeholder: "Next steps: interventions, homework, next session plan, referrals, crisis planning if indicated.", color: 'border-l-purple-400' },
  ],
  GIRP: [
    { key: 'goals',        label: 'G — Goals',        placeholder: "Treatment goals addressed in this session: what is the client working toward? How do goals connect to the treatment plan?", color: 'border-l-indigo-400' },
    { key: 'intervention', label: 'I — Intervention', placeholder: "Clinician interventions: techniques used, topics addressed, therapeutic modalities applied, exercises aligned with treatment goals.", color: 'border-l-green-400' },
    { key: 'response',     label: 'R — Response',     placeholder: "Client's response to interventions: engagement level, progress toward goals, insight gained, emotional shifts, barriers encountered.", color: 'border-l-amber-400' },
    { key: 'plan',         label: 'P — Plan',         placeholder: "Next steps: homework assigned, goals for next session, referrals, adjustments to treatment approach, crisis planning if indicated.", color: 'border-l-purple-400' },
  ],
  DMH_SIR: [
    { key: 'situation', label: 'S — Situation / Presentation', placeholder: "Why this session was clinically necessary today: client's presentation, symptoms, stressors, stated concerns, observed behavior, and treatment focus.", color: 'border-l-blue-400' },
    { key: 'interventions', label: 'I — Interventions Used', placeholder: "Specific clinician interventions: modality, skills practiced, psychoeducation, safety planning, collateral/linkage, therapeutic stance, and clinical rationale.", color: 'border-l-green-400' },
    { key: 'response', label: 'R — Client Response', placeholder: "How the client responded: engagement, insight, affective shift, regulation, resistance, skill use, progress, or barriers.", color: 'border-l-amber-400' },
    { key: 'risk_safety', label: 'Risk / Safety Update', placeholder: "SI/HI/self-harm/substance/DV/abuse updates, protective factors, safety plan changes, crisis resources, and rationale if no acute risk was indicated.", color: 'border-l-red-400' },
    { key: 'functioning_medical_necessity', label: 'Functioning / Medical Necessity', placeholder: "Functional impairments and clinical necessity: home, work/school, relationships, ADLs, symptom impact, level-of-care rationale, and why treatment remains indicated.", color: 'border-l-cyan-400' },
    { key: 'plan_homework', label: 'Plan / Homework / Next Steps', placeholder: "Next session focus, homework, referrals, assessments, collateral tasks, frequency, coordination, and follow-up plan.", color: 'border-l-purple-400' },
  ],
}

function hasContent(noteData) {
  return Object.values(noteData).some(v => v && v.trim().length > 0)
}

function noteFormatLabel(fmt) {
  return fmt === 'DMH_SIR' ? 'DMH SIR' : fmt
}

function normalizeConvertedForFormat(fmt, converted = {}) {
  if (fmt === 'GIRP') {
    return {
      goals: converted.goals || converted.subjective || '',
      intervention: converted.intervention || converted.objective || '',
      response: converted.response || converted.assessment || '',
      plan: converted.plan || '',
    }
  }
  if (fmt === 'DMH_SIR') {
    return {
      situation: converted.situation || converted.subjective || '',
      interventions: converted.interventions || converted.intervention || converted.objective || '',
      response: converted.response || '',
      risk_safety: converted.risk_safety || converted.riskSafety || '',
      functioning_medical_necessity: converted.functioning_medical_necessity || converted.functioningMedicalNecessity || '',
      plan_homework: converted.plan_homework || converted.planHomework || converted.plan || '',
    }
  }
  return converted
}

function flattenNoteForLegacyColumns(fmt, active = {}) {
  if (fmt === 'GIRP') {
    return {
      subjective: active.goals || null,
      objective: active.intervention || null,
      assessment: active.response || null,
      plan: active.plan || null,
    }
  }
  if (fmt === 'DMH_SIR') {
    const assessmentParts = [
      active.response && `Client Response: ${active.response}`,
      active.risk_safety && `Risk/Safety: ${active.risk_safety}`,
      active.functioning_medical_necessity && `Functioning/Medical Necessity: ${active.functioning_medical_necessity}`,
    ].filter(Boolean)
    return {
      subjective: active.situation || null,
      objective: active.interventions || null,
      assessment: assessmentParts.join('\n\n') || null,
      plan: active.plan_homework || null,
    }
  }
  return {
    subjective: active.subjective || null,
    objective: active.objective || null,
    assessment: active.assessment || null,
    plan: active.plan || null,
  }
}

function buildFullNoteText(fmt, active = {}) {
  const fields = FORMAT_FIELDS[fmt] || []
  return fields
    .map(field => {
      const value = active[field.key]
      return value && value.trim() ? `${field.label}\n${value.trim()}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

// Rule-based CPT code suggestion based on session duration and client type
function suggestCptCode(clientType, durationMinutes, noteFormat) {
  if (noteFormat === 'INTAKE') return '90791'
  const dur = parseInt(durationMinutes) || 0
  if (clientType === 'group') return '90853'
  if (clientType === 'couple' || clientType === 'family') return '90847'
  // Individual psychotherapy by duration
  if (dur < 38) return '90832'
  if (dur < 53) return '90834'
  return '90837'
}

const CPT_LABELS = {
  '90791': 'Psychiatric diagnostic evaluation',
  '90832': '30 min individual psychotherapy',
  '90834': '45 min individual psychotherapy',
  '90837': '60 min individual psychotherapy',
  '90847': 'Family/couple therapy with patient',
  '90853': 'Group psychotherapy',
}

export default function SessionNote() {
  const { id: patientId, sessionId } = useParams()
  const navigate = useNavigate()
  const isNew = !sessionId

  const [patient, setPatient] = useState(null)
  const [meta, setMeta] = useState({
    session_date: new Date().toISOString().split('T')[0],
    icd10_codes: '',
    ai_feedback: '',
    duration_minutes: 50,
    cpt_code: '',
  })
  const [signedAt, setSignedAt] = useState(null)
  const [signing, setSigning] = useState(false)
  const [notes, setNotes] = useState(EMPTY_NOTES)
  const [activeFormat, setActiveFormat] = useState('SOAP')
  const [sessionNoteFormat, setSessionNoteFormat] = useState('SOAP')
  const [sessionNotesJson, setSessionNotesJson] = useState(null)

  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [aiResult, setAiResult] = useState('')
  const [generatingPlan, setGeneratingPlan] = useState(false)
  const [treatmentPlan, setTreatmentPlan] = useState('')
  const [savedTreatmentPlan, setSavedTreatmentPlan] = useState('')
  const [activeTab, setActiveTab] = useState('ai')
  const [copiedTab, setCopiedTab] = useState(null) // 'ai' | 'plan'
  const [draftSavedAt, setDraftSavedAt] = useState(null)

  // Assessment tab state
  const [sessionAssessments, setSessionAssessments] = useState([])
  const [showSessionAssessmentForm, setShowSessionAssessmentForm] = useState(false)
  const [sessionAssessmentType, setSessionAssessmentType] = useState('phq-9')
  const [sessionAssessmentResponses, setSessionAssessmentResponses] = useState({})
  const [submittingSessionAssessment, setSubmittingSessionAssessment] = useState(false)
  const [sessionAssessmentResult, setSessionAssessmentResult] = useState(null)

  // Dictation panel
  const [showDictation, setShowDictation] = useState(false)

  // Export functionality
  const { therapist } = useAuth()
  const [exportFormat, setExportFormat] = useState('pdf') // 'pdf' or 'text'
  const [isExporting, setIsExporting] = useState(false)

  const handleExportSession = async () => {
    setIsExporting(true)
    setError('')
    try {
      const exportNoteFormat = activeFormat
      const activeNotes = notes[exportNoteFormat] || notes.SOAP || {}

      // Build a session object from current state
      const sessionToExport = {
        session_date: meta.session_date || new Date().toISOString(),
        note_format: exportNoteFormat,
        notes_json: { ...notes },
        ...flattenNoteForLegacyColumns(exportNoteFormat, activeNotes),
        icd10_codes: meta.icd10_codes,
        cpt_code: meta.cpt_code,
        duration_minutes: meta.duration_minutes,
      }

      const patientName = patient?.display_name || patient?.client_id || 'Patient'
      const therapistName = therapist?.display_name || 'Therapist'
      const dateStr = meta.session_date ? new Date(meta.session_date).toISOString().split('T')[0] : 'undated'

      if (exportFormat === 'pdf') {
        const htmlContent = generateExportHTML([sessionToExport], patientName, therapistName)
        await exportToPDF(htmlContent, `${patientName}-${dateStr}.pdf`)
      } else {
        const textContent = exportAsText([sessionToExport], patientName, therapistName)
        downloadText(textContent, `${patientName}-${dateStr}.txt`)
      }
    } catch (err) {
      console.error('Export failed:', err)
      setError(`Failed to export session note: ${err.message || 'Unknown error'}`)
    }
    setIsExporting(false)
  }

  // Track the most recent AI-generated draft so we can capture the
  // therapist's edits as a style sample when they save.
  const aiDraftRef = useRef(null)

  const handleDictationApply = (data) => {
    const sections = typeof data === 'object' && data.sections ? data.sections : data
    setNotes(prev => ({
      SOAP: { ...prev.SOAP, ...(sections.SOAP || {}) },
      BIRP: { ...prev.BIRP, ...(sections.BIRP || {}) },
      DAP:  { ...prev.DAP,  ...(sections.DAP  || {}) },
      GIRP: { ...prev.GIRP, ...(sections.GIRP || {}) },
      DMH_SIR: { ...prev.DMH_SIR, ...(sections.DMH_SIR || {}) },
    }))
    // Remember the draft for later style-capture at save-time
    aiDraftRef.current = {
      source: 'dictate',
      sections,
      captured: false,
    }
  }

  /**
   * Post the AI-draft → saved-text diff to the style-capture endpoint.
   * Best-effort, non-blocking. Clears aiDraftRef after one capture to avoid
   * duplicate samples on subsequent saves of the same note.
   */
  const captureStyleSampleIfAny = (finalSessionId) => {
    const draft = aiDraftRef.current
    if (!draft || draft.captured) return
    // Use the currently-active format's draft + the currently-saved fields
    const aiFields = draft.sections?.[activeFormat] || {}
    const finalFields = notesRef.current?.[activeFormat] || {}
    // Only include fields where both sides are present + non-trivial
    const aiDraft = {}
    const finalText = {}
    for (const key of Object.keys(aiFields)) {
      if (typeof aiFields[key] === 'string' && typeof finalFields[key] === 'string') {
        aiDraft[key] = aiFields[key]
        finalText[key] = finalFields[key]
      }
    }
    if (Object.keys(aiDraft).length === 0) return
    try {
      apiFetch('/ai/style/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: finalSessionId || null,
          source: draft.source || 'manual',
          ai_draft: aiDraft,
          final_text: finalText,
        }),
      }).catch(() => {})
    } catch {}
    aiDraftRef.current = { ...draft, captured: true }
  }

  const notesRef = useRef(notes)
  const metaRef = useRef(meta)
  useEffect(() => { notesRef.current = notes }, [notes])
  useEffect(() => { metaRef.current = meta }, [meta])

  useEffect(() => {
    const loads = [apiFetch(`/patients/${patientId}`).then(r => r.json())]
    if (!isNew) loads.push(apiFetch(`/patients/${patientId}/sessions/${sessionId}`).then(r => r.json()))

    Promise.all(loads).then(([p, s]) => {
      setPatient(p)
      if (s) {
        setMeta({
          session_date:     s.session_date     || '',
          icd10_codes:      s.icd10_codes      || '',
          ai_feedback:      s.ai_feedback      || '',
          duration_minutes: s.duration_minutes || 50,
          cpt_code:         s.cpt_code         || '',
        })
        if (s.signed_at) setSignedAt(s.signed_at)
        if (s.ai_feedback) setAiResult(s.ai_feedback)
        if (s.treatment_plan) { setTreatmentPlan(s.treatment_plan); setSavedTreatmentPlan(s.treatment_plan) }

        setSessionNoteFormat(s.note_format || 'SOAP')

        let parsed = null
        if (s.notes_json) {
          try { parsed = JSON.parse(s.notes_json) } catch {}
        }
        setSessionNotesJson(parsed)

        // Load notes — prefer notes_json, but preserve intake sessions and older records
        if (parsed) {
          const generatedFormat = parsed.WORKSPACE?.generatedNoteFormat || 'SOAP'
          if (s.note_format === 'INTAKE') {
            const intakeFields = generatedFormat === 'DAP'
              ? {
                  subjective: s.subjective || '',
                  assessment: s.assessment || '',
                  plan: s.plan || '',
                }
              : {
                  subjective: s.subjective || '',
                  objective: s.objective || '',
                  assessment: s.assessment || '',
                  plan: s.plan || '',
                }
            setNotes(prev => ({
              ...prev,
              [generatedFormat]: {
                ...prev[generatedFormat],
                ...intakeFields,
              },
            }))
            setActiveFormat(generatedFormat)
          } else {
            // Normalise notes_json: older demo sessions used display keys (S/O/A/P, D/A/P, B/I/R/P)
            // instead of the semantic keys (subjective/objective/assessment/plan) the UI expects.
            // Remap them here so both old and new records display correctly.
            function normaliseParsed(raw, fmt) {
              if (!raw) return {}
              // Already in correct shape if it has 'subjective' key
              if ('subjective' in raw) return raw
              if ('goals' in raw) return raw
              if ('situation' in raw) return raw
              if (fmt === 'SOAP') return { subjective: raw.S || '', objective: raw.O || '', assessment: raw.A || '', plan: raw.P || '' }
              if (fmt === 'BIRP') return { subjective: raw.B || '', objective: raw.I || '', assessment: raw.R || '', plan: raw.P || '' }
              if (fmt === 'DAP')  return { subjective: raw.D || '', assessment: raw.A || '', plan: raw.P || '' }
              if (fmt === 'GIRP') return { goals: raw.G || '', intervention: raw.I || '', response: raw.R || '', plan: raw.P || '' }
              if (fmt === 'DMH_SIR') {
                return {
                  situation: raw.S || raw.situation || '',
                  interventions: raw.I || raw.interventions || raw.intervention || '',
                  response: raw.R || raw.response || '',
                  risk_safety: raw.risk_safety || raw.riskSafety || '',
                  functioning_medical_necessity: raw.functioning_medical_necessity || raw.functioningMedicalNecessity || '',
                  plan_homework: raw.P || raw.plan_homework || raw.planHomework || raw.plan || '',
                }
              }
              return raw
            }

            const normSOAP = normaliseParsed(parsed.SOAP, 'SOAP')
            const normBIRP = normaliseParsed(parsed.BIRP, 'BIRP')
            const normDAP  = normaliseParsed(parsed.DAP,  'DAP')
            const normGIRP = normaliseParsed(parsed.GIRP, 'GIRP')
            const normDMH = normaliseParsed(parsed.DMH_SIR, 'DMH_SIR')

            setNotes(prev => ({
              ...prev,
              SOAP: { ...prev.SOAP, ...normSOAP },
              BIRP: { ...prev.BIRP, ...normBIRP },
              DAP:  { ...prev.DAP,  ...normDAP  },
              GIRP: { ...prev.GIRP, ...normGIRP },
              DMH_SIR: { ...prev.DMH_SIR, ...normDMH },
            }))
            // Open whichever tab has content first
            const normalizedByFormat = { SOAP: normSOAP, BIRP: normBIRP, DAP: normDAP, GIRP: normGIRP, DMH_SIR: normDMH }
            const fmt = NOTE_FORMATS.find(f => hasContent(normalizedByFormat[f]))
            if (fmt) setActiveFormat(fmt)
          }
        } else if (s.note_format) {
          // Legacy: migrate old single-format data into the right slot
          if (s.note_format === 'INTAKE') {
            setNotes(prev => ({
              ...prev,
              SOAP: {
                ...prev.SOAP,
                subjective: s.subjective || '',
                objective: s.objective || '',
                assessment: s.assessment || '',
                plan: s.plan || '',
              },
            }))
            setActiveFormat('SOAP')
          } else {
            const legacyFields = s.note_format === 'GIRP'
              ? { goals: s.subjective || '', intervention: s.objective || '', response: s.assessment || '', plan: s.plan || '' }
              : s.note_format === 'DMH_SIR'
                ? {
                    situation: s.subjective || '',
                    interventions: s.objective || '',
                    response: s.assessment || '',
                    risk_safety: '',
                    functioning_medical_necessity: '',
                    plan_homework: s.plan || '',
                  }
                : {
                    subjective: s.subjective || '',
                    objective:  s.objective  || '',
                    assessment: s.assessment || '',
                    plan:       s.plan       || '',
                  }
            setNotes(prev => ({
              ...prev,
              [s.note_format]: {
                ...prev[s.note_format],
                ...legacyFields,
              },
            }))
            setActiveFormat(s.note_format)
          }
        }
      }
    }).catch(err => {
      console.error('[SessionNote] Failed to load:', err)
      setPatient({ client_id: patientId, display_name: 'Error loading patient' })
    })
  }, [patientId, sessionId, isNew])

  // Load existing assessments for this patient
  const loadSessionAssessments = useCallback(() => {
    if (!patientId) return
    fetch(`${API}/assessments/client/${patientId}`, { credentials: 'include' }).then(r => r.json()).then(data => {
      if (Array.isArray(data)) setSessionAssessments(data.slice(-6))
    }).catch(() => {})
  }, [patientId])

  useEffect(() => {
    loadSessionAssessments()
  }, [loadSessionAssessments])

  // Clinical note drafts can contain PHI, so browser storage is disabled here
  // until drafts move to an encrypted/server-side design.

  // Keyboard shortcut: Ctrl+S / Cmd+S to save
  const handleSaveRef = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSaveRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const patientContext = patient
    ? `Client ID: ${patient.client_id}\nAge: ${patient.age || 'N/A'}\nGender: ${patient.gender || 'N/A'}\nPresenting Concerns: ${patient.presenting_concerns || 'N/A'}\nCurrent Diagnoses: ${patient.diagnoses || 'N/A'}`
    : ''

  const setField = (key, value) => {
    setNotes(n => ({ ...n, [activeFormat]: { ...n[activeFormat], [key]: value } }))
  }

  // ── /resource slash-command state ─────────────────────────────────────────
  // When a clinician types "/resource" in any section textarea, an inline
  // picker pops up under that textarea. State tracks which field is active,
  // where the trigger started (so we can splice the inserted reference into
  // the right spot), and the trailing query for filtering.
  const [resourceTrigger, setResourceTrigger] = useState(null) // { fieldKey, triggerStart, query, caret } | null
  const fieldRefs = useRef({})

  const handleFieldChange = (fieldKey, e) => {
    if (signedAt) return
    const value = e.target.value
    const caret = e.target.selectionStart ?? value.length
    setField(fieldKey, value)
    const trig = detectResourceTrigger(value, caret)
    if (trig) {
      setResourceTrigger({ fieldKey, ...trig, caret })
    } else if (resourceTrigger?.fieldKey === fieldKey) {
      setResourceTrigger(null)
    }
  }

  const insertResourceMention = (item) => {
    if (!resourceTrigger) return
    const { fieldKey, triggerStart, caret } = resourceTrigger
    const current = (notes[activeFormat] || {})[fieldKey] || ''
    const mention = formatResourceMention(item)
    const before = current.slice(0, triggerStart)
    const after = current.slice(caret)
    // Add a trailing space so the clinician keeps typing naturally.
    const next = `${before}${mention} ${after}`
    setField(fieldKey, next)
    setResourceTrigger(null)
    // Restore caret position right after the inserted mention.
    requestAnimationFrame(() => {
      const el = fieldRefs.current[fieldKey]
      if (el) {
        const pos = before.length + mention.length + 1
        try { el.setSelectionRange(pos, pos); el.focus() } catch {}
      }
    })
  }

  const readStream = async (res, onChunk) => {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const data = JSON.parse(line.slice(6))
          if (data.error) throw new Error(data.error)
          if (data.text) { fullText += data.text; onChunk(fullText) }
        } catch (e) {
          if (e.message !== 'Unexpected end of JSON input') throw e
        }
      }
    }
    return fullText
  }

  const activeNotes = notes[activeFormat]

  const handleAnalyze = async ({ switchTab = true } = {}) => {
    setAnalyzing(true)
    setAiResult('')
    if (switchTab) setActiveTab('ai')
    setError('')
    try {
      const legacyColumns = flattenNoteForLegacyColumns(activeFormat, activeNotes)
      const res = await apiFetch(`/ai/analyze-notes`, {
        method: 'POST',
        body: JSON.stringify({
          patientContext,
          noteFormat: activeFormat,
          subjective: legacyColumns.subjective,
          objective:  legacyColumns.objective,
          assessment: legacyColumns.assessment,
          plan:       legacyColumns.plan,
          patientId,
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Analysis failed') }
      const fullText = await readStream(res, (text) => setAiResult(text))
      setMeta(m => ({ ...m, ai_feedback: fullText }))
      // Auto-save analysis to DB immediately if editing existing session
      if (!isNew && sessionId) {
        apiFetch(`/patients/${patientId}/sessions/${sessionId}`, {
          method: 'PUT', body: JSON.stringify({ ai_feedback: fullText })
        }).catch(() => {})
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleGeneratePlan = async ({ switchTab = true } = {}) => {
    setGeneratingPlan(true)
    setTreatmentPlan('')
    if (switchTab) setActiveTab('plan')
    setError('')
    try {
      const res = await apiFetch(`/ai/treatment-plan`, {
        method: 'POST',
        body: JSON.stringify({
          patientContext,
          diagnoses: patient?.diagnoses || flattenNoteForLegacyColumns(activeFormat, activeNotes).assessment,
          sessionNotes: buildFullNoteText(activeFormat, activeNotes),
          goals: flattenNoteForLegacyColumns(activeFormat, activeNotes).plan,
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Plan generation failed') }
      const planText = await readStream(res, (text) => setTreatmentPlan(text))
      setSavedTreatmentPlan(planText)
      // Auto-save treatment plan to DB immediately if editing existing session
      if (!isNew && sessionId) {
        apiFetch(`/patients/${patientId}/sessions/${sessionId}`, {
          method: 'PUT', body: JSON.stringify({ treatment_plan: planText })
        }).catch(() => {})
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setGeneratingPlan(false)
    }
  }

  const handleGenerateBoth = () => {
    handleAnalyze({ switchTab: false })
    handleGeneratePlan({ switchTab: false })
    setActiveTab('ai')
  }

  const buildSaveBody = (extraFields = {}) => {
    const isIntakeSession = sessionNoteFormat === 'INTAKE'
    const noteFormatToSave = isIntakeSession ? 'INTAKE' : activeFormat
    const active = notes[activeFormat]
    const nextNotesJson = { ...(sessionNotesJson || {}), ...notes }
    if (isIntakeSession) {
      nextNotesJson.WORKSPACE = {
        ...(sessionNotesJson?.WORKSPACE || {}),
        generatedNoteFormat: sessionNotesJson?.WORKSPACE?.generatedNoteFormat || activeFormat,
      }
    }
    // For GIRP format, cross-map to standard columns so agent queries
    // and legacy displays still get meaningful data.
    // GIRP: goals→subjective, intervention→objective, response→assessment, plan→plan
    const legacyColumns = flattenNoteForLegacyColumns(noteFormatToSave, active)
    return {
      ...meta,
      note_format:    noteFormatToSave,
      subjective:     legacyColumns.subjective,
      objective:      legacyColumns.objective,
      assessment:     legacyColumns.assessment,
      plan:           legacyColumns.plan,
      notes_json:     JSON.stringify(nextNotesJson),
      full_note:      buildFullNoteText(noteFormatToSave, active) || null,
      treatment_plan: savedTreatmentPlan || null,
      ...extraFields,
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const method = isNew ? 'POST' : 'PUT'
      const url = isNew
        ? `/patients/${patientId}/sessions`
        : `/patients/${patientId}/sessions/${sessionId}`

      // When saving a signed session we must pass signed_at so the server allows the update
      const body = buildSaveBody(signedAt ? { signed_at: signedAt } : {})
      const res = await apiFetch(url, { method, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      // Style-adaptation: compare the last AI draft to what we actually saved,
      // fire-and-forget to /ai/style/capture. Ignore any errors — style
      // capture must never block the save UX.
      captureStyleSampleIfAny(data?.id || sessionId)
      navigate(`/patients/${patientId}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSign = async () => {
    setSigning(true)
    setError('')
    try {
      const method = isNew ? 'POST' : 'PUT'
      const url = isNew
        ? `/patients/${patientId}/sessions`
        : `/patients/${patientId}/sessions/${sessionId}`
      const now = new Date().toISOString()
      const body = buildSaveBody({ signed_at: now })
      const res = await apiFetch(url, { method, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sign failed')
      setSignedAt(now)
      captureStyleSampleIfAny(data?.id || sessionId)
      // Update sessionId if it was a new session that just got created
      if (isNew && data.id) {
        navigate(`/patients/${patientId}/sessions/${data.id}`, { replace: true })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSigning(false)
    }
  }

  const handleUnlock = async () => {
    if (!sessionId) return
    setError('')
    try {
      const res = await apiFetch(`/patients/${patientId}/sessions/${sessionId}`, {
        method: 'PUT',
        body: JSON.stringify({ signed_at: null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unlock failed')
      setSignedAt(null)
    } catch (err) {
      setError(err.message)
    }
  }

  // Keep handleSaveRef current so keyboard shortcut always calls the latest version
  useEffect(() => { handleSaveRef.current = handleSave })

  const anyLoading = analyzing || generatingPlan
  const activeFields = FORMAT_FIELDS[activeFormat] || []

  // Total word count across all filled fields in active format
  const activeNoteData = notes[activeFormat] || {}
  const totalWords = Object.values(activeNoteData)
    .filter(Boolean)
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length

  return (
    <div className="p-6 max-w-[1400px] mx-auto">

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5 gap-4">
        <nav className="flex items-center gap-2 text-sm text-gray-500 min-w-0">
          <Link to="/patients" className="hover:text-brand-600 whitespace-nowrap">Patients</Link>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <Link to={`/patients/${patientId}`} className="hover:text-brand-600 whitespace-nowrap">{patient?.client_id || '…'}</Link>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-900 font-medium truncate">{isNew ? 'New Session' : 'Edit Session'}</span>
        </nav>
        <div className="flex items-center gap-2 flex-shrink-0">
          {signedAt ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Signed {new Date(signedAt).toLocaleDateString()}
              </span>
              <button onClick={handleUnlock} className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50">
                Unlock
              </button>
              <button onClick={() => navigate(`/patients/${patientId}`)} className="btn-secondary text-sm">Close</button>
            </div>
          ) : (
            <>
              {draftSavedAt && (
                <span className="text-xs text-gray-400 hidden sm:block">
                  Draft saved {draftSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}

              {/* Export dropdown */}
              <div className="relative group">
                <button
                  className="px-3 py-1.5 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex items-center gap-1.5"
                  title="Export this session note"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export
                </button>
                <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                  <button
                    onClick={() => { setExportFormat('pdf'); handleExportSession(); }}
                    disabled={isExporting}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 first:rounded-t-lg disabled:opacity-50"
                  >
                    {isExporting && exportFormat === 'pdf' ? 'Exporting PDF…' : 'Export as PDF'}
                  </button>
                  <button
                    onClick={() => { setExportFormat('text'); handleExportSession(); }}
                    disabled={isExporting}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 last:rounded-b-lg disabled:opacity-50"
                  >
                    {isExporting && exportFormat === 'text' ? 'Exporting Text…' : 'Export as Text'}
                  </button>
                </div>
              </div>

              {/* Convert format dropdown */}
              <div className="relative group">
                <button
                  className="px-3 py-1.5 text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors flex items-center gap-1.5"
                  title="Convert to different note format"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Convert
                </button>
                <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 max-h-80 overflow-y-auto">
                  <div className="px-3 py-2 border-b border-gray-100">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Convert format</p>
                  </div>
                  {NOTE_FORMATS.filter(f => f !== sessionNoteFormat).map(fmt => (
                    <div key={fmt} className="border-b border-gray-50 last:border-0">
                      <p className="px-3 pt-2 pb-1 text-xs font-semibold text-gray-800">{noteFormatLabel(fmt)}</p>
                      {[
                        { id: 'concise', label: 'Concise', desc: 'Short, clinical shorthand' },
                        { id: 'standard', label: 'Standard', desc: 'Professional' },
                        { id: 'detailed', label: 'Detailed', desc: 'Thorough, court-ready' },
                      ].map(v => (
                        <button
                          key={`${fmt}-${v.id}`}
                          onClick={async () => {
                            try {
                              const r = await apiFetch('/ai/convert-note', {
                                method: 'POST',
                                body: JSON.stringify({ sessionId, targetFormat: fmt, verbosity: v.id }),
                              })
                              const d = await r.json()
                              if (!r.ok) throw new Error(d.error)
                              setNotes(n => ({
                                ...n,
                                [fmt]: normalizeConvertedForFormat(fmt, d.converted || {}),
                              }))
                              setActiveFormat(fmt)
                              setSessionNoteFormat(fmt)
                            } catch (err) {
                              alert(`Conversion failed: ${err.message}`)
                            }
                          }}
                          className="block w-full text-left px-3 py-1.5 text-xs text-gray-600 hover:bg-indigo-50 hover:text-indigo-700"
                        >
                          {v.label} <span className="text-gray-400">— {v.desc}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={() => navigate(`/patients/${patientId}`)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={handleSave} disabled={saving || signing} className="btn-secondary text-sm" title="Save (Ctrl+S)">
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
              <button
                onClick={handleSign}
                disabled={saving || signing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors shadow-sm disabled:opacity-50"
                title="Sign and lock this session note"
              >
                {signing ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white/50 border-t-white rounded-full animate-spin" /> Signing…</>
                ) : (
                  <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg> Sign &amp; Lock</>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-5 flex items-start gap-2">
          <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {/* ── Main 50/50 grid ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

        {/* ── LEFT ────────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Session meta */}
          <div className="card p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <label className="label">Session Date</label>
                <input
                  type="date"
                  className="input"
                  readOnly={!!signedAt}
                  value={meta.session_date}
                  onChange={e => !signedAt && setMeta(m => ({ ...m, session_date: e.target.value }))}
                />
              </div>
              {patient && (
                <div className="flex-1 min-w-0">
                  <label className="label">Patient</label>
                  <div className="flex items-center gap-2 h-9">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-teal-400 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-white">{patient.client_id?.substring(0, 2).toUpperCase()}</span>
                    </div>
                    <span className="text-sm font-medium text-gray-800">{patient.client_id}</span>
                    {patient.age && <span className="badge bg-gray-100 text-gray-600">Age {patient.age}</span>}
                    {patient.diagnoses && <span className="text-xs text-teal-700 font-medium truncate">{patient.diagnoses}</span>}
                  </div>
                  {sessionNoteFormat === 'INTAKE' && (
                    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Intake session preserved in the chart. Workspace metadata will stay attached when you save.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Note Format Tabs + Fields */}
          <div className="card overflow-hidden">
            {/* Format tabs + Dictate button */}
            <div className="flex border-b border-gray-100 items-center">
              {NOTE_FORMATS.map(fmt => {
                const filled = hasContent(notes[fmt])
                return (
                  <button
                    key={fmt}
                    onClick={() => setActiveFormat(fmt)}
                    className={`flex-shrink-0 px-4 py-3 text-xs font-semibold transition-colors border-b-2 whitespace-nowrap ${
                      activeFormat === fmt
                        ? 'text-brand-700 border-brand-600 bg-brand-50/40'
                        : 'text-gray-400 border-transparent hover:text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {noteFormatLabel(fmt)}
                    {filled && (
                      <span className={`w-1.5 h-1.5 rounded-full inline-block ml-2 ${activeFormat === fmt ? 'bg-brand-500' : 'bg-green-400'}`} />
                    )}
                  </button>
                )
              })}
              {/* Dictate button */}
              <button
                onClick={() => setShowDictation(d => !d)}
                title="Dictate session note with your voice"
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-3 text-xs font-semibold transition-colors border-b-2 ${
                  showDictation
                    ? 'text-brand-700 border-brand-600 bg-brand-50/40'
                    : 'text-gray-400 border-transparent hover:text-brand-600 hover:bg-brand-50/30'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                <span className="hidden sm:inline">Dictate</span>
              </button>
            </div>

            {/* Dictation panel */}
            {showDictation && (
              <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                <DictationPanel
                  onApply={handleDictationApply}
                  onClose={() => setShowDictation(false)}
                />
              </div>
            )}

            {/* Fields for active format */}
            <div className="p-5 space-y-4">
              {activeFields.map(field => {
                const val = notes[activeFormat][field.key] || ''
                const charCount = val.length
                const showPicker = !signedAt && resourceTrigger?.fieldKey === field.key
                return (
                  <div key={field.key}>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="label mb-0">{field.label}</label>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-indigo-400 hidden sm:inline">
                          tip: type <code className="text-indigo-600 font-semibold">/resource</code> to attach
                        </span>
                        {charCount > 0 && (
                          <span className={`text-xs ${charCount < 50 ? 'text-amber-500' : 'text-gray-400'}`}>
                            {charCount} chars
                          </span>
                        )}
                      </div>
                    </div>
                    <textarea
                      ref={el => { fieldRefs.current[field.key] = el }}
                      className={`textarea border-l-4 ${field.color} rounded-l-none ${signedAt ? 'bg-gray-50 text-gray-600 cursor-default' : ''}`}
                      rows={4}
                      readOnly={!!signedAt}
                      value={val}
                      onChange={e => handleFieldChange(field.key, e)}
                      onBlur={() => {
                        // Hide the picker on blur, but only if focus is moving
                        // outside the picker itself (mouse-clicks on items use
                        // onMouseDown w/ preventDefault to keep focus on the
                        // textarea, so the picker stays visible during selection).
                        setTimeout(() => {
                          if (resourceTrigger?.fieldKey === field.key &&
                              document.activeElement !== fieldRefs.current[field.key]) {
                            setResourceTrigger(null)
                          }
                        }, 150)
                      }}
                      placeholder={field.placeholder}
                    />
                    {showPicker && (
                      <ResourceMentionPicker
                        query={resourceTrigger.query}
                        onPick={insertResourceMention}
                        onClose={() => setResourceTrigger(null)}
                      />
                    )}
                  </div>
                )
              })}

              {/* Active risk-language monitor — non-blocking nudge */}
              <RiskMonitorBadge
                text={Object.values(notes[activeFormat] || {}).filter(v => typeof v === 'string').join('\n\n')}
                patientId={patientId}
                signed={!!signedAt}
              />

              <div>
                <label className="label">ICD-10 Codes <span className="text-gray-400 font-normal">(optional, AI will suggest)</span></label>
                <input
                  className="input"
                  readOnly={!!signedAt}
                  value={meta.icd10_codes}
                  onChange={e => setMeta(m => ({ ...m, icd10_codes: e.target.value }))}
                  placeholder="e.g. F41.1, F32.1"
                />
              </div>

              {/* Duration + CPT Code */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Session Duration</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[30, 45, 50, 53, 60, 75, 90].map(d => (
                      <button
                        key={d}
                        type="button"
                        disabled={!!signedAt}
                        onClick={() => setMeta(m => ({ ...m, duration_minutes: d }))}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                          meta.duration_minutes === d
                            ? 'bg-brand-600 text-white border-brand-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300 disabled:opacity-50'
                        }`}
                      >
                        {d}m
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">CPT Code</label>
                  {(() => {
                    const suggested = suggestCptCode(patient?.client_type, meta.duration_minutes, sessionNoteFormat)
                    return (
                      <div className="space-y-1.5">
                        {suggested && !meta.cpt_code && (
                          <button
                            type="button"
                            disabled={!!signedAt}
                            onClick={() => setMeta(m => ({ ...m, cpt_code: suggested }))}
                            className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-2.5 py-1 hover:bg-brand-100 transition-colors disabled:opacity-50"
                            title={CPT_LABELS[suggested]}
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            Suggest {suggested}
                          </button>
                        )}
                        <input
                          className="input text-sm"
                          readOnly={!!signedAt}
                          value={meta.cpt_code}
                          onChange={e => setMeta(m => ({ ...m, cpt_code: e.target.value }))}
                          placeholder={suggested || '90837'}
                        />
                        {meta.cpt_code && CPT_LABELS[meta.cpt_code] && (
                          <p className="text-xs text-gray-400">{CPT_LABELS[meta.cpt_code]}</p>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>
          </div>

          {/* Signed note overlay */}
          {signedAt && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
              <svg className="w-5 h-5 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-emerald-800">Note signed &amp; locked</p>
                <p className="text-xs text-emerald-600">Signed {new Date(signedAt).toLocaleString()} — fields are read-only. Click <strong>Unlock</strong> above to edit.</p>
              </div>
            </div>
          )}

          {/* Generate actions */}
          <div className="card p-4 space-y-3">
            {totalWords > 0 && (
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>{totalWords} word{totalWords !== 1 ? 's' : ''} across {activeFormat} fields</span>
                {totalWords < 30 && <span className="text-amber-500 font-medium">Add more detail for better results</span>}
              </div>
            )}
            {/* ── Pillar 7: AI Enrichment — prominent placement above Generate ── */}
            {!isNew && sessionId && (
              <NoteEnrichments
                sessionId={sessionId}
                therapistId={therapist?.id}
                onPlanAppend={(text) => {
                  setNotes(n => ({
                    ...n,
                    [activeFormat]: {
                      ...n[activeFormat],
                      plan: (n[activeFormat].plan ? n[activeFormat].plan + '\n' : '') + text,
                    },
                  }))
                }}
              />
            )}

            <button
              onClick={handleGenerateBoth}
              disabled={anyLoading || !!signedAt}
              className="btn-primary w-full justify-center py-2.5"
            >
              {anyLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate Analysis + Treatment Plan
                </>
              )}
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => handleAnalyze()}
                disabled={analyzing}
                className="btn-secondary flex-1 text-xs justify-center"
              >
                {analyzing
                  ? <><div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" /> Analyzing…</>
                  : 'Analysis only'}
              </button>
              <button
                onClick={() => handleGeneratePlan()}
                disabled={generatingPlan}
                className="btn-secondary flex-1 text-xs justify-center"
              >
                {generatingPlan
                  ? <><div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" /> Generating…</>
                  : 'Treatment plan only'}
              </button>
            </div>
          </div>

        </div>

        {/* ── RIGHT: AI output (sticky) ────────────────────────────────── */}
        <div className="xl:sticky xl:top-4 space-y-3">
          <div className="card overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 120px)' }}>

            <div className="flex border-b border-gray-100 flex-shrink-0 items-center">
              {[
                { id: 'ai',   label: 'AI Analysis',    loading: analyzing,      hasContent: !!aiResult,       text: aiResult },
                { id: 'plan', label: 'Treatment Plan',  loading: generatingPlan, hasContent: !!treatmentPlan,  text: treatmentPlan },
                { id: 'assessments', label: 'Assessments', loading: false, hasContent: sessionAssessments.length > 0, text: '' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-2 text-xs font-medium py-3 transition-colors border-b-2 ${
                    activeTab === tab.id
                      ? 'text-brand-600 border-brand-600 bg-brand-50/40'
                      : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {tab.id === 'assessments' ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  ) : null}
                  {tab.label}
                  {tab.loading && (
                    <div className="w-3 h-3 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                  )}
                  {!tab.loading && tab.hasContent && (
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  )}
                </button>
              ))}
              {/* Copy button for active tab's content */}
              {(activeTab === 'ai' ? aiResult : activeTab === 'plan' ? treatmentPlan : '') && (
                <button
                  onClick={() => {
                    const text = activeTab === 'ai' ? aiResult : treatmentPlan
                    navigator.clipboard.writeText(text).then(() => {
                      setCopiedTab(activeTab)
                      setTimeout(() => setCopiedTab(null), 2000)
                    }).catch(() => {})
                  }}
                  className="flex-shrink-0 px-3 py-2.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors border-b-2 border-transparent"
                  title="Copy to clipboard"
                >
                  {copiedTab === activeTab
                    ? <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  }
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {activeTab === 'ai' && (
                <div className="p-5">
                  {aiResult ? (
                    <>
                      {analyzing && (
                        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-brand-50 border border-brand-100">
                          <div className="w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                          <p className="text-xs text-brand-700 font-medium">Writing analysis…</p>
                        </div>
                      )}
                      <div className="prose-clinical" dangerouslySetInnerHTML={{ __html: renderMarkdown(aiResult) }} />
                    </>
                  ) : analyzing ? (
                    <div className="flex flex-col items-center justify-center py-16">
                      <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mb-3" />
                      <p className="text-sm text-gray-500">Analyzing session notes…</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                      <div className="w-12 h-12 rounded-full bg-brand-50 border border-brand-100 flex items-center justify-center mb-3">
                        <svg className="w-6 h-6 text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-gray-700 mb-1">AI Analysis</p>
                      <p className="text-xs text-gray-400">ICD-10 codes, differential diagnoses, clinical feedback, and safety considerations will appear here.</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'plan' && (
                <div className="p-5">
                  {treatmentPlan ? (
                    <>
                      {generatingPlan && (
                        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-teal-50 border border-teal-100">
                          <div className="w-3 h-3 border-2 border-teal-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                          <p className="text-xs text-teal-700 font-medium">Writing treatment plan…</p>
                        </div>
                      )}
                      <div className="prose-clinical" dangerouslySetInnerHTML={{ __html: renderMarkdown(treatmentPlan) }} />
                    </>
                  ) : generatingPlan ? (
                    <div className="flex flex-col items-center justify-center py-16">
                      <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mb-3" />
                      <p className="text-sm text-gray-500">Generating treatment plan…</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                      <div className="w-12 h-12 rounded-full bg-teal-50 border border-teal-100 flex items-center justify-center mb-3">
                        <svg className="w-6 h-6 text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-gray-700 mb-1">Treatment Plan</p>
                      <p className="text-xs text-gray-400">Problem list, goals, objectives, evidence-based interventions, and progress monitoring will appear here.</p>
                    </div>
                  )}
                </div>
              )}
              {activeTab === 'assessments' && (
                <div className="p-5 space-y-4">
                  {/* Past assessments table */}
                  {sessionAssessments.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recent Assessments</p>
                      <div className="rounded-xl border border-gray-100 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50">
                              <th className="text-left px-3 py-2 text-gray-500 font-semibold">Date</th>
                              <th className="text-left px-3 py-2 text-gray-500 font-semibold">Type</th>
                              <th className="text-right px-3 py-2 text-gray-500 font-semibold">Score</th>
                              <th className="text-right px-3 py-2 text-gray-500 font-semibold">Severity</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {sessionAssessments.map(a => (
                              <tr key={a.id} className="hover:bg-gray-50">
                                <td className="px-3 py-2 text-gray-600">{a.administered_at ? new Date(a.administered_at).toLocaleDateString() : '—'}</td>
                                <td className="px-3 py-2 font-medium text-gray-700 uppercase">{a.template_type}</td>
                                <td className="px-3 py-2 text-right font-bold text-gray-900">{a.total_score}</td>
                                <td className="px-3 py-2 text-right">
                                  <span className="px-2 py-0.5 rounded-full text-white font-semibold text-xs" style={{ background: a.severity_color || '#6B7280' }}>
                                    {a.severity_level}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Administer Now button */}
                  {!showSessionAssessmentForm && (
                    <button
                      onClick={() => { setShowSessionAssessmentForm(true); setSessionAssessmentResult(null); setSessionAssessmentResponses({}) }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Administer Now
                    </button>
                  )}

                  {/* Inline assessment form */}
                  {showSessionAssessmentForm && !sessionAssessmentResult && (
                    <div className="space-y-3">
                      {/* Type selector */}
                      <div className="flex gap-2">
                        {Object.keys(SESSION_TEMPLATES).map(t => (
                          <button
                            key={t}
                            onClick={() => { setSessionAssessmentType(t); setSessionAssessmentResponses({}) }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                              sessionAssessmentType === t
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                            }`}
                          >
                            {SESSION_TEMPLATES[t].name}
                          </button>
                        ))}
                        <button
                          onClick={() => setShowSessionAssessmentForm(false)}
                          className="ml-auto px-2 py-1.5 text-gray-400 hover:text-gray-600 text-xs"
                        >
                          Cancel
                        </button>
                      </div>

                      {/* Instructions (if template has them) */}
                      {SESSION_TEMPLATES[sessionAssessmentType].instructions && (
                        <p className="text-xs text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2 font-medium">
                          {SESSION_TEMPLATES[sessionAssessmentType].instructions}
                        </p>
                      )}

                      {/* Questions */}
                      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                        {SESSION_TEMPLATES[sessionAssessmentType].questions.map((q, i) => {
                          const tmplOpts = SESSION_TEMPLATES[sessionAssessmentType].options
                          const isYesNo = SESSION_TEMPLATES[sessionAssessmentType].isYesNo
                          const optCount = tmplOpts.length
                          // 2 opts → side by side, 3-4 opts → 2-col grid, 5 opts → single column
                          const gridClass = isYesNo ? 'grid grid-cols-2 gap-2' : optCount <= 4 ? 'grid grid-cols-2 gap-1' : 'flex flex-col gap-1'
                          return (
                            <div key={i} className={`rounded-lg border p-3 transition-all ${sessionAssessmentResponses[i] !== undefined ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-100'}`}>
                              <p className="text-xs font-medium text-gray-700 mb-2">
                                <span className="text-indigo-400 font-bold mr-1">{i + 1}.</span>{q}
                              </p>
                              <div className={gridClass}>
                                {tmplOpts.map(opt => (
                                  <button
                                    key={opt.value}
                                    onClick={() => setSessionAssessmentResponses(prev => ({ ...prev, [i]: { index: i, value: opt.value } }))}
                                    className={`text-left px-2 py-1.5 rounded text-xs border transition-all ${
                                      sessionAssessmentResponses[i]?.value === opt.value
                                        ? isYesNo && opt.value === 1
                                          ? 'bg-red-600 text-white border-red-600'   // YES = red for C-SSRS
                                          : 'bg-indigo-600 text-white border-indigo-600'
                                        : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                                    }`}
                                  >
                                    {isYesNo ? (
                                      <span className="font-bold">{opt.label}</span>
                                    ) : (
                                      <><span className="font-bold">{opt.value}</span> — {opt.label}</>
                                    )}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {/* Submit */}
                      {(() => {
                        const tmpl = SESSION_TEMPLATES[sessionAssessmentType]
                        const answered = Object.keys(sessionAssessmentResponses).length
                        const total = tmpl.questions.length
                        const score = Object.values(sessionAssessmentResponses).reduce((s, r) => s + (r?.value ?? 0), 0)
                        return (
                          <div className="flex items-center justify-between pt-2">
                            <span className="text-xs text-gray-500">{answered}/{total} answered · Running: <strong>{score}</strong></span>
                            <button
                              disabled={answered < total || submittingSessionAssessment}
                              onClick={async () => {
                                setSubmittingSessionAssessment(true)
                                try {
                                  const orderedResponses = tmpl.questions.map((_, i) => ({
                                    index: i,
                                    value: sessionAssessmentResponses[i]?.value ?? 0,
                                  }))
                                  const res = await fetch(`${API}/assessments`, {
                                    method: 'POST',
                                    credentials: 'include',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      patient_id: patientId,
                                      template_type: sessionAssessmentType,
                                      responses: orderedResponses,
                                      session_id: sessionId || null,
                                    }),
                                  })
                                  const data = await res.json()
                                  if (!res.ok) throw new Error(data.error)
                                  setSessionAssessmentResult(data)
                                  loadSessionAssessments()
                                } catch (err) {
                                  alert('Error: ' + err.message)
                                } finally {
                                  setSubmittingSessionAssessment(false)
                                }
                              }}
                              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                                answered === total && !submittingSessionAssessment
                                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              }`}
                            >
                              {submittingSessionAssessment ? 'Submitting…' : 'Submit'}
                            </button>
                          </div>
                        )
                      })()}
                    </div>
                  )}

                  {/* Result display */}
                  {sessionAssessmentResult && (
                    <div className={`rounded-xl border-2 p-4 space-y-2 ${sessionAssessmentResult.risk_flags?.length > 0 ? 'border-red-300 bg-red-50' : 'border-indigo-200 bg-indigo-50'}`}>
                      <p className="text-sm font-bold text-gray-900">
                        {sessionAssessmentType.toUpperCase()} — Submitted
                      </p>
                      <div className="flex items-center gap-3">
                        <span className="text-3xl font-bold" style={{ color: sessionAssessmentResult.severity_color || '#6366F1' }}>
                          {sessionAssessmentResult.total_score}
                        </span>
                        <span className="px-3 py-1 rounded-full text-white text-xs font-semibold" style={{ background: sessionAssessmentResult.severity_color || '#6B7280' }}>
                          {sessionAssessmentResult.severity_level}
                        </span>
                        {sessionAssessmentResult.score_change !== null && sessionAssessmentResult.score_change !== undefined && (
                          <span className={`text-xs font-semibold ${sessionAssessmentResult.score_change < 0 ? 'text-emerald-700' : sessionAssessmentResult.score_change > 0 ? 'text-red-700' : 'text-gray-500'}`}>
                            {sessionAssessmentResult.score_change > 0 ? '+' : ''}{sessionAssessmentResult.score_change} from last
                          </span>
                        )}
                      </div>
                      {/* C-SSRS active ideation warning */}
                      {sessionAssessmentType === 'cssrs' && sessionAssessmentResult.total_score >= 2 && (
                        <p className="text-xs text-red-800 font-bold bg-red-100 border border-red-300 rounded-lg px-3 py-2">
                          🚨 ACTIVE IDEATION DETECTED. Complete safety assessment and document plan.
                        </p>
                      )}
                      {sessionAssessmentType === 'cssrs' && sessionAssessmentResult.total_score === 1 && (
                        <p className="text-xs text-amber-800 font-semibold bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          ⚠️ Passive ideation endorsed. Assess intent, plan, and means.
                        </p>
                      )}
                      {/* PCL-5 PTSD threshold */}
                      {sessionAssessmentType === 'pcl-5' && sessionAssessmentResult.total_score >= 33 && (
                        <p className="text-xs text-orange-800 font-semibold bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                          ⚠️ Score ≥ 33. Provisional PTSD threshold met. Full diagnostic evaluation recommended.
                        </p>
                      )}
                      {/* General risk flag */}
                      {sessionAssessmentResult.risk_flags?.length > 0 && sessionAssessmentType !== 'cssrs' && (
                        <p className="text-xs text-red-700 font-semibold bg-red-50 rounded-lg px-3 py-2">
                          ⚠️ Risk flag detected. Review immediately and update safety plan.
                        </p>
                      )}
                      <button
                        onClick={() => { setShowSessionAssessmentForm(false); setSessionAssessmentResult(null); setSessionAssessmentResponses({}) }}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        Administer another →
                      </button>
                    </div>
                  )}

                  {sessionAssessments.length === 0 && !showSessionAssessmentForm && (
                    <div className="text-center py-8 text-gray-400">
                      <div className="text-3xl mb-2">📊</div>
                      <p className="text-sm font-medium text-gray-600">No assessments yet</p>
                      <p className="text-xs mt-1">Click "Administer Now" to add one</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {patient && (patient.diagnoses || patient.presenting_concerns) && (
            <div className="card p-4 bg-gray-50 border-gray-200">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Patient Context</p>
              <dl className="space-y-1">
                {patient.diagnoses && (
                  <div className="flex gap-2">
                    <dt className="text-xs text-gray-400 w-14 flex-shrink-0">Dx</dt>
                    <dd className="text-xs text-teal-700 font-medium">{patient.diagnoses}</dd>
                  </div>
                )}
                {patient.presenting_concerns && (
                  <div className="flex gap-2">
                    <dt className="text-xs text-gray-400 w-14 flex-shrink-0">Concerns</dt>
                    <dd className="text-xs text-gray-600">{patient.presenting_concerns}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
