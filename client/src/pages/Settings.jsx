import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTour } from '../context/TourContext'
import { apiFetch } from '../lib/api'
import { therapistInitials } from '../lib/avatar'
import { COMMON_TIMEZONES } from '../lib/dateUtils'
import OutreachSettings from '../components/OutreachSettings'

const API = import.meta.env.VITE_API_URL ?? '/api'

const ASSISTANT_ACTION_MODES = [
  { id: 'read_only', label: 'Read-only', desc: 'Analyze and explain only' },
  { id: 'draft_only', label: 'Draft-only', desc: 'Draft and suggest, but do not act' },
  { id: 'approve_to_act', label: 'Approve-to-act', desc: 'Prepare actions that still need approval' },
]

const ASSISTANT_ORIENTATIONS = [
  { id: 'integrative', label: 'Integrative' },
  { id: 'family-systems', label: 'Family systems' },
  { id: 'cbt', label: 'CBT' },
  { id: 'trauma-informed', label: 'Trauma-informed' },
  { id: 'psychodynamic', label: 'Psychodynamic' },
]

const ASSISTANT_VERBOSITY = [
  { id: 'concise', label: 'Concise' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'detailed', label: 'Detailed' },
]

const ASSISTANT_PERMISSION_CHOICES = [
  { id: 'history', label: 'Chat history' },
  { id: 'patient_context', label: 'Patient context' },
  { id: 'session_context', label: 'Session context' },
  { id: 'documents', label: 'Documents' },
  { id: 'assessments', label: 'Assessments' },
  { id: 'supervision_notes', label: 'Supervision notes' },
]

function HelpTourCard() {
  const { startTour, tourCompleted } = useTour()
  return (
    <div className="card p-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Help & App Tour</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {tourCompleted ? 'Take the tour again anytime to refresh your memory.' : 'New here? Take a guided tour of the app.'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={startTour} className="btn-primary text-sm">
          {tourCompleted ? 'Restart Tour' : 'Start App Tour'}
        </button>
        <Link to="/docs" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
          View Documentation
        </Link>
      </div>
    </div>
  )
}

