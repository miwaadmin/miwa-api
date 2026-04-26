/**
 * Trusted Contacts API
 *
 * Per-therapist CRUD for a professional referral network — detectives,
 * psychiatrists, attorneys, advocates, supervisors, other therapists.
 * Every row is scoped by therapist_id; a therapist can only see and edit
 * their own contacts (the `shared` flag is reserved for the future
 * Miwa for Teams product).
 */

'use strict';

const express = require('express');
const router = express.Router();
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');

const VALID_CATEGORIES = new Set([
  'law_enforcement',
  'psychiatry',
  'legal',
  'advocacy',
  'medical',
  'housing',
  'supervision',
  'other',
]);

/**
 * GET /api/contacts
 * Optional ?category=xxx to scope.
 * Returns pinned contacts first, then alphabetical.
 */
router.get('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { category } = req.query;
    const rows = category
      ? await db.all(
          `SELECT * FROM therapist_contacts
           WHERE therapist_id = ? AND category = ?
           ORDER BY pinned DESC, name COLLATE NOCASE ASC`,
          req.therapist.id, category
        )
      : await db.all(
          `SELECT * FROM therapist_contacts
           WHERE therapist_id = ?
           ORDER BY pinned DESC, name COLLATE NOCASE ASC`,
          req.therapist.id
        );
    res.json({ contacts: rows });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/contacts
 * Body: { name, title?, agency?, specialty?, email?, phone?, category?, notes?, pinned? }
 */
router.post('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const b = req.body || {};
    if (!b.name || typeof b.name !== 'string' || !b.name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const category = VALID_CATEGORIES.has(b.category) ? b.category : 'other';

    const result = await db.insert(
      `INSERT INTO therapist_contacts
         (therapist_id, name, title, agency, specialty, email, phone, category, notes, pinned, public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.therapist.id,
      b.name.trim(),
      b.title?.trim() || null,
      b.agency?.trim() || null,
      b.specialty?.trim() || null,
      b.email?.trim() || null,
      b.phone?.trim() || null,
      category,
      b.notes?.trim() || null,
      b.pinned ? 1 : 0,
      b.public ? 1 : 0
    );
    try { await persistIfNeeded(); } catch {}
    const row = await db.get(`SELECT * FROM therapist_contacts WHERE id = ?`, result.lastInsertRowid);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/contacts/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const id = parseInt(req.params.id);
    const existing = await db.get(
      `SELECT * FROM therapist_contacts WHERE id = ? AND therapist_id = ?`,
      id, req.therapist.id
    );
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    const b = req.body || {};
    const fields = [];
    const args = [];
    const set = (col, val) => { fields.push(`${col} = ?`); args.push(val); };

    if (b.name      !== undefined) set('name',      String(b.name).trim() || existing.name);
    if (b.title     !== undefined) set('title',     b.title?.trim() || null);
    if (b.agency    !== undefined) set('agency',    b.agency?.trim() || null);
    if (b.specialty !== undefined) set('specialty', b.specialty?.trim() || null);
    if (b.email     !== undefined) set('email',     b.email?.trim() || null);
    if (b.phone     !== undefined) set('phone',     b.phone?.trim() || null);
    if (b.category  !== undefined) set('category',  VALID_CATEGORIES.has(b.category) ? b.category : 'other');
    if (b.notes     !== undefined) set('notes',     b.notes?.trim() || null);
    if (b.pinned    !== undefined) set('pinned',    b.pinned ? 1 : 0);
    if (b.public    !== undefined) set('public',    b.public ? 1 : 0);

    if (fields.length === 0) return res.json(existing);

    set('updated_at', new Date().toISOString());
    args.push(id, req.therapist.id);

    await db.run(
      `UPDATE therapist_contacts SET ${fields.join(', ')}
       WHERE id = ? AND therapist_id = ?`,
      ...args
    );
    try { await persistIfNeeded(); } catch {}
    const row = await db.get(`SELECT * FROM therapist_contacts WHERE id = ?`, id);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/contacts/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const id = parseInt(req.params.id);
    const existing = await db.get(
      `SELECT id FROM therapist_contacts WHERE id = ? AND therapist_id = ?`,
      id, req.therapist.id
    );
    if (!existing) return res.status(404).json({ error: 'Contact not found' });
    await db.run(`DELETE FROM therapist_contacts WHERE id = ? AND therapist_id = ?`, id, req.therapist.id);
    try { await persistIfNeeded(); } catch {}
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
