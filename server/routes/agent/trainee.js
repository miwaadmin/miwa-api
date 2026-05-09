const express = require('express');
const { getAsyncDb, persistIfNeeded } = require('../../db/asyncDb');
const { MODELS, callAI } = require('../../lib/aiExecutor');
const { scrubText } = require('../../lib/scrubber');
const { sendRouteError, safeJsonParse } = require('./lib/helpers');
const {
  buildLicensedTransitionPlan,
  generateCaseSnapshot,
  generateSupervisionAgenda,
  generateTraineeDailyBrief,
  generateTraineeExport,
  getEhrCompanionProfile,
  scanEthicalEscalations,
} = require('../../services/traineeIntelligence');

const router = express.Router();

router.get('/trainee/daily-brief', async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapist = await db.get('SELECT preferred_timezone FROM therapists WHERE id = ?', req.therapist.id);
    const result = await generateTraineeDailyBrief(db, req.therapist.id, {
      timezone: therapist?.preferred_timezone || req.therapist.preferred_timezone || 'America/Los_Angeles',
    });
    res.json(result);
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.get('/trainee/cases/:patientId/snapshot', async (req, res) => {
  try {
    const db = getAsyncDb();
    const result = await generateCaseSnapshot(db, req.therapist.id, Number(req.params.patientId));
    if (!result) return res.status(404).json({ error: 'Case not found' });
    res.json(result);
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.get('/trainee/supervision-agenda', async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapist = await db.get('SELECT preferred_timezone FROM therapists WHERE id = ?', req.therapist.id);
    const result = await generateSupervisionAgenda(db, req.therapist.id, {
      timezone: therapist?.preferred_timezone || req.therapist.preferred_timezone || 'America/Los_Angeles',
    });
    res.json(result);
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.get('/trainee/agency-profile', async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapist = await db.get(
      `SELECT agency_ehr_name, agency_ehr_note_format, agency_ehr_custom_format, site_policy_status, site_policy_acknowledged_at
         FROM therapists WHERE id = ?`,
      req.therapist.id
    );
    res.json({
      profile: getEhrCompanionProfile(
        therapist?.agency_ehr_name || 'Other',
        therapist?.agency_ehr_note_format,
        therapist?.agency_ehr_custom_format
      ),
      site_policy_status: therapist?.site_policy_status || 'not_sure',
      site_policy_acknowledged: !!therapist?.site_policy_acknowledged_at,
    });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.post('/trainee/escalation-scan', async (req, res) => {
  try {
    const { text, patient_id, session_id, add_to_supervision } = req.body || {};
    const flags = scanEthicalEscalations(text);
    if (add_to_supervision && flags.length) {
      const db = getAsyncDb();
      for (const flag of flags) {
        await db.insert(
          `INSERT INTO supervision_items (therapist_id, patient_id, session_id, source, title, details, priority)
           VALUES (?, ?, ?, 'ethics_escalation', ?, ?, ?)`,
          req.therapist.id,
          patient_id || null,
          session_id || null,
          flag.label,
          `${flag.guidance}\n\nSource text excerpt:\n${scrubText(String(text || '').slice(0, 700))}`,
          flag.priority === 'urgent' ? 'high' : 'normal'
        );
      }
      await persistIfNeeded();
    }
    res.json({ flags, needs_supervision: flags.length > 0 });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.get('/trainee/exports/:type', async (req, res) => {
  try {
    const db = getAsyncDb();
    const result = await generateTraineeExport(db, req.therapist.id, req.params.type, {
      patientId: req.query.patient_id,
      timezone: req.therapist.preferred_timezone || 'America/Los_Angeles',
    });
    res.json(result);
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.get('/trainee/transition-plan', async (req, res) => {
  try {
    const db = getAsyncDb();
    res.json(await buildLicensedTransitionPlan(db, req.therapist.id));
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.post('/trainee/transition-to-licensed', async (req, res) => {
  try {
    const db = getAsyncDb();
    const caseIds = Array.isArray(req.body?.case_ids) ? req.body.case_ids.map(Number).filter(Boolean) : [];
    await db.run(
      `UPDATE therapists
          SET workspace_mode = 'private_practice',
              client_record_mode = 'miwa_system_of_record',
              workspace_mode_selected_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      req.therapist.id
    );
    if (caseIds.length) {
      const placeholders = caseIds.map(() => '?').join(',');
      await db.run(
        `UPDATE patients
            SET record_mode = 'miwa_system_of_record',
                agency_note_status = COALESCE(agency_note_status, 'converted_from_agency_companion'),
                updated_at = CURRENT_TIMESTAMP
          WHERE therapist_id = ? AND id IN (${placeholders})`,
        req.therapist.id,
        ...caseIds
      );
    }
    try {
      await db.insert(
        `INSERT INTO trainee_growth_events (therapist_id, category, competency, title, details, source)
         VALUES (?, 'transition', 'professional identity', 'Transitioned Miwa workspace toward licensed private-practice mode', ?, 'transition_to_licensed')`,
        req.therapist.id,
        caseIds.length ? `Converted ${caseIds.length} selected case(s) into Miwa system-of-record mode.` : 'Preserved trainee history and switched workspace mode.'
      );
    } catch {}
    await persistIfNeeded();
    res.json({ ok: true, transition: await buildLicensedTransitionPlan(db, req.therapist.id) });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.get('/trainee/growth-timeline', async (req, res) => {
  try {
    const db = getAsyncDb();
    const rows = await db.all(
      `SELECT * FROM trainee_growth_events
        WHERE therapist_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      req.therapist.id
    );
    const competencies = [
      'assessment', 'diagnosis', 'treatment planning', 'risk assessment',
      'cultural humility', 'documentation', 'ethics/law', 'crisis response',
      'family systems', 'trauma-informed care', 'termination/discharge',
    ].map(name => {
      const matches = rows.filter(row => String(row.competency || '').toLowerCase() === name);
      return { name, count: matches.length, lastPracticedAt: matches[0]?.created_at || null };
    });
    res.json({ events: rows, competencies });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.post('/trainee/growth-events', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { category, competency, title, details, confidence_rating, patient_id } = req.body || {};
    const safeTitle = String(title || competency || category || '').trim();
    if (!safeTitle) return res.status(400).json({ error: 'title is required' });
    const result = await db.insert(
      `INSERT INTO trainee_growth_events
        (therapist_id, patient_id, category, competency, title, details, confidence_rating, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')`,
      req.therapist.id,
      patient_id || null,
      category || 'learning',
      competency || null,
      safeTitle,
      details || null,
      confidence_rating || null
    );
    await persistIfNeeded();
    res.status(201).json({ event: await db.get('SELECT * FROM trainee_growth_events WHERE id = ?', result.lastInsertRowid) });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.get('/trainee/supervision-items', async (req, res) => {
  try {
    const db = getAsyncDb();
    const rows = await db.all(
      `SELECT si.*, p.client_id, p.display_name
         FROM supervision_items si
         LEFT JOIN patients p ON p.id = si.patient_id
        WHERE si.therapist_id = ?
        ORDER BY
          CASE si.status WHEN 'open' THEN 0 WHEN 'discussed' THEN 1 ELSE 2 END,
          CASE si.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
          si.created_at DESC
        LIMIT 100`,
      req.therapist.id
    );
    res.json({ items: rows });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.post('/trainee/supervision-items', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { title, details, patient_id, session_id, source, priority } = req.body || {};
    if (!String(title || '').trim()) return res.status(400).json({ error: 'title is required' });
    const result = await db.insert(
      `INSERT INTO supervision_items (therapist_id, patient_id, session_id, source, title, details, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      req.therapist.id,
      patient_id || null,
      session_id || null,
      source || 'manual',
      String(title).trim(),
      details || null,
      priority || 'normal'
    );
    await persistIfNeeded();
    res.status(201).json({ item: await db.get('SELECT * FROM supervision_items WHERE id = ?', result.lastInsertRowid) });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.patch('/trainee/supervision-items/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const existing = await db.get('SELECT * FROM supervision_items WHERE id = ? AND therapist_id = ?', req.params.id, req.therapist.id);
    if (!existing) return res.status(404).json({ error: 'Item not found' });
    const status = req.body?.status || existing.status;
    const discussedAt = status === 'discussed' ? (existing.discussed_at || new Date().toISOString()) : existing.discussed_at;
    await db.run(
      `UPDATE supervision_items SET status = ?, discussed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND therapist_id = ?`,
      status, discussedAt, req.params.id, req.therapist.id
    );
    await persistIfNeeded();
    res.json({ item: await db.get('SELECT * FROM supervision_items WHERE id = ?', req.params.id) });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.post('/trainee/supervisor-feedback', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { feedback_text, patient_id, session_id } = req.body || {};
    if (!String(feedback_text || '').trim()) return res.status(400).json({ error: 'feedback_text is required' });
    const raw = await callAI(
      MODELS.AZURE_MAIN,
      'Extract trainee supervision feedback into practical follow-up. Return JSON only.',
      `Feedback:\n${scrubText(feedback_text)}\n\nReturn JSON with keys: action_items (array), documentation_reminders (array), clinical_learning_goals (array), next_session_prompts (array), future_supervision_followups (array), competencies (array from assessment, diagnosis, treatment planning, risk assessment, cultural humility, documentation, ethics/law, crisis response, family systems, trauma-informed care, termination/discharge).`,
      1200,
      true,
      { therapistId: req.therapist.id, kind: 'supervisor_feedback_extract' }
    );
    let parsed;
    try {
      parsed = safeJsonParse(raw);
    } catch {
      parsed = {
        action_items: [String(feedback_text).slice(0, 180)],
        documentation_reminders: [],
        clinical_learning_goals: [],
        next_session_prompts: [],
        future_supervision_followups: [],
        competencies: [],
      };
    }
    const result = await db.insert(
      `INSERT INTO supervisor_feedback
        (therapist_id, patient_id, session_id, feedback_text, action_items_json, documentation_reminders,
         clinical_learning_goals, next_session_prompts, future_supervision_followups)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.therapist.id,
      patient_id || null,
      session_id || null,
      feedback_text,
      JSON.stringify(parsed.action_items || []),
      (parsed.documentation_reminders || []).join('\n'),
      (parsed.clinical_learning_goals || []).join('\n'),
      (parsed.next_session_prompts || []).join('\n'),
      (parsed.future_supervision_followups || []).join('\n')
    );
    for (const item of parsed.action_items || []) {
      await db.insert(
        `INSERT INTO supervision_items (therapist_id, patient_id, session_id, source, title, details, priority)
         VALUES (?, ?, ?, 'supervisor_feedback', ?, ?, 'normal')`,
        req.therapist.id, patient_id || null, session_id || null, String(item).slice(0, 160), String(item)
      );
    }
    for (const competency of parsed.competencies || []) {
      await db.insert(
        `INSERT INTO trainee_growth_events (therapist_id, patient_id, category, competency, title, details, source)
         VALUES (?, ?, 'supervisor_feedback', ?, ?, ?, 'supervisor_feedback')`,
        req.therapist.id, patient_id || null, competency, `Supervisor feedback: ${competency}`, feedback_text
      );
    }
    await persistIfNeeded();
    res.status(201).json({ feedback: await db.get('SELECT * FROM supervisor_feedback WHERE id = ?', result.lastInsertRowid), extracted: parsed });
  } catch (err) {
    sendRouteError(res, err);
  }
});
module.exports = router;
