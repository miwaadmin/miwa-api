/**
 * Active Risk Monitor
 *
 * Scans session-note text as the therapist types. When risk-language patterns
 * appear (suicidal ideation, homicidal ideation, self-harm, abuse disclosure)
 * and the corresponding screening instrument isn't documented for this patient
 * in a reasonable window, surface a non-blocking clinical nudge.
 *
 * Two-stage detection:
 *   1. Fast regex pass — cheap, runs on every scan request, filters out the
 *      ~95% of notes that don't contain risk language.
 *   2. Haiku LLM confirm — only runs when stage 1 hits. Differentiates
 *      "client endorses passive SI" (flag) from "client denied SI, denied HI"
 *      (don't flag) so we don't nag on routine clearance language.
 *
 * Non-blocking: every response returns `{ status: 'ok', risks: [...] }` —
 * the UI decides whether to show anything. Errors return `{ status: 'error' }`
 * without breaking the typing flow.
 */

'use strict';

const { getAsyncDb } = require('../db/asyncDb');
const { classifyIntent } = require('../lib/aiExecutor');

// ── Risk Categories ──────────────────────────────────────────────────────────

/**
 * Each category defines:
 *   - label: what we call it in UI
 *   - patterns: regex list, case-insensitive, word-boundaried where useful
 *   - screener: the assessment that, if documented recently, means this is
 *     already covered clinically (therapist did the screen)
 *   - screener_days: window in days — if screener was administered within this
 *     many days, we do NOT flag. Otherwise we surface the nudge.
 *   - nudge: the specific suggestion shown in the UI
 */
const RISK_CATEGORIES = [
  {
    id: 'suicidal_ideation',
    label: 'Suicidal ideation language',
    patterns: [
      /\b(suicid\w*|kill (?:myself|herself|himself|themselves)|end (?:my|her|his|their) life|take (?:my|her|his|their) (?:own )?life)\b/i,
      /\b(want(?:ed|s)? to die|better off dead|wish(?:ed|es)? (?:i|she|he|they) w(?:as|ere) dead|no (?:reason|point) (?:to|in) liv\w+)\b/i,
      /\b(hopeless\w*|worthless\w*|burden (?:to|on))\b/i,
    ],
    screener: 'C-SSRS',
    screener_days: 14,
    nudge: 'SI language detected. No C-SSRS in the last 2 weeks — consider administering before signing.',
  },
  {
    id: 'homicidal_ideation',
    label: 'Homicidal ideation / threat',
    patterns: [
      /\b(homicid\w*|kill (?:him|her|them|someone)|hurt (?:him|her|them|someone))\b/i,
      /\b(want(?:ed|s)? to (?:hurt|harm|kill) (?:him|her|them|someone))\b/i,
      /\bthreat\w* to (?:hurt|kill|harm)\b/i,
    ],
    screener: 'HI_screen',
    screener_days: 14,
    nudge: 'HI language detected. Document Tarasoff consideration and target-specific risk assessment.',
  },
  {
    id: 'self_harm',
    label: 'Self-harm language',
    patterns: [
      /\b(self.?harm\w*|cutting|burning (?:myself|herself|himself)|hitting (?:myself|herself|himself))\b/i,
      /\b(NSSI|non.?suicidal self.?injury)\b/i,
    ],
    screener: 'self_harm_screen',
    screener_days: 30,
    nudge: 'Self-harm references detected. Consider documenting frequency, method, and most recent episode.',
  },
  {
    id: 'abuse_disclosure',
    label: 'Abuse disclosure',
    patterns: [
      /\b(abus(?:e|ed|ing)|molest(?:ed|ation)|assault(?:ed)?|rap(?:e|ed))\b/i,
      /\b(domestic violence|intimate partner violence|IPV)\b/i,
      /\b(CPS|APS|child protective|adult protective) (?:call|report|involvement)\b/i,
    ],
    screener: 'mandated_reporter_doc',
    screener_days: 60,
    nudge: 'Abuse disclosure detected. Review mandated reporter obligations and document safety plan.',
  },
];

// ── Fast Stage: Pattern Detection ────────────────────────────────────────────

