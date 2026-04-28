'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { extractIntakeIdentity } = require(path.join(__dirname, '..', 'services', 'intakeIdentityExtractor'));

describe('intake identity extraction', () => {
  test('extracts accented client name from explicit labels', () => {
    const identity = extractIntakeIdentity(`
      Client Name: Renée Garcia
      DOB: 02/03/1990
      Presenting concern: anxiety
    `, 'uploaded-intake.pdf');

    assert.equal(identity.firstName, 'Renée');
    assert.equal(identity.lastName, 'Garcia');
    assert.equal(identity.displayName, 'Renée Garcia');
  });

  test('extracts Renee name, phone, and email from intake text', () => {
    const identity = extractIntakeIdentity(`
      First Name: Renee
      Last Name: O'Connor
      Phone: (310) 555-1234
      Email: renee.oconnor@example.com
      Gender: Female
    `);

    assert.equal(identity.firstName, 'Renee');
    assert.equal(identity.lastName, "O'Connor");
    assert.equal(identity.displayName, "Renee O'Connor");
    assert.equal(identity.phone, '(310) 555-1234');
    assert.equal(identity.email, 'renee.oconnor@example.com');
    assert.equal(identity.gender, 'female');
  });

  test('falls back conservatively to filename only when text has no name', () => {
    const identity = extractIntakeIdentity(`
      Presenting concern: sleep disruption.
      Phone: 310-555-8888
    `, 'RENE Full DMH Assessment.pdf');

    assert.equal(identity.firstName, 'Rene');
    assert.equal(identity.lastName, '');
    assert.equal(identity.displayName, 'Rene');
    assert.equal(identity.phone, '310-555-8888');
  });

  test('does not let filename override a better text name', () => {
    const identity = extractIntakeIdentity('Patient Name: Renée Alvarez', 'RENE Full DMH Assessment.pdf');

    assert.equal(identity.firstName, 'Renée');
    assert.equal(identity.lastName, 'Alvarez');
    assert.equal(identity.displayName, 'Renée Alvarez');
  });

  test('does not log raw intake identity while extracting', () => {
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;
    const calls = [];

    console.log = console.info = console.warn = console.error = (...args) => calls.push(args.join(' '));
    try {
      extractIntakeIdentity('Client Name: Renée Garcia\nEmail: renee.garcia@example.com');
    } finally {
      console.log = originalLog;
      console.info = originalInfo;
      console.warn = originalWarn;
      console.error = originalError;
    }

    assert.deepEqual(calls, []);
  });
});