function DemoPatientCard() {
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [result, setResult] = useState(null)
  const navigate = useNavigate()

  const archetypeLabels = {
    life_transition_depression: 'Depression + Anxiety (Life Transition)',
    trauma_ptsd: 'Trauma / PTSD Presentation',
    anxiety_primary: 'Anxiety Primary (GAD / Social)',
    burnout_work_stress: 'Burnout / Work Stress',
    grief_bereavement: 'Grief / Bereavement',
    adjustment_disorder: 'Adjustment Disorder',
  }

  const trajectoryLabels = {
    strong_responder: 'Strong Responder',
    moderate_responder: 'Moderate Responder',
    slow_responder: 'Slow Responder (with setbacks)',
  }

  async function handleLoad() {
    setStatus('loading')
    setResult(null)
    try {
      const res = await fetch(`${API}/seed/demo-patient`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
      setStatus('done')
    } catch (err) {
      setResult({ error: err.message })
      setStatus('error')
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Generate Demo Patient</h2>
          <p className="text-xs text-gray-500 mt-0.5">Creates a unique, randomly generated client every time with different presentation, demographics, and outcome trajectory.</p>
        </div>
      </div>

      <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 mb-4 text-xs text-teal-800 space-y-1">
        <p className="font-semibold">Each demo patient is randomized across:</p>
        <ul className="list-disc list-inside space-y-0.5 text-teal-700">
          <li>4 client types: individual, couple, family, child / adolescent</li>
          <li>10 clinical archetypes (depression, trauma, anxiety, burnout, grief, adjustment, couple communication, infidelity recovery, blended-family adjustment, school anxiety, adolescent depression)</li>
          <li>Age tailored to client type (couples 32–48, family 30–46, child 8–17, adult 22–62)</li>
          <li>4–8 SOAP/BIRP/DAP/GIRP session notes with AI feedback</li>
          <li>PHQ-9 + GAD-7 arcs every session (strong / moderate / slow responder trajectories)</li>
          <li><strong>PCL-5</strong> arc for trauma archetypes; <strong>C-SSRS</strong> for SI-flagged archetypes</li>
          <li>2–5 completed between-session check-ins with mood ratings + notes</li>
          <li>Active treatment plan with 3–4 measurable goals</li>
          <li>Past appointments (one per session, marked completed) + 2 upcoming appointments</li>
          <li>All intake fields, diagnoses, risk screening, treatment goals</li>
          <li>Realistic alerts: risk flags, improvement milestones, setbacks</li>
        </ul>
      </div>

      {status === 'idle' && (
        <button onClick={handleLoad} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors shadow">
          Generate Demo Patient
        </button>
      )}
      {status === 'loading' && (
        <button disabled className="w-full py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-400 flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          Generating…
        </button>
      )}
      {status === 'done' && result && (
        <div className="space-y-3">
          {/* Result summary card */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2">
            <p className="text-sm font-bold text-emerald-800">✅ Created: {result.client_id}</p>
            {result.display_name && (
              <div className="flex items-center gap-2 bg-white border border-emerald-100 rounded-lg px-2 py-1.5">
                <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700">
                  {result.display_name[0]}
                </div>
                <div className="text-xs text-gray-700">
                  <span className="font-semibold">{result.display_name}</span>
                  {result.phone && <span className="text-gray-400 ml-2">{result.phone}</span>}
                </div>
                <span className="ml-auto text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-100 rounded px-1.5 py-0.5 font-medium">Miwa-ready</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-emerald-700">
              <div><span className="font-semibold">Type:</span> {archetypeLabels[result.archetype] || result.archetype}</div>
              <div><span className="font-semibold">Trajectory:</span> {trajectoryLabels[result.trajectory] || result.trajectory}</div>
              <div><span className="font-semibold">Patient:</span> {result.age}yo {result.gender}</div>
              <div><span className="font-semibold">Sessions:</span> {result.sessions_created}</div>
              <div><span className="font-semibold">PHQ-9:</span> {result.phq9_start} → {result.phq9_end}</div>
              <div><span className="font-semibold">GAD-7:</span> {result.gad7_start} → {result.gad7_end}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => navigate('/patients')} className="flex-1 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
              View in Patients
            </button>
            <button onClick={() => navigate('/outcomes')} className="flex-1 py-2 rounded-xl text-sm font-semibold border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors">
              View Outcomes
            </button>
          </div>
          <button onClick={() => setStatus('idle')} className="w-full py-2 rounded-xl text-xs font-semibold border border-teal-200 text-teal-700 hover:bg-teal-50 transition-colors">
            Generate Another
          </button>
        </div>
      )}
      {status === 'error' && (
        <div className="space-y-2">
          <p className="text-sm text-red-600">Error: {result?.error || 'Something went wrong'}</p>
          <button onClick={() => setStatus('idle')} className="text-xs text-gray-400 hover:text-gray-600">Try again</button>
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const { therapist, refreshTherapist } = useAuth()

  const [userRole, setUserRole] = useState('licensed')
  const [referralCode, setReferralCode] = useState('')
  const [codeCopied, setCodeCopied] = useState(false)
  const [telehealthUrl, setTelehealthUrl] = useState('')

  const [assistantActionMode, setAssistantActionMode] = useState('draft_only')
  const [assistantTone, setAssistantTone] = useState('calm, clinical, and collaborative')
  const [assistantOrientation, setAssistantOrientation] = useState('integrative')
  const [assistantVerbosity, setAssistantVerbosity] = useState('balanced')
  const [assistantMemory, setAssistantMemory] = useState('')
  const [assistantPermissions, setAssistantPermissions] = useState(['history', 'patient_context', 'session_context', 'documents'])
  const [autoSendOverdue, setAutoSendOverdue] = useState(false)
  const [autoMbcEnabled, setAutoMbcEnabled] = useState(true)

  const [showNewRule, setShowNewRule] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'auto')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [preferredTimezone, setPreferredTimezone] = useState('America/Los_Angeles')

  // Soul profile state
  const [soulPrefs, setSoulPrefs] = useState([])
  const [soulLoading, setSoulLoading] = useState(false)
  const [soulExpanded, setSoulExpanded] = useState(false)

  useEffect(() => {
    apiFetch('/settings')
      .then(r => r.json())
      .then(data => {
        setUserRole(data.user_role || 'licensed')
        setReferralCode(data.referral_code || therapist?.referral_code || '')
        setAssistantActionMode(data.assistant_action_mode || therapist?.assistant_action_mode || 'draft_only')
        setAssistantTone(data.assistant_tone || therapist?.assistant_tone || 'calm, clinical, and collaborative')
        setAssistantOrientation(data.assistant_orientation || therapist?.assistant_orientation || 'integrative')
        setAssistantVerbosity(data.assistant_verbosity || therapist?.assistant_verbosity || 'balanced')
        setAssistantMemory(data.assistant_memory || therapist?.assistant_memory || '')
        setAssistantPermissions(Array.isArray(data.assistant_permissions)
          ? data.assistant_permissions
          : (therapist?.assistant_permissions || ['history', 'patient_context', 'session_context', 'documents']))
        setAutoSendOverdue(data.auto_send_overdue || false)
        setAutoMbcEnabled(data.auto_mbc_enabled !== false)
      })
    // Populate name fields from therapist profile
    setFirstName(therapist?.first_name || (therapist?.full_name?.split(' ')[0] || ''))
    setLastName(therapist?.last_name || (therapist?.full_name?.split(' ').slice(1).join(' ') || ''))
    setAvatarPreview(therapist?.avatar_url || '')
    setTelehealthUrl(therapist?.telehealth_url || '')
    setPreferredTimezone(therapist?.preferred_timezone || 'America/Los_Angeles')
  }, [therapist])

  const loadSoulPrefs = async () => {
    setSoulLoading(true)
    try {
      const res = await apiFetch('/agent/preferences')
      const data = await res.json()
      setSoulPrefs(data.preferences || [])
    } catch {}
    setSoulLoading(false)
  }

  const deleteSoulPref = async (id) => {
    try {
      await apiFetch(`/agent/preferences/${id}`, { method: 'DELETE' })
      setSoulPrefs(p => p.filter(x => x.id !== id))
    } catch {}
  }

  const handleToggleSoul = () => {
    const next = !soulExpanded
    setSoulExpanded(next)
    if (next && soulPrefs.length === 0) loadSoulPrefs()
  }

  const saveSetting = async (key, value) => {
    setSaving(true)
    setError('')
    setSaved('')
    try {
      const res = await apiFetch('/settings', {
        method: 'POST',
        body: JSON.stringify({ key, value }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setSaved(key)
      setTimeout(() => setSaved(''), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveRole = () => saveSetting('user_role', userRole)

  const handleSaveAssistantPrefs = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/auth/me', {
        method: 'PUT',
        body: JSON.stringify({
          assistant_action_mode: assistantActionMode,
          assistant_tone: assistantTone,
          assistant_orientation: assistantOrientation,
          assistant_verbosity: assistantVerbosity,
          assistant_memory: assistantMemory,
          assistant_permissions: assistantPermissions,
          auto_send_overdue: autoSendOverdue,
          auto_mbc_enabled: autoMbcEnabled,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save assistant preferences')
      refreshTherapist(data.therapist, data.token)
      setSaved('assistant')
      setTimeout(() => setSaved(''), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveName = async () => {
    if (!firstName.trim()) { setError('First name is required.'); return }
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/auth/me', {
        method: 'PUT',
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update profile')
      refreshTherapist(data.therapist, data.token)
      setEditingName(false)
      setSaved('name')
      setTimeout(() => setSaved(''), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveTelehealth = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/auth/me', {
        method: 'PUT',
        body: JSON.stringify({ telehealth_url: telehealthUrl.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save telehealth URL')
      refreshTherapist(data.therapist, data.token)
      setSaved('telehealth')
      setTimeout(() => setSaved(''), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveTimezone = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/auth/me', {
        method: 'PUT',
        body: JSON.stringify({ preferred_timezone: preferredTimezone }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save timezone')
      refreshTherapist(data.therapist, data.token)
      setSaved('timezone')
      setTimeout(() => setSaved(''), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const resizeImageToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read image file.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not process that image.'))
      img.onload = () => {
        const maxSize = 320
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSaving(true)
    setError('')
    try {
      const avatarUrl = await resizeImageToDataUrl(file)
      const res = await apiFetch('/auth/me', {
        method: 'PUT',
        body: JSON.stringify({ avatar_url: avatarUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update profile picture')
      setAvatarPreview(data.therapist?.avatar_url || avatarUrl)
      refreshTherapist(data.therapist, data.token)
      setSaved('avatar')
      setTimeout(() => setSaved(''), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
      e.target.value = ''
    }
  }

  const handleRemoveAvatar = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/auth/me', {
        method: 'PUT',
        body: JSON.stringify({ avatar_url: '' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to remove profile picture')
      setAvatarPreview('')
      refreshTherapist(data.therapist, data.token)
      setSaved('avatar')
      setTimeout(() => setSaved(''), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const applyTheme = (t) => {
    setTheme(t)
    localStorage.setItem('theme', t)
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const useDark = t === 'dark' || (t === 'auto' && prefersDark)
    const usePink = t === 'pink'
    document.documentElement.classList.toggle('dark', useDark)
    document.documentElement.classList.toggle('pink', usePink)
  }

  const copyReferralCode = () => {
    navigator.clipboard.writeText(referralCode).then(() => {
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    })
  }

  const initials = therapistInitials(therapist)

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="card p-6 md:hidden">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Billing</h2>
            <p className="text-xs text-gray-500 mt-0.5">Manage your subscription and payment method.</p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-900">Open billing</p>
            <p className="text-xs text-gray-500 mt-0.5">Plans, portal, and payment details.</p>
          </div>
          <Link to="/billing" className="btn-secondary text-sm whitespace-nowrap">
            Billing
          </Link>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Profile</h2>
            <p className="text-xs text-gray-500 mt-0.5">Your name, profile picture, and account information.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0 overflow-hidden border border-gray-200"
              style={{ background: avatarPreview ? '#e5e7eb' : 'linear-gradient(135deg, #5746ed, #7c3aed)' }}
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="space-y-2 min-w-[220px]">
              <p className="text-sm font-semibold text-gray-900">
                {therapist?.full_name || [therapist?.first_name, therapist?.last_name].filter(Boolean).join(' ') || <span className="text-gray-400 italic">No name set</span>}
              </p>
              <p className="text-xs text-gray-500">{therapist?.email}</p>
              <div className="flex gap-2 flex-wrap">
                <label className="btn-secondary text-xs cursor-pointer">
                  Upload profile picture
                  <input type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} disabled={saving} />
                </label>
                {avatarPreview && (
                  <button type="button" onClick={handleRemoveAvatar} className="btn-secondary text-xs" disabled={saving}>
                    Remove
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-400">Use a square-ish image for the cleanest result. Miwa compresses it automatically.</p>
            </div>
          </div>

          <div>
            <label className="label">Name</label>
            {editingName ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">First name <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      className="input"
                      value={firstName}
                      onChange={e => setFirstName(e.target.value)}
                      placeholder="Jane"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Last name</label>
                    <input
                      type="text"
                      className="input"
                      value={lastName}
                      onChange={e => setLastName(e.target.value)}
                      placeholder="Smith"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSaveName} disabled={saving} className="btn-primary text-sm">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setEditingName(false)
                      setFirstName(therapist?.first_name || therapist?.full_name?.split(' ')[0] || '')
                      setLastName(therapist?.last_name || therapist?.full_name?.split(' ').slice(1).join(' ') || '')
                    }}
                    className="btn-secondary text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <p className="flex-1 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                  {therapist?.full_name || <span className="text-gray-400 italic">Not set — Miwa can't address you by name until this is filled in</span>}
                </p>
                <button
                  onClick={() => setEditingName(true)}
                  className="text-xs text-brand-600 hover:text-brand-700 font-semibold px-3 py-2 rounded-lg hover:bg-brand-50 transition-colors"
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="label">Email</label>
            <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              {therapist?.email}
            </p>
            <p className="text-xs text-gray-400 mt-1">Email cannot be changed.</p>
          </div>

          {saved === 'name' && <p className="text-sm text-green-600 font-medium">Name updated!</p>}
          {saved === 'avatar' && <p className="text-sm text-green-600 font-medium">Profile picture updated!</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>

      {/* ── Telehealth ──────────────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Telehealth</h2>
            <p className="text-xs text-gray-500 mt-0.5">Paste your video platform link (Zoom, Doxy.me, Google Meet, etc.). Miwa sends it to clients via SMS when you schedule an appointment, and shows a "Start Session" button on your calendar.</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Video link</label>
            <input
              type="url"
              className="input"
              value={telehealthUrl}
              onChange={e => setTelehealthUrl(e.target.value)}
              placeholder="https://zoom.us/j/your-meeting-id"
            />
            {telehealthUrl && (
              <p className="text-xs text-gray-400 mt-1 truncate">
                Clients will receive this link via SMS when appointments are booked.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button onClick={handleSaveTelehealth} disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved === 'telehealth' && <span className="text-sm text-green-600 font-medium">Saved!</span>}
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Clinician Role</h2>
            <p className="text-xs text-gray-500 mt-0.5">Controls how Miwa tailors its responses. Socratic for trainees, direct for licensed clinicians.</p>
          </div>
        </div>

        <div className="space-y-2">
          {[
            {
              value: 'trainee',
              label: 'Trainee / Pre-Licensed',
              desc: 'Associate MFT, intern, or practicum student. Miwa uses Socratic questioning to develop your clinical reasoning.',
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                </svg>
              ),
            },
            {
              value: 'licensed',
              label: 'Licensed Clinician',
              desc: 'LMFT, LCSW, LPC, psychologist, or other licensed professional. Miwa acts as a peer consultant with direct responses.',
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
              ),
            },
          ].map(opt => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-colors ${
                userRole === opt.value
                  ? 'border-brand-300 bg-brand-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/80'
              }`}
            >
              <input
                type="radio"
                name="userRole"
                value={opt.value}
                checked={userRole === opt.value}
                onChange={e => setUserRole(e.target.value)}
                className="mt-0.5 text-brand-600 focus:ring-brand-500"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={userRole === opt.value ? 'text-brand-600' : 'text-gray-400'}>{opt.icon}</span>
                  <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button onClick={handleSaveRole} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save Role'}
          </button>
          {saved === 'user_role' && <span className="text-sm text-green-600 font-medium">Saved!</span>}
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Appearance</h2>
            <p className="text-xs text-gray-500 mt-0.5">Theme and display preferences.</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {[
            { id: 'light', label: 'Light' },
            { id: 'dark',  label: 'Dark' },
            { id: 'auto',  label: 'System' },
            { id: 'pink',  label: 'Pink' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => applyTheme(t.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                theme === t.id
                  ? 'border-brand-400 bg-brand-50 text-brand-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Timezone</h2>
            <p className="text-xs text-gray-500 mt-0.5">All dates and times in the app will be displayed in your selected timezone.</p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Your timezone</span>
            <select
              value={preferredTimezone}
              onChange={e => setPreferredTimezone(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:ring-blue-200"
            >
              {COMMON_TIMEZONES.map(tz => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
          </label>
          <button
            onClick={handleSaveTimezone}
            disabled={saving}
            className={`w-full py-2 rounded-xl text-sm font-semibold transition-colors ${
              saved === 'timezone'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {saved === 'timezone' ? '✓ Saved' : saving ? 'Saving…' : 'Save timezone'}
          </button>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L6 21l-1-4-4-1 4-4 1 4 3.75-3.75M14 3l7 7-5 5-7-7 5-5z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Miwa Assistant</h2>
            <p className="text-xs text-gray-500 mt-0.5">Personalize how your in-app assistant thinks, speaks, and what it can see.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Action mode</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {ASSISTANT_ACTION_MODES.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setAssistantActionMode(opt.id)}
                  className={`text-left p-3 rounded-xl border transition-colors ${assistantActionMode === opt.id ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:bg-gray-50 hover:border-gray-300'}`}
                >
                  <div className="text-sm font-semibold text-gray-900">{opt.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Auto-send overdue assessments toggle */}
          <div className="rounded-xl border border-gray-200 p-4 flex items-start gap-3">
            <button
              onClick={() => setAutoSendOverdue(!autoSendOverdue)}
              className={`mt-0.5 flex-shrink-0 w-9 h-5 rounded-full transition-colors ${autoSendOverdue ? 'bg-brand-600' : 'bg-gray-300'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${autoSendOverdue ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
            <div>
              <p className="text-sm font-semibold text-gray-900">Auto-send overdue assessments</p>
              <p className="text-xs text-gray-500 mt-0.5">
                When enabled, Miwa automatically sends assessments to clients who are overdue (&gt;30 days since last assessment). You'll be notified in your alerts.
              </p>
            </div>
          </div>

          {/* Auto-send MBC before sessions toggle */}
          <div className="rounded-xl border border-gray-200 p-4 flex items-start gap-3">
            <button
              onClick={() => setAutoMbcEnabled(!autoMbcEnabled)}
              className={`mt-0.5 flex-shrink-0 w-9 h-5 rounded-full transition-colors ${autoMbcEnabled ? 'bg-brand-600' : 'bg-gray-300'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${autoMbcEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
            <div>
              <p className="text-sm font-semibold text-gray-900">Auto-send assessments before sessions</p>
              <p className="text-xs text-gray-500 mt-0.5">
                PHQ-9 and GAD-7 are automatically sent via SMS 24 hours before each scheduled appointment. Scores appear in client charts before the session starts.
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tone</span>
              <input
                value={assistantTone}
                onChange={e => setAssistantTone(e.target.value)}
                placeholder="calm, clinical, and collaborative"
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-brand-200"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Verbosity</span>
              <select
                value={assistantVerbosity}
                onChange={e => setAssistantVerbosity(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-brand-200"
              >
                {ASSISTANT_VERBOSITY.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
              </select>
            </label>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Clinical orientation</p>
            <div className="flex flex-wrap gap-2">
              {ASSISTANT_ORIENTATIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setAssistantOrientation(opt.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${assistantOrientation === opt.id ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Memory note</p>
            <textarea
              value={assistantMemory}
              onChange={e => setAssistantMemory(e.target.value)}
              rows={4}
              placeholder="Examples: Keep responses concise. Prefer family-systems framing. Flag documentation risks early."
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-brand-200"
            />
            <p className="text-[11px] text-gray-400 mt-1.5">This is safe assistant memory for preferences, style, and workflow habits — not raw client details.</p>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Permissions</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ASSISTANT_PERMISSION_CHOICES.map(opt => {
                const checked = assistantPermissions.includes(opt.id)
                return (
                  <label key={opt.id} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${checked ? 'border-brand-300 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setAssistantPermissions(prev => prev.includes(opt.id)
                          ? prev.filter(id => id !== opt.id)
                          : [...prev, opt.id])
                      }}
                      className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={handleSaveAssistantPrefs} disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Save Assistant Settings'}
            </button>
            {saved === 'assistant' && <span className="text-sm text-green-600 font-medium">Saved!</span>}
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Referral Code</h2>
            <p className="text-xs text-gray-500 mt-0.5">Share this with colleagues or supervisees when they sign up.</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 font-mono tracking-wide">
            {referralCode || '—'}
          </div>
          <button onClick={copyReferralCode} className="btn-secondary text-sm">
            {codeCopied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Automation Rules removed — replaced by Proactive Outreach below */}

      {/* ── Miwa Soul Profile ─────────────────────────────────────────────── */}
      <div className="card p-6">
        <button
          onClick={handleToggleSoul}
          className="w-full flex items-start gap-3 text-left"
        >
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, rgba(87,70,237,0.12), rgba(10,197,162,0.12))' }}>
            <svg className="w-5 h-5" style={{ color: '#5746ed' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Miwa Soul Profile</h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(87,70,237,0.1)', color: '#5746ed' }}>
                {soulPrefs.length > 0 ? `${soulPrefs.length} learned` : 'Auto-learns'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Miwa learns your preferences automatically from every conversation — note style, scheduling patterns, clinical approach, and corrections.
            </p>
          </div>
          <svg className={`w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0 transition-transform ${soulExpanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {soulExpanded && (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl p-3 text-xs text-indigo-700"
              style={{ background: 'rgba(87,70,237,0.06)', border: '1px solid rgba(87,70,237,0.15)' }}>
              Miwa observes every interaction and silently adapts. No configuration needed — just use Miwa naturally and it learns your style.
              Explicit corrections ("don't do X") are always applied with the highest priority.
            </div>

            {soulLoading && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-indigo-400 rounded-full animate-spin" />
                Loading preferences…
              </div>
            )}

            {!soulLoading && soulPrefs.length === 0 && (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-400 font-medium">Nothing learned yet</p>
                <p className="text-xs text-gray-400 mt-1">Start using Miwa in the workspace and preferences will appear here automatically.</p>
              </div>
            )}

            {!soulLoading && soulPrefs.length > 0 && (() => {
              const categoryLabels = {
                note_style: 'Note Style',
                scheduling: 'Scheduling',
                clinical: 'Clinical Approach',
                communication: 'Communication',
                corrections: 'Corrections',
              }
              const grouped = soulPrefs.reduce((acc, p) => {
                if (!acc[p.category]) acc[p.category] = []
                acc[p.category].push(p)
                return acc
              }, {})
              const categoryColors = {
                corrections: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', text: '#dc2626', dot: '#ef4444' },
                note_style:  { bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.2)', text: '#5746ed', dot: '#818cf8' },
                scheduling:  { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)', text: '#059669', dot: '#34d399' },
                clinical:    { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', text: '#d97706', dot: '#fbbf24' },
                communication:{ bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.2)', text: '#7c3aed', dot: '#a78bfa' },
              }
              return (
                <div className="space-y-3">
                  {Object.entries(grouped).map(([cat, prefs]) => {
                    const colors = categoryColors[cat] || categoryColors.note_style
                    return (
                      <div key={cat} className="rounded-xl p-3"
                        style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
                        <p className="text-[11px] font-bold uppercase tracking-wider mb-2"
                          style={{ color: colors.text }}>
                          {categoryLabels[cat] || cat}
                          {cat === 'corrections' && <span className="ml-1.5 normal-case font-medium opacity-70">· Always applied</span>}
                        </p>
                        <div className="space-y-1.5">
                          {prefs.map(p => (
                            <div key={p.id} className="flex items-start gap-2 group">
                              <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                                style={{ background: colors.dot }} />
                              <span className="text-xs text-gray-700 flex-1 leading-relaxed">{p.value}</span>
                              <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5">
                                {p.source === 'explicit' ? 'explicit' : 'learned'}
                              </span>
                              <button
                                onClick={() => deleteSoulPref(p.id)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-all flex-shrink-0"
                                title="Remove this preference">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                  <button
                    onClick={loadSoulPrefs}
                    className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors flex items-center gap-1.5 mt-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh
                  </button>
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* Group Practice removed — separate product at practice.miwa.care */}

      {/* Proactive Outreach Settings */}
      <OutreachSettings />

      {/* Help & App Tour */}
      <HelpTourCard />

      <DemoPatientCard />
    </div>
  )
}
