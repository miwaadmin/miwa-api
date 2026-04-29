/**
 * Schedule — Upheal-style clinical calendar.
 * Week grid + Month view · Mini-calendar sidebar · Absolute-positioned events.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'

// ─────────────────────────────────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────────────────────────────────
function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

function mkTheme(isDark) {
  return isDark ? {
    pageBg:        '#0d1117',
    sidebarBg:     'linear-gradient(180deg, #1a1035 0%, #150d2a 50%, #0d1a15 100%)',
    sidebarBorder: 'rgba(139,92,246,0.3)',
    surface:       '#161b27',
    surfaceFaint:  '#111827',
    border:        '#2d3748',
    borderIndigo:  'rgba(139,92,246,0.2)',
    text:          '#f1f5f9',
    textSub:       '#a0aec0',
    textFaint:     '#718096',
    todayHeader:   'linear-gradient(180deg, #2d2060 0%, #1e1545 100%)',
    weekendHeader: '#131a2e',
    weekendCol:    'rgba(20,12,48,0.6)',
    todayCol:      'rgba(109,87,255,0.12)',
    hourLine:      '#1e2535',
    halfHourLine:  '#161e2e',
    miniNavHover:  '#2d3748',
    miniText:      '#e2e8f0',
    miniTextSub:   '#718096',
    miniSel:       '#3730a3',
    miniSelText:   '#c4b5fd',
    upcomingLabel: '#c084fc',
    tipLabel:      '#a78bfa',
    toolbarBg:     'rgba(13,17,23,0.98)',
  } : {
    pageBg:        '#f8f7ff',
    sidebarBg:     'linear-gradient(180deg, #f5f3ff 0%, #fdf4ff 60%, #f0fdf4 100%)',
    sidebarBorder: 'rgba(99,78,240,0.12)',
    surface:       'white',
    surfaceFaint:  '#f9fafb',
    border:        '#c7d2fe',
    borderIndigo:  '#c7d2fe',
    text:          '#111827',
    textSub:       '#6b7280',
    textFaint:     '#9ca3af',
    todayHeader:   'linear-gradient(180deg, #ede9fe 0%, #f5f3ff 100%)',
    weekendHeader: '#f5f3ff',
    weekendCol:    'rgba(249,247,255,0.8)',
    todayCol:      'rgba(87,70,237,0.04)',
    hourLine:      '#c7d2fe',
    halfHourLine:  '#e0e7ff',
    miniNavHover:  '#f3f4f6',
    miniText:      '#374151',
    miniTextSub:   '#6b7280',
    miniSel:       '#eef2ff',
    miniSelText:   '#4f46e5',
    upcomingLabel: '#9333ea',
    tipLabel:      '#7c3aed',
    toolbarBg:     'rgba(255,255,255,0.85)',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const HOUR_PX    = 60
const DAY_START  = 0   // 12 am (midnight)
const DAY_END    = 24  // 12 am (next day)
const HOURS      = Array.from({ length: DAY_END - DAY_START }, (_, i) => i + DAY_START)
const DAY_NAMES  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS     = ['January','February','March','April','May','June','July','August','September','October','November','December']
const APPT_TYPES = ['individual','couple','family','group','phone','intake','crisis']

const PALETTE = {
  individual: { bg:'#eef2ff', border:'#4f46e5', text:'#312e81', dot:'#4f46e5' },
  couple:     { bg:'#fff1f2', border:'#e11d48', text:'#881337', dot:'#e11d48' },
  family:     { bg:'#fffbeb', border:'#d97706', text:'#78350f', dot:'#d97706' },
  group:      { bg:'#faf5ff', border:'#7c3aed', text:'#4c1d95', dot:'#7c3aed' },
  phone:      { bg:'#f0f9ff', border:'#0284c7', text:'#0c4a6e', dot:'#0284c7' },
  intake:     { bg:'#f0fdf4', border:'#059669', text:'#064e3b', dot:'#059669' },
  crisis:     { bg:'#fef2f2', border:'#dc2626', text:'#7f1d1d', dot:'#dc2626' },
}
const PALETTE_DEFAULT = { bg:'#f9fafb', border:'#6b7280', text:'#374151', dot:'#6b7280' }
const pal = t => PALETTE[t] || PALETTE_DEFAULT

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────
const isoDate   = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
// Parse "YYYY-MM-DD" as LOCAL midnight (new Date("2026-04-05") parses as UTC which shifts the day)
const localDate = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d) }
const addDays   = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
const addMonths = (d, n) => { const r = new Date(d); r.setMonth(r.getMonth() + n); return r }

function startOfWeek(d) {
  const r = new Date(d); r.setDate(r.getDate() - r.getDay()); r.setHours(0,0,0,0); return r
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

function parseTime(appt) {
  if (!appt?.scheduled_start) return null
  const d = new Date(appt.scheduled_start)
  return isNaN(d) ? null : d
}
function fmtHour(h) {
  return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`
}
function fmtTime(d) {
  if (!d) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}
function fmtWeekTitle(ws) {
  const we = addDays(ws, 6)
  const sm = ws.toLocaleDateString('en-US', { month: 'long' })
  const em = we.toLocaleDateString('en-US', { month: 'long' })
  const yr = we.getFullYear()
  if (sm === em) return `${sm} ${ws.getDate()}–${we.getDate()}, ${yr}`
  return `${sm} ${ws.getDate()} – ${em} ${we.getDate()}, ${yr}`
}

function topPx(dt) {
  return ((dt.getHours() - DAY_START) * 60 + dt.getMinutes()) / 60 * HOUR_PX
}
function heightPx(min) {
  return Math.max(24, (min / 60) * HOUR_PX)
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini calendar (left sidebar)
// ─────────────────────────────────────────────────────────────────────────────
function MiniCalendar({ selected, onSelect, appointments }) {
  const isDark = useIsDark()
  const T = mkTheme(isDark)
  const [month, setMonth] = useState(() => {
    const d = selected ? localDate(selected) : new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const today    = isoDate(new Date())
  const firstDow = startOfMonth(month).getDay()
  const total    = daysInMonth(month)
  const cells    = []

  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let i = 1; i <= total; i++) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), i))
  }

  const dotDates = useMemo(() => {
    const s = new Set()
    appointments.forEach(a => { const t = parseTime(a); if (t) s.add(isoDate(t)) })
    return s
  }, [appointments])

  return (
    <div className="select-none">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3 px-1">
        <button
          onClick={() => setMonth(m => addMonths(m, -1))}
          className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
          style={{ color: T.textSub }}
          onMouseEnter={e => e.currentTarget.style.background = T.miniNavHover}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs font-bold" style={{ color: T.text }}>
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </span>
        <button
          onClick={() => setMonth(m => addMonths(m, 1))}
          className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
          style={{ color: T.textSub }}
          onMouseEnter={e => e.currentTarget.style.background = T.miniNavHover}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className="text-center text-[10px] font-bold py-0.5" style={{ color: T.textFaint }}>{d}</div>
        ))}
      </div>

      {/* Date grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={`e-${i}`} />
          const ds  = isoDate(d)
          const isT = ds === today
          const isSel = ds === selected
          const hasDot = dotDates.has(ds)
          return (
            <button
              key={ds}
              onClick={() => onSelect(ds)}
              className="flex flex-col items-center py-0.5 rounded-lg transition-colors"
              style={isT ? { background: '#4f46e5', color: 'white' }
                : isSel ? { background: T.miniSel, color: T.miniSelText }
                : { color: T.miniText }}
            >
              <span className="text-[11px] font-semibold leading-tight">{d.getDate()}</span>
              <span
                className="w-1 h-1 rounded-full mt-0.5"
                style={{ background: hasDot ? (isT ? 'white' : '#4f46e5') : 'transparent' }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Event block (week grid)
// ─────────────────────────────────────────────────────────────────────────────
function EventBlock({ appt, onClick }) {
  const start = parseTime(appt)
  if (!start) return null
  const dur  = appt.duration_minutes || 50
  const p    = pal(appt.appointment_type)
  const top  = topPx(start)
  const h    = heightPx(dur)
  const tiny = h < 40

  return (
    <div
      onClick={e => { e.stopPropagation(); onClick(appt) }}
      className="absolute left-1 right-1 rounded-xl overflow-hidden cursor-pointer z-10 group"
      style={{
        top, height: h,
        background: p.bg,
        borderLeft: `3px solid ${p.border}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <div className="px-2 py-1 h-full flex flex-col overflow-hidden transition-all group-hover:brightness-95">
        {!tiny && (
          <p className="text-[10px] font-semibold truncate" style={{ color: p.border }}>
            {fmtTime(start)}
          </p>
        )}
        <p className="text-[11px] font-bold truncate leading-tight" style={{ color: p.text }}>
          {tiny ? fmtTime(start) + ' ' : ''}{appt.display_name || appt.client_id || '—'}
        </p>
        {h >= 54 && (
          <p className="text-[10px] truncate mt-auto opacity-70" style={{ color: p.text }}>
            {appt.appointment_type} · {dur}m
          </p>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Now line
// ─────────────────────────────────────────────────────────────────────────────
function NowLine() {
  const [pct, setPct] = useState(null)

  useEffect(() => {
    function update() {
      const n = new Date()
      const h = n.getHours(), m = n.getMinutes()
      if (h < DAY_START || h >= DAY_END) { setPct(null); return }
      setPct(topPx(n))
    }
    update()
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [])

  if (pct === null) return null
  return (
    <div className="absolute left-0 right-0 z-20 pointer-events-none flex items-center" style={{ top: pct }}>
      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 -ml-1.5" style={{ background:'#ef4444' }} />
      <div className="flex-1 h-px" style={{ background:'#ef4444' }} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Appointment modal
// ─────────────────────────────────────────────────────────────────────────────
function ApptModal({ appt, patients, defaultDate, defaultTime, telehealthUrl, onSave, onCancel, onDelete }) {
  const isDark = useIsDark()
  const T = mkTheme(isDark)
  const { therapist } = useAuth()
  const isNew = !appt?.id
  const navigate = useNavigate()
  // Trainees/associates see a per-appointment "counts as" picker for the
  // practicum hour tracker. Hidden for licensed clinicians who don't log
  // hours.
  const cred = therapist?.credential_type || 'licensed'
  const isTrainingAccount = cred === 'trainee' || cred === 'associate'
  const [form, setForm] = useState(() => {
    if (appt) {
      const s = parseTime(appt)
      return {
        patient_id:       String(appt.patient_id || ''),
        appointment_type: appt.appointment_type || 'individual',
        date:             s ? isoDate(s) : (defaultDate || isoDate(new Date())),
        time:             s ? s.toTimeString().slice(0,5) : (defaultTime || '09:00'),
        duration_minutes: String(appt.duration_minutes || 50),
        location:         appt.location  || '',
        notes:            appt.notes     || '',
        practicum_bucket_override: appt.practicum_bucket_override || '',
      }
    }
    return {
      patient_id:'', appointment_type:'individual',
      date: defaultDate || isoDate(new Date()),
      time: defaultTime || '09:00',
      duration_minutes:'50', location:'', notes:'',
      practicum_bucket_override: '',
    }
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  // Local mirror of the appointment so Meet-link regeneration updates the modal in place
  const [liveAppt, setLiveAppt] = useState(appt || null)
  const [meetBusy, setMeetBusy] = useState(false)
  const [meetCopied, setMeetCopied] = useState(false)
  const [practicumBuckets, setPracticumBuckets] = useState([])

  // Load the leaf bucket list for the override picker. Server gates this
  // endpoint to trainees/associates so the fetch silently 403s for licensed
  // accounts — we just don't render the picker in that case.
  useEffect(() => {
    if (!isTrainingAccount) return
    apiFetch('/hours/buckets/all').then(r => r.json()).then(d => {
      if (Array.isArray(d?.buckets)) setPracticumBuckets(d.buckets)
    }).catch(() => {})
  }, [isTrainingAccount])

  useEffect(() => { setLiveAppt(appt || null) }, [appt])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const p   = pal(form.appointment_type)

  // Auto-infer type from patient profile
  useEffect(() => {
    if (!form.patient_id || !isNew) return
    const pt  = patients.find(pt => String(pt.id) === form.patient_id)
    if (!pt) return
    const txt = `${pt.presenting_concerns || ''} ${pt.diagnoses || ''}`.toLowerCase()
    if      (txt.includes('couple') || txt.includes('marital')) set('appointment_type', 'couple')
    else if (txt.includes('family'))                            set('appointment_type', 'family')
    else if (txt.includes('group'))                             set('appointment_type', 'group')
    else                                                        set('appointment_type', 'individual')
  }, [form.patient_id]) // eslint-disable-line

  const handleSave = async (force = false) => {
    if (!form.patient_id)           { setError('Please select a client.'); return }
    if (!form.date || !form.time)   { setError('Date and time required.'); return }
    setSaving(true); setError('')
    try {
      const scheduledStart = new Date(`${form.date}T${form.time}:00`).toISOString()
      let res
      if (isNew) {
        res = await apiFetch('/agent/appointments', {
          method: 'POST',
          body: JSON.stringify({
            patientId:       parseInt(form.patient_id),
            appointmentType: form.appointment_type,
            scheduledStart,
            durationMinutes: parseInt(form.duration_minutes) || 50,
            location:        form.location || null,
            notes:            form.notes    || null,
            force,
          }),
        })
      } else {
        res = await apiFetch(`/agent/appointments/${appt.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            appointment_type: form.appointment_type,
            scheduled_start:  scheduledStart,
            duration_minutes: parseInt(form.duration_minutes) || 50,
            location:         form.location || null,
            notes:            form.notes    || null,
            // Empty string is the explicit "clear override / use auto-mapping"
            // signal; the PATCH handler treats it as null.
            practicum_bucket_override: isTrainingAccount ? (form.practicum_bucket_override || '') : undefined,
            force,
          }),
        })
      }
      const data = await res.json()

      // 409 = overlap with another appointment. Show the conflicts so the
      // therapist can decide: typo? legit double-booking (e.g. couple
      // session)? If they confirm, retry with force=true to bypass the guard.
      if (res.status === 409 && data.code === 'APPOINTMENT_CONFLICT' && Array.isArray(data.conflicts)) {
        const fmt = iso => {
          try {
            return new Date(iso).toLocaleString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric',
              hour: 'numeric', minute: '2-digit', hour12: true,
            })
          } catch { return iso }
        }
        const lines = data.conflicts.map(c => `• ${fmt(c.scheduled_start)} — ${c.display_name}`).join('\n')
        const ok = window.confirm(
          `This time overlaps with:\n\n${lines}\n\n` +
          `Book anyway? (Use this for couple/family sessions where each ` +
          `partner has their own appointment.)`
        )
        if (ok) {
          // Retry with override; the inner call manages its own saving state.
          setSaving(false)
          return handleSave(true)
        }
        setError('Pick a different time, or confirm to book anyway.')
        return
      }

      if (!res.ok) throw new Error(data.error || 'Save failed')
      onSave(data.appointment)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm('Cancel this appointment?')) return
    setSaving(true)
    try {
      const res = await apiFetch(`/agent/appointments/${appt.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      onDelete(appt.id)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(6px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: T.surface, boxShadow: isDark ? '0 25px 60px rgba(0,0,0,0.6)' : '0 25px 60px rgba(0,0,0,0.18)' }}
      >
        {/* Coloured top strip */}
        <div className="h-1 w-full" style={{ background: p.border }} />

        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-4">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: p.bg, border: `1.5px solid ${p.border}` }}
          >
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke={p.border} strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold" style={{ color: T.text }}>{isNew ? 'New appointment' : 'Edit appointment'}</h2>
            {!isNew && <p className="text-xs" style={{ color: T.textFaint }}>{appt.client_id}</p>}
          </div>
          <button
            onClick={onCancel}
            className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: T.textFaint }}
            onMouseEnter={e => e.currentTarget.style.background = T.miniNavHover}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="px-6 pb-2 space-y-4 max-h-[60vh] overflow-y-auto">

          {/* Client */}
          <div>
            <label className="label">Client <span style={{ color:'#ef4444' }}>*</span></label>
            <select className="input" value={form.patient_id} onChange={e => set('patient_id', e.target.value)}>
              <option value="">Select a client…</option>
              {patients.map(pt => <option key={pt.id} value={pt.id}>{pt.display_name || pt.client_id}{pt.display_name ? ` (${pt.client_id})` : ''}</option>)}
            </select>
          </div>

          {/* Session type */}
          <div>
            <label className="label">Session type</label>
            <div className="flex flex-wrap gap-1.5">
              {APPT_TYPES.map(t => {
                const tp     = pal(t)
                const active = form.appointment_type === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set('appointment_type', t)}
                    className="px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-all border"
                    style={active
                      ? { background: tp.bg, color: tp.text, borderColor: tp.border }
                      : { background: T.surface, color: T.textSub, borderColor: T.border }
                    }
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Date <span style={{ color:'#ef4444' }}>*</span></label>
              <input type="date" className="input" value={form.date} onChange={e => set('date', e.target.value)} />
            </div>
            <div>
              <label className="label">Start time <span style={{ color:'#ef4444' }}>*</span></label>
              <input type="time" className="input" value={form.time} onChange={e => set('time', e.target.value)} />
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="label">Duration</label>
            <div className="grid grid-cols-5 gap-1.5">
              {[30,45,50,60,90].map(d => {
                const active = form.duration_minutes === String(d)
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set('duration_minutes', String(d))}
                    className="py-2 rounded-xl text-xs font-bold transition-all border"
                    style={active
                      ? { background: p.border, color: 'white', borderColor: p.border }
                      : { background: T.surface, color: T.textSub, borderColor: T.border }
                    }
                  >
                    {d}m
                  </button>
                )
              })}
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="label">Location <span className="font-normal text-gray-400 text-xs">(optional)</span></label>
            <input
              className="input"
              value={form.location}
              onChange={e => set('location', e.target.value)}
              placeholder="Office, telehealth, etc."
            />
          </div>

          {/* Telehealth video link (Meet) — only for saved appointments */}
          {!isNew && liveAppt && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Telehealth video link</p>
                {liveAppt.meet_url && (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">Google Meet · HIPAA-covered</span>
                )}
              </div>
              {liveAppt.meet_url ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <code className="flex-1 text-xs font-mono text-gray-800 truncate bg-white border border-emerald-200 rounded-lg px-2 py-1.5">
                      {liveAppt.meet_url}
                    </code>
                    <button
                      type="button"
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(liveAppt.meet_url); setMeetCopied(true); setTimeout(() => setMeetCopied(false), 1500) } catch {}
                      }}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors"
                    >
                      {meetCopied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={meetBusy}
                    onClick={async () => {
                      if (!window.confirm('Generate a fresh Meet link? The old link will stop working.')) return
                      setMeetBusy(true)
                      try {
                        const r = await apiFetch(`/agent/appointments/${liveAppt.id}/meet`, { method: 'POST' })
                        const d = await r.json()
                        if (!r.ok) throw new Error(d.error || 'Could not regenerate link')
                        setLiveAppt(d.appointment)
                        onSave(d.appointment)
                      } catch (e) { alert(e.message) } finally { setMeetBusy(false) }
                    }}
                    className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-60"
                  >
                    {meetBusy ? 'Regenerating…' : 'Regenerate link'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={meetBusy}
                  onClick={async () => {
                    setMeetBusy(true)
                    try {
                      const r = await apiFetch(`/agent/appointments/${liveAppt.id}/meet`, { method: 'POST' })
                      const d = await r.json()
                      if (!r.ok) throw new Error(d.error || 'Could not generate link')
                      setLiveAppt(d.appointment)
                      onSave(d.appointment)
                    } catch (e) { alert(e.message) } finally { setMeetBusy(false) }
                  }}
                  className="w-full py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-60"
                >
                  {meetBusy ? 'Generating…' : 'Generate Google Meet link'}
                </button>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="label">Notes <span className="font-normal text-gray-400 text-xs">(optional)</span></label>
            <textarea
              className="textarea"
              rows={2}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Pre-session notes, reminders…"
            />
          </div>

          {/* Practicum hour override — only visible to trainees and associates.
              Lets the user fix Miwa's auto-mapping (e.g. "Individual" was actually
              with a 14-year-old → Individual Child Client) without changing the
              session's appointment_type, which other parts of the app care about. */}
          {isTrainingAccount && !isNew && (
            <div>
              <label className="label">
                Counts as <span className="font-normal text-gray-400 text-xs">(hour tracking)</span>
              </label>
              <select
                className="textarea !py-2.5"
                value={form.practicum_bucket_override}
                onChange={e => set('practicum_bucket_override', e.target.value)}
              >
                <option value="">Auto (based on type + client age)</option>
                {practicumBuckets.map(b => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-gray-400 leading-relaxed">
                Override the automatic categorization for your hour log.
                Doesn't affect the session itself.
              </p>
            </div>
          )}

          {/* Attendance Actions */}
          {appt?.id && appt?.status === 'scheduled' && (
            <div className="space-y-2 pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Session Attendance</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const r = await apiFetch(`/agent/appointments/${appt.id}/checkin`, { method: 'POST' })
                      const d = await r.json()
                      if (r.ok) { alert(d.message); onSave({ ...appt, status: 'in_progress', attendance_status: d.attendance_status, checked_in_at: d.checked_in_at, minutes_late: d.minutes_late }); }
                      else alert(d.error)
                    } catch (e) { alert(e.message) }
                  }}
                  className="flex-1 py-2 rounded-xl text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors"
                >
                  ✓ Check In
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const r = await apiFetch(`/agent/appointments/${appt.id}/noshow`, { method: 'POST' })
                      const d = await r.json()
                      if (r.ok) { alert(d.message); onSave({ ...appt, status: 'no_show', attendance_status: 'no_show' }); }
                      else alert(d.error)
                    } catch (e) { alert(e.message) }
                  }}
                  className="flex-1 py-2 rounded-xl text-xs font-bold text-white bg-red-500 hover:bg-red-600 transition-colors"
                >
                  ✗ No-Show
                </button>
              </div>
            </div>
          )}
          {appt?.attendance_status === 'checked_in' || appt?.attendance_status === 'late' ? (
            <div className="flex items-center gap-2 pt-2">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                appt.attendance_status === 'checked_in' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {appt.attendance_status === 'checked_in' ? '✓ On time' : `⏰ ${appt.minutes_late}min late`}
              </span>
            </div>
          ) : null}

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-6 py-4 border-t mt-2" style={{ borderColor: T.border }}>
          {!isNew && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="text-sm font-semibold text-red-500 hover:text-red-700 px-3 py-2 rounded-xl hover:bg-red-50 border border-transparent hover:border-red-200 transition-all disabled:opacity-40"
            >
              Cancel appt
            </button>
          )}
          <div className="flex-1" />
          {/* Start Session — opens Meet in a new tab AND navigates Miwa's tab to the
              patient's workspace. When the clinician ends the call and closes the Meet
              tab, they're already on the right screen in Miwa to write the session note.
              Google Meet itself always lands on meet.google.com/landing post-call;
              we can't change that, but we can make sure Miwa is where they actually want
              to be after the session. */}
          {!isNew && (liveAppt?.meet_url || telehealthUrl) && (
            <button
              type="button"
              onClick={() => {
                const url = liveAppt?.meet_url || telehealthUrl
                const targetName = `miwa-meet-${liveAppt?.id || 'session'}`
                const meetWin = window.open(url, targetName, 'noopener')
                // Navigate the Miwa tab to the patient's workspace with a session-active
                // query so the page can show a "session in progress" banner + quick
                // "write note" affordance.
                if (liveAppt?.patient_id) {
                  navigate(`/patients/${liveAppt.patient_id}?session_active=${liveAppt.id}`)
                }
                // When the Meet tab closes, bring focus back to Miwa. We don't error on
                // cross-origin access (the noopener target means we often can't read
                // .closed) — silent failure is fine, focus just doesn't auto-restore.
                if (meetWin && !meetWin.closed) {
                  const poll = setInterval(() => {
                    try {
                      if (meetWin.closed) {
                        clearInterval(poll)
                        try { window.focus() } catch {}
                      }
                    } catch { clearInterval(poll) }
                  }, 2000)
                  // Give up polling after an hour — sessions shouldn't run longer.
                  setTimeout(() => clearInterval(poll), 60 * 60 * 1000)
                }
              }}
              className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #059669, #0ac5a2)' }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Start Session
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary text-sm px-4 py-2"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-sm font-semibold text-white px-5 py-2 rounded-xl transition-all disabled:opacity-50"
            style={{ background: p.border }}
          >
            {saving ? 'Saving…' : isNew ? 'Schedule' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Month view
// ─────────────────────────────────────────────────────────────────────────────
function MonthView({ monthStart, appointments, today, onDayClick, onEventClick }) {
  const isDark = useIsDark()
  const T = mkTheme(isDark)
  const firstDow = startOfMonth(monthStart).getDay()
  const total    = daysInMonth(monthStart)
  const cells    = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let i = 1; i <= total; i++) cells.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), i))
  while (cells.length % 7 !== 0) cells.push(null)

  const byDate = useMemo(() => {
    const m = {}
    const seen = new Set()                      // dedupe by appointment id (mirrors WeekView)
    appointments.forEach(a => {
      if (a?.id != null) {
        if (seen.has(a.id)) return
        seen.add(a.id)
      }
      const t = parseTime(a); if (!t) return
      const d = isoDate(t)
      if (!m[d]) m[d] = []
      m[d].push(a)
    })
    return m
  }, [appointments])

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b" style={{ borderColor: T.border, background: T.surface }}>
        {DAY_SHORT.map(d => (
          <div key={d} className="py-3 text-center text-xs font-bold uppercase tracking-wide" style={{ color: T.textFaint }}>
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="flex-1 grid grid-cols-7 overflow-y-auto" style={{ gridTemplateRows: `repeat(${cells.length / 7}, minmax(0, 1fr))`, background: T.pageBg }}>
        {cells.map((d, i) => {
          if (!d) return <div key={`e-${i}`} className="border-r border-b" style={{ borderColor: T.border, background: T.surfaceFaint, opacity: 0.5 }} />
          const ds     = isoDate(d)
          const isT    = ds === today
          const appts  = byDate[ds] || []
          const isOtherMonth = d.getMonth() !== monthStart.getMonth()
          return (
            <div
              key={ds}
              className="border-r border-b p-2 cursor-pointer transition-colors min-h-[90px]"
              style={{ borderColor: T.border, background: T.surface, opacity: isOtherMonth ? 0.4 : 1 }}
              onClick={() => onDayClick(ds)}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className="w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold transition-colors"
                  style={isT
                    ? { background: '#4f46e5', color: 'white' }
                    : { color: T.text }
                  }
                >
                  {d.getDate()}
                </span>
                {appts.length > 0 && (
                  <span className="text-[10px] font-semibold" style={{ color: T.textFaint }}>{appts.length}</span>
                )}
              </div>
              <div className="space-y-0.5 overflow-hidden">
                {appts.slice(0,3).map(a => {
                  const pp = pal(a.appointment_type)
                  const st = parseTime(a)
                  return (
                    <button
                      key={a.id}
                      onClick={e => { e.stopPropagation(); onEventClick(a) }}
                      className="w-full text-left px-1.5 py-0.5 rounded text-[10px] font-semibold truncate"
                      style={{ background: pp.bg, color: pp.text, borderLeft: `2px solid ${pp.border}` }}
                    >
                      {fmtTime(st)} {a.display_name || a.client_id}
                    </button>
                  )
                })}
                {appts.length > 3 && (
                  <p className="text-[10px] pl-1" style={{ color: T.textFaint }}>+{appts.length - 3} more</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Week view
// ─────────────────────────────────────────────────────────────────────────────
function WeekView({ weekStart, appointments, today, selectedDate, onCellClick, onEventClick, scrollRef }) {
  const isDark = useIsDark()
  const T = mkTheme(isDark)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekEnd  = addDays(weekStart, 6)

  const byDate = useMemo(() => {
    const m = {}
    const seen = new Set()                      // dedupe by appointment id so a stale
    appointments.forEach(a => {                 // optimistic update or future sync echo
      if (a?.id != null) {                      // can never double a day's count
        if (seen.has(a.id)) return
        seen.add(a.id)
      }
      const t = parseTime(a); if (!t) return
      const d = isoDate(t)
      if (!m[d]) m[d] = []
      m[d].push(a)
    })
    return m
  }, [appointments])

  const GRID_COLS = `56px repeat(7, minmax(0, 1fr))`
  const TOTAL_H   = HOURS.length * HOUR_PX

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: T.pageBg }}>
      {/* Day headers — sticky */}
      <div
        className="flex-shrink-0 grid border-b z-10"
        style={{ gridTemplateColumns: GRID_COLS, background: T.surface, borderColor: T.borderIndigo, minWidth: '700px' }}
      >
        {/* Timezone gutter */}
        <div className="flex items-end justify-end pb-2 pr-2 border-r" style={{ borderColor: T.borderIndigo }}>
          <span className="text-[9px] uppercase tracking-wide leading-none" style={{ color: '#a5b4fc' }}>
            {Intl.DateTimeFormat().resolvedOptions().timeZone.split('/')[1] || 'local'}
          </span>
        </div>

        {weekDays.map((d, i) => {
          const ds      = isoDate(d)
          const isT     = ds === today
          const isSel   = ds === selectedDate && !isT
          const dayActive = (byDate[ds] || []).filter(a => a.status !== 'cancelled')
          const count   = dayActive.length
          // Tooltip lists each appointment so the therapist can spot any duplicates
          // or unexpected entries at a glance — answers "why does this say 2?"
          const countTitle = count > 0
            ? dayActive
                .slice()
                .sort((a, b) => (parseTime(a)?.getTime() ?? 0) - (parseTime(b)?.getTime() ?? 0))
                .map(a => {
                  const t = parseTime(a)
                  return `${t ? fmtTime(t) : '—'} · ${a.display_name || a.client_id || 'Client'}`
                })
                .join('\n')
            : ''
          const isWeekend = d.getDay() === 0 || d.getDay() === 6
          return (
            <div
              key={i}
              className="flex flex-col items-center justify-center py-3 border-r last:border-r-0"
              style={{
                borderColor: T.borderIndigo,
                background: isT ? T.todayHeader : isSel ? 'rgba(109,87,255,0.08)' : isWeekend ? T.weekendHeader : T.surface
              }}
            >
              <span className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: isT ? '#6d28d9' : isSel ? '#6d28d9' : isWeekend ? T.textFaint : T.textSub }}>
                {DAY_SHORT[d.getDay()]}
              </span>
              <span
                className="w-9 h-9 flex items-center justify-center rounded-full text-base font-bold"
                style={isT
                  ? { background: 'linear-gradient(135deg, #5746ed, #7c3aed)', color: 'white', boxShadow: '0 2px 8px rgba(87,70,237,0.4)' }
                  : { color: isWeekend ? T.textFaint : T.text }
                }
              >
                {d.getDate()}
              </span>
              {count > 0 && (
                <span
                  title={countTitle}
                  className="mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full cursor-help"
                  style={isT
                    ? { background: '#5746ed', color: 'white' }
                    : { background: isDark ? '#312e81' : '#ede9fe', color: isDark ? '#a5b4fc' : '#7c3aed' }
                  }
                >
                  {count}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Scrollable grid */}
      <div ref={scrollRef} className="flex-1 overflow-auto" style={{ background: T.pageBg }}>
        <div className="grid" style={{ gridTemplateColumns: GRID_COLS, minWidth: '700px' }}>

          {/* Hour labels */}
          <div className="border-r" style={{ height: TOTAL_H, borderColor: T.borderIndigo }}>
            {HOURS.map((h, i) => (
              <div
                key={h}
                className="flex items-start justify-end pr-2 pt-1"
                style={{ height: HOUR_PX }}
              >
                <span className="text-xs font-semibold" style={{ color: T.textSub }}>{fmtHour(h)}</span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((day, di) => {
            const ds        = isoDate(day)
            const isT       = ds === today
            const isSel     = ds === selectedDate && !isT
            const isWeekend = day.getDay() === 0 || day.getDay() === 6
            const dayApps   = (byDate[ds] || []).filter(a => a.status !== 'cancelled')

            return (
              <div
                key={di}
                className="relative border-r last:border-r-0"
                style={{
                  height: TOTAL_H,
                  background: isT ? T.todayCol : isSel ? 'rgba(109,87,255,0.05)' : isWeekend ? T.weekendCol : T.surface,
                  borderColor: T.borderIndigo,
                  cursor: 'crosshair',
                }}
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const offsetY = e.clientY - rect.top
                  const clickedHour = Math.floor(offsetY / HOUR_PX) + DAY_START
                  const clickedMin  = Math.round(((offsetY % HOUR_PX) / HOUR_PX) * 60 / 15) * 15
                  const hh = String(Math.min(Math.max(clickedHour, DAY_START), DAY_END - 1)).padStart(2,'0')
                  const mm = String(Math.min(clickedMin, 59)).padStart(2,'0')
                  onCellClick(ds, `${hh}:${mm}`)
                }}
              >
                {/* Hour lines */}
                {HOURS.map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t"
                    style={{ top: i * HOUR_PX, borderColor: T.hourLine }}
                  />
                ))}
                {/* Half-hour lines */}
                {HOURS.map((_, i) => (
                  <div
                    key={`h${i}`}
                    className="absolute left-0 right-0 border-t"
                    style={{ top: i * HOUR_PX + HOUR_PX / 2, borderColor: T.halfHourLine, opacity: 0.6 }}
                  />
                ))}

                {/* Now line */}
                {isT && <NowLine />}

                {/* Events */}
                {dayApps.map(a => (
                  <EventBlock key={a.id} appt={a} onClick={onEventClick} />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule page
// ─────────────────────────────────────────────────────────────────────────────
export default function Schedule() {
  const isDark = useIsDark()
  const T = mkTheme(isDark)
  const { therapist } = useAuth()
  const telehealthUrl = therapist?.telehealth_url || null
  const [view,         setView]         = useState('week')  // 'week' | 'month'
  const [weekStart,    setWeekStart]    = useState(() => startOfWeek(new Date()))
  const [monthStart,   setMonthStart]   = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(() => isoDate(new Date()))
  const [appointments, setAppointments] = useState([])
  const [patients,     setPatients]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [modal,        setModal]        = useState(null)
  const [conflicts,    setConflicts]    = useState([])      // groups of overlapping appointments
  const [showConflicts, setShowConflicts] = useState(false)  // cleanup modal toggle
  const scrollRef = useRef(null)
  const today = isoDate(new Date())
  const [searchParams, setSearchParams] = useSearchParams()

  // Auto-open the new-appointment modal when arriving with ?new=1.
  // Used by mobile Today + any "Schedule" CTA elsewhere in the app.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setModal({ appt: null, defaultDate: today, defaultTime: '09:00' })
      // Strip the param so reloads / back-nav don't keep reopening it.
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scroll to current time on load / view change (or 8am if before work hours)
  useEffect(() => {
    if (view === 'week' && scrollRef.current) {
      const now = new Date()
      const currentHour = now.getHours() + now.getMinutes() / 60
      // Scroll to 1 hour before current time, or 8am — whichever is later
      const scrollToHour = Math.max(8, currentHour - 1)
      scrollRef.current.scrollTop = HOUR_PX * (scrollToHour - DAY_START) - 16
    }
  }, [view])

  const loadConflicts = useCallback(async () => {
    try {
      const res = await apiFetch('/agent/appointments/conflicts')
      const data = await res.json()
      setConflicts(Array.isArray(data?.conflicts) ? data.conflicts : [])
    } catch (_) {
      setConflicts([])
    }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [appts, pts] = await Promise.all([
        apiFetch('/agent/appointments').then(r => r.json()),
        apiFetch('/patients').then(r => r.json()),
      ])
      setAppointments(Array.isArray(appts) ? appts.filter(a => a.status !== 'cancelled') : [])
      setPatients(Array.isArray(pts) ? pts : [])
    } catch (_) {}
    setLoading(false)
    // Refresh conflicts whenever appointments reload — picks up dupes the
    // user might have created via the agent before the guard existed.
    loadConflicts()
  }, [loadConflicts])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const handler = () => loadData()
    window.addEventListener('miwa:appointment_created', handler)
    return () => window.removeEventListener('miwa:appointment_created', handler)
  }, [loadData])

  const todayAppts = useMemo(() => {
    return appointments.filter(a => { const t = parseTime(a); return t && isoDate(t) === today })
  }, [appointments, today])

  const handleSave = savedAppt => {
    setAppointments(prev => {
      const i = prev.findIndex(a => a.id === savedAppt.id)
      if (i >= 0) { const n = [...prev]; n[i] = savedAppt; return n }
      return [...prev, savedAppt]
    })
    setModal(null)
  }
  const handleDelete = id => {
    setAppointments(prev => prev.filter(a => a.id !== id))
    setModal(null)
    // A deletion may resolve a conflict — refresh so the pill disappears.
    loadConflicts()
  }

  // Used by the cleanup modal: deletes one appointment from a conflict group
  // and refreshes the list. Returns true on success.
  const deleteAppointmentInline = useCallback(async (id) => {
    try {
      const res = await apiFetch(`/agent/appointments/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setAppointments(prev => prev.filter(a => a.id !== id))
      await loadConflicts()
      return true
    } catch (_) {
      return false
    }
  }, [loadConflicts])

  const conflictTotal = conflicts.reduce((n, g) => n + g.length, 0)

  // Navigate while keeping week/month in sync
  const goBack = () => {
    if (view === 'week') {
      const ws = addDays(weekStart, -7)
      setWeekStart(ws)
      setMonthStart(new Date(ws.getFullYear(), ws.getMonth(), 1))
    } else {
      setMonthStart(m => addMonths(m, -1))
    }
  }
  const goForward = () => {
    if (view === 'week') {
      const ws = addDays(weekStart, 7)
      setWeekStart(ws)
      setMonthStart(new Date(ws.getFullYear(), ws.getMonth(), 1))
    } else {
      setMonthStart(m => addMonths(m, 1))
    }
  }
  const goToday = () => {
    const now = new Date()
    setWeekStart(startOfWeek(now))
    setMonthStart(new Date(now.getFullYear(), now.getMonth(), 1))
    setSelectedDate(today)
  }

  const navTitle = view === 'week'
    ? fmtWeekTitle(weekStart)
    : `${MONTHS[monthStart.getMonth()]} ${monthStart.getFullYear()}`

  // When user clicks a day in month view → switch to week view for that date
  const handleDayClick = ds => {
    const d = localDate(ds)
    setWeekStart(startOfWeek(d))
    setSelectedDate(ds)
    setView('week')
  }

  const handleCellClick = (date, time) => {
    setModal({ appt: null, defaultDate: date, defaultTime: time })
  }
  const handleEventClick = appt => {
    setModal({ appt })
  }

  // Upcoming appointments for sidebar
  const upcoming = useMemo(() => {
    return appointments
      .filter(a => { const t = parseTime(a); return t && t >= new Date() })
      .sort((a, b) => parseTime(a) - parseTime(b))
      .slice(0, 5)
  }, [appointments])

  return (
    <div className="flex h-full overflow-hidden" style={{ background: T.pageBg }}>

      {/* ── Left sidebar ───────────────────────────────────────── */}
      <aside className="flex-shrink-0 w-56 flex flex-col overflow-y-auto border-r"
        style={{ background: T.sidebarBg, borderColor: T.sidebarBorder }}>
        <div className="p-4 border-b" style={{ borderColor: T.sidebarBorder }}>
          <button
            onClick={() => setModal({ appt: null, defaultDate: today, defaultTime: '09:00' })}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg active:scale-95"
            style={{ background: 'linear-gradient(135deg, #5746ed, #0ac5a2)' }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New appointment
          </button>
        </div>

        {/* Mini calendar */}
        <div className="p-4 border-b" style={{ borderColor: T.sidebarBorder }}>
          <MiniCalendar
            selected={selectedDate}
            onSelect={ds => {
              setSelectedDate(ds)
              const d = localDate(ds)
              setWeekStart(startOfWeek(d))
              setMonthStart(new Date(d.getFullYear(), d.getMonth(), 1))
            }}
            appointments={appointments}
          />
        </div>

        {/* Upcoming */}
        <div className="p-4 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: T.upcomingLabel }}>Upcoming</p>
          {upcoming.length === 0 ? (
            <p className="text-xs italic" style={{ color: T.textFaint }}>No upcoming sessions</p>
          ) : (
            <div className="space-y-2">
              {upcoming.map(a => {
                const t  = parseTime(a)
                const pp = pal(a.appointment_type)
                return (
                  <button
                    key={a.id}
                    onClick={() => setModal({ appt: a })}
                    className="w-full text-left flex items-start gap-2 group"
                  >
                    <div className="w-0.5 self-stretch rounded-full flex-shrink-0 mt-0.5" style={{ background: pp.border }} />
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold truncate transition-colors" style={{ color: T.text }}>
                        {a.display_name || a.client_id || '—'}
                      </p>
                      <p className="text-[10px]" style={{ color: T.textFaint }}>
                        {t ? t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''} · {fmtTime(t)}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Miwa tip */}
        <div className="p-4 border-t" style={{ borderColor: T.sidebarBorder }}>
          <p className="text-[10px] leading-relaxed" style={{ color: T.upcomingLabel }}>
            <span className="font-bold" style={{ color: T.tipLabel }}>Tip:</span> Ask Miwa to schedule — <em>"Book Client 002 Tuesday 2pm"</em>
          </p>
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Toolbar */}
        <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b backdrop-blur-sm" style={{ borderColor: T.border, background: T.toolbarBg }}>
          {/* Navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={goBack}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
              style={{ color: T.textSub }}
              onMouseEnter={e => e.currentTarget.style.background = T.miniNavHover}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={goForward}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
              style={{ color: T.textSub }}
              onMouseEnter={e => e.currentTarget.style.background = T.miniNavHover}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Title */}
          <h2 className="text-sm font-bold" style={{ color: T.text }}>{navTitle}</h2>

          {/* Today badge */}
          {todayAppts.length > 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 hidden sm:inline">
              {todayAppts.length} today
            </span>
          )}

          {/* Today button */}
          <button
            onClick={goToday}
            className="ml-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border"
            style={{ borderColor: T.border, color: T.textSub, background: 'transparent' }}
            onMouseEnter={e => e.currentTarget.style.background = T.miniNavHover}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            Today
          </button>

          <div className="flex-1" />

          {/* Conflicts pill — only renders when there's actually something to clean up */}
          {conflicts.length > 0 && (
            <button
              onClick={() => setShowConflicts(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
              style={{ borderColor: '#fecaca', color: '#b91c1c', background: '#fef2f2' }}
              title="Two or more appointments overlap. Click to review and clean up."
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
              </svg>
              {conflictTotal} overlapping
            </button>
          )}

          {/* View switcher */}
          <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: T.border }}>
            {['week', 'month'].map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="px-3 py-1.5 text-xs font-semibold capitalize transition-colors"
                style={view === v
                  ? { background: '#4f46e5', color: 'white' }
                  : { background: T.surface, color: T.textSub }
                }
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center" style={{ background: T.pageBg }}>
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
              <p className="text-xs" style={{ color: T.textFaint }}>Loading schedule…</p>
            </div>
          </div>
        ) : view === 'week' ? (
          <WeekView
            weekStart={weekStart}
            appointments={appointments}
            today={today}
            selectedDate={selectedDate}
            onCellClick={handleCellClick}
            onEventClick={handleEventClick}
            scrollRef={scrollRef}
          />
        ) : (
          <MonthView
            monthStart={monthStart}
            appointments={appointments}
            today={today}
            onDayClick={handleDayClick}
            onEventClick={handleEventClick}
          />
        )}
      </div>

      {/* ── Modal ───────────────────────────────────────────────── */}
      {modal && (
        <ApptModal
          appt={modal.appt || null}
          patients={patients}
          defaultDate={modal.defaultDate || today}
          defaultTime={modal.defaultTime || '09:00'}
          telehealthUrl={telehealthUrl}
          onSave={handleSave}
          onCancel={() => setModal(null)}
          onDelete={handleDelete}
        />
      )}

      {/* ── Conflicts cleanup modal ─────────────────────────────── */}
      {showConflicts && (
        <ConflictsModal
          conflicts={conflicts}
          onDelete={deleteAppointmentInline}
          onClose={() => setShowConflicts(false)}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Conflicts cleanup modal — review and resolve appointments that overlap
// each other. Each group lists every overlapping appointment with a delete
// button so the therapist can keep the right one and remove duplicates.
// ─────────────────────────────────────────────────────────────────────────────
function ConflictsModal({ conflicts, onDelete, onClose }) {
  const isDark = useIsDark()
  const T = mkTheme(isDark)
  const [busyId, setBusyId] = useState(null)

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this appointment? This can\'t be undone.')) return
    setBusyId(id)
    await onDelete(id)
    setBusyId(null)
  }

  const fmt = iso => {
    try {
      return new Date(iso).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
    } catch { return iso }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(6px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-[560px] max-h-[85vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: T.surface }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: T.border }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: T.text }}>Review overlapping appointments</h2>
            <p className="text-xs mt-0.5" style={{ color: T.textSub }}>
              Each group below shares a time slot. Keep what's right, delete the duplicates.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
            style={{ color: T.textFaint }}
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {conflicts.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm font-semibold" style={{ color: T.text }}>All clear.</p>
              <p className="text-xs mt-1" style={{ color: T.textSub }}>No overlapping appointments left.</p>
            </div>
          ) : conflicts.map((group, gi) => (
            <div key={gi} className="rounded-xl border p-3" style={{ borderColor: T.border, background: T.surfaceFaint }}>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: T.textFaint }}>
                Group {gi + 1} · {group.length} overlapping
              </p>
              <div className="space-y-2">
                {group.map(appt => (
                  <div
                    key={appt.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg"
                    style={{ background: T.surface, border: `1px solid ${T.border}` }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate" style={{ color: T.text }}>
                        {appt.display_name}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: T.textSub }}>
                        {fmt(appt.scheduled_start)}
                        {appt.appointment_type ? ` · ${appt.appointment_type}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDelete(appt.id)}
                      disabled={busyId === appt.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50"
                      style={{ borderColor: '#fecaca', color: '#b91c1c', background: '#fef2f2' }}
                    >
                      {busyId === appt.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t flex items-center justify-between" style={{ borderColor: T.border, background: T.surfaceFaint }}>
          <p className="text-[11px]" style={{ color: T.textFaint }}>
            Going forward, the schedule will block overlaps automatically.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{ background: '#4f46e5', color: 'white' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
