/**
 * MobileSettings -- streamlined mobile settings page.
 * Shows only the most important settings; links to desktop for the rest.
 * Route: /m/settings
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { apiFetch } from '../../lib/api'

/* ── Constants ──────────────────────────────────────────────────── */

const ACTION_MODES = [
  { id: 'read_only',       label: 'Read-only',       desc: 'Analyze and explain only' },
  { id: 'draft_only',      label: 'Draft-only',      desc: 'Draft and suggest, do not act' },
  { id: 'approve_to_act',  label: 'Approve-to-act',  desc: 'Prepare actions for your approval' },
]

const ORIENTATIONS = [
  { id: 'integrative',     label: 'Integrative' },
  { id: 'family-systems',  label: 'Family Systems' },
  { id: 'cbt',             label: 'CBT' },
  { id: 'trauma-informed', label: 'Trauma-Informed' },
  { id: 'psychodynamic',   label: 'Psychodynamic' },
]

const VERBOSITY = [
  { id: 'concise',   label: 'Concise' },
  { id: 'balanced',  label: 'Balanced' },
  { id: 'detailed',  label: 'Detailed' },
]

const OUTREACH_LABELS = {
  appointment_reminder:    { icon: '\uD83D\uDD14', label: 'Appointment Reminders',    desc: 'Send reminders before sessions' },
  missed_session_checkin:  { icon: '\uD83D\uDCAC', label: 'Missed Session Check-in',  desc: 'Reach out after a no-show' },
  assessment_overdue:      { icon: '\uD83D\uDCCB', label: 'Overdue Assessment Send',  desc: 'Auto-send overdue assessments' },
  stalled_case:            { icon: '\u26A0\uFE0F', label: 'Stalled Case Alerts',      desc: 'Flag clients with no recent sessions' },
}

/* ── Main Component ─────────────────────────────────────────────── */

