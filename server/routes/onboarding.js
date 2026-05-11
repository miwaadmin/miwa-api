/**
 * Onboarding — one-shot route that takes the therapist's intro answers
 * and produces a SOUL.md markdown document, saved on the therapist record.
 *
 * Returns Miwa's welcoming confirmation message.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { MODELS, callAI } = require('../lib/aiExecutor');
const { sendSchoolEmailVerification } = require('../services/mailer');

// ── Public route (no auth) ───────────────────────────────────────────────────
// The school-email verification link the trainee clicks from their inbox lands
// here without an active session, so it must run before the global requireAuth.
// GET /api/onboarding/school-email/verify/:token
router.get('/school-email/verify/:token', async (req, res) => {
  try {
    const db = getAsyncDb();
    const record = await db.get(
      `SELECT * FROM credential_verifications WHERE token = ?`,
      req.params.token,
    );
    if (!record) return res.status(404).json({ error: 'Invalid or unknown token.' });
    if (record.verified_at) return res.json({ ok: true, already: true });
    if (new Date(record.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Token expired. Request a new verification email.' });
    }
    await db.run(`UPDATE credential_verifications SET verified_at = CURRENT_TIMESTAMP WHERE id = ?`, record.id);
    await db.run(
      `UPDATE therapists SET school_email_verified = 1, credential_verified = 1, credential_verified_at = CURRENT_TIMESTAMP WHERE id = ?`,
      record.therapist_id,
    );
    await persistIfNeeded();
    res.json({ ok: true });
  } catch (err) {
    console.error('[onboarding] GET /school-email/verify', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.use(requireAuth);

const ONBOARDING_STAGES = ['identity', 'clinical_style', 'workflow', 'assistant_style'];

async function getOnboardingAnswers(db, therapistId) {
  const rows = await db.all(
    `SELECT category, content, updated_at, created_at
       FROM assistant_memories
      WHERE therapist_id = ?
        AND memory_type = 'onboarding_progress'
        AND archived_at IS NULL
      ORDER BY created_at ASC`,
    therapistId,
  ).catch(() => []);
  return rows
    .map(row => ({
      stage: String(row.category || '').replace(/^stage_/, ''),
      response: row.content || '',
      updated_at: row.updated_at || row.created_at || null,
    }))
    .filter(answer => ONBOARDING_STAGES.includes(answer.stage));
}

router.get('/progress', async (req, res) => {
  try {
    const db = getAsyncDb();
    res.json({ answers: await getOnboardingAnswers(db, req.therapist.id) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/progress', async (req, res) => {
  try {
    const db = getAsyncDb();
    const stage = String(req.body?.stage || '').trim();
    const response = String(req.body?.response || '').trim();
    if (!ONBOARDING_STAGES.includes(stage)) return res.status(400).json({ error: 'valid stage is required' });
    if (response.length < 2) return res.status(400).json({ error: 'response is required' });
    if (response.length > 4000) return res.status(400).json({ error: 'response too long' });

    const category = `stage_${stage}`;
    const existing = await db.get(
      `SELECT id FROM assistant_memories
        WHERE therapist_id = ?
          AND memory_type = 'onboarding_progress'
          AND category = ?
          AND archived_at IS NULL`,
      req.therapist.id,
      category,
    );

    if (existing) {
      await db.run(
        `UPDATE assistant_memories
            SET content = ?, last_observed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        response,
        existing.id,
      );
    } else {
      await db.insert(
        `INSERT INTO assistant_memories
          (therapist_id, memory_type, category, content, source, scope_type, surface, confidence, pinned)
         VALUES (?, 'onboarding_progress', ?, ?, 'explicit', 'clinician', 'miwa_chat', 1, 1)`,
        req.therapist.id,
        category,
        response,
      );
    }

    await persistIfNeeded();
    res.json({ ok: true, answers: await getOnboardingAnswers(db, req.therapist.id) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/onboarding/soul
// Body: { response: "the therapist's free-form answer to the intro questions" }
router.post('/soul', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { response } = req.body || {};
    if (!response || typeof response !== 'string' || response.trim().length < 5) {
      return res.status(400).json({ error: 'response is required' });
    }

    const therapist = await db.get(
      'SELECT id, first_name, full_name, user_role FROM therapists WHERE id = ?',
      req.therapist.id
    );
    const firstName = therapist?.first_name || therapist?.full_name?.split(' ')[0] || 'the clinician';
    const userRole = therapist?.user_role || 'licensed';

    const systemPrompt = `You are Miwa, a clinical copilot. The clinician has just answered your intro interview — a set of ~10 questions about who they are, how they work, and how they want you to show up.

Your job: distill their answer into a clean SOUL.md markdown document. This document will be injected into your system prompt for every future conversation, so it should be compact, scannable, and USEFUL.

STRICT FORMAT — use this structure exactly:

## Identity
[One line: preferred name / how they want to be addressed, license type + years in practice if given. Example: "Call me Sam. LMFT, 8 years in private practice."]

## Populations & Specialties
[Who they work with — populations, age ranges, presenting concerns, individual vs couples vs family. One or two sentences.]

## Therapeutic Orientation
[Their primary orientation(s) and any specific frameworks/modalities they use — one or two sentences.]

## Documentation Preferences
[Note format they prefer (SOAP/DAP/BIRP/narrative), anything they always want included, anything to avoid. One or two sentences.]

## What They Want From Miwa
[Their top 1-3 priorities for how Miwa should help — notes, clinical thinking, admin, outreach, etc.]

## Communication Style
[Verbosity (concise/balanced/detailed) and tone (warm/clinical/direct/etc.) in 1-2 sentences.]

## Hard Rules (must follow)
- [Any explicit "never do X" rules, pet peeves, or corrections they gave]
- [One per bullet]
- [Skip this section if none given]

## Working Style Notes
- [Setting (private practice / agency / telehealth), values, training lineage, anything else they mentioned that doesn't fit the sections above]
- [One bullet each]

RULES:
- Be faithful to what they said. Don't invent preferences they didn't express.
- If a section wasn't addressed, write "(not specified — will learn over time)" as its content.
- Keep the whole document under 450 words.
- Use simple, clear language. Prefer their own phrasing where possible.
- NO preamble, NO meta-commentary. Start directly with "## Identity".`;

    const userPrompt = `The clinician is ${firstName} (${userRole}).

Their answer to the intro interview:
"""
${response.trim().slice(0, 8000)}
"""

Write their SOUL.md profile now.`;

    const soulMd = await callAI(
      MODELS.AZURE_MAIN,
      systemPrompt,
      userPrompt,
      1500,
      { therapistId: req.therapist.id, kind: 'onboarding_soul' }
    );

    // Save the profile + mark onboarding complete
    await db.run(
      'UPDATE therapists SET soul_markdown = ?, onboarding_completed = 1 WHERE id = ?',
      soulMd, req.therapist.id
    );
    await persistIfNeeded();

    // Generate a warm confirmation message
    const confirmation = `Got it, ${firstName} — I've saved your profile. 🌿

From here on I'll refer to it in every conversation. You can see it or update it anytime in **Settings → Assistant**.

Ready to get started. Try asking me something like *"what's on my schedule today"* or *"show me my caseload."*`;

    res.json({
      ok: true,
      soul_markdown: soulMd,
      message: confirmation,
    });
  } catch (err) {
    console.error('[onboarding] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Trainee onboarding wizard (5-screen flow at /t/welcome)
// State columns: therapists.onboarding_step (0..6),
// therapists.onboarding_skipped_steps (TEXT JSON), therapists.onboarded_at.
// All these routes share the requireAuth middleware applied above.
// ──────────────────────────────────────────────────────────────────────────────

const TRAINEE_TOTAL_STEPS = 5;
const TRAINEE_COMPLETE_STEP = 6;

function parseSkipped(text) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

function serializeSkipped(arr) {
  const cleaned = Array.isArray(arr) ? Array.from(new Set(arr.filter((n) => Number.isInteger(n)))) : [];
  return JSON.stringify(cleaned);
}

async function loadTraineeRow(db, id) {
  return db.get(
    `SELECT id, email, first_name, last_name, full_name, credential_type,
            workspace_mode, training_program, expected_graduation_year,
            school_email, school_email_verified,
            tracks_school_hours, tracks_bbs_hours,
            onboarding_step, onboarded_at, onboarding_skipped_steps,
            created_at
       FROM therapists WHERE id = ?`,
    id,
  );
}

async function loadSupervisorsForTherapist(db, therapistId) {
  return db.all(
    `SELECT id, role, name, email, site_name, created_at
       FROM trainee_supervisors
      WHERE therapist_id = ?
      ORDER BY role ASC, id ASC`,
    therapistId,
  );
}

async function buildTraineeState(db, therapistId) {
  const row = await loadTraineeRow(db, therapistId);
  if (!row) return null;
  const supervisors = await loadSupervisorsForTherapist(db, therapistId);
  return {
    step: row.onboarding_step || 0,
    completed: (row.onboarding_step || 0) >= TRAINEE_COMPLETE_STEP,
    onboarded_at: row.onboarded_at || null,
    skipped_steps: parseSkipped(row.onboarding_skipped_steps),
    credential_type: row.credential_type || 'licensed',
    data: {
      first_name: row.first_name || null,
      last_name: row.last_name || null,
      full_name: row.full_name || null,
      school_email: row.school_email || null,
      school_email_verified: !!row.school_email_verified,
      training_program: row.training_program || null,
      expected_graduation_year: row.expected_graduation_year || null,
      // null means "not asked yet" — the wizard shows defaults in that case
      tracks_school_hours: row.tracks_school_hours == null ? null : !!row.tracks_school_hours,
      tracks_bbs_hours: row.tracks_bbs_hours == null ? null : !!row.tracks_bbs_hours,
      supervisors,
    },
  };
}

// GET /api/onboarding/state — current step + saved data
router.get('/state', async (req, res) => {
  try {
    const db = getAsyncDb();
    const state = await buildTraineeState(db, req.therapist.id);
    if (!state) return res.status(404).json({ error: 'Therapist not found' });
    res.json(state);
  } catch (err) {
    console.error('[onboarding] GET /state', err);
    res.status(500).json({ error: 'Could not load onboarding state' });
  }
});

// PUT /api/onboarding/step/:n — save data for step n, advance
router.put('/step/:n', async (req, res) => {
  try {
    const db = getAsyncDb();
    const stepNum = Number(req.params.n);
    if (!Number.isInteger(stepNum) || stepNum < 1 || stepNum > TRAINEE_TOTAL_STEPS) {
      return res.status(400).json({ error: `step must be 1..${TRAINEE_TOTAL_STEPS}` });
    }

    const therapistId = req.therapist.id;
    const therapist = await loadTraineeRow(db, therapistId);
    if (!therapist) return res.status(404).json({ error: 'Therapist not found' });

    const payload = req.body || {};

    switch (stepNum) {
      case 1: {
        // Body: { acknowledged: boolean }
        if (!payload.acknowledged) {
          return res.status(400).json({ error: 'You must acknowledge before continuing.' });
        }
        break;
      }
      case 2: {
        // Body: { school_email?, training_program?, expected_graduation_year? }
        const updates = [];
        const params = [];
        if (typeof payload.school_email === 'string' && payload.school_email.trim()) {
          const next = payload.school_email.trim().toLowerCase();
          updates.push('school_email = ?');
          params.push(next);
          if (next !== (therapist.school_email || '')) {
            // Reset verification flag when the address changes
            updates.push('school_email_verified = 0');
          }
        }
        if (typeof payload.training_program === 'string') {
          updates.push('training_program = ?');
          params.push(payload.training_program.trim() || null);
        }
        if (payload.expected_graduation_year !== undefined && payload.expected_graduation_year !== null) {
          const yr = Number(payload.expected_graduation_year);
          if (!Number.isInteger(yr) || yr < 2020 || yr > 2040) {
            return res.status(400).json({ error: 'expected_graduation_year is out of range' });
          }
          updates.push('expected_graduation_year = ?');
          params.push(yr);
        }
        if (updates.length) {
          params.push(therapistId);
          await db.run(`UPDATE therapists SET ${updates.join(', ')} WHERE id = ?`, ...params);
        }
        break;
      }
      case 3: {
        // Hours-tracking toggles → therapists.tracks_school_hours +
        // therapists.tracks_bbs_hours. NULL preserves "never asked".
        const updates = [];
        const params = [];
        if (payload.track_school !== undefined) {
          updates.push('tracks_school_hours = ?');
          params.push(payload.track_school ? 1 : 0);
        }
        if (payload.track_bbs !== undefined) {
          updates.push('tracks_bbs_hours = ?');
          params.push(payload.track_bbs ? 1 : 0);
        }
        if (updates.length) {
          params.push(therapistId);
          await db.run(`UPDATE therapists SET ${updates.join(', ')} WHERE id = ?`, ...params);
        }
        break;
      }
      case 4: {
        // Body: { site?: {name,email,site_name}, school?: {name,email} }
        const ops = [];
        if (payload.site && typeof payload.site === 'object') ops.push({ role: 'site', ...payload.site });
        if (payload.school && typeof payload.school === 'object') ops.push({ role: 'school', ...payload.school });
        for (const sup of ops) {
          const name = String(sup.name || '').trim() || null;
          const email = String(sup.email || '').trim().toLowerCase() || null;
          const siteName = sup.role === 'site' ? (String(sup.site_name || '').trim() || null) : null;
          if (!name && !email && !siteName) continue;
          const existing = await db.get(
            `SELECT id FROM trainee_supervisors WHERE therapist_id = ? AND role = ?`,
            therapistId, sup.role,
          );
          if (existing) {
            await db.run(
              `UPDATE trainee_supervisors
                  SET name = ?, email = ?, site_name = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
              name, email, siteName, existing.id,
            );
          } else {
            await db.insert(
              `INSERT INTO trainee_supervisors (therapist_id, role, name, email, site_name)
               VALUES (?, ?, ?, ?, ?)`,
              therapistId, sup.role, name, email, siteName,
            );
          }
        }
        break;
      }
      case 5: {
        // The screen-5 actions (real case / sample case / skip) are handled by
        // POST /api/patients and POST /api/onboarding/sample-case directly.
        // This PUT just advances past the screen.
        break;
      }
    }

    const nextStep = Math.max(therapist.onboarding_step || 0, stepNum);
    // Saving a step removes it from the skipped list
    const skipped = parseSkipped(therapist.onboarding_skipped_steps).filter((n) => n !== stepNum);
    await db.run(
      `UPDATE therapists
          SET onboarding_step = ?, onboarding_skipped_steps = ?
        WHERE id = ?`,
      nextStep, serializeSkipped(skipped), therapistId,
    );
    await persistIfNeeded();

    res.json(await buildTraineeState(db, therapistId));
  } catch (err) {
    console.error('[onboarding] PUT /step', err);
    res.status(500).json({ error: 'Could not save onboarding step' });
  }
});

// POST /api/onboarding/skip/:n — mark step skipped, advance past it
router.post('/skip/:n', async (req, res) => {
  try {
    const db = getAsyncDb();
    const stepNum = Number(req.params.n);
    if (!Number.isInteger(stepNum) || stepNum < 1 || stepNum > TRAINEE_TOTAL_STEPS) {
      return res.status(400).json({ error: `step must be 1..${TRAINEE_TOTAL_STEPS}` });
    }
    const therapistId = req.therapist.id;
    const therapist = await loadTraineeRow(db, therapistId);
    if (!therapist) return res.status(404).json({ error: 'Therapist not found' });

    const skipped = parseSkipped(therapist.onboarding_skipped_steps);
    if (!skipped.includes(stepNum)) skipped.push(stepNum);
    const nextStep = Math.max(therapist.onboarding_step || 0, stepNum);
    await db.run(
      `UPDATE therapists
          SET onboarding_step = ?, onboarding_skipped_steps = ?
        WHERE id = ?`,
      nextStep, serializeSkipped(skipped), therapistId,
    );
    await persistIfNeeded();

    res.json(await buildTraineeState(db, therapistId));
  } catch (err) {
    console.error('[onboarding] POST /skip', err);
    res.status(500).json({ error: 'Could not skip onboarding step' });
  }
});

// POST /api/onboarding/complete — mark wizard finished
router.post('/complete', async (req, res) => {
  try {
    const db = getAsyncDb();
    await db.run(
      `UPDATE therapists
          SET onboarding_step = ?, onboarded_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      TRAINEE_COMPLETE_STEP, req.therapist.id,
    );
    await persistIfNeeded();
    res.json(await buildTraineeState(db, req.therapist.id));
  } catch (err) {
    console.error('[onboarding] POST /complete', err);
    res.status(500).json({ error: 'Could not complete onboarding' });
  }
});

// POST /api/onboarding/school-email/verify-send — send verification link to
// the trainee's own school email. Body: { email? } — if provided, replaces the
// saved school_email first.
router.post('/school-email/verify-send', async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapistId = req.therapist.id;
    const therapist = await loadTraineeRow(db, therapistId);
    if (!therapist) return res.status(404).json({ error: 'Therapist not found' });

    const incoming = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const targetEmail = incoming || therapist.school_email || '';
    if (!targetEmail) {
      return res.status(400).json({ error: 'No school email on file. Add one first.' });
    }

    if (incoming && incoming !== (therapist.school_email || '')) {
      await db.run(
        `UPDATE therapists SET school_email = ?, school_email_verified = 0 WHERE id = ?`,
        incoming, therapistId,
      );
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.insert(
      `INSERT INTO credential_verifications (therapist_id, token, verify_email, expires_at)
       VALUES (?, ?, ?, ?)`,
      therapistId, token, targetEmail, expiresAt,
    );
    await persistIfNeeded();

    try {
      await sendSchoolEmailVerification({
        schoolEmail: targetEmail,
        firstName: therapist.first_name,
        fullName: therapist.full_name,
        token,
      });
    } catch (mailErr) {
      console.error('[onboarding] verify-send email error:', mailErr.message);
      // Non-fatal — the link record still exists; trainee can resend.
    }

    res.json({ ok: true, sent_to: targetEmail });
  } catch (err) {
    console.error('[onboarding] POST /school-email/verify-send', err);
    res.status(500).json({ error: 'Could not send verification email' });
  }
});

// POST /api/onboarding/sample-case — create the pre-populated sample client.
// Idempotent: returns the existing sample case if one already exists.
router.post('/sample-case', async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapistId = req.therapist.id;

    const existing = await db.get(
      `SELECT id, client_id, display_name, is_sample FROM patients
        WHERE therapist_id = ? AND is_sample = 1
        ORDER BY created_at DESC LIMIT 1`,
      therapistId,
    );
    if (existing) return res.json({ ok: true, patient: existing, reused: true });

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let clientId = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      let candidate = 'S';
      for (let i = 0; i < 6; i += 1) candidate += chars[Math.floor(Math.random() * chars.length)];
      const taken = await db.get(
        `SELECT id FROM patients WHERE therapist_id = ? AND client_id = ?`,
        therapistId, candidate,
      );
      if (!taken) { clientId = candidate; break; }
    }
    if (!clientId) clientId = `S${Date.now().toString(36).toUpperCase().slice(-6)}`;

    const inserted = await db.insert(
      `INSERT INTO patients (
         client_id, therapist_id, display_name, first_name, last_name,
         age, gender, age_range, client_type,
         presenting_concerns, diagnoses, treatment_goals,
         family_social_history, risk_screening,
         notes, is_sample
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      clientId, therapistId,
      'Sample Client — M.G.',
      'Maria', 'G.',
      32, 'Female', '30-39', 'individual',
      'Generalized anxiety with worry that spikes around work and family obligations. Reports trouble falling asleep most nights.',
      'F41.1 Generalized Anxiety Disorder (provisional)',
      'Reduce average GAD-7 score by 50% over 12 weeks. Build a daily wind-down routine. Identify and challenge two core anxious thoughts per week.',
      'Lives with partner; two younger siblings she helps support. Mother has a history of anxiety.',
      'No current SI/HI. No history of self-harm. Denies access to means.',
      'Sample client created by the trainee onboarding wizard. Safe to delete anytime.',
    );

    const patientId = inserted.lastInsertRowid;

    try {
      await db.insert(
        `INSERT INTO sessions (
           patient_id, therapist_id, session_date, note_format, duration_minutes,
           subjective, objective, assessment, plan
         ) VALUES (?, ?, datetime('now', '-14 days'), 'SOAP', 50, ?, ?, ?, ?)`,
        patientId, therapistId,
        'Client reports persistent worry through the week, sleep onset 60-90 min. Tearful when discussing caretaking pressure.',
        'Affect anxious, congruent. Speech rate elevated. Engaged collaboratively.',
        'GAD presentation with moderate functional impact at work. Pt motivated for skills work.',
        'Introduced grounding (5-4-3-2-1) and sleep hygiene plan. Assigned worry-time log for the week.',
      );
      await db.insert(
        `INSERT INTO sessions (
           patient_id, therapist_id, session_date, note_format, duration_minutes,
           subjective, objective, assessment, plan
         ) VALUES (?, ?, datetime('now', '-7 days'), 'SOAP', 50, ?, ?, ?, ?)`,
        patientId, therapistId,
        'Worry-time log used 4/7 days. Sleep onset improved to 30-45 min. Still ruminating after evening calls with mother.',
        'Mood improved from prior session. Brighter affect. Reflective when reviewing log.',
        'Modest gains on sleep + worry interval. Boundary work with family emerging as treatment target.',
        'Introduced cognitive restructuring on caretaking thoughts. Continue log. Add 10-min mindful walk x4/week.',
      );
    } catch (sessErr) {
      console.warn('[onboarding] sample sessions seed failed:', sessErr.message);
    }
    await persistIfNeeded();

    const row = await db.get(
      `SELECT id, client_id, display_name, is_sample FROM patients WHERE id = ?`,
      patientId,
    );
    res.status(201).json({ ok: true, patient: row });
  } catch (err) {
    console.error('[onboarding] POST /sample-case', err);
    res.status(500).json({ error: 'Could not create sample case' });
  }
});

module.exports = router;
