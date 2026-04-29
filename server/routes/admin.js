const express = require('express');
const bcrypt = require('bcryptjs');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { requireAdminAuth } = require('../middleware/auth');
const { sendMail, hasHipaaCoveredProvider, getMailerConfigStatus } = require('../services/mailer');

const router = express.Router();
router.use(requireAdminAuth);

function postgresSslConfig() {
  if (String(process.env.PGSSLMODE || '').toLowerCase() === 'disable') return false;
  return { rejectUnauthorized: false };
}

function sanitizePostgresError(err) {
  return {
    message: 'PostgreSQL connectivity check failed',
    code: err?.code || null,
    name: err?.name || null,
  };
}

function hasEnv(name) {
  return !!String(process.env[name] || '').trim();
}

function envValue(name) {
  return String(process.env[name] || '').trim();
}

function check(id, label, status, detail) {
  return { id, label, status, detail };
}

function configuredStripePrices() {
  const required = [
    'STRIPE_PRICE_TRAINEE',
    'STRIPE_PRICE_ASSOCIATE',
    'STRIPE_PRICE_SOLO',
    'STRIPE_PRICE_GROUP_BASE',
    'STRIPE_PRICE_GROUP_PER_SEAT',
  ];
  const missing = required.filter((name) => {
    const value = envValue(name);
    return !value || value.startsWith('price_REPLACE');
  });
  return { required, missing };
}

const STRIPE_PRICE_ENV = [
  ['trainee', 'STRIPE_PRICE_TRAINEE'],
  ['associate', 'STRIPE_PRICE_ASSOCIATE'],
  ['solo', 'STRIPE_PRICE_SOLO'],
  ['group_base', 'STRIPE_PRICE_GROUP_BASE'],
  ['group_per_seat', 'STRIPE_PRICE_GROUP_PER_SEAT'],
];

function classifyStripeId(value) {
  if (!value) return 'missing';
  if (value.startsWith('price_REPLACE')) return 'placeholder';
  if (value.startsWith('price_')) return 'price';
  if (value.startsWith('prod_')) return 'product';
  return 'unknown';
}

