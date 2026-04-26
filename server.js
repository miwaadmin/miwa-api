const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ── PHI-safe logging — must be first so all subsequent console calls are scrubbed
const { patchGlobalConsole } = require('./lib/logger');
patchGlobalConsole();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDb, getDb } = require('./db');
const requireAuth = require('./middleware/auth');
const { phiAuditLog } = require('./middleware/auditLog');

// ── Validate required env vars at startup ────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Server will not start.');
  process.exit(1);
}

const app = express();
// Trust Railway/Render/Heroku reverse proxy so rate-limiters can read real client IPs
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
const APP_BASE_URL = process.env.APP_BASE_URL || '';
const EXTRA_CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
// Capacitor mobile apps use these origins regardless of environment
const CAPACITOR_ORIGINS = ['capacitor://localhost', 'ionic://localhost', 'http://localhost', 'https://localhost'];
const allowedOrigins = [...new Set([CORS_ORIGIN, APP_BASE_URL, ...EXTRA_CORS_ORIGINS, ...CAPACITOR_ORIGINS].filter(Boolean))];
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');

function healthPayload() {
  return {
    status: 'ok',
    service: 'miwa-api',
    environment: process.env.NODE_ENV || 'unknown',
    time: new Date().toISOString(),
  };
}

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  // Allow inline scripts/styles needed by Vite-built React app.
  // Umami analytics: script loads from cloud.umami.is and POSTs beacons
  // there too — both hosts need to be allowed explicitly, otherwise the
  // strict `'self'` CSP silently blocks analytics in production.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cloud.umami.is'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://cloud.umami.is', 'https://api-gateway.umami.dev'],
    },
  },
}));

// ── CORS — credentials:true needed for HttpOnly cookie auth ──────────────────
app.use(cors({
  origin: (origin, cb) => {
    // No origin = same-origin or server-to-server → always allow
    if (!origin) return cb(null, true);
    // Known Capacitor/dev origins → add CORS headers
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Miwa-Diag-Secret'],
}));

// ── Cookie parser — must come before route handlers ───────────────────────────
app.use(cookieParser());

// ── Stripe webhook needs RAW body before express.json() runs ─────────────────
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Rate limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

// Data + AI endpoints: 120 requests per minute per IP (generous but prevents abuse)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// AI generation endpoints: 15 per minute (expensive calls)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests. Please wait a moment.' },
});

// Public token-gated endpoints (patient assessments, portal): 30 per 15 min
// per IP — comfortable for legitimate patient flows, shuts down enumeration.
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
});

