'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../services/document-generator');

test('clinical letter formatter uses the current therapist schema for letterhead', () => {
  const chartText = _test.formatChartPacket({
    patient: {
      client_id: 'MIWA-TEST',
      display_name: 'Test Client',
      date_of_birth: '2000-01-01',
      diagnoses: 'F41.1 Generalized anxiety disorder',
    },
    therapist: {
      full_name: 'Valdrex Philippe',
      first_name: 'Valdrex',
      last_name: 'Philippe',
      email: 'clinician@example.test',
      credential_type: 'licensed',
      credential_number: 'LMFT12345',
      agency_name: 'Miwa Practice',
    },
    sessionAgg: { total_sessions: 4, first_session_date: '2026-01-05', last_session_date: '2026-02-02' },
    recentSessions: [],
    latestAssessments: [],
    activePlan: null,
  });

  assert.match(chartText, /Name: Valdrex Philippe, LMFT12345/);
  assert.match(chartText, /Credential\/license: LMFT12345/);
  assert.match(chartText, /Practice\/site: Miwa Practice/);
  assert.match(chartText, /Email: clinician@example\.test/);
  assert.doesNotMatch(chartText, /undefined/);
});