function redactStripeId(value) {
  if (!value) return null;
  if (value.length <= 12) return value.replace(/./g, '*');
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function stripeKeyMode(value) {
  if (!value) return 'missing';
  if (value.startsWith('sk_live_')) return 'live';
  if (value.startsWith('sk_test_')) return 'test';
  return 'unknown';
}

function sanitizeStripeAdminError(err) {
  return {
    message: 'Stripe verification failed',
    type: err?.type || null,
    code: err?.code || null,
    statusCode: err?.statusCode || err?.status || null,
    requestId: err?.requestId || err?.request_id || null,
  };
}

function adminReason(req) {
  return String(req.body?.reason || req.body?.admin_reason || '').trim();
}

function requireTypedConfirmation(req, expected) {
  const actual = String(req.body?.confirmation || req.body?.confirm || '').trim();
  if (actual !== expected) {
    return { ok: false, error: `Type ${expected} to confirm this admin action.` };
  }
  return { ok: true };
}

function requireReason(req, label = 'admin action') {
  const reason = adminReason(req);
  if (reason.length < 12) {
    return { ok: false, error: `A specific reason is required before this ${label}.` };
  }
  return { ok: true, reason };
}

async function verifyStripeCatalogItem(stripe, name, envName, value) {
  const type = classifyStripeId(value);
  const item = {
    name,
    env: envName,
    configured: type !== 'missing' && type !== 'placeholder',
    type,
    id: redactStripeId(value),
    exists: null,
    active: null,
    recurring: null,
    currency: null,
    error: null,
  };

  if (!item.configured || !stripe) return item;

  try {
    if (type === 'price') {
      const price = await stripe.prices.retrieve(value);
      item.exists = true;
      item.active = !!price.active;
      item.recurring = !!price.recurring;
      item.currency = price.currency || null;
      return item;
    }

    if (type === 'product') {
      const product = await stripe.products.retrieve(value, { expand: ['default_price'] });
      const defaultPrice = product?.default_price;
      item.exists = true;
      item.active = !!product.active;
      item.recurring = !!(defaultPrice && typeof defaultPrice === 'object' && defaultPrice.recurring);
      item.currency = typeof defaultPrice === 'object' ? defaultPrice.currency || null : null;
      return item;
    }

    item.error = 'Unsupported Stripe ID prefix';
    return item;
  } catch (err) {
    item.exists = false;
    item.error = sanitizeStripeAdminError(err);
    return item;
  }
}

function stripePriceReviewReason(price) {
  if (!price.configured) return price.type === 'placeholder' ? 'Replace placeholder value' : 'Missing environment value';
  if (price.type !== 'price' && price.type !== 'product') return 'Use a Stripe price_ ID for this plan';
  if (price.exists === false) return 'Not found by the configured Stripe API key. Check live/test mode, account, and ID.';
  if (price.active === false) return 'Stripe item is inactive';
  if (price.recurring === false) return 'Stripe item is not a recurring subscription price';
  return 'Ready';
}

function configuredSmsProvider() {
  const twilioHasAuth = hasEnv('TWILIO_AUTH_TOKEN')
    || (hasEnv('TWILIO_API_KEY_SID') && hasEnv('TWILIO_API_KEY_SECRET'));
  const twilioConfigured = hasEnv('TWILIO_ACCOUNT_SID')
    && twilioHasAuth
    && (hasEnv('TWILIO_PHONE_NUMBER') || hasEnv('TWILIO_MESSAGING_SERVICE_SID'));
  const vonageConfigured = hasEnv('VONAGE_API_KEY')
    && hasEnv('VONAGE_API_SECRET')
    && hasEnv('VONAGE_FROM_NUMBER');
  const providers = [];
  if (twilioConfigured) providers.push('twilio');
  if (vonageConfigured) providers.push('vonage');
  return { configured: providers.length > 0, providers };
}

function buildReadinessChecks() {
  const dbProvider = String(process.env.DB_PROVIDER || 'sqlite').toLowerCase();
  const pgSslMode = String(process.env.PGSSLMODE || '').toLowerCase();
  const jwtLength = String(process.env.JWT_SECRET || '').length;
  const appUrl = process.env.APP_URL || process.env.APP_BASE_URL || '';
  const apiBaseUrl = process.env.API_BASE_URL || process.env.PUBLIC_API_URL || '';
  const stripeSecret = envValue('STRIPE_SECRET_KEY');
  const stripeWebhookSecret = envValue('STRIPE_WEBHOOK_SECRET');
  const stripePrices = configuredStripePrices();
  const fromEmail = envValue('FROM_EMAIL');
  const mailer = getMailerConfigStatus();
  const sms = configuredSmsProvider();

  const checks = [
    check(
      'node_env',
      'Node environment',
      process.env.NODE_ENV === 'production' ? 'pass' : 'warn',
      process.env.NODE_ENV === 'production'
        ? 'Running in production mode'
        : 'NODE_ENV is not production'
    ),
    check(
      'jwt_secret',
      'JWT signing secret',
      jwtLength >= 32 ? 'pass' : 'fail',
      jwtLength >= 32
        ? 'JWT_SECRET is configured with sufficient length'
        : 'JWT_SECRET must be configured and at least 32 characters'
    ),
    check(
      'azure_openai',
      'Azure OpenAI configuration',
      hasEnv('AZURE_OPENAI_ENDPOINT') && hasEnv('AZURE_OPENAI_KEY') && hasEnv('AZURE_OPENAI_DEPLOYMENT') ? 'pass' : 'fail',
      'Requires AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, and AZURE_OPENAI_DEPLOYMENT'
    ),
    check(
      'legacy_model_keys',
      'Legacy non-BAA model keys',
      !hasEnv('OPENAI_API_KEY') && !hasEnv('ANTHROPIC_API_KEY') ? 'pass' : 'warn',
      !hasEnv('OPENAI_API_KEY') && !hasEnv('ANTHROPIC_API_KEY')
        ? 'OPENAI_API_KEY and ANTHROPIC_API_KEY are not configured'
        : 'OPENAI_API_KEY or ANTHROPIC_API_KEY is configured; verify no PHI routes can use it'
    ),
    check(
      'database_url',
      'Azure PostgreSQL connection string',
      hasEnv('DATABASE_URL') ? 'pass' : 'fail',
      hasEnv('DATABASE_URL')
        ? 'DATABASE_URL is configured'
        : 'DATABASE_URL is missing'
    ),
    check(
      'postgres_ssl',
      'PostgreSQL SSL mode',
      pgSslMode === 'require' || String(process.env.DATABASE_URL || '').includes('sslmode=require') ? 'pass' : 'warn',
      'Use PGSSLMODE=require or sslmode=require for Azure PostgreSQL'
    ),
    check(
      'database_runtime',
      'Runtime database provider',
      dbProvider === 'postgres' || dbProvider === 'postgresql' ? 'pass' : 'fail',
      dbProvider === 'postgres' || dbProvider === 'postgresql'
        ? 'Runtime is configured for PostgreSQL'
        : 'Runtime is still using SQLite-style storage; do not launch real PHI yet'
    ),
    check(
      'backup_passphrase',
      'Encrypted backup passphrase',
      hasEnv('BACKUP_PASSPHRASE') ? 'pass' : 'fail',
      hasEnv('BACKUP_PASSPHRASE')
        ? 'BACKUP_PASSPHRASE is configured'
        : 'BACKUP_PASSPHRASE is missing'
    ),
    check(
      'hipaa_mailer',
      'HIPAA-covered transactional email',
      hasHipaaCoveredProvider() ? 'pass' : 'fail',
      hasHipaaCoveredProvider()
        ? 'Gmail API or Google Workspace SMTP is configured for transactional email'
        : 'Configure Gmail API or Google Workspace SMTP before sending PHI-related email'
    ),
    check(
      'legacy_mailer',
      'Legacy non-BAA email fallback',
      !mailer.resendConfigured || !mailer.legacyResendAllowed ? 'pass' : 'warn',
      !mailer.resendConfigured
        ? 'RESEND_API_KEY is not configured'
        : (mailer.legacyResendAllowed
            ? 'Legacy Resend fallback is explicitly enabled; do not send PHI without a BAA'
            : 'RESEND_API_KEY is configured but blocked from production fallback by default')
    ),
    check(
      'from_email',
      'Sender domain',
      /@miwa\.care/i.test(fromEmail) ? 'pass' : 'warn',
      fromEmail
        ? 'FROM_EMAIL is configured'
        : 'FROM_EMAIL should be set to a miwa.care sender'
    ),
    check(
      'app_url',
      'Canonical app URL',
      /^https:\/\/(www\.)?miwa\.care/i.test(appUrl) ? 'pass' : 'warn',
      appUrl
        ? 'APP_URL/APP_BASE_URL is configured'
        : 'APP_URL or APP_BASE_URL should be set to https://miwa.care'
    ),
    check(
      'api_url',
      'Canonical API URL',
      !apiBaseUrl || /^https:\/\/api\.miwa\.care\/?$/i.test(apiBaseUrl) ? 'pass' : 'warn',
      apiBaseUrl
        ? 'API base URL is configured'
        : 'API base URL is omitted; web app can use same-origin /api'
    ),
    check(
      'file_storage',
      'PHI file storage',
      hasEnv('AZURE_STORAGE_CONNECTION_STRING') || hasEnv('AZURE_BLOB_CONNECTION_STRING') ? 'pass' : 'warn',
      hasEnv('AZURE_STORAGE_CONNECTION_STRING') || hasEnv('AZURE_BLOB_CONNECTION_STRING')
        ? 'Document uploads are configured for private Azure Blob Storage'
        : 'Document uploads and generated reports should move to private Azure Blob Storage before real launch'
    ),
    check(
      'sms_provider',
      'SMS delivery provider',
      sms.configured ? 'pass' : 'warn',
      sms.configured
        ? `Configured SMS provider: ${sms.providers.join(', ')}`
        : 'Configure Twilio or Vonage before relying on SMS links/reminders'
    ),
    check(
      'stripe_secret',
      'Stripe secret key',
      stripeSecret.startsWith('sk_live_') ? 'pass' : (stripeSecret ? 'warn' : 'fail'),
      stripeSecret.startsWith('sk_live_')
        ? 'Stripe live secret key is configured'
        : (stripeSecret ? 'Stripe key is configured but does not look like live mode' : 'STRIPE_SECRET_KEY is missing')
    ),
    check(
      'stripe_webhook',
      'Stripe webhook signing secret',
      stripeWebhookSecret.startsWith('whsec_') ? 'pass' : 'fail',
      stripeWebhookSecret.startsWith('whsec_')
        ? 'Stripe webhook signing secret is configured'
        : 'STRIPE_WEBHOOK_SECRET is missing or malformed'
    ),
    check(
      'stripe_prices',
      'Stripe plan price IDs',
      stripePrices.missing.length === 0 ? 'pass' : 'fail',
      stripePrices.missing.length === 0
        ? 'All Stripe plan price IDs are configured'
        : `Missing Stripe price env vars: ${stripePrices.missing.join(', ')}`
    ),
  ];

  return checks;
}

router.get('/readiness', async (req, res) => {
  const checks = buildReadinessChecks();
  const summary = checks.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, { pass: 0, warn: 0, fail: 0 });

  return res.json({
    ok: summary.fail === 0,
    service: 'miwa-api',
    time: new Date().toISOString(),
    summary,
    checks,
  });
});

router.get('/access-policy', async (req, res) => {
  res.json({
    stance: 'minimum-necessary',
    default_admin_access: 'Account, billing, support, usage, and operational metadata only.',
    prohibited_default_access: [
      'Client names and contact details',
      'Diagnoses, assessments, session notes, transcripts, and uploaded clinical files',
      'Raw prompts, raw model inputs, and clinician-client clinical content',
    ],
    permitted_default_access: [
      'Clinician account identity and status',
      'Subscription, billing, Stripe connection state, and trial usage',
      'Aggregate patient, session, upload, and workspace counts',
      'Support tickets and internal admin notes, treated as sensitive because users may include PHI',
      'Security, readiness, backup, and deployment diagnostics without secrets',
    ],
    break_glass: {
      enabled: false,
      status: 'policy-placeholder',
      requirement: 'Any future PHI access must require a reason, be time-limited, and write an audit trail before access.',
    },
  });
});

