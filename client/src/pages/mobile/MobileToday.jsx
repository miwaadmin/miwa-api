/**
 * MobileToday — the mobile home screen.
 * Shows what matters RIGHT NOW: greeting, next session, today's schedule, alerts.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { apiFetch } from '../../lib/api'
import { renderClinical } from '../../lib/renderClinical'

function formatTime(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return '' }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  } catch { return '' }
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function isToday(dateStr) {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate()
}

function isWithinHours(dateStr, hours) {
  if (!dateStr) return false
  const d = new Date(dateStr).getTime()
  const now = Date.now()
  return d > now && d - now <= hours * 60 * 60 * 1000
}

export default function MobileToday() {
  const { therapist } = useAuth()
  const navigate = useNavigate()
  const [appointments, setAppointments] = useState([])
  const [brief, setBrief] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [briefExpanded, setBriefExpanded] = useState(false)
  const [checkingIn, setCheckingIn] = useState(null)

  const firstName = therapist?.full_name?.split(' ')[0] || 'there'

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [apptRes, briefRes, alertRes] = await Promise.allSettled([
        apiFetch('/agent/appointments'),
        apiFetch('/ai/briefs/upcoming'),
        apiFetch('/patients/alerts'),
      ])

      if (apptRes.status === 'fulfilled' && apptRes.value.ok) {
        const data = await apptRes.value.json()
        const today = (Array.isArray(data) ? data : []).filter(a => isToday(a.start_time || a.date))
        setAppointments(today)
      }

      if (briefRes.status === 'fulfilled' && briefRes.value.ok) {
        const data = await briefRes.value.json()
        setBrief(Array.isArray(data) ? data[0] || null : data || null)
      }

      if (alertRes.status === 'fulfilled' && alertRes.value.ok) {
        const data = await alertRes.value.json()
        setAlerts(
          (Array.isArray(data) ? data : [])
            .filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH')
            .slice(0, 3)
        )
      }
    } catch {}
    setLoading(false)
  }

  const handleCheckIn = async (appt, status) => {
    setCheckingIn(appt.id)
    try {
      await apiFetch(`/agent/appointments/${appt.id}/checkin`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      })
      await loadData()
    } catch {}
    setCheckingIn(null)
  }

  // Find next/current session (within 2 hours)
  const nextSession = appointments.find(a =>
    isWithinHours(a.start_time || a.date, 2) && a.status !== 'completed' && a.status !== 'cancelled'
  ) || appointments.find(a => a.status !== 'completed' && a.status !== 'cancelled')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="pb-6">
      {/* ── Greeting ──────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-3">
        <h1 className="text-xl font-bold text-gray-900">
          {getGreeting()}, {firstName}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">{formatDate(new Date().toISOString())}</p>
      </div>

      {/* ── Now / Next Session ────────────────────────────────────── */}
      {nextSession && (
        <div className="mx-4 mb-4 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
              <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                {isWithinHours(nextSession.start_time || nextSession.date, 0.5) ? 'Now' : 'Up Next'}
              </span>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  {nextSession.client_name || nextSession.patient_name || 'Client'}
                </h3>
                <p className="text-sm text-gray-500">
                  {formatTime(nextSession.start_time || nextSession.date)}
                  {nextSession.type && ` \u00b7 ${nextSession.type}`}
                </p>
              </div>
              {nextSession.checkin_status && (
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                  nextSession.checkin_status === 'on_time' ? 'bg-emerald-100 text-emerald-700' :
                  nextSession.checkin_status === 'late' ? 'bg-amber-100 text-amber-700' :
                  nextSession.checkin_status === 'no_show' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {nextSession.checkin_status === 'on_time' && '\u2713 On time'}
                  {nextSession.checkin_status === 'late' && '\u23f0 Late'}
                  {nextSession.checkin_status === 'no_show' && 'No-show'}
                  {!['on_time', 'late', 'no_show'].includes(nextSession.checkin_status) && nextSession.checkin_status}
                </span>
              )}
            </div>

            {!nextSession.checkin_status && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => handleCheckIn(nextSession, 'on_time')}
                  disabled={checkingIn === nextSession.id}
                  className="flex-1 h-11 rounded-xl bg-emerald-600 text-white text-sm font-semibold active:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  {checkingIn === nextSession.id ? 'Checking in...' : 'Check In'}
                </button>
                <button
                  onClick={() => handleCheckIn(nextSession, 'no_show')}
                  disabled={checkingIn === nextSession.id}
                  className="h-11 px-4 rounded-xl bg-red-50 text-red-600 text-sm font-semibold active:bg-red-100 transition-colors disabled:opacity-50"
                >
                  No-Show
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Pre-Session Brief ─────────────────────────────────────── */}
      {brief && (
        <div className="mx-4 mb-4 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <button
            onClick={() => setBriefExpanded(!briefExpanded)}
            className="w-full px-4 py-3 flex items-center justify-between active:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-sm font-semibold text-gray-900">Pre-Session Brief</span>
              {brief.risk_flags_count > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                  {brief.risk_flags_count} risk flag{brief.risk_flags_count !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${briefExpanded ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {!briefExpanded && brief.key_themes && (
            <div className="px-4 pb-3 -mt-1">
              <p className="text-xs text-gray-500 line-clamp-2">{brief.key_themes}</p>
            </div>
          )}

          {briefExpanded && (
            <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-2">
              {brief.key_themes && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-700 mb-1">Key Themes</h4>
                  <div className="prose-clinical text-xs text-gray-600"
                    dangerouslySetInnerHTML={{ __html: renderClinical(brief.key_themes) }} />
                </div>
              )}
              {brief.risk_flags && (
                <div>
                  <h4 className="text-xs font-semibold text-red-700 mb-1">Risk Flags</h4>
                  <div className="prose-clinical text-xs text-red-600"
                    dangerouslySetInnerHTML={{ __html: renderClinical(brief.risk_flags) }} />
                </div>
              )}
              {brief.suggested_focus && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-700 mb-1">Suggested Focus</h4>
                  <div className="prose-clinical text-xs text-gray-600"
                    dangerouslySetInnerHTML={{ __html: renderClinical(brief.suggested_focus) }} />
                </div>
              )}
              {(brief.summary || brief.content) && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-700 mb-1">Summary</h4>
                  <div className="prose-clinical text-xs text-gray-600"
                    dangerouslySetInnerHTML={{ __html: renderClinical(brief.summary || brief.content) }} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Today's Schedule ──────────────────────────────────────── */}
      <div className="mx-4 mb-4">
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-sm font-semibold text-gray-900">Today's Schedule</h2>
          <button
            type="button"
            onClick={() => navigate('/schedule?new=1')}
            className="flex items-center gap-1 text-xs font-semibold text-indigo-600 active:text-indigo-700 px-2 py-1 rounded-lg active:bg-indigo-50"
            aria-label="Schedule a new appointment"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Schedule
          </button>
        </div>
        {appointments.length === 0 ? (
          <button
            type="button"
            onClick={() => navigate('/schedule?new=1')}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-8 text-center active:bg-gray-50 transition-colors"
          >
            <svg className="w-8 h-8 text-gray-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 2v4m8-4v4M3 10h18M5 6h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
            </svg>
            <p className="text-sm text-gray-500">No appointments today</p>
            <p className="text-xs text-indigo-600 font-semibold mt-1">Tap to schedule one</p>
          </button>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden divide-y divide-gray-100">
            {appointments.map((appt, i) => (
              <div
                key={appt.id || i}
                className="flex items-center gap-3 px-4 py-3 active:bg-gray-50 transition-colors"
                onClick={() => appt.patient_id && navigate(`/patients/${appt.patient_id}`)}
              >
                <div className="text-center shrink-0 w-12">
                  <p className="text-sm font-semibold text-gray-900">{formatTime(appt.start_time || appt.date)}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {appt.client_name || appt.patient_name || 'Client'}
                  </p>
                  {appt.type && (
                    <p className="text-xs text-gray-500 truncate">{appt.type}</p>
                  )}
                </div>
                <StatusBadge status={appt.status || appt.checkin_status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Alerts ────────────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="mx-4 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-2 px-1">Alerts</h2>
          <div className="space-y-2">
            {alerts.map(alert => (
              <div
                key={alert.id}
                className={`rounded-xl border px-4 py-3 ${
                  alert.severity === 'CRITICAL' ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    alert.severity === 'CRITICAL' ? 'bg-red-200 text-red-800' : 'bg-orange-200 text-orange-800'
                  }`}>
                    {alert.severity}
                  </span>
                  {(alert.display_name || alert.client_id) && (
                    <span className="text-[10px] text-gray-500">{alert.display_name || alert.client_id}</span>
                  )}
                </div>
                <p className="text-sm font-medium text-gray-900">{alert.title}</p>
                {alert.description && (
                  <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{alert.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick actions ─────────────────────────────────────────── */}
      <div className="mx-4 mb-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => navigate('/m/record')}
            className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-gray-200 bg-white active:bg-gray-50 transition-colors"
          >
            <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            <span className="text-sm font-medium text-gray-900">Record</span>
          </button>
          <button
            onClick={() => navigate('/m/miwa')}
            className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-gray-200 bg-white active:bg-gray-50 transition-colors"
          >
            <div
              className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
            >
              M
            </div>
            <span className="text-sm font-medium text-gray-900">Ask Miwa</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  if (!status) return null
  const styles = {
    scheduled: 'bg-blue-100 text-blue-700',
    confirmed: 'bg-blue-100 text-blue-700',
    on_time: 'bg-emerald-100 text-emerald-700',
    checked_in: 'bg-emerald-100 text-emerald-700',
    late: 'bg-amber-100 text-amber-700',
    no_show: 'bg-red-100 text-red-700',
    completed: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-gray-100 text-gray-400',
  }
  const labels = {
    scheduled: 'Scheduled',
    confirmed: 'Confirmed',
    on_time: 'On time',
    checked_in: 'Checked in',
    late: 'Late',
    no_show: 'No-show',
    completed: 'Done',
    cancelled: 'Cancelled',
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
      {labels[status] || status}
    </span>
  )
}
// mobile build 1776096622
