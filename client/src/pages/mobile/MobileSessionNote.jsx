/**
 * MobileSessionNote -- mobile-optimized session note editor.
 * Voice-first, minimal chrome, large touch targets.
 * Routes: /m/clients/:id/session/new  |  /m/clients/:id/session/:sessionId
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { API_BASE, apiFetch } from '../../lib/api'

const API = API_BASE

/* ── Format definitions ─────────────────────────────────────────── */

const FORMAT_FIELDS = {
  SOAP: [
    { key: 'subjective', label: 'S \u2014 Subjective', placeholder: 'Client self-report, mood, symptoms, what they shared this session\u2026' },
    { key: 'objective',  label: 'O \u2014 Objective',  placeholder: 'Clinician observations: affect, behavior, mental status, screening scores\u2026' },
    { key: 'assessment', label: 'A \u2014 Assessment', placeholder: 'Clinical interpretation, progress, diagnostic impressions, risk\u2026' },
    { key: 'plan',       label: 'P \u2014 Plan',       placeholder: 'Next steps, homework, interventions, referrals\u2026' },
  ],
  DAP: [
    { key: 'subjective', label: 'D \u2014 Data',       placeholder: 'All reported and observed information: self-report, observations, scores\u2026' },
    { key: 'assessment', label: 'A \u2014 Assessment', placeholder: 'Clinical interpretation, progress, formulation\u2026' },
    { key: 'plan',       label: 'P \u2014 Plan',       placeholder: 'Next steps, interventions, homework\u2026' },
  ],
  BIRP: [
    { key: 'subjective', label: 'B \u2014 Behavior',     placeholder: 'Client presentation, mood, affect, reported symptoms\u2026' },
    { key: 'objective',  label: 'I \u2014 Intervention', placeholder: 'Techniques used, topics addressed, modalities applied\u2026' },
    { key: 'assessment', label: 'R \u2014 Response',     placeholder: 'Client response to interventions, engagement, insight\u2026' },
    { key: 'plan',       label: 'P \u2014 Plan',         placeholder: 'Next steps, homework, session focus\u2026' },
  ],
}

const EMPTY_NOTES = {
  SOAP: { subjective: '', objective: '', assessment: '', plan: '' },
  DAP:  { subjective: '', assessment: '', plan: '' },
  BIRP: { subjective: '', objective: '', assessment: '', plan: '' },
}

const DURATION_OPTIONS = [30, 45, 50, 53, 60, 75, 90]

/* ── Helpers ────────────────────────────────────────────────────── */

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return dateStr }
}

/* ── Main Component ─────────────────────────────────────────────── */