router.post('/break-glass/request', async (req, res) => {
  try {
    const db = getAsyncDb();
    const reasonCheck = requireReason(req, 'break-glass request');
    const targetTherapistId = Number(req.body?.therapist_id || req.body?.therapistId || 0) || null;
    await logEvent(db, {
      therapistId: targetTherapistId,
      eventType: 'admin.break_glass_request',
      status: 'denied',
      message: 'Break-glass PHI access is not enabled in the admin portal',
      meta: {
        actorId: req.therapist.id,
        reasonProvided: !!reasonCheck.reason,
        reasonLength: reasonCheck.reason?.length || 0,
      },
    });
    await persistIfNeeded();
    return res.status(403).json({
      error: 'Break-glass PHI access is not enabled.',
      policy: 'Admin portal access is limited to account, billing, support, usage, and operational metadata by default.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/stripe/status', async (req, res) => {
  const secretKey = envValue('STRIPE_SECRET_KEY');
  const webhookSecret = envValue('STRIPE_WEBHOOK_SECRET');
  const mode = stripeKeyMode(secretKey);
  const prices = STRIPE_PRICE_ENV.map(([name, envName]) => ({
    name,
    env: envName,
    configured: (() => {
      const type = classifyStripeId(envValue(envName));
      return type !== 'missing' && type !== 'placeholder';
    })(),
    type: classifyStripeId(envValue(envName)),
    id: redactStripeId(envValue(envName)),
    exists: null,
    active: null,
    recurring: null,
    currency: null,
    error: null,
  }));

  const result = {
    ok: false,
    provider: 'stripe',
    mode,
    configured: mode === 'live' || mode === 'test',
    webhook: {
      configured: webhookSecret.startsWith('whsec_'),
    },
    app_url: {
      value: process.env.APP_URL || process.env.APP_BASE_URL || null,
      canonical: /^https:\/\/(www\.)?miwa\.care\/?$/i.test(process.env.APP_URL || process.env.APP_BASE_URL || ''),
    },
    account: {
      reachable: false,
      id: null,
      country: null,
      default_currency: null,
      charges_enabled: null,
      payouts_enabled: null,
      error: null,
    },
    prices,
    time: new Date().toISOString(),
  };

  if (!result.configured) {
    result.prices = result.prices.map((price) => ({
      ...price,
      status: 'review',
      review_reason: stripePriceReviewReason(price),
    }));
    result.ok = false;
    return res.json(result);
  }

  try {
    const stripe = require('stripe')(secretKey);
    const account = await stripe.accounts.retrieve();
    result.account = {
      reachable: true,
      id: account.id || null,
      country: account.country || null,
      default_currency: account.default_currency || null,
      charges_enabled: !!account.charges_enabled,
      payouts_enabled: !!account.payouts_enabled,
      error: null,
    };
    result.prices = await Promise.all(
      STRIPE_PRICE_ENV.map(([name, envName]) => verifyStripeCatalogItem(stripe, name, envName, envValue(envName)))
    );
  } catch (err) {
    result.account.error = sanitizeStripeAdminError(err);
  }

  result.prices = result.prices.map((price) => ({
    ...price,
    status: price.configured && price.exists !== false && price.active !== false && price.recurring !== false
      ? 'ready'
      : 'review',
    review_reason: stripePriceReviewReason(price),
  }));

  result.ok = result.account.reachable
    && result.webhook.configured
    && result.app_url.canonical
    && result.prices.every((price) => price.status === 'ready');

  return res.json(result);
});

router.get('/postgres/status', async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({
      ok: false,
      provider: 'azure-postgresql',
      configured: false,
      message: 'DATABASE_URL is not configured',
      time: new Date().toISOString(),
    });
  }

  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: postgresSslConfig(),
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000,
  });

  try {
    const result = await pool.query(
      'SELECT current_database() AS database, current_user AS "user", NOW() AS time'
    );
    const row = result.rows[0] || {};
    return res.json({
      ok: true,
      provider: 'azure-postgresql',
      configured: true,
      database: row.database || null,
      user: row.user || null,
      time: row.time || new Date().toISOString(),
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      provider: 'azure-postgresql',
      configured: true,
      error: sanitizePostgresError(err),
      time: new Date().toISOString(),
    });
  } finally {
    await pool.end().catch(() => {});
  }
});

