/**
 * Onboarding — one-shot route that takes the therapist's intro answers
 * and produces a SOUL.md markdown document, saved on the therapist record.
 *
 * Returns Miwa's welcoming confirmation message.
 */

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { MODELS, callAI } = require('../lib/aiExecutor');

router.use(requireAuth);

// POST /api/onboarding/soul
// Body: { response: "the therapist's free-form answer to the intro questions" }
router.post('/soul', async (req, res) => {
  try {
    const db = getAsyncDb();
    const { response } = req.body || {};
    if (!response || typeof response !== 'string' || response.trim().length < 5) {
      return res.status(400).json({ error: 'response is required' });
    }

    const therapist = await db.get(
      'SELECT id, first_name, full_name, user_role FROM therapists WHERE id = ?',
      req.therapist.id
    );
    const firstName = therapist?.first_name || therapist?.full_name?.split(' ')[0] || 'the clinician';
    const userRole = therapist?.user_role || 'licensed';

    const systemPrompt = `You are Miwa, a clinical copilot. The clinician has just answered your intro interview — a set of ~10 questions about who they are, how they work, and how they want you to show up.

Your job: distill their answer into a clean SOUL.md markdown document. This document will be injected into your system prompt for every future conversation, so it should be compact, scannable, and USEFUL.

STRICT FORMAT — use this structure exactly:

## Identity
[One line: preferred name / how they want to be addressed, license type + years in practice if given. Example: "Call me Sam. LMFT, 8 years in private practice."]

## Populations & Specialties
[Who they work with — populations, age ranges, presenting concerns, individual vs couples vs family. One or two sentences.]

## Therapeutic Orientation
[Their primary orientation(s) and any specific frameworks/modalities they use — one or two sentences.]

## Documentation Preferences
[Note format they prefer (SOAP/DAP/BIRP/narrative), anything they always want included, anything to avoid. One or two sentences.]

## What They Want From Miwa
[Their top 1-3 priorities for how Miwa should help — notes, clinical thinking, admin, outreach, etc.]

## Communication Style
[Verbosity (concise/balanced/detailed) and tone (warm/clinical/direct/etc.) in 1-2 sentences.]

## Hard Rules (must follow)
- [Any explicit "never do X" rules, pet peeves, or corrections they gave]
- [One per bullet]
- [Skip this section if none given]

## Working Style Notes
- [Setting (private practice / agency / telehealth), values, training lineage, anything else they mentioned that doesn't fit the sections above]
- [One bullet each]

RULES:
- Be faithful to what they said. Don't invent preferences they didn't express.
- If a section wasn't addressed, write "(not specified — will learn over time)" as its content.
- Keep the whole document under 450 words.
- Use simple, clear language. Prefer their own phrasing where possible.
- NO preamble, NO meta-commentary. Start directly with "## Identity".`;

    const userPrompt = `The clinician is ${firstName} (${userRole}).

Their answer to the intro interview:
"""
${response.trim().slice(0, 8000)}
"""

Write their SOUL.md profile now.`;

    const soulMd = await callAI(
      MODELS.AZURE_MAIN,
      systemPrompt,
      userPrompt,
      1500,
      { therapistId: req.therapist.id, kind: 'onboarding_soul' }
    );

    // Save the profile + mark onboarding complete
    await db.run(
      'UPDATE therapists SET soul_markdown = ?, onboarding_completed = 1 WHERE id = ?',
      soulMd, req.therapist.id
    );
    await persistIfNeeded();

    // Generate a warm confirmation message
    const confirmation = `Got it, ${firstName} — I've saved your profile. 🌿

From here on I'll refer to it in every conversation. You can see it or update it anytime in **Settings → Assistant**.

Ready to get started. Try asking me something like *"what's on my schedule today"* or *"show me my caseload."*`;

    res.json({
      ok: true,
      soul_markdown: soulMd,
      message: confirmation,
    });
  } catch (err) {
    console.error('[onboarding] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
