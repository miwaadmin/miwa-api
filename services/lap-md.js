/**
 * Lethality Assessment Program (Maryland Model) — LAP-MD service
 *
 * Pure logic + AI guidance for the 11-question intimate partner violence
 * lethality screen. Shared between the authenticated in-app flow
 * (assessments routes) and the public anonymous flow (public-lethality route).
 *
 * Scoring rules:
 *   • Yes to ANY of Q1–Q3         → High-Danger
 *   • Yes to ≥4 of Q4–Q11         → High-Danger
 *   • Otherwise                    → Not High-Danger (at this time)
 *
 * AI guidance is ALWAYS best-effort — if Azure OpenAI fails, we fall back to
 * a static safety message. Nothing about the scoring itself depends on AI.
 */

'use strict';

const { clinicalReasoning } = require('../lib/aiExecutor');

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Compute the LAP-MD result from an 11-element answer array.
 * Each element is 1 (yes), 0 (no), or null (not answered / unknown).
 *
 * @returns {{
 *   highDanger: boolean,
 *   reason: string,              // why it was High-Danger (for explanation UI)
 *   yesCountCritical: number,    // of Q1-Q3
 *   yesCountOther: number,       // of Q4-Q11
 * }}
 */
function scoreLAP(answers) {
  const yes = answers.map(a => a === 1);
  const yesOnCritical = yes.slice(0, 3).filter(Boolean).length;
  const yesOnOther = yes.slice(3).filter(Boolean).length;

  let reason = '';
  let highDanger = false;
  if (yesOnCritical >= 1) {
    highDanger = true;
    reason = 'Yes to at least one of the three most-critical questions (weapon, intent to kill, strangulation).';
  } else if (yesOnOther >= 4) {
    highDanger = true;
    reason = `Yes to ${yesOnOther} of the 8 secondary questions (threshold: 4).`;
  } else {
    reason = `${yesOnOther} Yes responses to secondary questions — below the High-Danger threshold (4). Does not rule out risk.`;
  }

  return { highDanger, reason, yesCountCritical: yesOnCritical, yesCountOther: yesOnOther };
}

// ── Resource matching ────────────────────────────────────────────────────────

/**
 * A curated set of safety resources suggested alongside a LAP-MD result.
 * Intentionally hand-picked for survivors in (or approaching) an IPV crisis.
 * Kept in this file (not resources.jsx) so the public flow doesn't have to
 * load the full library.
 */
const SAFETY_RESOURCES = {
  hotlines: [
    {
      name: 'National Domestic Violence Hotline',
      phone: '1-800-799-7233',
      text: 'START to 88788',
      url: 'https://www.thehotline.org/',
      available: '24/7',
      description: '24/7 confidential support, safety planning, and local shelter referrals.',
    },
    {
      name: 'StrongHearts Native Helpline',
      phone: '1-844-762-8483',
      url: 'https://strongheartshelpline.org/',
      available: '24/7',
      description: 'Culturally-appropriate support for Native Americans and Alaska Natives experiencing DV.',
    },
    {
      name: '988 Suicide & Crisis Lifeline',
      phone: '988',
      text: '988',
      url: 'https://988lifeline.org/',
      available: '24/7',
      description: 'If you are in danger of hurting yourself or someone else — reach someone now.',
    },
  ],
  safety_planning: [
    {
      name: 'myPlan App (Johns Hopkins)',
      url: 'https://myplanapp.org/',
      description: 'Free confidential app for personalized safety planning. Based on research with DV survivors. Available in English and Spanish.',
    },
    {
      name: 'The Hotline — Create a Safety Plan',
      url: 'https://www.thehotline.org/plan-for-safety/create-a-safety-plan/',
      description: 'Step-by-step guidance for building a safety plan — whether staying, preparing to leave, or already left.',
    },
  ],
  legal_protection: [
    {
      name: 'California Courts Self-Help — Restraining Orders',
      url: 'https://selfhelp.courts.ca.gov/restraining-orders',
      description: 'File a domestic violence restraining order. Step-by-step instructions. No attorney required.',
    },
    {
      name: 'WomensLaw.org',
      url: 'https://www.womenslaw.org/',
      description: 'State-by-state legal information for survivors. Restraining orders, custody, immigration, workplace protections.',
    },
  ],
  shelter: [
    {
      name: 'DomesticShelters.org',
      url: 'https://www.domesticshelters.org/',
      description: 'Searchable national database of DV shelters by ZIP code. Includes bed availability and services.',
    },
    {
      name: 'RedRover Relief (pets)',
      url: 'https://redrover.org/program/redrover-relief/',
      description: 'Emergency boarding and financial assistance for pets — removes a common barrier to leaving.',
    },
  ],
  financial: [
    {
      name: 'California Victim Compensation Board',
      url: 'https://victims.ca.gov/',
      description: 'CalVCB pays for medical care, mental health counseling, income loss, relocation, and other expenses related to a violent crime.',
    },
  ],
};

/**
 * Pick the relevant resource slice based on the result.
 */
