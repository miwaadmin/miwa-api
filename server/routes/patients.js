const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { calculateRetention, isRetentionExpired } = require('../lib/retentionPolicy');
const { buildCaseIntelligence } = require('../services/case-intelligence');

// All routes: req.therapist set by requireAuth middleware in index.js

function normalizeDateOnly(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeNamePart(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text || null;
}

function normalizePreferredContactMethod(value, fallback = 'ask') {
  const method = String(value || fallback || 'ask').toLowerCase();
  return ['sms', 'email', 'ask'].includes(method) ? method : 'ask';
}

function buildDisplayName({ firstName, lastName, displayName, clientType }) {
  const preferred = normalizeNamePart(displayName);
  if (preferred) return preferred;
  if ((clientType || 'individual') === 'individual') {
    return [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  }
  return null;
}

function chartCodePrefix(clientType) {
  if (clientType === 'couple') return 'CPL';
  if (clientType === 'family') return 'FAM';
  return 'CLT';
}

async function generateClientId(db, therapistId, clientType) {
  const prefix = chartCodePrefix(clientType);
  for (let i = 0; i < 25; i += 1) {
    const suffix = String(Date.now() + i).slice(-6);
    const candidate = `${prefix}-${suffix}`;
    const existing = await db.get('SELECT id FROM patients WHERE client_id = ? AND therapist_id = ?', candidate, therapistId);
    if (!existing) return candidate;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function archivePatient(db, patient, { therapyEndedAt, legalHold, legalHoldReason } = {}) {
  const endedAt = normalizeDateOnly(therapyEndedAt) || patient.therapy_ended_at || new Date().toISOString().slice(0, 10);
  const retention = calculateRetention({
    therapyEndedAt: endedAt,
    dateOfBirth: patient.date_of_birth,
    age: patient.age,
  });
  const nextLegalHold = legalHold !== undefined ? (legalHold ? 1 : 0) : (patient.legal_hold ? 1 : 0);
  const nextLegalHoldReason = legalHoldReason !== undefined ? legalHoldReason : patient.legal_hold_reason;

  await db.run(
    `UPDATE patients
     SET status = 'archived',
         therapy_ended_at = ?,
         retention_until = ?,
         retention_basis = ?,
         archived_at = CURRENT_TIMESTAMP,
         legal_hold = ?,
         legal_hold_reason = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND therapist_id = ?`,
    endedAt,
    retention.retentionUntil,
    retention.retentionBasis,
    nextLegalHold,
    nextLegalHoldReason || null,
    patient.id,
    patient.therapist_id
  );
}

async function hardDeletePatient(db, patientId) {
  await db.run('DELETE FROM outcome_supervision_notes WHERE patient_id = ?', patientId);
  await db.run('DELETE FROM progress_alerts            WHERE patient_id = ?', patientId);
  await db.run('DELETE FROM proactive_alerts           WHERE patient_id = ?', patientId);
  await db.run('DELETE FROM assessments                WHERE patient_id = ?', patientId);
  await db.run('DELETE FROM assessment_links           WHERE patient_id = ?', patientId);
  await db.run('DELETE FROM sessions                   WHERE patient_id = ?', patientId);
  await db.run('DELETE FROM documents                  WHERE patient_id = ?', patientId);
  await db.run('DELETE FROM appointments               WHERE patient_id = ?', patientId);
  await db.run('DELETE FROM checkin_links              WHERE patient_id = ?', patientId);
  await db.run('DELETE FROM shared_patients            WHERE patient_id = ?', patientId);
  await db.run('DELETE FROM session_briefs             WHERE patient_id = ?', patientId);
  await db.run('DELETE FROM outreach_log               WHERE patient_id = ?', patientId);
  try { await db.run('DELETE FROM note_enrichments WHERE session_id IN (SELECT id FROM sessions WHERE patient_id = ?)', patientId); } catch {}
  try { await db.run('DELETE FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE patient_id = ?)', patientId); } catch {}
  try { await db.run('DELETE FROM treatment_plans WHERE patient_id = ?', patientId); } catch {}
  await db.run('DELETE FROM patients                   WHERE id = ?', patientId);
}

router.get('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const { search, include_archived, status } = req.query;

    // Lightweight columns only for list view — skip heavy text fields (client_overview, mental_health_history, etc.)
    const listColumns = `patients.id, patients.client_id, patients.first_name, patients.last_name, patients.display_name, patients.age, patients.gender,
      patients.case_type, patients.client_type, patients.age_range, patients.presenting_concerns, patients.diagnoses,
      patients.risk_screening, patients.phone, patients.email, patients.preferred_contact_method,
      patients.sms_consent, patients.sms_consent_at,
      patients.record_mode, patients.agency_client_id, patients.agency_note_status, patients.supervision_priority,
      patients.case_conceptualization, patients.modality_lens, patients.supervision_questions,
      patients.session_modality, patients.session_duration, patients.therapist_id,
      patients.status, patients.therapy_ended_at, patients.retention_until, patients.retention_basis,
      patients.archived_at, patients.legal_hold, patients.is_sample,
      patients.created_at, patients.updated_at`;

    const statusClause = status
      ? ' AND patients.status = ?'
      : (include_archived === 'true' ? '' : " AND COALESCE(patients.status, 'active') != 'archived'");

    // SECURITY: parameterized query — therapist_id in subquery uses ? bind param,
    // not string interpolation, to prevent SQL injection.
    const sessionStatsJoin = `
      LEFT JOIN (
        SELECT patient_id,
               COUNT(*) AS session_count,
               MAX(session_date) AS last_session_date
        FROM sessions
        WHERE therapist_id = ?
        GROUP BY patient_id
      ) ss ON ss.patient_id = patients.id`;
    let patients;
    if (search) {
      const q = `%${search}%`;
      patients = await db.all(
        `SELECT ${listColumns}, COALESCE(ss.session_count, 0) AS session_count, ss.last_session_date
         FROM patients${sessionStatsJoin}
         WHERE patients.therapist_id = ?${statusClause} AND (client_id LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR display_name LIKE ? OR presenting_concerns LIKE ? OR diagnoses LIKE ?)
          ORDER BY patients.updated_at DESC`,
        ...(status ? [tid, tid, status, q, q, q, q, q, q] : [tid, tid, q, q, q, q, q, q])
      );
    } else {
      patients = await db.all(
        `SELECT ${listColumns}, COALESCE(ss.session_count, 0) AS session_count, ss.last_session_date
         FROM patients${sessionStatsJoin}
         WHERE patients.therapist_id = ?${statusClause}
         ORDER BY patients.updated_at DESC`,
        ...(status ? [tid, tid, status] : [tid, tid])
      );
    }
    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const patient = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json(patient);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/case-intelligence', async (req, res) => {
  try {
    const db = getAsyncDb();
    const intelligence = await buildCaseIntelligence(db, req.therapist.id, req.params.id);
    if (!intelligence) return res.status(404).json({ error: 'Patient not found' });
    res.json(intelligence);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const {
      client_id, first_name, last_name, age, gender, case_type, client_type, members, age_range, referral_source, living_situation,
      presenting_concerns, diagnoses, notes, client_overview, client_overview_signature,
      mental_health_history, substance_use, risk_screening, family_social_history,
      mental_status_observations, treatment_goals, medical_history, medications,
      trauma_history, strengths_protective_factors, functional_impairments,
      display_name, phone, email, preferred_contact_method, sms_consent, date_of_birth,
      session_modality, session_duration,
      record_mode, agency_client_id, agency_note_status, supervision_priority,
      case_conceptualization, modality_lens, supervision_questions, private_reflection,
    } = req.body;

    const normalizedClientType = client_type || 'individual';
    const resolvedClientId = normalizeNamePart(client_id) || await generateClientId(db, tid, normalizedClientType);
    const normalizedFirstName = normalizeNamePart(first_name);
    const normalizedLastName = normalizeNamePart(last_name);
    const resolvedDisplayName = buildDisplayName({
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      displayName: display_name,
      clientType: normalizedClientType,
    }) || resolvedClientId;

    const existing = await db.get('SELECT id FROM patients WHERE client_id = ? AND therapist_id = ?', resolvedClientId, tid);
    if (existing) return res.status(409).json({ error: 'A patient with this Client ID already exists' });

    const consent = phone && sms_consent ? 1 : 0;
    const consentAt = consent ? new Date().toISOString() : null;
    const contactMethod = normalizePreferredContactMethod(preferred_contact_method);

    let therapist = null;
    try { therapist = await db.get('SELECT workspace_mode FROM therapists WHERE id = ?', tid); } catch {}
    const defaultRecordMode = therapist?.workspace_mode === 'agency_companion' ? 'agency_ehr_companion' : 'miwa_system_of_record';

    const result = await db.insert(
      `INSERT INTO patients (
        client_id, first_name, last_name, age, gender, case_type, client_type, members, age_range, referral_source, living_situation,
        presenting_concerns, diagnoses, notes, client_overview, client_overview_signature,
        mental_health_history, substance_use, risk_screening, family_social_history,
        mental_status_observations, treatment_goals, medical_history, medications,
        trauma_history, strengths_protective_factors, functional_impairments,
        display_name, phone, email, preferred_contact_method, sms_consent, sms_consent_at, date_of_birth,
        record_mode, agency_client_id, agency_note_status, supervision_priority,
        case_conceptualization, modality_lens, supervision_questions, private_reflection,
        session_modality, session_duration, therapist_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      resolvedClientId,
      normalizedFirstName,
      normalizedLastName,
      age || null,
      gender || null,
      case_type || null,
      normalizedClientType,
      members || null,
      age_range || null,
      referral_source || null,
      living_situation || null,
      presenting_concerns || null,
      diagnoses || null,
      notes || null,
      client_overview || null,
      client_overview_signature || null,
      mental_health_history || null,
      substance_use || null,
      risk_screening || null,
      family_social_history || null,
      mental_status_observations || null,
      treatment_goals || null,
      medical_history || null,
      medications || null,
      trauma_history || null,
      strengths_protective_factors || null,
      functional_impairments || null,
      resolvedDisplayName,
      phone || null,
      email || null,
      contactMethod,
      consent,
      consentAt,
      normalizeDateOnly(date_of_birth),
      record_mode || defaultRecordMode,
      agency_client_id || null,
      agency_note_status || null,
      supervision_priority || null,
      case_conceptualization || null,
      modality_lens || null,
      supervision_questions || null,
      private_reflection || null,
      session_modality || null,
      session_duration || null,
      tid
    );
    const patient = await db.get('SELECT * FROM patients WHERE id = ?', result.lastInsertRowid);
    res.status(201).json(patient);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const {
      client_id, first_name, last_name, age, gender, case_type, client_type, members, age_range, referral_source, living_situation,
      presenting_concerns, diagnoses, notes, client_overview, client_overview_signature,
      mental_health_history, substance_use, risk_screening, family_social_history,
      mental_status_observations, treatment_goals, medical_history, medications,
      trauma_history, strengths_protective_factors, functional_impairments,
      display_name, phone, email, preferred_contact_method, sms_consent, date_of_birth, legal_hold, legal_hold_reason,
      session_modality, session_duration,
      record_mode, agency_client_id, agency_note_status, supervision_priority, last_copied_to_ehr_at,
      case_conceptualization, modality_lens, supervision_questions, private_reflection,
    } = req.body;
    const existing = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    if (!existing) return res.status(404).json({ error: 'Patient not found' });

    const nextClientType = client_type !== undefined ? client_type : (existing.client_type || 'individual');
    const nextFirstName = first_name !== undefined ? normalizeNamePart(first_name) : existing.first_name;
    const nextLastName = last_name !== undefined ? normalizeNamePart(last_name) : existing.last_name;
    const nextDisplayName = (
      display_name !== undefined ||
      first_name !== undefined ||
      last_name !== undefined ||
      client_type !== undefined
    )
      ? (buildDisplayName({
          firstName: nextFirstName,
          lastName: nextLastName,
          displayName: display_name !== undefined ? display_name : existing.display_name,
          clientType: nextClientType,
        }) || (client_id ?? existing.client_id))
      : existing.display_name;

    // Resolve consent: explicit body wins; if phone is removed/changed, drop existing consent
    const newPhone = phone !== undefined ? phone : existing.phone;
    const phoneChanged = phone !== undefined && phone !== existing.phone;
    let nextConsent = existing.sms_consent ? 1 : 0;
    let nextConsentAt = existing.sms_consent_at || null;
    if (sms_consent !== undefined) {
      nextConsent = sms_consent && newPhone ? 1 : 0;
      nextConsentAt = nextConsent ? (existing.sms_consent ? existing.sms_consent_at : new Date().toISOString()) : null;
    }
    if (phoneChanged) {
      // New (or removed) number invalidates prior attestation unless this PUT also re-attested.
      if (sms_consent === undefined || !sms_consent || !newPhone) {
        nextConsent = 0;
        nextConsentAt = null;
      } else {
        nextConsentAt = new Date().toISOString();
      }
    }
    const nextPreferredContactMethod = preferred_contact_method !== undefined
      ? normalizePreferredContactMethod(preferred_contact_method, existing.preferred_contact_method || 'ask')
      : normalizePreferredContactMethod(existing.preferred_contact_method, 'ask');

    await db.run(
      `UPDATE patients SET
         client_id=?, first_name=?, last_name=?, age=?, gender=?, case_type=?, client_type=?, members=?, age_range=?, referral_source=?, living_situation=?,
         presenting_concerns=?, diagnoses=?, notes=?, client_overview=?, client_overview_signature=?, mental_health_history=?, substance_use=?,
         risk_screening=?, family_social_history=?, mental_status_observations=?, treatment_goals=?,
         medical_history=?, medications=?, trauma_history=?, strengths_protective_factors=?, functional_impairments=?,
         display_name=?, phone=?, email=?, preferred_contact_method=?, sms_consent=?, sms_consent_at=?, date_of_birth=?, legal_hold=?, legal_hold_reason=?,
         record_mode=?, agency_client_id=?, agency_note_status=?, supervision_priority=?, last_copied_to_ehr_at=?,
         case_conceptualization=?, modality_lens=?, supervision_questions=?, private_reflection=?,
         session_modality=?,
         session_duration=?,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND therapist_id=?`,
      client_id ?? existing.client_id,
      nextFirstName,
      nextLastName,
      age !== undefined ? age : existing.age,
      gender !== undefined ? gender : existing.gender,
      case_type !== undefined ? case_type : existing.case_type,
      nextClientType,
      members !== undefined ? members : existing.members,
      age_range !== undefined ? age_range : existing.age_range,
      referral_source !== undefined ? referral_source : existing.referral_source,
      living_situation !== undefined ? living_situation : existing.living_situation,
      presenting_concerns !== undefined ? presenting_concerns : existing.presenting_concerns,
      diagnoses !== undefined ? diagnoses : existing.diagnoses,
      notes !== undefined ? notes : existing.notes,
      client_overview !== undefined ? client_overview : existing.client_overview,
      client_overview_signature !== undefined ? client_overview_signature : existing.client_overview_signature,
      mental_health_history !== undefined ? mental_health_history : existing.mental_health_history,
      substance_use !== undefined ? substance_use : existing.substance_use,
      risk_screening !== undefined ? risk_screening : existing.risk_screening,
      family_social_history !== undefined ? family_social_history : existing.family_social_history,
      mental_status_observations !== undefined ? mental_status_observations : existing.mental_status_observations,
      treatment_goals !== undefined ? treatment_goals : existing.treatment_goals,
      medical_history !== undefined ? medical_history : existing.medical_history,
      medications !== undefined ? medications : existing.medications,
      trauma_history !== undefined ? trauma_history : existing.trauma_history,
      strengths_protective_factors !== undefined ? strengths_protective_factors : existing.strengths_protective_factors,
      functional_impairments !== undefined ? functional_impairments : existing.functional_impairments,
      nextDisplayName,
      newPhone,
      email !== undefined ? (email || null) : existing.email,
      nextPreferredContactMethod,
      nextConsent,
      nextConsentAt,
      date_of_birth !== undefined ? normalizeDateOnly(date_of_birth) : existing.date_of_birth,
      legal_hold !== undefined ? (legal_hold ? 1 : 0) : (existing.legal_hold ? 1 : 0),
      legal_hold_reason !== undefined ? legal_hold_reason : existing.legal_hold_reason,
      record_mode !== undefined ? record_mode : existing.record_mode,
      agency_client_id !== undefined ? agency_client_id : existing.agency_client_id,
      agency_note_status !== undefined ? agency_note_status : existing.agency_note_status,
      supervision_priority !== undefined ? supervision_priority : existing.supervision_priority,
      last_copied_to_ehr_at !== undefined ? last_copied_to_ehr_at : existing.last_copied_to_ehr_at,
      case_conceptualization !== undefined ? case_conceptualization : existing.case_conceptualization,
      modality_lens !== undefined ? modality_lens : existing.modality_lens,
      supervision_questions !== undefined ? supervision_questions : existing.supervision_questions,
      private_reflection !== undefined ? private_reflection : existing.private_reflection,
      session_modality !== undefined ? session_modality : existing.session_modality,
      session_duration !== undefined ? session_duration : existing.session_duration,
      req.params.id, req.therapist.id
    );
    const updated = await db.get('SELECT * FROM patients WHERE id = ?', req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/patients/:id/promote-sample — flip is_sample off on a patient
// that was originally created by the trainee onboarding wizard. Used when
// the trainee wants to keep the seeded notes/sessions but treat the row as
// a real case going forward.
router.post('/:id/promote-sample', async (req, res) => {
  try {
    const db = getAsyncDb();
    const patient = await db.get(
      'SELECT id, is_sample FROM patients WHERE id = ? AND therapist_id = ?',
      req.params.id, req.therapist.id,
    );
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    if (!patient.is_sample) return res.status(400).json({ error: 'Patient is not a sample case.' });

    await db.run('UPDATE patients SET is_sample = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', patient.id);
    await persistIfNeeded();
    const updated = await db.get('SELECT * FROM patients WHERE id = ?', patient.id);
    res.json({ ok: true, patient: updated });
  } catch (err) {
    console.error('[patients] promote-sample', err);
    res.status(500).json({ error: 'Could not promote sample case.' });
  }
});

router.post('/:id/close', async (req, res) => {
  try {
    const db = getAsyncDb();
    const patient = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    await archivePatient(db, patient, {
      therapyEndedAt: req.body?.therapy_ended_at,
      legalHold: req.body?.legal_hold,
      legalHoldReason: req.body?.legal_hold_reason,
    });
    const updated = await db.get('SELECT * FROM patients WHERE id = ?', req.params.id);
    res.json({ ok: true, patient: updated });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/archive', async (req, res) => {
  try {
    const db = getAsyncDb();
    const patient = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    await archivePatient(db, patient, req.body || {});
    const updated = await db.get('SELECT * FROM patients WHERE id = ?', req.params.id);
    res.json({ ok: true, patient: updated });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/reactivate', async (req, res) => {
  try {
    const db = getAsyncDb();
    const patient = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    await db.run(
      `UPDATE patients
       SET status = 'active',
           archived_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND therapist_id = ?`,
      req.params.id,
      req.therapist.id
    );
    const updated = await db.get('SELECT * FROM patients WHERE id = ?', req.params.id);
    res.json({ ok: true, patient: updated });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/patients/batch — Delete multiple patients at once
 * Body: { ids: [1, 2, 3] }
 */
router.delete('/batch', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    if (ids.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 patients per batch delete' });
    }

    let archived = 0;
    for (const id of ids) {
      const existing = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', id, req.therapist.id);
      if (!existing) continue;

      await archivePatient(db, existing, req.body || {});
      archived++;
    }

    res.json({ message: `${archived} patient record(s) archived for retention`, archived, deleted: 0 });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const existing = await db.get('SELECT * FROM patients WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    if (!existing) return res.status(404).json({ error: 'Patient not found' });

    const pid = req.params.id;
    const permanent = req.query.permanent === 'true';

    if (permanent) {
      if (!isRetentionExpired(existing)) {
        return res.status(423).json({
          error: 'Record is still under retention and cannot be permanently deleted',
          retention_until: existing.retention_until || null,
          legal_hold: Boolean(existing.legal_hold),
        });
      }

      await hardDeletePatient(db, pid);
      return res.json({ message: 'Patient and all associated records permanently deleted', deleted: 1 });
    }

    await archivePatient(db, existing, req.body || {});
    const updated = await db.get('SELECT * FROM patients WHERE id = ?', pid);
    res.json({
      message: 'Patient record archived for retention',
      archived: true,
      patient: updated,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Proactive Alerts — clean rebuild
//
// Previous version JOIN'd proactive_alerts with patients in SQL using `pa.*`
// and a CASE-WHEN ORDER BY. That worked on SQLite but kept 500'ing in
// production Postgres for reasons that were hard to pin down because every
// catch block returned a generic "Internal server error" with no stage info
// or error detail.
//
// This rebuild:
// - Splits the work into discrete stages (load alerts → enrich with patient
//   names → sort) so when something fails we know which step blew up.
// - Does the JOIN in JS (separate query for patient names) — no SQL syntax
//   that's even remotely cross-DB-fragile.
// - Sorts by severity rank in JS too — drops the CASE expression entirely.
// - Surfaces the specific error AND the failing stage in the response,
//   logged separately to Azure App Service logs. Generic 500s are how
//   production bugs survive for weeks; the explicit stage labels make
//   the next failure self-diagnosing.
// - Patient enrichment failure is non-fatal — alerts still render, just
//   without a name (graceful degrade).
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_RANK = { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 }

function alertsErrorResponse(res, stage, err) {
  console.error(`[alerts] ${stage} failed:`, err)
  return res.status(500).json({
    error: 'Failed to load alerts',
    stage,
    detail: err?.message || String(err),
    code: err?.code || null,
  })
}

// GET /api/patients/alerts — every active (non-dismissed) alert for this
// therapist, sorted by severity then recency. Returns [] when there are no
// alerts (never null).
router.get('/alerts', async (req, res) => {
  const therapistId = Number(req.therapist?.id)
  if (!Number.isFinite(therapistId) || therapistId <= 0) {
    return res.status(400).json({ error: 'Invalid session — please sign in again.' })
  }

  const db = getAsyncDb()

  // Stage 1: load raw alerts, no JOIN. Simple SELECT against a single table.
  let alerts
  try {
    alerts = await db.all(
      `SELECT id, therapist_id, patient_id, alert_type, severity, title,
              description, metric_value, is_read, dismissed_at, created_at
       FROM proactive_alerts
       WHERE therapist_id = ? AND dismissed_at IS NULL`,
      therapistId,
    )
  } catch (err) {
    return alertsErrorResponse(res, 'load_alerts', err)
  }

  if (!Array.isArray(alerts) || alerts.length === 0) {
    return res.json([])
  }

  // Stage 2: enrich with patient names. Non-fatal — if it errors, we still
  // return the alerts with display_name=null rather than 500'ing the whole
  // dashboard.
  try {
    const patientIds = [...new Set(alerts.map(a => a.patient_id).filter(x => x != null))]
    if (patientIds.length > 0) {
      const placeholders = patientIds.map(() => '?').join(', ')
      const patients = await db.all(
        `SELECT id, display_name, client_id FROM patients WHERE id IN (${placeholders})`,
        ...patientIds,
      )
      const byId = new Map(patients.map(p => [p.id, p]))
      alerts = alerts.map(a => ({
        ...a,
        display_name: byId.get(a.patient_id)?.display_name || null,
        client_id:    byId.get(a.patient_id)?.client_id    || null,
      }))
    } else {
      alerts = alerts.map(a => ({ ...a, display_name: null, client_id: null }))
    }
  } catch (err) {
    console.warn('[alerts] enrichment failed (non-fatal):', err?.message || err)
    alerts = alerts.map(a => ({ ...a, display_name: null, client_id: null }))
  }

  // Stage 3: sort by severity rank then created_at desc — in JS so we never
  // hit SQL dialect differences on the CASE expression.
  alerts.sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] || 99
    const sb = SEVERITY_RANK[b.severity] || 99
    if (sa !== sb) return sa - sb
    return String(b.created_at || '').localeCompare(String(a.created_at || ''))
  })

  return res.json(alerts)
})

// POST /api/patients/alerts/:id/dismiss — mark a single alert dismissed.
router.post('/alerts/:id/dismiss', async (req, res) => {
  const therapistId = Number(req.therapist?.id)
  const alertId     = Number(req.params.id)
  if (!Number.isFinite(therapistId) || !Number.isFinite(alertId)) {
    return res.status(400).json({ error: 'Invalid alert id.' })
  }
  try {
    const db = getAsyncDb()
    await db.run(
      `UPDATE proactive_alerts SET dismissed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND therapist_id = ?`,
      alertId, therapistId,
    )
    try { await persistIfNeeded() } catch {}
    return res.json({ ok: true })
  } catch (err) {
    return alertsErrorResponse(res, 'dismiss', err)
  }
})

// POST /api/patients/alerts/:id/read — mark a single alert read.
router.post('/alerts/:id/read', async (req, res) => {
  const therapistId = Number(req.therapist?.id)
  const alertId     = Number(req.params.id)
  if (!Number.isFinite(therapistId) || !Number.isFinite(alertId)) {
    return res.status(400).json({ error: 'Invalid alert id.' })
  }
  try {
    const db = getAsyncDb()
    await db.run(
      `UPDATE proactive_alerts SET is_read = 1
       WHERE id = ? AND therapist_id = ?`,
      alertId, therapistId,
    )
    return res.json({ ok: true })
  } catch (err) {
    return alertsErrorResponse(res, 'read', err)
  }
})

// POST /api/patients/alerts/run — manually trigger alert detection (for testing)
router.post('/alerts/run', async (req, res) => {
  try {
    const db = getAsyncDb()
    const tid = req.therapist.id
    const { detectAlertsForPatient } = require('../services/scheduler')

    // If detectAlertsForPatient isn't exported, do inline detection
    const patients = await db.all('SELECT id, display_name, client_id FROM patients WHERE therapist_id = ?', tid)
    let alertsCreated = 0

    for (const patient of patients) {
      // Check overdue assessments
      const lastAssessment = await db.get(
        'SELECT administered_at FROM assessments WHERE patient_id = ? ORDER BY administered_at DESC LIMIT 1',
        patient.id
      )

      const daysOverdue = lastAssessment
        ? Math.floor((Date.now() - new Date(lastAssessment.administered_at).getTime()) / 86400000)
        : Math.floor((Date.now() - new Date(patient.created_at || Date.now()).getTime()) / 86400000)

      if (!lastAssessment || daysOverdue > 7) {
        // Check if alert already exists
        const existing = await db.get(
          "SELECT id FROM proactive_alerts WHERE therapist_id = ? AND patient_id = ? AND alert_type = 'OVERDUE_ASSESSMENT' AND dismissed_at IS NULL AND created_at > datetime('now', '-24 hours')",
          tid, patient.id
        )
        if (!existing) {
          await db.insert(
            "INSERT INTO proactive_alerts (therapist_id, patient_id, alert_type, severity, title, description) VALUES (?, ?, 'OVERDUE_ASSESSMENT', 'MEDIUM', ?, ?)",
            tid, patient.id,
            `${patient.display_name || patient.client_id} needs an assessment`,
            lastAssessment ? `Last assessment was ${daysOverdue} days ago` : 'No baseline assessment on record'
          )
          alertsCreated++
        }
      }
    }

    await persistIfNeeded()
    res.json({ ok: true, alerts_created: alertsCreated, patients_checked: patients.length })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

function clientInviteHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

async function getPortalPatient(db, patientId, therapistId) {
  return db.get(
    'SELECT id, client_id, display_name, email, phone, therapist_id FROM patients WHERE id = ? AND therapist_id = ?',
    patientId,
    therapistId,
  )
}

async function getPortalSummary(db, patientId, therapistId) {
  const patient = await getPortalPatient(db, patientId, therapistId)
  if (!patient) return null
  const account = await db.get('SELECT * FROM client_portal_accounts WHERE patient_id = ? AND therapist_id = ?', patientId, therapistId)
  const invite = await db.get(
    `SELECT id, email, phone, expires_at, accepted_at, revoked_at, created_at
     FROM client_portal_invites
     WHERE patient_id = ? AND therapist_id = ?
     ORDER BY created_at DESC LIMIT 1`,
    patientId,
    therapistId,
  )
  const unread = await db.get(
    `SELECT COUNT(*) AS c FROM client_messages
     WHERE patient_id = ? AND therapist_id = ? AND sender_type = 'client' AND read_at IS NULL`,
    patientId,
    therapistId,
  )
  const pendingAssessments = await db.get(
    `SELECT COUNT(*) AS c FROM assessment_links
     WHERE patient_id = ? AND therapist_id = ? AND completed_at IS NULL AND expires_at > datetime('now')`,
    patientId,
    therapistId,
  )
  const incompleteHomework = await db.get(
    `SELECT COUNT(*) AS c FROM client_homework_assignments
     WHERE patient_id = ? AND therapist_id = ? AND completed_at IS NULL`,
    patientId,
    therapistId,
  )
  const status = account?.status === 'active'
    ? 'active'
    : account?.status === 'disabled'
      ? 'disabled'
      : invite && !invite.revoked_at && !invite.accepted_at && new Date(invite.expires_at) > new Date()
        ? 'invited'
        : 'not_invited'
  return {
    status,
    account: account ? {
      id: account.id,
      email: account.email,
      display_name: account.display_name,
      last_login_at: account.last_login_at,
      status: account.status,
    } : null,
    latest_invite: invite || null,
    summary: {
      last_login: account?.last_login_at || null,
      unread_client_messages: unread?.c || 0,
      pending_assessments: pendingAssessments?.c || 0,
      incomplete_homework: incompleteHomework?.c || 0,
    },
    what_client_can_see: {
      messages: true,
      appointments: !!(account?.appointment_visibility_enabled ?? 1),
      assessments: true,
      homework: !!(account?.homework_enabled ?? 1),
      resources: !!(account?.resources_enabled ?? 1),
      care_goals_shared: 0,
      notes: false,
      ai_consult: false,
      diagnosis: false,
    },
    controls: account ? {
      appointment_visibility_enabled: !!account.appointment_visibility_enabled,
      homework_enabled: !!account.homework_enabled,
      resources_enabled: !!account.resources_enabled,
    } : {
      appointment_visibility_enabled: true,
      homework_enabled: true,
      resources_enabled: true,
    },
  }
}

router.get('/:id/client-portal', async (req, res) => {
  try {
    const db = getAsyncDb()
    const summary = await getPortalSummary(db, req.params.id, req.therapist.id)
    if (!summary) return res.status(404).json({ error: 'Patient not found' })
    res.json(summary)
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:id/client-portal/invite', async (req, res) => {
  try {
    const db = getAsyncDb()
    const patient = await getPortalPatient(db, req.params.id, req.therapist.id)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    const email = String(req.body?.email || patient.email || '').trim().toLowerCase()
    const phone = String(req.body?.phone || patient.phone || '').trim() || null
    if (!email && !phone) return res.status(400).json({ error: 'Email or phone is required to invite a client.' })

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    await db.insert(
      `INSERT INTO client_portal_invites
         (patient_id, therapist_id, email, phone, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      patient.id,
      req.therapist.id,
      email || null,
      phone,
      clientInviteHash(token),
      expiresAt,
    )
    await persistIfNeeded()
    const appUrl = process.env.APP_URL || process.env.APP_BASE_URL || 'http://localhost:3000'
    const invite_url = `${appUrl.replace(/\/$/, '')}/client/accept-invite?token=${token}`
    res.json({
      ok: true,
      invite_url,
      expires_at: expiresAt,
      notification_preview: 'You have a secure Miwa invite from your clinician. Please open Miwa to continue.',
      portal: await getPortalSummary(db, patient.id, req.therapist.id),
    })
  } catch (err) {
    console.error('[patients/client-portal/invite]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:id/client-portal/revoke', async (req, res) => {
  try {
    const db = getAsyncDb()
    const patient = await getPortalPatient(db, req.params.id, req.therapist.id)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    await db.run('UPDATE client_portal_invites SET revoked_at = CURRENT_TIMESTAMP WHERE patient_id = ? AND therapist_id = ? AND accepted_at IS NULL', patient.id, req.therapist.id)
    await db.run("UPDATE client_portal_accounts SET status = 'disabled', updated_at = CURRENT_TIMESTAMP WHERE patient_id = ? AND therapist_id = ?", patient.id, req.therapist.id)
    await persistIfNeeded()
    res.json({ ok: true, portal: await getPortalSummary(db, patient.id, req.therapist.id) })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:id/client-portal/enable', async (req, res) => {
  try {
    const db = getAsyncDb()
    const patient = await getPortalPatient(db, req.params.id, req.therapist.id)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    await db.run("UPDATE client_portal_accounts SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE patient_id = ? AND therapist_id = ?", patient.id, req.therapist.id)
    await db.insert(
      `INSERT INTO client_portal_audit_log (patient_id, therapist_id, action, metadata_json)
       VALUES (?, ?, 'therapist_portal_access_changed', ?)`,
      patient.id,
      req.therapist.id,
      JSON.stringify({ status: 'active' }),
    )
    await persistIfNeeded()
    res.json({ ok: true, portal: await getPortalSummary(db, patient.id, req.therapist.id) })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:id/client-portal/reset', async (req, res) => {
  try {
    const db = getAsyncDb()
    const patient = await getPortalPatient(db, req.params.id, req.therapist.id)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    await db.run(
      `UPDATE client_portal_accounts
       SET password_hash = NULL, status = 'invited', updated_at = CURRENT_TIMESTAMP
       WHERE patient_id = ? AND therapist_id = ?`,
      patient.id,
      req.therapist.id,
    )
    await persistIfNeeded()
    res.json({ ok: true, portal: await getPortalSummary(db, patient.id, req.therapist.id) })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/:id/client-portal/controls', async (req, res) => {
  try {
    const db = getAsyncDb()
    const patient = await getPortalPatient(db, req.params.id, req.therapist.id)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    const account = await db.get('SELECT id FROM client_portal_accounts WHERE patient_id = ? AND therapist_id = ?', patient.id, req.therapist.id)
    if (!account) return res.status(404).json({ error: 'Client portal account not found' })
    const bit = (v, fallback = true) => v === undefined ? (fallback ? 1 : 0) : (v ? 1 : 0)
    await db.run(
      `UPDATE client_portal_accounts
       SET appointment_visibility_enabled = ?,
           homework_enabled = ?,
           resources_enabled = ?,
           response_window = COALESCE(?, response_window),
           office_hours = COALESCE(?, office_hours),
           emergency_boundary_message = COALESCE(?, emergency_boundary_message),
           portal_announcement = COALESCE(?, portal_announcement),
           welcome_message_template = COALESCE(?, welcome_message_template),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      bit(req.body?.appointment_visibility_enabled),
      bit(req.body?.homework_enabled),
      bit(req.body?.resources_enabled),
      req.body?.response_window || null,
      req.body?.office_hours || null,
      req.body?.emergency_boundary_message || null,
      req.body?.portal_announcement || null,
      req.body?.welcome_message_template || null,
      account.id,
    )
    await db.insert(
      `INSERT INTO client_portal_audit_log
         (patient_id, therapist_id, client_account_id, action, metadata_json)
       VALUES (?, ?, ?, 'therapist_portal_access_changed', ?)`,
      patient.id,
      req.therapist.id,
      account.id,
      JSON.stringify(req.body || {}),
    )
    await persistIfNeeded()
    res.json({ ok: true, portal: await getPortalSummary(db, patient.id, req.therapist.id) })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/:id/client-portal/preview', async (req, res) => {
  try {
    const db = getAsyncDb()
    const patient = await getPortalPatient(db, req.params.id, req.therapist.id)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    const portal = await getPortalSummary(db, patient.id, req.therapist.id)
    const messages = await db.all(
      `SELECT id, sender_type, content, sender, message, risk_flag, created_at
       FROM client_messages
       WHERE patient_id = ? AND therapist_id = ?
       ORDER BY created_at ASC LIMIT 20`,
      patient.id,
      req.therapist.id,
    )
    const homework = await db.all(
      `SELECT id, title, description, resource_url, due_at, completed_at, client_reflection
       FROM client_homework_assignments
       WHERE patient_id = ? AND therapist_id = ?
       ORDER BY COALESCE(due_at, created_at) ASC LIMIT 20`,
      patient.id,
      req.therapist.id,
    )
    const appointments = portal?.controls?.appointment_visibility_enabled ? await db.all(
      `SELECT id, appointment_type, scheduled_start, scheduled_end, location, meet_url, status
       FROM appointments WHERE patient_id = ? AND therapist_id = ? ORDER BY scheduled_start ASC LIMIT 20`,
      patient.id,
      req.therapist.id,
    ) : []
    const activity = await db.all(
      `SELECT id, action, metadata_json, created_at
       FROM client_portal_audit_log
       WHERE patient_id = ? AND therapist_id = ?
       ORDER BY created_at DESC LIMIT 30`,
      patient.id,
      req.therapist.id,
    )
    res.json({
      preview: true,
      label: 'Client View Preview',
      read_only: true,
      portal,
      client: { display_name: patient.display_name || patient.client_id },
      messages: messages.map(m => ({ ...m, sender_type: m.sender_type || m.sender, content: m.content || m.message })),
      homework,
      appointments,
      activity,
    })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/:id/client-portal/care-goals', async (req, res) => {
  try {
    const db = getAsyncDb()
    const patient = await getPortalPatient(db, req.params.id, req.therapist.id)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    const sharedIds = new Set((req.body?.shared_goal_ids || []).map(Number).filter(Number.isFinite))
    let goals = []
    try {
      goals = await db.all(
        `SELECT tg.id
         FROM treatment_goals tg
         JOIN treatment_plans tp ON tp.id = tg.plan_id
         WHERE tp.patient_id = ? AND tp.therapist_id = ?`,
        patient.id,
        req.therapist.id,
      )
    } catch {}
    for (const goal of goals) {
      await db.run('UPDATE treatment_goals SET shared_with_client = ? WHERE id = ?', sharedIds.has(Number(goal.id)) ? 1 : 0, goal.id)
    }
    await persistIfNeeded()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/:id/client-portal/messages', async (req, res) => {
  try {
    const db = getAsyncDb()
    const patient = await getPortalPatient(db, req.params.id, req.therapist.id)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    const messages = await db.all(
      `SELECT id, sender_type, content, sender, message, risk_flag, read_at, created_at
       FROM client_messages
       WHERE patient_id = ? AND therapist_id = ?
       ORDER BY created_at ASC LIMIT 100`,
      patient.id,
      req.therapist.id,
    )
    await db.run(
      "UPDATE client_messages SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE patient_id = ? AND therapist_id = ? AND sender_type = 'client'",
      patient.id,
      req.therapist.id,
    )
    await persistIfNeeded()
    res.json({ messages: messages.map(m => ({ ...m, sender_type: m.sender_type || m.sender, content: m.content || m.message, risk_flag: !!m.risk_flag })) })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:id/client-portal/messages', async (req, res) => {
  try {
    const db = getAsyncDb()
    const patient = await getPortalPatient(db, req.params.id, req.therapist.id)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    const content = String(req.body?.content || '').trim().slice(0, 2000)
    if (!content) return res.status(400).json({ error: 'Message is required.' })
    const account = await db.get('SELECT id FROM client_portal_accounts WHERE patient_id = ? AND therapist_id = ?', patient.id, req.therapist.id)
    const result = await db.insert(
      `INSERT INTO client_messages
         (patient_id, therapist_id, client_account_id, sender_type, content, sender, message)
       VALUES (?, ?, ?, 'therapist', ?, 'therapist', ?)`,
      patient.id,
      req.therapist.id,
      account?.id || null,
      content,
      content,
    )
    await persistIfNeeded()
    res.json({ ok: true, message_id: result.lastInsertRowid })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:id/client-portal/homework', async (req, res) => {
  try {
    const db = getAsyncDb()
    const patient = await getPortalPatient(db, req.params.id, req.therapist.id)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    const title = String(req.body?.title || '').trim()
    if (!title) return res.status(400).json({ error: 'Title is required.' })
    const account = await db.get('SELECT id FROM client_portal_accounts WHERE patient_id = ? AND therapist_id = ?', patient.id, req.therapist.id)
    const result = await db.insert(
      `INSERT INTO client_homework_assignments
         (patient_id, therapist_id, client_account_id, title, description, resource_url, attachment_document_id, due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      patient.id,
      req.therapist.id,
      account?.id || null,
      title,
      req.body?.description || null,
      req.body?.resource_url || null,
      req.body?.attachment_document_id || null,
      req.body?.due_at || null,
    )
    await persistIfNeeded()
    res.status(201).json({ ok: true, id: result.lastInsertRowid, portal: await getPortalSummary(db, patient.id, req.therapist.id) })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:id/client-portal/assessments', async (req, res) => {
  try {
    const db = getAsyncDb()
    const patient = await getPortalPatient(db, req.params.id, req.therapist.id)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    const { template_type, member_label, expires_days = 7 } = req.body || {}
    if (!template_type) return res.status(400).json({ error: 'Assessment type is required.' })
    const { TEMPLATES } = require('./assessments')
    if (!TEMPLATES[template_type]) return res.status(400).json({ error: 'Invalid assessment type.' })
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + Math.min(Math.max(Number(expires_days) || 7, 1), 30) * 24 * 60 * 60 * 1000).toISOString()
    const account = await db.get('SELECT id FROM client_portal_accounts WHERE patient_id = ? AND therapist_id = ?', patient.id, req.therapist.id)
    await db.insert(
      `INSERT INTO assessment_links
         (token, patient_id, therapist_id, template_type, member_label, expires_at, due_at, client_account_id, assigned_by_therapist_id, assigned_via)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'client_portal')`,
      token,
      patient.id,
      req.therapist.id,
      template_type,
      member_label || null,
      expiresAt,
      req.body?.due_at || expiresAt,
      account?.id || null,
      req.therapist.id,
    )
    await persistIfNeeded()
    res.json({ ok: true, token, url: `/client/assessments?token=${token}`, expires_at: expiresAt })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router;
