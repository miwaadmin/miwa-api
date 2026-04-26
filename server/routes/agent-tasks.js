/**
 * /api/agent/tasks — Background agent task API.
 *
 *   POST   /                    → create a new background task (202 + task)
 *   GET    /                    → list my tasks (paginated, newest first)
 *   GET    /:id                 → fetch one task (with tool-call log)
 *   POST   /:id/cancel          → cancel a queued/running task
 *   POST   /:id/read            → mark a terminal-state task as read
 *   POST   /read-all            → mark all terminal tasks as read
 *   GET    /stream              → SSE: live status updates for my tasks
 *   GET    /unread-count        → { count } for badge
 *
 * All endpoints require auth (applied by the mount in server/index.js).
 * Scope: a therapist can only see/act on their own tasks — enforced via the
 * WHERE therapist_id = req.therapist.id filter on every query.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { getDb, persist } = require('../db');
const { enqueueTask, cancelRunning } = require('../services/task-runner');

// ── POST / — create a new background task ───────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { prompt, title } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (prompt.length > 8000) {
      return res.status(400).json({ error: 'prompt too long (max 8000 chars)' });
    }

    const task = enqueueTask({
      therapistId: req.therapist.id,
      prompt,
      title,
    });
    res.status(202).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — list my tasks ───────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const status = req.query.status; // optional filter

    let sql = `SELECT id, title, prompt, status, result_text, error_message,
                      iterations, cost_cents, read_at, created_at, started_at,
                      completed_at
               FROM agent_tasks WHERE therapist_id = ?`;
    const params = [req.therapist.id];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.all(sql, ...params);
    res.json({ tasks: rows, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /unread-count — badge number ────────────────────────────────────────
router.get('/unread-count', (req, res) => {
  try {
    const db = getDb();
    // "unread" = terminal state (done / failed / needs_input) AND read_at IS NULL.
    // We also count running/queued tasks so the badge can show both: "2 done,
    // 1 running."
    const row = db.get(
      `SELECT
         SUM(CASE WHEN status IN ('done','failed','needs_input') AND read_at IS NULL THEN 1 ELSE 0 END) AS unread,
         SUM(CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END) AS active
       FROM agent_tasks WHERE therapist_id = ?`,
      req.therapist.id,
    );
    res.json({
      unread: row?.unread || 0,
      active: row?.active || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — fetch single task ────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const row = db.get(
      'SELECT * FROM agent_tasks WHERE id = ? AND therapist_id = ?',
      req.params.id, req.therapist.id,
    );
    if (!row) return res.status(404).json({ error: 'Task not found' });

    // Parse tool call log if present
    if (row.tool_calls_json) {
      try { row.tool_calls = JSON.parse(row.tool_calls_json); } catch { row.tool_calls = []; }
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/cancel — cancel a queued/running task ────────────────────────
router.post('/:id/cancel', (req, res) => {
  try {
    const db = getDb();
    const row = db.get(
      'SELECT id, status FROM agent_tasks WHERE id = ? AND therapist_id = ?',
      req.params.id, req.therapist.id,
    );
    if (!row) return res.status(404).json({ error: 'Task not found' });

    if (row.status === 'done' || row.status === 'failed' || row.status === 'cancelled') {
      return res.status(400).json({ error: `Task is already ${row.status}` });
    }

    // Mark cancelled in DB first — the running loop polls this between
    // iterations and will exit cleanly.
    db.run(
      `UPDATE agent_tasks SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      row.id,
    );
    try { persist(); } catch {}

    // Also signal the AbortController if the task is actively running.
    cancelRunning(row.id);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/read — mark as read (clears badge) ───────────────────────────
router.post('/:id/read', (req, res) => {
  try {
    const db = getDb();
    const result = db.run(
      `UPDATE agent_tasks SET read_at = CURRENT_TIMESTAMP
        WHERE id = ? AND therapist_id = ? AND read_at IS NULL`,
      req.params.id, req.therapist.id,
    );
    try { persist(); } catch {}
    res.json({ ok: true, updated: result?.changes || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /read-all — mark all terminal tasks as read ───────────────────────
router.post('/read-all', (req, res) => {
  try {
    const db = getDb();
    db.run(
      `UPDATE agent_tasks SET read_at = CURRENT_TIMESTAMP
        WHERE therapist_id = ?
          AND read_at IS NULL
          AND status IN ('done', 'failed', 'needs_input')`,
      req.therapist.id,
    );
    try { persist(); } catch {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /stream — SSE for live status updates ──────────────────────────────
// Clients connect to this endpoint and receive {type:'task_update', task:{...}}
// events when any of their tasks changes state. Cheap poll-to-push adapter:
// every 3 seconds we check for rows updated since last tick and emit deltas.
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const therapistId = req.therapist.id;
  const sendEvent = (payload) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch { /* connection closed */ }
  };

  // Send initial connection confirmation + current unread/active counts.
  try {
    const db = getDb();
    const counts = db.get(
      `SELECT
         SUM(CASE WHEN status IN ('done','failed','needs_input') AND read_at IS NULL THEN 1 ELSE 0 END) AS unread,
         SUM(CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END) AS active
       FROM agent_tasks WHERE therapist_id = ?`,
      therapistId,
    );
    sendEvent({ type: 'connected', unread: counts?.unread || 0, active: counts?.active || 0 });
  } catch {}

  // Track last-seen ids+statuses so we only emit deltas.
  let lastSnapshot = new Map();
  const snapshot = () => {
    try {
      const db = getDb();
      const rows = db.all(
        `SELECT id, status, title, completed_at, iterations
         FROM agent_tasks
         WHERE therapist_id = ?
           AND (status IN ('queued','running') OR completed_at > datetime('now', '-10 minutes'))`,
        therapistId,
      );
      const seen = new Set();
      for (const row of rows) {
        seen.add(row.id);
        const prev = lastSnapshot.get(row.id);
        if (!prev || prev.status !== row.status || prev.iterations !== row.iterations) {
          sendEvent({ type: 'task_update', task: row });
        }
        lastSnapshot.set(row.id, row);
      }
      // Purge entries no longer in-window so the map doesn't grow unbounded.
      for (const id of lastSnapshot.keys()) {
        if (!seen.has(id)) lastSnapshot.delete(id);
      }
    } catch { /* ignore transient errors */ }
  };

  const interval = setInterval(snapshot, 3000);
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
  }, 25_000);

  req.on('close', () => {
    clearInterval(interval);
    clearInterval(heartbeat);
    try { res.end(); } catch {}
  });
});

module.exports = router;