// ── Backup ─────────────────────────────────────────────────────────────────
// Trigger an on-demand encrypted DB backup. Same code path the nightly
// scheduler uses, so a successful manual run is a positive signal that the
// scheduled run will also work.
router.post('/backup/run', async (req, res) => {
  try {
    const { runNightlyBackup } = require('../services/backup');
    const result = await runNightlyBackup({ trigger: `manual:therapist_id=${req.therapist?.id || 'unknown'}` });
    if (!result.ok) return res.status(500).json(result);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Status check — does the operator need to set BACKUP_PASSPHRASE? Where does
// the email go? Cheap to call so the UI can reflect config state at a glance.
router.get('/backup/status', async (req, res) => {
  return res.json({
    enabled: !!process.env.BACKUP_PASSPHRASE,
    backup_to_email: process.env.BACKUP_TO_EMAIL || process.env.ADMIN_EMAIL || 'admin@miwa.care',
    schedule_cron_utc: '11 3 * * *',
    schedule_human: 'Daily at 03:11 UTC (~8:11 PM PT the previous evening)',
  });
});

// Direct download of the encrypted backup blob — for an immediate
// off-platform copy without going through email.
router.get('/backup/download', async (req, res) => {
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

// ── Email diagnostic — attempts a test send and returns the exact error ───
// Use this when something in the mailer stack isn't working. Requires admin
// auth. Does NOT include any PHI — just a plain "hello from Miwa" email.
router.post('/email-diag', async (req, res) => {
  const to = req.body?.to;
  if (!to || typeof to !== 'string' || !to.includes('@')) {
    return res.status(400).json({ error: 'Provide { "to": "you@example.com" }' });
  }

  const env = {
    smtpConfigured: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
    gmailApiConfigured: !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GMAIL_IMPERSONATE_USER),
    fromEmailConfigured: !!process.env.FROM_EMAIL,
    resendConfigured: !!process.env.RESEND_API_KEY,
    legacyResendAllowed: String(process.env.ALLOW_LEGACY_RESEND_EMAIL || '').toLowerCase() === 'true',
    hipaaCoveredProvider: hasHipaaCoveredProvider(),
  };

  try {
    const result = await sendMail({
      to,
      subject: 'Miwa — email diagnostic',
      html: '<p>If you are reading this, the mailer is working.</p><p>— Miwa</p>',
      text: 'If you are reading this, the mailer is working. — Miwa',
    });
    return res.json({ ok: true, env, result });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      env,
      error: 'Email diagnostic failed',
      errorName: err?.name,
      errorCode: err?.code,
    });
  }
});

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

function summarizeTherapist(row) {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    user_role: row.user_role,
    avatar_url: row.avatar_url || null,
    is_admin: !!row.is_admin,
    account_status: row.account_status || 'active',
    referral_code: row.referral_code,
    created_at: row.created_at,
    last_login_at: row.last_login_at || null,
    last_seen_at: row.last_seen_at || null,
    subscription_status: row.subscription_status || 'trial',
    subscription_tier: row.subscription_tier || null,
    stripe_customer_id: row.stripe_customer_id || null,
    stripe_subscription_id: row.stripe_subscription_id || null,
    workspace_uses: row.workspace_uses || 0,
    trial_limit: row.trial_limit || 10,
    patient_count: row.patient_count || 0,
    session_count: row.session_count || 0,
    intake_source_count: row.intake_source_count || 0,
    record_file_count: row.record_file_count || 0,
    credential_type: row.credential_type || 'licensed',
    credential_verified: !!row.credential_verified,
    credential_verified_at: row.credential_verified_at || null,
    school_email: row.school_email || null,
  };
}

async function fetchTherapists(db, whereSql = '', params = []) {
  const rows = await db.all(
    `SELECT t.*,
            (SELECT COUNT(*) FROM patients p WHERE p.therapist_id = t.id) AS patient_count,
            (SELECT COUNT(*) FROM sessions s WHERE s.therapist_id = t.id) AS session_count,
            (SELECT COUNT(*) FROM documents d WHERE d.therapist_id = t.id AND d.document_kind = 'intake_source') AS intake_source_count,
            (SELECT COUNT(*) FROM documents d WHERE d.therapist_id = t.id AND d.document_kind = 'record') AS record_file_count
     FROM therapists t
     ${whereSql}
     ORDER BY t.created_at DESC`,
    params,
  );
  return rows.map(summarizeTherapist)
}

router.get('/overview', async (req, res) => {
  try {
    const db = getAsyncDb();
    const totals = await db.get(`
      SELECT
        (SELECT COUNT(*) FROM therapists) AS total_therapists,
        (SELECT COUNT(*) FROM therapists WHERE created_at >= datetime('now', '-7 days')) AS new_last_7_days,
        (SELECT COUNT(*) FROM therapists WHERE last_seen_at >= datetime('now', '-15 minutes')) AS online_now,
        (SELECT COUNT(*) FROM therapists WHERE last_seen_at >= datetime('now', '-24 hours')) AS active_last_24h,
        (SELECT COUNT(*) FROM therapists WHERE subscription_status = 'trial') AS trial_accounts,
        (SELECT COUNT(*) FROM therapists WHERE subscription_status = 'active') AS paid_accounts,
        (SELECT COUNT(*) FROM therapists WHERE subscription_status IN ('expired', 'past_due')) AS at_risk_accounts,
        (SELECT COUNT(*) FROM patients) AS total_patients,
        (SELECT COUNT(*) FROM sessions) AS total_sessions,
        (SELECT COUNT(*) FROM documents WHERE document_kind = 'intake_source') AS total_intake_uploads,
        (SELECT COUNT(*) FROM documents WHERE document_kind = 'record') AS total_record_files,
        (SELECT COALESCE(SUM(workspace_uses), 0) FROM therapists) AS total_workspace_uses
    `);

    const recentAccounts = (await fetchTherapists(db, 'WHERE 1=1')).slice(0, 8);
    const recentEventRows = await db.all(
      `SELECT e.*, t.email, t.full_name
       FROM event_logs e
       LEFT JOIN therapists t ON t.id = e.therapist_id
       ORDER BY e.created_at DESC
       LIMIT 12`
    );
    const recentEvents = recentEventRows.map(row => ({
      ...row,
      meta: row.meta_json ? JSON.parse(row.meta_json) : null,
    }));

    const funnel = {
      signed_up: (await db.get('SELECT COUNT(*) AS n FROM therapists')).n,
      active_last_30d: (await db.get("SELECT COUNT(*) AS n FROM therapists WHERE last_seen_at >= datetime('now', '-30 days')")).n,
      with_patients: (await db.get('SELECT COUNT(DISTINCT therapist_id) AS n FROM patients WHERE therapist_id IS NOT NULL')).n,
      with_sessions: (await db.get('SELECT COUNT(DISTINCT therapist_id) AS n FROM sessions WHERE therapist_id IS NOT NULL')).n,
      with_intake_uploads: (await db.get("SELECT COUNT(DISTINCT therapist_id) AS n FROM documents WHERE therapist_id IS NOT NULL AND document_kind = 'intake_source'")).n,
    };

    res.json({ totals, funnel, recent_accounts: recentAccounts, recent_events: recentEvents });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/therapists', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { q = '', status = '', subscription = '' } = req.query;
    const filters = [];
    const params = [];

    if (q) {
      filters.push('(lower(t.email) LIKE ? OR lower(coalesce(t.full_name, "")) LIKE ?)');
      const like = `%${String(q).toLowerCase()}%`;
      params.push(like, like);
    }
    if (status) {
      filters.push('t.account_status = ?');
      params.push(status);
    }
    if (subscription) {
      filters.push('t.subscription_status = ?');
      params.push(subscription);
    }

    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    res.json(await fetchTherapists(db, whereSql, params));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/therapists/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapist = await db.get('SELECT * FROM therapists WHERE id = ?', req.params.id);
    if (!therapist) return res.status(404).json({ error: 'Therapist not found.' });

    const {
      account_status,
      subscription_status,
      subscription_tier,
      trial_limit,
      is_admin,
    } = req.body;

    await db.run(
      `UPDATE therapists
       SET account_status = ?, subscription_status = ?, subscription_tier = ?, trial_limit = ?, is_admin = ?
       WHERE id = ?`,
      account_status ?? therapist.account_status ?? 'active',
      subscription_status ?? therapist.subscription_status ?? 'trial',
      subscription_tier !== undefined ? (subscription_tier || null) : therapist.subscription_tier,
      trial_limit !== undefined ? Number(trial_limit) : (therapist.trial_limit || 10),
      is_admin !== undefined ? (is_admin ? 1 : 0) : (therapist.is_admin || 0),
      req.params.id,
    );
    await persistIfNeeded();
    await logEvent(db, {
      therapistId: Number(req.params.id),
      eventType: 'admin.account_update',
      status: 'success',
      message: 'Admin updated therapist account settings',
      meta: { actorId: req.therapist.id, account_status, subscription_status, subscription_tier, trial_limit, is_admin },
    });

    const updated = (await fetchTherapists(db, 'WHERE t.id = ?', [req.params.id]))[0];
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/therapists/:id/reset-password', async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapist = await db.get('SELECT * FROM therapists WHERE id = ?', req.params.id);
    if (!therapist) return res.status(404).json({ error: 'Therapist not found.' });

    const temporaryPassword = `${Math.random().toString(36).slice(-8)}A!9`;
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    await db.run('UPDATE therapists SET password_hash = ? WHERE id = ?', passwordHash, req.params.id);
    await persistIfNeeded();
    await logEvent(db, {
      therapistId: Number(req.params.id),
      eventType: 'admin.password_reset',
      status: 'success',
      message: 'Admin generated a temporary password',
      meta: { actorId: req.therapist.id },
    });

    res.json({
      therapist: summarizeTherapist(therapist),
      temporary_password: temporaryPassword,
      message: 'Temporary password generated. Share it securely and ask the user to change it immediately.',
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/usage', async (req, res) => {
  try {
    const db = getAsyncDb();
    const summary = await db.get(`
      SELECT
        (SELECT COUNT(*) FROM sessions WHERE created_at >= datetime('now', '-7 days')) AS sessions_last_7d,
        (SELECT COUNT(*) FROM sessions WHERE created_at >= datetime('now', '-30 days')) AS sessions_last_30d,
        (SELECT COUNT(*) FROM patients WHERE created_at >= datetime('now', '-30 days')) AS patient_profiles_last_30d,
        (SELECT COUNT(*) FROM documents WHERE document_kind = 'intake_source' AND created_at >= datetime('now', '-30 days')) AS intake_uploads_last_30d,
        (SELECT COUNT(*) FROM documents WHERE document_kind = 'record' AND created_at >= datetime('now', '-30 days')) AS record_uploads_last_30d,
        (SELECT COALESCE(SUM(workspace_uses), 0) FROM therapists) AS total_workspace_uses
    `);

    const topUsers = (await fetchTherapists(db, 'WHERE 1=1')).sort((a, b) => (b.workspace_uses || 0) - (a.workspace_uses || 0)).slice(0, 10);
    const featureAdoption = {
      therapists_with_patients: (await db.get('SELECT COUNT(DISTINCT therapist_id) AS n FROM patients WHERE therapist_id IS NOT NULL')).n,
      therapists_with_sessions: (await db.get('SELECT COUNT(DISTINCT therapist_id) AS n FROM sessions WHERE therapist_id IS NOT NULL')).n,
      therapists_with_intake_uploads: (await db.get("SELECT COUNT(DISTINCT therapist_id) AS n FROM documents WHERE therapist_id IS NOT NULL AND document_kind = 'intake_source'")).n,
      therapists_with_record_files: (await db.get("SELECT COUNT(DISTINCT therapist_id) AS n FROM documents WHERE therapist_id IS NOT NULL AND document_kind = 'record'")).n,
    };

    res.json({ summary, top_users: topUsers, feature_adoption: featureAdoption });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/support', async (req, res) => {
  try {
    const db = getAsyncDb();
    const notes = await db.all(
      `SELECT n.*, t.email AS therapist_email, t.full_name AS therapist_name, a.email AS author_email
       FROM admin_notes n
       LEFT JOIN therapists t ON t.id = n.therapist_id
       LEFT JOIN therapists a ON a.id = n.author_therapist_id
       ORDER BY n.created_at DESC
       LIMIT 50`
    );
    const eventRows = await db.all(
      `SELECT e.*, t.email, t.full_name
       FROM event_logs e
       LEFT JOIN therapists t ON t.id = e.therapist_id
       ORDER BY e.created_at DESC
       LIMIT 50`
    );
    const events = eventRows.map(row => ({ ...row, meta: row.meta_json ? JSON.parse(row.meta_json) : null }));

    const flagged = await fetchTherapists(db, 'WHERE t.account_status = ? OR t.subscription_status IN (?, ?)', ['suspended', 'past_due', 'expired']);

    let feedback = [];
    try {
      feedback = await db.all(
        `SELECT f.*, t.email AS therapist_email, t.full_name AS therapist_name
         FROM user_feedback f
         LEFT JOIN therapists t ON t.id = f.therapist_id
         ORDER BY f.created_at DESC
         LIMIT 100`
      );
    } catch { /* table may not exist on first deploy */ }

    res.json({ notes, events, flagged_accounts: flagged, feedback });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /admin/feedback/:id — update status or add admin response.
// When status flips to 'resolved' (and we haven't already emailed about
// this resolution), email the submitting therapist with the original
// message + the admin response so they know it was reviewed.
router.patch('/feedback/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { status, admin_response } = req.body || {};
    const validStatuses = ['new', 'read', 'resolved'];
    const updates = [];
    const params = [];

    // Snapshot the row BEFORE update so we can detect a status transition.
    const before = await db.get('SELECT * FROM user_feedback WHERE id = ?', req.params.id);
    if (!before) return res.status(404).json({ error: 'Feedback not found.' });

    if (status && validStatuses.includes(status)) {
      updates.push('status = ?');
      params.push(status);
      if (status === 'resolved') {
        updates.push("resolved_at = datetime('now')");
      }
    }
    if (typeof admin_response === 'string') {
      updates.push('admin_response = ?');
      params.push(admin_response.trim());
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });

    params.push(req.params.id);
    await db.run(`UPDATE user_feedback SET ${updates.join(', ')} WHERE id = ?`, ...params);
    await persistIfNeeded();

    // Notify the submitter when this PATCH transitions the row to 'resolved'.
    // Two channels — email (durable, works offline) AND in-app via Miwa chat
    // (instant when they're active in the app). Re-resolving an already-
    // resolved row does NOT re-notify — we'd spam the user every time the
    // admin tweaked a typo in their response.
    let emailed = false;
    let chatNotified = false;
    const justResolved = status === 'resolved' && before.status !== 'resolved';
    if (justResolved && before.therapist_id) {
      const replyText = (typeof admin_response === 'string' ? admin_response : before.admin_response || '').trim();
      const catLabel = before.category === 'bug' ? 'bug report'
        : before.category === 'feature' ? 'feature request'
        : 'feedback';

      // ── Email delivery ──────────────────────────────────────────────────
      try {
        const therapist = await db.get('SELECT email, first_name, full_name FROM therapists WHERE id = ?', before.therapist_id);
        if (therapist?.email) {
          const { sendFeedbackResolutionEmail } = require('../services/mailer');
          await sendFeedbackResolutionEmail({
            toEmail: therapist.email,
            firstName: therapist.first_name,
            fullName: therapist.full_name,
            originalMessage: before.message,
            adminResponse: replyText,
            category: before.category,
          });
          emailed = true;
        }
      } catch (mailErr) {
        console.error('[admin/feedback] resolution email failed:', mailErr.message);
      }

      // ── In-app delivery: drop a system message into the user's Miwa chat
      // so they see it the next time they open the panel. context_type=
      // 'feedback_resolved' lets the chat UI render it with a distinctive
      // style if we want to later (currently renders as a normal assistant
      // message, which is fine).
      try {
        const summary = (before.message || '').replace(/\s+/g, ' ').slice(0, 120);
        const intro = `Hey — the Miwa team got back to you on your ${catLabel}: "${summary}${before.message.length > 120 ? '…' : ''}"`;
        const reply = replyText
          ? `\n\nReply from the team:\n\n${replyText}`
          : `\n\nIt's been reviewed and marked resolved. Thanks for the feedback!`;
        const closer = `\n\nIf you want to follow up, just send another note here.`;
        await db.insert(
          'INSERT INTO chat_messages (therapist_id, role, content, context_type, context_id) VALUES (?, ?, ?, ?, ?)',
          before.therapist_id,
          'assistant',
          intro + reply + closer,
          'feedback_resolved',
          before.id,
        );
        await persistIfNeeded();
        chatNotified = true;
      } catch (chatErr) {
        console.error('[admin/feedback] in-app notification failed:', chatErr.message);
      }
    }

    res.json({ ok: true, emailed_user: emailed, chat_notified: chatNotified });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/therapists/:id/notes', async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapist = await db.get('SELECT * FROM therapists WHERE id = ?', req.params.id);
    if (!therapist) return res.status(404).json({ error: 'Therapist not found.' });
    const note = String(req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'Note is required.' });

    await db.insert(
      'INSERT INTO admin_notes (therapist_id, author_therapist_id, note) VALUES (?, ?, ?)',
      req.params.id,
      req.therapist.id,
      note,
    );
    await persistIfNeeded();
    await logEvent(db, {
      therapistId: Number(req.params.id),
      eventType: 'admin.note_added',
      status: 'success',
      message: 'Admin note added',
      meta: { actorId: req.therapist.id },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/therapists/:id', async (req, res) => {
  try {
    const db = getAsyncDb();
    const therapist = await db.get('SELECT * FROM therapists WHERE id = ?', req.params.id);
    if (!therapist) return res.status(404).json({ error: 'Therapist not found.' });

    const therapistId = Number(req.params.id);
    const confirmCheck = requireTypedConfirmation(req, `DELETE ${therapist.email}`);
    if (!confirmCheck.ok) return res.status(400).json(confirmCheck);
    const reasonCheck = requireReason(req, 'account deletion');
    if (!reasonCheck.ok) return res.status(400).json(reasonCheck);

    // Full cascade delete — remove ALL associated data
    // Get all patient IDs for this therapist first
    const patientRows = await db.all('SELECT id FROM patients WHERE therapist_id = ?', therapistId);
    const patientIds = patientRows.map(p => p.id);

    // Delete patient-level data for each patient
    for (const pid of patientIds) {
      await db.run('DELETE FROM outcome_supervision_notes WHERE patient_id = ?', pid);
      await db.run('DELETE FROM progress_alerts WHERE patient_id = ?', pid);
      await db.run('DELETE FROM proactive_alerts WHERE patient_id = ?', pid);
      await db.run('DELETE FROM assessments WHERE patient_id = ?', pid);
      await db.run('DELETE FROM assessment_links WHERE patient_id = ?', pid);
      await db.run('DELETE FROM sessions WHERE patient_id = ?', pid);
      await db.run('DELETE FROM documents WHERE patient_id = ?', pid);
      await db.run('DELETE FROM appointments WHERE patient_id = ?', pid);
      await db.run('DELETE FROM checkin_links WHERE patient_id = ?', pid);
      await db.run('DELETE FROM shared_patients WHERE patient_id = ?', pid);
      await db.run('DELETE FROM session_briefs WHERE patient_id = ?', pid);
      await db.run('DELETE FROM outreach_log WHERE patient_id = ?', pid);
      try { await db.run('DELETE FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE patient_id = ?)', pid); } catch {}
      try { await db.run('DELETE FROM treatment_plans WHERE patient_id = ?', pid); } catch {}
    }

    // Delete therapist-level data
    await db.run('DELETE FROM patients WHERE therapist_id = ?', therapistId);
    await db.run('DELETE FROM chat_messages WHERE therapist_id = ?', therapistId);
    await db.run('DELETE FROM admin_notes WHERE therapist_id = ?', therapistId);
    await db.run('DELETE FROM credential_verifications WHERE therapist_id = ?', therapistId);
    await db.run('DELETE FROM therapist_preferences WHERE therapist_id = ?', therapistId);
    await db.run('DELETE FROM research_briefs WHERE therapist_id = ?', therapistId);
    await db.run('DELETE FROM automation_rules WHERE therapist_id = ?', therapistId);
    await db.run('DELETE FROM scheduled_sends WHERE therapist_id = ?', therapistId);
    await db.run('DELETE FROM agent_actions WHERE therapist_id = ?', therapistId);
    await db.run('DELETE FROM agent_reports WHERE therapist_id = ?', therapistId);
    try { await db.run('DELETE FROM conversation_summaries WHERE therapist_id = ?', therapistId); } catch {}
    try { await db.run('DELETE FROM agent_scheduled_tasks WHERE therapist_id = ?', therapistId); } catch {}
    try { await db.run('DELETE FROM background_tasks WHERE therapist_id = ?', therapistId); } catch {}
    try { await db.run('DELETE FROM delegated_tasks WHERE therapist_id = ?', therapistId); } catch {}
    try { await db.run('DELETE FROM practice_insights WHERE therapist_id = ?', therapistId); } catch {}
    try { await db.run('DELETE FROM outreach_rules WHERE therapist_id = ?', therapistId); } catch {}
    try { await db.run('DELETE FROM event_triggers WHERE therapist_id = ?', therapistId); } catch {}
    try { await db.run('DELETE FROM password_reset_tokens WHERE therapist_id = ?', therapistId); } catch {}

    // Finally delete the therapist account
    await db.run('DELETE FROM therapists WHERE id = ?', therapistId);
    await persistIfNeeded();

    await logEvent(db, {
      therapistId: null,
      eventType: 'admin.account_deleted',
      status: 'success',
      message: `Deleted account: ${therapist.email}`,
      meta: { deleted_id: therapistId, deleted_email: therapist.email, actorId: req.therapist.id, reason: reasonCheck.reason },
    });

    res.json({ ok: true, message: `Account ${therapist.email} deleted successfully.` });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/backfill-names — give real names to clients that only have codes
router.post('/backfill-names', async (req, res) => {
  try {
    const db = getAsyncDb();
    const confirmCheck = requireTypedConfirmation(req, 'BACKFILL DEMO NAMES');
    if (!confirmCheck.ok) return res.status(400).json(confirmCheck);
    const reasonCheck = requireReason(req, 'demo backfill');
    if (!reasonCheck.ok) return res.status(400).json(reasonCheck);
    const FIRST = ['Sarah','Michael','Alex','Jordan','Taylor','Chris','Maria','Marcus','Jessica','David','Emily','James','Olivia','Daniel','Ashley','Ryan','Priya','Sofia','Ethan','Liam'];
    const LAST = ['Martinez','Chen','Thompson','Nguyen','Patel','Williams','Garcia','Johnson','Brown','Davis','Kim','Wilson','Anderson','Thomas','Jackson','Robinson','Lee','Clark','Hall','Ramirez'];
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    const patients = await db.all("SELECT id, client_id, display_name FROM patients WHERE display_name IS NULL OR display_name = '' OR display_name = client_id");
    let updated = 0;
    for (const p of patients) {
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const email = `${name.toLowerCase().replace(/\s+/g, '.')}+demo@example.com`;
      await db.run('UPDATE patients SET display_name = ?, email = COALESCE(NULLIF(email, \'\'), ?) WHERE id = ?', name, email, p.id);
      updated++;
    }
    await persistIfNeeded();
    await logEvent(db, {
      therapistId: null,
      eventType: 'admin.demo_name_backfill',
      status: 'success',
      message: `Backfilled demo names for ${updated} client records`,
      meta: { actorId: req.therapist.id, updated, reason: reasonCheck.reason },
    });
    await persistIfNeeded();
    res.json({ ok: true, updated, message: `Gave real names to ${updated} client(s)` });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/billing', async (req, res) => {
  try {
    const db = getAsyncDb();
    const summary = await db.get(`
      SELECT
        (SELECT COUNT(*) FROM therapists WHERE subscription_status = 'trial') AS trial_accounts,
        (SELECT COUNT(*) FROM therapists WHERE subscription_status = 'active') AS active_paid_accounts,
        (SELECT COUNT(*) FROM therapists WHERE subscription_status = 'past_due') AS past_due_accounts,
        (SELECT COUNT(*) FROM therapists WHERE subscription_status = 'expired') AS expired_accounts,
        (SELECT COUNT(*) FROM therapists WHERE stripe_customer_id IS NOT NULL) AS stripe_connected_accounts
    `);

    const accounts = (await fetchTherapists(db, 'WHERE 1=1')).filter(item =>
      item.subscription_status || item.subscription_tier || item.stripe_customer_id
    );

    const trialEndingSoon = accounts.filter(item =>
      item.subscription_status === 'trial' && (item.trial_limit - item.workspace_uses) <= 3
    );

    res.json({ summary, accounts, trial_ending_soon: trialEndingSoon });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/ai-costs — month-to-date AI spend across the whole platform
router.get('/ai-costs', async (req, res) => {
  try {
    const db = getAsyncDb();

    const totals = await db.get(`
      SELECT COALESCE(SUM(cost_cents), 0)    AS total_cents,
             COALESCE(SUM(input_tokens), 0)  AS input_tokens,
             COALESCE(SUM(output_tokens), 0) AS output_tokens,
             COUNT(*)                        AS call_count
        FROM cost_events
       WHERE created_at >= date('now', 'start of month')
    `);

    const byProvider = await db.all(`
      SELECT provider,
             COALESCE(SUM(cost_cents), 0) AS cost_cents,
             COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
             COUNT(*) AS calls
        FROM cost_events
       WHERE created_at >= date('now', 'start of month')
       GROUP BY provider
       ORDER BY cost_cents DESC
    `);

    const byKind = await db.all(`
      SELECT kind,
             COALESCE(SUM(cost_cents), 0) AS cost_cents,
             COUNT(*)                     AS calls
        FROM cost_events
       WHERE created_at >= date('now', 'start of month')
       GROUP BY kind
       ORDER BY cost_cents DESC
       LIMIT 15
    `);

    const topSpenders = await db.all(`
      SELECT c.therapist_id,
             t.email,
             t.full_name,
             t.subscription_status,
             t.subscription_tier,
             t.ai_budget_monthly_cents,
             t.ai_budget_paused,
             COALESCE(SUM(c.cost_cents),   0) AS cost_cents,
             COALESCE(SUM(c.input_tokens + c.output_tokens), 0) AS tokens
        FROM cost_events c
        LEFT JOIN therapists t ON t.id = c.therapist_id
       WHERE c.created_at >= date('now', 'start of month')
         AND c.therapist_id IS NOT NULL
       GROUP BY c.therapist_id
       ORDER BY cost_cents DESC
       LIMIT 25
    `);

    const pausedAccounts = await db.all(`
      SELECT id, email, full_name, subscription_tier, subscription_status,
             ai_budget_monthly_cents, ai_budget_paused
        FROM therapists
       WHERE ai_budget_paused = 1
    `);

    res.json({
      totals,
      by_provider: byProvider,
      by_kind: byKind,
      top_spenders: topSpenders,
      paused_accounts: pausedAccounts,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/ai-costs/:therapistId/unpause — clear the over-budget flag
router.post('/ai-costs/:therapistId/unpause', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = parseInt(req.params.therapistId, 10);
    if (!tid) return res.status(400).json({ error: 'Invalid therapist id' });
    await db.run('UPDATE therapists SET ai_budget_paused = 0 WHERE id = ?', tid);
    await persistIfNeeded();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Wipe all PHI-adjacent data for a single therapist while keeping their
// account row + auth credentials intact. Used by both the per-therapist
// reset endpoint and the global reset-database flow.
async function wipeTherapistData(db, therapistId) {
  const patients = await db.all('SELECT id FROM patients WHERE therapist_id = ?', therapistId);
  for (const p of patients) {
    await db.run('DELETE FROM outcome_supervision_notes WHERE patient_id = ?', p.id);
    await db.run('DELETE FROM progress_alerts WHERE patient_id = ?', p.id);
    await db.run('DELETE FROM proactive_alerts WHERE patient_id = ?', p.id);
    await db.run('DELETE FROM assessments WHERE patient_id = ?', p.id);
    await db.run('DELETE FROM assessment_links WHERE patient_id = ?', p.id);
    await db.run('DELETE FROM sessions WHERE patient_id = ?', p.id);
    await db.run('DELETE FROM documents WHERE patient_id = ?', p.id);
    await db.run('DELETE FROM appointments WHERE patient_id = ?', p.id);
    await db.run('DELETE FROM checkin_links WHERE patient_id = ?', p.id);
    try { await db.run('DELETE FROM session_briefs WHERE patient_id = ?', p.id); } catch {}
    try { await db.run('DELETE FROM outreach_log WHERE patient_id = ?', p.id); } catch {}
    try { await db.run('DELETE FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE patient_id = ?)', p.id); } catch {}
    try { await db.run('DELETE FROM treatment_plans WHERE patient_id = ?', p.id); } catch {}
  }
  await db.run('DELETE FROM patients WHERE therapist_id = ?', therapistId);
  await db.run('DELETE FROM chat_messages WHERE therapist_id = ?', therapistId);
  await db.run('DELETE FROM proactive_alerts WHERE therapist_id = ?', therapistId);
  await db.run('DELETE FROM scheduled_sends WHERE therapist_id = ?', therapistId);
  await db.run('DELETE FROM agent_actions WHERE therapist_id = ?', therapistId);
  try { await db.run('DELETE FROM agent_reports WHERE therapist_id = ?', therapistId); } catch {}
  try { await db.run('DELETE FROM conversation_summaries WHERE therapist_id = ?', therapistId); } catch {}
  try { await db.run('DELETE FROM agent_scheduled_tasks WHERE therapist_id = ?', therapistId); } catch {}
  try { await db.run('DELETE FROM background_tasks WHERE therapist_id = ?', therapistId); } catch {}
  try { await db.run('DELETE FROM agent_tasks WHERE therapist_id = ?', therapistId); } catch {}
  try { await db.run('DELETE FROM delegated_tasks WHERE therapist_id = ?', therapistId); } catch {}
  try { await db.run('DELETE FROM practice_insights WHERE therapist_id = ?', therapistId); } catch {}
  try { await db.run('DELETE FROM outreach_rules WHERE therapist_id = ?', therapistId); } catch {}
  try { await db.run('DELETE FROM event_triggers WHERE therapist_id = ?', therapistId); } catch {}
  try { await db.run('DELETE FROM therapist_preferences WHERE therapist_id = ?', therapistId); } catch {}
  try { await db.run('DELETE FROM daily_briefings WHERE therapist_id = ?', therapistId); } catch {}
  return patients.length;
}

// POST /api/admin/therapists/:id/reset-data — wipes a single therapist's
// patients/sessions/etc. without touching their account row. Use to clean
// just one clinician's test data when you don't want a full reset.
router.post('/therapists/:id/reset-data', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = parseInt(req.params.id, 10);
    if (!tid) return res.status(400).json({ error: 'Invalid therapist id' });
    const therapist = await db.get('SELECT id, email, full_name FROM therapists WHERE id = ?', tid);
    if (!therapist) return res.status(404).json({ error: 'Therapist not found' });
    const confirmCheck = requireTypedConfirmation(req, `WIPE ${therapist.email}`);
    if (!confirmCheck.ok) return res.status(400).json(confirmCheck);
    const reasonCheck = requireReason(req, 'data wipe');
    if (!reasonCheck.ok) return res.status(400).json(reasonCheck);

    const patientCount = await wipeTherapistData(db, tid);
    await persistIfNeeded({ allowShrink: true });
    await logEvent(db, {
      therapistId: tid,
      eventType: 'admin.therapist_data_wiped',
      status: 'success',
      message: 'Admin wiped clinician clinical data while preserving account',
      meta: { actorId: req.therapist.id, patientsDeleted: patientCount, reason: reasonCheck.reason },
    });
    await persistIfNeeded({ allowShrink: true });

    res.json({
      ok: true,
      message: `Cleared ${patientCount} patient${patientCount === 1 ? '' : 's'} and all related data for ${therapist.email}. Account kept.`,
      therapist_id: tid,
      patients_deleted: patientCount,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/reset-database — nuclear cleanup for demo prep
// Keeps your admin account, wipes everything else
router.post('/reset-database', async (req, res) => {
  try {
    const db = getAsyncDb();
    const adminId = req.therapist.id;
    const confirmCheck = requireTypedConfirmation(req, 'RESET DATABASE');
    if (!confirmCheck.ok) return res.status(400).json(confirmCheck);
    const reasonCheck = requireReason(req, 'database reset');
    if (!reasonCheck.ok) return res.status(400).json(reasonCheck);

    // Delete ALL non-admin therapist accounts and their data
    const otherTherapists = await db.all('SELECT id FROM therapists WHERE id != ?', adminId);
    for (const t of otherTherapists) {
      await wipeTherapistData(db, t.id);
      await db.run('DELETE FROM therapists WHERE id = ?', t.id);
    }

    // Wipe YOUR account's test data too (keeps your account row)
    await wipeTherapistData(db, adminId);

    // Reset your Stripe customer ID (fixes test/live mismatch)
    await db.run('UPDATE therapists SET stripe_customer_id = NULL, stripe_subscription_id = NULL, workspace_uses = 0 WHERE id = ?', adminId);

    // Clean global tables
    await db.run('DELETE FROM mental_health_news');
    await db.run('DELETE FROM research_briefs');
    await db.run('DELETE FROM admin_notes');
    await db.run('DELETE FROM event_logs');
    try { await db.run('DELETE FROM client_portal_tokens'); } catch {}
    try { await db.run('DELETE FROM client_messages'); } catch {}
    try { await db.run('DELETE FROM note_enrichments'); } catch {}

    await persistIfNeeded({ allowShrink: true });
    await logEvent(db, {
      therapistId: adminId,
      eventType: 'admin.database_reset',
      status: 'success',
      message: 'Admin reset database through admin portal',
      meta: { actorId: req.therapist.id, deletedTherapists: otherTherapists.length, reason: reasonCheck.reason },
    });
    await persistIfNeeded({ allowShrink: true });

    res.json({
      ok: true,
      message: 'Database cleaned. Your admin account is preserved. All test patients, sessions, assessments, and other accounts deleted. Stripe customer ID reset. Ready for demo.',
      kept: { admin_email: req.therapist.email, admin_id: adminId },
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/reset-stripe/:therapistId — clear stale Stripe customer ID
router.post('/reset-stripe/:therapistId', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = parseInt(req.params.therapistId);
    const therapist = await db.get('SELECT id, email FROM therapists WHERE id = ?', tid);
    if (!therapist) return res.status(404).json({ error: 'Therapist not found.' });
    const confirmCheck = requireTypedConfirmation(req, `RESET STRIPE ${therapist.email}`);
    if (!confirmCheck.ok) return res.status(400).json(confirmCheck);
    const reasonCheck = requireReason(req, 'Stripe reset');
    if (!reasonCheck.ok) return res.status(400).json(reasonCheck);
    await db.run(
      'UPDATE therapists SET stripe_customer_id = NULL, stripe_subscription_id = NULL WHERE id = ?',
      tid
    );
    await logEvent(db, {
      therapistId: tid,
      eventType: 'admin.stripe_reset',
      status: 'success',
      message: 'Admin cleared Stripe customer and subscription IDs',
      meta: { actorId: req.therapist.id, reason: reasonCheck.reason },
    });
    await persistIfNeeded();
    res.json({ ok: true, message: `Cleared Stripe data for therapist ${tid}. Next checkout will create a fresh customer.` });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/reset-stripe-all — bulk clear all stale test-mode Stripe customer IDs
// Use this ONCE when migrating from Stripe test mode to live mode.
// Resets: stripe_customer_id, stripe_subscription_id, and any 'active' subscriptions back to 'trial'
// (since test-mode subscriptions don't exist in the live account).
router.post('/reset-stripe-all', async (req, res) => {
  try {
    const db = getAsyncDb();
    const confirmCheck = requireTypedConfirmation(req, 'RESET STRIPE ALL');
    if (!confirmCheck.ok) return res.status(400).json(confirmCheck);
    const reasonCheck = requireReason(req, 'bulk Stripe reset');
    if (!reasonCheck.ok) return res.status(400).json(reasonCheck);
    const before = await db.get(
      `SELECT
         COUNT(CASE WHEN stripe_customer_id IS NOT NULL THEN 1 END) AS customers,
         COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) AS active_subs
       FROM therapists`
    );

    await db.run(
      `UPDATE therapists
       SET stripe_customer_id = NULL,
           stripe_subscription_id = NULL,
           subscription_status = CASE
             WHEN subscription_status = 'active' THEN 'trial'
             ELSE subscription_status
           END,
           subscription_tier = CASE
             WHEN subscription_status = 'active' THEN NULL
             ELSE subscription_tier
           END`
    );
    await persistIfNeeded();

    await logEvent(db, {
      therapistId: req.therapist.id,
      eventType: 'stripe_migration',
      status: 'test_to_live',
      message: `Cleared ${before?.customers || 0} stale customer IDs; reset ${before?.active_subs || 0} active subs to trial.`,
      meta: { actorId: req.therapist.id, reason: reasonCheck.reason },
    });
    await persistIfNeeded();

    res.json({
      ok: true,
      message: `Cleared ${before?.customers || 0} stale Stripe customer IDs and reset ${before?.active_subs || 0} active subscriptions to trial. All therapists will create a fresh live-mode customer on their next checkout.`,
      cleared_customers: before?.customers || 0,
      reset_subscriptions: before?.active_subs || 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/fix-subscription/:therapistId — manually set subscription status
router.post('/fix-subscription/:therapistId', async (req, res) => {
  try {
    const db = getAsyncDb();
    const tid = parseInt(req.params.therapistId);
    const { status, tier } = req.body;
    const reasonCheck = requireReason(req, 'subscription override');
    if (!reasonCheck.ok) return res.status(400).json(reasonCheck);
    await db.run(
      'UPDATE therapists SET subscription_status = ?, subscription_tier = ? WHERE id = ?',
      status || 'active', tier || 'solo', tid
    );
    await logEvent(db, {
      therapistId: tid,
      eventType: 'admin.subscription_override',
      status: 'success',
      message: `Admin set subscription to ${status || 'active'} (${tier || 'solo'})`,
      meta: { actorId: req.therapist.id, reason: reasonCheck.reason },
    });
    await persistIfNeeded();
    res.json({ ok: true, message: `Set subscription to ${status || 'active'} (${tier || 'solo'}) for therapist ${tid}` });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
