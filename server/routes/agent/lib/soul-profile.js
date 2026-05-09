const { persistIfNeeded } = require('../../../db/asyncDb');
const { MODELS, callAI } = require('../../../lib/aiExecutor');
const { safeJsonParse } = require('./helpers');

// ── Therapist Soul Profile ────────────────────────────────────────────────────
// Miwa learns the therapist's preferences over time by observing every
// conversation. Preferences are stored in therapist_preferences and injected
// into the system prompt so Miwa adapts without any manual configuration.

const SOUL_CATEGORIES = {
  note_style:    'Note & documentation style',
  scheduling:    'Scheduling patterns',
  clinical:      'Clinical approach',
  communication: 'Communication preferences',
  corrections:   'Explicit corrections (highest priority)',
};

/**
 * Load all saved preferences for a therapist and format them as a
 * readable soul profile string for the system prompt.
 */
async function loadTherapistSoul(db, therapistId) {
  try {
    // First check for explicit SOUL.md document (set during onboarding)
    const therapistRow = await db.get('SELECT soul_markdown FROM therapists WHERE id = ?', therapistId);
    const soulMd = therapistRow?.soul_markdown || '';

    const rows = await db.all(
      `SELECT category, key, value, source FROM therapist_preferences
       WHERE therapist_id = ? ORDER BY category, last_observed_at DESC`,
      therapistId
    );

    if ((!rows || rows.length === 0) && !soulMd) return '';

    // Group by category
    const grouped = {};
    for (const row of (rows || [])) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category].push(row);
    }

    const sections = [];
    if (soulMd) {
      sections.push(`THERAPIST SOUL PROFILE (from onboarding — treat as core identity context):\n${soulMd}`);
    }
    if (Object.keys(grouped).length > 0) {
      const lines = [];
      for (const [cat, prefs] of Object.entries(grouped)) {
        const label = SOUL_CATEGORIES[cat] || cat;
        const items = prefs.map(p => `  - ${p.value}${p.source === 'explicit' ? ' (explicit)' : ''}`).join('\n');
        lines.push(`${label}:\n${items}`);
      }
      sections.push(`OBSERVED PREFERENCES (corrections + inferred patterns — adapt to these):\n${lines.join('\n\n')}`);
    }
    return sections.join('\n\n');
  } catch {
    return '';
  }
}

/**
 * After each conversation turn, extract observable preferences from the
 * exchange and upsert them into therapist_preferences.
 * Runs in the background — non-blocking, failures are silently swallowed.
 */
async function extractAndSavePreferences(userMessage, assistantResponse, db, therapistId) {
  try {
    const prompt = `You are analyzing a therapist's conversation with their AI copilot to extract behavioral preferences.

Clinician said: "${userMessage.slice(0, 600)}"
Miwa responded: "${assistantResponse.slice(0, 600)}"

Extract any observable preferences, patterns, or explicit corrections from this exchange.
Focus only on things that should influence future interactions — ignore routine requests.

Categories:
- note_style: note format (SOAP/DAP/narrative), terminology, level of detail
- scheduling: preferred session length, days, times, client order
- clinical: theoretical orientation, common interventions, how they conceptualize cases
- communication: how they like to be addressed, response length, tone
- corrections: explicit pushback ("don't say X", "I prefer Y", "stop doing Z") — CRITICAL to capture

Return JSON only, no explanation:
{
  "preferences": [
    { "category": "corrections|note_style|scheduling|clinical|communication", "key": "snake_case_key", "value": "plain-language description of the preference", "source": "explicit" }
  ]
}

Return { "preferences": [] } if nothing notable is found. Be conservative — only capture clear signals.`;

    // Route through the cost-aware helper so preference extraction is tracked too.
    const text = await callAI(
      MODELS.AZURE_MAIN,
      'Return JSON only. No preamble.',
      prompt,
      400,
      { therapistId, kind: 'preference_extraction', skipBudgetCheck: true }
    );
    const parsed = safeJsonParse(text);
    if (!parsed?.preferences?.length) return;

    for (const pref of parsed.preferences) {
      if (!pref.category || !pref.key || !pref.value) continue;
      if (!SOUL_CATEGORIES[pref.category]) continue;
      try {
        // Upsert: update if exists, insert if not
        const existing = await db.get(
          'SELECT id FROM therapist_preferences WHERE therapist_id = ? AND category = ? AND key = ?',
          therapistId, pref.category, pref.key
        );
        if (existing) {
          await db.run(
            `UPDATE therapist_preferences SET value = ?, source = ?, last_observed_at = CURRENT_TIMESTAMP WHERE id = ?`,
            pref.value, pref.source || 'inferred', existing.id
          );
        } else {
          await db.insert(
            `INSERT INTO therapist_preferences (therapist_id, category, key, value, source) VALUES (?, ?, ?, ?, ?)`,
            therapistId, pref.category, pref.key, pref.value, pref.source || 'inferred'
          );
        }
      } catch {}
    }
    await persistIfNeeded();
  } catch {}
}

module.exports = {
  SOUL_CATEGORIES,
  loadTherapistSoul,
  extractAndSavePreferences,
};
