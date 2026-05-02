const express = require('express');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const {
  addMemory,
  archiveMemory,
  auditAction,
  ensureAssistantProfile,
  getRuntimeSnapshot,
  startAssistantSession,
  touchAssistantSession,
  updateRuntimeProfile,
} = require('../services/assistantRuntime');

const router = express.Router();

function therapistId(req) {
  return req.therapist?.id;
}

function sendError(res, err) {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 500 ? 'Assistant runtime request failed' : err.message });
}

router.get('/runtime', async (req, res) => {
  try {
    const db = getAsyncDb();
    res.json(await getRuntimeSnapshot(db, therapistId(req), {
      surface: req.query.surface,
      context_type: req.query.context_type,
      context_id: req.query.context_id,
    }));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/profile', async (req, res) => {
  try {
    const db = getAsyncDb();
    res.json({ profile: await ensureAssistantProfile(db, therapistId(req)) });
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/profile', async (req, res) => {
  try {
    const db = getAsyncDb();
    const profile = await updateRuntimeProfile(db, therapistId(req), req.body || {});
    await auditAction(db, therapistId(req), {
      tool_name: 'assistant_profile.update',
      action_type: 'configuration',
      status: 'completed',
      request: { fields: Object.keys(req.body || {}) },
      result: { profile_id: profile?.id },
    });
    await persistIfNeeded();
    res.json({ profile });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/memories', async (req, res) => {
  try {
    const db = getAsyncDb();
    const rows = await db.all(
      `SELECT id, memory_type, category, content, source, scope_type, scope_id, surface, confidence, pinned,
              last_observed_at, created_at, updated_at
         FROM assistant_memories
        WHERE therapist_id = ? AND archived_at IS NULL
        ORDER BY pinned DESC, last_observed_at DESC, created_at DESC`,
      therapistId(req),
    );
    res.json({ memories: rows });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/memories', async (req, res) => {
  try {
    const db = getAsyncDb();
    const memory = await addMemory(db, therapistId(req), req.body || {});
    await auditAction(db, therapistId(req), {
      tool_name: 'assistant_memory.create',
      action_type: 'memory',
      status: 'completed',
      request: { category: memory.category, memory_type: memory.memory_type },
      result: { memory_id: memory.id },
    });
    await persistIfNeeded();
    res.status(201).json({ memory });
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/memories/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const ok = await archiveMemory(db, therapistId(req), req.params.id);
    if (!ok) return res.status(404).json({ error: 'Memory not found' });
    await auditAction(db, therapistId(req), {
      tool_name: 'assistant_memory.archive',
      action_type: 'memory',
      status: 'completed',
      request: { memory_id: req.params.id },
    });
    await persistIfNeeded();
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/skills', async (req, res) => {
  try {
    const db = getAsyncDb();
    const snapshot = await getRuntimeSnapshot(db, therapistId(req));
    res.json({ skills: snapshot.skills });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/sessions', async (req, res) => {
  try {
    const db = getAsyncDb();
    const id = await startAssistantSession(db, therapistId(req), req.body || {});
    await persistIfNeeded();
    res.status(201).json({ id });
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/sessions/:id/touch', async (req, res) => {
  try {
    const db = getAsyncDb();
    await touchAssistantSession(db, therapistId(req), req.params.id);
    await persistIfNeeded();
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/audit', async (req, res) => {
  try {
    const db = getAsyncDb();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const rows = await db.all(
      `SELECT id, session_id, tool_name, action_type, status, requires_approval,
              created_at, completed_at
         FROM assistant_action_audit
        WHERE therapist_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      therapistId(req),
      limit,
    );
    res.json({ audit: rows });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
