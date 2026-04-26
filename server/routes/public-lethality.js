/**
 * Public (unauthenticated) Lethality Assessment endpoint.
 *
 * Anyone — a survivor, an advocate, a family member, a clinician at another
 * agency — can hit this URL and get a real-time LAP-MD result with AI-
 * personalized guidance and matched safety resources.
 *
 * NOTHING about this endpoint stores PII:
 *   - No IP address is logged with the submission content
 *   - No client record is created
 *   - The open-text field is passed to Azure OpenAI once and not retained
 *   - An anonymous aggregate row may be stored later (count + highDanger boolean)
 *     for public-health reporting, but that's opt-in and not implemented in v1
 */

'use strict';

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const {
  scoreLAP,
  selectResources,
  generateGuidance,
  fallbackGuidance,
} = require('../services/lap-md');

// Heavy rate limit — this is a public unauthenticated AI endpoint.
// Someone scripting it would burn our AI budget fast. 10 submits per IP
// per hour is plenty for legitimate use.
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. If you are in danger right now, call the National DV Hotline at 1-800-799-7233.' },
});

/**
 * POST /api/public/lethality-screen
 * Body:
 *   { answers: [1|0|null × 11], openText?: string, skipAI?: boolean }
 *
 * Returns:
 *   {
 *     highDanger, reason, yesCountCritical, yesCountOther,
 *     guidance: string,         // AI-generated or fallback
 *     guidanceSource: 'ai'|'fallback',
 *     resources: { hotlines, safety_planning, legal_protection?, shelter?, financial? }
 *   }
 */
router.post('/lethality-screen', submitLimiter, async (req, res) => {
  try {
    const { answers, openText, skipAI } = req.body || {};
    if (!Array.isArray(answers) || answers.length !== 11) {
      return res.status(400).json({ error: 'answers must be an 11-element array (1, 0, or null per item)' });
    }
    for (const a of answers) {
      if (a !== 0 && a !== 1 && a !== null) {
        return res.status(400).json({ error: 'answers must contain only 0, 1, or null' });
      }
    }

    const result = scoreLAP(answers);
    const resources = selectResources({ highDanger: result.highDanger });

    let guidance = null;
    let guidanceSource = 'fallback';
    if (!skipAI) {
      guidance = await generateGuidance({
        answers,
        openText: typeof openText === 'string' ? openText.slice(0, 2000) : '',
        highDanger: result.highDanger,
        isClinicianFlow: false,
      });
      if (guidance) guidanceSource = 'ai';
    }
    if (!guidance) guidance = fallbackGuidance(result.highDanger);

    res.json({
      ...result,
      guidance,
      guidanceSource,
      resources,
    });
  } catch (err) {
    console.error('[public-lethality] error:', err.message);
    res.status(500).json({ error: 'Internal error. If you are in danger, please call 1-800-799-7233.' });
  }
});

module.exports = router;
