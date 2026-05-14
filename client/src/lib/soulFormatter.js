// Shared formatter used by the MiwaChat onboarding flow AND the trainee
// wizard "Introduce yourself to Miwa" screen (Step2Soul) to build the
// `response` string POSTed to POST /api/onboarding/soul.
//
// Each `answer` object has:
//   stage:    string — the ONBOARDING_STAGES id from MiwaChat
//   response: string — the clinician's free-text reply
//
// For wizard answers (which are plain strings keyed by question label),
// this function also accepts a pre-formatted string, which it passes
// through unchanged.

/**
 * @param {Array<{stage: string, response: string}>} answers
 * @returns {string}
 */
export function formatOnboardingAnswers(answers) {
  return answers
    .map((answer, index) => {
      // `step` may be undefined when called from the wizard path where
      // ONBOARDING_STEPS isn't available — fall back gracefully.
      const label = answer.title || answer.stage || `Question ${index + 1}`
      return `Step ${index + 1}: ${label}\n${answer.response || ''}`
    })
    .join('\n\n---\n\n')
}
