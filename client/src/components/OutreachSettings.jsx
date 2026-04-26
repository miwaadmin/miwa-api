import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

const RULE_LABELS = {
  appointment_reminder: { icon: '🔔', label: 'Appointment Reminders', desc: 'Send reminders before scheduled sessions' },
  missed_session_checkin: { icon: '💬', label: 'Missed Session Check-in', desc: 'Reach out after a no-show' },
  assessment_overdue: { icon: '📋', label: 'Overdue Assessment Auto-Send', desc: 'Auto-send assessments when overdue' },
  stalled_case: { icon: '⚠️', label: 'Stalled Case Alerts', desc: 'Flag clients with no recent sessions' },
}

export default function OutreachSettings() {
  const [rules, setRules] = useState([])
  const [log, setLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [showLog, setShowLog] = useState(false)
  const [saving, setSaving] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [rulesRes, logRes] = await Promise.all([
        apiFetch('/ai/outreach-rules').catch(() => ({ ok: false })),
        apiFetch('/ai/outreach-log?limit=20').catch(() => ({ ok: false })),
      ])

      // Fallback: if practice routes don't have these yet, try automations
      if (rulesRes.ok) {
        const data = await rulesRes.json()
        setRules(Array.isArray(data) ? data : [])
      }
      if (logRes.ok) {
        const data = await logRes.json()
        setLog(Array.isArray(data) ? data : [])
      }
    } catch {} finally {
      setLoading(false)
    }
  }

  async function toggleRule(ruleId, enabled) {
    setSaving(ruleId)
    try {
      await apiFetch(`/ai/outreach-rules/${ruleId}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      })
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled } : r))
    } catch {} finally {
      setSaving('')
    }
  }

  if (loading) return null

  return (
    <div className="card p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-gray-900">Proactive Outreach</h2>
          <p className="text-xs text-gray-500 mt-0.5">Miwa can automatically reach out to clients on your behalf. Configure what's automated.</p>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 text-center">
          <p className="text-sm text-gray-500">Outreach rules will appear here once configured. Miwa automatically creates default rules for your account.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => {
            const meta = RULE_LABELS[rule.rule_type] || { icon: '📌', label: rule.rule_type, desc: '' }
            return (
              <div key={rule.id} className="rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="text-lg">{meta.icon}</span>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">{meta.label}</span>
                        {rule.enabled ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>
                        ) : (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">Paused</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{meta.desc}</p>
                      {rule.actions_7d > 0 && (
                        <p className="text-xs text-teal-600 font-medium mt-1">{rule.actions_7d} actions this week</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleRule(rule.id, !rule.enabled)}
                    disabled={saving === rule.id}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                      rule.enabled ? 'bg-teal-500' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
                      rule.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Recent outreach log */}
      {log.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowLog(!showLog)}
            className="text-xs font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <svg className={`w-3.5 h-3.5 transition-transform ${showLog ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Recent outreach activity ({log.length})
          </button>
          {showLog && (
            <div className="mt-2 space-y-1.5">
              {log.slice(0, 10).map(entry => (
                <div key={entry.id} className="flex items-center gap-2 text-xs text-gray-500 py-1 px-2 rounded-lg bg-gray-50">
                  <span className="font-mono text-gray-400">{new Date(entry.created_at).toLocaleDateString()}</span>
                  <span className="font-medium text-gray-700">{entry.patient_name || 'Client'}</span>
                  <span>—</span>
                  <span>{entry.outreach_type}</span>
                  <span className={`ml-auto font-medium ${entry.status === 'sent' ? 'text-emerald-600' : 'text-gray-400'}`}>
                    {entry.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
