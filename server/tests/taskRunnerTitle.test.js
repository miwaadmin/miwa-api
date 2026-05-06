const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveTitle } = require('../services/task-runner');

test('deriveTitle names caseload reports by artifact instead of raw prompt', () => {
  assert.equal(
    deriveTitle('hey can I have a report on all my clients to see who is doing well'),
    'Caseload Progress Report',
  );
});

test('deriveTitle names client-specific safety work clearly', () => {
  assert.equal(
    deriveTitle('draft a safety summary for Sarah Jones'),
    'Sarah Jones Risk Review',
  );
});

test('deriveTitle strips chat filler in fallback titles', () => {
  assert.equal(
    deriveTitle('can you put together a quick note cleanup checklist for tomorrow'),
    'Put Together A Quick Note Cleanup Checklist For Tomorrow',
  );
});
