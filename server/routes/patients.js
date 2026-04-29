const express = require('express');
const router = express.Router();
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
      patients.session_modality, patients.session_duration, patients.therapist_id,
      patients.status, patients.therapy_ended_at, patients.retention_until, patients.retention_basis,
      patients.archived_at, patients.legal_hold,
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
      display_name, phone, sms_consent, date_of_birth,
      session_modality, session_duration,
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

    const result = await db.insert(
      `INSERT INTO patients (
        client_id, first_name, last_name, age, gender, case_type, client_type, members, age_range, referral_source, living_situation,
        presenting_concerns, diagnoses, notes, client_overview, client_overview_signature,
        mental_health_history, substance_use, risk_screening, family_social_history,
        mental_status_observations, treatment_goals, medical_history, medications,
        trauma_history, strengths_protective_factors, functional_impairments,
        display_name, phone, sms_consent, sms_consent_at, date_of_birth, session_modality, session_duration, therapist_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      consent,
      consentAt,
      normalizeDateOnly(date_of_birth),
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
      display_name, phone, email, sms_consent, date_of_birth, legal_hold, legal_hold_reason,
      session_modality, session_duration,
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

    await db.run(
      `UPDATE patients SET
         client_id=?, first_name=?, last_name=?, age=?, gender=?, case_type=?, client_type=?, members=?, age_range=?, referral_source=?, living_situation=?,
         presenting_concerns=?, diagnoses=?, notes=?, client_overview=?, client_overview_signature=?, mental_health_history=?, substance_use=?,
         risk_screening=?, family_social_history=?, mental_status_observations=?, treatment_goals=?,
         medical_history=?, medications=?, trauma_history=?, strengths_protective_factors=?, functional_impairments=?,
         display_name=?, phone=?, email=?, sms_consent=?, sms_consent_at=?, date_of_birth=?, legal_hold=?, legal_hold_reason=?,
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
      nextConsent,
      nextConsentAt,
      date_of_birth !== undefined ? normalizeDateOnly(date_of_birth) : existing.date_of_birth,
      legal_hold !== undefined ? (legal_hold ? 1 : 0) : (existing.legal_hold ? 1 : 0),
      legal_hold_reason !== undefined ? legal_hold_reason : existing.legal_hold_reason,
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

// Proactive Alerts ────────────────────────────────────────────────────────

// GET /api/patients/alerts — all unread alerts for this therapist
router.get('/alerts', async (req, res) => {
  try {
    const db = getAsyncDb()
    const alerts = await db.all(
      `SELECT pa.*, p.display_name, p.client_id
       FROM proactive_alerts pa
       LEFT JOIN patients p ON p.id = pa.patient_id
       WHERE pa.therapist_id = ? AND pa.dismissed_at IS NULL
       ORDER BY
         CASE pa.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
         pa.created_at DESC`,
      req.therapist.id
    )
    res.json(alerts)
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/patients/alerts/:id/dismiss — dismiss an alert
router.post('/alerts/:id/dismiss', async (req, res) => {
  try {
    const db = getAsyncDb()
    await db.run(
      `UPDATE proactive_alerts SET dismissed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND therapist_id = ?`,
      req.params.id, req.therapist.id
    )
    try { await persistIfNeeded() } catch {}
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/patients/alerts/:id/read — mark alert as read
router.post('/alerts/:id/read', async (req, res) => {
  try {
    const db = getAsyncDb()
    await db.run(
      `UPDATE proactive_alerts SET is_read = 1
       WHERE id = ? AND therapist_id = ?`,
      req.params.id, req.therapist.id
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
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

module.exports = router;
