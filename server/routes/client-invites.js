// Clinician invite-code routes. Clinicians generate a MIWA-XXXX-XXXX
// code, hand it to the client out-of-band (verbal, text, email — clinician's
// choice; Miwa does not send anything), and the client redeems it at the
// portal signup page (POST /api/client-auth/redeem in client-auth.js).
//
// Gated to associate + licensed credential types ("clinician mode").
// Trainees get 403 on every endpoint; the panel in PatientDetail is hidden
// for trainees on the frontend too.

const express = require('express');
const crypto = require('crypto');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// All routes require an authenticated therapist
router.use(requireAuth);

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const MAX_ACTIVE_PER_PATIENT = 3;
const MAX_GENERATED_PER_DAY = 20;

// Ambiguous characters (0/O, 1/I, L) are excluded so a client transcribing the
// code over the phone doesn't confuse them.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode() {
  const bytes = crypto.randomBytes(8);
  const chars = [];
  for (let i = 0; i < 8; i += 1) {
    chars.push(CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]);
  }
  return `MIWA-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}`;
}

function isLicensed(req) {
  return (req.therapist?.credential_type || 'licensed') === 'licensed';
}

function licensedOnly(req, res, next) {
  if (!isLicensed(req)) {
    return res.status(403).json({ error: 'Client portal invites are a licensed-mode feature.' });
  }
  next();
}

// Associate + licensed clinicians (Section 4 will migrate all routes to this).
function isClinician(req) {
  return ['associate', 'licensed'].includes(req.therapist?.credential_type || 'licensed');
}

function clinicianOnly(req, res, next) {
  if (!isClinician(req)) {
    return res.status(403).json({ error: 'Client portal invites require a clinician account (associate or licensed).' });
  }
  next();
}

async function logInviteEvent(db, { therapistId, eventType, message, meta }) {
  try {
    await db.insert(
      'INSERT INTO event_logs (therapist_id, event_type, status, message, meta_json) VALUES (?, ?, ?, ?, ?)',
      therapistId,
      eventType,
      'success',
      message,
      meta ? JSON.stringify(meta) : null,
    );
  } catch {}
}

// Lazy expiry sweep: flip pending invites past their expires_at to 'expired'
// before returning state. Cheap O(N) per call but bounded — only the rows
// for the requesting therapist + patient are touched.
async function expireStaleInvites(db, { therapistId, patientId }) {
  const where = patientId
    ? 'therapist_id = ? AND patient_id = ?'
    : 'therapist_id = ?';
  const params = patientId ? [therapistId, patientId] : [therapistId];
  await db.run(
    `UPDATE client_invites
        SET status = 'expired'
      WHERE ${where}
        AND status = 'pending'
        AND datetime(expires_at) < datetime('now')`,
    ...params,
  );
}

async function loadInvite(db, { therapistId, id }) {
  return db.get(
    `SELECT ci.*, p.client_id AS patient_client_id, p.display_name AS patient_display_name,
            cpa.email AS claimed_email
       FROM client_invites ci
       JOIN patients p ON p.id = ci.patient_id AND p.therapist_id = ci.therapist_id
       LEFT JOIN client_portal_accounts cpa ON cpa.id = ci.claimed_by_client_user_id
      WHERE ci.id = ? AND ci.therapist_id = ?`,
    id, therapistId,
  );
}

function serializeInvite(row) {
  if (!row) return null;
  return {
    id: row.id,
    patient_id: row.patient_id,
    therapist_id: row.therapist_id,
    code: row.code,
    status: row.status,
    generated_at: row.generated_at,
    expires_at: row.expires_at,
    claimed_at: row.claimed_at,
    claimed_by_client_user_id: row.claimed_by_client_user_id,
    claimed_email: row.claimed_email || null,
    patient_display_name: row.patient_display_name || row.patient_client_id || null,
  };
}

