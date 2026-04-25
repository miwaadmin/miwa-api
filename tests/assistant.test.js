'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  DEFAULT_ASSISTANT_PROFILE,
  parseAssistantPermissions,
  normalizeAssistantProfile,
  buildAssistantAddendum,
  applyAssistantPayloadUpdates,
} = require(path.join(__dirname, '..', 'lib', 'assistant'));

describe('assistant profile helpers', () => {
  test('defaults are safe and clinician-oriented', () => {
    assert.equal(DEFAULT_ASSISTANT_PROFILE.action_mode, 'draft_only');
    assert.equal(DEFAULT_ASSISTANT_PROFILE.verbosity, 'balanced');
    assert.ok(Array.isArray(DEFAULT_ASSISTANT_PROFILE.permissions));
    assert.ok(DEFAULT_ASSISTANT_PROFILE.permissions.includes('patient_context'));
  });

  test('parses permissions from arrays, JSON strings, and comma lists', () => {
    assert.deepEqual(parseAssistantPermissions(['history', 'documents', 'bogus']), ['history', 'documents']);
    assert.deepEqual(parseAssistantPermissions('["session_context","patient_context"]'), ['session_context', 'patient_context']);
    assert.deepEqual(parseAssistantPermissions('history, patient_context, invalid'), ['history', 'patient_context']);
  });

  test('normalizes a row into assistant profile fields', () => {
    const profile = normalizeAssistantProfile({
      assistant_action_mode: 'approve_to_act',
      assistant_tone: 'direct',
      assistant_orientation: 'family-systems',
      assistant_verbosity: 'concise',
      assistant_memory: 'Prefer brief bullets.',
      assistant_permissions_json: '["history","documents"]',
    });

    assert.equal(profile.action_mode, 'approve_to_act');
    assert.equal(profile.tone, 'direct');
    assert.equal(profile.orientation, 'family-systems');
    assert.equal(profile.verbosity, 'concise');
    assert.equal(profile.memory, 'Prefer brief bullets.');
    assert.deepEqual(profile.permissions, ['history', 'documents']);
  });

  test('builds prompt addendum with mode, tone, and permission scope', () => {
    const addendum = buildAssistantAddendum({
      action_mode: 'read_only',
      tone: 'warm and clinical',
      orientation: 'cbt',
      verbosity: 'detailed',
      memory: 'Prefer a structured outline.',
      permissions: ['history', 'patient_context'],
    }, { userRole: 'trainee', therapistName: 'Val', responseStyle: 'concise' });

    assert.match(addendum, /PERSONALIZED ASSISTANT CONTEXT/);
    assert.match(addendum, /operate in read-only mode/i);
    assert.match(addendum, /warm and clinical/i);
    assert.match(addendum, /Allowed scopes: history, patient_context/);
    assert.match(addendum, /Val/);
    assert.match(addendum, /trainee/i);
  });

  test('applies payload updates without clobbering existing fields', () => {
    const next = applyAssistantPayloadUpdates({
      assistant_action_mode: 'draft_only',
      assistant_tone: 'calm',
      assistant_orientation: 'integrative',
      assistant_verbosity: 'balanced',
      assistant_memory: 'Old note',
      assistant_permissions_json: '["history"]',
    }, {
      assistant_tone: 'direct',
      assistant_permissions: ['documents', 'history'],
    });

    assert.equal(next.assistant_action_mode, 'draft_only');
    assert.equal(next.assistant_tone, 'direct');
    assert.equal(next.assistant_orientation, 'integrative');
    assert.equal(next.assistant_verbosity, 'balanced');
    assert.equal(next.assistant_memory, 'Old note');
    assert.equal(next.assistant_permissions_json, '["documents","history"]');
  });
});