export default function MobileSettings() {
  const { therapist, refreshTherapist, logout } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedKey, setSavedKey] = useState('')
  const [error, setError] = useState('')

  // Copilot preferences
  const [actionMode, setActionMode] = useState('draft_only')
  const [orientation, setOrientation] = useState('integrative')
  const [verbosity, setVerbosity] = useState('balanced')

  // Outreach rules
  const [outreachRules, setOutreachRules] = useState([])
  const [togglingRule, setTogglingRule] = useState('')

  /* ── Load settings ──────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    Promise.allSettled([
      apiFetch('/settings').then(r => r.ok ? r.json() : {}),
      apiFetch('/ai/outreach-rules').then(r => r.ok ? r.json() : []),
    ]).then(([settingsRes, rulesRes]) => {
      if (cancelled) return
      const s = settingsRes.value || {}
      setActionMode(s.assistant_action_mode || therapist?.assistant_action_mode || 'draft_only')
      setOrientation(s.assistant_orientation || therapist?.assistant_orientation || 'integrative')
      setVerbosity(s.assistant_verbosity || therapist?.assistant_verbosity || 'balanced')
      const rules = rulesRes.value
      if (Array.isArray(rules)) setOutreachRules(rules)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [therapist])

  /* ── Save copilot prefs ─────────────────────────────────────── */
  const saveCopilotPrefs = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/auth/me', {
        method: 'PUT',
        body: JSON.stringify({
          assistant_action_mode: actionMode,
          assistant_orientation: orientation,
          assistant_verbosity: verbosity,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      refreshTherapist(data.therapist, data.token)
      setSavedKey('copilot')
      setTimeout(() => setSavedKey(''), 2500)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  /* ── Toggle outreach rule ───────────────────────────────────── */
  const toggleRule = async (ruleId, enabled) => {
    setTogglingRule(ruleId)
    try {
      await apiFetch(`/ai/outreach-rules/${ruleId}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      })
      setOutreachRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled } : r))
    } catch {}
    setTogglingRule('')
  }

  /* ── Sign out ───────────────────────────────────────────────── */
  const handleSignOut = () => {
    if (logout) logout()
    else {
      try { localStorage.removeItem('miwa_token') } catch {}
      window.location.href = '/login'
    }
  }

  /* ── Render ─────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const fullName = therapist?.full_name || therapist?.display_name || ''
  const email = therapist?.email || ''

  return (
    <div className="pb-24">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100">
        <div className="flex items-center justify-between px-4 h-14">
          <button
            onClick={() => navigate('/m/more')}
            className="flex items-center gap-1 text-indigo-600 active:text-indigo-800 -ml-1 min-w-[44px] min-h-[44px] justify-center"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-base font-bold text-gray-900">Settings</h1>
          <div className="w-11" />
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

      <div className="px-4 pt-4 space-y-5">

        {/* ── Profile Section ────────────────────────────────────── */}
        <Section title="Profile">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-lg font-bold text-indigo-700 shrink-0">
                {fullName ? fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{fullName || 'Therapist'}</p>
                <p className="text-xs text-gray-500 truncate">{email}</p>
              </div>
              <button
                onClick={() => navigate('/settings')}
                className="text-xs font-semibold text-indigo-600 active:text-indigo-800 min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                Edit
              </button>
            </div>
          </div>
        </Section>

        {/* ── Miwa Copilot Section ───────────────────────────────── */}
        <Section title="Miwa Copilot">
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            {/* Action Mode */}
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Action Mode</p>
              <div className="space-y-1.5">
                {ACTION_MODES.map(mode => (
                  <button
                    key={mode.id}
                    onClick={() => setActionMode(mode.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors min-h-[44px] ${
                      actionMode === mode.id
                        ? 'bg-indigo-50 border border-indigo-200'
                        : 'active:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        actionMode === mode.id ? 'border-indigo-600' : 'border-gray-300'
                      }`}>
                        {actionMode === mode.id && <div className="w-2 h-2 rounded-full bg-indigo-600" />}
                      </div>
                      <div>
                        <span className="text-sm font-medium text-gray-900">{mode.label}</span>
                        <p className="text-xs text-gray-500">{mode.desc}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Orientation */}
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Orientation</p>
              <div className="flex gap-2 flex-wrap">
                {ORIENTATIONS.map(o => (
                  <button
                    key={o.id}
                    onClick={() => setOrientation(o.id)}
                    className={`px-3 py-2 rounded-full text-xs font-bold min-h-[44px] transition-colors ${
                      orientation === o.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-500 active:bg-gray-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Verbosity */}
            <div className="px-4 py-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Verbosity</p>
              <div className="flex gap-2">
                {VERBOSITY.map(v => (
                  <button
                    key={v.id}
                    onClick={() => setVerbosity(v.id)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold min-h-[44px] transition-colors ${
                      verbosity === v.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-500 active:bg-gray-200'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Save button */}
          <button
            onClick={saveCopilotPrefs}
            disabled={saving}
            className="w-full mt-3 h-12 rounded-xl bg-indigo-600 text-white text-sm font-bold active:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {savedKey === 'copilot' ? 'Saved' : 'Save Copilot Preferences'}
          </button>
        </Section>

        {/* ── Proactive Outreach Section ──────────────────────────── */}
        {outreachRules.length > 0 && (
          <Section title="Proactive Outreach">
            <div className="space-y-2">
              {outreachRules.map(rule => {
                const meta = OUTREACH_LABELS[rule.rule_type] || { icon: '\uD83D\uDCCC', label: rule.rule_type, desc: '' }
                return (
                  <div key={rule.id} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-lg shrink-0">{meta.icon}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{meta.label}</p>
                          <p className="text-xs text-gray-500 truncate">{meta.desc}</p>
                        </div>
                      </div>
                      <ToggleSwitch
                        enabled={rule.enabled}
                        loading={togglingRule === rule.id}
                        onChange={val => toggleRule(rule.id, val)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* ── Account Section ────────────────────────────────────── */}
        <Section title="Account">
          <button
            onClick={handleSignOut}
            className="w-full h-12 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-bold active:bg-red-100 transition-colors"
          >
            Sign Out
          </button>
        </Section>

        {/* ── More settings link ─────────────────────────────────── */}
        <button
          onClick={() => navigate('/settings')}
          className="w-full py-3 text-sm font-medium text-indigo-600 active:text-indigo-800 transition-colors"
        >
          More settings &rarr;
        </button>
      </div>

      {/* ── Safe area padding ────────────────────────────────────── */}
      <div className="h-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
    </div>
  )
}

/* ── Section ────────────────────────────────────────────────────── */

function Section({ title, children }) {
  return (
    <div>
      <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 px-1">{title}</h2>
      {children}
    </div>
  )
}

/* ── Toggle Switch ──────────────────────────────────────────────── */

function ToggleSwitch({ enabled, loading, onChange }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      disabled={loading}
      className={`relative w-12 h-7 rounded-full transition-colors shrink-0 min-w-[48px] min-h-[44px] flex items-center ${
        enabled ? 'bg-emerald-500' : 'bg-gray-300'
      } ${loading ? 'opacity-50' : ''}`}
      style={{ padding: '8.5px 0' }}
    >
      <div
        className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}
