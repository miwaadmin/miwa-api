const test = require('node:test');
const assert = require('node:assert/strict');

const {
  actionVerificationSummary,
  appendVerificationNotice,
  buildCheckpoint,
  classifyFailure,
  inferGoalFromPrompt,
  shouldRetryFailure,
} = require('../services/clinicalDurability');

test('infers persistent clinical goals from delegated prompts', () => {
  assert.equal(
    inferGoalFromPrompt('Review my caseload for risk and safety follow-up').goal_key,
    'risk_review',
  );
  assert.equal(
    inferGoalFromPrompt('/goal: Keep Sarah Kim assessment-current until resolved').title,
    'Keep Sarah Kim assessment-current until resolved',
  );
});

test('classifies retryable failures conservatively', () => {
  assert.equal(classifyFailure(new Error('fetch failed with 503')), 'retryable_transient');
  assert.equal(shouldRetryFailure('retryable_transient'), true);
  assert.equal(classifyFailure(new Error('operator does not exist: text >= timestamp')), 'data_adapter');
  assert.equal(shouldRetryFailure('data_adapter'), false);
});

test('builds compact task checkpoints', () => {
  const checkpoint = buildCheckpoint({
    phase: 'iteration_complete',
    iterations: 2,
    toolCallLog: [{ tool: 'get_caseload_summary' }],
    finalText: '',
  });
  assert.equal(checkpoint.phase, 'iteration_complete');
  assert.equal(checkpoint.iterations, 2);
  assert.equal(checkpoint.toolCallCount, 1);
  assert.equal(checkpoint.lastTool, 'get_caseload_summary');
  assert.equal(checkpoint.hasFinalText, false);
});

test('flags unverified permanent-action claims', () => {
  const verification = actionVerificationSummary([], 'I scheduled the session for tomorrow.');
  assert.equal(verification.verified, false);
  assert.match(appendVerificationNotice('I scheduled the session for tomorrow.', verification), /could not verify/);
});

test('accepts permanent-action claims when a matching server write tool completed', () => {
  const verification = actionVerificationSummary([
    { tool: 'schedule_appointment', result: { appointment_id: 12 } },
  ], 'I scheduled the session for tomorrow.');
  assert.equal(verification.verified, true);
  assert.match(verification.note, /Verified 1 server-side action/);
});
