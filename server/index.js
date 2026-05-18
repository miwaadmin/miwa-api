const path = require('path');
require('./lib/loadEnv').loadEnv();

// ── PHI-safe logging — must be first so all subsequent console calls are scrubbed
const { patchGlobalConsole } = require('./lib/logger');
patchGlobalConsole();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { getAsyncDb, initAsyncDb, persistIfNeeded } = require('./db/asyncDb');
const requireAuth = require('./middleware/auth');
const { phiAuditLog } = require('./middleware/auditLog');
const {
  logCredentialTierChange,
  validateSelfServiceCredentialChange,
} = require('./services/credentialTier');

// ── Validate required env vars at startup ────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Server will not start.');
  process.exit(1);
}

const app = express();
// Trust the Azure App Service reverse proxy so rate-limiters can read real client IPs.
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
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

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
      connectSrc: [
        "'self'",
        'https://cloud.umami.is',
        'https://api-gateway.umami.dev',
        'https://api.openai.com',
        'wss://api.openai.com',
      ],
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

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.WEBHOOK_RATE_LIMIT_MAX || 600),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Webhook rate limit exceeded' },
});

function clientPortalEnabled(req, res, next) {
  if (String(process.env.CLIENT_PORTAL_ENABLED || 'true').toLowerCase() === 'false') {
    return res.status(404).json({ error: 'Client portal is not enabled.' });
  }
  return next();
}

// ── Public routes ────────────────────────────────────────────────────────────
app.use('/api/auth/login',            authLimiter);
app.use('/api/auth/register',         authLimiter);
app.use('/api/auth/admin-login',      authLimiter);
app.use('/api/auth/forgot-password',  authLimiter);
app.use('/api/auth/reset-password',   authLimiter);
app.use('/api/client-auth/login',     authLimiter);
app.use('/api/client-auth/accept-invite', authLimiter);
// Brute-force protection on invite-code redemption: 10 attempts/min/IP
// matches the spec. Errors are intentionally generic ("invalid or expired
// code") so a successful brute-force can't distinguish unknown vs revoked
// vs expired from the response body.
app.use('/api/client-auth/redeem', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many invite-code attempts. Please wait a minute and try again.' },
}));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/client-auth', clientPortalEnabled, require('./routes/client-auth'));
app.use('/api/public', publicLimiter, require('./routes/public')); // client-facing assessment links
app.use('/api/public', require('./routes/public-lethality')); // anonymous LAP-MD submit (has its own rate limiter)
app.use('/api/public', publicLimiter, require('./routes/public-network')); // public professional directory
function healthPayload() {
  return {
    status: 'ok',
    service: 'miwa-api',
    environment: process.env.NODE_ENV || 'unknown',
    time: new Date().toISOString(),
  };
}

app.get('/health', (req, res) => res.json(healthPayload()));
app.get('/api/health', (req, res) => res.json(healthPayload()));

// Discord bot diagnostic — public, no auth, no PHI. Reports lifecycle
// state so we can verify the bot is connected without log-stream access.
// Hit /api/_diag/discord in a browser.
app.get('/api/_diag/discord', (req, res) => {
  try {
    const { getDiscordBotStatus } = require('./services/discordBot');
    return res.json(getDiscordBotStatus());
  } catch (err) {
    return res.status(500).json({ error: 'discord module not loaded', detail: err?.message });
  }
});

// ── Billing routes (JSON-parsed; requireAuth is applied inside the router) ───
app.use('/api/billing/webhook', webhookLimiter);
app.use('/api/billing', require('./routes/billing'));