/**
 * Return the list of categories whose patterns match anywhere in the text.
 * Each entry includes the first matching snippet (trimmed, ~80 chars) for
 * the UI to quote back to the therapist.
 */
function detectPatterns(text) {
  if (!text || text.length < 20) return [];

  const lower = String(text);
  const hits = [];

  for (const cat of RISK_CATEGORIES) {
    for (const pattern of cat.patterns) {
      const match = lower.match(pattern);
      if (match) {
        // Capture ~80 chars around the match for quoting
        const idx = match.index || 0;
        const snippetStart = Math.max(0, idx - 20);
        const snippetEnd = Math.min(lower.length, idx + match[0].length + 40);
        const snippet = lower
          .slice(snippetStart, snippetEnd)
          .replace(/\s+/g, ' ')
          .trim();

        hits.push({
          id: cat.id,
          label: cat.label,
          snippet,
          matched: match[0],
          screener: cat.screener,
          screener_days: cat.screener_days,
          nudge: cat.nudge,
        });
        break; // one hit per category is enough
      }
    }
  }

  return hits;
}

// ── Screener Documentation Check ─────────────────────────────────────────────

/**
 * For a given patient, find which screeners have been administered within the
 * configured window. Returns a Set of screener IDs that are "covered."
 *
 * Checks both the `assessments` table (scored instruments) and recent session
 * notes (e.g. a clinician who documented a C-SSRS in narrative form).
 */
async function getDocumentedScreeners(db, patientId, therapistId) {
  const covered = new Set();

  if (!patientId) return covered;

  // Assessments — exact template match or close alias
  const now = Date.now();
  const maxWindowDays = Math.max(...RISK_CATEGORIES.map(c => c.screener_days));
  const cutoffIso = new Date(now - maxWindowDays * 24 * 60 * 60 * 1000).toISOString();

  let recentAssessments = [];
  try {
    recentAssessments = await db.all(
      `SELECT template_type, administered_at
       FROM assessments
       WHERE patient_id = ? AND therapist_id = ?
         AND administered_at >= ?`,
      patientId, therapistId, cutoffIso
    );
  } catch {
    // table might not exist on very old DBs — fail open (don't flag)
    return covered;
  }

  for (const a of recentAssessments) {
    const t = String(a.template_type || '').toUpperCase();
    const ageDays = (now - new Date(a.administered_at).getTime()) / (24 * 60 * 60 * 1000);

    for (const cat of RISK_CATEGORIES) {
      const screener = cat.screener.toUpperCase();
      if ((t === screener || t.includes(screener.replace('_SCREEN', ''))) && ageDays <= cat.screener_days) {
        covered.add(cat.id);
      }
    }
  }

  // Narrative check: has the therapist documented a C-SSRS or risk screen in
  // a recent signed note? Look for explicit phrases — if present, treat the
  // category as covered even without a formal assessment row.
  let recentNotes = [];
  try {
    recentNotes = await db.all(
      `SELECT assessment, plan, session_date
       FROM sessions
       WHERE patient_id = ? AND therapist_id = ?
         AND session_date >= ?
       ORDER BY session_date DESC
       LIMIT 5`,
      patientId, therapistId, cutoffIso
    );
  } catch {
    return covered;
  }

  const narrativeSignals = {
    suicidal_ideation: /\b(C[-\s]?SSRS|columbia[-\s]scale|SI screen|suicide risk assessment|safety plan)\b/i,
    homicidal_ideation: /\b(tarasoff|HI screen|homicide risk)\b/i,
    self_harm: /\b(self.?harm (?:screen|assessment)|NSSI (?:screen|assessment))\b/i,
    abuse_disclosure: /\b(mandated report|CPS report|APS report|safety plan)\b/i,
  };

  for (const note of recentNotes) {
    const combined = `${note.assessment || ''} ${note.plan || ''}`;
    for (const [catId, sig] of Object.entries(narrativeSignals)) {
      if (sig.test(combined)) covered.add(catId);
    }
  }

  return covered;
}

// ── Stage 2: Context Confirmation (optional LLM) ─────────────────────────────

