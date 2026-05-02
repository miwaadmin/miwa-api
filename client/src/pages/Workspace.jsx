import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, apiUpload } from '../lib/api'


const ORIENTATIONS = [
  'MFT/Systemic', 'Structural', 'Bowenian', 'Strategic', 'Solution-Focused',
  'Narrative', 'EFT', 'CBT', 'DBT', 'Trauma-Focused', 'EMDR',
  'Psychodynamic', 'Attachment-Based', 'Motivational Interviewing', 'ACT', 'Integrative / Other',
]

const ONGOING_TABS = [
  { id: 'documentation', label: 'Documentation' },
  { id: 'clinicalThinking', label: 'Clinical Thinking' },
  { id: 'diagnosis', label: 'Diagnosis' },
  { id: 'supervision', label: 'Supervision' },
]

function getIntakeTabs() {
  return [
    { id: 'documentation', label: 'Biopsychosocial' },
    { id: 'clinicalThinking', label: 'Clinical Formulation' },
    { id: 'diagnosis', label: 'Diagnostic Impressions' },
    { id: 'treatmentRec', label: 'Treatment Plan' },
    { id: 'supervision', label: 'Supervision' },
  ]
}

function renderClinicalDocument(text) {
  if (!text) return ''
  return text
    // H1 headers — major section titles (bold, larger, with colored left border)
    .replace(/^# (.*)/gm, '<div class="mt-6 mb-3 pl-3 border-l-4 border-indigo-500"><h2 class="text-base font-bold text-gray-900 uppercase tracking-wide">$1</h2></div>')
    // H2 headers — subsection titles
    .replace(/^## (.*)/gm, '<div class="mt-5 mb-2 pl-3 border-l-3 border-teal-400"><h3 class="text-sm font-bold text-gray-900 uppercase tracking-wide">$1</h3></div>')
    // H3 headers — sub-subsections
    .replace(/^### (.*)/gm, '<h4 class="text-sm font-semibold text-gray-800 mt-4 mb-1.5">$1</h4>')
    // Bold text — section labels within paragraphs
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em class="text-gray-600">$1</em>')
    // Bullet lists — clean, professional
    .replace(/^[-•]\s+(.*)/gm, '<div class="flex gap-2 ml-4 mb-1"><span class="text-indigo-400 mt-0.5">&#8226;</span><span class="text-sm text-gray-700 leading-relaxed">$1</span></div>')
    // Numbered lists
    .replace(/^(\d+)\.\s+(.*)/gm, '<div class="flex gap-2 ml-4 mb-1"><span class="text-sm font-medium text-indigo-500 mt-0.5 min-w-[1.2rem]">$1.</span><span class="text-sm text-gray-700 leading-relaxed">$2</span></div>')
    // Suggestion tags
    .replace(/\[SUGGESTION: (.*?)\]/g, '<span class="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-2 py-1 rounded-lg my-1">💡 $1</span>')
    // Observed from transcript tags
    .replace(/\[observed from transcript\]/gi, '<span class="inline-flex items-center bg-blue-50 border border-blue-200 text-blue-700 text-[10px] px-1.5 py-0.5 rounded ml-1">from transcript</span>')
    // ICD-10 codes — highlight them
    .replace(/\b([A-Z]\d{2}(?:\.\d{1,4})?)\b/g, '<code class="bg-indigo-50 text-indigo-700 text-xs px-1 py-0.5 rounded font-mono">$1</code>')
    // Paragraphs — proper spacing
    .replace(/\n\n/g, '</p><p class="mb-3 text-sm text-gray-700 leading-relaxed">')
    .replace(/\n/g, '<br/>')
}

const CLIENT_TYPE_DEFAULT_MEMBERS = {
  individual: [],
  couple: ['Soul-1', 'Soul-2'],
  family: ['Soul-1', 'Soul-2', 'Soul-3'],
  group: [],
}

function createEmptyWorkspaceForm() {
  return {
    caseType: 'individual',
    members: [],
    noteFormat: 'SOAP',
    therapeuticOrientation: 'Integrative / Other',
    presentingProblem: '',
    treatmentGoal: '',
    sessionNotes: '',
    ongoingSituation: '',
    ongoingInterventions: '',
    ongoingResponse: '',
    ongoingRiskSafety: '',
    ongoingFunctioningMedicalNecessity: '',
    ongoingPlanHomework: '',
    ageRange: '',
    referralSource: '',
    livingSituation: '',
    symptomOnsetDurationSeverity: '',
    precipitatingMaintainingFactors: '',
    culturalIdentityContext: '',
    educationEmploymentContext: '',
    legalMandatedContext: '',
    safetyPlanDetails: '',
    mentalHealthHistory: '',
    substanceUse: '',
    riskScreening: '',
    familySocialHistory: '',
    mentalStatusObservations: '',
    medicalHistory: '',
    medications: '',
    traumaHistory: '',
    strengthsProtectiveFactors: '',
    functionalImpairments: '',
    newClientFirstName: '',
    newClientLastName: '',
    newClientPhone: '',
    newClientEmail: '',
    newClientGender: '',
  }
}

function loadWorkspaceDraft() {
  return null
}

function clearWorkspaceDraft() {
}

function extractIcdCodes(text) {
  if (!text) return []
  return [...text.matchAll(/\b([A-Z]\d{2}\.?\d*[A-Z0-9]*)\b/g)]
    .map(m => m[1])
    .filter((code, index, arr) => arr.indexOf(code) === index)
    .slice(0, 8)
}

function cleanPlainText(text) {
  return (text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,4}\s*/gm, '')
    .replace(/^[-•]\s*/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function combineLabeledParts(parts) {
  return parts
    .filter(([, value]) => value && value.trim())
    .map(([label, value]) => `${label}: ${value.trim()}`)
    .join('\n\n')
}

function buildClientId() {
  return `Client-${Date.now().toString().slice(-6)}`
}

function summarizeDiagnosisForProfile(text) {
  const raw = (text || '').trim()
  if (!raw) return ''
  const cleaned = raw.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  const match = cleaned.match(/primary diagnosis[^:]*:\s*([^\.]+\.)/i)
  if (match?.[1]) return `Provisional primary: ${match[1].trim()}`

  const provisional = cleaned.match(/\b([A-Z]\d{2}\.?\d*[A-Z0-9]*)\s+([^\.]{6,120})/)
  if (provisional) return `Provisional primary: ${provisional[1]} ${provisional[2].trim()}`

  const firstSentence = (cleaned.match(/[^.!?]+[.!?]+/) || [cleaned])[0].trim()
  return firstSentence.length > 180 ? `${firstSentence.slice(0, 177)}…` : firstSentence
}

const IMPORT_FIELD_LABELS = {
  caseType: 'Case Type',
  ageRange: 'Age Range',
  referralSource: 'Referral Source',
  livingSituation: 'Living Situation',
  symptomOnsetDurationSeverity: 'Symptom Onset / Duration / Severity',
  precipitatingMaintainingFactors: 'Precipitating / Maintaining Factors',
  culturalIdentityContext: 'Cultural / Identity Context',
  educationEmploymentContext: 'Education / Employment Context',
  legalMandatedContext: 'Legal / Mandated Reporting Context',
  safetyPlanDetails: 'Safety Plan / Crisis Plan',
  presentingProblem: 'Presenting Problem',
  mentalHealthHistory: 'Mental Health History',
  medicalHistory: 'Medical History',
  medications: 'Medications',
  substanceUse: 'Substance Use',
  riskScreening: 'Risk Screening',
  familySocialHistory: 'Family / Social History',
  traumaHistory: 'Trauma History',
  mentalStatusObservations: 'Mental Status / Clinical Observations',
  strengthsProtectiveFactors: 'Strengths / Protective Factors',
  functionalImpairments: 'Functional Impairments',
  treatmentGoal: 'Initial Treatment Goals',
  firstName: 'First Name',
  lastName: 'Last Name',
  displayName: 'Display Name',
  phone: 'Phone',
  email: 'Email',
  gender: 'Gender',
}

const IMPORT_SECTION_CONFIG = [
  {
    key: 'clientOverview',
    label: 'Client Overview',
    description: 'High-level intake frame, demographics, and referral context.',
    fields: ['firstName', 'lastName', 'displayName', 'phone', 'email', 'gender', 'caseType', 'ageRange', 'referralSource', 'livingSituation'],
  },
  {
    key: 'presentingConcerns',
    label: 'Presenting Concerns',
    description: 'Why the client is seeking care now and the main problems identified.',
    fields: ['presentingProblem', 'symptomOnsetDurationSeverity', 'precipitatingMaintainingFactors', 'functionalImpairments'],
  },
  {
    key: 'historyContext',
    label: 'History & Context',
    description: 'Mental health, medical, medication, family/social, trauma, and substance-use context.',
    fields: ['mentalHealthHistory', 'medicalHistory', 'medications', 'substanceUse', 'familySocialHistory', 'traumaHistory', 'culturalIdentityContext', 'educationEmploymentContext'],
  },
  {
    key: 'riskAndSafety',
    label: 'Risk & Safety',
    description: 'Suicide risk, self-harm risk, abuse concerns, and safety planning details.',
    fields: ['riskScreening', 'safetyPlanDetails', 'legalMandatedContext'],
  },
  {
    key: 'clinicalObservations',
    label: 'Clinical Observations',
    description: 'Mental status and other observed clinical findings.',
    fields: ['mentalStatusObservations'],
  },
  {
    key: 'strengthsAndGoals',
    label: 'Strengths & Goals',
    description: 'Protective factors, resilience, and initial treatment goals.',
    fields: ['strengthsProtectiveFactors', 'treatmentGoal'],
  },
]

function normalizeImportedField(key, value) {
  const raw = (value || '').trim()
  if (!raw) return ''
  const normalized = raw.toLowerCase()

  if (['firstName', 'lastName', 'displayName', 'phone', 'email'].includes(key)) {
    return raw
  }

  if (key === 'gender') {
    if (['female', 'male', 'nonbinary', 'transgender'].includes(normalized)) return normalized
    return raw
  }

  if (key === 'caseType') {
    if (['individual', 'couple', 'family', 'group'].includes(normalized)) return normalized
    return ''
  }

  if (key === 'ageRange') {
    if (normalized.includes('under 12') || normalized.includes('child')) return 'child (under 12)'
    if (normalized.includes('12') || normalized.includes('13') || normalized.includes('14') || normalized.includes('15') || normalized.includes('16') || normalized.includes('17') || normalized.includes('adolescent')) return 'adolescent (12–17)'
    if (normalized.includes('18') || normalized.includes('19') || normalized.includes('20') || normalized.includes('21') || normalized.includes('22') || normalized.includes('23') || normalized.includes('24') || normalized.includes('25') || normalized.includes('young adult')) return 'young adult (18–25)'
    if (normalized.includes('older') || normalized.includes('60+') || normalized.includes('60 and over')) return 'older adult (60+)'
    if (normalized.includes('adult')) return 'adult (26–59)'
  }

  if (key === 'referralSource') {
    if (normalized.includes('self')) return 'self-referred'
    if (normalized.includes('physician') || normalized.includes('psychiatrist') || normalized.includes('doctor')) return 'physician / psychiatrist'
    if (normalized.includes('therapist')) return 'previous therapist'
    if (normalized.includes('school')) return 'school / educational'
    if (normalized.includes('court') || normalized.includes('legal')) return 'court / legal'
    if (normalized.includes('eap')) return 'EAP'
    if (normalized.includes('family')) return 'family member'
    if (normalized.includes('other')) return 'other'
  }

  if (key === 'livingSituation') {
    if (normalized.includes('alone')) return 'alone'
    if (normalized.includes('partner') || normalized.includes('spouse')) return 'with partner / spouse'
    if (normalized.includes('family of origin') || normalized.includes('parents')) return 'with family of origin'
    if (normalized.includes('children')) return 'with children'
    if (normalized.includes('roommate')) return 'with roommates'
    if (normalized.includes('unstable') || normalized.includes('transitional')) return 'transitional / unstable housing'
    if (normalized.includes('other')) return 'other'
  }

  return raw
}

function importedFieldTargetKey(key) {
  return ({
    firstName: 'newClientFirstName',
    lastName: 'newClientLastName',
    phone: 'newClientPhone',
    email: 'newClientEmail',
    gender: 'newClientGender',
  })[key] || key
}

export default function Workspace() {
  const navigate = useNavigate()
  const draft = useMemo(() => loadWorkspaceDraft(), [])
  const [patients, setPatients] = useState([])
  const [linkedPatientId, setLinkedPatientId] = useState('')
  const [newClientId, setNewClientId] = useState('')
  const [savingToChart, setSavingToChart] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')
  const [saveError, setSaveError] = useState('')
  const [sessionType, setSessionType] = useState(draft?.sessionType || 'ongoing') // 'ongoing' | 'intake'
  const [sessionTypeTouched, setSessionTypeTouched] = useState(Boolean(draft?.sessionType))
  const [form, setForm] = useState(draft?.form || createEmptyWorkspaceForm())
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState('')
  const [output, setOutput] = useState(null)
  const [editableOutput, setEditableOutput] = useState(null)
  const [activeTab, setActiveTab] = useState('documentation')
  const [copied, setCopied] = useState(false)
  const [trialRemaining, setTrialRemaining] = useState(null)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [importingIntake, setImportingIntake] = useState(false)
  const [importingAudio, setImportingAudio] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingReady, setRecordingReady] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [recordingStatus, setRecordingStatus] = useState('')
  const [importedIntakeName, setImportedIntakeName] = useState('')
  const [importedIntakeText, setImportedIntakeText] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [draftSections, setDraftSections] = useState(null)
  const [stagedImportedFields, setStagedImportedFields] = useState(null)
  const [uploadedAudioName, setUploadedAudioName] = useState('')
  const [uploadedAudioTranscript, setUploadedAudioTranscript] = useState('')

  // Workspace drafts can include PHI; do not persist them in browser storage.
  const mediaRecorderRef = useRef(null)
  const mediaChunksRef = useRef([])
  const mediaStreamRef = useRef(null)
  const recordingTimerRef = useRef(null)
  useEffect(() => {
    apiFetch('/patients')
      .then(r => r.json())
      .then(data => setPatients(Array.isArray(data) ? data : []))
      .catch(() => setPatients([]))
  }, [])

  useEffect(() => {
    if (!draft && !sessionTypeTouched && patients.length === 0 && sessionType === 'ongoing') {
      setSessionType('intake')
    }
  }, [draft, patients.length, sessionType, sessionTypeTouched])

  useEffect(() => () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(track => track.stop())
  }, [])

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const applyImportedFields = (fieldsToApply) => {
    setForm(f => {
      const next = { ...f }
      Object.entries(fieldsToApply || {}).forEach(([key, value]) => {
        const normalized = normalizeImportedField(key, value)
        if (normalized && key !== 'displayName') next[importedFieldTargetKey(key)] = normalized
      })
      return next
    })
  }

  const handleApplyAllImportedFields = () => {
    if (!stagedImportedFields) return
    applyImportedFields(stagedImportedFields)
    setImportMessage('Imported intake draft applied. Review and edit anything you want before generating the assessment.')
  }

  const handleImportedDraftPayload = (data, fallbackName) => {
    setImportedIntakeName(data.fileName || fallbackName)
    setImportedIntakeText(data.extractedText || data.transcript || '')
    setDraftSections(data.draftSections || null)
    const normalizedFields = Object.fromEntries(
      Object.entries(data.fields || {}).map(([key, value]) => [key, normalizeImportedField(key, value)])
    )
    const staged = Object.fromEntries(Object.entries(normalizedFields).filter(([, value]) => value))
    setStagedImportedFields(staged)
    setImportMessage(
      data.draftSections && Object.values(data.draftSections).some(Boolean)
        ? 'Source imported. Review the intake draft below, then apply it into Miwa’s structure.'
        : 'Source imported, but the AI could not assemble a strong intake draft. Review the extracted text below or try a cleaner source document.'
    )
  }

  const resetAudioState = () => {
    setUploadedAudioName('')
    setUploadedAudioTranscript('')
    setRecordingStatus('')
    setRecordingReady(false)
    setRecordingDuration(0)
  }

  const discardRecording = () => {
    if (isRecording) stopRecording()
    resetAudioState()
    setImportMessage('Recording discarded.')
  }

  const uploadAudioBlob = async (blob, fallbackName) => {
    const formData = new FormData()
    formData.append('file', blob, fallbackName)
    formData.append('mode', sessionType)
    const res = await apiUpload('/ai/audio-import', formData)
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || data.error || 'Failed to import audio')

    setUploadedAudioName(data.fileName || fallbackName)
    setUploadedAudioTranscript(data.transcript || '')
    setRecordingStatus('Audio imported and transcribed.')

    if (sessionType === 'intake') {
      handleImportedDraftPayload(data, fallbackName)
    } else {
      setForm(f => ({
        ...f,
        sessionNotes: data.transcript || f.sessionNotes,
      }))
      setDraftSections(null)
      setStagedImportedFields(null)
      setImportedIntakeName('')
      setImportedIntakeText('')
      setImportMessage('Audio imported and transcribed. Review the transcript-based session notes before generating.')
    }
  }

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('This browser does not support in-app recording. Please upload an audio file instead.')
      }
      setError('')
      setImportMessage('')
      setRecordingStatus('Preparing microphone…')
      setRecordingDuration(0)
      setRecordingReady(false)
      mediaChunksRef.current = []

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']
        .find(t => MediaRecorder.isTypeSupported(t)) || ''
      const recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) mediaChunksRef.current.push(event.data)
      }

      recorder.onstop = async () => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
        setIsRecording(false)
        setRecordingReady(true)

        const mimeType = recorder.mimeType || 'audio/webm'
        const extension = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mpeg') || mimeType.includes('mp3') ? 'mp3' : mimeType.includes('wav') ? 'wav' : 'webm'
        const blob = new Blob(mediaChunksRef.current, { type: mimeType })
        const fallbackName = `${sessionType}-recording-${Date.now()}.${extension}`

        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop())
          mediaStreamRef.current = null
        }

        setImportingAudio(true)
        setRecordingStatus('Uploading and transcribing recording…')
        try {
          await uploadAudioBlob(blob, fallbackName)
        } catch (err) {
          setError(err.message)
        } finally {
          setImportingAudio(false)
          setRecordingReady(false)
          mediaChunksRef.current = []
        }
      }

      recorder.start()
      setIsRecording(true)
      setRecordingStatus('Recording in progress… speak clearly and stay near your microphone.')
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((seconds) => seconds + 1)
      }, 1000)
    } catch (err) {
      setError(err.message || 'Unable to start recording')
    }
  }

  const stopRecording = () => {
    setRecordingStatus('Stopping recording…')
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }

  const handleIntakeImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImportingIntake(true)
    setImportMessage('')
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await apiUpload('/ai/intake-import', formData)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to import intake form')
      setUploadedAudioName('')
      setUploadedAudioTranscript('')
      handleImportedDraftPayload(data, file.name)
    } catch (err) {
      setError(err.message)
    } finally {
      setImportingIntake(false)
      e.target.value = ''
    }
  }

  const handleAudioImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImportingAudio(true)
    setImportMessage('')
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mode', sessionType)
      const res = await apiUpload('/ai/audio-import', formData)
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || data.error || 'Failed to import audio')

      setUploadedAudioName(data.fileName || file.name)
      setUploadedAudioTranscript(data.transcript || '')

      if (sessionType === 'intake') {
        handleImportedDraftPayload(data, file.name)
      } else {
        setForm(f => ({
          ...f,
          sessionNotes: data.transcript || f.sessionNotes,
        }))
        setDraftSections(null)
        setStagedImportedFields(null)
        setImportedIntakeName('')
        setImportedIntakeText('')
        setImportMessage('Audio uploaded and transcribed. Review the transcript-based session notes before generating.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setImportingAudio(false)
      e.target.value = ''
    }
  }

  const resetWorkspaceComposer = (nextType = 'ongoing') => {
    clearWorkspaceDraft()
    setSessionType(nextType)
    setSessionTypeTouched(true)
    setForm(createEmptyWorkspaceForm())
    setOutput(null)
    setEditableOutput(null)
    setStreamingText('')
    setError('')
    setSaveError('')
    setSaveNotice('')
    setActiveTab('documentation')
    setLinkedPatientId('')
    setNewClientId('')
    setImportedIntakeName('')
    setImportedIntakeText('')
    setImportMessage('')
    setDraftSections(null)
    setStagedImportedFields(null)
    resetAudioState()
  }

  const switchSessionType = (type) => {
    setSessionType(type)
    setSessionTypeTouched(true)
    setOutput(null)
    setEditableOutput(null)
    setStreamingText('')
    setError('')
    setSaveError('')
    setSaveNotice('')
    setActiveTab('documentation')
  }


  const handleSubmit = async (e) => {
    e.preventDefault()
    if (sessionType === 'intake' && !form.presentingProblem.trim()) {
      setError('Please enter at least a presenting problem.')
      return
    }
    if (sessionType === 'ongoing' && !form.sessionNotes.trim() && !form.presentingProblem.trim()) {
      setError('Please enter at least a presenting problem or session notes.')
      return
    }
    setLoading(true)
    setConnected(false)
    setError('')
    setOutput(null)
    setStreamingText('')
    try {
      const res = await apiFetch('/ai/workspace', {
        method: 'POST',
        body: JSON.stringify({ ...form, sessionType }),
      })
      if (!res.ok) {
        const data = await res.json()
        if (res.status === 402 || data.error === 'subscription_required') {
          setShowUpgradeModal(true)
          return
        }
        throw new Error(data.error || 'Something went wrong')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // hold incomplete line
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.error) throw new Error(data.error)
            if (data.heartbeat) setConnected(true)
            if (data.text) { setConnected(true); setStreamingText(prev => prev + data.text) }
            if (data.done && data.sections) {
              setOutput(data.sections)
              setEditableOutput(data.sections)
              setActiveTab('documentation')
              if (data.trialRemaining !== undefined) setTrialRemaining(data.trialRemaining)
            }
          } catch (parseErr) {
            if (parseErr.message !== 'Unexpected end of JSON input') throw parseErr
          }
        }
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    const text = editableOutput?.[activeTab] || displaySections?.[activeTab] || ''
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleRegenerate = () => handleSubmit({ preventDefault: () => {} })

  // Ctrl+Enter keyboard shortcut to generate
  const handleSubmitRef = useRef(handleSubmit)
  useEffect(() => { handleSubmitRef.current = handleSubmit })
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !loading) {
        e.preventDefault()
        handleSubmitRef.current({ preventDefault: () => {} })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loading])

  // Parse sections live from streaming text so tabs work during generation
  const SECTION_MARKERS = ['===DOCUMENTATION===', '===INTAKE_NOTE===', '===CLINICAL_THINKING===', '===DIAGNOSIS===', '===SUPERVISION===']
  const parseSections = (text) => {
    const parse = (marker) => {
      const start = text.indexOf(marker)
      if (start === -1) return null
      const contentStart = start + marker.length
      let end = text.length
      for (const m of SECTION_MARKERS) {
        const idx = text.indexOf(m, contentStart)
        if (idx !== -1 && idx < end) end = idx
      }
      return text.slice(contentStart, end).trim()
    }
    return {
      documentation: parse('===DOCUMENTATION==='),
      intakeNote: parse('===INTAKE_NOTE==='),
      clinicalThinking: parse('===CLINICAL_THINKING==='),
      diagnosis: parse('===DIAGNOSIS==='),
      supervision: parse('===SUPERVISION==='),
    }
  }

  // Live sections while streaming; final sections after done
  const liveSections = useMemo(() => streamingText ? parseSections(streamingText) : null, [streamingText])
  const displaySections = output || liveSections
  const activeTabs = sessionType === 'intake' ? getIntakeTabs() : ONGOING_TABS
  const selectedPatient = patients.find(p => String(p.id) === String(linkedPatientId))
  const workspaceInputSnapshot = {
    sessionType,
    caseType: form.caseType,
    noteFormat: form.noteFormat,
    therapeuticOrientation: form.therapeuticOrientation,
    presentingProblem: form.presentingProblem,
    treatmentGoal: form.treatmentGoal,
    sessionNotes: form.sessionNotes,
    ongoingSituation: form.ongoingSituation,
    ongoingInterventions: form.ongoingInterventions,
    ongoingResponse: form.ongoingResponse,
    ongoingRiskSafety: form.ongoingRiskSafety,
    ongoingFunctioningMedicalNecessity: form.ongoingFunctioningMedicalNecessity,
    ongoingPlanHomework: form.ongoingPlanHomework,
    ageRange: form.ageRange,
    referralSource: form.referralSource,
    livingSituation: form.livingSituation,
    symptomOnsetDurationSeverity: form.symptomOnsetDurationSeverity,
    precipitatingMaintainingFactors: form.precipitatingMaintainingFactors,
    culturalIdentityContext: form.culturalIdentityContext,
    educationEmploymentContext: form.educationEmploymentContext,
    legalMandatedContext: form.legalMandatedContext,
    safetyPlanDetails: form.safetyPlanDetails,
    mentalHealthHistory: form.mentalHealthHistory,
    substanceUse: form.substanceUse,
    riskScreening: form.riskScreening,
    familySocialHistory: form.familySocialHistory,
    mentalStatusObservations: form.mentalStatusObservations,
    medicalHistory: form.medicalHistory,
    medications: form.medications,
    traumaHistory: form.traumaHistory,
    strengthsProtectiveFactors: form.strengthsProtectiveFactors,
    functionalImpairments: form.functionalImpairments,
  }

  const handleSaveToChart = async () => {
    const finalSections = editableOutput || displaySections
    if (!finalSections) return
    setSavingToChart(true)
    setSaveError('')
    setSaveNotice('')

    try {
      const documentation = cleanPlainText(finalSections.documentation)
      const clinicalThinking = cleanPlainText(finalSections.clinicalThinking)
      const diagnosis = cleanPlainText(finalSections.diagnosis)
      const supervision = cleanPlainText(finalSections.supervision)
      const icd10_codes = extractIcdCodes(diagnosis).join(', ')
      const profilePresentingConcerns = combineLabeledParts([
        ['Presenting problem', form.presentingProblem],
        ['Onset / duration / severity', form.symptomOnsetDurationSeverity],
        ['Precipitating / maintaining factors', form.precipitatingMaintainingFactors],
      ]) || form.presentingProblem || null
      const profileRiskScreening = combineLabeledParts([
        ['Risk screening', form.riskScreening],
        ['Safety plan / crisis plan', form.safetyPlanDetails],
        ['Legal / mandated reporting context', form.legalMandatedContext],
      ]) || form.riskScreening || null
      const profileFamilySocialHistory = combineLabeledParts([
        ['Family / social history', form.familySocialHistory],
        ['Cultural / identity context', form.culturalIdentityContext],
        ['School / work / role functioning', form.educationEmploymentContext],
      ]) || form.familySocialHistory || null

      let patientId = linkedPatientId
      let patientRecord = selectedPatient

      if (!patientId) {
        const client_id = newClientId.trim() || buildClientId()
        const firstName = (form.newClientFirstName || '').trim()
        const lastName = (form.newClientLastName || '').trim()
        const display_name = [firstName, lastName].filter(Boolean).join(' ') || null
        const phone = (form.newClientPhone || '').trim() || null
        const email = (form.newClientEmail || '').trim() || null
        const patientRes = await apiFetch('/patients', {
          method: 'POST',
          body: JSON.stringify({
            client_id,
            display_name,
            phone,
            email,
            age: null,
            gender: (form.newClientGender || '').trim() || null,
            case_type: form.caseType || null,
            client_type: form.caseType || 'individual',
            members: (form.members && form.members.length > 0) ? JSON.stringify(form.members) : null,
            age_range: form.ageRange || null,
            referral_source: form.referralSource || null,
            living_situation: form.livingSituation || null,
            presenting_concerns: profilePresentingConcerns,
            diagnoses: summarizeDiagnosisForProfile(diagnosis) || null,
            notes: documentation || clinicalThinking || null,
            client_overview: '',
            client_overview_signature: '',
            mental_health_history: form.mentalHealthHistory || null,
            substance_use: form.substanceUse || null,
            risk_screening: profileRiskScreening,
            family_social_history: profileFamilySocialHistory,
            mental_status_observations: form.mentalStatusObservations || null,
            treatment_goals: form.treatmentGoal || null,
            medical_history: form.medicalHistory || null,
            medications: form.medications || null,
            trauma_history: form.traumaHistory || null,
            strengths_protective_factors: form.strengthsProtectiveFactors || null,
            functional_impairments: form.functionalImpairments || null,
          }),
        })
        const newPatient = await patientRes.json()
        if (!patientRes.ok) throw new Error(newPatient.error || 'Failed to create client profile')
        patientId = newPatient.id
        patientRecord = newPatient
        setPatients(prev => [newPatient, ...prev])
      } else if (patientRecord) {
        const patientUpdateRes = await apiFetch(`/patients/${patientId}`, {
          method: 'PUT',
          body: JSON.stringify({
            client_id: patientRecord.client_id,
            age: patientRecord.age,
            gender: (form.newClientGender || '').trim() || patientRecord.gender,
            case_type: form.caseType || patientRecord.case_type,
            client_type: form.caseType || patientRecord.client_type || 'individual',
            members: (form.members && form.members.length > 0) ? JSON.stringify(form.members) : (patientRecord.members || null),
            age_range: form.ageRange || patientRecord.age_range,
            referral_source: form.referralSource || patientRecord.referral_source,
            living_situation: form.livingSituation || patientRecord.living_situation,
            presenting_concerns: profilePresentingConcerns || patientRecord.presenting_concerns,
            diagnoses: summarizeDiagnosisForProfile(diagnosis) || patientRecord.diagnoses,
            notes: clinicalThinking || documentation || patientRecord.notes,
            client_overview: '',
            client_overview_signature: '',
            mental_health_history: form.mentalHealthHistory || patientRecord.mental_health_history,
            substance_use: form.substanceUse || patientRecord.substance_use,
            risk_screening: profileRiskScreening || patientRecord.risk_screening,
            family_social_history: profileFamilySocialHistory || patientRecord.family_social_history,
            mental_status_observations: form.mentalStatusObservations || patientRecord.mental_status_observations,
            treatment_goals: form.treatmentGoal || patientRecord.treatment_goals,
            medical_history: form.medicalHistory || patientRecord.medical_history,
            medications: form.medications || patientRecord.medications,
            trauma_history: form.traumaHistory || patientRecord.trauma_history,
            strengths_protective_factors: form.strengthsProtectiveFactors || patientRecord.strengths_protective_factors,
            functional_impairments: form.functionalImpairments || patientRecord.functional_impairments,
          }),
        })
        const updatedPatient = await patientUpdateRes.json()
        if (!patientUpdateRes.ok) throw new Error(updatedPatient.error || 'Failed to update the linked client profile')
        setPatients(prev => prev.map(p => p.id === updatedPatient.id ? { ...p, ...updatedPatient } : p))
      }

      const sessionRes = await apiFetch(`/patients/${patientId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          session_date: new Date().toISOString().split('T')[0],
          note_format: sessionType === 'intake' ? 'INTAKE' : form.noteFormat,
          subjective: documentation || null,
          objective: clinicalThinking || null,
          assessment: diagnosis || null,
          plan: form.treatmentGoal || clinicalThinking || null,
          icd10_codes: icd10_codes || null,
          ai_feedback: supervision || null,
          notes_json: JSON.stringify({
            WORKSPACE: {
              sessionType,
              generatedNoteFormat: form.noteFormat,
              documentation: finalSections.documentation || '',
              intakeNote: finalSections.intakeNote || '',
              clinicalThinking: finalSections.clinicalThinking || '',
              diagnosis: finalSections.diagnosis || '',
              supervision: finalSections.supervision || '',
              inputSnapshot: workspaceInputSnapshot,
            },
          }),
          treatment_plan: clinicalThinking || null,
        }),
      })
      const savedSession = await sessionRes.json()
      if (!sessionRes.ok) throw new Error(savedSession.error || 'Failed to save the linked session note')

      clearWorkspaceDraft()
      setSaveNotice(linkedPatientId
        ? 'Session note, analysis, and planning were linked to the selected client.'
        : 'New client created from this intake and the generated session content was linked automatically.')
      resetWorkspaceComposer(sessionType)
      navigate(`/patients/${patientId}`)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSavingToChart(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">

      {/* ── Upgrade modal ──────────────────────────────────────────────── */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center space-y-5">
            <div className="w-16 h-16 mx-auto rounded-full bg-purple-50 border border-purple-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Your free trial has ended</h2>
              <p className="text-sm text-gray-500 mt-2">
                You've used all 10 free workspace generations. Subscribe to keep using Miwa's full clinical suite with unlimited generations, documentation, diagnosis, and supervision.
              </p>
            </div>
            <div className="space-y-2">
              <a
                href="/billing"
                className="flex w-full items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #5746ed, #7c3aed)' }}
              >
                View Plans &amp; Subscribe →
              </a>
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Session Workspace</h1>
          <p className="text-sm text-gray-500 mt-1">
            {sessionType === 'intake'
              ? 'Complete an intake assessment. Generates a biopsychosocial, clinical formulation, diagnostic impressions, treatment plan, and supervision guidance. Progress notes (SOAP/BIRP/DAP/GIRP/DMH SIR) are for ongoing sessions.'
              : `Enter session notes and get a polished ${form.noteFormat} progress note, clinical thinking, diagnosis support, and supervision guidance.`}
          </p>
        </div>
        {Object.values(form).some(v => v) && (
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                setForm(createEmptyWorkspaceForm())
                clearWorkspaceDraft()
                setResult(null)
              }}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gray-800 hover:bg-gray-900 transition-colors whitespace-nowrap"
            >
              + New Session
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm('Clear all workspace fields? This cannot be undone.')) {
                  setForm(createEmptyWorkspaceForm())
                  clearWorkspaceDraft()
                  setResult(null)
                }
              }}
              className="px-3 py-2 rounded-xl text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors whitespace-nowrap"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="mb-6 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-400/20 px-4 py-3 flex items-start gap-3">
        <svg className="w-4 h-4 text-amber-500 dark:text-amber-300 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="text-xs text-amber-800 dark:text-amber-100/90">
          AI output is for <strong className="text-amber-900 dark:text-amber-50">clinical support only.</strong> Always review carefully before use in documentation.
        </p>
      </div>

      {!draft && patients.length === 0 && (
        <div className="mb-6 rounded-2xl border border-brand-100 bg-brand-50/70 px-5 py-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest text-brand-600">First session path</div>
              <h2 className="text-sm font-semibold text-gray-900 mt-1">Use this flow to reach your first usable output quickly</h2>
              <p className="text-sm text-gray-600 mt-1 max-w-3xl">
                1) Add a client, 2) keep Intake / First Session selected, 3) enter the presenting problem and session material, then generate a note or intake summary.
              </p>
            </div>
            <button type="button" onClick={() => setSessionType('intake')} className="btn-primary text-sm">
              Use Intake / First Session
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* LEFT: Input Form */}
        <div className="space-y-4">
          {/* Session Type Switcher */}
          <div className="card p-1.5 flex gap-1">
            {[
              { id: 'ongoing', label: 'Ongoing Session', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
              { id: 'intake', label: 'Intake / First Session', icon: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z' },
            ].map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => switchSessionType(t.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  sessionType === t.id
                    ? 'text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                style={sessionType === t.id ? { background: 'linear-gradient(135deg, #5746ed, #7c3aed)' } : {}}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={t.icon} />
                </svg>
                {t.label}
              </button>
            ))}
          </div>

          {/* Sample case loader — only for ongoing sessions */}
          {sessionType === 'ongoing' && (
            <>
              <div className="card p-4 space-y-3 border border-brand-100">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Session audio</p>
                    <p className="text-sm text-gray-600 mt-1">
                      Upload a dictated session summary or recording and Miwa will transcribe it into session notes. Direct in-app recording can come next.
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <label className={`btn-secondary text-sm ${importingAudio ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                      {importingAudio ? 'Transcribing…' : 'Upload Session Audio'}
                      <input
                        type="file"
                        className="hidden"
                        accept=".mp3,.m4a,.wav,.webm,.mp4,.mpeg,.mpga"
                        disabled={importingAudio}
                        onChange={handleAudioImport}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={isRecording ? stopRecording : startRecording}
                      disabled={importingAudio || recordingReady}
                      className={`btn-secondary text-sm ${isRecording ? 'border-red-300 text-red-600 bg-red-50' : ''} ${(importingAudio || recordingReady) ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      {isRecording ? `Stop Recording (${recordingDuration}s)` : recordingReady ? 'Processing Recording…' : 'Record in App'}
                    </button>
                  </div>
                </div>
                {(recordingStatus || (uploadedAudioName && uploadedAudioTranscript)) && (
                  <div className="rounded-xl bg-white border border-gray-200 px-3 py-3 space-y-2">
                    {recordingStatus && (
                      <div className="rounded-lg bg-brand-50 border border-brand-100 px-3 py-2 text-xs text-brand-700">
                        {recordingStatus}
                      </div>
                    )}
                    {uploadedAudioName && uploadedAudioTranscript && (
                      <>
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <p className="text-sm font-medium text-gray-800">
                            Audio transcript: {uploadedAudioName}
                            <span className="ml-2 text-xs font-normal text-gray-400">
                              (~{uploadedAudioTranscript.trim().split(/\s+/).length} words)
                            </span>
                          </p>
                          <button type="button" onClick={discardRecording} className="btn-secondary text-xs">Discard</button>
                        </div>
                        <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-gray-700">
                          {uploadedAudioTranscript}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

            </>
          )}

          {sessionType === 'intake' && (
            <div className="card p-4 space-y-3 border border-brand-100">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Intake source</p>
                  <p className="text-sm text-gray-600 mt-1">
                    Start from a blank intake, upload the therapist’s existing intake form, or upload an audio summary that Miwa can transcribe into the intake draft.
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <label className={`btn-secondary text-sm ${importingIntake ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                    {importingIntake ? 'Importing…' : 'Upload Intake Form'}
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.docx,.txt"
                      disabled={importingIntake}
                      onChange={handleIntakeImport}
                    />
                  </label>
                  <label className={`btn-secondary text-sm ${importingAudio ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                    {importingAudio ? 'Transcribing…' : 'Upload Intake Audio'}
                    <input
                      type="file"
                      className="hidden"
                      accept=".mp3,.m4a,.wav,.webm,.mp4,.mpeg,.mpga"
                      disabled={importingAudio}
                      onChange={handleAudioImport}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={importingAudio || recordingReady}
                    className={`btn-secondary text-sm ${isRecording ? 'border-red-300 text-red-600 bg-red-50' : ''} ${(importingAudio || recordingReady) ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {isRecording ? `Stop Recording (${recordingDuration}s)` : recordingReady ? 'Processing Recording…' : 'Record in App'}
                  </button>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap text-xs text-gray-500">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white border border-gray-200">Blank intake</span>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white border border-gray-200">or import PDF / DOCX / TXT</span>
              </div>
              {recordingStatus && (
                <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-700">
                  {recordingStatus}
                </div>
              )}
              {importMessage && <div className="rounded-lg border border-pink-200 bg-pink-50 px-3 py-2 text-xs text-pink-700">{importMessage}</div>}
              {(importedIntakeName || uploadedAudioName) && (
                <div className="rounded-xl bg-white border border-gray-200 px-3 py-3 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">Imported source: {importedIntakeName || uploadedAudioName}</p>
                    <p className="text-xs text-gray-500">Miwa turns the uploaded intake or audio summary into a readable intake draft first. Review it, then apply the draft into the intake form.</p>
                  </div>
                  {draftSections && Object.values(draftSections).some(Boolean) && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Intake draft</p>
                          <p className="text-xs text-gray-400 mt-1">Readable therapist-facing summary first. This is the review flow we are using.</p>
                        </div>
                        <button type="button" onClick={handleApplyAllImportedFields} className="btn-secondary text-xs">
                          Apply Draft to Intake Form
                        </button>
                      </div>
                      <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
                        {IMPORT_SECTION_CONFIG.map(section => draftSections[section.key] ? (
                          <div key={section.key} className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-4 space-y-3">
                            <div className="min-w-0">
                              <p className="text-[11px] uppercase tracking-wide text-gray-400">{section.label}</p>
                              <p className="text-xs text-gray-500 mt-1">{section.description}</p>
                            </div>
                            <div className="rounded-lg bg-white border border-gray-100 px-3 py-3">
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">{draftSections[section.key]}</p>
                            </div>
                            <div className="flex gap-2 flex-wrap text-[11px] text-gray-400">
                              {section.fields.map(fieldKey => stagedImportedFields?.[fieldKey] ? (
                                <span key={fieldKey} className="inline-flex items-center px-2.5 py-1 rounded-full bg-white border border-gray-200">
                                  {IMPORT_FIELD_LABELS[fieldKey] || fieldKey}
                                </span>
                              ) : null)}
                            </div>
                          </div>
                        ) : null)}
                      </div>
                    </div>
                  )}
                  {uploadedAudioTranscript && (
                    <details className="text-xs text-gray-500">
                      <summary className="cursor-pointer font-medium text-gray-600">
                        Preview transcribed audio
                        <span className="ml-2 font-normal text-gray-400">
                          (~{uploadedAudioTranscript.trim().split(/\s+/).length} words)
                        </span>
                      </summary>
                      <div className="mt-2 rounded-lg bg-gray-50 border border-gray-100 p-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-gray-600">
                        {uploadedAudioTranscript}
                      </div>
                    </details>
                  )}
                  {(uploadedAudioName || recordingStatus) && (
                    <div className="flex gap-2 flex-wrap">
                      <button type="button" onClick={discardRecording} className="btn-secondary text-xs">Clear audio source</button>
                    </div>
                  )}
                  {importedIntakeText && (
                    <details className="text-xs text-gray-500">
                      <summary className="cursor-pointer font-medium text-gray-600">Preview source text</summary>
                      <div className="mt-2 rounded-lg bg-gray-50 border border-gray-100 p-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-gray-600">
                        {importedIntakeText.slice(0, 2500)}{importedIntakeText.length > 2500 ? '…' : ''}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="card p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Client</p>
              <p className="text-xs text-gray-400">
                Select an existing client or create a new one. The client profile will be updated with this session's data.
              </p>
            </div>
            <div>
              <label className="label">Existing client</label>
              <select className="input" value={linkedPatientId} onChange={e => setLinkedPatientId(e.target.value)}>
                <option value="">+ New client</option>
                {patients.map(patient => (
                  <option key={patient.id} value={patient.id}>{patient.display_name || patient.client_id}{patient.display_name ? ` (${patient.client_id})` : ''}</option>
                ))}
              </select>
            </div>
            {!linkedPatientId && (
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <p className="text-xs font-medium text-indigo-600">New client profile</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="label">First name <span className="text-red-400">*</span></label>
                    <input
                      className="input"
                      value={form.newClientFirstName || ''}
                      onChange={e => setForm(f => ({ ...f, newClientFirstName: e.target.value }))}
                      placeholder="First"
                    />
                  </div>
                  <div>
                    <label className="label">Last name <span className="text-red-400">*</span></label>
                    <input
                      className="input"
                      value={form.newClientLastName || ''}
                      onChange={e => setForm(f => ({ ...f, newClientLastName: e.target.value }))}
                      placeholder="Last"
                    />
                  </div>
                  <div>
                    <label className="label">Client ID</label>
                    <input
                      className="input"
                      value={newClientId}
                      onChange={e => setNewClientId(e.target.value)}
                      placeholder="Auto-generated"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">Phone</label>
                    <input
                      className="input"
                      value={form.newClientPhone || ''}
                      onChange={e => setForm(f => ({ ...f, newClientPhone: e.target.value }))}
                      placeholder="+1 (555) 123-4567"
                    />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input
                      className="input"
                      value={form.newClientEmail || ''}
                      onChange={e => setForm(f => ({ ...f, newClientEmail: e.target.value }))}
                      placeholder="client@email.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Gender</label>
                  <select
                    className="input"
                    value={form.newClientGender || ''}
                    onChange={e => setForm(f => ({ ...f, newClientGender: e.target.value }))}
                  >
                    <option value="">Select...</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="nonbinary">Nonbinary</option>
                    <option value="transgender">Transgender</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Main form */}
          <form onSubmit={handleSubmit} className="card p-5 space-y-4">

            {/* Row 1: case type + note format */}
            <div className="grid gap-3 grid-cols-2">
              <div>
                <label className="label">Case Type</label>
                <select className="input" value={form.caseType} onChange={e => {
                  const t = e.target.value
                  setForm(f => ({ ...f, caseType: t, members: CLIENT_TYPE_DEFAULT_MEMBERS[t] || [] }))
                }}>
                  <option value="individual">Individual</option>
                  <option value="couple">Couple</option>
                  <option value="family">Family</option>
                  <option value="group">Group</option>
                </select>
              </div>
              {sessionType === 'ongoing' && (
              <div>
                <label className="label">Note Format</label>
                <div className="grid grid-cols-5 gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1 border border-transparent dark:border-white/10">
                  {['SOAP', 'BIRP', 'DAP', 'GIRP', 'DMH_SIR'].map(fmt => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => set('noteFormat', fmt)}
                      className={`min-h-8 text-[11px] font-medium px-1 py-1 rounded-md transition-colors ${
                        form.noteFormat === fmt ? 'bg-white dark:bg-slate-900 text-brand-700 dark:text-white shadow-sm dark:shadow-[inset_0_1px_0_rgba(167,139,250,0.35)]' : 'text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-white'
                      }`}
                    >
                      {fmt === 'DMH_SIR' ? 'DMH SIR' : fmt}
                    </button>
                  ))}
                </div>
              </div>
              )}
            </div>

            {/* Soul management — visible when case type is couple or family */}
            {(form.caseType === 'couple' || form.caseType === 'family') && (
              <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-3 space-y-2">
                <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">
                  {form.caseType === 'couple' ? 'Partners' : 'Family Members'} (Souls)
                </p>
                <div className="space-y-1.5">
                  {(form.members || []).map((soul, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        className="input flex-1 text-sm py-1.5"
                        value={soul}
                        onChange={e => {
                          const updated = [...form.members]
                          updated[idx] = e.target.value
                          set('members', updated)
                        }}
                        placeholder={`Soul-${idx + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => set('members', form.members.filter((_, i) => i !== idx))}
                        className="text-gray-400 hover:text-red-500 transition-colors p-1"
                        title="Remove"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => set('members', [...(form.members || []), `Soul-${(form.members || []).length + 1}`])}
                  className="text-xs text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add member
                </button>
              </div>
            )}

            {/* Therapeutic orientation */}
            <div>
              <label className="label">Therapeutic Orientation</label>
              <select className="input" value={form.therapeuticOrientation} onChange={e => set('therapeuticOrientation', e.target.value)}>
                {ORIENTATIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            {/* Verbosity level */}
            <div>
              <label className="label">Note Detail Level</label>
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1 h-9 border border-transparent dark:border-white/10">
                {[
                  { id: 'concise', label: 'Concise', desc: 'Short, clinical shorthand' },
                  { id: 'standard', label: 'Standard', desc: 'Professional, complete' },
                  { id: 'detailed', label: 'Detailed', desc: 'Thorough, court-ready' },
                ].map(v => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => set('verbosity', v.id)}
                    className={`flex-1 text-xs font-medium py-1 rounded-md transition-colors ${
                      (form.verbosity || 'standard') === v.id
                        ? 'bg-white dark:bg-slate-900 text-brand-700 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-slate-300 hover:text-gray-700'
                    }`}
                    title={v.desc}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Presenting problem — always shown */}
            <div>
              <label className="label">
                Presenting Problem
                {sessionType === 'intake' && <span className="ml-1 text-red-400">*</span>}
              </label>
              <textarea
                className="textarea"
                rows={2}
                placeholder={sessionType === 'intake'
                  ? 'Why is the client seeking therapy now? What brought them in?'
                  : 'Brief description of presenting concern…'}
                value={form.presentingProblem}
                onChange={e => set('presentingProblem', e.target.value)}
              />
            </div>

            {/* ── ONGOING SESSION fields ── */}
            {sessionType === 'ongoing' && (
              <>
                <div>
                  <label className="label">Treatment Goal</label>
                  <textarea
                    className="textarea"
                    rows={2}
                    placeholder="Current treatment goal(s) for this client…"
                    value={form.treatmentGoal}
                    onChange={e => set('treatmentGoal', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Session Notes / Bullet Points</label>
                  <textarea
                    className="textarea"
                    rows={7}
                    placeholder={"Enter session notes as bullets, e.g.:\n- Client reported anxiety increased this week\n- Explored triggers: work stress, conflict with partner\n- Practiced breathing technique in session\n- Assigned thought record for homework"}
                    value={form.sessionNotes}
                    onChange={e => set('sessionNotes', e.target.value)}
                  />
                  <p className="text-xs text-gray-400 mt-1">Use bullets, fragments, or shorthand. Miwa will expand them into clinical language.</p>
                </div>
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">DMH / SIR documentation check</p>
                    <p className="text-xs text-indigo-600 mt-1">
                      These fields make sure the session note captures the information DMH-style documentation expects, instead of relying on one loose notes box.
                    </p>
                  </div>
                  <div>
                    <label className="label">Situation / Presentation</label>
                    <textarea
                      className="textarea"
                      rows={3}
                      placeholder="Current presentation, symptoms, stressors, session focus, observed behavior, and why services were clinically necessary today."
                      value={form.ongoingSituation}
                      onChange={e => set('ongoingSituation', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Interventions Used</label>
                    <textarea
                      className="textarea"
                      rows={3}
                      placeholder="Modalities, techniques, skills practiced, psychoeducation, safety planning, collateral/linkage, and clinical rationale."
                      value={form.ongoingInterventions}
                      onChange={e => set('ongoingInterventions', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Client Response</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      placeholder="Engagement, insight, affective shift, resistance, regulation, skill use, progress, or barriers."
                      value={form.ongoingResponse}
                      onChange={e => set('ongoingResponse', e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Risk / Safety Update</label>
                      <textarea
                        className="textarea"
                        rows={3}
                        placeholder="SI/HI/self-harm, substance risk, DV/abuse concerns, protective factors, safety plan changes, or no-acute-risk rationale."
                        value={form.ongoingRiskSafety}
                        onChange={e => set('ongoingRiskSafety', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label">Functioning / Medical Necessity</label>
                      <textarea
                        className="textarea"
                        rows={3}
                        placeholder="Impact on home, work/school, relationships, parenting, ADLs, level-of-care rationale, and why treatment remains indicated."
                        value={form.ongoingFunctioningMedicalNecessity}
                        onChange={e => set('ongoingFunctioningMedicalNecessity', e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label">Plan / Homework / Next Steps</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      placeholder="Homework, next session focus, referrals, assessments, collateral tasks, coordination, frequency, and follow-up."
                      value={form.ongoingPlanHomework}
                      onChange={e => set('ongoingPlanHomework', e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {/* ── INTAKE fields ── */}
            {sessionType === 'intake' && (
              <>
                {/* Demographics row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Age Range</label>
                    <select className="input" value={form.ageRange} onChange={e => set('ageRange', e.target.value)}>
                      <option value="">Select…</option>
                      <option value="child (under 12)">Child (under 12)</option>
                      <option value="adolescent (12–17)">Adolescent (12–17)</option>
                      <option value="young adult (18–25)">Young Adult (18–25)</option>
                      <option value="adult (26–59)">Adult (26–59)</option>
                      <option value="older adult (60+)">Older Adult (60+)</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Referral Source</label>
                    <select className="input" value={form.referralSource} onChange={e => set('referralSource', e.target.value)}>
                      <option value="">Select…</option>
                      <option value="self-referred">Self-referred</option>
                      <option value="physician / psychiatrist">Physician / Psychiatrist</option>
                      <option value="previous therapist">Previous Therapist</option>
                      <option value="school / educational">School / Educational</option>
                      <option value="court / legal">Court / Legal</option>
                      <option value="EAP">EAP</option>
                      <option value="family member">Family Member</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="label">Living Situation</label>
                  <select className="input" value={form.livingSituation} onChange={e => set('livingSituation', e.target.value)}>
                    <option value="">Select…</option>
                    <option value="alone">Alone</option>
                    <option value="with partner / spouse">With Partner / Spouse</option>
                    <option value="with partner and children">With Partner & Children</option>
                    <option value="single parent with children">Single Parent with Children</option>
                    <option value="with children">With Children (other arrangement)</option>
                    <option value="with family of origin">With Family of Origin</option>
                    <option value="with roommates">With Roommates</option>
                    <option value="transitional / unstable housing">Transitional / Unstable Housing</option>
                    <option value="unhoused">Unhoused</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-teal-700 uppercase tracking-wide">Intake completeness check</p>
                    <p className="text-xs text-teal-600 mt-1">
                      These slots fill the gaps DMH-style documentation often needs for medical necessity, treatment planning, and defensible intake records.
                    </p>
                  </div>
                  <div>
                    <label className="label">Symptom Onset / Duration / Severity</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      placeholder="When symptoms started, duration/course, current severity, frequency, intensity, and any recent worsening or improvement."
                      value={form.symptomOnsetDurationSeverity}
                      onChange={e => set('symptomOnsetDurationSeverity', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Precipitating / Maintaining Factors</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      placeholder="Recent triggers, stressors, relationship patterns, avoidance cycles, environmental barriers, or factors maintaining symptoms."
                      value={form.precipitatingMaintainingFactors}
                      onChange={e => set('precipitatingMaintainingFactors', e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Cultural / Identity Context</label>
                      <textarea
                        className="textarea"
                        rows={2}
                        placeholder="Culture, identity, language, religion/spirituality, immigration, discrimination, or other context relevant to care."
                        value={form.culturalIdentityContext}
                        onChange={e => set('culturalIdentityContext', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label">School / Work / Role Functioning</label>
                      <textarea
                        className="textarea"
                        rows={2}
                        placeholder="School, work, caregiving, parenting, legal, financial, or role-functioning context."
                        value={form.educationEmploymentContext}
                        onChange={e => set('educationEmploymentContext', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Legal / Mandated Reporting Context</label>
                      <textarea
                        className="textarea"
                        rows={2}
                        placeholder="Custody, court, CPS/APS, abuse/neglect reporting, consent limitations, releases, or other legal/ethical context."
                        value={form.legalMandatedContext}
                        onChange={e => set('legalMandatedContext', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label">Safety Plan / Crisis Plan</label>
                      <textarea
                        className="textarea"
                        rows={2}
                        placeholder="Warning signs, coping steps, supports, crisis resources, means safety, emergency plan, and protective actions."
                        value={form.safetyPlanDetails}
                        onChange={e => set('safetyPlanDetails', e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="label">Mental Health History</label>
                  <textarea
                    className="textarea"
                    rows={3}
                    placeholder={"Prior diagnoses, hospitalizations, previous therapy, current medications…\n- E.g.: Hx of MDD, 2 prior therapists, currently on sertraline 50mg"}
                    value={form.mentalHealthHistory}
                    onChange={e => set('mentalHealthHistory', e.target.value)}
                  />
                </div>

                <div>
                  <label className="label">Medical History</label>
                  <textarea
                    className="textarea"
                    rows={2}
                    placeholder="Relevant medical conditions, chronic illness, neurological history, pregnancy/postpartum, sleep or pain concerns…"
                    value={form.medicalHistory}
                    onChange={e => set('medicalHistory', e.target.value)}
                  />
                </div>

                <div>
                  <label className="label">Medications</label>
                  <textarea
                    className="textarea"
                    rows={2}
                    placeholder="Psych meds, other medications, adherence notes, recent changes…"
                    value={form.medications}
                    onChange={e => set('medications', e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Substance Use</label>
                    <textarea
                      className="textarea"
                      rows={3}
                      placeholder={"Current/past use, frequency, impact…\n- E.g.: Occasional alcohol (weekends), denies other use"}
                      value={form.substanceUse}
                      onChange={e => set('substanceUse', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Risk Screening</label>
                    <textarea
                      className="textarea"
                      rows={3}
                      placeholder={"SI/HI, self-harm history, safety plan…\n- E.g.: Denies SI/HI, no self-harm history"}
                      value={form.riskScreening}
                      onChange={e => set('riskScreening', e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="label">Family / Social History</label>
                  <textarea
                    className="textarea"
                    rows={3}
                    placeholder={"Family mental health history, key relationships, cultural/social context…\n- E.g.: Mother with anxiety, estranged from father, strong peer support"}
                    value={form.familySocialHistory}
                    onChange={e => set('familySocialHistory', e.target.value)}
                  />
                </div>

                <div>
                  <label className="label">Trauma History</label>
                  <textarea
                    className="textarea"
                    rows={2}
                    placeholder="Abuse, neglect, community violence, medical trauma, attachment rupture, losses, and other trauma themes if clinically relevant…"
                    value={form.traumaHistory}
                    onChange={e => set('traumaHistory', e.target.value)}
                  />
                </div>

                <div>
                  <label className="label">Mental Status / Clinical Observations</label>
                  <textarea
                    className="textarea"
                    rows={3}
                    placeholder={"Appearance, affect, mood, thought process, insight, judgment…\n- E.g.: Casually dressed, tearful at times, linear thought, good insight"}
                    value={form.mentalStatusObservations}
                    onChange={e => set('mentalStatusObservations', e.target.value)}
                  />
                </div>

                <div>
                  <label className="label">Strengths / Protective Factors</label>
                  <textarea
                    className="textarea"
                    rows={2}
                    placeholder="Supports, resilience, motivation, coping tools, faith/community support, protective relationships…"
                    value={form.strengthsProtectiveFactors}
                    onChange={e => set('strengthsProtectiveFactors', e.target.value)}
                  />
                </div>

                <div>
                  <label className="label">Functional Impairments</label>
                  <textarea
                    className="textarea"
                    rows={2}
                    placeholder="Impact on work, school, sleep, parenting, daily living, relationships, or other functioning…"
                    value={form.functionalImpairments}
                    onChange={e => set('functionalImpairments', e.target.value)}
                  />
                </div>

                <div>
                  <label className="label">Initial Treatment Goals</label>
                  <textarea
                    className="textarea"
                    rows={2}
                    placeholder="What does the client hope to achieve? What are your initial clinical goals?"
                    value={form.treatmentGoal}
                    onChange={e => set('treatmentGoal', e.target.value)}
                  />
                </div>
              </>
            )}

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full justify-center py-2.5"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    {sessionType === 'intake' ? 'Generate Intake Assessment' : 'Generate Session Note'}
                  </>
                )}
              </button>

              {/* Trial remaining badge */}
              {trialRemaining !== null && (
                <div className={`flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg ${
                  trialRemaining <= 2 ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-gray-50 text-gray-500'
                }`}>
                  {trialRemaining <= 2 ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  )}
                  {trialRemaining === 0
                    ? <>No trial generations left. <a href="/billing" className="underline font-semibold">Subscribe now</a></>
                    : <>{trialRemaining} free trial generation{trialRemaining !== 1 ? 's' : ''} remaining · <a href="/billing" className="underline font-medium">upgrade</a></>
                  }
                </div>
              )}
            </div>
          </form>
        </div>

        {/* RIGHT: Output */}
        <div className="space-y-4">
          <div className="card overflow-hidden min-h-[600px] flex flex-col">
            {/* Tab bar */}
            <div className="flex border-b border-gray-100 flex-shrink-0">
              {activeTabs.map(tab => {
                const hasContent = displaySections?.[tab.id]
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 text-xs font-medium py-3 transition-colors border-b-2 relative ${
                      activeTab === tab.id
                        ? 'text-brand-700 dark:text-white border-brand-600 bg-brand-50/40 dark:bg-gradient-to-b dark:from-brand-500/20 dark:to-brand-500/5 shadow-sm dark:shadow-[inset_0_1px_0_rgba(167,139,250,0.35)]'
                        : 'text-gray-500 dark:text-slate-300 border-transparent hover:text-gray-700 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-slate-800/80'
                    }`}
                  >
                    {tab.label}
                    {loading && hasContent && (
                      <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-brand-400" />
                    )}
                  </button>
                )
              })}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              {!displaySections && !loading ? (
                /* Empty state */
                <div className="flex flex-col items-center justify-center h-full py-20 text-center px-8">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-50 to-teal-50 border border-brand-100 flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Output will appear here</h3>
                  <p className="text-xs text-gray-400 max-w-xs">
                    {sessionType === 'intake'
                      ? <>Fill in the intake information on the left and click <strong className="text-gray-600">Generate Intake Assessment</strong>. You'll get a biopsychosocial assessment, clinical formulation, diagnostic impressions, treatment plan recommendations, and supervision guidance. The intake stays as-is — progress notes (SOAP/BIRP/DAP/GIRP/DMH SIR) are for ongoing sessions.</>
                      : <>Fill in your session context on the left and click <strong className="text-gray-600">Generate Session Note</strong>. You'll get a polished clinical note in {form.noteFormat} format, clinical thinking, diagnosis support, and supervision.</>}
                  </p>
                  <div className="mt-6 grid grid-cols-2 gap-2 w-full max-w-xs">
                    {activeTabs.map(t => (
                      <div key={t.id} className="rounded-lg bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-white/10 px-3 py-2 text-xs text-gray-400 dark:text-slate-400 text-center">
                        {t.label}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-5">
                  {/* Status bar while streaming */}
                  {loading && (
                    <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-brand-50 dark:bg-brand-500/10 border border-brand-100 dark:border-brand-400/20">
                      <div className="w-3.5 h-3.5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      <p className="text-xs text-brand-700 dark:text-brand-200 font-medium">
                        {streamingText
                          ? `Writing ${activeTabs.find(t => streamingText.includes(`===${t.id.toUpperCase().replace('CLINICALTHINKING','CLINICAL_THINKING')}===`) ? t.id : 'documentation')?.label || 'content'}…`
                          : connected ? 'Connected, starting…' : 'Connecting…'}
                      </p>
                      <span className="ml-auto text-xs text-brand-500 dark:text-brand-300">{streamingText.length > 0 ? `${Math.round(streamingText.length / 50 * 10) / 10}s` : ''}</span>
                    </div>
                  )}

                  {/* Copy / Regenerate / Save actions (only after done) */}
                  {!loading && (
                    <div className="space-y-3 mb-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {activeTabs.find(t => t.id === activeTab)?.label}
                        </span>
                        <div className="flex gap-2 flex-wrap">
                          <button
                            onClick={handleCopy}
                            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-600 bg-gray-100 hover:bg-brand-50 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            {copied ? (
                              <>
                                <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Copied!
                              </>
                            ) : (
                              <>
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                Copy
                              </>
                            )}
                          </button>
                          <button
                            onClick={handleRegenerate}
                            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-600 bg-gray-100 hover:bg-brand-50 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Regenerate
                          </button>
                          <button
                            onClick={handleSaveToChart}
                            disabled={savingToChart}
                            className="btn-primary text-xs"
                          >
                            {savingToChart ? 'Saving…' : linkedPatientId ? 'Save to client' : 'Save & create client'}
                          </button>
                        </div>
                      </div>
                      {saveNotice && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">{saveNotice}</div>}
                      {saveError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{saveError}</div>}
                    </div>
                  )}

                  {/* Content for active tab */}
                  {(editableOutput?.[activeTab] || displaySections?.[activeTab]) ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        {editableOutput?.[activeTab] !== undefined ? (
                          <p className="text-xs text-gray-400">Editing — modify the text below. Changes are preserved when you switch tabs.</p>
                        ) : (
                          <p className="text-xs text-gray-400">Review the generated content. Click Edit to modify before saving.</p>
                        )}
                        <div className="flex gap-2">
                          {editableOutput?.[activeTab] === undefined ? (
                            <button
                              type="button"
                              onClick={() => setEditableOutput(prev => ({ ...(prev || output || displaySections || {}), [activeTab]: displaySections?.[activeTab] || '' }))}
                              className="btn-secondary text-xs"
                            >
                              Edit
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEditableOutput(prev => { const next = { ...prev }; delete next[activeTab]; return Object.keys(next).length ? next : null })}
                              className="btn-secondary text-xs"
                            >
                              Done editing
                            </button>
                          )}
                        </div>
                      </div>
                      {editableOutput?.[activeTab] !== undefined ? (
                        <textarea
                          className="textarea min-h-[340px] font-sans leading-relaxed text-sm"
                          value={editableOutput?.[activeTab] ?? ''}
                          onChange={e => setEditableOutput(current => ({ ...(current || {}), [activeTab]: e.target.value }))}
                        />
                      ) : (
                        <div
                          className="prose-clinical bg-white rounded-xl border border-gray-100 p-5 min-h-[340px] text-sm text-gray-700 leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: '<p class="mb-3 text-sm text-gray-700 leading-relaxed">' + renderClinicalDocument(displaySections?.[activeTab] || '') + '</p>' }}
                        />
                      )}
                    </div>
                  ) : loading ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-8 h-8 border-2 border-brand-200 border-t-brand-400 rounded-full animate-spin mx-auto mb-3" />
                      <p className="text-xs text-gray-400">This section hasn't been written yet…</p>
                      <p className="text-xs text-gray-300 mt-1">Miwa writes Documentation first, then the other sections</p>
                    </div>
                  ) : null}

                  {/* Review reminder (after done) */}
                  {!loading && (
                    <div className="mt-6 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
                      <p className="text-xs text-gray-500">
                        <strong className="text-gray-700">Review before use:</strong> Check accuracy, revise unsupported wording, and confirm this meets your documentation standards.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
