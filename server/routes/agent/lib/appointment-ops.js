const { persistIfNeeded } = require('../../../db/asyncDb');
const { normalisePhone, sendAppointmentSms } = require('../../../services/twilio');
const { inferAppointmentType } = require('./helpers');

function formatAppointmentPreview(patient, appointment) {
  const type = appointment.appointmentType || inferAppointmentType(patient, '');
  const start = appointment.scheduledStart || 'unspecified time';
  const duration = appointment.durationMinutes || 50;
  const location = appointment.location ? ` · ${appointment.location}` : '';
  const notes = appointment.notes ? `\nNotes: ${appointment.notes}` : '';
  // Prefer the human-readable display name over the auto-generated client
  // code so confirmations read "Schedule individual for Alfonzo at..."
  // instead of "Schedule individual for C4MUCXY at..." — the code is fine
  // for internal references but useless when the agent talks back to the
  // therapist about a person they just named.
  const who = patient.display_name || patient.client_id;
  return `Schedule ${type} for ${who} at ${start} (${duration} min)${location}${notes}`;
}

async function createAppointmentRecord(db, therapistId, patient, payload = {}) {
  const durationMinutes = Number(payload.durationMinutes || 50);
  const dateFields = buildAppointmentDateFields(payload.scheduledStart || null, durationMinutes, payload.scheduledEnd || null);
  const syncMeta = buildAppointmentSyncMeta(payload.syncToGoogle);
  const insert = await db.insert(
    `INSERT INTO appointments
      (therapist_id, patient_id, client_code, client_display_name, appointment_type, scheduled_start, scheduled_end, duration_minutes, location, notes, calendar_provider, google_calendar_id, google_event_id, sync_status, sync_error, last_synced_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    therapistId,
    patient.id,
    patient.client_id,
    patient.display_name || patient.client_id,   // Denormalized name snapshot for calendar display
    payload.appointmentType || inferAppointmentType(patient, ''),
    payload.scheduledStart || null,
    dateFields.scheduledEnd,
    dateFields.durationMinutes,
    payload.location || null,
    payload.notes || null,
    syncMeta.calendar_provider,
    syncMeta.google_calendar_id,
    syncMeta.google_event_id,
    syncMeta.sync_status,
    syncMeta.sync_error,
    syncMeta.last_synced_at,
    payload.status || 'scheduled',
  );

  return { insert, syncMeta };
}

/**
 * Generate (or regenerate) a Google Meet link for an appointment and persist
 * it on the appointments row. Returns the Meet URL or null if Meet isn't
 * configured. Errors are swallowed so they don't block appointment creation.
 *
 * If the appointment already has a meet_event_id, the existing event is
 * deleted before a new one is created.
 */
async function generateMeetForAppointment(db, appointmentId) {
  try {
    const { createMeetEvent, deleteMeetEvent, isConfigured } = require('../../../services/googleMeet');
    if (!isConfigured()) {
      const err = new Error('Google Workspace not configured (GOOGLE_SERVICE_ACCOUNT_JSON / GMAIL_IMPERSONATE_USER missing)');
      err.code = 'NOT_CONFIGURED';
      throw err;
    }

    const appt = await db.get('SELECT * FROM appointments WHERE id = ?', appointmentId);
    if (!appt) throw new Error('Appointment not found');
    if (!appt.scheduled_start) throw new Error('Appointment has no scheduled_start');

    // Tear down a previous Meet (regen path) before issuing a new one.
    if (appt.meet_event_id || appt.meet_space_name) {
      await deleteMeetEvent(appt.meet_event_id, null, appt.meet_space_name);
    }

    const startISO = new Date(appt.scheduled_start).toISOString();
    const endISO = appt.scheduled_end
      ? new Date(appt.scheduled_end).toISOString()
      : new Date(new Date(appt.scheduled_start).getTime() + (appt.duration_minutes || 50) * 60 * 1000).toISOString();

    // No PHI in title — just "Therapy Session" plus the client_code (which
    // is a short opaque identifier the therapist sees, not a real name).
    const title = `Therapy Session — ${appt.client_code}`;
    const description = 'Telehealth session via Miwa. This meeting is hosted on a Workspace account covered by Miwa\'s HIPAA BAA with Google.';

    const { meetUrl, eventId, spaceName } = await createMeetEvent({ title, startISO, endISO, description });

    await db.run(
      'UPDATE appointments SET meet_url = ?, meet_event_id = ?, meet_space_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      meetUrl, eventId, spaceName, appointmentId
    );
    await persistIfNeeded();
    return meetUrl;
  } catch (err) {
    console.error('[google-meet] Failed to provision link:', err.message);
    // Re-throw so the caller can surface the real error to the UI instead of
    // a generic "could not generate" message that hides what's actually wrong.
    throw err;
  }
}

/**
 * Fire-and-forget: sends a telehealth URL by text message only when SMS is enabled. Prefers a
 * just-generated Google Meet link (HIPAA-covered via Workspace BAA); falls
 * back to the therapist's saved telehealth_url (Zoom/Doxy/etc.) when the
 * Meet integration isn't configured or the appointment isn't telehealth.
 *
 * SMS only sends if patient has both a phone number AND sms_consent recorded.
 */
async function maybeSendTelehealthSms(db, therapistId, patient, scheduledStart, meetUrlOverride) {
  try {
    const phone = normalisePhone(patient.phone);
    if (!phone) return;
    if (!patient.sms_consent) return; // Twilio toll-free verification compliance

    let videoUrl = meetUrlOverride;
    if (!videoUrl) {
      const therapist = await db.get('SELECT telehealth_url FROM therapists WHERE id = ?', therapistId);
      videoUrl = therapist?.telehealth_url;
    }
    if (!videoUrl) return;

    let apptTime = null;
    if (scheduledStart) {
      try {
        apptTime = new Date(scheduledStart).toLocaleString('en-US', {
          weekday: 'long', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
        });
      } catch {}
    }

    await sendAppointmentSms(phone, videoUrl);
  } catch (err) {
    // Non-fatal — log and continue
    console.error('[telehealth-sms] Failed to send:', err.message);
  }
}

function getGoogleCalendarSyncConfig() {
  return {
    enabled: String(process.env.GOOGLE_CALENDAR_SYNC_ENABLED || '').toLowerCase() === 'true',
    calendarId: (process.env.GOOGLE_CALENDAR_ID || '').trim() || null,
  };
}

function buildAppointmentSyncMeta(requestedSync = false) {
  const googleConfig = getGoogleCalendarSyncConfig();
  const wantsGoogle = requestedSync === true || requestedSync === 'google' || requestedSync === 'google-calendar';
  if (!wantsGoogle) {
    return {
      calendar_provider: 'internal',
      google_calendar_id: null,
      google_event_id: null,
      sync_status: 'internal',
      sync_error: null,
      last_synced_at: null,
    };
  }

  return {
    calendar_provider: 'google',
    google_calendar_id: googleConfig.calendarId,
    google_event_id: null,
    sync_status: googleConfig.enabled && googleConfig.calendarId ? 'queued_google_sync' : 'pending_google_config',
    sync_error: googleConfig.enabled && googleConfig.calendarId ? null : 'Google Calendar sync is not configured yet.',
    last_synced_at: null,
  };
}

function buildAppointmentDateFields(scheduledStart, durationMinutes, scheduledEnd) {
  const duration = Number(durationMinutes || 50);
  let endValue = scheduledEnd || null;
  if (!endValue && scheduledStart) {
    const startDate = new Date(scheduledStart);
    if (!Number.isNaN(startDate.getTime())) {
      endValue = new Date(startDate.getTime() + duration * 60000).toISOString();
    }
  }
  return { durationMinutes: duration, scheduledEnd: endValue };
}

async function getAppointmentById(db, therapistId, appointmentId) {
  // Must include p.display_name — the Schedule UI prefers display_name over
  // client_code everywhere. Leaving it out here meant PATCH and DELETE
  // responses silently dropped the name and the UI fell back to the code,
  // which looked like the client got renamed after every edit.
  return await db.get(
    `SELECT a.*, p.client_id, p.display_name
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     WHERE a.id = ? AND a.therapist_id = ?`,
    appointmentId,
    therapistId,
  );
}

/**
 * Find any non-cancelled appointments that overlap the proposed time window
 * for this therapist. Used to prevent accidental double-booking — the user
 * can still override via `force: true` for legitimate cases (e.g. a couple
 * session where each partner has their own appointment row).
 *
 * Boundary-touching is allowed: an appointment ending at 10:00 does not
 * conflict with one starting at 10:00. Pass excludeId when editing so an
 * appointment can't conflict with itself.
 *
 * Note: scheduled_start / scheduled_end are stored as ISO 8601 strings,
 * which sort lexicographically in chronological order — so SQL string
 * comparison gives correct interval overlap semantics.
 */
async function findAppointmentConflicts(db, therapistId, scheduledStart, scheduledEnd, excludeId = null) {
  if (!scheduledStart || !scheduledEnd) return [];
  const params = [therapistId, scheduledEnd, scheduledStart];
  let sql = `SELECT a.id, a.scheduled_start, a.scheduled_end, a.appointment_type, a.status,
                    p.client_id, p.display_name
             FROM appointments a
             LEFT JOIN patients p ON p.id = a.patient_id
             WHERE a.therapist_id = ?
               AND a.status != 'cancelled'
               AND a.scheduled_start IS NOT NULL
               AND a.scheduled_end   IS NOT NULL
               AND a.scheduled_start < ?
               AND a.scheduled_end   > ?`;
  if (excludeId) {
    sql += ' AND a.id != ?';
    params.push(excludeId);
  }
  sql += ' ORDER BY a.scheduled_start ASC';
  const rows = await db.all(sql, ...params);
  return rows.map(r => ({
    ...r,
    display_name: r.display_name || r.client_id || 'Client',
  }));
}

module.exports = {
  formatAppointmentPreview,
  createAppointmentRecord,
  generateMeetForAppointment,
  maybeSendTelehealthSms,
  getGoogleCalendarSyncConfig,
  buildAppointmentSyncMeta,
  buildAppointmentDateFields,
  getAppointmentById,
  findAppointmentConflicts,
};
