/**
 * MobileSchedule, mobile-first schedule / day agenda.
 *
 * Built from scratch for phone screens, NOT a cramped version of the
 * desktop calendar grid. The desktop Schedule.jsx uses a week grid that
 * is unreadable under 500px; this replaces it with a stacked day view:
 *   - Sticky day picker at the top (yesterday · today · tomorrow · +week)
 *   - Vertical list of appointment cards, time + patient + type
 *   - FAB to create a new appointment
 *   - Empty state with a guiding next action
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { patientInitials } from '../../lib/avatar'

function fmtTime(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
  catch { return '' }
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function dateLabel(d) {
  const today = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (sameDay(d, today))     return 'Today'
  if (sameDay(d, tomorrow))  return 'Tomorrow'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long' })
}

function fullDate(d) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function typeTheme(type) {
  const t = (type || '').toLowerCase()
  if (t.includes('crisis'))  return { accent: '#ef4444', bg: '#fef2f2', border: '#fecaca', text: 'text-red-700' }
  if (t.includes('couple') || t.includes('family')) return { accent: '#ec4899', bg: '#fdf2f8', border: '#fbcfe8', text: 'text-pink-700' }
  if (t.includes('intake'))  return { accent: '#0ea5e9', bg: '#f0f9ff', border: '#bae6fd', text: 'text-sky-700' }
  return { accent: '#6047EE', bg: '#f5f3ff', border: '#e0d4fc', text: 'text-brand-700' }
}

function AppointmentCard({ appt, onOpen }) {
  const theme = typeTheme(appt.appointment_type)
  const name = appt.display_name || appt.client_id || 'Client'
  const initials = patientInitials(appt)
  const time = fmtTime(appt.scheduled_start)
  const typeLabel = (appt.appointment_type || 'session').replace(/_/g, ' ')
  const isCancelled = appt.status === 'cancelled'
  const isComplete = appt.status === 'completed'

  return (
    <button
      onClick={onOpen}
      className={`w-full text-left rounded-2xl p-4 flex items-center gap-3 active:scale-[0.99] transition-all ${
        isCancelled ? 'opacity-50' : ''
      }`}
      style={{ background: theme.bg, border: `1px solid ${theme.border}`, minHeight: 80 }}
    >
      <div className="flex-shrink-0 text-center min-w-[64px]">
        <div className={`font-mono font-bold text-base ${theme.text}`}>{time}</div>
        <div className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">
          {appt.duration_minutes || 50}m
        </div>
      </div>
      <div
        className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white"
        style={{ background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent}cc)` }}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
        <p className="text-[11px] text-gray-500 capitalize truncate mt-0.5">{typeLabel}</p>
        {isCancelled && <p className="text-[10px] text-red-600 font-bold uppercase tracking-wider mt-1">Cancelled</p>}
        {isComplete  && <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider mt-1">✓ Complete</p>}
      </div>
      <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}

export default function MobileSchedule() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState(() => new Date())
  const [appointments, setAppointments] = useState([])
  const [patients, setPatients] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [savingNew, setSavingNew] = useState(false)
  const [form, setForm] = useState(() => ({
    patientId: '',
    appointmentType: 'individual',
    startTime: '09:00',
    durationMinutes: 50,
    location: '',
    notes: '',
  }))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Day picker, 7 days centered on today
  const dayStrip = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today)
      d.setDate(today.getDate() + (i - 1)) // yesterday, today, +5
      return d
    })
  }, [])

  const load = useCallback(async (date) => {
    setLoading(true)
    setError('')
    try {
      const dateStr = ymd(date)
      const r = await apiFetch(`/patients/appointments?date=${dateStr}`)
      if (!r.ok) {
        // Fallback to no-filter endpoint then filter client-side
        const fallback = await apiFetch('/patients/appointments')
        const all = await fallback.json().catch(() => [])
        const list = Array.isArray(all) ? all : []
        setAppointments(list.filter(a => (a.scheduled_start || '').startsWith(dateStr)))
      } else {
        const data = await r.json()
        setAppointments(Array.isArray(data) ? data : (data?.appointments || []))
      }
    } catch (err) {
      setError(err.message)
      setAppointments([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(selected) }, [selected, load])

  useEffect(() => {
    apiFetch('/patients')
      .then(r => r.ok ? r.json() : [])
      .then(data => setPatients(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') {
      setShowNew(true)
    }
  }, [])

  const sorted = [...appointments].sort((a, b) => {
    const at = new Date(a.scheduled_start || 0).getTime()
    const bt = new Date(b.scheduled_start || 0).getTime()
    return at - bt
  })

  const openNewAppointment = () => {
    setForm(prev => ({ ...prev, patientId: patients[0]?.id ? String(patients[0].id) : prev.patientId }))
    setShowNew(true)
  }

  const closeNewAppointment = () => {
    setShowNew(false)
    if (new URLSearchParams(window.location.search).get('new') === '1') {
      window.history.replaceState(null, '', '/m/schedule')
    }
  }

  const saveAppointment = async (force = false) => {
    if (!form.patientId) {
      setError('Choose a client before scheduling an appointment.')
      return
    }
    setSavingNew(true)
    setError('')
    try {
      const [hh, mm] = form.startTime.split(':').map(Number)
      const start = new Date(selected)
      start.setHours(hh || 0, mm || 0, 0, 0)
      const end = new Date(start.getTime() + Number(form.durationMinutes || 50) * 60 * 1000)
      const res = await apiFetch('/agent/appointments', {
        method: 'POST',
        body: JSON.stringify({
          patientId: Number(form.patientId),
          appointmentType: form.appointmentType,
          scheduledStart: start.toISOString(),
          scheduledEnd: end.toISOString(),
          durationMinutes: Number(form.durationMinutes || 50),
          location: form.location || null,
          notes: form.notes || null,
          force,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && !force) {
        const proceed = window.confirm('This overlaps another appointment. Schedule it anyway?')
        if (proceed) return saveAppointment(true)
        return
      }
      if (!res.ok) throw new Error(data.error || 'Could not schedule appointment')
      closeNewAppointment()
      await load(selected)
    } catch (err) {
      setError(err.message || 'Could not schedule appointment')
    } finally {
      setSavingNew(false)
    }
  }

  return (
    <div className="mobile-native-page flex flex-col h-full">
      {/* Day picker (sticky) */}
      <div className="mobile-surface sticky top-0 z-20 border-b px-2 py-3">
        <div className="flex items-baseline justify-between px-2 mb-2">
          <h1 className="text-xl font-bold text-gray-900">{dateLabel(selected)}</h1>
          <p className="text-xs text-gray-500">{fullDate(selected)}</p>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 px-1">
          {dayStrip.map(d => {
            const active = sameDay(d, selected)
            return (
              <button
                key={d.toISOString()}
                onClick={() => setSelected(d)}
                className={`flex-shrink-0 flex flex-col items-center justify-center rounded-xl px-3 py-2 min-w-[56px] transition-all ${
                  active
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'mobile-muted-surface text-gray-700 active:bg-gray-100'
                }`}
              >
                <span className={`text-[10px] font-bold uppercase tracking-wider ${active ? 'text-white/80' : 'text-gray-500'}`}>
                  {d.toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
                <span className={`text-lg font-bold mt-0.5`}>{d.getDate()}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 pb-28">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-2xl bg-gray-50 border border-gray-100 animate-pulse p-4 flex items-center gap-3" style={{ minHeight: 80 }}>
                <div className="w-16 h-8 bg-gray-200 rounded" />
                <div className="w-11 h-11 rounded-full bg-gray-200" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                  <div className="h-2 bg-gray-200 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
            Couldn't load schedule. <button onClick={() => load(selected)} className="font-semibold underline ml-1">Retry</button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center pt-10">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v4m8-4v4M3 10h18M5 6h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
              </svg>
            </div>
            <p className="text-base font-semibold text-gray-900 mb-1">Nothing on the books.</p>
            <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
              {sameDay(selected, new Date())
                ? 'Good day to catch up on notes or reach out to clients.'
                : 'No appointments scheduled for this day.'}
            </p>
            <button
              onClick={openNewAppointment}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white active:bg-brand-700"
            >
              + Add appointment
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map(a => (
              <AppointmentCard
                key={a.id}
                appt={a}
                onOpen={() => navigate(`/m/clients/${a.patient_id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* FAB */}
      {sorted.length > 0 && (
        <button
          onClick={openNewAppointment}
          className="fixed right-4 z-30 w-14 h-14 rounded-full flex items-center justify-center shadow-xl active:scale-95 transition-transform"
          style={{
            bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
            background: 'linear-gradient(135deg, #6047EE, #2dd4bf)',
          }}
          aria-label="New appointment"
        >
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}

      {showNew && (
        <div className="mobile-modal-backdrop fixed inset-0 z-50 flex items-end bg-black/45">
          <div
            className="mobile-modal-sheet w-full max-h-[88dvh] overflow-y-auto rounded-t-3xl px-5 pt-4 shadow-2xl"
            style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))' }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">New appointment</h2>
              <button
                type="button"
                onClick={closeNewAppointment}
                className="h-10 w-10 rounded-full text-gray-500 active:bg-gray-100"
                aria-label="Close new appointment"
              >
                ×
              </button>
            </div>

            {error && (
              <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Client</span>
              <select
                value={form.patientId}
                onChange={e => setForm(f => ({ ...f, patientId: e.target.value }))}
                className="mobile-input"
              >
                <option value="">Select a client...</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>{p.display_name || p.client_id || `Client ${p.id}`}</option>
                ))}
              </select>
            </label>

            <div className="mb-3">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Session type</span>
              <div className="flex flex-wrap gap-2">
                {['individual', 'couple', 'family', 'group', 'phone', 'intake', 'crisis'].map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, appointmentType: type }))}
                    className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-semibold capitalize ${
                      form.appointmentType === type ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <label>
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Start</span>
                <input
                  type="time"
                  value={form.startTime}
                  onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                  className="mobile-input"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Duration</span>
                <select
                  value={form.durationMinutes}
                  onChange={e => setForm(f => ({ ...f, durationMinutes: Number(e.target.value) }))}
                  className="mobile-input"
                >
                  {[30, 45, 50, 60, 90].map(min => <option key={min} value={min}>{min}m</option>)}
                </select>
              </label>
            </div>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Location</span>
              <input
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="Office, telehealth, etc."
                className="mobile-input"
              />
            </label>

            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Notes</span>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Pre-session notes, reminders..."
                rows={3}
                className="mobile-input resize-none"
              />
            </label>

            <button
              type="button"
              onClick={() => saveAppointment(false)}
              disabled={savingNew}
              className="mobile-primary-button"
            >
              {savingNew ? 'Scheduling...' : 'Schedule appointment'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
