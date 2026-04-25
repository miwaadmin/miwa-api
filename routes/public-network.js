/**
 * Public-facing professional network endpoint.
 *
 * Returns all therapist_contacts rows where public = 1 — a curated
 * directory of detectives, advocates, attorneys, psychiatrists, and
 * other professionals that clinicians in the Miwa network have vouched
 * for and explicitly marked as OK to share publicly.
 *
 * Never returns therapist_id, created_at, updated_at, or the notes field
 * (notes can be internal/personal — e.g. "responds within 24h"). Only
 * fields that are appropriate for a public directory go out.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

/**
 * GET /api/public/network
 * Optional ?category=<id> to filter
 */
router.get('/network', (req, res) => {
  try {
    const db = getDb();
    const { category } = req.query;

    const rows = category
      ? db.all(
          `SELECT id, name, title, agency, specialty, email, phone, category
           FROM therapist_contacts
           WHERE public = 1 AND category = ?
           ORDER BY pinned DESC, name COLLATE NOCASE ASC`,
          category
        )
      : db.all(
          `SELECT id, name, title, agency, specialty, email, phone, category
           FROM therapist_contacts
           WHERE public = 1
           ORDER BY pinned DESC, name COLLATE NOCASE ASC`
        );

    res.json({ contacts: rows });
  } catch (err) {
    console.error('[public-network] error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
