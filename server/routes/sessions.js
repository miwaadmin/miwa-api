const express = require('express');
const router = express.Router({ mergeParams: true });
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { emit } = require('../services/event-bus');

/**
 * When a session note gets signed, look for an appointment on the same date
 * for the same patient/therapist that's still 'scheduled' or 'in_progress'
 * (i.e. the slot the clinician intended this note to satisfy) and mark it
 * 'completed'. That's what wires the appointment into the practice-hours
 * tally — the hour computer only counts appointments where status='completed'
 * AND duration_minutes IS NOT NULL.
 *
 * If the appointment is missing a duration but the session has one, backfill
 * the appointment's duration from the session so the hour math is correct.
 *
 * Best-effort: failures are swallowed so a stale appointment never blocks a
 * note from saving.
 */
async function autoCompleteMatchingAppointment(db, therapistId, patientId, sessionRow) {
  try {
    if (!sessionRow) return;
    const sessionDate = sessionRow.session_date;
    if (!sessionDate) return;

    // Match by date — appointments sit at scheduled_start (timestamp), but we
    // want to match on the calendar day. Convert both to YYYY-MM-DD and
    // compare. Take the most recent in-progress/scheduled slot first since
    // that's the one the clinician most likely just checked the client into.
    const candidates = await db.all(
      `SELECT id, scheduled_start, duration_minutes, status
         FROM appointments
        WHERE therapist_id = ?
          AND patient_id = ?
          AND status IN ('scheduled', 'in_progress')
          AND scheduled_start IS NOT NULL
          AND substr(scheduled_start, 1, 10) = substr(?, 1, 10)
        ORDER BY
          CASE status WHEN 'in_progress' THEN 0 ELSE 1 END,
          scheduled_start DESC
        LIMIT 1`,
      therapistId, patientId, sessionDate,
    );
    const appt = candidates && candidates[0];
    if (!appt) return;

    const newDuration = appt.duration_minutes || sessionRow.duration_minutes || null;
    await db.run(
      `UPDATE appointments
          SET status = 'completed',
              duration_minutes = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      newDuration, appt.id,
    );
    try { await persistIfNeeded(); } catch {}
  } catch {
    // Non-fatal — the note still saved.
  }
}

/**
 * Session 4 milestone alert — fires once when a patient reaches their 4th
 * signed session. Research shows 73.5% of patients in standard care drop out
 * before session 4, so reaching it is a meaningful retention signal.
 */
async function checkSession4Milestone(db, therapistId, patientId) {
  try {
    const count = await db.get(
      'SELECT COUNT(*) as c FROM sessions WHERE patient_id = ? AND therapist_id = ? AND signed_at IS NOT NULL',
      patientId, therapistId
    );
    if (count?.c !== 4) return;

    // Don't duplicate
    const existing = await db.get(
      `SELECT id FROM progress_alerts
       WHERE patient_id = ? AND therapist_id = ? AND type = 'RETENTION_MILESTONE'`,
      patientId, therapistId
    );
    if (existing) return;

    const patient = await db.get('SELECT client_id, display_name FROM patients WHERE id = ?', patientId);
    const name = patient?.display_name || patient?.client_id || 'Client';
    await db.insert(
      `INSERT INTO progress_alerts (patient_id, therapist_id, type, severity, title, description)
       VALUES (?, ?, 'RETENTION_MILESTONE', 'SUCCESS', ?, ?)`,
      patientId, therapistId,
      'Session 4 Milestone Reached',
      `${name} completed their 4th session — the critical retention threshold. Research shows clients who reach session 4 are significantly more likely to complete a full course of treatment. Consider checking in on therapeutic alliance.`
    );
  } catch (err) {
    console.error('[sessions] Milestone check error:', err.message);
  }
}

/**
 * Patient access helper — verifies the therapist can access this patient.
 * Checks: (1) direct ownership, (2) shared access, (3) supervision link.
 * Returns { access: 'own'|'shared'|'supervised'|null, readOnly: boolean }
 */
async function checkPatientAccess(db, patientId, therapistId) {
  // 1. Direct ownership
  const owned = await db.get('SELECT id FROM patients WHERE id = ? AND therapist_id = ?', patientId, therapistId);
  if (owned) return { access: 'own', readOnly: false };

  // 2. Shared access
  const shared = await db.get(
    "SELECT access_level FROM shared_patients WHERE patient_id = ? AND shared_with_id = ?",
    patientId, therapistId
  );
  if (shared) return { access: 'shared', readOnly: shared.access_level === 'read' };

  // 3. Supervision link
  const patient = await db.get('SELECT therapist_id FROM patients WHERE id = ?', patientId);
  if (patient) {
    const supervision = await db.get(
      "SELECT access_level FROM supervision_links WHERE supervisor_id = ? AND supervisee_id = ? AND status = 'active'",
      therapistId, patient.therapist_id
    );
    if (supervision) return { access: 'supervised', readOnly: true };
  }

  return { access: null, readOnly: true };
}

// Legacy helper for backward compat
function ownedPatient(db, patientId, therapistId) {
  return db.get('SELECT id FROM patients WHERE id = ? AND therapist_id = ?', patientId, therapistId);
}

router.get('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const access = await checkPatientAccess(db, req.params.patientId, req.therapist.id);
    if (!access.access) return res.status(404).json({ error: 'Patient not found' });
    const sessions = await db.all(
      'SELECT * FROM sessions WHERE patient_id = ? ORDER BY session_date DESC, created_at DESC',
      req.params.patientId
    );
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:sessionId', async (req, res) => {
  try {
    const db = getAsyncDb();
    const access = await checkPatientAccess(db, req.params.patientId, req.therapist.id);
    if (!access.access) return res.status(404).json({ error: 'Patient not found' });
    const session = await db.get(
      'SELECT * FROM sessions WHERE id = ? AND patient_id = ?',
      req.params.sessionId, req.params.patientId
    );
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const patient = await ownedPatient(db, req.params.patientId, req.therapist.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const { session_date, note_format, subjective, objective, assessment, plan, icd10_codes, ai_feedback, notes_json, treatment_plan, duration_minutes, cpt_code, signed_at, full_note } = req.body;

    const result = await db.insert(
      `INSERT INTO sessions (patient_id, therapist_id, session_date, note_format, subjective, objective, assessment, plan, icd10_codes, ai_feedback, notes_json, treatment_plan, duration_minutes, cpt_code, signed_at, full_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.params.patientId, req.therapist.id,
      session_date || null, note_format || 'SOAP',
      subjective || null, objective || null,
      assessment || null, plan || null, icd10_codes || null, ai_feedback || null,
      notes_json || null, treatment_plan || null,
      duration_minutes || null, cpt_code || null, signed_at || null, full_note || null
    );

    const session = await db.get('SELECT * FROM sessions WHERE id = ?', result.lastInsertRowid);

    // Tier 1 Agentic: emit event if session was signed on creation
    if (signed_at) {
      try {
        emit('session_signed', {
          therapist_id: req.therapist.id,
          patient_id: parseInt(req.params.patientId),
          session_id: result.lastInsertRowid,
        });
      } catch {}
      await checkSession4Milestone(db, req.therapist.id, parseInt(req.params.patientId));
      await autoCompleteMatchingAppointment(db, req.therapist.id, parseInt(req.params.patientId), session);
    }

    res.status(201).json(session);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:sessionId', async (req, res) => {
  try {
    const db = getAsyncDb();
    const access = await checkPatientAccess(db, req.params.patientId, req.therapist.id);
    if (!access.access) return res.status(404).json({ error: 'Patient not found' });
    if (access.readOnly) return res.status(403).json({ error: 'You have read-only access to this patient.' });
    const existing = await db.get(
      'SELECT * FROM sessions WHERE id = ? AND patient_id = ?',
      req.params.sessionId, req.params.patientId
    );
    if (!existing) return res.status(404).json({ error: 'Session not found' });

    const { session_date, note_format, subjective, objective, assessment, plan, icd10_codes, ai_feedback, notes_json, treatment_plan, duration_minutes, cpt_code, signed_at, full_note } = req.body;

    // Prevent editing a signed (locked) note unless explicitly unlocking
    if (existing.signed_at && signed_at === undefined) {
      return res.status(423).json({ error: 'This session note has been signed and locked. Unlock it first.' });
    }

    await db.run(
      `UPDATE sessions SET session_date=?, note_format=?, subjective=?, objective=?, assessment=?, plan=?, icd10_codes=?, ai_feedback=?, notes_json=?, treatment_plan=?, duration_minutes=?, cpt_code=?, signed_at=?, full_note=?
       WHERE id=? AND patient_id=?`,
      session_date    !== undefined ? session_date    : existing.session_date,
      note_format     !== undefined ? note_format     : existing.note_format,
      subjective      !== undefined ? subjective      : existing.subjective,
      objective       !== undefined ? objective       : existing.objective,
      assessment      !== undefined ? assessment      : existing.assessment,
      plan            !== undefined ? plan            : existing.plan,
      icd10_codes     !== undefined ? icd10_codes     : existing.icd10_codes,
      ai_feedback     !== undefined ? ai_feedback     : existing.ai_feedback,
      notes_json      !== undefined ? notes_json      : existing.notes_json,
      treatment_plan  !== undefined ? treatment_plan  : existing.treatment_plan,
      duration_minutes !== undefined ? duration_minutes : existing.duration_minutes,
      cpt_code        !== undefined ? cpt_code        : existing.cpt_code,
      signed_at       !== undefined ? signed_at       : existing.signed_at,
      full_note       !== undefined ? full_note       : existing.full_note,
      req.params.sessionId, req.params.patientId
    );

    const updated = await db.get('SELECT * FROM sessions WHERE id = ?', req.params.sessionId);

    // Tier 1 Agentic: emit event if session was just signed (wasn't signed before, now is)
    if (signed_at && !existing.signed_at) {
      try {
        emit('session_signed', {
          therapist_id: req.therapist.id,
          patient_id: parseInt(req.params.patientId),
          session_id: parseInt(req.params.sessionId),
        });
      } catch {}
      await checkSession4Milestone(db, req.therapist.id, parseInt(req.params.patientId));
      await autoCompleteMatchingAppointment(db, req.therapist.id, parseInt(req.params.patientId), updated);
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:sessionId', async (req, res) => {
  try {
    const db = getAsyncDb();
    const access = await checkPatientAccess(db, req.params.patientId, req.therapist.id);
    if (!access.access) return res.status(404).json({ error: 'Patient not found' });
    if (access.readOnly) return res.status(403).json({ error: 'You have read-only access to this patient.' });
    const existing = await db.get(
      'SELECT id FROM sessions WHERE id = ? AND patient_id = ?',
      req.params.sessionId, req.params.patientId
    );
    if (!existing) return res.status(404).json({ error: 'Session not found' });

    await db.run('DELETE FROM sessions WHERE id = ?', req.params.sessionId);
    res.json({ message: 'Session deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
