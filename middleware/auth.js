const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { getDb, persist } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set');

function isConfiguredAdminEmail(email) {
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  return !!adminEmail && !!email && email.toLowerCase() === adminEmail
}

function requireAuth(req, res, next) {
  // Prefer HttpOnly cookie (XSS-safe); fall back to Authorization header for
  // API clients, dev tooling, and any in-flight sessions during migration.
  const cookieToken = req.cookies?.miwa_auth;
  const headerToken = (() => {
    const h = req.headers.authorization;
    return (h && h.startsWith('Bearer ')) ? h.slice('Bearer '.length) : null;
  })();
  const token = cookieToken || headerToken;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getDb();
    const row = db.get('SELECT id, email, user_role, is_admin, account_status FROM therapists WHERE id = ?', decoded.sub);
    if (!row) return res.status(401).json({ error: 'Account not found.' });
    if (row.account_status === 'suspended') {
      return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
    }

    const shouldBeAdmin = !!row.is_admin || isConfiguredAdminEmail(row.email)
    if (shouldBeAdmin && !row.is_admin) {
      db.run('UPDATE therapists SET is_admin = 1 WHERE id = ?', row.id)
      persist()
      row.is_admin = 1
    }

    req.therapist = {
      id: row.id,
      email: row.email,
      user_role: row.user_role,
      is_admin: shouldBeAdmin,
      account_status: row.account_status,
    };
    db.run('UPDATE therapists SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', decoded.sub);
    persist();

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.therapist?.is_admin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

/**
 * Standalone admin auth middleware — reads the separate `miwa_admin_auth`
 * cookie (or Authorization header) and verifies the JWT contains
 * `type: 'admin'`.  This lets the admin portal have its own independent
 * session that is not tied to the clinician cookie.
 */
function requireAdminAuth(req, res, next) {
  const cookieToken = req.cookies?.miwa_admin_auth;
  const headerToken = (() => {
    const h = req.headers.authorization;
    return (h && h.startsWith('Bearer ')) ? h.slice('Bearer '.length) : null;
  })();
  const token = cookieToken || headerToken;

  if (!token) {
    return res.status(401).json({ error: 'Admin authentication required. Please log in to the admin portal.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Must be an admin-type token
    if (decoded.type !== 'admin') {
      return res.status(403).json({ error: 'Invalid token type. Please log in via the admin portal.' });
    }

    const db = getDb();
    const row = db.get('SELECT id, email, user_role, is_admin, account_status FROM therapists WHERE id = ?', decoded.sub);
    if (!row) return res.status(401).json({ error: 'Account not found.' });
    if (row.account_status === 'suspended') {
      return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
    }

    const shouldBeAdmin = !!row.is_admin || isConfiguredAdminEmail(row.email);
    if (!shouldBeAdmin) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    // Auto-promote if needed
    if (!row.is_admin && shouldBeAdmin) {
      db.run('UPDATE therapists SET is_admin = 1 WHERE id = ?', row.id);
      persist();
      row.is_admin = 1;
    }

    req.therapist = {
      id: row.id,
      email: row.email,
      user_role: row.user_role,
      is_admin: true,
      account_status: row.account_status,
    };
    db.run('UPDATE therapists SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', decoded.sub);
    persist();

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Admin session expired. Please log in again.' });
  }
}

module.exports = requireAuth;
module.exports.requireAdmin = requireAdmin;
module.exports.requireAdminAuth = requireAdminAuth;
