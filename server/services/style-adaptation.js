/**
 * Per-Therapist Style Adaptation
 *
 * Miwa learns each clinician's voice by comparing AI drafts to what they
 * actually save. Within ~10 sessions the drafts read like the therapist
 * wrote them — that's the moat.
 *
 * Flow:
 *   1. `captureSample()` — on save, compare AI draft → saved text per field.
 *      Store each changed-enough pair as a row in `style_samples`.
 *   2. `maybeRebuildProfile()` — after every N new samples, re-distill the
 *      therapist's style into a compact profile stored in
 *      `therapist_style_profile`. LLM-powered through Azure OpenAI.
 *   3. `getStyleHintsForPrompt()` — cheap getter that returns the profile's
 *      injected-prompt block for drafting endpoints.
 *
 * Everything is best-effort. Capture failures don't block note saves.
 * Profile-rebuild failures keep the previous profile in place.
 */

'use strict';

const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { callAI, MODELS } = require('../lib/aiExecutor');

// ── Tuning ───────────────────────────────────────────────────────────────────

const MIN_FIELD_CHARS       = 40;   // ignore trivially short fields
const MIN_EDIT_RATIO        = 0.08; // ignore near-identical edits (<8% chars changed)
const REBUILD_EVERY         = 5;    // rebuild profile every N new samples
const MIN_SAMPLES_FOR_FIRST = 3;    // need at least 3 samples for a meaningful first profile
const RECENT_SAMPLES_FOR_REBUILD = 20; // only look at the most recent N samples
const MAX_SAMPLE_CHARS      = 1200; // truncate each sample side before sending to the LLM

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Approximate edit distance — cheap substring-based diff count, not Levenshtein.
 * Sufficient for "did this change meaningfully?" gating.
 */
function approxEditDistance(a, b) {
  const A = String(a || '');
  const B = String(b || '');
  if (A === B) return 0;
  // Cheap upper bound: |len diff| + char-level xor count over shared prefix.
  const lenDiff = Math.abs(A.length - B.length);
  const minLen = Math.min(A.length, B.length);
  let mismatches = 0;
  for (let i = 0; i < minLen; i++) {
    if (A.charCodeAt(i) !== B.charCodeAt(i)) mismatches++;
  }
  return mismatches + lenDiff;
}

function safeJsonParse(s, fallback = null) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

// ── Sample Capture ───────────────────────────────────────────────────────────

/**
 * Capture style samples from a save. Receives the AI draft fields + the saved
 * fields (either full SOAP object or single-field pair). Writes one
 * `style_samples` row per changed-enough field.
 *
 * @param {object} params
 *   therapistId, sessionId, source,
 *   aiDraft     — { subjective, objective, assessment, plan } (any subset)
 *   finalText   — same shape
 * @returns {number} count of samples captured
 */
