import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { isTraineeCredential, needsWorkspaceModeOnboarding } from '../lib/workspaceMode'

const EHR_OPTIONS = ['Exym', 'Welligent', 'Credible', 'SimplePractice', 'TherapyNotes', 'Other']
const PROGRAM_OPTIONS = [
  ['dual_csun_bbs_lmft', 'School degree + CA BBS LMFT'],
  ['csun_mft', 'CSUN MFT Practicum'],
  ['ca_bbs_lmft', 'CA BBS LMFT Associate'],
  ['other', 'Other / future'],
]
const NOTE_FORMAT_OPTIONS = [
  ['SOAP', 'SOAP'],
  ['DAP', 'DAP'],
  ['BIRP', 'BIRP'],
  ['GIRP', 'GIRP'],
  ['narrative', 'Narrative'],
  ['concise_agency_style', 'Concise agency style'],
  ['custom', 'Custom copy/paste format'],
]

export default function WorkspaceModeOnboarding() {
  const { therapist, refreshTherapist } = useAuth()
  const canUseAgencyCompanion = isTraineeCredential(therapist)
  const [mode, setMode] = useState(
    canUseAgencyCompanion ? 'agency_companion' : 'private_practice'
  )
  const [agencyName, setAgencyName] = useState('')
  const [ehrName, setEhrName] = useState('Exym')
  const [trainingProgram, setTrainingProgram] = useState(
    therapist?.credential_type === 'associate' ? 'ca_bbs_lmft' : 'dual_csun_bbs_lmft'
  )
  const [sitePolicyStatus, setSitePolicyStatus] = useState('not_sure')
  const [noteFormat, setNoteFormat] = useState('SOAP')
  const [customFormat, setCustomFormat] = useState('')
  const [sitePolicyAck, setSitePolicyAck] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!needsWorkspaceModeOnboarding(therapist)) return null

  const agencyMode = canUseAgencyCompanion && mode === 'agency_companion'

  async function handleContinue() {
    setSaving(true)
    setError('')
    try {
      const payload = {
        workspace_mode: agencyMode ? 'agency_companion' : 'private_practice',
        client_record_mode: agencyMode ? 'agency_ehr_companion' : 'miwa_system_of_record',
        agency_name: agencyMode ? agencyName.trim() || null : null,
        agency_ehr_name: agencyMode ? ehrName : null,
        site_policy_status: agencyMode ? sitePolicyStatus : null,
        agency_ehr_note_format: agencyMode ? noteFormat : null,
        agency_ehr_custom_format: agencyMode && noteFormat === 'custom' ? customFormat.trim() || null : null,
        training_program: agencyMode ? trainingProgram : null,
        site_policy_acknowledged: agencyMode ? sitePolicyAck || sitePolicyStatus === 'allows_phi' : false,
      }
      const res = await apiFetch('/auth/me', {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save workspace mode')
      refreshTherapist(data.therapist, data.token)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-white/20">
        <div className="p-6 md:p-7 border-b border-gray-100">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Set up your workspace</p>
          <h1 className="mt-2 text-2xl font-bold text-gray-950">What are you using Miwa for right now?</h1>
          <p className="mt-2 text-sm text-gray-600">
            Miwa can be your private-practice system, or the HIPAA-ready clinical workspace you use alongside a required agency EHR.
          </p>
        </div>

        <div className="p-6 md:p-7 space-y-5">
          <div className="grid md:grid-cols-2 gap-3">
            {canUseAgencyCompanion && (
              <button
                type="button"
                onClick={() => setMode('agency_companion')}
                className={`text-left rounded-2xl border p-4 transition-colors ${
                  agencyMode ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-brand-200 hover:bg-gray-50'
                }`}
              >
                <div className="text-sm font-bold text-gray-950">Agency / internship companion</div>
                <p className="mt-1 text-xs leading-relaxed text-gray-600">
                  For trainees or associates using Miwa alongside Exym, Welligent, Credible, SimplePractice, TherapyNotes, or another required EHR.
                </p>
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode('private_practice')}
              className={`text-left rounded-2xl border p-4 transition-colors ${
                !agencyMode ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-brand-200 hover:bg-gray-50'
              }`}
            >
              <div className="text-sm font-bold text-gray-950">My private practice</div>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">
                For clinicians using Miwa as their main client chart, documentation, scheduling, billing, and client portal system.
              </p>
            </button>
          </div>

          {agencyMode && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-4">
              <div>
                <p className="text-sm font-bold text-amber-950">Agency companion setup</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                  Miwa is HIPAA-ready. Your ability to enter agency client PHI depends on your site's policies and authorization.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-amber-900">Site / agency name</span>
                  <input
                    className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:ring-brand-200"
                    value={agencyName}
                    onChange={e => setAgencyName(e.target.value)}
                    placeholder="e.g. community clinic"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-amber-900">Required EHR</span>
                  <select
                    className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:ring-brand-200"
                    value={ehrName}
                    onChange={e => setEhrName(e.target.value)}
                  >
                    {EHR_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className="text-xs font-semibold text-amber-900">Hours frameworks</span>
                  <select
                    className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:ring-brand-200"
                    value={trainingProgram}
                    onChange={e => setTrainingProgram(e.target.value)}
                  >
                    {PROGRAM_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                {trainingProgram === 'dual_csun_bbs_lmft' && (
                  <div className="md:col-span-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs leading-relaxed text-amber-900">
                    School/practicum hours will also populate CA BBS LMFT tracking by default. You can mark a specific entry as school-only when it should not count toward BBS.
                  </div>
                )}
                <label className="block">
                  <span className="text-xs font-semibold text-amber-900">Site policy for PHI in Miwa</span>
                  <select
                    className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:ring-brand-200"
                    value={sitePolicyStatus}
                    onChange={e => setSitePolicyStatus(e.target.value)}
                  >
                    <option value="allows_phi">My site allows PHI in Miwa</option>
                    <option value="no_phi_outside_tools">My site does not allow PHI in outside tools</option>
                    <option value="not_sure">I'm not sure yet</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-amber-900">Agency note output</span>
                  <select
                    className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:ring-brand-200"
                    value={noteFormat}
                    onChange={e => setNoteFormat(e.target.value)}
                  >
                    {NOTE_FORMAT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                {noteFormat === 'custom' && (
                  <label className="block md:col-span-2">
                    <span className="text-xs font-semibold text-amber-900">Custom copy/paste format</span>
                    <textarea
                      className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:ring-brand-200"
                      rows={3}
                      value={customFormat}
                      onChange={e => setCustomFormat(e.target.value)}
                      placeholder="Example: keep sections in agency-required order, concise MSE, risk statement before plan..."
                    />
                  </label>
                )}
              </div>

              {sitePolicyStatus !== 'allows_phi' && (
                <div className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs leading-relaxed text-amber-900">
                  Until your site confirms PHI use, Miwa will nudge you toward minimum-necessary or de-identified case details.
                </div>
              )}

              <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-white p-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-amber-300 text-brand-600 focus:ring-brand-500"
                  checked={sitePolicyAck}
                  onChange={e => setSitePolicyAck(e.target.checked)}
                />
                <span className="text-xs leading-relaxed text-amber-900">
                  I understand I should only enter agency client PHI if my site allows Miwa alongside the official EHR, and I will use minimum necessary details where appropriate.
                </span>
              </label>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleContinue}
              disabled={saving}
              className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