// ── Protected routes ─────────────────────────────────────────────────────────
app.use('/api/admin',                         require('./routes/admin'));
app.use('/api/patients/:patientId/genogram',  apiLimiter, requireAuth, phiAuditLog, require('./routes/genograms'));
app.use('/api/patients',                      apiLimiter, requireAuth, phiAuditLog, require('./routes/patients'));
app.use('/api/patients/:patientId/sessions',  apiLimiter, requireAuth, phiAuditLog, require('./routes/sessions'));
app.use('/api/patients/:patientId/documents', apiLimiter, requireAuth, phiAuditLog, require('./routes/documents'));
app.use('/api/agent/tasks',                   apiLimiter, requireAuth, phiAuditLog, require('./routes/agent-tasks'));
app.use('/api/assistant',                     apiLimiter, requireAuth, phiAuditLog, require('./routes/assistant'));
app.use('/api/inbox',                         apiLimiter, requireAuth, phiAuditLog, require('./routes/inbox'));
app.use('/api/agent',                         aiLimiter,  requireAuth, phiAuditLog, require('./routes/agent'));
app.use('/api/ai',                            aiLimiter,  requireAuth, phiAuditLog, require('./routes/ai'));
app.use('/api/assessments',                   apiLimiter, requireAuth, phiAuditLog, require('./routes/assessments'));
app.use('/api/self-care',                     apiLimiter, requireAuth, require('./routes/self-care'));
app.use('/api/client-portal',                 apiLimiter, clientPortalEnabled, require('./routes/client-portal'));
app.use('/api/contacts',                      apiLimiter, requireAuth, require('./routes/contacts'));
app.use('/api/digest',                        apiLimiter, requireAuth, require('./routes/emaildigest'));
app.use('/api/seed',                          apiLimiter, requireAuth, require('./routes/demo'));
app.use('/api/brief',                         apiLimiter, requireAuth, require('./routes/brief'));
app.use('/api/research',                      apiLimiter, require('./routes/research'));
app.use('/api/feedback',                      apiLimiter, require('./routes/feedback'));
app.use('/api/activity',                      apiLimiter, require('./routes/activity'));
app.use('/api/onboarding',                    apiLimiter, require('./routes/onboarding'));
app.use('/api/client-invites',                apiLimiter, requireAuth, require('./routes/client-invites'));
app.use('/api/hours',                         apiLimiter, requireAuth, require('./routes/hours'));
// /api/automations removed — replaced by Proactive Outreach (/api/ai/outreach-rules)
// /api/practice removed — group practice is a separate product

