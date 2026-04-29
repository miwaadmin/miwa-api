const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { getLocalDateParts } = require(path.join(__dirname, '..', 'services', 'researcher'));

test('research brief dates use therapist timezone, not UTC server date', () => {
  const latePacificEvening = new Date('2026-04-29T04:43:00.000Z');
  const pacific = getLocalDateParts(latePacificEvening, 'America/Los_Angeles');
  const utc = getLocalDateParts(latePacificEvening, 'UTC');

  assert.equal(pacific.localDate, '2026-04-28');
  assert.equal(pacific.titleDate, 'April 28, 2026');
  assert.equal(pacific.longDate, 'Tuesday, April 28, 2026');

  assert.equal(utc.localDate, '2026-04-29');
  assert.equal(utc.titleDate, 'April 29, 2026');
});
