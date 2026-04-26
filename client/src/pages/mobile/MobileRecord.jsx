/**
 * MobileRecord — voice-first session recorder.
 * The key mobile screen: select client, record, transcribe, generate note, save.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch, apiUpload } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'

const RECORDING_STATES = { idle: 'idle', recording: 'recording', processing: 'processing' }
const NOTE_TABS = ['SOAP', 'DAP', 'BIRP', 'GIRP']
const SESSION_TYPES = [
  { id: 'ongoing', label: 'Session Note' },
  { id: 'intake', label: 'Intake' },
]

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function MobileRecord() {
  const { therapist } = useAuth()
  const [patients, setPatients] = useState([])
  const [recentPatients, setRecentPatients] = useState([])
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [sessionType, setSessionType] = useState('ongoing')
  const [recordState, setRecordState] = useState(RECORDING_STATES.idle)
  const [elapsed, setElapsed] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [generatedNote, setGeneratedNote] = useState(null)
  const [activeTab, setActiveTab] = useState('SOAP')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const timerRef = useRef(null)
  const streamRef = useRef(null)

  // Load patients
  useEffect(() => {
    apiFetch('/patients').then(r => r.json()).then(data => {
      if (Array.isArray(data)) {
        setPatients(data)
        // Show first 5 as "recent" (ideally sorted by last session)
        const sorted = [...data].sort((a, b) => {
          const da = a.last_session_date || a.updated_at || ''
          const db = b.last_session_date || b.updated_at || ''
          return db.localeCompare(da)
        })
        setRecentPatients(sorted.slice(0, 5))
      }
    }).catch(() => {})
  }, [])

  // Timer
  useEffect(() => {
    if (recordState === RECORDING_STATES.recording) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [recordState])

  const startRecording = useCallback(async () => {
    setError('')
    setTranscript('')
    setGeneratedNote(null)
    setSaved(false)
    audioChunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

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
        streamRef.current = null

        if (audioChunksRef.current.length === 0) {
          setRecordState(RECORDING_STATES.idle)
          return
        }

        setRecordState(RECORDING_STATES.processing)

        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        const ext = mimeType.includes('webm') ? 'webm' : 'm4a'
        const formData = new FormData()
        formData.append('audio', blob, `session.${ext}`)

        try {
          const res = await apiUpload('/agent/transcribe', formData)
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data.error || 'Transcription failed')
          }
          const data = await res.json()
          setTranscript(data.transcript || data.text || '')
        } catch (err) {
          setError(err.message || 'Transcription failed')
        }
        setRecordState(RECORDING_STATES.idle)
      }

      recorder.start(1000)
      setRecordState(RECORDING_STATES.recording)
    } catch (err) {
      setError('Microphone access denied. Please allow microphone permissions.')
      setRecordState(RECORDING_STATES.idle)
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const handleMicPress = () => {
    if (recordState === RECORDING_STATES.recording) {
      stopRecording()
    } else if (recordState === RECORDING_STATES.idle) {
      startRecording()
    }
  }

  const generateNote = async () => {
    if (!transcript) return
    if (sessionType === 'ongoing' && !selectedPatient) return
    setGenerating(true)
    setError('')
    try {
      if (sessionType === 'intake') {
        // For intakes, use the workspace endpoint which generates biopsychosocial + formulation + diagnosis + treatment plan
        const res = await apiFetch('/ai/workspace', {
          method: 'POST',
          body: JSON.stringify({
            sessionType: 'intake',
            presentingProblem: transcript,
            caseType: selectedPatient.case_type || 'individual',
            noteFormat: 'SOAP',
            therapeuticOrientation: 'Integrative / Other',
            verbosity: 'standard',
          }),
        })
        // SSE stream — read the final result
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let fullText = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          fullText += decoder.decode(value, { stream: true })
        }
        // Parse the last SSE "done" event
        const lines = fullText.split('\n').filter(l => l.startsWith('data: '))
        const lastLine = lines[lines.length - 1]
        if (lastLine) {
          const parsed = JSON.parse(lastLine.replace('data: ', ''))
          if (parsed.sections) {
            setGeneratedNote({
              sections: {
                SOAP: {
                  subjective: parsed.sections.documentation || '',
                  objective: parsed.sections.clinicalThinking || '',
                  assessment: parsed.sections.diagnosis || '',
                  plan: parsed.sections.treatmentRec || parsed.sections.supervision || '',
                },
              },
              transcript,
              _intakeSections: parsed.sections,
            })
            setActiveTab('SOAP')
          }
        }
      } else {
        const res = await apiFetch('/ai/dictate-session', {
          method: 'POST',
          body: JSON.stringify({
            transcript,
            patientId: selectedPatient.id,
            format: activeTab.toLowerCase(),
            verbosity: 'standard',
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Note generation failed')
        }
        const data = await res.json()
        setGeneratedNote(data)
      }
    } catch (err) {
      setError(err.message || 'Note generation failed')
    }
    setGenerating(false)
  }

  const saveNote = async () => {
    if (!generatedNote || !selectedPatient) return
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch(`/patients/${selectedPatient.id}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          ...(generatedNote.note || generatedNote),
          format: activeTab.toLowerCase(),
          transcript,
          signed: true,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Save failed')
      }
      setSaved(true)
    } catch (err) {
      setError(err.message || 'Save failed')
    }
    setSaving(false)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
      clearInterval(timerRef.current)
    }
  }, [])

  const filteredPatients = searchQuery.trim()
    ? patients.filter(p =>
        (p.client_id || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.display_name || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : patients

  const isRecording = recordState === RECORDING_STATES.recording
  const isProcessing = recordState === RECORDING_STATES.processing

  return (
    <div className="flex flex-col h-full">
      {/* Recording background */}
      <div
        className={`flex-1 flex flex-col transition-all duration-500 ${
          isRecording ? 'bg-gradient-to-b from-gray-900 to-indigo-950' : 'bg-white'
        }`}
      >
        {/* ── Session type toggle ─────────────────────────────────── */}
        {!isRecording && !transcript && (
          <div className="px-5 pt-4 pb-2">
            <div className="flex bg-gray-100 rounded-xl p-1">
              {SESSION_TYPES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSessionType(t.id)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                    sessionType === t.id
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Client selector ──────────────────────────────────────── */}
        <div className={`px-5 pt-3 pb-3 ${isRecording ? 'opacity-50' : ''}`}>
          {!selectedPatient ? (
            <div>
              <p className={`text-sm font-medium mb-2 ${isRecording ? 'text-gray-300' : 'text-gray-700'}`}>
                Select client
              </p>
              {/* Recent clients quick-pick */}
              <div className="flex gap-2 overflow-x-auto pb-2 mb-2 -mx-1 px-1 scrollbar-hide">
                {recentPatients.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPatient(p)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border shrink-0 transition-colors ${
                      isRecording
                        ? 'border-gray-700 bg-gray-800/50 active:bg-gray-700'
                        : 'border-gray-200 bg-white active:bg-gray-50'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">
                      {(p.display_name || p.client_id || '??').slice(0, 2).toUpperCase()}
                    </div>
                    <span className={`text-sm font-medium truncate max-w-[100px] ${isRecording ? 'text-gray-300' : 'text-gray-900'}`}>
                      {p.display_name || p.client_id || 'Client'}
                    </span>
                  </button>
                ))}
                <button
                  onClick={() => setShowPicker(true)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border shrink-0 transition-colors ${
                    isRecording
                      ? 'border-gray-700 bg-gray-800/50 text-gray-400 active:bg-gray-700'
                      : 'border-gray-200 bg-white text-gray-500 active:bg-gray-50'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <span className="text-sm">All</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">
                  {(selectedPatient.display_name || selectedPatient.client_id || '??').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className={`text-sm font-semibold ${isRecording ? 'text-white' : 'text-gray-900'}`}>
                    {selectedPatient.display_name || selectedPatient.client_id || 'Client'}
                  </p>
                  {selectedPatient.presenting_concerns && (
                    <p className={`text-xs truncate max-w-[200px] ${isRecording ? 'text-gray-400' : 'text-gray-500'}`}>
                      {selectedPatient.presenting_concerns}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => { setSelectedPatient(null); setTranscript(''); setGeneratedNote(null); setSaved(false) }}
                className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
                  isRecording ? 'text-gray-400 active:bg-gray-800' : 'text-gray-500 active:bg-gray-100'
                }`}
              >
                Change
              </button>
            </div>
          )}
        </div>

        {/* ── Main recording area ──────────────────────────────────── */}
        <div className="flex-1 flex flex-col items-center justify-center px-5">
          {/* Timer */}
          {(isRecording || isProcessing) && (
            <div className="mb-6">
              <p className={`text-4xl font-mono font-light ${isRecording ? 'text-white' : 'text-gray-900'}`}>
                {formatElapsed(elapsed)}
              </p>
              {isRecording && (
                <div className="flex items-center justify-center gap-2 mt-2">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-sm text-red-400 font-medium">Recording</span>
                </div>
              )}
              {isProcessing && (
                <div className="flex items-center justify-center gap-2 mt-2">
                  <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-indigo-400 font-medium">Processing...</span>
                </div>
              )}
            </div>
          )}

          {/* Waveform placeholder */}
          {isRecording && (
            <div className="flex items-center gap-[3px] h-12 mb-6">
              {Array.from({ length: 24 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full bg-indigo-400/60 animate-pulse"
                  style={{
                    height: `${12 + Math.random() * 36}px`,
                    animationDelay: `${i * 0.08}s`,
                    animationDuration: `${0.6 + Math.random() * 0.8}s`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Mic button */}
          {!transcript && !generatedNote && (
            <button
              onClick={handleMicPress}
              disabled={isProcessing || (sessionType === 'ongoing' && !selectedPatient)}
              className={`relative w-[120px] h-[120px] rounded-full flex items-center justify-center transition-all duration-300 ${
                isRecording
                  ? 'bg-red-500 shadow-[0_0_40px_rgba(239,68,68,0.4)] scale-110'
                  : isProcessing
                  ? 'bg-gray-200 cursor-not-allowed'
                  : !selectedPatient
                  ? 'bg-gray-200 cursor-not-allowed'
                  : 'bg-gradient-to-br from-indigo-500 to-emerald-500 shadow-xl active:scale-95'
              }`}
            >
              {isRecording ? (
                <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : isProcessing ? (
                <div className="w-10 h-10 border-3 border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}

              {/* Pulse rings when recording */}
              {isRecording && (
                <>
                  <span className="absolute inset-0 rounded-full border-2 border-red-400 animate-ping opacity-30" />
                  <span className="absolute inset-[-8px] rounded-full border border-red-400/20 animate-pulse" />
                </>
              )}
            </button>
          )}

          {!selectedPatient && sessionType === 'ongoing' && recordState === RECORDING_STATES.idle && !transcript && (
            <p className="text-sm text-gray-400 mt-4">Select a client to start recording</p>
          )}

          {!selectedPatient && sessionType === 'intake' && recordState === RECORDING_STATES.idle && !transcript && (
            <p className="text-sm text-gray-400 mt-4">Tap the mic to start your intake recording</p>
          )}

          {selectedPatient && recordState === RECORDING_STATES.idle && !transcript && !isProcessing && (
            <p className={`text-sm mt-4 ${isRecording ? 'text-gray-400' : 'text-gray-500'}`}>
              Tap to {isRecording ? 'stop' : 'start'} recording
            </p>
          )}
        </div>

        {/* ── Transcript result ────────────────────────────────────── */}
        {transcript && !generatedNote && (
          <div className="px-5 pb-5">
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Transcript</h3>
                <button
                  onClick={() => { setTranscript(''); setError('') }}
                  className="text-xs text-gray-500 active:text-gray-700"
                >
                  Re-record
                </button>
              </div>
              <div className="px-4 py-3 max-h-40 overflow-y-auto">
                <p className="text-sm text-gray-700 leading-relaxed">{transcript}</p>
              </div>
              <div className="px-4 py-3 border-t border-gray-100">
                <button
                  onClick={generateNote}
                  disabled={generating}
                  className="w-full h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold active:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {generating ? (sessionType === 'intake' ? 'Generating Intake...' : 'Generating Note...') : (sessionType === 'intake' ? 'Generate Intake Assessment' : 'Generate Note')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Generated note ───────────────────────────────────────── */}
        {generatedNote && (
          <div className="px-5 pb-5 flex-1 overflow-y-auto">
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              {/* Tab bar */}
              <div className="flex border-b border-gray-200">
                {NOTE_TABS.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                      activeTab === tab
                        ? 'text-indigo-600 border-b-2 border-indigo-600'
                        : 'text-gray-500 active:text-gray-700'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Note content */}
              <div className="px-4 py-3 max-h-64 overflow-y-auto">
                <NoteContent note={generatedNote} format={activeTab} />
              </div>

              {/* Actions */}
              <div className="px-4 py-3 border-t border-gray-100 space-y-2">
                {saved ? (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm font-semibold text-emerald-600">Saved & Signed</span>
                  </div>
                ) : (
                  <button
                    onClick={saveNote}
                    disabled={saving}
                    className="w-full h-11 rounded-xl bg-emerald-600 text-white text-sm font-semibold active:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save & Sign'}
                  </button>
                )}
                {!saved && (
                  <button
                    onClick={() => { setGeneratedNote(null); setTranscript('') }}
                    className="w-full h-9 rounded-xl text-gray-500 text-sm font-medium active:bg-gray-100 transition-colors"
                  >
                    Start Over
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-5 mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      {/* Client picker modal */}
      {showPicker && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end">
          <div className="w-full bg-white rounded-t-2xl max-h-[80vh] flex flex-col animate-slide-up">
            <div className="px-4 pt-4 pb-2 border-b border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-gray-900">Select Client</h3>
                <button
                  onClick={() => { setShowPicker(false); setSearchQuery('') }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 active:bg-gray-100"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search clients..."
                className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredPatients.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedPatient(p); setShowPicker(false); setSearchQuery('') }}
                  className="w-full flex items-center gap-3 px-4 py-3 active:bg-gray-50 transition-colors border-b border-gray-50"
                >
                  <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold shrink-0">
                    {(p.display_name || p.client_id || '??').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {p.display_name || p.client_id || 'Client'}
                    </p>
                    {p.presenting_concerns && (
                      <p className="text-xs text-gray-500 truncate">{p.presenting_concerns}</p>
                    )}
                  </div>
                </button>
              ))}
              {filteredPatients.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-gray-500">No clients found</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NoteContent({ note, format }) {
  const content = note?.note || note || {}
  const sections = format === 'SOAP'
    ? [
        { key: 'subjective', label: 'Subjective' },
        { key: 'objective', label: 'Objective' },
        { key: 'assessment', label: 'Assessment' },
        { key: 'plan', label: 'Plan' },
      ]
    : [
        { key: 'data', label: 'Data' },
        { key: 'assessment', label: 'Assessment' },
        { key: 'plan', label: 'Plan' },
      ]

  return (
    <div className="space-y-3">
      {sections.map(({ key, label }) => {
        const text = content[key] || content[label.toLowerCase()]
        if (!text) return null
        return (
          <div key={key}>
            <h4 className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-1">{label}</h4>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{text}</p>
          </div>
        )
      })}
      {/* Fallback: if no structured data, show raw */}
      {sections.every(({ key, label }) => !content[key] && !content[label.toLowerCase()]) && (
        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
          {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
        </p>
      )}
    </div>
  )
}