// Settings — per-therapist
app.get('/api/settings', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const row = await db.get(
      `SELECT user_role, credential_type, credential_verified, referral_code, assistant_action_mode, assistant_tone,
              assistant_orientation, assistant_verbosity, assistant_memory,
              assistant_permissions_json, training_data_opt_out,
              onboarding_completed, soul_markdown
       FROM therapists WHERE id = ?`,
      req.therapist.id
    );
    const counts = {
      patients: (await db.get('SELECT COUNT(*) as c FROM patients WHERE therapist_id = ?', req.therapist.id))?.c || 0,
      sessions: (await db.get('SELECT COUNT(*) as c FROM sessions WHERE therapist_id = ?', req.therapist.id))?.c || 0,
      appointments: (await db.get('SELECT COUNT(*) as c FROM appointments WHERE therapist_id = ? AND status != ?', req.therapist.id, 'cancelled'))?.c || 0,
    };
    const hasEstablishedAccount = !!row?.soul_markdown || counts.patients > 0 || counts.sessions > 0 || counts.appointments > 0;
    const onboardingCompleted = row?.onboarding_completed === undefined
      ? true
      : !!row?.onboarding_completed || hasEstablishedAccount;
    if (hasEstablishedAccount && !row?.onboarding_completed) {
      await db.run('UPDATE therapists SET onboarding_completed = 1 WHERE id = ?', req.therapist.id);
      await persistIfNeeded();
    }
    res.json({
      user_role: row?.user_role || 'licensed',
      credential_type: row?.credential_type || row?.user_role || 'licensed',
      credential_verified: !!row?.credential_verified,
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
      training_data_opt_out: !!row?.training_data_opt_out,
      onboarding_completed: onboardingCompleted,
      onboarding_inferred: hasEstablishedAccount && !row?.onboarding_completed,
      account_counts: counts,
      soul_markdown: row?.soul_markdown || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/settings', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key is required' });
    if (key === 'user_role') {
      await db.run('UPDATE therapists SET user_role = ? WHERE id = ?', value, req.therapist.id);
    }
    if (key === 'credential_type' || key === 'account_stage') {
      const validation = await validateSelfServiceCredentialChange(db, req.therapist.id, value);
      if (!validation.ok) return res.status(validation.status).json(validation.body);
      const next = validation.next;
      const current = validation.current;

      const now = new Date().toISOString();
      if (next === 'licensed' || next === 'associate') {
        await db.run(
          `UPDATE therapists
              SET credential_type = ?,
                  user_role = ?,
                  credential_verified = CASE WHEN credential_verified IS NULL OR credential_verified = 0 THEN 1 ELSE credential_verified END,
                  workspace_mode = 'private_practice',
                  client_record_mode = 'miwa_system_of_record',
                  workspace_mode_selected_at = COALESCE(workspace_mode_selected_at, ?),
                  onboarding_step = CASE WHEN onboarded_at IS NULL AND COALESCE(onboarding_step, 0) < 6 THEN 6 ELSE onboarding_step END,
                  onboarded_at = COALESCE(onboarded_at, ?)
            WHERE id = ?`,
          next, next, now, now, req.therapist.id
        );
      } else {
        await db.run(
          `UPDATE therapists
              SET credential_type = ?,
                  user_role = ?,
                  workspace_mode = 'agency_companion',
                  client_record_mode = 'agency_ehr_companion',
                  workspace_mode_selected_at = COALESCE(workspace_mode_selected_at, ?)
            WHERE id = ?`,
          next, next, now, req.therapist.id
        );
      }
      if (current !== next) {
        await logCredentialTierChange(db, {
          therapistId: req.therapist.id,
          actorId: req.therapist.id,
          oldTier: current,
          newTier: next,
          source: 'settings',
        });
      }
    }
    if (key === 'assistant_verbosity') {
      await db.run('UPDATE therapists SET assistant_verbosity = ? WHERE id = ?', value, req.therapist.id);
    }
    if (key === 'assistant_action_mode') {
      await db.run('UPDATE therapists SET assistant_action_mode = ? WHERE id = ?', value, req.therapist.id);
    }
    if (key === 'assistant_tone') {
      await db.run('UPDATE therapists SET assistant_tone = ? WHERE id = ?', value, req.therapist.id);
    }
    if (key === 'assistant_orientation') {
      await db.run('UPDATE therapists SET assistant_orientation = ? WHERE id = ?', value, req.therapist.id);
    }
    if (key === 'assistant_memory') {
      await db.run('UPDATE therapists SET assistant_memory = ? WHERE id = ?', value, req.therapist.id);
    }
    if (key === 'assistant_permissions') {
      await db.run('UPDATE therapists SET assistant_permissions_json = ? WHERE id = ?', JSON.stringify(value || []), req.therapist.id);
    }
    if (key === 'auto_mbc_enabled') {
      const row2 = await db.get('SELECT assistant_permissions_json FROM therapists WHERE id = ?', req.therapist.id);
      const perms = (() => { try { return row2?.assistant_permissions_json ? JSON.parse(row2.assistant_permissions_json) : {} } catch { return {} } })();
      perms.auto_mbc_enabled = !!value;
      await db.run('UPDATE therapists SET assistant_permissions_json = ? WHERE id = ?', JSON.stringify(perms), req.therapist.id);
    }
    if (key === 'training_data_opt_out') {
      await db.run('UPDATE therapists SET training_data_opt_out = ? WHERE id = ?', value ? 1 : 0, req.therapist.id);
    }
    if (key === 'onboarding_completed') {
      await db.run('UPDATE therapists SET onboarding_completed = ? WHERE id = ?', value ? 1 : 0, req.therapist.id);
    }
    if (key === 'soul_markdown') {
      await db.run('UPDATE therapists SET soul_markdown = ?, onboarding_completed = 1 WHERE id = ?', String(value || ''), req.therapist.id);
    }
    await persistIfNeeded();
    res.json({ message: 'Setting saved' });
  } catch (err) {
    console.error('[settings/post]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Stats — scoped to logged-in therapist
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;

    // Date strings for "today" and "Monday of this week" in the therapist's
    // preferred timezone. Avoids the wrong-day-after-5pm-PST bug we'd get
    // from naively using SQLite's date('now') on a UTC-time cloud host.
    const tz = req.therapist?.preferred_timezone || 'America/Los_Angeles';
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
    const [tyy, tmm, tdd] = todayStr.split('-').map(Number);
    const todayUTC = new Date(Date.UTC(tyy, tmm - 1, tdd));
    const dayOfWeek = todayUTC.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const mondayUTC = new Date(todayUTC);
    mondayUTC.setUTCDate(mondayUTC.getUTCDate() - daysSinceMonday);
    const mondayStr = mondayUTC.toISOString().slice(0, 10);
    const monthStartStr = `${todayStr.slice(0, 8)}01`;

    const isPostgres = process.env.DB_PROVIDER === 'postgres';
    const sessionDateExpr = isPostgres
      ? "COALESCE(NULLIF(session_date::text, '')::date, created_at::date)"
      : "COALESCE(session_date, date(created_at))";
    const sessionOrderExpr = isPostgres
      ? "COALESCE(NULLIF(s.session_date::text, '')::timestamp, s.created_at::timestamp)"
      : "COALESCE(s.session_date, s.created_at)";
    const sessionDateExprForAlias = isPostgres
      ? "COALESCE(NULLIF(s.session_date::text, '')::date, s.created_at::date)"
      : "COALESCE(s.session_date, date(s.created_at))";
    const appointmentDateExpr = isPostgres
      ? "scheduled_start::timestamp::date"
      : "DATE(scheduled_start)";

    // Caseload count. (No `status` column on patients today — when we add
    // archive/inactive support later, gate this with `status != 'inactive'`.)
    const totalPatients = (await db.get(
      `SELECT COUNT(*) as count
       FROM patients
       WHERE therapist_id = ?
         AND COALESCE(NULLIF(status, ''), 'active') != 'archived'`,
      tid
    )).count;

    const activePatientClause = "COALESCE(NULLIF(p.status, ''), 'active') != 'archived'";

    const totalSessions = (await db.get(
      `SELECT COUNT(*) as count
       FROM sessions s JOIN patients p ON s.patient_id = p.id
       WHERE s.therapist_id = ?
         AND ${activePatientClause}`,
      tid
    )).count;

    // Calendar-week Mon-Sun count, by when the session actually happened.
    // COALESCE handles older rows that may not have session_date set.
    const sessionsThisWeek = (await db.get(
      `SELECT COUNT(*) as count
       FROM sessions s JOIN patients p ON s.patient_id = p.id
       WHERE s.therapist_id = ?
         AND ${activePatientClause}
         AND ${sessionDateExprForAlias} >= ?`,
      tid, mondayStr
    )).count;

    const sessionsThisMonth = (await db.get(
      `SELECT COUNT(*) as count
       FROM sessions s JOIN patients p ON s.patient_id = p.id
       WHERE s.therapist_id = ?
         AND ${activePatientClause}
         AND ${sessionDateExprForAlias} >= ?`,
      tid, monthStartStr
    )).count;

    // Appointments scheduled for today in the therapist's TZ. We match by the
    // date portion of scheduled_start (UTC ISO). For most caseloads this is
    // accurate; late-evening appointments near midnight in non-UTC TZs may
    // fall on the wrong calendar day — acceptable for v1.
    const appointmentsToday = (await db.get(
      `SELECT COUNT(*) as count FROM appointments
       WHERE therapist_id = ?
         AND status NOT IN ('cancelled', 'no_show', 'completed')
         AND ${appointmentDateExpr} = ?`,
      tid, todayStr
    )).count;

    const unsignedNotes = (await db.get(
      `SELECT COUNT(*) as count
       FROM sessions s JOIN patients p ON s.patient_id = p.id
       WHERE s.therapist_id = ?
         AND ${activePatientClause}
         AND s.signed_at IS NULL
         AND (s.subjective IS NOT NULL OR s.assessment IS NOT NULL OR s.plan IS NOT NULL)`,
      tid
    )).count;

    // Recent sessions stay compact: last 14 local days, one latest session
    // per client. The full archive lives on each patient chart.
    const twoWeeksAgoUTC = new Date(todayUTC);
    twoWeeksAgoUTC.setUTCDate(twoWeeksAgoUTC.getUTCDate() - 13);
    const twoWeeksAgoStr = twoWeeksAgoUTC.toISOString().slice(0, 10);

    const recentSessionRows = await db.all(`
      SELECT s.id, s.patient_id, s.session_date, s.assessment, s.created_at,
             p.client_id, p.display_name, s.note_format, s.signed_at
      FROM sessions s JOIN patients p ON s.patient_id = p.id
      WHERE s.therapist_id = ?
        AND ${activePatientClause}
        AND ${sessionDateExprForAlias} >= ?
      ORDER BY ${sessionOrderExpr} DESC
      LIMIT 50
    `, tid, twoWeeksAgoStr);
    const seenRecentPatients = new Set();
    const recentSessions = [];
    for (const session of recentSessionRows) {
      if (seenRecentPatients.has(session.patient_id)) continue;
      seenRecentPatients.add(session.patient_id);
      recentSessions.push(session);
      if (recentSessions.length >= 6) break;
    }

    res.json({
      totalPatients, totalSessions, sessionsThisWeek, sessionsThisMonth,
      appointmentsToday, unsignedNotes, recentSessions,
    });
  } catch (err) {
    console.warn('[stats] dashboard stats failed:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// All unsigned session notes for the current therapist, across every client.
// Drives the "Unsigned" tile on the dashboard — clicking the tile lands here.
app.get('/api/sessions/unsigned', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const rows = await db.all(`
      SELECT s.id, s.patient_id, s.session_date, s.created_at, s.note_format,
             s.subjective, s.assessment, s.plan,
             s.trainee_note_status, s.copied_to_ehr_at, s.copied_to_ehr_name,
             s.needs_supervision, s.draft_completed_at, s.reviewed_by_trainee_at,
             s.risk_safety_checked_at, s.discussed_in_supervision_at,
             s.follow_up_completed_at, s.copy_to_ehr_checklist_json,
             p.client_id, p.display_name
      FROM sessions s JOIN patients p ON s.patient_id = p.id
      WHERE s.therapist_id = ?
        AND COALESCE(NULLIF(p.status, ''), 'active') != 'archived'
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
      trainee_note_status: r.trainee_note_status || null,
      copied_to_ehr_at: r.copied_to_ehr_at || null,
      copied_to_ehr_name: r.copied_to_ehr_name || null,
      needs_supervision: !!r.needs_supervision,
      draft_completed_at: r.draft_completed_at || null,
      reviewed_by_trainee_at: r.reviewed_by_trainee_at || null,
      risk_safety_checked_at: r.risk_safety_checked_at || null,
      discussed_in_supervision_at: r.discussed_in_supervision_at || null,
      follow_up_completed_at: r.follow_up_completed_at || null,
      copy_to_ehr_checklist_json: r.copy_to_ehr_checklist_json || null,
      preview: (r.assessment || r.plan || r.subjective || '').replace(/\s+/g, ' ').slice(0, 180),
    }));
    res.json({ count: items.length, sessions: items });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Archived notes storage: notes attached to archived/former clients only.
// These remain retrievable for recordkeeping without appearing in active app feeds.
app.get('/api/sessions/archive', requireAuth, async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = req.therapist.id;
    const rows = await db.all(`
      SELECT s.id, s.patient_id, s.session_date, s.created_at, s.note_format,
             s.subjective, s.assessment, s.plan, s.full_note, s.signed_at,
             s.trainee_note_status, s.copied_to_ehr_at, s.copied_to_ehr_name,
             s.needs_supervision, s.draft_completed_at, s.reviewed_by_trainee_at,
             s.risk_safety_checked_at, s.discussed_in_supervision_at,
             s.follow_up_completed_at, s.copy_to_ehr_checklist_json,
             p.client_id, p.display_name, p.status, p.archived_at,
             p.therapy_ended_at, p.retention_until, p.retention_basis
      FROM sessions s JOIN patients p ON s.patient_id = p.id
      WHERE s.therapist_id = ?
        AND COALESCE(NULLIF(p.status, ''), 'active') = 'archived'
        AND (s.subjective IS NOT NULL OR s.assessment IS NOT NULL OR s.plan IS NOT NULL OR s.full_note IS NOT NULL)
      ORDER BY p.archived_at DESC, COALESCE(s.session_date, s.created_at) DESC
      LIMIT 300
    `, tid);
    const sessions = rows.map(r => ({
      id: r.id,
      patient_id: r.patient_id,
      client_id: r.client_id,
      display_name: r.display_name,
      status: r.status,
      archived_at: r.archived_at || null,
      therapy_ended_at: r.therapy_ended_at || null,
      retention_until: r.retention_until || null,
      retention_basis: r.retention_basis || null,
      session_date: r.session_date,
      created_at: r.created_at,
      note_format: r.note_format || 'SOAP',
      signed_at: r.signed_at || null,
      trainee_note_status: r.trainee_note_status || null,
      copied_to_ehr_at: r.copied_to_ehr_at || null,
      copied_to_ehr_name: r.copied_to_ehr_name || null,
      needs_supervision: !!r.needs_supervision,
      draft_completed_at: r.draft_completed_at || null,
      reviewed_by_trainee_at: r.reviewed_by_trainee_at || null,
      risk_safety_checked_at: r.risk_safety_checked_at || null,
      discussed_in_supervision_at: r.discussed_in_supervision_at || null,
      follow_up_completed_at: r.follow_up_completed_at || null,
      copy_to_ehr_checklist_json: r.copy_to_ehr_checklist_json || null,
      preview: (r.full_note || r.assessment || r.plan || r.subjective || '').replace(/\s+/g, ' ').slice(0, 220),
    }));
    res.json({ count: sessions.length, sessions });
  } catch (err) {
    console.warn('[sessions/archive] failed:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Serve built React frontend in production ─────────────────────────────────
const fs = require('fs');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, {
    setHeaders(res, filePath) {
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (normalizedPath.endsWith('/index.html') || normalizedPath.endsWith('/sw.js') || normalizedPath.endsWith('/manifest.json')) {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        return;
      }
      if (normalizedPath.includes('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  // SPA catch-all — must come after all API routes
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// Auto-start the server when run directly (`node server/index.js`).
// When this module is required by tests, we skip the auto-start so the
// test harness can call `initDb()` and `app.listen(0)` itself with an
// isolated DB path. The schedulers + task worker also stay off in tests
// so cron jobs don't interfere with assertions.
if (require.main === module) {
  initAsyncDb().then(() => {
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
    // Discord bot — opt-in via DISCORD_BOT_TOKEN. Won't start without it.
    try {
      const { startDiscordBot } = require('./services/discordBot');
      startDiscordBot().catch(err => console.error('[discord] startup error:', err.message));
    } catch (err) {
      console.error('Discord bot module failed to load:', err.message);
    }
    app.listen(PORT, () => console.log(`Miwa server running on http://localhost:${PORT}`));
  }).catch(err => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });
}

module.exports = { app, initDb: initAsyncDb };