async function captureSample({ therapistId, sessionId, source, aiDraft, finalText }) {
  if (!therapistId || !aiDraft || !finalText) return 0;

  const db = getAsyncDb();
  const fields = Object.keys(aiDraft);
  let captured = 0;

  for (const field of fields) {
    const ai = aiDraft[field];
    const final = finalText[field];
    if (typeof ai !== 'string' || typeof final !== 'string') continue;
    if (ai.length < MIN_FIELD_CHARS && final.length < MIN_FIELD_CHARS) continue;

    const dist = approxEditDistance(ai, final);
    const ratio = ai.length > 0 ? dist / ai.length : 1;
    // Skip near-identical edits (noise), but still keep "no-op acceptances"
    // if the therapist has <5 samples overall (so first-profile has data).
    if (ratio < MIN_EDIT_RATIO) {
      try {
        const countRow = await db.get(
          `SELECT COUNT(*) AS c FROM style_samples WHERE therapist_id = ?`,
          therapistId
        );
        if ((countRow?.c || 0) >= 5) continue;
      } catch { continue; }
    }

    try {
      await db.run(
        `INSERT INTO style_samples
          (therapist_id, session_id, source, field, ai_draft, final_text, edit_distance)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        therapistId, sessionId || null, source || 'unknown', field, ai, final, dist
      );
      captured++;
    } catch (err) {
      console.warn('[style] sample insert failed:', err.message);
    }
  }

  if (captured > 0) {
    try {
      await db.run(
        `INSERT INTO therapist_style_profile (therapist_id, sample_count, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(therapist_id) DO UPDATE SET
           sample_count = sample_count + excluded.sample_count,
           updated_at = excluded.updated_at`,
        therapistId, captured, new Date().toISOString()
      );
    } catch {}
    await persistIfNeeded();
  }

  return captured;
}

// ── Profile Rebuild ──────────────────────────────────────────────────────────

/**
 * Extract a distilled style profile from this therapist's recent samples.
 * Runs in background after capture — the caller doesn't await.
 */
async function rebuildProfile(therapistId) {
  const db = getAsyncDb();

  const samples = await db.all(
    `SELECT field, ai_draft, final_text
     FROM style_samples
     WHERE therapist_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    therapistId, RECENT_SAMPLES_FOR_REBUILD
  );

  if (!samples || samples.length < MIN_SAMPLES_FOR_FIRST) return null;

  // Build a compact prompt packet — truncate each sample side.
  const packetLines = samples.map((s, i) => {
    const ai = (s.ai_draft || '').slice(0, MAX_SAMPLE_CHARS);
    const fi = (s.final_text || '').slice(0, MAX_SAMPLE_CHARS);
    return `=== Sample ${i + 1} (${s.field || 'whole'}) ===\nAI draft:\n${ai}\n\nTherapist kept:\n${fi}\n`;
  });

  const systemPrompt = `You are analyzing a therapist's edits to AI-drafted session notes.
Your job: distill a compact style profile that describes how THIS therapist writes
clinical notes, based on the differences between AI drafts and what they actually kept.

Return STRICT JSON only — no markdown, no prose:
{
  "hints": "2-3 sentence plain-English description of this therapist's voice",
  "prefer_phrases": ["phrase or pattern they add or keep", ...],
  "avoid_phrases":  ["phrase or pattern they remove or rewrite", ...],
  "avg_length_ratio": 1.0,
  "formality": "clinical"
}

Rules:
  • prefer_phrases and avoid_phrases: max 8 each, short phrases (≤6 words).
    Only include patterns you see repeat across 2+ samples.
  • avg_length_ratio: therapist_final_length / ai_draft_length, averaged. Round to 2 decimals.
  • formality: one of "clinical", "warm", "mixed".
  • If samples are sparse or inconsistent, err on the side of an empty list — don't invent a style.
  • Never echo PHI (client names, diagnoses) into prefer/avoid lists. Focus on stylistic patterns only.`;

  const userPrompt = packetLines.join('\n');

  let text;
  try {
    text = await callAI(
      MODELS.AZURE_MAIN,
      systemPrompt,
      userPrompt,
      800,
      { therapistId, kind: 'style_profile_rebuild' }
    );
  } catch (err) {
    console.warn('[style] profile rebuild LLM call failed:', err.message);
    return null;
  }

  // Parse JSON leniently
  let parsed = null;
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch {}
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    console.warn('[style] profile parse failed');
    return null;
  }

  // Persist
  const now = new Date().toISOString();
  const countRow = await db.get(
    `SELECT sample_count FROM therapist_style_profile WHERE therapist_id = ?`,
    therapistId
  );

  try {
    await db.run(
      `INSERT INTO therapist_style_profile
        (therapist_id, sample_count, hints_text, prefer_phrases_json, avoid_phrases_json,
         avg_length_ratio, formality, last_rebuild_at, last_rebuild_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(therapist_id) DO UPDATE SET
         hints_text = excluded.hints_text,
         prefer_phrases_json = excluded.prefer_phrases_json,
         avoid_phrases_json = excluded.avoid_phrases_json,
         avg_length_ratio = excluded.avg_length_ratio,
         formality = excluded.formality,
         last_rebuild_at = excluded.last_rebuild_at,
         last_rebuild_count = excluded.last_rebuild_count,
         updated_at = excluded.updated_at`,
      therapistId,
      countRow?.sample_count || samples.length,
      String(parsed.hints || '').slice(0, 500),
      JSON.stringify(Array.isArray(parsed.prefer_phrases) ? parsed.prefer_phrases.slice(0, 8) : []),
      JSON.stringify(Array.isArray(parsed.avoid_phrases) ? parsed.avoid_phrases.slice(0, 8) : []),
      typeof parsed.avg_length_ratio === 'number' ? parsed.avg_length_ratio : null,
      ['clinical', 'warm', 'mixed'].includes(parsed.formality) ? parsed.formality : null,
      now,
      countRow?.sample_count || samples.length,
      now
    );
    await persistIfNeeded();
  } catch (err) {
    console.warn('[style] profile persist failed:', err.message);
    return null;
  }

  console.log(
    `[style] rebuilt profile for therapist ${therapistId} ` +
    `from ${samples.length} samples; formality=${parsed.formality}`
  );
  return parsed;
}

/**
 * Decide whether to rebuild after a capture. Fires fire-and-forget so the
 * caller doesn't block. Rebuilds at 3 samples, then every REBUILD_EVERY after.
 */
async function maybeRebuildProfile(therapistId) {
  try {
    const db = getAsyncDb();
    const profile = await db.get(
      `SELECT sample_count, last_rebuild_count FROM therapist_style_profile WHERE therapist_id = ?`,
      therapistId
    );
    if (!profile) return;
    const last = profile.last_rebuild_count || 0;
    const now = profile.sample_count || 0;
    if (now < MIN_SAMPLES_FOR_FIRST) return;
    if (last === 0 || (now - last) >= REBUILD_EVERY) {
      // Fire-and-forget
      rebuildProfile(therapistId).catch(err =>
        console.warn('[style] background rebuild failed:', err.message)
      );
    }
  } catch {}
}

// ── Prompt Injection ─────────────────────────────────────────────────────────

/**
 * Return a compact style-hint block to append to drafting system prompts.
 * Empty string if no profile yet — caller concatenates unconditionally.
 */
async function getStyleHintsForPrompt(therapistId) {
  try {
    const db = getAsyncDb();
    const profile = await db.get(
      `SELECT hints_text, prefer_phrases_json, avoid_phrases_json,
              avg_length_ratio, formality, sample_count
       FROM therapist_style_profile WHERE therapist_id = ?`,
      therapistId
    );
    if (!profile || !profile.hints_text) return '';

    const lines = [];
    lines.push('\n\nYOUR VOICE (learned from your edits — match this style):');
    lines.push(profile.hints_text);

    const prefer = safeJsonParse(profile.prefer_phrases_json, []);
    const avoid  = safeJsonParse(profile.avoid_phrases_json, []);
    if (prefer.length) lines.push(`Prefer: ${prefer.map(p => `"${p}"`).join(', ')}`);
    if (avoid.length)  lines.push(`Avoid: ${avoid.map(p => `"${p}"`).join(', ')}`);
    if (profile.avg_length_ratio) {
      if (profile.avg_length_ratio < 0.85) lines.push('Keep it shorter than your default — this clinician writes tight notes.');
      else if (profile.avg_length_ratio > 1.15) lines.push('Write with more detail — this clinician prefers thorough notes.');
    }
    if (profile.formality === 'warm')    lines.push('Voice: warm and humanizing, still clinically precise.');
    if (profile.formality === 'clinical') lines.push('Voice: direct, clinical, no softening.');

    return lines.join('\n');
  } catch {
    return '';
  }
}

/**
 * Retrieve the current profile for display (e.g. therapist settings page).
 */
async function getProfile(therapistId) {
  const db = getAsyncDb();
  const row = await db.get(
    `SELECT * FROM therapist_style_profile WHERE therapist_id = ?`,
    therapistId
  );
  if (!row) return null;
  return {
    ...row,
    prefer_phrases: safeJsonParse(row.prefer_phrases_json, []),
    avoid_phrases:  safeJsonParse(row.avoid_phrases_json, []),
  };
}

module.exports = {
  captureSample,
  maybeRebuildProfile,
  rebuildProfile,
  getStyleHintsForPrompt,
  getProfile,
};
