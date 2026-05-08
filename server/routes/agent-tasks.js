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
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { enqueueTask, cancelRunning } = require('../services/task-runner');

// ── POST / — create a new background task ───────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { prompt, title, context } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (prompt.length > 8000) {
      return res.status(400).json({ error: 'prompt too long (max 8000 chars)' });
    }

    const task = await enqueueTask({
      therapistId: req.therapist.id,
      prompt,
      title,
      context: context && typeof context === 'object' ? context : null,
    });
    res.status(202).json(task);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET / — list my tasks ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = getAsyncDb();
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const status = req.query.status; // optional filter

    let sql = `SELECT at.id, at.title, at.prompt, at.status, at.result_text, at.error_message,
                      at.failure_kind, at.iterations, at.retry_count, at.max_retries,
                      at.cost_cents, at.read_at, at.created_at, at.started_at,
                      at.heartbeat_at, at.completed_at, at.goal_id, ag.title AS goal_title
                 FROM agent_tasks at
                 LEFT JOIN assistant_goals ag ON ag.id = at.goal_id
                WHERE at.therapist_id = ?`;
    const params = [req.therapist.id];

    if (status) {
      sql += ' AND at.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY at.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await db.all(sql, ...params);
    res.json({ tasks: rows, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /unread-count — badge number ────────────────────────────────────────
router.get('/unread-count', async (req, res) => {
  try {
    const db = getAsyncDb();
    // "unread" = terminal state (done / failed / needs_input) AND read_at IS NULL.
    // We also count running/queued tasks so the badge can show both: "2 done,
    // 1 running."
    const row = await db.get(
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /:id — fetch single task ────────────────────────────────────────────
router.get('/goals', async (req, res) => {
  try {
    const db = getAsyncDb();
    const status = req.query.status || 'active';
    const rows = await db.all(
      `SELECT id, goal_key, title, description, status, cadence,
              last_checked_at, next_check_at, evidence_json, created_at, updated_at
         FROM assistant_goals
        WHERE therapist_id = ? AND (? = 'all' OR status = ?)
        ORDER BY
          CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
          COALESCE(next_check_at, updated_at, created_at) ASC`,
      req.therapist.id,
      status,
      status,
    );
    res.json({
      goals: rows.map(row => ({
        ...row,
        evidence: row.evidence_json ? JSON.parse(row.evidence_json) : null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/goals', async (req, res) => {
  try {
    const { title, description = '', cadence = 'ongoing' } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const goalKey = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || `goal_${Date.now()}`;
    const db = getAsyncDb();
    await db.run(
      `INSERT INTO assistant_goals
        (therapist_id, goal_key, title, description, cadence, status, evidence_json)
       VALUES (?, ?, ?, ?, ?, 'active', ?)
       ON CONFLICT(therapist_id, goal_key) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         cadence = excluded.cadence,
         status = 'active',
         updated_at = CURRENT_TIMESTAMP`,
      req.therapist.id,
      goalKey,
      title.trim(),
      String(description || '').trim(),
      String(cadence || 'ongoing').trim(),
      JSON.stringify({ source: 'clinician', created_at: new Date().toISOString() }),
    );
    await persistIfNeeded();
    const row = await db.get(
      'SELECT * FROM assistant_goals WHERE therapist_id = ? AND goal_key = ?',
      req.therapist.id,
      goalKey,
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/goals/:id(\\d+)', async (req, res) => {
  try {
    const allowedStatus = new Set(['active', 'paused', 'completed', 'archived']);
    const status = req.body?.status;
    if (status && !allowedStatus.has(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    const db = getAsyncDb();
    const current = await db.get(
      'SELECT id FROM assistant_goals WHERE id = ? AND therapist_id = ?',
      req.params.id,
      req.therapist.id,
    );
    if (!current) return res.status(404).json({ error: 'Goal not found' });

    await db.run(
      `UPDATE assistant_goals
          SET title = COALESCE(?, title),
              description = COALESCE(?, description),
              cadence = COALESCE(?, cadence),
              status = COALESCE(?, status),
              next_check_at = COALESCE(?, next_check_at),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND therapist_id = ?`,
      req.body?.title ? String(req.body.title).trim() : null,
      req.body?.description ? String(req.body.description).trim() : null,
      req.body?.cadence ? String(req.body.cadence).trim() : null,
      status || null,
      req.body?.next_check_at || null,
      req.params.id,
      req.therapist.id,
    );
    await persistIfNeeded();
    const row = await db.get(
      'SELECT * FROM assistant_goals WHERE id = ? AND therapist_id = ?',
      req.params.id,
      req.therapist.id,
    );
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id(\\d+)', async (req, res) => {
  try {
    const db = getAsyncDb();
    const row = await db.get(
      'SELECT * FROM agent_tasks WHERE id = ? AND therapist_id = ?',
      req.params.id, req.therapist.id,
    );
    if (!row) return res.status(404).json({ error: 'Task not found' });

    // Parse tool call log if present
    if (row.tool_calls_json) {
      try { row.tool_calls = JSON.parse(row.tool_calls_json); } catch { row.tool_calls = []; }
    }
    if (row.checkpoint_json) {
      try { row.checkpoint = JSON.parse(row.checkpoint_json); } catch { row.checkpoint = null; }
    }
    row.steps = await db.all(
      `SELECT id, step_key, label, status, detail, attempt, started_at, completed_at, created_at, updated_at
         FROM agent_task_steps
        WHERE task_id = ? AND therapist_id = ?
        ORDER BY id ASC`,
      row.id,
      req.therapist.id,
    ).catch(() => []);
    row.goal = row.goal_id
      ? await db.get(
          `SELECT id, goal_key, title, description, status, cadence, last_checked_at,
                  next_check_at, evidence_json, created_at, updated_at
             FROM assistant_goals WHERE id = ? AND therapist_id = ?`,
          row.goal_id,
          req.therapist.id,
        ).catch(() => null)
      : null;
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /:id/cancel — cancel a queued/running task ────────────────────────
router.post('/:id(\\d+)/cancel', async (req, res) => {
  try {
    const db = getAsyncDb();
    const row = await db.get(
      'SELECT id, status FROM agent_tasks WHERE id = ? AND therapist_id = ?',
      req.params.id, req.therapist.id,
    );
    if (!row) return res.status(404).json({ error: 'Task not found' });

    if (row.status === 'done' || row.status === 'failed' || row.status === 'cancelled') {
      return res.status(400).json({ error: `Task is already ${row.status}` });
    }

    // Mark cancelled in DB first — the running loop polls this between
    // iterations and will exit cleanly.
    await db.run(
      `UPDATE agent_tasks SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      row.id,
    );
    await persistIfNeeded();

    // Also signal the AbortController if the task is actively running.
    cancelRunning(row.id);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /:id/read — mark as read (clears badge) ───────────────────────────
router.post('/:id(\\d+)/read', async (req, res) => {
  try {
    const db = getAsyncDb();
    const result = await db.run(
      `UPDATE agent_tasks SET read_at = CURRENT_TIMESTAMP
        WHERE id = ? AND therapist_id = ? AND read_at IS NULL`,
      req.params.id, req.therapist.id,
    );
    await persistIfNeeded();
    res.json({ ok: true, updated: result?.changes || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /read-all — mark all terminal tasks as read ───────────────────────
router.post('/read-all', async (req, res) => {
  try {
    const db = getAsyncDb();
    await db.run(
      `UPDATE agent_tasks SET read_at = CURRENT_TIMESTAMP
        WHERE therapist_id = ?
          AND read_at IS NULL
          AND status IN ('done', 'failed', 'needs_input')`,
      req.therapist.id,
    );
    await persistIfNeeded();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
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
  (async () => {
    try {
      const db = getAsyncDb();
      const counts = await db.get(
        `SELECT
           SUM(CASE WHEN status IN ('done','failed','needs_input') AND read_at IS NULL THEN 1 ELSE 0 END) AS unread,
           SUM(CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END) AS active
         FROM agent_tasks WHERE therapist_id = ?`,
        therapistId,
      );
      sendEvent({ type: 'connected', unread: counts?.unread || 0, active: counts?.active || 0 });
    } catch {}
  })();

  // Track last-seen ids+statuses so we only emit deltas.
  let lastSnapshot = new Map();
  const snapshot = async () => {
    try {
      const db = getAsyncDb();
      const rows = await db.all(
        `SELECT id, status, title, completed_at, iterations, retry_count, heartbeat_at, failure_kind
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

  const interval = setInterval(() => {
    snapshot().catch(() => {});
  }, 3000);
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