// POST /api/client-invites — generate a new code for a patient
// Body: { patient_id }
router.post('/', licensedOnly, async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapistId = req.therapist.id;
    const patientId = Number(req.body?.patient_id);
    if (!Number.isInteger(patientId) || patientId < 1) {
      return res.status(400).json({ error: 'patient_id is required.' });
    }

    const patient = await db.get(
      'SELECT id, display_name, client_id FROM patients WHERE id = ? AND therapist_id = ?',
      patientId, therapistId,
    );
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });

    // Rate-limit: max N generations per clinician per day
    await expireStaleInvites(db, { therapistId });
    const todayCount = await db.get(
      `SELECT COUNT(*) AS n FROM client_invites
        WHERE therapist_id = ?
          AND datetime(generated_at) >= datetime('now', '-1 day')`,
      therapistId,
    );
    if ((todayCount?.n || 0) >= MAX_GENERATED_PER_DAY) {
      return res.status(429).json({ error: `Daily limit of ${MAX_GENERATED_PER_DAY} invite codes reached. Try again tomorrow.` });
    }

    // Auto-revoke older pending codes for this patient so MAX_ACTIVE_PER_PATIENT
    // is enforced. Newest one wins; older pending entries flip to 'revoked'.
    const activePending = await db.all(
      `SELECT id FROM client_invites
        WHERE patient_id = ? AND therapist_id = ? AND status = 'pending'
        ORDER BY generated_at DESC`,
      patientId, therapistId,
    );
    if (activePending.length >= MAX_ACTIVE_PER_PATIENT) {
      const toRevoke = activePending.slice(MAX_ACTIVE_PER_PATIENT - 1);
      for (const row of toRevoke) {
        await db.run(`UPDATE client_invites SET status = 'revoked' WHERE id = ?`, row.id);
        await logInviteEvent(db, {
          therapistId,
          eventType: 'client_invite.revoked',
          message: 'Auto-revoked: superseded by newer code.',
          meta: { invite_id: row.id, patient_id: patientId },
        });
      }
    } else if (activePending.length > 0) {
      // Even if we're under the cap, revoke older pending codes so there's
      // only one active code per patient at a time in the common case. This
      // matches the spec's "max 3 active codes per patient" as an upper
      // bound, with the typical state being exactly 1.
      for (const row of activePending) {
        await db.run(`UPDATE client_invites SET status = 'revoked' WHERE id = ?`, row.id);
        await logInviteEvent(db, {
          therapistId,
          eventType: 'client_invite.revoked',
          message: 'Auto-revoked: superseded by newer code.',
          meta: { invite_id: row.id, patient_id: patientId },
        });
      }
    }

    // Generate a unique code (loop on collision; CODE_ALPHABET has ~32^8
    // combinations so practical collision risk is near-zero).
    let code = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = generateCode();
      const taken = await db.get('SELECT id FROM client_invites WHERE code = ?', candidate);
      if (!taken) { code = candidate; break; }
    }
    if (!code) return res.status(500).json({ error: 'Could not generate a unique code. Try again.' });

    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const inserted = await db.insert(
      `INSERT INTO client_invites (patient_id, therapist_id, code, expires_at, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      patientId, therapistId, code, expiresAt,
    );
    await persistIfNeeded();
    await logInviteEvent(db, {
      therapistId,
      eventType: 'client_invite.generated',
      message: 'New client portal invite code generated.',
      meta: { invite_id: inserted.lastInsertRowid, patient_id: patientId },
    });

    const row = await loadInvite(db, { therapistId, id: inserted.lastInsertRowid });
    return res.status(201).json({ invite: serializeInvite(row) });
  } catch (err) {
    console.error('[client-invites] POST /', err);
    return res.status(500).json({ error: 'Could not generate invite code.' });
  }
});

// GET /api/client-invites?patient_id=N — list active invites for a patient
router.get('/', licensedOnly, async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapistId = req.therapist.id;
    const patientId = Number(req.query?.patient_id);
    if (!Number.isInteger(patientId) || patientId < 1) {
      return res.status(400).json({ error: 'patient_id query param is required.' });
    }
    const patient = await db.get(
      'SELECT id FROM patients WHERE id = ? AND therapist_id = ?',
      patientId, therapistId,
    );
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });

    await expireStaleInvites(db, { therapistId, patientId });

    const rows = await db.all(
      `SELECT ci.*, p.client_id AS patient_client_id, p.display_name AS patient_display_name,
              cpa.email AS claimed_email
         FROM client_invites ci
         JOIN patients p ON p.id = ci.patient_id AND p.therapist_id = ci.therapist_id
         LEFT JOIN client_portal_accounts cpa ON cpa.id = ci.claimed_by_client_user_id
        WHERE ci.therapist_id = ? AND ci.patient_id = ?
        ORDER BY ci.generated_at DESC`,
      therapistId, patientId,
    );
    res.json({ invites: rows.map(serializeInvite) });
  } catch (err) {
    console.error('[client-invites] GET /', err);
    res.status(500).json({ error: 'Could not load invites.' });
  }
});

// DELETE /api/client-invites/:id — revoke a pending invite
router.delete('/:id', licensedOnly, async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapistId = req.therapist.id;
    const id = Number(req.params.id);
    const invite = await loadInvite(db, { therapistId, id });
    if (!invite) return res.status(404).json({ error: 'Invite not found.' });
    if (invite.status !== 'pending') {
      return res.status(400).json({ error: `Invite is already ${invite.status}.` });
    }
    await db.run(`UPDATE client_invites SET status = 'revoked' WHERE id = ?`, id);
    await persistIfNeeded();
    await logInviteEvent(db, {
      therapistId,
      eventType: 'client_invite.revoked',
      message: 'Clinician revoked invite code.',
      meta: { invite_id: id, patient_id: invite.patient_id },
    });
    const fresh = await loadInvite(db, { therapistId, id });
    res.json({ invite: serializeInvite(fresh) });
  } catch (err) {
    console.error('[client-invites] DELETE /:id', err);
    res.status(500).json({ error: 'Could not revoke invite.' });
  }
});

// POST /api/client-invites/unlink — detach a claimed portal account from a patient
// Body: { patient_id }
// Available to associate + licensed clinicians (not trainees).
// Deactivates the portal account so the client can no longer log in.
// A new invite can be generated to reconnect after unlinking.
router.post('/unlink', clinicianOnly, async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapistId = req.therapist.id;
    const patientId = Number(req.body?.patient_id);
    if (!Number.isInteger(patientId) || patientId < 1) {
      return res.status(400).json({ error: 'patient_id is required.' });
    }

    // Explicit ownership check: 404 for nonexistent patient, 403 for another
    // clinician's patient (prevents silent enumeration of patient IDs).
    const patient = await db.get('SELECT id, therapist_id FROM patients WHERE id = ?', patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });
    if (patient.therapist_id !== therapistId) {
      return res.status(403).json({ error: 'Not authorized to unlink this patient\'s portal account.' });
    }

    // Find the active portal account linked to this patient.
    const account = await db.get(
      "SELECT id FROM client_portal_accounts WHERE patient_id = ? AND therapist_id = ? AND status = 'active'",
      patientId, therapistId,
    );
    if (!account) {
      return res.status(404).json({ error: 'No active portal account linked to this patient.' });
    }

    // Clear the explicit link column and deactivate the account so the client
    // can no longer log in. patient_id is NOT NULL so it stays for audit trail.
    await db.run(
      `UPDATE client_portal_accounts
          SET linked_patient_id = NULL, status = 'deactivated', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      account.id,
    );

    // Flip any claimed invites for this patient to revoked so the UI shows
    // the fresh "No active invite" state immediately.
    await db.run(
      `UPDATE client_invites SET status = 'revoked'
        WHERE patient_id = ? AND therapist_id = ? AND status = 'claimed'`,
      patientId, therapistId,
    );

    await persistIfNeeded();
    await logInviteEvent(db, {
      therapistId,
      eventType: 'portal_account_unlinked',
      message: 'Clinician unlinked portal account from patient.',
      meta: { patient_id: patientId, account_id: account.id },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[client-invites] POST /unlink', err);
    res.status(500).json({ error: 'Could not unlink portal account.' });
  }
});

module.exports = router;
