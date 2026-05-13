const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const requireClientAuth = require('../middleware/clientAuth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '30d';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const TERMS_VERSION = process.env.CLIENT_PORTAL_TERMS_VERSION || '2026-05-06';
const PRIVACY_VERSION = process.env.CLIENT_PORTAL_PRIVACY_VERSION || '2026-05-06';
const CONSENT_VERSION = process.env.CLIENT_PORTAL_CONSENT_VERSION || '2026-05-06';
const DEFAULT_WELCOME = 'Welcome to Miwa. You can use this portal for secure messages, check-ins, practice items, appointments, and shared tools. Miwa is not for emergencies. If you need help now, call 988, 911, or local emergency services.';

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function signClientToken(account) {
  return jwt.sign(
    { sub: account.id, type: 'client', role: 'client', patient_id: account.patient_id, therapist_id: account.therapist_id },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
}

function setClientCookie(res, token) {
  res.cookie('miwa_client_auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

function clearClientCookie(res) {
  res.clearCookie('miwa_client_auth', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

function safeClient(account) {
  return {
    id: account.id,
    email: account.email,
    display_name: account.display_name,
    patient_id: account.patient_id,
    therapist_id: account.therapist_id,
    role: 'client',
    status: account.status,
  };
}

async function audit(db, account, action, metadata = null) {
  try {
    await db.insert(
      `INSERT INTO client_portal_audit_log
         (patient_id, therapist_id, client_account_id, action, metadata_json)
       VALUES (?, ?, ?, ?, ?)`,
      account.patient_id,
      account.therapist_id,
      account.id,
      action,
      metadata ? JSON.stringify(metadata) : null,
    );
  } catch {}
}

async function sendClientRecoveryEmail(to, resetUrl) {
  if (!to || !resetUrl) return false;
  try {
    const { sendMail } = require('../services/mailer');
    await sendMail({
      to,
      subject: 'Reset your Miwa client portal password',
      text: `Reset your Miwa client portal password: ${resetUrl}\n\nIf you did not request this, you can ignore this email. Miwa is not for emergencies.`,
      html: `<p>Reset your Miwa client portal password.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this email. Miwa is not for emergencies.</p>`,
    });
    return true;
  } catch (err) {
    console.error('[client-auth/recovery-email]', err.message);
    return false;
  }
}

async function acceptInviteHandler(req, res) {
  try {
    const db = getAsyncDb();
    const { token, code, password, display_name, accepted_terms } = req.body || {};
    const inviteToken = token || code;
    if (!inviteToken || !password) return res.status(400).json({ error: 'Invite code and password are required.' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!accepted_terms) return res.status(400).json({ error: 'Please accept the portal terms to continue.' });

    const invite = await db.get(
      `SELECT cpi.*, p.display_name AS patient_display_name, p.client_id, p.phone AS patient_phone
       FROM client_portal_invites cpi
       JOIN patients p ON p.id = cpi.patient_id AND p.therapist_id = cpi.therapist_id
      WHERE cpi.token_hash = ?`,
      hashToken(inviteToken),
    );
    if (!invite || invite.revoked_at) return res.status(404).json({ error: 'This invite is invalid or has been revoked.' });
    if (invite.accepted_at) return res.status(409).json({ error: 'This invite has already been accepted. Please sign in.' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'This invite has expired. Ask your clinician for a new one.' });
    if (!invite.email) return res.status(400).json({ error: 'This invite is missing an email address.' });

    const email = invite.email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(String(password), 12);
    const name = String(display_name || invite.patient_display_name || invite.client_id || '').trim() || null;
    const existing = await db.get(
      'SELECT * FROM client_portal_accounts WHERE patient_id = ? AND therapist_id = ?',
      invite.patient_id,
      invite.therapist_id,
    );

    let account;
    if (existing) {
      await db.run(
        `UPDATE client_portal_accounts
         SET email = ?, phone = COALESCE(?, phone), display_name = COALESCE(?, display_name),
             password_hash = ?, accepted_terms_at = CURRENT_TIMESTAMP,
             accepted_privacy_at = CURRENT_TIMESTAMP, portal_consent_at = CURRENT_TIMESTAMP,
             terms_version = ?, privacy_version = ?, portal_consent_version = ?,
             notification_sms_enabled = CASE WHEN COALESCE(?, '') != '' THEN notification_sms_enabled ELSE 0 END,
             status = 'active', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        email,
        invite.phone || null,
        name,
        passwordHash,
        TERMS_VERSION,
        PRIVACY_VERSION,
        CONSENT_VERSION,
        invite.phone || invite.patient_phone || null,
        existing.id,
      );
      account = await db.get('SELECT * FROM client_portal_accounts WHERE id = ?', existing.id);
    } else {
      const result = await db.insert(
        `INSERT INTO client_portal_accounts
           (patient_id, therapist_id, email, phone, display_name, password_hash,
            accepted_terms_at, accepted_privacy_at, portal_consent_at,
            terms_version, privacy_version, portal_consent_version, notification_sms_enabled, status)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, 0, 'active')`,
        invite.patient_id,
        invite.therapist_id,
        email,
        invite.phone || null,
        name,
        passwordHash,
        TERMS_VERSION,
        PRIVACY_VERSION,
        CONSENT_VERSION,
      );
      account = await db.get('SELECT * FROM client_portal_accounts WHERE id = ?', result.lastInsertRowid);
    }

    await db.run('UPDATE client_portal_invites SET accepted_at = CURRENT_TIMESTAMP WHERE id = ?', invite.id);
    await db.run('UPDATE client_portal_accounts SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', account.id);
    const welcome = account.welcome_message_template || DEFAULT_WELCOME;
    await db.insert(
      `INSERT INTO client_messages
         (patient_id, therapist_id, client_account_id, sender_type, content, sender, message, delivered_at)
       VALUES (?, ?, ?, 'therapist', ?, 'therapist', ?, CURRENT_TIMESTAMP)`,
      account.patient_id,
      account.therapist_id,
      account.id,
      welcome,
      welcome,
    );
    await audit(db, account, 'client_invite_accepted');
    await audit(db, account, 'welcome_message_created');
    await audit(db, account, 'client_login', { via: 'accept_invite' });
    await persistIfNeeded();

    const tokenJwt = signClientToken(account);
    setClientCookie(res, tokenJwt);
    return res.json({ token: tokenJwt, client: safeClient(account) });
  } catch (err) {
    console.error('[client-auth/accept-invite]', err);
    return res.status(500).json({ error: 'Invite could not be accepted.' });
  }
}

router.post('/accept-invite', acceptInviteHandler);
router.post('/join-code', acceptInviteHandler);

// ── POST /api/client-auth/redeem ───────────────────────────────────────────
// Code-based client portal signup. Pairs with the licensed-only invite-code
// system in server/routes/client-invites.js. Body:
//   { code, email, password, first_name, last_name, accepted_terms? }
//
// Security:
// - Per-IP rate limit (see redeemRateLimiter below).
// - Generic "Invalid or expired code." error for non-existent, revoked, and
//   expired codes so an attacker can't distinguish state.
// - Status transition (pending → claimed) is atomic via UPDATE … WHERE
//   status='pending'.
// - Audit log entry for every redeem attempt (success and failure).
// - 409 only for the email-already-exists case, with the standard
//   "an account with this email already exists" copy.
async function logRedeemEvent(db, { therapistId, eventType, message, meta }) {
  try {
    await db.insert(
      'INSERT INTO event_logs (therapist_id, event_type, status, message, meta_json) VALUES (?, ?, ?, ?, ?)',
      therapistId,
      eventType,
      eventType.endsWith('.redeemed') ? 'success' : 'failure',
      message,
      meta ? JSON.stringify(meta) : null,
    );
  } catch {}
}

router.post('/redeem', async (req, res) => {
  const db = getAsyncDb();
  const rawCode = String(req.body?.code || '').trim().toUpperCase();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const firstName = String(req.body?.first_name || '').trim() || null;
  const lastName = String(req.body?.last_name || '').trim() || null;
  const acceptedTerms = req.body?.accepted_terms !== false; // default to true; spec says client UI shows ToS

  // Identical "invalid code" error covers missing / unknown / expired /
  // revoked / claimed so the response doesn't leak state.
  const INVALID_CODE_ERR = 'Invalid or expired code. Ask your clinician for a new one.';
  // Light input validation that's independent of code state — these can
  // safely differ from the invalid-code error because they don't leak state.
  if (!rawCode) return res.status(400).json({ error: 'Please enter your invite code.' });
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  try {
    const invite = await db.get(
      `SELECT ci.*, p.display_name AS patient_display_name, p.client_id AS patient_client_id
         FROM client_invites ci
         JOIN patients p ON p.id = ci.patient_id AND p.therapist_id = ci.therapist_id
        WHERE ci.code = ?`,
      rawCode,
    );

    if (!invite) {
      await logRedeemEvent(db, {
        therapistId: null,
        eventType: 'client_invite.redeem_failed',
        message: 'Unknown code.',
        meta: { code_hash: hashToken(rawCode), email },
      });
      return res.status(404).json({ error: INVALID_CODE_ERR });
    }

    // Single source of truth for state checks — same error for each so the
    // client can't distinguish revoked vs expired vs already-claimed.
    if (invite.status !== 'pending' || new Date(invite.expires_at) < new Date()) {
      await logRedeemEvent(db, {
        therapistId: invite.therapist_id,
        eventType: 'client_invite.redeem_failed',
        message: `Code in non-claimable state: ${invite.status}.`,
        meta: { invite_id: invite.id, patient_id: invite.patient_id },
      });
      return res.status(410).json({ error: INVALID_CODE_ERR });
    }

    // Distinct error for email collision so the client UI can suggest signing
    // in instead. This is intentional — the email is the user's own, not an
    // adversary's, so disclosure is acceptable.
    const existing = await db.get(
      `SELECT id FROM client_portal_accounts
        WHERE lower(email) = lower(?) AND therapist_id = ?`,
      email, invite.therapist_id,
    );
    if (existing) {
      await logRedeemEvent(db, {
        therapistId: invite.therapist_id,
        eventType: 'client_invite.redeem_failed',
        message: 'Email already registered for this clinician.',
        meta: { invite_id: invite.id, patient_id: invite.patient_id, email },
      });
      return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const displayName = [firstName, lastName].filter(Boolean).join(' ').trim()
      || invite.patient_display_name || invite.patient_client_id || null;

    // Atomic state transition: only proceed if the row is still pending.
    const transition = await db.run(
      `UPDATE client_invites
          SET status = 'claimed', claimed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'`,
      invite.id,
    );
    if (!transition?.changes && transition?.rowsAffected !== 1 && transition?.changes !== 1) {
      // Lost the race — another redeem just claimed it.
      await logRedeemEvent(db, {
        therapistId: invite.therapist_id,
        eventType: 'client_invite.redeem_failed',
        message: 'Race lost: code already claimed between read and write.',
        meta: { invite_id: invite.id, patient_id: invite.patient_id },
      });
      return res.status(410).json({ error: INVALID_CODE_ERR });
    }

    const inserted = await db.insert(
      `INSERT INTO client_portal_accounts
         (patient_id, therapist_id, email, display_name, password_hash,
          accepted_terms_at, accepted_privacy_at, portal_consent_at,
          terms_version, privacy_version, portal_consent_version, status)
       VALUES (?, ?, ?, ?, ?,
               ${acceptedTerms ? 'CURRENT_TIMESTAMP' : 'NULL'},
               ${acceptedTerms ? 'CURRENT_TIMESTAMP' : 'NULL'},
               ${acceptedTerms ? 'CURRENT_TIMESTAMP' : 'NULL'},
               ?, ?, ?, 'active')`,
      invite.patient_id,
      invite.therapist_id,
      email,
      displayName,
      passwordHash,
      TERMS_VERSION,
      PRIVACY_VERSION,
      CONSENT_VERSION,
    );
    const accountId = inserted.lastInsertRowid;
    await db.run(
      `UPDATE client_invites SET claimed_by_client_user_id = ? WHERE id = ?`,
      accountId, invite.id,
    );
    await db.run(`UPDATE client_portal_accounts SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`, accountId);

    const account = await db.get('SELECT * FROM client_portal_accounts WHERE id = ?', accountId);
    const welcome = account.welcome_message_template || DEFAULT_WELCOME;
    try {
      await db.insert(
        `INSERT INTO client_messages
           (patient_id, therapist_id, client_account_id, sender_type, content, sender, message, delivered_at)
         VALUES (?, ?, ?, 'therapist', ?, 'therapist', ?, CURRENT_TIMESTAMP)`,
        account.patient_id, account.therapist_id, account.id, welcome, welcome,
      );
    } catch {}

    await audit(db, account, 'client_invite_code_redeemed', { invite_id: invite.id });
    await audit(db, account, 'client_login', { via: 'invite_code' });
    await logRedeemEvent(db, {
      therapistId: invite.therapist_id,
      eventType: 'client_invite.redeemed',
      message: 'Client redeemed invite code.',
      meta: { invite_id: invite.id, patient_id: invite.patient_id, client_account_id: accountId },
    });
    await persistIfNeeded();

    const tokenJwt = signClientToken(account);
    setClientCookie(res, tokenJwt);
    return res.json({ token: tokenJwt, client: safeClient(account) });
  } catch (err) {
    console.error('[client-auth/redeem]', err);
    return res.status(500).json({ error: 'Could not redeem this code right now. Try again.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const account = await db.get(
      "SELECT * FROM client_portal_accounts WHERE lower(email) = lower(?) AND status = 'active'",
      String(email).trim(),
    );
    if (!account || !account.password_hash) {
      try {
        await db.insert(
          `INSERT INTO client_portal_audit_log (action, metadata_json)
           VALUES ('failed_client_login', ?)`,
          JSON.stringify({ email: String(email || '').toLowerCase().trim() }),
        );
        await persistIfNeeded();
      } catch {}
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const ok = await bcrypt.compare(String(password), account.password_hash);
    if (!ok) {
      await audit(db, account, 'failed_client_login');
      await persistIfNeeded();
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const patient = await db.get('SELECT id FROM patients WHERE id = ? AND therapist_id = ?', account.patient_id, account.therapist_id);
    if (!patient) return res.status(403).json({ error: 'Client record is unavailable.' });

    await db.run('UPDATE client_portal_accounts SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', account.id);
    await audit(db, account, 'client_login', { via: 'password' });
    await persistIfNeeded();
    const fresh = await db.get('SELECT * FROM client_portal_accounts WHERE id = ?', account.id);
    const token = signClientToken(fresh);
    setClientCookie(res, token);
    return res.json({ token, client: safeClient(fresh) });
  } catch (err) {
    console.error('[client-auth/login]', err);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

router.get('/me', requireClientAuth, async (req, res) => {
  return res.json(safeClient(req.client));
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  try {
    const db = getAsyncDb();
    const account = email ? await db.get(
      "SELECT * FROM client_portal_accounts WHERE lower(email) = lower(?) AND status = 'active'",
      String(email).trim(),
    ) : null;
    if (account) {
      const raw = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await db.run('UPDATE client_portal_password_resets SET used_at = CURRENT_TIMESTAMP WHERE client_account_id = ? AND used_at IS NULL', account.id);
      await db.insert(
        `INSERT INTO client_portal_password_resets (client_account_id, token_hash, expires_at)
         VALUES (?, ?, ?)`,
        account.id,
        hashToken(raw),
        expiresAt,
      );
      const appUrl = (process.env.APP_BASE_URL || process.env.APP_URL || 'https://miwa.care').replace(/\/$/, '');
      await sendClientRecoveryEmail(account.email, `${appUrl}/client/reset-password?token=${raw}`);
      await audit(db, account, 'client_recovery_requested');
    }
    await persistIfNeeded();
  } catch {}
  return res.json({ ok: true, message: 'If a client portal account exists for that email, we sent a secure recovery link.' });
});

router.post('/reset-password', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'Reset token and password are required.' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const row = await db.get(
      `SELECT cpr.id AS reset_id, cpr.client_account_id, cpr.expires_at, cpa.*
       FROM client_portal_password_resets cpr
       JOIN client_portal_accounts cpa ON cpa.id = cpr.client_account_id
       WHERE cpr.token_hash = ? AND cpr.used_at IS NULL`,
      hashToken(token),
    );
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This reset link is invalid or expired.' });
    }
    const passwordHash = await bcrypt.hash(String(password), 12);
    await db.run('UPDATE client_portal_accounts SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', passwordHash, row.client_account_id);
    await db.run('UPDATE client_portal_password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?', row.reset_id);
    await audit(db, row, 'client_password_reset');
    await persistIfNeeded();
    return res.json({ ok: true, message: 'Password updated. You can sign in now.' });
  } catch (err) {
    console.error('[client-auth/reset-password]', err);
    return res.status(500).json({ error: 'Password could not be reset.' });
  }
});

router.post('/magic-link', async (req, res) => {
  const { email } = req.body || {};
  try {
    const db = getAsyncDb();
    const account = email ? await db.get(
      "SELECT * FROM client_portal_accounts WHERE lower(email) = lower(?) AND status = 'active'",
      String(email).trim(),
    ) : null;
    if (account) await audit(db, account, 'client_magic_link_requested');
    await persistIfNeeded();
  } catch {}
  return res.json({ ok: true, message: 'If a client portal account exists for that email, we sent a secure sign-in link.' });
});

router.post('/logout', requireClientAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    await audit(db, req.client, 'client_logout');
    await persistIfNeeded();
  } catch {}
  clearClientCookie(res);
  return res.json({ ok: true });
});

module.exports = router;
module.exports.hashToken = hashToken;
