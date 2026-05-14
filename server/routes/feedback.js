// POST /api/feedback — submit feedback from a logged-in therapist OR a logged-in
// client portal user. The route handles its own combined auth so it can be mounted
// without requireAuth in index.js.
//
// Accepts: { category, subject, message, context }
// Returns: { id, ticket_id }   e.g. { id: 42, ticket_id: 'MIWA-FB-42' }
//
// Rate limit: 5 submissions per hour per user (DB-based, independent of the
// IP-level rate limiter on the route mount).

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');

const JWT_SECRET = process.env.JWT_SECRET;
const VALID_CATEGORIES = ['bug', 'feature_request', 'help', 'other', 'feature', 'general'];
const MAX_PER_HOUR = 5;

// ── Combined auth ─────────────────────────────────────────────────────────────
// Tries therapist JWT first (miwa_auth cookie), then client portal JWT
// (miwa_client_auth cookie). Returns an { type, id, email } object or null.
async function resolveAuth(req, db) {
  // Therapist path
  const therapistToken =
    req.cookies?.miwa_auth ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);
  if (therapistToken) {
    try {
      const decoded = jwt.verify(therapistToken, JWT_SECRET);
      const row = await db.get(
        'SELECT id, email, account_status FROM therapists WHERE id = ?',
        decoded.sub,
      );
      if (row && row.account_status !== 'suspended') {
        return { type: 'therapist', id: row.id, email: row.email };
      }
    } catch {}
  }

  // Client portal path
  const clientToken = req.cookies?.miwa_client_auth;
  if (clientToken) {
    try {
      const decoded = jwt.verify(clientToken, JWT_SECRET);
      if (decoded.type === 'client') {
        const row = await db.get(
          "SELECT id, email, status FROM client_portal_accounts WHERE id = ?",
          decoded.sub,
        );
        if (row && row.status === 'active') {
          return { type: 'client', id: row.id, email: row.email };
        }
      }
    } catch {}
  }

  return null;
}

// POST /api/feedback
router.post('/', async (req, res) => {
  try {
    const db = getAsyncDb();

    const auth = await resolveAuth(req, db);
    if (!auth) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const {
      message,
      category = 'general',
      subject = null,
      context = null,
      source = 'form',
    } = req.body || {};

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Feedback message is required.' });
    }

    const cat = VALID_CATEGORIES.includes(category) ? category : 'general';

    // DB-based per-user hourly rate limit
    const rateRow = auth.type === 'therapist'
      ? await db.get(
          `SELECT COUNT(*) AS n FROM user_feedback
            WHERE therapist_id = ?
              AND datetime(created_at) >= datetime('now', '-1 hour')`,
          auth.id,
        )
      : await db.get(
          `SELECT COUNT(*) AS n FROM user_feedback
            WHERE client_account_id = ?
              AND datetime(created_at) >= datetime('now', '-1 hour')`,
          auth.id,
        );
    if ((rateRow?.n || 0) >= MAX_PER_HOUR) {
      return res.status(429).json({
        error: `Feedback limit reached. You can submit up to ${MAX_PER_HOUR} messages per hour — thanks for caring so much!`,
      });
    }

    const therapistId = auth.type === 'therapist' ? auth.id : null;
    const clientAccountId = auth.type === 'client' ? auth.id : null;
    const contextJson = context ? JSON.stringify(context) : null;
    const src = ['chat', 'form'].includes(source) ? source : 'form';

    const inserted = await db.insert(
      `INSERT INTO user_feedback
         (therapist_id, client_account_id, subject, message, category, context_json, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      therapistId,
      clientAccountId,
      subject ? String(subject).trim().slice(0, 200) : null,
      String(message).trim(),
      cat,
      contextJson,
      src,
    );
    await persistIfNeeded();

    const id = inserted.lastInsertRowid;
    const ticketId = `MIWA-FB-${id}`;

    // Fire-and-forget founder notification email
    const notifyEmail =
      (process.env.FOUNDER_EMAIL || process.env.ADMIN_EMAIL || '').trim();
    if (notifyEmail) {
      setImmediate(async () => {
        try {
          const { sendFeedbackNotificationEmail } = require('../services/mailer');
          await sendFeedbackNotificationEmail({
            toEmail: notifyEmail,
            submitterEmail: auth.email,
            submitterType: auth.type,
            category: cat,
            subject: subject ? String(subject).trim() : null,
            message: String(message).trim(),
            ticketId,
          });
        } catch (mailErr) {
          console.error('[feedback] notification email failed:', mailErr.message);
        }
      });
    }

    res.status(201).json({ id, ticket_id: ticketId });
  } catch (err) {
    console.error('[feedback] POST /', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