function selectResources({ highDanger, yesOnItem }) {
  // Everyone gets the hotline + safety planning.
  const picked = {
    hotlines: SAFETY_RESOURCES.hotlines,
    safety_planning: SAFETY_RESOURCES.safety_planning,
  };

  if (highDanger) {
    picked.legal_protection = SAFETY_RESOURCES.legal_protection;
    picked.shelter = SAFETY_RESOURCES.shelter;
    picked.financial = SAFETY_RESOURCES.financial;
  }
  // If they indicated pets worry them (via open text) or if they endorsed
  // living-together separation, pet resources might matter too. Deliberately
  // NOT trying to infer that here — kept simple.

  return picked;
}

// ── AI guidance ──────────────────────────────────────────────────────────────

/**
 * Generate a short, warm, non-prescriptive guidance paragraph tailored to
 * the survivor's answers. Never diagnoses, never overrides their judgment,
 * never invents facts. Falls back to a static message on any error.
 *
 * @param {object} params
 *   answers          — 11-element array of 1|0|null
 *   openText         — optional survivor-written "anything else that worries you?"
 *   highDanger       — boolean, from scoreLAP
 *   isClinicianFlow  — boolean, true if a clinician is reading alongside a client
 */
async function generateGuidance({ answers, openText, highDanger, isClinicianFlow, therapistId }) {
  const yesIndices = answers
    .map((a, i) => (a === 1 ? i + 1 : null))
    .filter(i => i != null);

  const QUESTION_LABELS = [
    'used a weapon or threatened with one',
    'thinks they might try to kill you',
    'tried to choke or strangle',
    'threatened to kill you or your children',
    'has or can easily get a gun',
    'violently jealous or controlling',
    'you have left or separated',
    'they are unemployed',
    'they have tried to kill themselves',
    'you have a child they know is not theirs',
    'follows, spies, or leaves threatening messages',
  ];

  const endorsed = yesIndices.map(i => `• ${QUESTION_LABELS[i - 1]}`).join('\n') || '(no endorsed items)';

  const audienceRule = isClinicianFlow
    ? 'You are writing for a clinician or advocate reading this alongside the survivor. Use direct clinical language, but keep the tone humane.'
    : 'You are writing directly TO the survivor who just filled this out. Use second person ("you"). Warm, steady, never alarmist, never dismissive. Do not tell them what to do; offer what they could consider.';

  const systemPrompt = `You are a trauma-informed guide for someone who has just completed the Lethality Assessment Program (LAP-MD) — an 11-question intimate partner violence lethality screen.

${audienceRule}

RULES — non-negotiable:
  • Never say "you are in high danger" as a fact. Say the screen indicates elevated risk.
  • Never recommend leaving the relationship or any single specific action. Leaving is the moment of highest danger for many survivors; this decision is theirs.
  • Never diagnose, never pathologize the survivor or their partner.
  • Never minimize ("at least…") or catastrophize ("you must…").
  • If they endorsed strangulation, weapon use, or threatening to kill — briefly name why those signals carry weight (e.g. strangulation is a known predictor of intimate partner homicide) — but do NOT lecture.
  • If they left the open text blank, do not invent content.
  • Hard cap: 170 words. Structure: one short opening paragraph acknowledging what they shared, one short paragraph about what the screen suggests, one short paragraph about what they could consider next (talking to an advocate, safety planning, deciding on their own timeline).
  • Do not use bullet points or headers. Flowing prose. No emoji.
  • Do not mention Miwa or AI. Be invisible.
  • Close with: "Whatever you decide, you are not alone."`;

  const userPrompt = `Endorsed items (Yes responses):
${endorsed}

Screen result: ${highDanger ? 'Elevated risk pattern' : 'Below the high-danger threshold (but risk signs still present)'}

${openText ? `What they shared about their safety:\n"${openText.slice(0, 800)}"` : '(No additional context shared.)'}

Write the guidance now.`;

  try {
    const text = await clinicalReasoning(
      systemPrompt,
      userPrompt,
      600,
      false,
      {
        therapistId: therapistId || 0, // 0 = public anonymous
        kind: 'lap_md_guidance',
        skipBudgetCheck: !therapistId, // skip budget for public flow
      }
    );
    return (text || '').trim() || null;
  } catch (err) {
    console.warn('[lap-md] guidance generation failed:', err.message);
    return null;
  }
}

/**
 * Static fallback message when AI guidance isn't available.
 */
function fallbackGuidance(highDanger) {
  if (highDanger) {
    return 'Based on your answers, this screen suggests a pattern of risk that is worth taking seriously. You know your situation better than any screen does — trust that. If you would like to talk it through with someone trained, the National Domestic Violence Hotline is available 24/7 at 1-800-799-7233. They can help you think about safety planning at your own pace. Whatever you decide, you are not alone.';
  }
  return 'This screen does not show the pattern that typically indicates imminent danger — but screens are never the whole story, and what you are experiencing still matters. If parts of what you answered felt scary or confusing, that is worth talking about with someone. The National Domestic Violence Hotline (1-800-799-7233) is available 24/7 if you want to think it through with a trained advocate. Whatever you decide, you are not alone.';
}

module.exports = {
  scoreLAP,
  selectResources,
  generateGuidance,
  fallbackGuidance,
  SAFETY_RESOURCES,
};