export default function MobileSessionNote() {
  const { id: patientId, sessionId } = useParams()
  const navigate = useNavigate()
  const { therapist } = useAuth()
  const isNew = !sessionId

  /* ── State ──────────────────────────────────────────────────── */
  const [patient, setPatient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [signing, setSigning] = useState(false)

  const [activeFormat, setActiveFormat] = useState('SOAP')
  const [notes, setNotes] = useState(EMPTY_NOTES)
  const [icd10Codes, setIcd10Codes] = useState('')
  const [duration, setDuration] = useState(50)
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0])
  const [signedAt, setSignedAt] = useState(null)

  // Edit mode for existing sessions
  const [editing, setEditing] = useState(false)
  const isEditable = isNew || editing

  // Dictation state
  const [dictatingField, setDictatingField] = useState(null) // field key or null
  const [isRecording, setIsRecording] = useState(false)
  const [recordingElapsed, setRecordingElapsed] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  const notesRef = useRef(notes)
  useEffect(() => { notesRef.current = notes }, [notes])

  /* ── Load data ──────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    const loads = [
      apiFetch(`/patients/${patientId}`).then(r => r.ok ? r.json() : Promise.reject('Patient not found')),
    ]
    if (!isNew) {
      loads.push(apiFetch(`/patients/${patientId}/sessions/${sessionId}`).then(r => r.ok ? r.json() : Promise.reject('Session not found')))
    }

    Promise.all(loads)
      .then(([p, s]) => {
        if (cancelled) return
        setPatient(p)
        if (s) {
          setSessionDate(s.session_date || '')
          setIcd10Codes(s.icd10_codes || '')
          setDuration(s.duration_minutes || 50)
          if (s.signed_at) setSignedAt(s.signed_at)

          const fmt = s.note_format || 'SOAP'
          setActiveFormat(fmt === 'INTAKE' ? 'SOAP' : fmt)

          // Parse notes_json
          let parsed = null
          if (s.notes_json) {
            try { parsed = typeof s.notes_json === 'string' ? JSON.parse(s.notes_json) : s.notes_json } catch {}
          }
          if (parsed) {
            setNotes(prev => ({
              SOAP: { ...prev.SOAP, ...(normaliseNotes(parsed.SOAP, 'SOAP')) },
              DAP:  { ...prev.DAP,  ...(normaliseNotes(parsed.DAP,  'DAP'))  },
              BIRP: { ...prev.BIRP, ...(normaliseNotes(parsed.BIRP, 'BIRP')) },
            }))
          } else {
            // Legacy flat fields
            setNotes(prev => ({
              ...prev,
              [fmt === 'INTAKE' ? 'SOAP' : fmt]: {
                subjective: s.subjective || '',
                objective: s.objective || '',
                assessment: s.assessment || '',
                plan: s.plan || '',
              },
            }))
          }
        }
      })
      .catch(err => { if (!cancelled) setError(typeof err === 'string' ? err : err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [patientId, sessionId, isNew])

  /* Clinical drafts are not persisted to device storage because they may contain PHI. */

  /* ── Normalise old-format note keys ─────────────────────────── */
  function normaliseNotes(raw, fmt) {
    if (!raw) return {}
    if ('subjective' in raw || 'goals' in raw) return raw
    if (fmt === 'SOAP') return { subjective: raw.S || '', objective: raw.O || '', assessment: raw.A || '', plan: raw.P || '' }
    if (fmt === 'BIRP') return { subjective: raw.B || '', objective: raw.I || '', assessment: raw.R || '', plan: raw.P || '' }
    if (fmt === 'DAP')  return { subjective: raw.D || '', assessment: raw.A || '', plan: raw.P || '' }
    return raw
  }

  /* ── Save ───────────────────────────────────────────────────── */
  const handleSave = async (sign = false) => {
    if (sign) setSigning(true)
    else setSaving(true)
    setError('')

    const currentNotes = notes[activeFormat] || notes.SOAP || {}
    const payload = {
      session_date: sessionDate,
      note_format: activeFormat,
      subjective: currentNotes.subjective || '',
      objective: currentNotes.objective || '',
      assessment: currentNotes.assessment || '',
      plan: currentNotes.plan || '',
      icd10_codes: icd10Codes,
      duration_minutes: duration,
      notes_json: JSON.stringify(notes),
      ...(sign ? { sign: true } : {}),
    }

    try {
      const url = isNew
        ? `/patients/${patientId}/sessions`
        : `/patients/${patientId}/sessions/${sessionId}`
      const method = isNew ? 'POST' : 'PUT'

      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')

      if (sign && data.signed_at) setSignedAt(data.signed_at)

      if (isNew && data.id) {
        navigate(`/m/clients/${patientId}/session/${data.id}`, { replace: true })
      } else {
        setEditing(false)
      }
    } catch (err) {
      setError(err.message || 'Save failed')
    }
    setSaving(false)
    setSigning(false)
  }

  /* ── Voice dictation ────────────────────────────────────────── */
  const startDictation = async (fieldKey) => {
    setDictatingField(fieldKey)
    setError('')
    chunksRef.current = []
    setRecordingElapsed(0)

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
        setIsRecording(false)
        setTranscribing(true)

        try {
          const blob = new Blob(chunksRef.current, { type: mimeType })
          const fd = new FormData()
          fd.append('audio', blob, 'dictation.webm')

          const res = await fetch(`${API}/ai/dictate-session`, {
            method: 'POST',
            credentials: 'include',
            body: fd,
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Transcription failed')

          // If we get structured sections, apply all; otherwise append transcript to the active field
          if (data.sections) {
            setNotes(prev => ({
              SOAP: { ...prev.SOAP, ...(data.sections.SOAP || {}) },
              DAP:  { ...prev.DAP,  ...(data.sections.DAP  || {}) },
              BIRP: { ...prev.BIRP, ...(data.sections.BIRP || {}) },
            }))
          } else if (data.transcript && fieldKey) {
            setNotes(prev => ({
              ...prev,
              [activeFormat]: {
                ...prev[activeFormat],
                [fieldKey]: (prev[activeFormat]?.[fieldKey] || '') +
                  (prev[activeFormat]?.[fieldKey] ? '\n' : '') + data.transcript,
              },
            }))
          }
        } catch (err) {
          setError(err.message || 'Transcription failed')
        }
        setTranscribing(false)
        setDictatingField(null)
      }

      mr.start(1000)
      setIsRecording(true)
      timerRef.current = setInterval(() => setRecordingElapsed(s => s + 1), 1000)
    } catch (err) {
      setError('Microphone access denied. Please allow microphone permission.')
      setDictatingField(null)
    }
  }

  const stopDictation = () => {
    mediaRecorderRef.current?.stop()
  }

  // Cleanup on unmount
  useEffect(() => () => {
    clearInterval(timerRef.current)
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
  }, [])

  const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  /* ── Field change handler ───────────────────────────────────── */
  const handleFieldChange = (fieldKey, value) => {
    setNotes(prev => ({
      ...prev,
      [activeFormat]: { ...prev[activeFormat], [fieldKey]: value },
    }))
  }

  /* ── Render ─────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const patientName = patient?.display_name || patient?.client_id || 'Patient'
  const activeFields = FORMAT_FIELDS[activeFormat] || FORMAT_FIELDS.SOAP
  const currentNotes = notes[activeFormat] || {}
  const hasContent = Object.values(currentNotes).some(v => v && v.trim().length > 0)

  return (
    <div className="pb-28">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100">
        <div className="flex items-center justify-between px-4 h-14">
          <button
            onClick={() => navigate(`/m/clients/${patientId}`)}
            className="flex items-center gap-1 text-indigo-600 active:text-indigo-800 -ml-1 min-w-[44px] min-h-[44px] justify-center"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 text-center min-w-0">
            <h1 className="text-sm font-bold text-gray-900 truncate">{patientName}</h1>
            {!isNew && signedAt && (
              <span className="text-[10px] font-bold text-emerald-600">Signed {formatDate(signedAt)}</span>
            )}
          </div>
          {isEditable ? (
            <button
              onClick={() => handleSave(false)}
              disabled={saving || signing}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-indigo-600 active:text-indigo-800 font-semibold text-sm disabled:opacity-40"
            >
              {saving ? (
                <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              ) : 'Save'}
            </button>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-indigo-600 active:text-indigo-800 font-semibold text-sm"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* ── Error Banner ─────────────────────────────────────────── */}
      {error && (
        <div className="mx-4 mt-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-red-700 flex-1">{error}</p>
          <button onClick={() => setError('')} className="text-red-400 active:text-red-600 ml-2 p-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Transcribing overlay ─────────────────────────────────── */}
      {transcribing && (
        <div className="mx-4 mt-3 rounded-xl bg-indigo-50 border border-indigo-200 px-4 py-4 text-center">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm font-medium text-indigo-700">Transcribing audio...</p>
          <p className="text-xs text-indigo-500 mt-0.5">This takes 10-20 seconds</p>
        </div>
      )}

      {/* ── Format Selector ──────────────────────────────────────── */}
      {isEditable && (
        <div className="px-4 pt-3 pb-1">
          <div className="flex gap-2">
            {['SOAP', 'DAP', 'BIRP'].map(fmt => (
              <button
                key={fmt}
                onClick={() => setActiveFormat(fmt)}
                className={`px-4 py-2 rounded-full text-sm font-bold transition-colors min-h-[44px] ${
                  activeFormat === fmt
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-500 active:bg-gray-200'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Note Fields ──────────────────────────────────────────── */}
      <div className="px-4 pt-3 space-y-4">
        {activeFields.map(field => (
          <div key={field.key}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-bold text-gray-700">{field.label}</label>
              {isEditable && !isRecording && !transcribing && (
                <button
                  onClick={() => {
                    if (dictatingField === field.key && isRecording) {
                      stopDictation()
                    } else {
                      startDictation(field.key)
                    }
                  }}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                    dictatingField === field.key && isRecording
                      ? 'bg-red-500 animate-pulse'
                      : 'bg-gray-100 active:bg-gray-200'
                  }`}>
                    <svg className={`w-4 h-4 ${dictatingField === field.key && isRecording ? 'text-white' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </div>
                </button>
              )}
            </div>

            {/* Recording indicator for this field */}
            {dictatingField === field.key && isRecording && (
              <div className="mb-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-sm font-mono font-bold text-red-700">{fmtTime(recordingElapsed)}</span>
                </div>
                <button
                  onClick={stopDictation}
                  className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold active:bg-red-700 min-h-[44px]"
                >
                  Stop
                </button>
              </div>
            )}

            {isEditable ? (
              <AutoExpandTextarea
                value={currentNotes[field.key] || ''}
                onChange={val => handleFieldChange(field.key, val)}
                placeholder={field.placeholder}
                disabled={isRecording || transcribing}
              />
            ) : (
              <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 min-h-[60px]">
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {currentNotes[field.key] || <span className="text-gray-400 italic">Empty</span>}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── ICD-10 Codes ─────────────────────────────────────────── */}
      {isEditable && (
        <div className="px-4 pt-4">
          <label className="text-sm font-bold text-gray-700 mb-1.5 block">ICD-10 Codes</label>
          <input
            type="text"
            value={icd10Codes}
            onChange={e => setIcd10Codes(e.target.value)}
            placeholder="F32.1, F41.1"
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300"
            style={{ fontSize: '16px' }}
          />
        </div>
      )}

      {/* ── Duration Pills ───────────────────────────────────────── */}
      {isEditable && (
        <div className="px-4 pt-4">
          <label className="text-sm font-bold text-gray-700 mb-2 block">Session Duration</label>
          <div className="flex gap-2 flex-wrap">
            {DURATION_OPTIONS.map(d => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={`px-3.5 py-2 rounded-full text-sm font-bold min-h-[44px] min-w-[44px] transition-colors ${
                  duration === d
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-500 active:bg-gray-200'
                }`}
              >
                {d}m
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Action Buttons ───────────────────────────────────────── */}
      {isEditable && (
        <div className="px-4 pt-6 pb-2 space-y-3">
          {/* Save Draft */}
          <button
            onClick={() => handleSave(false)}
            disabled={saving || signing || !hasContent}
            className="w-full h-12 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold active:bg-gray-200 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving && <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />}
            Save Draft
          </button>

          {/* Save & Sign */}
          <button
            onClick={() => handleSave(true)}
            disabled={saving || signing || !hasContent}
            className="w-full h-12 rounded-xl text-white text-sm font-bold active:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #6366f1, #10b981)' }}
          >
            {signing && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Save & Sign
          </button>
        </div>
      )}

      {/* ── Read-only: Show signed info + link to desktop enrichments */}
      {!isNew && !isEditable && (
        <div className="px-4 pt-4 space-y-3">
          {signedAt && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm font-medium text-emerald-700">
                Signed on {formatDate(signedAt)}
              </span>
            </div>
          )}

          {icd10Codes && (
            <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">ICD-10</span>
              <p className="text-sm font-medium text-gray-900 mt-0.5">{icd10Codes}</p>
            </div>
          )}

          <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Duration</span>
              <p className="text-sm font-medium text-gray-900 mt-0.5">{duration} minutes</p>
            </div>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600">
              {activeFormat}
            </span>
          </div>

          <button
            onClick={() => navigate(`/patients/${patientId}/sessions/${sessionId}`)}
            className="w-full py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-500 active:bg-gray-50 transition-colors"
          >
            View enrichments on desktop &rarr;
          </button>
        </div>
      )}

      {/* ── Safe area bottom padding ─────────────────────────────── */}
      <div className="h-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
    </div>
  )
}

/* ── AutoExpandTextarea ─────────────────────────────────────────── */

function AutoExpandTextarea({ value, onChange, placeholder, disabled }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = ref.current.scrollHeight + 'px'
    }
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={3}
      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 placeholder-gray-400 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 disabled:opacity-50 disabled:bg-gray-50"
      style={{ fontSize: '16px', minHeight: '80px' }}
    />
  )
}