// ── Public routes ────────────────────────────────────────────────────────────
app.use('/api/auth/login',            authLimiter);
app.use('/api/auth/register',         authLimiter);
app.use('/api/auth/admin-login',      authLimiter);
app.use('/api/auth/forgot-password',  authLimiter);
app.use('/api/auth/reset-password',   authLimiter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/public', publicLimiter, require('./routes/public')); // client-facing assessment links
app.use('/api/public', require('./routes/public-lethality')); // anonymous LAP-MD submit (has its own rate limiter)
app.use('/api/public', publicLimiter, require('./routes/public-network')); // public professional directory
app.get('/', (req, res) => res.json({ service: 'miwa-api', status: 'running' }));
app.get('/health', (req, res) => res.json(healthPayload()));
app.get('/api/health', (req, res) => res.json(healthPayload()));

// ── Billing routes (JSON-parsed; requireAuth is applied inside the router) ───
app.use('/api/billing', require('./routes/billing'));

// ── Protected routes ─────────────────────────────────────────────────────────
app.use('/api/admin',                         require('./routes/admin'));
app.use('/api/patients',                      apiLimiter, requireAuth, phiAuditLog, require('./routes/patients'));
app.use('/api/patients/:patientId/sessions',  apiLimiter, requireAuth, phiAuditLog, require('./routes/sessions'));
app.use('/api/patients/:patientId/documents', apiLimiter, requireAuth, phiAuditLog, require('./routes/documents'));
app.use('/api/agent/tasks',                   apiLimiter, requireAuth, phiAuditLog, require('./routes/agent-tasks'));
app.use('/api/agent',                         aiLimiter,  requireAuth, phiAuditLog, require('./routes/agent'));
app.use('/api/ai',                            aiLimiter,  requireAuth, phiAuditLog, require('./routes/ai'));
app.use('/api/assessments',                   apiLimiter, requireAuth, phiAuditLog, require('./routes/assessments'));
app.use('/api/contacts',                      apiLimiter, requireAuth, require('./routes/contacts'));
app.use('/api/digest',                        apiLimiter, requireAuth, require('./routes/emaildigest'));
app.use('/api/seed',                          apiLimiter, requireAuth, require('./routes/demo'));
app.use('/api/research',                      apiLimiter, require('./routes/research'));
app.use('/api/feedback',                      apiLimiter, requireAuth, require('./routes/feedback'));
app.use('/api/activity',                      apiLimiter, require('./routes/activity'));
app.use('/api/onboarding',                    apiLimiter, require('./routes/onboarding'));
// /api/automations removed — replaced by Proactive Outreach (/api/ai/outreach-rules)
// /api/practice removed — group practice is a separate product

// Settings — per-therapist
app.get('/api/settings', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const row = db.get('SELECT user_role, referral_code, assistant_action_mode, assistant_tone, assistant_orientation, assistant_verbosity, assistant_memory, assistant_permissions_json FROM therapists WHERE id = ?', req.therapist.id);
    res.json({
      user_role: row?.user_role || 'licensed',
      referral_code: row?.referral_code || null,
      assistant_action_mode: row?.assistant_action_mode || 'draft_only',
      assistant_tone: row?.assistant_tone || 'calm, clinical, and collaborative',
      assistant_orientation: row?.assistant_orientation || 'integrative',
      assistant_verbosity: row?.assistant_verbosity || 'balanced',
      assistant_memory: row?.assistant_memory || '',
      assistant_permissions: (() => {
        try { return row?.assistant_permissions_json ? JSON.parse(row.assistant_permissions_json) : ['history','patient_context','session_context','documents'] } catch { return ['history','patient_context','session_context','documents'] }
      })(),
      auto_send_overdue: (() => {
        try { const p = row?.assistant_permissions_json ? JSON.parse(row.assistant_permissions_json) : {}; return !!p.auto_send_overdue } catch { return false }
      })(),
      auto_mbc_enabled: (() => {
        try { const p = row?.assistant_permissions_json ? JSON.parse(row.assistant_permissions_json) : {}; return p.auto_mbc_enabled !== false } catch { return true }
      })(),
      training_data_opt_out: (() => {
        try {
          const r = db.get('SELECT training_data_opt_out FROM therapists WHERE id = ?', req.therapist.id);
          return !!(r && r.training_data_opt_out);
        } catch { return false; }
      })(),
      onboarding_completed: (() => {
        try {
          const r = db.get('SELECT onboarding_completed FROM therapists WHERE id = ?', req.therapist.id);
          return !!(r && r.onboarding_completed);
        } catch { return true; }  // Default true = don't auto-pop for existing users
      })(),
      soul_markdown: (() => {
        try {
          const r = db.get('SELECT soul_markdown FROM therapists WHERE id = ?', req.therapist.id);
          return r?.soul_markdown || null;
        } catch { return null; }
      })(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key is required' });
    if (key === 'user_role') {
      db.run('UPDATE therapists SET user_role = ? WHERE id = ?', value, req.therapist.id);
    }
    if (key === 'assistant_verbosity') {
      db.run('UPDATE therapists SET assistant_verbosity = ? WHERE id = ?', value, req.therapist.id);
    }
    if (key === 'assistant_action_mode') {
      db.run('UPDATE therapists SET assistant_action_mode = ? WHERE id = ?', value, req.therapist.id);
    }
    if (key === 'assistant_tone') {
      db.run('UPDATE therapists SET assistant_tone = ? WHERE id = ?', value, req.therapist.id);
    }
    if (key === 'assistant_orientation') {
      db.run('UPDATE therapists SET assistant_orientation = ? WHERE id = ?', value, req.therapist.id);
    }
    if (key === 'assistant_memory') {
      db.run('UPDATE therapists SET assistant_memory = ? WHERE id = ?', value, req.therapist.id);
    }
    if (key === 'assistant_permissions') {
      db.run('UPDATE therapists SET assistant_permissions_json = ? WHERE id = ?', JSON.stringify(value || []), req.therapist.id);
    }
    if (key === 'auto_mbc_enabled') {
      const row2 = db.get('SELECT assistant_permissions_json FROM therapists WHERE id = ?', req.therapist.id);
      const perms = (() => { try { return row2?.assistant_permissions_json ? JSON.parse(row2.assistant_permissions_json) : {} } catch { return {} } })();
      perms.auto_mbc_enabled = !!value;
      db.run('UPDATE therapists SET assistant_permissions_json = ? WHERE id = ?', JSON.stringify(perms), req.therapist.id);
    }
    if (key === 'training_data_opt_out') {
      db.run('UPDATE therapists SET training_data_opt_out = ? WHERE id = ?', value ? 1 : 0, req.therapist.id);
    }
    if (key === 'onboarding_completed') {
      db.run('UPDATE therapists SET onboarding_completed = ? WHERE id = ?', value ? 1 : 0, req.therapist.id);
    }
    if (key === 'soul_markdown') {
      db.run('UPDATE therapists SET soul_markdown = ?, onboarding_completed = 1 WHERE id = ?', String(value || ''), req.therapist.id);
    }
    res.json({ message: 'Setting saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats — scoped to logged-in therapist
app.get('/api/stats', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const tid = req.therapist.id;

    // Date strings for "today" and "Monday of this week" in the therapist's
    // preferred timezone. Avoids the wrong-day-after-5pm-PST bug we'd get
    // from naively using SQLite's date('now') on a UTC-time Railway box.
    const tz = req.therapist?.preferred_timezone || 'America/Los_Angeles';
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
    const [tyy, tmm, tdd] = todayStr.split('-').map(Number);
    const todayUTC = new Date(Date.UTC(tyy, tmm - 1, tdd));
    const dayOfWeek = todayUTC.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const mondayUTC = new Date(todayUTC);
    mondayUTC.setUTCDate(mondayUTC.getUTCDate() - daysSinceMonday);
    const mondayStr = mondayUTC.toISOString().slice(0, 10);

    // Caseload count. (No `status` column on patients today — when we add
    // archive/inactive support later, gate this with `status != 'inactive'`.)
    const totalPatients = db.get(
      `SELECT COUNT(*) as count FROM patients WHERE therapist_id = ?`,
      tid
    ).count;

    const totalSessions = db.get('SELECT COUNT(*) as count FROM sessions WHERE therapist_id = ?', tid).count;

    // Calendar-week Mon-Sun count, by when the session actually happened.
    // COALESCE handles older rows that may not have session_date set.
    const sessionsThisWeek = db.get(
      `SELECT COUNT(*) as count FROM sessions
       WHERE therapist_id = ?
         AND COALESCE(session_date, date(created_at)) >= ?`,
      tid, mondayStr
    ).count;

    const sessionsThisMonth = db.get(
      `SELECT COUNT(*) as count FROM sessions
       WHERE therapist_id = ?
         AND COALESCE(session_date, date(created_at)) >= ?`,
      tid, todayStr.slice(0, 8) + '01'  // first of this month
    ).count;

    // Appointments scheduled for today in the therapist's TZ. We match by the
    // date portion of scheduled_start (UTC ISO). For most caseloads this is
    // accurate; late-evening appointments near midnight in non-UTC TZs may
    // fall on the wrong calendar day — acceptable for v1.
    const appointmentsToday = db.get(
      `SELECT COUNT(*) as count FROM appointments
       WHERE therapist_id = ?
         AND status NOT IN ('cancelled', 'no_show', 'completed')
         AND DATE(scheduled_start) = ?`,
      tid, todayStr
    ).count;

    const unsignedNotes = db.get(
      'SELECT COUNT(*) as count FROM sessions WHERE therapist_id = ? AND signed_at IS NULL AND (subjective IS NOT NULL OR assessment IS NOT NULL OR plan IS NOT NULL)',
      tid
    ).count;

    // Recent sessions — only the last 7 days. Past that gets bloated for
    // therapists with multiple clients; the full archive lives on the
    // patient detail page or via the Workspace history view.
    const recentSessions = db.all(`
      SELECT s.id, s.patient_id, s.session_date, s.assessment, s.created_at,
             p.client_id, p.display_name, s.note_format, s.signed_at
      FROM sessions s JOIN patients p ON s.patient_id = p.id
      WHERE s.therapist_id = ?
        AND COALESCE(s.session_date, date(s.created_at)) >= date('now', '-7 days')
      ORDER BY COALESCE(s.session_date, s.created_at) DESC
      LIMIT 10
    `, tid);

    res.json({
      totalPatients, totalSessions, sessionsThisWeek, sessionsThisMonth,
      appointmentsToday, unsignedNotes, recentSessions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All unsigned session notes for the current therapist, across every client.
// Drives the "Unsigned" tile on the dashboard — clicking the tile lands here.
app.get('/api/sessions/unsigned', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const tid = req.therapist.id;
    const rows = db.all(`
      SELECT s.id, s.patient_id, s.session_date, s.created_at, s.note_format,
             s.subjective, s.assessment, s.plan,
             p.client_id, p.display_name
      FROM sessions s JOIN patients p ON s.patient_id = p.id
      WHERE s.therapist_id = ?
        AND s.signed_at IS NULL
        AND (s.subjective IS NOT NULL OR s.assessment IS NOT NULL OR s.plan IS NOT NULL)
      ORDER BY COALESCE(s.session_date, s.created_at) DESC
    `, tid);
    // Trim long fields to a snippet for list display; full text loaded on click.
    const items = rows.map(r => ({
      id: r.id,
      patient_id: r.patient_id,
      client_id: r.client_id,
      display_name: r.display_name,
      session_date: r.session_date,
      created_at: r.created_at,
      note_format: r.note_format || 'SOAP',
      preview: (r.assessment || r.plan || r.subjective || '').replace(/\s+/g, ' ').slice(0, 180),
    }));
    res.json({ count: items.length, sessions: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Serve built React frontend in production ─────────────────────────────────
const fs = require('fs');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  // SPA catch-all — must come after all API routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// Auto-start the server when run directly (`node server.js`).
// When this module is required by tests, we skip the auto-start so the
// test harness can call `initDb()` and `app.listen(0)` itself with an
// isolated DB path. The schedulers + task worker also stay off in tests
// so cron jobs don't interfere with assertions.
if (require.main === module) {
  initDb().then(() => {
    try {
      const { startScheduler } = require('./services/scheduler');
      startScheduler();
    } catch (err) {
      console.error('Scheduler failed to start:', err.message);
    }
    try {
      const { startWorker } = require('./services/task-runner');
      startWorker();
    } catch (err) {
      console.error('Task worker failed to start:', err.message);
    }
    app.listen(PORT, () => console.log(`Miwa server running on http://localhost:${PORT}`));
  }).catch(err => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });
}

module.exports = { app, initDb };
