const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { getAsyncDb } = require('../db/asyncDb');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set');

async function requireClientAuth(req, res, next) {
  const cookieToken = req.cookies?.miwa_client_auth;
  const headerToken = (() => {
    const h = req.headers.authorization;
    return (h && h.startsWith('Bearer ')) ? h.slice('Bearer '.length) : null;
  })();
  const token = cookieToken || headerToken;

  if (!token) {
    return res.status(401).json({ error: 'Client authentication required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'client') {
      return res.status(403).json({ error: 'Invalid session type.' });
    }

    const db = getAsyncDb();
    const row = await db.get(
      `SELECT cpa.*, p.client_id, p.display_name AS patient_display_name
       FROM client_portal_accounts cpa
       JOIN patients p ON p.id = cpa.patient_id AND p.therapist_id = cpa.therapist_id
       WHERE cpa.id = ?`,
      decoded.sub,
    );
    if (!row) return res.status(401).json({ error: 'Client account not found.' });
    if (row.status !== 'active') return res.status(403).json({ error: 'Client portal access is not active.' });

    req.client = {
      id: row.id,
      patient_id: row.patient_id,
      therapist_id: row.therapist_id,
      email: row.email,
      phone: row.phone || null,
      display_name: row.display_name || row.patient_display_name || row.client_id,
      status: row.status,
      portal_consent_at: row.portal_consent_at || null,
      notification_email_enabled: row.notification_email_enabled,
      notification_sms_enabled: row.notification_sms_enabled,
      appointment_reminders_enabled: row.appointment_reminders_enabled,
      assessment_reminders_enabled: row.assessment_reminders_enabled,
      homework_reminders_enabled: row.homework_reminders_enabled,
      appointment_visibility_enabled: row.appointment_visibility_enabled,
      homework_enabled: row.homework_enabled,
      resources_enabled: row.resources_enabled,
      checklist_json: row.checklist_json || null,
      terms_version: row.terms_version || null,
      privacy_version: row.privacy_version || null,
      portal_consent_version: row.portal_consent_version || null,
      response_window: row.response_window || null,
      office_hours: row.office_hours || null,
      emergency_boundary_message: row.emergency_boundary_message || null,
      portal_announcement: row.portal_announcement || null,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Client session expired. Please log in again.' });
  }
}

module.exports = requireClientAuth;
