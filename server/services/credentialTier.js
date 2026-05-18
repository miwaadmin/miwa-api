const VALID_CREDENTIAL_TIERS = new Set(['trainee', 'associate', 'licensed']);

const PLAN_TO_CREDENTIAL = {
  trainee: 'trainee',
  associate: 'associate',
  solo: 'licensed',
  licensed: 'licensed',
};

function normalizeCredentialTier(value, fallback = 'licensed') {
  const tier = String(value || '').trim().toLowerCase();
  return VALID_CREDENTIAL_TIERS.has(tier) ? tier : fallback;
}

function credentialForPlan(plan) {
  return PLAN_TO_CREDENTIAL[String(plan || '').trim().toLowerCase()] || null;
}

function isActiveSubscription(row) {
  return ['active', 'trialing'].includes(String(row?.subscription_status || '').toLowerCase());
}

function hasActiveTrial(row, requiredTier, nowMs = Date.now()) {
  const planTier = credentialForPlan(row?.subscription_tier);
  const trialEnd = row?.subscription_trial_end ? Date.parse(row.subscription_trial_end) : NaN;
  return planTier === requiredTier && Number.isFinite(trialEnd) && trialEnd > nowMs;
}

function hasSubscriptionTier(row, requiredTier, nowMs = Date.now()) {
  const planTier = credentialForPlan(row?.subscription_tier);
  return planTier === requiredTier && (isActiveSubscription(row) || hasActiveTrial(row, requiredTier, nowMs));
}

async function logCredentialTierChange(db, { therapistId, actorId, oldTier, newTier, source = 'settings' }) {
  try {
    await db.insert(
      `INSERT INTO event_logs (therapist_id, event_type, status, message, meta_json)
       VALUES (?, 'credential_tier_changed', 'success', ?, ?)`,
      therapistId,
      `Credential tier changed from ${oldTier || 'unknown'} to ${newTier}`,
      JSON.stringify({
        actor_id: actorId || therapistId,
        old_credential_type: oldTier || null,
        new_credential_type: newTier,
        source,
      }),
    );
  } catch {}
}

async function validateSelfServiceCredentialChange(db, therapistId, requestedTier, nowMs = Date.now()) {
  const next = normalizeCredentialTier(requestedTier, null);
  if (!next) {
    return { ok: false, status: 400, body: { error: 'Invalid account stage.' } };
  }

  const row = await db.get(
    `SELECT id, credential_type, subscription_status, subscription_tier, subscription_trial_end
       FROM therapists
      WHERE id = ?`,
    therapistId,
  );
  if (!row) {
    return { ok: false, status: 404, body: { error: 'Therapist not found.' } };
  }

  const current = normalizeCredentialTier(row.credential_type, 'licensed');
  if (current === next) return { ok: true, current, next, row };

  if (current === 'licensed') {
    return {
      ok: false,
      status: 403,
      body: { error: 'Licensed tier changes must go through support.' },
    };
  }

  if (next === 'licensed') {
    return {
      ok: false,
      status: 403,
      body: { error: 'Licensed upgrades must go through support.' },
    };
  }

  if (next === 'trainee' && current !== 'trainee') {
    return {
      ok: false,
      status: 403,
      body: { error: 'Downgrades must go through support.' },
    };
  }

  if (next === 'associate' && !hasSubscriptionTier(row, 'associate', nowMs)) {
    return {
      ok: false,
      status: 402,
      body: { error: 'upgrade_required', upgrade_path: '/settings/billing' },
    };
  }

  return { ok: true, current, next, row };
}

module.exports = {
  credentialForPlan,
  hasSubscriptionTier,
  logCredentialTierChange,
  normalizeCredentialTier,
  validateSelfServiceCredentialChange,
};
