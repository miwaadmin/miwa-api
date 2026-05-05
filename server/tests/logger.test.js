'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const logger = require(path.join(__dirname, '..', 'lib', 'logger'));

test('logger sanitizer scrubs nested PHI in logged objects', () => {
  const sanitized = logger._test.sanitize({
    note: {
      client: 'Client name is Sarah Johnson',
      contacts: ['sarah@example.com', '555-123-4567'],
    },
  });

  const serialized = JSON.stringify(sanitized);
  assert.equal(serialized.includes('Sarah Johnson'), false);
  assert.equal(serialized.includes('sarah@example.com'), false);
  assert.equal(serialized.includes('555-123-4567'), false);
});
