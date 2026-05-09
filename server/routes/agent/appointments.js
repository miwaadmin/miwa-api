const express = require('express');
const crypto = require('crypto');
const { getAsyncDb, persistIfNeeded } = require('../../db/asyncDb');
const { normalisePhone } = require('../../services/twilio');
const { sendRouteError, inferAppointmentType } = require('./lib/helpers');
const { findPatientByCode } = require('./lib/patient-context');
const {
  createAppointmentRecord,
  generateMeetForAppointment,
  maybeSendTelehealthSms,
  getGoogleCalendarSyncConfig,
  buildAppointmentSyncMeta,
  buildAppointmentDateFields,
  getAppointmentById,
  findAppointmentConflicts,
} = require('./lib/appointment-ops');
const { generateClientId } = require('./lib/client-codes');

const router = express.Router();

// One-time cleanup helper. Scans the therapist's non-cancelled appointments
// and returns clusters of mutually overlapping ones so they can be reviewed
// and resolved in the UI. Pre-existing dupes don't get caught by the
// create/edit guard — they were saved before the guard existed — so this is
// the path to clean them up.
router.get('/appointments/conflicts', async (req, res) => {
  try {
    const db = getAsyncDb();
    const rows = await db.all(
      `SELECT a.id, a.scheduled_start, a.scheduled_end, a.duration_minutes,
              a.appointment_type, a.status, a.location, a.notes, a.patient_id,
              p.client_id, p.display_name
       FROM appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
       WHERE a.therapist_id = ?
         AND a.status != 'cancelled'
         AND a.scheduled_start IS NOT NULL
         AND a.scheduled_end   IS NOT NULL
       ORDER BY a.scheduled_start ASC`,
      req.therapist.id,
    );

    // Classic merge-overlapping-intervals sweep. Boundary-touching is NOT a
    // conflict (a 9:00–10:00 and a 10:00–11:00 are fine), matching the same
    // semantics findAppointmentConflicts uses for the create/edit guard.
    const clusters = [];
    let current = [];
    let currentEnd = null;
    for (const a of rows) {
      if (current.length === 0 || a.scheduled_start < currentEnd) {
        current.push(a);
        if (!currentEnd || a.scheduled_end > currentEnd) currentEnd = a.scheduled_end;
      } else {
        if (current.length > 1) clusters.push(current);
        current = [a];
        currentEnd = a.scheduled_end;
      }
    }
    if (current.length > 1) clusters.push(current);

    const conflicts = clusters.map(group => group.map(r => ({
      ...r,
      display_name: r.display_name || r.client_id || 'Client',
    })));
    return res.json({ conflicts, total: conflicts.reduce((n, g) => n + g.length, 0) });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.get('/appointments', async (req, res) => {
  try {
    const db = getAsyncDb();
    const rows = await db.all(
      `SELECT a.*, p.client_id, p.display_name
       FROM appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
       WHERE a.therapist_id = ?
       ORDER BY COALESCE(a.scheduled_start, a.created_at) DESC`,
      req.therapist.id,
    );
    // Fallback chain: live patient.display_name → appointment's denormalized
    // client_display_name → client_code → client_id. Calendar always shows
    // the best available name.
    res.json(rows.map(r => ({
      ...r,
      display_name: r.display_name || r.client_display_name || r.client_code || r.client_id || null,
    })));
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.get('/google-calendar/status', async (req, res) => {
  try {
    const config = getGoogleCalendarSyncConfig();
    res.json({
      enabled: config.enabled,
      calendarId: config.calendarId,
      mode: config.enabled && config.calendarId ? 'queued-sync-ready' : 'internal-only',
      message: config.enabled && config.calendarId
        ? 'Google Calendar hooks are ready for future sync.'
        : 'Google Calendar sync is not configured yet. Miwa will keep scheduling internal for now.',
    });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.patch('/appointments/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const existing = await getAppointmentById(db, req.therapist.id, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Appointment not found' });

    const {
      appointment_type,
      scheduled_start,
      scheduled_end,
      duration_minutes,
      location,
      notes,
      status,
      sync_to_google,
      force,
      practicum_bucket_override,
    } = req.body || {};

    const patient = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', existing.patient_id, req.therapist.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const dateFields = buildAppointmentDateFields(
      scheduled_start ?? existing.scheduled_start,
      duration_minutes ?? existing.duration_minutes,
      scheduled_end ?? existing.scheduled_end,
    );

    // Conflict check on edit too — unless the time fields are unchanged
    // (no point re-checking a time that already lived in the DB) or the
    // caller forces through. Excludes the current appointment so it can't
    // conflict with itself.
    const timeChanged = (scheduled_start !== undefined && scheduled_start !== existing.scheduled_start)
      || (scheduled_end !== undefined && scheduled_end !== existing.scheduled_end)
      || (duration_minutes !== undefined && duration_minutes !== existing.duration_minutes);
    if (timeChanged && !force) {
      const conflicts = await findAppointmentConflicts(
        db,
        req.therapist.id,
        scheduled_start ?? existing.scheduled_start,
        dateFields.scheduledEnd,
        existing.id,
      );
      if (conflicts.length > 0) {
        return res.status(409).json({
          error: 'Time slot overlaps an existing appointment',
          code: 'APPOINTMENT_CONFLICT',
          conflicts,
        });
      }
    }
    const syncMeta = buildAppointmentSyncMeta(sync_to_google ?? existing.calendar_provider === 'google');
    const nextStatus = status || existing.status || 'scheduled';
    const nextAppointmentType = appointment_type || existing.appointment_type || inferAppointmentType(patient, '');

    // Practicum bucket override: explicit `null` clears, undefined leaves
    // existing value, anything else replaces. Empty string also clears.
    let nextOverride = existing.practicum_bucket_override ?? null;
    if (practicum_bucket_override !== undefined) {
      nextOverride = practicum_bucket_override === '' || practicum_bucket_override === null ? null : String(practicum_bucket_override);
    }

    await db.run(
      `UPDATE appointments SET
        appointment_type = ?,
        scheduled_start = ?,
        scheduled_end = ?,
        duration_minutes = ?,
        location = ?,
        notes = ?,
        calendar_provider = ?,
        google_calendar_id = ?,
        google_event_id = ?,
        sync_status = ?,
        sync_error = ?,
        last_synced_at = ?,
        status = ?,
        practicum_bucket_override = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND therapist_id = ?`,
      nextAppointmentType,
      scheduled_start ?? existing.scheduled_start ?? null,
      dateFields.scheduledEnd,
      dateFields.durationMinutes,
      location ?? existing.location ?? null,
      notes ?? existing.notes ?? null,
      syncMeta.calendar_provider,
      syncMeta.google_calendar_id,
      syncMeta.google_event_id,
      syncMeta.sync_status,
      syncMeta.sync_error,
      syncMeta.last_synced_at,
      nextStatus,
      nextOverride,
      existing.id,
      req.therapist.id,
    );

    const updated = await getAppointmentById(db, req.therapist.id, existing.id);
    await persistIfNeeded();
    return res.json({ ok: true, appointment: updated });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.delete('/appointments/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const existing = await getAppointmentById(db, req.therapist.id, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Appointment not found' });

    await db.run(
      `UPDATE appointments SET
        status = 'cancelled',
        sync_status = CASE WHEN calendar_provider = 'google' THEN 'cancel_google_sync' ELSE 'cancelled' END,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND therapist_id = ?`,
      existing.id,
      req.therapist.id,
    );

    // Tear down the Meet event + space so we don't leave orphaned calendar
    // entries or active Meet rooms.
    if (existing.meet_event_id || existing.meet_space_name) {
      try {
        const { deleteMeetEvent } = require('../services/googleMeet');
        await deleteMeetEvent(existing.meet_event_id, null, existing.meet_space_name);
      } catch (err) {
        console.error('[google-meet] cleanup failed:', err.message);
      }
    }

    const updated = await getAppointmentById(db, req.therapist.id, existing.id);
    await persistIfNeeded();
    return res.json({ ok: true, appointment: updated });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.post('/confirm', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { actionId, approved } = req.body || {};
    if (!actionId) return res.status(400).json({ error: 'actionId is required' });
    const row = await db.get('SELECT * FROM agent_actions WHERE id = ? AND therapist_id = ?', actionId, req.therapist.id);
    if (!row) return res.status(404).json({ error: 'Action not found' });

    if (!approved) {
      await db.run('UPDATE agent_actions SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?', 'cancelled', actionId);
      await persistIfNeeded();
      return res.json({ ok: true, cancelled: true });
    }

    if (row.kind !== 'schedule_appointment') {
      return res.status(400).json({ error: 'This action cannot be confirmed.' });
    }

    const payload = row.payload_json ? JSON.parse(row.payload_json) : {};
    const patient = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', payload.patientId, req.therapist.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const { insert, syncMeta } = await createAppointmentRecord(db, req.therapist.id, patient, { ...payload, status: 'scheduled' });

    await db.run('UPDATE agent_actions SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?', 'completed', actionId);
    await persistIfNeeded();

    const appointment = await db.get('SELECT a.*, p.client_id, p.display_name FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.id = ?', insert.lastInsertRowid);
    maybeSendTelehealthSms(db, req.therapist.id, patient);
    return res.json({ ok: true, appointment, calendarSync: syncMeta });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.post('/appointments', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { patientId, clientCode, appointmentType, scheduledStart, scheduledEnd, durationMinutes, location, notes, syncToGoogle, status, force, newPatient } = req.body || {};

    // Resolve the patient: existing by id/code, OR create a new one inline
    // when the modal sends a newPatient payload (lets the user book an
    // appointment for someone who isn't in their roster yet).
    let patient = patientId
      ? await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', patientId, req.therapist.id)
      : clientCode
        ? await findPatientByCode(db, req.therapist.id, clientCode)
        : null;

    if (!patient && newPatient && typeof newPatient === 'object') {
      const np = newPatient;
      const firstName = String(np.first_name || '').trim();
      const lastName  = String(np.last_name  || '').trim();
      if (!firstName && !lastName && !np.display_name) {
        return res.status(400).json({ error: 'New client needs at least a first or last name.' });
      }
      const phoneVal = np.phone ? String(np.phone).trim() : null;
      const emailVal = np.email ? String(np.email).trim() : null;
      // Light email format check — optional field, but block obvious typos.
      if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
        return res.status(400).json({ error: 'That email doesn\'t look right.' });
      }
      const newClientId = await generateClientId(db, req.therapist.id);
      const displayName = String(np.display_name || `${firstName} ${lastName}`).trim() || newClientId;
      const sessionModality = ['in-person', 'telehealth', 'hybrid'].includes(np.session_modality)
        ? np.session_modality
        : 'in-person';

      const insertedPatient = await db.insert(
        `INSERT INTO patients (
          client_id, first_name, last_name, display_name,
          phone, email, sms_consent, sms_consent_at,
          session_modality, session_duration, client_type, status,
          therapist_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newClientId,
        firstName || null,
        lastName  || null,
        displayName,
        phoneVal,
        emailVal,
        0,           // sms_consent — therapist must attest separately on the patient profile
        null,
        sessionModality,
        np.session_duration || 50,
        'individual',
        'active',
        req.therapist.id,
      );
      patient = await db.get('SELECT * FROM patients WHERE id = ?', insertedPatient.lastInsertRowid);
    }

    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    if (!scheduledStart && !scheduledEnd) return res.status(400).json({ error: 'scheduledStart or scheduledEnd is required' });

    // Block accidental double-booking unless the caller explicitly opts in
    // via `force: true` (e.g. a couple/family session legitimately needs two
    // rows at the same time).
    if (!force) {
      const probe = buildAppointmentDateFields(scheduledStart || null, durationMinutes, scheduledEnd || null);
      const conflicts = await findAppointmentConflicts(
        db,
        req.therapist.id,
        scheduledStart || null,
        probe.scheduledEnd,
      );
      if (conflicts.length > 0) {
        return res.status(409).json({
          error: 'Time slot overlaps an existing appointment',
          code: 'APPOINTMENT_CONFLICT',
          conflicts,
        });
      }
    }

    const { insert, syncMeta } = await createAppointmentRecord(db, req.therapist.id, patient, {
      appointmentType,
      scheduledStart,
      scheduledEnd,
      durationMinutes,
      location,
      notes,
      syncToGoogle,
      status: status || 'scheduled',
    });

    await persistIfNeeded();
    let appointment = await db.get('SELECT a.*, p.client_id, p.display_name FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.id = ?', insert.lastInsertRowid);

    // Auto-generate a HIPAA-covered Google Meet link when the client's
    // session modality is telehealth (or hybrid). Therapists can also force
    // generation later via POST /appointments/:id/meet for one-off cases.
    let meetUrl = null;
    const wantsTelehealth = patient.session_modality === 'telehealth' || patient.session_modality === 'hybrid';
    if (wantsTelehealth) {
      // Failure here shouldn't block appointment creation — the appointment
      // saves successfully and the therapist can hit "Generate" manually
      // from the modal to retry. Auto-attempt logs but doesn't crash.
      try {
        meetUrl = await generateMeetForAppointment(db, appointment.id);
        if (meetUrl) {
          appointment = await db.get('SELECT a.*, p.client_id, p.display_name FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.id = ?', appointment.id);
        }
      } catch (meetErr) {
        console.warn('[agent] Meet auto-gen failed (non-fatal):', meetErr.message);
      }
    }

    maybeSendTelehealthSms(db, req.therapist.id, patient, meetUrl);
    return res.status(201).json({ ok: true, appointment, calendarSync: syncMeta });
  } catch (err) {
    sendRouteError(res, err);
  }
});

// POST /api/agent/appointments/:id/meet — generate or regenerate the Meet link
// for a specific appointment. Useful for retrofitting older appointments or
// fixing cases where auto-generation failed.
router.post('/appointments/:id/meet', async (req, res) => {
  try {
    const db = getAsyncDb();
    const id = Number(req.params.id);
    const appt = await db.get('SELECT * FROM appointments WHERE id = ? AND therapist_id = ?', id, req.therapist.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    let meetUrl;
    try {
      meetUrl = await generateMeetForAppointment(db, id);
    } catch (err) {
      // Surface the actual underlying error so we don't have to read platform
      // logs to figure out what's wrong. Add a hint when the message smells
      // like a Meet API setup issue so the operator knows what to fix.
      const msg = err.message || 'Unknown error';
      let hint = '';
      if (/insufficient.*scope|access.?denied|forbidden|403/i.test(msg)) {
        hint = ' — Check that scope `https://www.googleapis.com/auth/meetings.space.created` is added to the service account\'s Domain-wide Delegation in Workspace admin.';
      } else if (/has not been used|disabled|404/i.test(msg)) {
        hint = ' — Check that "Google Meet API" is enabled in your GCP project (console.cloud.google.com → APIs & Services → Library).';
      } else if (/invalid_grant|unauthorized_client/i.test(msg)) {
        hint = ' — Service account credentials or impersonation user (GMAIL_IMPERSONATE_USER) may be misconfigured.';
      }
      return res.status(503).json({
        error: `Meet link could not be generated: ${msg}${hint}`,
        underlying: msg,
      });
    }

    const updated = await db.get('SELECT a.*, p.client_id, p.display_name FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.id = ?', id);
    return res.json({ ok: true, appointment: updated, meetUrl });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.post('/batch-assessments-confirm', async (req, res) => {
  try {
    const db = getAsyncDb();
    const crypto = require('crypto');
    const { selectedPatientIds, assessmentType, spreadOption } = req.body || {};

    if (!selectedPatientIds || !Array.isArray(selectedPatientIds) || selectedPatientIds.length === 0) {
      return res.status(400).json({ error: 'selectedPatientIds is required and must be non-empty' });
    }

    const asmtType = assessmentType || 'PHQ-9';
    const templateKey = {
      'PHQ-9': 'phq9',
      'GAD-7': 'gad7',
      'PCL-5': 'pcl5',
    }[asmtType] || asmtType.toLowerCase().replace(/[^a-z0-9]/g, '');

    const results = [];
    const now = new Date();

    for (let idx = 0; idx < selectedPatientIds.length; idx++) {
      const patientId = Number(selectedPatientIds[idx]);
      const patient = await db.get(
        'SELECT * FROM patients WHERE id = ? AND therapist_id = ?',
        patientId,
        req.therapist.id
      );

      if (!patient) continue; // Skip if patient not found

      const phone = normalisePhone(patient.phone);
      if (!phone) continue; // Skip if no valid phone
      if (!patient.sms_consent) continue; // Closed beta SMS requires explicit consent

      // Generate assessment token
      const token = crypto.randomBytes(24).toString('base64url');

      // Store assessment link
      await db.run(
        `INSERT INTO assessment_links (token, patient_id, therapist_id, template_type, expires_at)
         VALUES (?, ?, ?, ?, datetime('now', '+30 days'))`,
        token, patientId, req.therapist.id, templateKey
      );

      // Calculate send_at based on spread option
      let sendAt = now.toISOString();
      if (spreadOption === 'spread') {
        // Space sends evenly across 24 hours
        const intervalHours = Math.max(1, Math.floor(24 / selectedPatientIds.length));
        const sendDate = new Date(now);
        sendDate.setHours(sendDate.getHours() + (idx * intervalHours));
        sendAt = sendDate.toISOString();
      }

      // Queue scheduled send
      await db.run(
        `INSERT INTO scheduled_sends (therapist_id, patient_id, assessment_type, token, phone, send_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        req.therapist.id, patientId, templateKey, token, phone, sendAt
      );

      results.push({
        id: patientId,
        name: patient.display_name || patient.client_id,
        phone,
        sendAt,
      });
    }

    await persistIfNeeded();

    return res.status(201).json({
      ok: true,
      assessmentType: asmtType,
      sent: results.length,
      results,
      message: `Queued ${asmtType} for ${results.length} client${results.length !== 1 ? 's' : ''}${spreadOption === 'spread' ? ' (spaced over 24 hours)' : ''}`,
    });
  } catch (err) {
    sendRouteError(res, err);
  }
});

// ── Attendance tracking ─────────────────────────────────────────────────
router.post('/appointments/:id/checkin', async (req, res) => {
  try {
    const db = getAsyncDb();
    const appt = await db.get('SELECT * FROM appointments WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    const now = new Date();
    const scheduledStart = appt.scheduled_start ? new Date(appt.scheduled_start) : null;
    let minutesLate = 0;
    let attendanceStatus = 'checked_in';

    if (scheduledStart) {
      const diffMs = now - scheduledStart;
      minutesLate = Math.max(0, Math.round(diffMs / 60000));
      // More than 10 minutes late = "late"
      if (minutesLate > 10) attendanceStatus = 'late';
    }

    await db.run(
      `UPDATE appointments SET
        attendance_status = ?, checked_in_at = ?, minutes_late = ?,
        status = 'in_progress', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      attendanceStatus, now.toISOString(), minutesLate, appt.id
    );

    const patient = await db.get('SELECT display_name, client_id FROM patients WHERE id = ?', appt.patient_id);
    await persistIfNeeded();

    // Tier 1 Agentic: emit check-in event
    try {
      const { emit } = require('../services/event-bus');
      emit('appointment_checkin', {
        therapist_id: req.therapist.id,
        patient_id: appt.patient_id,
        appointment_id: appt.id,
        minutes_late: minutesLate,
        attendance_status: attendanceStatus,
      });
    } catch {}

    res.json({
      ok: true,
      attendance_status: attendanceStatus,
      checked_in_at: now.toISOString(),
      minutes_late: minutesLate,
      client: patient?.display_name || patient?.client_id || appt.client_code,
      message: minutesLate > 10
        ? `${patient?.display_name || appt.client_code} checked in ${minutesLate} minutes late`
        : `${patient?.display_name || appt.client_code} checked in on time`,
    });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.post('/appointments/:id/noshow', async (req, res) => {
  try {
    const db = getAsyncDb();
    const appt = await db.get('SELECT * FROM appointments WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    await db.run(
      `UPDATE appointments SET
        attendance_status = 'no_show', status = 'no_show',
        attendance_notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      req.body.notes || null, appt.id
    );
    await persistIfNeeded();

    // Tier 1 Agentic: emit no-show event
    try {
      const { emit } = require('../services/event-bus');
      emit('appointment_noshow', {
        therapist_id: req.therapist.id,
        patient_id: appt.patient_id,
        appointment_id: appt.id,
      });
    } catch {}

    res.json({ ok: true, message: 'Marked as no-show' });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.post('/appointments/:id/complete', async (req, res) => {
  try {
    const db = getAsyncDb();
    const appt = await db.get('SELECT * FROM appointments WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    await db.run(
      `UPDATE appointments SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      appt.id
    );
    await persistIfNeeded();

    res.json({ ok: true, message: 'Session completed' });
  } catch (err) {
    sendRouteError(res, err);
  }
});

// Get attendance stats for a patient
router.get('/patients/:patientId/attendance', async (req, res) => {
  try {
    const db = getAsyncDb();
    const pid = req.params.patientId;
    const tid = req.therapist.id;

    const stats = {
      total: (await db.get('SELECT COUNT(*) as c FROM appointments WHERE patient_id = ? AND therapist_id = ? AND status != ?', pid, tid, 'cancelled'))?.c || 0,
      on_time: (await db.get("SELECT COUNT(*) as c FROM appointments WHERE patient_id = ? AND therapist_id = ? AND attendance_status = 'checked_in'", pid, tid))?.c || 0,
      late: (await db.get("SELECT COUNT(*) as c FROM appointments WHERE patient_id = ? AND therapist_id = ? AND attendance_status = 'late'", pid, tid))?.c || 0,
      no_show: (await db.get("SELECT COUNT(*) as c FROM appointments WHERE patient_id = ? AND therapist_id = ? AND attendance_status = 'no_show'", pid, tid))?.c || 0,
      avg_minutes_late: (await db.get("SELECT AVG(minutes_late) as avg FROM appointments WHERE patient_id = ? AND therapist_id = ? AND minutes_late > 0", pid, tid))?.avg || 0,
    };
    stats.attendance_rate = stats.total > 0 ? Math.round(((stats.on_time + stats.late) / stats.total) * 100) : 100;

    const recent = await db.all(
      `SELECT a.id, a.scheduled_start, a.attendance_status, a.checked_in_at, a.minutes_late, a.status
       FROM appointments a WHERE a.patient_id = ? AND a.therapist_id = ?
       ORDER BY a.scheduled_start DESC LIMIT 10`,
      pid, tid
    );

    res.json({ stats, recent });
  } catch (err) {
    sendRouteError(res, err);
  }
});
module.exports = router;