/**
 * Use Haiku to check whether the hit is describing active risk content or
 * documenting its absence (e.g. "client denied SI"). Returns the filtered
 * hits list — only confirmed risks stay.
 *
 * Returns the original hits unchanged on any error (fail open — better to
 * nudge on a negation than to silently drop a real risk).
 */
async function confirmWithLLM(text, hits, therapistId) {
  if (hits.length === 0) return hits;
  if (process.env.MIWA_SKIP_RISK_LLM === 'true') return hits;

  const categoryList = hits.map(h => `- ${h.id}: ${h.label}`).join('\n');

  const systemPrompt = `You review clinical session-note text for risk content.

For each candidate risk category listed, decide whether the text describes ACTIVE risk
(the client is endorsing, describing, or disclosing) or NEGATED risk (the clinician is
documenting the absence — phrases like "denied SI", "no HI", "contracted for safety,"
"no current self-harm", "abuse ruled out").

Respond with a JSON array of category IDs that are ACTIVE. Example: ["suicidal_ideation"]
If none are active, respond with [].
Respond ONLY with the JSON array — no prose, no markdown.`;

  const userPrompt = `Candidate categories:\n${categoryList}\n\nNote text:\n"""${text.slice(0, 4000)}"""`;

  try {
    const response = await classifyIntent(systemPrompt, userPrompt, 200, {
      therapistId,
      kind: 'risk_monitor_confirm',
      skipBudgetCheck: true, // risk monitoring is safety-critical; never block
    });

    // Parse — be lenient
    const cleaned = String(response || '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    let activeIds;
    try {
      activeIds = JSON.parse(cleaned);
    } catch {
      // Try to salvage — look for bracketed list
      const m = cleaned.match(/\[[^\]]*\]/);
      activeIds = m ? JSON.parse(m[0]) : null;
    }

    if (!Array.isArray(activeIds)) return hits; // fail open
    const activeSet = new Set(activeIds);
    return hits.filter(h => activeSet.has(h.id));
  } catch (err) {
    console.warn('[risk-monitor] LLM confirm failed, passing raw hits:', err.message);
    return hits;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan a note text for risk signals and check screener documentation.
 *
 * @param {object} params
 * @param {string} params.text         — the note text being typed
 * @param {number} [params.patientId]  — enables screener lookup; omit for a context-less scan
 * @param {number} params.therapistId  — ownership + cost tracking
 * @param {boolean} [params.skipLLM]   — force fast path (no Haiku confirm)
 * @returns {Promise<{
 *   status: 'ok'|'error',
 *   risks: Array<{ id, label, snippet, nudge, covered: boolean }>,
 *   scanned_chars: number,
 *   duration_ms: number,
 * }>}
 */
async function scanNote({ text, patientId, therapistId, skipLLM }) {
  const started = Date.now();

  if (!text || typeof text !== 'string') {
    return { status: 'ok', risks: [], scanned_chars: 0, duration_ms: 0 };
  }

  const rawHits = detectPatterns(text);
  if (rawHits.length === 0) {
    return {
      status: 'ok',
      risks: [],
      scanned_chars: text.length,
      duration_ms: Date.now() - started,
    };
  }

  // Stage 2 — confirm with LLM
  const confirmed = skipLLM
    ? rawHits
    : await confirmWithLLM(text, rawHits, therapistId);

  // Attach `covered` flag based on recent screeners
  const db = getAsyncDb();
  const covered = patientId
    ? await getDocumentedScreeners(db, patientId, therapistId)
    : new Set();

  // Only surface categories that are NOT already covered — otherwise we'd
  // nag on a note where the clinician already did the right screen.
  const risks = confirmed
    .filter(h => !covered.has(h.id))
    .map(h => ({
      id: h.id,
      label: h.label,
      snippet: h.snippet,
      nudge: h.nudge,
      covered: false,
    }));

  return {
    status: 'ok',
    risks,
    scanned_chars: text.length,
    duration_ms: Date.now() - started,
  };
}

module.exports = {
  scanNote,
  detectPatterns,       // exported for testing
  RISK_CATEGORIES,      // exported for introspection
};
