/**
 * Miwa Cost Tracker
 *
 * - Logs every AI call as a row in cost_events
 * - Computes rolling monthly spend per therapist
 * - Enforces per-tier monthly budgets (auto-pauses when exceeded)
 *
 * Pricing is approximate (USD per 1M tokens). Update when Azure pricing changes.
 * We round up to whole cents so we never under-bill.
 */

const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');

// ── Pricing table (cents per million tokens) ─────────────────────────────────
// input, output
const PRICING_CENTS_PER_MILLION = {
  // Azure OpenAI deployment aliases
  'gpt-main': { in: 250, out: 1000 },
  'gpt-4o':   { in: 250, out: 1000 },
};

// ── Default monthly budget per subscription tier (cents) ─────────────────────
// These are SOFT caps designed to protect margins. A therapist can spend more
// than their subscription price if it's a reasonable clinical pattern, but a
// runaway usage spike will auto-pause chat until next month.
const DEFAULT_TIER_BUDGET_CENTS = {
  trainee:   500,   // $5
  associate: 1200,  // $12
  solo:      2500,  // $25
  group:     5000,  // $50
  trial:     300,   // $3 during trial
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function priceForModel(model) {
  return PRICING_CENTS_PER_MILLION[model] || { in: 100, out: 500 }; // fallback
}

function computeCostCents(model, inputTokens, outputTokens) {
  const { in: inRate, out: outRate } = priceForModel(model);
  const inCents  = (inputTokens  * inRate)  / 1_000_000;
  const outCents = (outputTokens * outRate) / 1_000_000;
  return Math.ceil(inCents + outCents);
}

function budgetForTherapist(row) {
  if (row?.ai_budget_monthly_cents && row.ai_budget_monthly_cents > 0) {
    return row.ai_budget_monthly_cents;
  }
  const tier = (row?.subscription_tier || row?.subscription_status || 'trial').toLowerCase();
  return DEFAULT_TIER_BUDGET_CENTS[tier] || DEFAULT_TIER_BUDGET_CENTS.trial;
}

// ── Logging ──────────────────────────────────────────────────────────────────

/**
 * Log a cost event. Swallows errors — cost logging must never break the user flow.
 * Returns the cost in cents (for callers that want to short-circuit future work).
 */
async function logCostEvent({
  therapistId,
  kind,
  provider,
  model,
  inputTokens = 0,
  outputTokens = 0,
  status = 'ok',
}) {
  try {
    const db = getAsyncDb();
    const costCents = computeCostCents(model, inputTokens, outputTokens);
    await db.insert(
      `INSERT INTO cost_events
       (therapist_id, kind, provider, model, input_tokens, output_tokens, cost_cents, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      therapistId || null,
      String(kind || 'unknown'),
      String(provider || 'unknown'),
      String(model || 'unknown'),
      Math.max(0, parseInt(inputTokens, 10) || 0),
      Math.max(0, parseInt(outputTokens, 10) || 0),
      costCents,
      status,
    );
    // Fire-and-forget persistence to avoid blocking the request
    try { await persistIfNeeded(); } catch {}

    // Cost tracking is observe-only — no therapist should ever be limited.
    // Auto-pause is disabled. Uncomment the line below if you ever want
    // to enforce budgets in the future.
    // if (therapistId && status === 'ok') maybeAutoPause(therapistId);
    return costCents;
  } catch (err) {
    console.error('[costTracker] logCostEvent error:', err.message);
    return 0;
  }
}

// ── Spend queries ────────────────────────────────────────────────────────────

async function getMonthlySpendCents(therapistId) {
  try {
    const db = getAsyncDb();
    const row = await db.get(
      `SELECT COALESCE(SUM(cost_cents), 0) AS total
         FROM cost_events
        WHERE therapist_id = ?
          AND created_at >= date('now', 'start of month')`,
      therapistId,
    );
    return row?.total || 0;
  } catch {
    return 0;
  }
}

async function getUsageSummary(therapistId) {
  try {
    const db = getAsyncDb();
    const therapist = await db.get(
      `SELECT subscription_tier, subscription_status,
              ai_budget_monthly_cents, ai_budget_paused
         FROM therapists WHERE id = ?`,
      therapistId,
    );
    const spent = await getMonthlySpendCents(therapistId);
    const budget = budgetForTherapist(therapist);
    return {
      spent_cents: spent,
      budget_cents: budget,
      remaining_cents: Math.max(0, budget - spent),
      utilization_percent: budget > 0 ? Math.round((spent / budget) * 100) : 0,
      paused: !!therapist?.ai_budget_paused,
      tier: therapist?.subscription_tier || therapist?.subscription_status || 'trial',
    };
  } catch {
    return {
      spent_cents: 0, budget_cents: 0, remaining_cents: 0,
      utilization_percent: 0, paused: false, tier: 'unknown',
    };
  }
}

// ── Auto-pause enforcement ───────────────────────────────────────────────────

async function maybeAutoPause(therapistId) {
  try {
    const { spent_cents, budget_cents, paused } = await getUsageSummary(therapistId);
    if (paused) return;
    if (budget_cents > 0 && spent_cents >= budget_cents) {
      const db = getAsyncDb();
      await db.run('UPDATE therapists SET ai_budget_paused = 1 WHERE id = ?', therapistId);
      try { await persistIfNeeded(); } catch {}
      console.warn(
        `[costTracker] Therapist ${therapistId} auto-paused — spend ${spent_cents}¢ >= budget ${budget_cents}¢`,
      );
    }
  } catch (err) {
    console.error('[costTracker] auto-pause check failed:', err.message);
  }
}

/**
 * Called BEFORE an AI call. Currently a no-op — all therapists get unlimited
 * AI usage. Cost is tracked for admin visibility but never blocks a clinician.
 *
 * To re-enable enforcement later, uncomment the body below.
 */
function assertBudgetOk(/* therapistId */) {
  // Unlimited usage — never block a clinician.
  return;
}

/**
 * Admin override — clear the pause flag (e.g., after a conversation with the user).
 */
async function clearPause(therapistId) {
  try {
    const db = getAsyncDb();
    await db.run('UPDATE therapists SET ai_budget_paused = 0 WHERE id = ?', therapistId);
    try { await persistIfNeeded(); } catch {}
    return true;
  } catch {
    return false;
  }
}

// Usage token extraction from provider responses.
function tokensFromAzureOpenAI(response) {
  return {
    input: response?.usage?.input_tokens || response?.usage?.prompt_tokens || 0,
    output: response?.usage?.output_tokens || response?.usage?.completion_tokens || 0,
  };
}

module.exports = {
  PRICING_CENTS_PER_MILLION,
  DEFAULT_TIER_BUDGET_CENTS,
  // Core
  logCostEvent,
  computeCostCents,
  priceForModel,
  // Queries
  getMonthlySpendCents,
  getUsageSummary,
  budgetForTherapist,
  // Enforcement
  assertBudgetOk,
  clearPause,
  maybeAutoPause,
  // Extractors
  tokensFromAzureOpenAI,
};
