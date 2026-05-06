const crypto = require('crypto');
const { persistIfNeeded } = require('../db/asyncDb');

function inviteHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function ensurePortalForPatient(db, patient) {
  const email = String(patient?.email || '').trim().toLowerCase();
  const phone = String(patient?.phone || '').trim() || null;
  if (!patient?.id || !patient?.therapist_id || !email) return false;

  const existing = await db.get(
    'SELECT id FROM client_portal_accounts WHERE patient_id = ? AND therapist_id = ?',
    patient.id,
    patient.therapist_id,
  );
  if (!existing) {
    await db.insert(
      `INSERT INTO client_portal_accounts
         (patient_id, therapist_id, email, phone, display_name, status)
       VALUES (?, ?, ?, ?, ?, 'invited')`,
      patient.id,
      patient.therapist_id,
      email,
      phone,
      patient.display_name || patient.client_id,
    );
  }

  const activeInvite = await db.get(
    `SELECT id FROM client_portal_invites
     WHERE patient_id = ? AND therapist_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > datetime('now')
     ORDER BY created_at DESC LIMIT 1`,
    patient.id,
    patient.therapist_id,
  );
  if (!activeInvite) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.insert(
      `INSERT INTO client_portal_invites
         (patient_id, therapist_id, email, phone, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      patient.id,
      patient.therapist_id,
      email,
      phone,
      inviteHash(token),
      expiresAt,
    );
  }
  return true;
}

async function backfillClientPortalAccounts(db) {
  const rows = await db.all(
    `SELECT id, therapist_id, client_id, display_name, email, phone
     FROM patients
     WHERE email IS NOT NULL AND trim(email) != ''`,
  );
  let prepared = 0;
  for (const patient of rows || []) {
    try {
      if (await ensurePortalForPatient(db, patient)) prepared += 1;
    } catch (err) {
      console.error('[client-portal/backfill] patient failed', patient.id, err.message);
    }
  }
  if (prepared > 0) await persistIfNeeded();
  return { prepared };
}

module.exports = { backfillClientPortalAccounts, ensurePortalForPatient };
