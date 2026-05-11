// Trainee onboarding wizard — five resumable screens at /t/welcome.
//
// State lives on the server (therapists.onboarding_step,
// therapists.onboarding_skipped_steps, therapists.onboarded_at) and is
// fetched on mount via GET /api/onboarding/state. Each screen submits to
// PUT /api/onboarding/step/:n or POST /api/onboarding/skip/:n before
// advancing, so the wizard can be resumed on the same step after a refresh
// or new sign-in.
//
// Tone is peer-to-peer and warm. Don't reinvent the design system — use the
// trainee primitives in components/trainee/.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { apiFetch } from '../../lib/api'
import { WizardLayout, TraineeCard, TraineeButton } from '../../components/trainee'

const TOTAL_STEPS = 5

// California-leaning MFT program list; "Other" lets a trainee type their own.
const PROGRAM_OPTIONS = [
  'CSUN',
  'Pepperdine',
  'CBT (Center for Brief Therapy)',
  'FPI (Family Practice Institute)',
  'Phillips Graduate Institute',
  'Alliant',
  'USC',
  'Other',
]

function currentYear() {
  return new Date().getFullYear()
}

export default function TraineeWelcome() {
  const navigate = useNavigate()
  const { therapist, refreshTherapist } = useAuth()
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const firstName = therapist?.first_name || therapist?.full_name?.split(' ')[0] || 'there'
  const step = state?.step ? Math.max(1, Math.min(state.step + 1, TOTAL_STEPS)) : 1

  // Show the retroactive banner if this is an existing trainee who landed in
  // the wizard with no progress recorded. Heuristic: account is older than 24h
  // and step is 0.
  const isRetroactive = useMemo(() => {
    if (!therapist?.created_at || !state) return false
    if (state.step > 0) return false
    const created = new Date(therapist.created_at).getTime()
    return Number.isFinite(created) && Date.now() - created > 24 * 60 * 60 * 1000
  }, [therapist?.created_at, state])

  // Load wizard state on mount
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch('/onboarding/state')
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => {
        if (cancelled) return
        if (data?.completed) {
          navigate('/t/dashboard', { replace: true })
          return
        }
        setState(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load onboarding state.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [navigate])

  async function refreshTherapistRow() {
    try {
      const me = await apiFetch('/auth/me').then((r) => (r.ok ? r.json() : null))
      if (me) refreshTherapist(me, null)
    } catch {
      // Non-fatal — the wizard already has the server state from /state
    }
  }

  async function saveStep(stepNum, payload) {
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch(`/onboarding/step/${stepNum}`, {
        method: 'PUT',
        body: JSON.stringify(payload || {}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save this step.')
      setState(data)
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setSaving(false)
    }
  }

  async function skipStep(stepNum) {
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch(`/onboarding/skip/${stepNum}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not skip this step.')
      setState(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function completeWizard() {
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/onboarding/complete', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not finish setup.')
      await refreshTherapistRow()
      navigate('/t/dashboard', {
        replace: true,
        state: { onboardingComplete: true },
      })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  if (loading || !state) {
    return (
      <WizardLayout step={1} totalSteps={TOTAL_STEPS}>
        <TraineeCard>
          <div className="flex items-center justify-center py-10 text-gray-500">
            <span className="w-5 h-5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin mr-3" />
            Loading…
          </div>
        </TraineeCard>
      </WizardLayout>
    )
  }

  const ScreenComponent = SCREENS[step] || SCREENS[1]

  return (
    <WizardLayout step={step} totalSteps={TOTAL_STEPS} skippedSteps={state.skipped_steps}>
      {error && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 font-medium">
          {error}
        </div>
      )}
      <ScreenComponent
        firstName={firstName}
        therapist={therapist}
        state={state}
        saving={saving}
        isRetroactive={isRetroactive}
        saveStep={saveStep}
        skipStep={skipStep}
        completeWizard={completeWizard}
        refreshState={async () => {
          const res = await apiFetch('/onboarding/state')
          if (res.ok) setState(await res.json())
        }}
      />
    </WizardLayout>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Screens — registered below. Each screen is keyed by step number so the
// wizard router above can swap them based on state.step. They share a uniform
// props contract (see Step1 for the shape).
// ────────────────────────────────────────────────────────────────────────────

function Step1Welcome({ firstName, isRetroactive, saving, saveStep, skipStep }) {
  const [acknowledged, setAcknowledged] = useState(false)

  return (
    <TraineeCard
      title={`Welcome to Miwa, ${firstName}`}
      subtitle="Your AI clinical workspace and supervision-prep companion."
    >
      <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
        {isRetroactive && (
          <p className="rounded-xl px-4 py-3 bg-violet-50 border border-violet-100 text-violet-800">
            Welcome back — we've improved trainee onboarding. Takes 2 minutes.
          </p>
        )}
        <p>
          Miwa is where you think, draft, and build supervision agendas. Bring real
          client info — notes you'd jot down, the way you'd describe a case to your
          supervisor, what's working and what isn't.
        </p>
        <p>
          Your agency's EHR is still the official record. Miwa sits between you and
          your work: clinical reasoning, draft notes, supervision prep, hours
          tracking, and the messy middle of being a trainee.
        </p>
      </div>

      <label className="mt-6 flex items-start gap-3 text-sm text-gray-800 cursor-pointer">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-1 w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-400"
        />
        <span>
          I understand Miwa is between me and my placement site, and I'll use it
          within my program's and site's policies.
        </span>
      </label>

      <div className="mt-7 flex items-center justify-between gap-3">
        <TraineeButton variant="ghost" size="md" onClick={() => skipStep(1)} disabled={saving}>
          Skip — I'll set up later
        </TraineeButton>
        <TraineeButton
          variant="primary"
          size="md"
          loading={saving}
          disabled={!acknowledged || saving}
          onClick={() => saveStep(1, { acknowledged: true })}
        >
          Next
        </TraineeButton>
      </div>
    </TraineeCard>
  )
}

function Step2School({ state, saving, saveStep, skipStep }) {
  const initialEmail = state?.data?.school_email || ''
  const initialProgram = state?.data?.training_program || ''
  const initialYear = state?.data?.expected_graduation_year || ''
  const verified = !!state?.data?.school_email_verified
  const [schoolEmail, setSchoolEmail] = useState(initialEmail)
  const [program, setProgram] = useState(
    PROGRAM_OPTIONS.includes(initialProgram) ? initialProgram : (initialProgram ? 'Other' : ''),
  )
  const [otherProgram, setOtherProgram] = useState(
    PROGRAM_OPTIONS.includes(initialProgram) ? '' : initialProgram || '',
  )
  const [year, setYear] = useState(initialYear ? String(initialYear) : '')
  const [verifyState, setVerifyState] = useState('idle') // idle | sending | sent | error
  const [verifyMsg, setVerifyMsg] = useState('')
  const emailChanged = schoolEmail.trim().toLowerCase() !== initialEmail.trim().toLowerCase()

  async function sendVerification() {
    setVerifyState('sending')
    setVerifyMsg('')
    try {
      const res = await apiFetch('/onboarding/school-email/verify-send', {
        method: 'POST',
        body: JSON.stringify({ email: schoolEmail.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not send verification email.')
      setVerifyState('sent')
      setVerifyMsg(`We sent a verification link to ${data.sent_to}.`)
    } catch (err) {
      setVerifyState('error')
      setVerifyMsg(err.message)
    }
  }

  async function handleNext() {
    const resolvedProgram = program === 'Other' ? otherProgram.trim() : program
    const payload = {
      school_email: schoolEmail.trim() || undefined,
      training_program: resolvedProgram || null,
      expected_graduation_year: year ? Number(year) : null,
    }
    await saveStep(2, payload)
  }

  const years = useMemo(() => {
    const y = currentYear()
    return Array.from({ length: 6 }, (_, i) => y + i)
  }, [])

  return (
    <TraineeCard
      title="Tell us about your training"
      subtitle="So Miwa can match how your program and BBS hours are tracked."
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="school-email" className="block text-sm font-semibold text-gray-800 mb-1.5">
            School email
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="school-email"
              type="email"
              className="flex-1 rounded-xl px-3.5 py-2.5 text-sm bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400"
              placeholder="you@university.edu"
              value={schoolEmail}
              onChange={(e) => setSchoolEmail(e.target.value)}
            />
            <TraineeButton
              variant="secondary"
              size="md"
              loading={verifyState === 'sending'}
              disabled={!schoolEmail.trim() || verifyState === 'sending'}
              onClick={sendVerification}
            >
              {verified && !emailChanged ? 'Resend verification' : 'Send verification'}
            </TraineeButton>
          </div>
          {verifyState === 'sent' && (
            <p className="mt-2 text-xs text-emerald-700">{verifyMsg}</p>
          )}
          {verifyState === 'error' && (
            <p className="mt-2 text-xs text-red-700">{verifyMsg}</p>
          )}
          {verified && !emailChanged && verifyState !== 'sent' && (
            <p className="mt-2 text-xs text-emerald-700">School email verified.</p>
          )}
        </div>

        <div>
          <label htmlFor="program" className="block text-sm font-semibold text-gray-800 mb-1.5">
            School or program
          </label>
          <select
            id="program"
            className="w-full rounded-xl px-3.5 py-2.5 text-sm bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400"
            value={program}
            onChange={(e) => setProgram(e.target.value)}
          >
            <option value="">Select your program…</option>
            {PROGRAM_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          {program === 'Other' && (
            <input
              type="text"
              className="mt-2 w-full rounded-xl px-3.5 py-2.5 text-sm bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400"
              placeholder="Your program name"
              value={otherProgram}
              onChange={(e) => setOtherProgram(e.target.value)}
            />
          )}
        </div>

        <div>
          <label htmlFor="grad-year" className="block text-sm font-semibold text-gray-800 mb-1.5">
            Expected graduation year
          </label>
          <select
            id="grad-year"
            className="w-full rounded-xl px-3.5 py-2.5 text-sm bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            <option value="">Select…</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-7 flex items-center justify-between gap-3">
        <TraineeButton variant="ghost" size="md" onClick={() => skipStep(2)} disabled={saving}>
          Skip for now
        </TraineeButton>
        <TraineeButton variant="primary" size="md" loading={saving} onClick={handleNext} disabled={saving}>
          Next
        </TraineeButton>
      </div>
    </TraineeCard>
  )
}

function Step3Hours({ state, saving, saveStep, skipStep }) {
  // Defaults: if the trainee already has a training_program set, both ladders
  // are on. Without one, just BBS (since every CA trainee logs supervised
  // experience whether or not they're in a degree program).
  const hasProgram = !!state?.data?.training_program
  const [trackSchool, setTrackSchool] = useState(hasProgram)
  const [trackBbs, setTrackBbs] = useState(true)

  async function handleNext() {
    await saveStep(3, { track_school: trackSchool, track_bbs: trackBbs })
  }

  return (
    <TraineeCard
      title="Hours tracking"
      subtitle="Most CA trainees log two ladders at once — your school degree hours and your BBS supervised experience. Miwa keeps them separate so neither set gets miscounted."
    >
      <div className="space-y-3 text-sm text-gray-700">
        <p>
          Most sessions count toward both. Some only count for one (e.g. paperwork
          time for BBS, group hours capped at school). Miwa applies the right rules
          per ladder so you don't have to remember every cap.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <label className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 px-4 py-3 cursor-pointer hover:bg-gray-50">
          <div>
            <div className="text-sm font-semibold text-gray-900">Track school hours</div>
            <p className="text-xs text-gray-500 mt-0.5">Practicum / fieldwork hours your program requires.</p>
          </div>
          <input
            type="checkbox"
            checked={trackSchool}
            onChange={(e) => setTrackSchool(e.target.checked)}
            className="w-5 h-5 rounded border-gray-300 text-violet-600 focus:ring-violet-400"
          />
        </label>
        <label className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 px-4 py-3 cursor-pointer hover:bg-gray-50">
          <div>
            <div className="text-sm font-semibold text-gray-900">Track BBS hours</div>
            <p className="text-xs text-gray-500 mt-0.5">Supervised experience hours toward your CA license.</p>
          </div>
          <input
            type="checkbox"
            checked={trackBbs}
            onChange={(e) => setTrackBbs(e.target.checked)}
            className="w-5 h-5 rounded border-gray-300 text-violet-600 focus:ring-violet-400"
          />
        </label>
      </div>

      <p className="mt-5 text-xs text-gray-500">
        You can change either of these later in Settings.
      </p>

      <div className="mt-7 flex items-center justify-between gap-3">
        <TraineeButton variant="ghost" size="md" onClick={() => skipStep(3)} disabled={saving}>
          Skip for now
        </TraineeButton>
        <TraineeButton variant="primary" size="md" loading={saving} onClick={handleNext} disabled={saving}>
          Next
        </TraineeButton>
      </div>
    </TraineeCard>
  )
}

function Step4Supervisor({ state, saving, saveStep, skipStep }) {
  const site = state?.data?.supervisors?.find((s) => s.role === 'site') || {}
  const school = state?.data?.supervisors?.find((s) => s.role === 'school') || {}
  const [siteName, setSiteName] = useState(site.name || '')
  const [siteEmail, setSiteEmail] = useState(site.email || '')
  const [placement, setPlacement] = useState(site.site_name || '')
  const [hasSchoolSup, setHasSchoolSup] = useState(!!(school.name || school.email))
  const [schoolName, setSchoolName] = useState(school.name || '')
  const [schoolEmail, setSchoolEmail] = useState(school.email || '')

  async function handleNext() {
    const payload = {
      site: { name: siteName, email: siteEmail, site_name: placement },
    }
    if (hasSchoolSup) {
      payload.school = { name: schoolName, email: schoolEmail }
    }
    await saveStep(4, payload)
  }

  const inputCls =
    'w-full rounded-xl px-3.5 py-2.5 text-sm bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400'
  const labelCls = 'block text-sm font-semibold text-gray-800 mb-1.5'

  return (
    <TraineeCard
      title="Your human supervisor"
      subtitle="So you have it on file in Miwa. We won't contact your supervisor — supervisor accounts are coming later."
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="site-sup-name">Site supervisor name</label>
            <input id="site-sup-name" className={inputCls} value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="e.g. Dr. Anita Rivera" />
          </div>
          <div>
            <label className={labelCls} htmlFor="site-sup-email">Site supervisor email</label>
            <input id="site-sup-email" type="email" className={inputCls} value={siteEmail} onChange={(e) => setSiteEmail(e.target.value)} placeholder="supervisor@agency.org" />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="placement-site">Placement site name</label>
          <input id="placement-site" className={inputCls} value={placement} onChange={(e) => setPlacement(e.target.value)} placeholder="e.g. Wellness Clinic of Pasadena" />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer pt-2">
          <input
            type="checkbox"
            checked={hasSchoolSup}
            onChange={(e) => setHasSchoolSup(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-400"
          />
          I also have a school supervisor
        </label>

        {hasSchoolSup && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="school-sup-name">School supervisor name</label>
              <input id="school-sup-name" className={inputCls} value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="e.g. Prof. James Lin" />
            </div>
            <div>
              <label className={labelCls} htmlFor="school-sup-email">School supervisor email</label>
              <input id="school-sup-email" type="email" className={inputCls} value={schoolEmail} onChange={(e) => setSchoolEmail(e.target.value)} placeholder="supervisor@university.edu" />
            </div>
          </div>
        )}

        <p className="text-xs text-gray-500 leading-relaxed">
          We won't contact your supervisor — this is for your own reference.
          Supervisor accounts are coming later.
        </p>
      </div>

      <div className="mt-7 flex items-center justify-between gap-3">
        <TraineeButton variant="ghost" size="md" onClick={() => skipStep(4)} disabled={saving}>
          Skip for now
        </TraineeButton>
        <TraineeButton variant="primary" size="md" loading={saving} onClick={handleNext} disabled={saving}>
          Next
        </TraineeButton>
      </div>
    </TraineeCard>
  )
}

function Step5FirstCase({ saving, saveStep, completeWizard }) {
  const [mode, setMode] = useState(null) // null | 'real' | 'sample' | 'pending'
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [form, setForm] = useState({
    display_name: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    notes: '',
    presenting_concerns: '',
  })

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  async function handleAddReal(e) {
    e?.preventDefault?.()
    setSubmitError('')
    setBusy(true)
    try {
      const display = form.display_name.trim() || `${form.first_name} ${form.last_name}`.trim() || 'New client'
      const res = await apiFetch('/patients', {
        method: 'POST',
        body: JSON.stringify({
          display_name: display,
          first_name: form.first_name.trim() || null,
          last_name: form.last_name.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          notes: form.notes.trim() || null,
          presenting_concerns: form.presenting_concerns.trim() || null,
          client_type: 'individual',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create the case.')
      await saveStep(5, { created_patient_id: data.id })
      await completeWizard()
    } catch (err) {
      setSubmitError(err.message)
      setBusy(false)
    }
  }

  async function handleSample() {
    setBusy(true)
    setSubmitError('')
    try {
      const res = await apiFetch('/onboarding/sample-case', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create the sample case.')
      await saveStep(5, { used_sample: true })
      await completeWizard()
    } catch (err) {
      setSubmitError(err.message)
      setBusy(false)
    }
  }

  async function handleSkip() {
    setBusy(true)
    setSubmitError('')
    try {
      await saveStep(5, {})
      await completeWizard()
    } catch (err) {
      setSubmitError(err.message)
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-xl px-3.5 py-2.5 text-sm bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400'
  const labelCls = 'block text-sm font-semibold text-gray-800 mb-1.5'

  if (mode === 'real') {
    return (
      <TraineeCard
        title="Add a real case"
        subtitle="Name + a couple of notes are enough. You can fill the rest in later from the Cases page."
      >
        <form onSubmit={handleAddReal} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="case-display-name">Preferred name or initials</label>
              <input
                id="case-display-name"
                className={inputCls}
                placeholder="e.g. Ryan T. or R.T."
                value={form.display_name}
                onChange={(e) => set('display_name', e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls} htmlFor="case-first-name">First</label>
                <input id="case-first-name" className={inputCls} value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
              </div>
              <div>
                <label className={labelCls} htmlFor="case-last-name">Last</label>
                <input id="case-last-name" className={inputCls} value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="case-email">Email <span className="text-xs font-normal text-gray-400">(your reference)</span></label>
              <input id="case-email" type="email" className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <label className={labelCls} htmlFor="case-phone">Phone <span className="text-xs font-normal text-gray-400">(your reference)</span></label>
              <input id="case-phone" className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="case-concerns">Presenting concerns</label>
            <textarea id="case-concerns" rows={2} className={inputCls} value={form.presenting_concerns} onChange={(e) => set('presenting_concerns', e.target.value)} />
          </div>

          <div>
            <label className={labelCls} htmlFor="case-notes">Notes</label>
            <textarea id="case-notes" rows={3} className={inputCls} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>

          {submitError && (
            <div className="rounded-xl px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200">{submitError}</div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <TraineeButton variant="ghost" size="md" onClick={() => setMode(null)} disabled={busy}>
              Back
            </TraineeButton>
            <TraineeButton variant="primary" size="md" type="submit" loading={busy || saving} disabled={busy || saving}>
              Add case and finish
            </TraineeButton>
          </div>
        </form>
      </TraineeCard>
    )
  }

  return (
    <TraineeCard
      title="Add a case to start"
      subtitle="Miwa works best when you have a real case to think through. You can add a real client now, explore with a sample, or come back later."
    >
      <div className="grid gap-3">
        <button
          type="button"
          onClick={() => setMode('real')}
          className="w-full text-left rounded-xl border border-gray-200 px-5 py-4 hover:border-violet-300 hover:bg-violet-50/40 transition-colors"
          disabled={busy}
        >
          <div className="text-sm font-bold text-gray-900">Add a real case</div>
          <p className="text-xs text-gray-500 mt-0.5">A client you're actively seeing. Quick form, you can fill the rest in later.</p>
        </button>
        <button
          type="button"
          onClick={handleSample}
          disabled={busy || saving}
          className="w-full text-left rounded-xl border border-gray-200 px-5 py-4 hover:border-violet-300 hover:bg-violet-50/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <div className="text-sm font-bold text-gray-900">Use a sample case</div>
          <p className="text-xs text-gray-500 mt-0.5">A fictional client (M.G., GAD, two prior sessions) so you can poke around the app.</p>
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={busy || saving}
          className="w-full text-left rounded-xl border border-gray-200 px-5 py-4 hover:border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <div className="text-sm font-bold text-gray-900">Skip — I'll add a case later</div>
          <p className="text-xs text-gray-500 mt-0.5">Go straight to the dashboard. You can add a case anytime.</p>
        </button>
      </div>

      {submitError && (
        <div className="mt-4 rounded-xl px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200">{submitError}</div>
      )}

      {(busy || saving) && (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
          <span className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          Working…
        </div>
      )}
    </TraineeCard>
  )
}

const SCREENS = {
  1: Step1Welcome,
  2: Step2School,
  3: Step3Hours,
  4: Step4Supervisor,
  5: Step5FirstCase,
}
