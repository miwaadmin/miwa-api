const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { generate: generateCode } = require('../lib/referralCode');
const { applyAssistantPayloadUpdates, normalizeAssistantProfile } = require('../lib/assistant');
const requireAuth = require('../middleware/auth');
const {
  sendSchoolEmailVerification,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendAccountVerificationEmail,
  sendDuplicateRegistrationEmail,
} = require('../services/mailer');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set');
const TOKEN_TTL = '30d';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

// Sets an HttpOnly cookie that JS cannot read — core XSS defense
function setAuthCookie(res, token) {
  res.cookie('miwa_auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie('miwa_auth', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

function signToken(therapist) {
  return jwt.sign(
    {
      sub: therapist.id,
      email: therapist.email,
      user_role: therapist.user_role,
      is_admin: !!therapist.is_admin,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

async function logEvent(db, { therapistId = null, eventType, status = null, message = null, meta = null }) {
  try {
    await db.insert(
      'INSERT INTO event_logs (therapist_id, event_type, status, message, meta_json) VALUES (?, ?, ?, ?, ?)',
      therapistId,
      eventType,
      status,
      message,
      meta ? JSON.stringify(meta) : null,
    );
  } catch {}
}

function isConfiguredAdminEmail(email) {
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  return !!adminEmail && !!email && email.toLowerCase() === adminEmail
}

function safeProfile(row) {
  const assistant = normalizeAssistantProfile(row)
  return {
    id: row.id,
    email: row.email,
    first_name: row.first_name || null,
    last_name: row.last_name || null,
    full_name: row.full_name,
    user_role: row.user_role,
    is_admin: !!row.is_admin || isConfiguredAdminEmail(row.email),
    account_status: row.account_status || 'active',
    avatar_url: row.avatar_url || null,
    referral_code: row.referral_code,
    referred_by_code: row.referred_by_code || null,
    api_key_set: !!row.api_key,
    api_key_masked: row.api_key
      ? row.api_key.substring(0, 7) + '...' + row.api_key.slice(-4)
      : null,
    assistant_action_mode: assistant.action_mode,
    assistant_tone: assistant.tone,
    assistant_orientation: assistant.orientation,
    assistant_verbosity: assistant.verbosity,
    assistant_memory: assistant.memory,
    assistant_permissions: assistant.permissions,
    preferred_timezone: row.preferred_timezone || 'America/Los_Angeles',
    last_login_at: row.last_login_at || null,
    last_seen_at: row.last_seen_at || null,
    created_at: row.created_at,
    // Credential verification
    credential_type: row.credential_type || 'licensed',
    credential_number: row.credential_number || null,
    school_email: row.school_email || null,
    credential_verified: !!row.credential_verified,
    credential_verified_at: row.credential_verified_at || null,
    email_verified: !!row.email_verified,
    email_verified_at: row.email_verified_at || null,
    telehealth_url: row.telehealth_url || null,
    // Group practice
    practice_id: row.practice_id || null,
    practice_role: row.practice_role || null,
  };
}

router.post('/register', async (req, res) => {
  try {
    const db = getAsyncDb();
    const {
      email, password, full_name, first_name, last_name, user_role,
      referral_code: referrerCode,
      // Credential verification fields
      credential_type,
      credential_number,
      school_email,
      preferred_timezone,
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (!first_name?.trim() && !full_name?.trim()) {
      return res.status(400).json({ error: 'First name is required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const credType = credential_type || 'licensed';

    // Trainee requires a school email to send the verification link to
    if (credType === 'trainee' && !school_email?.trim()) {
      return res.status(400).json({ error: 'School or program email is required for trainee accounts.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Generic response for both "new account" and "email already exists" paths.
    // We never tell the registration form whether a given email exists — that
    // information is delivered out-of-band via email instead.
    const GENERIC_RESPONSE = {
      ok: true,
      pendingVerification: true,
      message: `If this email is eligible for a Miwa account, we just sent a verification link to ${normalizedEmail}. Please check your inbox (and spam folder) to continue.`,
    };

    const existing = await db.get('SELECT id, email, first_name, full_name FROM therapists WHERE email = ?', normalizedEmail);
    if (existing) {
      // Email is already registered — silently send a "you already have an
      // account" notice and return the same generic response we'd send for a
      // brand new registration. This closes the account-enumeration leak.
      try {
        await sendDuplicateRegistrationEmail({
          toEmail: existing.email,
          firstName: existing.first_name,
          fullName: existing.full_name,
        });
      } catch (mailErr) {
        console.error('[auth/register] duplicate-registration email error:', mailErr.message);
      }
      await logEvent(db, {
        therapistId: existing.id,
        eventType: 'auth.register',
        status: 'duplicate',
        message: 'Registration attempted on existing email; notice email sent',
      });
      return res.status(200).json(GENERIC_RESPONSE);
    }

    // Validate referral code (treat invalid codes as silent — don't block
    // registration; just record null referrer. This also keeps the response
    // generic — referral lookups can otherwise leak which codes are valid.)
    let referredById = null;
    if (referrerCode) {
      const referrer = await db.get('SELECT id FROM therapists WHERE referral_code = ?', referrerCode.trim().toUpperCase());
      if (referrer) referredById = referrer.id;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let myCode = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateCode();
      const taken = await db.get('SELECT id FROM therapists WHERE referral_code = ?', candidate);
      if (!taken) { myCode = candidate; break; }
    }
    if (!myCode) myCode = `${generateCode()}${Date.now().toString().slice(-2)}`;

    // Licensed/associate accounts are auto-verified (honor system for now)
    const autoVerified = credType !== 'trainee' ? 1 : 0;

    const computedFullName = full_name?.trim()
      || [first_name?.trim(), last_name?.trim()].filter(Boolean).join(' ')
      || null;

    const result = await db.insert(
      `INSERT INTO therapists
         (email, password_hash, full_name, first_name, last_name, user_role, referral_code, referred_by,
          credential_type, credential_number, school_email, credential_verified, preferred_timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      normalizedEmail,
      passwordHash,
      computedFullName,
      first_name?.trim() || null,
      last_name?.trim() || null,
      user_role || credType,
      myCode,
      referredById,
      credType,
      credential_number?.trim() || null,
      school_email?.trim().toLowerCase() || null,
      autoVerified,
      preferred_timezone?.trim() || 'America/Los_Angeles'
    );

    const therapistId = result.lastInsertRowid;
    const unclaimed = await db.get('SELECT COUNT(*) as n FROM patients WHERE therapist_id IS NULL');
    if (unclaimed && unclaimed.n > 0) {
      await db.run('UPDATE patients SET therapist_id = ? WHERE therapist_id IS NULL', therapistId);
      await db.run('UPDATE sessions SET therapist_id = ? WHERE therapist_id IS NULL', therapistId);
      await db.run('UPDATE chat_messages SET therapist_id = ? WHERE therapist_id IS NULL', therapistId);
      await db.run('UPDATE documents SET therapist_id = ? WHERE therapist_id IS NULL', therapistId);
    }

    const rowBeforeAdmin = await db.get('SELECT * FROM therapists WHERE id = ?', therapistId);
    const shouldBeAdmin = !!rowBeforeAdmin.is_admin || isConfiguredAdminEmail(rowBeforeAdmin.email);
    if (shouldBeAdmin && !rowBeforeAdmin.is_admin) {
      await db.run('UPDATE therapists SET is_admin = 1 WHERE id = ?', therapistId);
    }
    const row = await db.get('SELECT * FROM therapists WHERE id = ?', therapistId);
    await logEvent(db, { therapistId, eventType: 'auth.register', status: 'success', message: `New ${credType} account created (pending email verification)` });
    await persistIfNeeded();

    // ── Send account email verification link ─────────────────────────────────
    // The therapist must click this link before they can sign in. Token is
    // good for 24 hours; resend endpoint exists for expired tokens.
    try {
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await db.insert(
        `INSERT INTO email_verification_tokens (therapist_id, token, expires_at) VALUES (?, ?, ?)`,
        therapistId, verifyToken, expiresAt
      );
      await persistIfNeeded();
      await sendAccountVerificationEmail({
        toEmail: normalizedEmail,
        firstName: first_name?.trim(),
        fullName: computedFullName,
        token: verifyToken,
      });
    } catch (verifyErr) {
      console.error('[auth/register] verification email error:', verifyErr.message);
      // Non-fatal — the user can resend from the login page.
    }

    // ── Send school email verification link for trainees ──────────────────────
    // (separate from account email verification — a trainee verifies their
    // school email so they can keep the trainee rate)
    if (credType === 'trainee' && school_email?.trim()) {
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      try {
        await db.insert(
          `INSERT INTO credential_verifications (therapist_id, token, verify_email, expires_at)
           VALUES (?, ?, ?, ?)`,
          therapistId,
          verifyToken,
          school_email.trim().toLowerCase(),
          expiresAt
        );
        await persistIfNeeded();
        await sendSchoolEmailVerification({
          schoolEmail: school_email.trim(),
          firstName: first_name?.trim(),
          fullName: computedFullName,
          token: verifyToken,
        });
      } catch (emailErr) {
        console.error('[auth/register] school email verification error:', emailErr.message);
      }
    }

    // No auto-login. Therapist must click the verification link in their
    // email before they can sign in. Welcome email goes out only after
    // verification (in /verify-email handler).
    return res.status(200).json(GENERIC_RESPONSE);
  } catch (err) {
    console.error('[auth/register]', err);
    // Generic error so we don't leak validation paths timing-wise either.
    return res.status(500).json({ error: 'Registration could not be completed. Please try again in a moment.' });
  }
});

// POST /api/auth/verify-email — therapist clicks the link in their inbox; this
// validates the token, marks the account verified, issues a session cookie,
// and returns the therapist profile so the frontend can land them on /dashboard.
router.post('/verify-email', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Verification token is required.' });

    const record = await db.get(
      `SELECT * FROM email_verification_tokens WHERE token = ?`,
      token
    );
    if (!record) {
      return res.status(404).json({ error: 'This verification link is invalid. Request a new one from the sign-in page.' });
    }
    if (record.used_at) {
      return res.status(409).json({ error: 'This verification link has already been used. Please sign in.' });
    }
    if (new Date(record.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This verification link has expired. Request a new one from the sign-in page.' });
    }

    const therapist = await db.get('SELECT * FROM therapists WHERE id = ?', record.therapist_id);
    if (!therapist) return res.status(404).json({ error: 'Account not found.' });

    await db.run(
      `UPDATE therapists SET email_verified = 1, email_verified_at = CURRENT_TIMESTAMP,
                              last_login_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP
                          WHERE id = ?`,
      therapist.id
    );
    await db.run(`UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?`, record.id);
    await persistIfNeeded();

    // Welcome email is deferred until verification so the user doesn't get
    // a "welcome" mail for an account they never confirmed owning.
    try {
      await sendWelcomeEmail({
        toEmail: therapist.email,
        firstName: therapist.first_name,
        fullName: therapist.full_name,
        credentialType: therapist.credential_type || 'licensed',
        pendingVerification: false,
      });
    } catch {}

    const fresh = await db.get('SELECT * FROM therapists WHERE id = ?', therapist.id);
    const shouldBeAdmin = !!fresh.is_admin || isConfiguredAdminEmail(fresh.email);
    const sessionToken = signToken({ ...fresh, is_admin: shouldBeAdmin });
    setAuthCookie(res, sessionToken);

    await logEvent(db, { therapistId: therapist.id, eventType: 'auth.email_verified', status: 'success', message: 'Email address verified' });
    return res.json({ token: sessionToken, therapist: safeProfile(fresh) });
  } catch (err) {
    console.error('[auth/verify-email]', err);
    return res.status(500).json({ error: 'Verification could not be completed. Please try again.' });
  }
});

// POST /api/auth/resend-verification — body { email }. Always returns the
// same generic response regardless of whether the email exists, to avoid
// account enumeration.
router.post('/resend-verification', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const normalizedEmail = email.toLowerCase().trim();
  const GENERIC = {
    ok: true,
    message: `If a Miwa account exists for ${normalizedEmail} and still needs verification, we just sent a fresh link.`,
  };

  try {
    const db = getAsyncDb();
    const therapist = await db.get('SELECT * FROM therapists WHERE email = ?', normalizedEmail);
    if (therapist && !therapist.email_verified) {
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await db.insert(
        `INSERT INTO email_verification_tokens (therapist_id, token, expires_at) VALUES (?, ?, ?)`,
        therapist.id, verifyToken, expiresAt
      );
      await persistIfNeeded();
      await sendAccountVerificationEmail({
        toEmail: therapist.email,
        firstName: therapist.first_name,
        fullName: therapist.full_name,
        token: verifyToken,
      });
    }
    return res.json(GENERIC);
  } catch (err) {
    console.error('[auth/resend-verification]', err);
    return res.json(GENERIC); // generic response even on error
  }
});

// GET /api/auth/verify-credential/:token — trainee clicks link sent to their school email
router.get('/verify-credential/:token', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { token } = req.params;
    const record = await db.get(
      `SELECT cv.*, t.full_name as trainee_name
       FROM credential_verifications cv
       JOIN therapists t ON t.id = cv.therapist_id
       WHERE cv.token = ?`,
      token
    );

    if (!record) {
      return res.status(404).send(verifyPage('Invalid or expired link. Please sign in and request a new verification email.', false));
    }
    if (record.verified_at) {
      return res.send(verifyPage('Your trainee status is already verified. You\'re all set!', true));
    }
    if (new Date(record.expires_at) < new Date()) {
      return res.status(410).send(verifyPage('This verification link has expired. Sign in and request a new one from your account settings.', false));
    }

    await db.run(`UPDATE credential_verifications SET verified_at = CURRENT_TIMESTAMP WHERE id = ?`, record.id);
    await db.run(`UPDATE therapists SET credential_verified = 1, credential_verified_at = CURRENT_TIMESTAMP WHERE id = ?`, record.therapist_id);
    await persistIfNeeded();
    await logEvent(db, {
      therapistId: record.therapist_id,
      eventType: 'credential.school_email_verified',
      status: 'success',
      message: `Trainee verified via school email for ${record.trainee_name}`,
    });

    return res.send(verifyPage('Your trainee status is confirmed! You have full access to Miwa at the trainee rate.', true));
  } catch (err) {
    console.error('[auth/verify-credential]', err);
    return res.status(500).send(verifyPage('Server error. Please try again.', false));
  }
});

function verifyPage(message, success) {
  const color = success ? '#0ac5a2' : '#ef4444';
  const icon = success ? '✓' : '✗';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Miwa — Supervisor Verification</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box}
    .card{background:white;border-radius:20px;padding:48px 40px;max-width:480px;width:100%;text-align:center;box-shadow:0 4px 32px rgba(0,0,0,0.1)}
    .icon{width:64px;height:64px;border-radius:50%;background:${color};color:white;font-size:28px;display:flex;align-items:center;justify-content:center;margin:0 auto 24px}
    h1{color:#1a1456;font-size:22px;margin:0 0 12px}
    p{color:#555;font-size:15px;line-height:1.6;margin:0}
    .logo{font-size:18px;font-weight:800;color:#5746ed;margin-bottom:32px}
  </style>
  </head><body>
  <div class="card">
    <div class="logo">Miwa</div>
    <div class="icon">${icon}</div>
    <h1>${success ? 'Verification Complete' : 'Verification Failed'}</h1>
    <p>${message}</p>
  </div>
  </body></html>`;
}

router.post('/login', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const row = await db.get('SELECT * FROM therapists WHERE email = ?', normalizedEmail);
    const INVALID_MSG = 'Invalid email or password.';

    if (!row) {
      await logEvent(db, { eventType: 'auth.login', status: 'failed', message: 'Login failed for unknown email', meta: { email: normalizedEmail } });
      return res.status(401).json({ error: INVALID_MSG });
    }

    if (row.account_status === 'suspended') {
      await logEvent(db, { therapistId: row.id, eventType: 'auth.login', status: 'blocked', message: 'Suspended account attempted login' });
      return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
    }

    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) {
      await logEvent(db, { therapistId: row.id, eventType: 'auth.login', status: 'failed', message: 'Invalid password' });
      return res.status(401).json({ error: INVALID_MSG });
    }

    // Email verification required for accounts created after the verification
    // flow shipped. Existing accounts were grandfathered in the migration.
    if (!row.email_verified) {
      await logEvent(db, { therapistId: row.id, eventType: 'auth.login', status: 'unverified', message: 'Login blocked — email not verified' });
      return res.status(403).json({
        error: 'Please verify your email address before signing in. Check your inbox for the verification link, or request a new one.',
        code: 'EMAIL_UNVERIFIED',
      });
    }

    const shouldBeAdmin = !!row.is_admin || isConfiguredAdminEmail(row.email)
    await db.run('UPDATE therapists SET last_login_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP, is_admin = ? WHERE id = ?', shouldBeAdmin ? 1 : row.is_admin, row.id);
    const freshRow = await db.get('SELECT * FROM therapists WHERE id = ?', row.id);
    await logEvent(db, { therapistId: row.id, eventType: 'auth.login', status: 'success', message: 'Successful login' });
    await persistIfNeeded();

    const token = signToken({ ...freshRow, is_admin: shouldBeAdmin });
    setAuthCookie(res, token);
    return res.json({ token, therapist: safeProfile(freshRow) });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const row = await db.get('SELECT * FROM therapists WHERE id = ?', req.therapist.id);
    if (!row) return res.status(404).json({ error: 'Account not found.' });
    return res.json(safeProfile(row));
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/me', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const {
      full_name,
      first_name,
      last_name,
      user_role,
      api_key,
      avatar_url,
      assistant_action_mode,
      assistant_tone,
      assistant_orientation,
      assistant_verbosity,
      assistant_memory,
      assistant_permissions,
      assistant_permissions_json,
      current_password,
      new_password,
      telehealth_url,
      auto_send_overdue,
      auto_mbc_enabled,
    } = req.body;
    const row = await db.get('SELECT * FROM therapists WHERE id = ?', req.therapist.id);
    if (!row) return res.status(404).json({ error: 'Account not found.' });

    // Merge auto_send_overdue + auto_mbc_enabled into assistant_permissions_json
    if (auto_send_overdue !== undefined || auto_mbc_enabled !== undefined) {
      const existingPerms = (() => { try { return row.assistant_permissions_json ? JSON.parse(row.assistant_permissions_json) : {} } catch { return {} } })();
      if (auto_send_overdue !== undefined) existingPerms.auto_send_overdue = !!auto_send_overdue;
      if (auto_mbc_enabled !== undefined) existingPerms.auto_mbc_enabled = !!auto_mbc_enabled;
      await db.run('UPDATE therapists SET assistant_permissions_json = ? WHERE id = ?',
        JSON.stringify(existingPerms), req.therapist.id);
    }

    if (new_password) {
      if (!current_password) return res.status(400).json({ error: 'Current password is required to set a new password.' });
      const match = await bcrypt.compare(current_password, row.password_hash);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });
      if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    if (avatar_url && typeof avatar_url === 'string' && avatar_url.length > 2_000_000) {
      return res.status(400).json({ error: 'Profile picture is too large. Please use a smaller image.' });
    }

    const newPasswordHash = new_password ? await bcrypt.hash(new_password, 12) : row.password_hash;
    const updatedAssistant = applyAssistantPayloadUpdates(row, {
      assistant_action_mode,
      assistant_tone,
      assistant_orientation,
      assistant_verbosity,
      assistant_memory,
      assistant_permissions: assistant_permissions !== undefined ? assistant_permissions : assistant_permissions_json,
    });

    // Compose updated full_name from parts if split fields provided
    const newFirstName = first_name !== undefined ? first_name?.trim() || null : row.first_name;
    const newLastName  = last_name  !== undefined ? last_name?.trim()  || null : row.last_name;
    const newFullName  = full_name  !== undefined
      ? full_name
      : (newFirstName || newLastName)
        ? [newFirstName, newLastName].filter(Boolean).join(' ')
        : row.full_name;

    await db.run(
      `UPDATE therapists
       SET full_name = ?, first_name = ?, last_name = ?, user_role = ?, api_key = ?, avatar_url = ?, password_hash = ?,
           assistant_action_mode = ?, assistant_tone = ?, assistant_orientation = ?,
           assistant_verbosity = ?, assistant_memory = ?, assistant_permissions_json = ?,
           telehealth_url = ?, preferred_timezone = ?
       WHERE id = ?`,
      newFullName,
      newFirstName,
      newLastName,
      user_role !== undefined ? user_role : row.user_role,
      api_key !== undefined ? (api_key || null) : row.api_key,
      avatar_url !== undefined ? (avatar_url || null) : row.avatar_url,
      newPasswordHash,
      updatedAssistant.assistant_action_mode,
      updatedAssistant.assistant_tone,
      updatedAssistant.assistant_orientation,
      updatedAssistant.assistant_verbosity,
      updatedAssistant.assistant_memory,
      updatedAssistant.assistant_permissions_json,
      telehealth_url !== undefined ? (telehealth_url || null) : row.telehealth_url,
      req.body.preferred_timezone !== undefined ? req.body.preferred_timezone : row.preferred_timezone,
      req.therapist.id
    );

    const updated = await db.get('SELECT * FROM therapists WHERE id = ?', req.therapist.id);
    await logEvent(db, { therapistId: req.therapist.id, eventType: 'account.profile_update', status: 'success', message: 'Profile updated' });
    await persistIfNeeded();
    const token = signToken(updated);
    setAuthCookie(res, token);
    return res.json({ token, therapist: safeProfile(updated) });
  } catch (err) {
    console.error('[auth/put-me]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout — clears the HttpOnly cookie server-side
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ── Admin Portal Auth ──────────────────────────────────────────────
// Separate login / logout / session-check for the admin portal.
// Uses its own cookie (`miwa_admin_auth`) and JWT claim (`type: 'admin'`)
// so the admin session is fully independent of the clinician session.

function setAdminAuthCookie(res, token) {
  res.cookie('miwa_admin_auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

function clearAdminAuthCookie(res) {
  res.clearCookie('miwa_admin_auth', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

function signAdminToken(therapist) {
  return jwt.sign(
    {
      sub: therapist.id,
      email: therapist.email,
      user_role: therapist.user_role,
      is_admin: true,
      type: 'admin',
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

router.post('/admin-login', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const row = await db.get('SELECT * FROM therapists WHERE email = ?', normalizedEmail);
    const INVALID_MSG = 'Invalid email or password.';

    if (!row) {
      await logEvent(db, { eventType: 'auth.admin_login', status: 'failed', message: 'Admin login failed for unknown email', meta: { email: normalizedEmail } });
      return res.status(401).json({ error: INVALID_MSG });
    }

    if (row.account_status === 'suspended') {
      await logEvent(db, { therapistId: row.id, eventType: 'auth.admin_login', status: 'blocked', message: 'Suspended account attempted admin login' });
      return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
    }

    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) {
      await logEvent(db, { therapistId: row.id, eventType: 'auth.admin_login', status: 'failed', message: 'Invalid password for admin login' });
      return res.status(401).json({ error: INVALID_MSG });
    }

    // Must be an admin
    const shouldBeAdmin = !!row.is_admin || isConfiguredAdminEmail(row.email);
    if (!shouldBeAdmin) {
      await logEvent(db, { therapistId: row.id, eventType: 'auth.admin_login', status: 'denied', message: 'Non-admin attempted admin login' });
      return res.status(403).json({ error: 'Admin access required. This account does not have admin privileges.' });
    }

    await db.run('UPDATE therapists SET last_login_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP, is_admin = 1 WHERE id = ?', row.id);
    const freshRow = await db.get('SELECT * FROM therapists WHERE id = ?', row.id);
    await logEvent(db, { therapistId: row.id, eventType: 'auth.admin_login', status: 'success', message: 'Successful admin login' });
    await persistIfNeeded();

    const token = signAdminToken(freshRow);
    setAdminAuthCookie(res, token);
    return res.json({ token, therapist: safeProfile(freshRow) });
  } catch (err) {
    console.error('[auth/admin-login]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/admin-me', async (req, res) => {
  try {
    const cookieToken = req.cookies?.miwa_admin_auth;
    const headerToken = (() => {
      const h = req.headers.authorization;
      return (h && h.startsWith('Bearer ')) ? h.slice('Bearer '.length) : null;
    })();
    const token = cookieToken || headerToken;

    if (!token) return res.status(401).json({ error: 'Not authenticated.' });

    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'admin') return res.status(403).json({ error: 'Invalid token type.' });

    const db = getAsyncDb();
    const row = await db.get('SELECT * FROM therapists WHERE id = ?', decoded.sub);
    if (!row) return res.status(404).json({ error: 'Account not found.' });

    const shouldBeAdmin = !!row.is_admin || isConfiguredAdminEmail(row.email);
    if (!shouldBeAdmin) return res.status(403).json({ error: 'Admin access required.' });

    return res.json(safeProfile(row));
  } catch (err) {
    return res.status(401).json({ error: 'Admin session expired.' });
  }
});

router.post('/admin-logout', (req, res) => {
  clearAdminAuthCookie(res);
  res.json({ ok: true });
});

// ── Password Reset ─────────────────────────────────────────────────────────────

// POST /api/auth/forgot-password — send reset link to email
router.post('/forgot-password', async (req, res) => {
  // Always respond 200 to avoid leaking whether email exists
  const { email } = req.body;
  if (!email) return res.json({ ok: true });

  try {
    const db = getAsyncDb();
    const row = await db.get('SELECT id, first_name, email FROM therapists WHERE lower(email) = lower(?)', email.trim());

    if (row) {
      // Generate a secure reset token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

      // Invalidate any existing tokens for this user
      await db.run('DELETE FROM password_reset_tokens WHERE therapist_id = ?', row.id);

      // Insert new token
      await db.run(
        'INSERT INTO password_reset_tokens (token, therapist_id, expires_at) VALUES (?, ?, ?)',
        token, row.id, expiresAt
      );

      await persistIfNeeded();

      // Send email (non-blocking — don't fail if email fails)
      sendPasswordResetEmail({
        toEmail: row.email,
        firstName: row.first_name,
        fullName: row.full_name,
        resetToken: token,
      }).catch(err => console.error('[forgot-password] email error:', err.message));
    }
  } catch (err) {
    console.error('[forgot-password] error:', err.message);
  }

  return res.json({ ok: true });
});

// POST /api/auth/reset-password — set new password using token
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const db = getAsyncDb();
    const row = await db.get(
      `SELECT prt.*, t.email, t.first_name
       FROM password_reset_tokens prt
       JOIN therapists t ON prt.therapist_id = t.id
       WHERE prt.token = ?
         AND prt.used_at IS NULL
         AND prt.expires_at > datetime('now')`,
      token
    );

    if (!row) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }

    // Hash new password and update
    const passwordHash = await bcrypt.hash(password, 12);
    await db.run('UPDATE therapists SET password_hash = ? WHERE id = ?', passwordHash, row.therapist_id);

    // Mark token as used
    await db.run('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE token = ?', token);

    await persistIfNeeded();

    return res.json({ ok: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('[reset-password] error:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic + recovery endpoints. Two layers of protection:
//   1. Each endpoint requires JWT_SECRET or a temporary ADMIN_RECOVERY_SECRET
//      in X-Miwa-Diag-Secret / diag_secret.
//   2. Broad diagnostics are gated behind ENABLE_DIAG=true. Narrow account
//      recovery endpoints only require one recovery secret so an operator can recover
//      admin access without enabling the wider diagnostic surface.
// ─────────────────────────────────────────────────────────────────────────────
function normalizeRecoverySecret(value) {
  let normalized = String(value || '').replace(/^\uFEFF/, '').trim();
  if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function getProvidedRecoverySecret(req) {
  return normalizeRecoverySecret(req.get('x-miwa-diag-secret') || req.body?.diag_secret || '');
}

function getRecoverySecrets() {
  return [JWT_SECRET, process.env.ADMIN_RECOVERY_SECRET]
    .map(normalizeRecoverySecret)
    .filter(Boolean);
}

function safeEqualSecret(a, b) {
  return a.length === b.length
    && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function diagSecretMatches(req) {
  const provided = getProvidedRecoverySecret(req);
  return getRecoverySecrets().some(expected => safeEqualSecret(provided, expected));
}

function recoverySecretDebug(req) {
  const provided = getProvidedRecoverySecret(req);
  const configuredLengths = getRecoverySecrets().map(secret => secret.length);
  return {
    code: 'RECOVERY_SECRET_MISMATCH',
    provided_length: provided.length,
    expected_lengths: configuredLengths,
    admin_recovery_secret_configured: !!normalizeRecoverySecret(process.env.ADMIN_RECOVERY_SECRET),
  };
}

function diagAuthorized(req, res) {
  if (String(process.env.ENABLE_DIAG || '').toLowerCase() !== 'true') {
    res.status(404).json({ error: 'Not found' });
    return false;
  }
  const ok = diagSecretMatches(req);
  if (!ok) {
    res.status(404).json({ error: 'Not found', ...recoverySecretDebug(req) });
    return false;
  }
  return true;
}

function recoveryAuthorized(req, res) {
  if (!diagSecretMatches(req)) {
    res.status(404).json({ error: 'Not found', ...recoverySecretDebug(req) });
    return false;
  }
  return true;
}
router.get('/_diag/accounts', async (req, res) => {
  if (!diagAuthorized(req, res)) return;
  try {
    const db = getAsyncDb();
    const rows = await db.all(`
      SELECT id, email, first_name, last_name, full_name,
             credential_type, account_status, is_admin,
             email_verified, last_login_at, created_at
      FROM therapists
      ORDER BY id ASC
    `);
    return res.json({ count: rows.length, accounts: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Returns info about which DB file the running process is actually reading,
// plus row counts for every table. This disambiguates "DB was wiped" from
// "app is pointing at the wrong file".
router.get('/_diag/db', async (req, res) => {
  if (!diagAuthorized(req, res)) return;
  try {
    const fs = require('fs');
    const path = require('path');
    const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'mftbrain.db');
    let fileInfo = { path: dbPath, exists: false };
    try {
      const stat = fs.statSync(dbPath);
      fileInfo = {
        path: dbPath,
        exists: true,
        size_bytes: stat.size,
        modified_at: stat.mtime.toISOString(),
        created_at: stat.birthtime.toISOString(),
      };
    } catch {}

    const db = getAsyncDb();
    const tables = await db.all(`
      SELECT table_name AS name
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
       ORDER BY table_name
    `);
    const counts = {};
    for (const t of tables) {
      try { counts[t.name] = (await db.get(`SELECT COUNT(*) AS n FROM ${t.name}`)).n; }
      catch (e) { counts[t.name] = `err: ${e.message}`; }
    }

    let dirListing = [];
    try {
      const dir = path.dirname(dbPath);
      dirListing = fs.readdirSync(dir).map(name => {
        try {
          const s = fs.statSync(path.join(dir, name));
          return { name, size: s.size, mtime: s.mtime.toISOString() };
        } catch { return { name }; }
      });
    } catch {}

    return res.json({
      db_path_env: process.env.DB_PATH || null,
      file: fileInfo,
      dir_listing: dirListing,
      table_counts: counts,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Dump recent event_logs rows — the audit trail is the fastest way to see
// what actions were taken against the DB and when.
router.get('/_diag/events', async (req, res) => {
  if (!diagAuthorized(req, res)) return;
  try {
    const db = getAsyncDb();
    const rows = await db.all(`
      SELECT id, therapist_id, event_type, status, message, meta_json, created_at
      FROM event_logs
      ORDER BY id DESC
      LIMIT 200
    `);
    return res.json({ count: rows.length, events: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Trigger the nightly backup immediately, out-of-band. Emails the encrypted
// DB blob to ADMIN_EMAIL the same way the scheduled job does. Use before
// risky operations or for a manual sanity check.
router.post('/_diag/backup-now', async (req, res) => {
  if (!diagAuthorized(req, res)) return;
  try {
    const { runNightlyBackup } = require('../services/backup');
    const result = await runNightlyBackup({ trigger: 'manual' });
    if (!result.ok) return res.status(500).json(result);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Download the encrypted DB blob directly (no email). Same format as the
// email attachment. Use this if email delivery is broken or you want an
// immediate off-platform copy before an intentional migration.
router.get('/_diag/download-backup', async (req, res) => {
  if (!diagAuthorized(req, res)) return;
  try {
    const { buildEncryptedDbBackup } = require('../services/backup');
    const backup = buildEncryptedDbBackup();
    res.setHeader('Content-Type', backup.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
    res.setHeader('X-Miwa-Plain-SHA256', backup.sha256);
    res.setHeader('X-Miwa-Plain-Size', String(backup.plainSize));
    return res.send(backup.content);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a fully-verified admin account directly. Use only when locked out
// (DB was wiped or never had your account). Requires X-Miwa-Diag-Secret.
//   POST /api/auth/_diag/create-admin
//   Body: { email, password, first_name, last_name }
router.post('/_diag/create-admin', async (req, res) => {
  if (!recoveryAuthorized(req, res)) return;
  try {
    const { email, password, first_name, last_name } = req.body || {};
    if (!email || !password || String(password).length < 8) {
      return res.status(400).json({ error: 'email and password (>=8 chars) required' });
    }
    const db = getAsyncDb();
    const normalizedEmail = String(email).toLowerCase().trim();
    const passwordHash = await bcrypt.hash(String(password), 12);
    const fullName = [first_name, last_name].filter(Boolean).join(' ').trim() || null;
    const existing = await db.get('SELECT id, email FROM therapists WHERE email = ?', normalizedEmail);
    if (existing) {
      if (!isConfiguredAdminEmail(normalizedEmail)) {
        return res.status(409).json({ error: 'Account with that email already exists', id: existing.id });
      }

      await db.run(
        `UPDATE therapists SET password_hash = ?,
                                full_name = COALESCE(?, full_name),
                                first_name = COALESCE(?, first_name),
                                last_name = COALESCE(?, last_name),
                                user_role = COALESCE(NULLIF(user_role, ''), 'licensed'),
                                credential_type = COALESCE(NULLIF(credential_type, ''), 'licensed'),
                                credential_verified = 1,
                                email_verified = 1,
                                email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
                                is_admin = 1,
                                account_status = 'active',
                                preferred_timezone = COALESCE(NULLIF(preferred_timezone, ''), 'America/Los_Angeles')
                            WHERE id = ?`,
        passwordHash,
        fullName,
        first_name?.trim() || null,
        last_name?.trim() || null,
        existing.id
      );
      await logEvent(db, {
        therapistId: existing.id,
        eventType: 'auth.official_admin_upsert',
        status: 'success',
        message: 'Configured admin account was reset and promoted',
        meta: { email: normalizedEmail },
      });
      await persistIfNeeded();
      return res.json({
        ok: true,
        id: existing.id,
        email: normalizedEmail,
        is_admin: true,
        email_verified: true,
        created: false,
        official_admin: true,
      });
    }

    // Generate a referral code
    let myCode = null;
    for (let i = 0; i < 10; i++) {
      const candidate = generateCode();
      if (!(await db.get('SELECT id FROM therapists WHERE referral_code = ?', candidate))) { myCode = candidate; break; }
    }
    if (!myCode) myCode = `${generateCode()}${Date.now().toString().slice(-2)}`;

    const result = await db.insert(
      `INSERT INTO therapists
         (email, password_hash, full_name, first_name, last_name, user_role,
          referral_code, credential_type, credential_verified,
          email_verified, email_verified_at,
          is_admin, account_status, preferred_timezone)
       VALUES (?, ?, ?, ?, ?, 'licensed', ?, 'licensed', 1, 1, CURRENT_TIMESTAMP, 1, 'active', 'America/Los_Angeles')`,
      normalizedEmail, passwordHash, fullName,
      first_name?.trim() || null, last_name?.trim() || null,
      myCode
    );
    await persistIfNeeded();
    return res.json({
      ok: true,
      id: result.lastInsertRowid,
      email: normalizedEmail,
      is_admin: true,
      email_verified: true,
      created: true,
      official_admin: isConfiguredAdminEmail(normalizedEmail),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset a specific therapist's password using the JWT_SECRET as authorization.
// Recovery escape hatch when email delivery is broken or the email on file is
// not what the operator expected. Body: { id | email, new_password }, query: ?secret=
router.post('/_diag/reset-password', async (req, res) => {
  if (!recoveryAuthorized(req, res)) return;
  try {
    const { id, email, new_password } = req.body || {};
    if ((!id && !email) || !new_password || String(new_password).length < 8) {
      return res.status(400).json({ error: 'id or email, plus new_password (>=8 chars), required' });
    }
    const db = getAsyncDb();
    const row = id
      ? await db.get('SELECT id, email, is_admin FROM therapists WHERE id = ?', Number(id))
      : await db.get('SELECT id, email, is_admin FROM therapists WHERE lower(email) = ?', String(email).toLowerCase().trim());
    if (!row) return res.status(404).json({ error: 'Therapist not found' });

    const hash = await bcrypt.hash(String(new_password), 12);
    await db.run(
      `UPDATE therapists SET password_hash = ?,
                              email_verified = 1,
                              email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
                              account_status = COALESCE(NULLIF(account_status, ''), 'active'),
                              is_admin = CASE WHEN lower(email) = ? THEN 1 ELSE is_admin END
                          WHERE id = ?`,
      hash,
      (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
      row.id
    );
    await logEvent(db, {
      therapistId: row.id,
      eventType: 'auth.diag_password_reset',
      status: 'success',
      message: 'Diagnostic password reset completed',
      meta: { email: row.email, byEmail: !!email },
    });
    await persistIfNeeded();
    return res.json({ ok: true, id: row.id, email: row.email, is_admin: !!row.is_admin || isConfiguredAdminEmail(row.email) });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
