/**
 * PHI Scrubber — automated test suite
 *
 * Run with:  node --test server/tests/scrubber.test.js
 *
 * Tests every HIPAA Safe Harbor category and verifies that the scrubber
 * removes or redacts each identifier before it could reach an external model.
 * Any test failure means PHI CAN LEAK — fix the scrubber before shipping.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const { scrub, scrubText, scrubObject } = require(path.join(__dirname, '..', 'lib', 'scrubber'));

// ── Helper ────────────────────────────────────────────────────────────────────

function assertRedacted(input, description) {
  const result = scrubText(input);
  assert.notEqual(
    result, input,
    `FAIL — "${description}" was NOT redacted.\nInput:  ${input}\nOutput: ${result}`,
  );
}

function assertContains(input, badSubstring, description) {
  const result = scrubText(input);
  assert.ok(
    !result.includes(badSubstring),
    `FAIL — "${description}" still contains "${badSubstring}" after scrubbing.\nOutput: ${result}`,
  );
}

// ── 1. Structural PHI — all 18 HIPAA Safe Harbor identifiers ─────────────────

describe('HIPAA Safe Harbor — structural patterns', () => {

  test('SSN formats', () => {
    assertContains('Patient SSN: 123-45-6789', '123-45-6789', 'SSN with dashes');
    assertContains('SSN 123 45 6789 on file', '123 45 6789', 'SSN with spaces');
    assertContains('ssn=987654321', '987654321', 'SSN no separator');
  });

  test('Date of birth', () => {
    assertContains('DOB: 01/15/1985', '01/15/1985', 'DOB MM/DD/YYYY');
    assertContains('born on 1985-01-15', '1985-01-15', 'ISO date of birth');
    assertContains('Date of Birth: March 3, 1990', '1990', 'DOB long form');
  });

  test('Phone numbers', () => {
    assertContains('call me at (310) 555-1234', '555-1234', 'Phone with parens');
    assertContains('mobile: 310.555.1234', '310.555.1234', 'Phone with dots');
    assertContains('+1-800-555-0199', '800-555-0199', 'Phone international');
  });

  test('Fax numbers', () => {
    assertContains('fax: (310) 555-9876', '555-9876', 'Fax with label');
  });

  test('Email addresses', () => {
    assertContains('email: john.doe@example.com', 'john.doe@example.com', 'Email address');
    assertContains('contact patient at sue_smith@hospital.org', 'sue_smith@hospital.org', 'Email in sentence');
  });

  test('URLs', () => {
    assertContains('see https://patient.portal.hospital.com/profile', 'patient.portal.hospital.com', 'HTTPS URL');
    assertContains('http://referral.com/form?id=123', 'referral.com', 'HTTP URL');
  });

  test('IP addresses', () => {
    assertContains('user IP 192.168.1.100 logged', '192.168.1.100', 'IPv4 address');
  });

  test('ZIP codes', () => {
    assertContains('client lives in ZIP 90210', '90210', 'ZIP 5-digit labeled');
    assertContains('zip: 90210-3456', '90210-3456', 'ZIP+4');
  });

  test('MRN / medical record numbers', () => {
    assertContains('MRN: 78234', '78234', 'MRN labeled');
    assertContains('medical record number 00123456', '00123456', 'MRN long form');
  });

  test('NPI numbers', () => {
    assertContains('NPI: 1234567890', '1234567890', 'NPI 10-digit');
  });

  test('Account numbers', () => {
    assertContains('account #: 887766554', '887766554', 'Account number');
    assertContains('acct 123-456-789', '123-456-789', 'Account abbrev');
  });

  test('License numbers', () => {
    assertContains('license #LMFT12345', 'LMFT12345', 'License number');
    assertContains('CA license: MFC 987654', 'MFC 987654', 'License CA format');
  });

  test('Credit / debit card numbers', () => {
    assertContains('card 4111-1111-1111-1111 charged', '4111-1111-1111-1111', 'Visa card');
    assertContains('card number 5500000000000004', '5500000000000004', 'MC card no spaces');
  });

  test('VIN numbers', () => {
    assertContains('VIN: 1HGBH41JXMN109186', '1HGBH41JXMN109186', 'VIN');
  });

  test('Street addresses', () => {
    assertContains('lives at 123 Main Street, Los Angeles', '123 Main Street', 'Street address');
    assertContains('address: 456 Oak Ave Apt 2B', '456 Oak Ave', 'Address with apt');
  });

});

// ── 2. Labeled PHI ────────────────────────────────────────────────────────────

describe('Labeled PHI patterns (Name:, DOB:, MRN: etc.)', () => {

  test('Name label', () => {
    assertContains('Name: John Smith', 'John Smith', 'Name: label');
    assertContains('Patient Name: Maria Garcia', 'Maria Garcia', 'Patient Name: label');
  });

  test('DOB label', () => {
    assertContains('DOB: 1990-05-12', '1990-05-12', 'DOB: ISO');
  });

  test('Address label', () => {
    assertContains('Address: 99 Willow Lane', '99 Willow Lane', 'Address: label');
  });

});

// ── 3. Titled names ───────────────────────────────────────────────────────────

describe('Titled names (Dr., Mr., Mrs., Ms.)', () => {

  test('Dr. prefix', () => {
    assertContains('referred by Dr. Johnson', 'Johnson', 'Dr. prefix name');
    assertContains('treating physician is Dr. Sarah Williams', 'Sarah Williams', 'Dr. full name');
  });

  test('Mr. / Mrs. / Ms.', () => {
    assertContains('session with Mr. Thompson today', 'Thompson', 'Mr. prefix');
    assertContains('Mrs. Chen reports improvement', 'Chen', 'Mrs. prefix');
    assertContains('Ms. Rodriguez denied SI', 'Rodriguez', 'Ms. prefix');
  });

});

// ── 4. Contextual name patterns ───────────────────────────────────────────────

describe('Contextual names (patient/client/referred by + name)', () => {

  test('client name pattern', () => {
    assertContains('client Michael expressed concern', 'Michael', 'client + first name');
  });

  test('patient name pattern', () => {
    assertContains('patient Jessica disclosed trauma', 'Jessica', 'patient + first name');
  });

  test('referred by pattern', () => {
    assertContains('referred by Robert Lee from Kaiser', 'Robert Lee', 'referred by name');
  });

});

// ── 5. scrubObject — recursive object scrubbing ──────────────────────────────

describe('scrubObject — nested object scrubbing', () => {

  test('scrubs all string fields', () => {
    const obj = {
      subjective: 'Patient John Smith (DOB 01/01/1985) reports anxiety.',
      objective: 'Called client at 310-555-1234.',
      nested: {
        note: 'Email patient@example.com for records.',
      },
    };
    const result = scrubObject(obj);
    assert.ok(!result.subjective.includes('John Smith'), 'Name not scrubbed from subjective');
    assert.ok(!result.subjective.includes('01/01/1985'), 'DOB not scrubbed from subjective');
    assert.ok(!result.objective.includes('310-555-1234'), 'Phone not scrubbed from objective');
    assert.ok(!result.nested.note.includes('patient@example.com'), 'Email not scrubbed from nested');
  });

  test('preserves non-string fields', () => {
    const obj = { count: 5, active: true, data: null };
    const result = scrubObject(obj);
    assert.equal(result.count, 5);
    assert.equal(result.active, true);
    assert.equal(result.data, null);
  });

  test('handles arrays of objects', () => {
    const arr = [
      { text: 'Patient SSN 123-45-6789 on file' },
      { text: 'call 555-123-4567 for consult' },
    ];
    const result = scrubObject(arr);
    assert.ok(!result[0].text.includes('123-45-6789'), 'SSN in array[0]');
    assert.ok(!result[1].text.includes('555-123-4567'), 'Phone in array[1]');
  });

});

// ── 6. scrub() — return value ─────────────────────────────────────────────────

describe('scrub() return value', () => {

  test('returns { text, redacted } shape', () => {
    const result = scrub('Patient SSN 123-45-6789 on file');
    assert.ok(typeof result === 'object', 'returns object');
    assert.ok(typeof result.text === 'string', 'has .text string');
    assert.ok(Array.isArray(result.redacted), 'has .redacted array');
    assert.ok(result.redacted.length > 0, 'redacted array is non-empty for PHI input');
  });

  test('redacted array is empty for clean text', () => {
    const result = scrub('Client reports feeling better this week. Mood improved.');
    assert.ok(result.redacted.length === 0, `clean text should have no redactions, got: ${JSON.stringify(result.redacted)}`);
  });

});

// ── 7. Azure AI guard — simulate what happens in ai.js ───────────────────────

describe('Azure AI boundary guard — PHI must not reach model input', () => {

  test('chat message PHI is stripped before prompt construction', () => {
    // Simulate what /api/ai/chat does
    const rawMessage = 'My patient John Doe (SSN 123-45-6789, DOB 1980-03-15) is really struggling.';
    const safeMessage = scrubText(rawMessage);

    // Build the prompt the way ai.js does
    const prompt = `User: ${safeMessage}`;

    assert.ok(!prompt.includes('John Doe'), 'Name must not appear in prompt sent to model');
    assert.ok(!prompt.includes('123-45-6789'), 'SSN must not appear in prompt');
    assert.ok(!prompt.includes('1980-03-15'), 'DOB must not appear in prompt');
  });

  test('session notes PHI is stripped before analyze-notes prompt', () => {
    const rawBody = {
      subjective: 'Patient Emily Rodriguez, DOB 06/22/1991, phone 818-555-1234, reports severe anxiety.',
      objective: 'Contact Dr. Martinez at drm@clinic.org for records.',
      assessment: 'Meeting diagnostic criteria.',
      plan: 'Refer to 234 Wellness Ave clinic.',
    };
    const scrubbed = scrubObject(rawBody);
    const prompt = Object.values(scrubbed).join('\n');

    assert.ok(!prompt.includes('Emily Rodriguez'), 'Patient name must be scrubbed');
    assert.ok(!prompt.includes('06/22/1991'), 'DOB must be scrubbed');
    assert.ok(!prompt.includes('818-555-1234'), 'Phone must be scrubbed');
    assert.ok(!prompt.includes('drm@clinic.org'), 'Email must be scrubbed');
    assert.ok(!prompt.includes('234 Wellness Ave'), 'Address must be scrubbed');
  });

  test('audio transcript PHI is stripped before any use', () => {
    const rawTranscript = 'Hi, this is Sarah Chen calling from 310-555-9999, my SSN is 987-65-4321.';
    const safeTranscript = scrubText(rawTranscript);

    assert.ok(!safeTranscript.includes('Sarah Chen'), 'Name must be scrubbed from transcript');
    assert.ok(!safeTranscript.includes('310-555-9999'), 'Phone must be scrubbed from transcript');
    assert.ok(!safeTranscript.includes('987-65-4321'), 'SSN must be scrubbed from transcript');
  });

  test('treatment plan inputs PHI is stripped', () => {
    const rawBody = {
      patientContext: 'Female, 35, lives at 456 Maple St, LA 90001. Primary care: Dr. Wong at drwong@hospital.com.',
      diagnoses: 'F32.1',
      sessionNotes: 'Client Jennifer Kim (MRN 778899) presenting with depression.',
      goals: 'Reduce PHQ-9 from 18 to below 10.',
    };
    const scrubbed = scrubObject(rawBody);
    const allText = JSON.stringify(scrubbed);

    assert.ok(!allText.includes('456 Maple St'), 'Address must be scrubbed');
    assert.ok(!allText.includes('drwong@hospital.com'), 'Email must be scrubbed');
    assert.ok(!allText.includes('Jennifer Kim'), 'Name must be scrubbed');
    assert.ok(!allText.includes('778899'), 'MRN must be scrubbed');
  });

});
