'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  ACTION_KINDS,
  createAssistantAction,
  emitAssistantAction,
  validateAssistantAction,
} = require(path.join(__dirname, '..', 'lib', 'assistantActions'));

describe('assistant action schema', () => {
  test('allows the clinical workflow MVP action kinds', () => {
    assert.ok(ACTION_KINDS.includes('show_client'));
    assert.ok(ACTION_KINDS.includes('schedule_picker'));
    assert.ok(ACTION_KINDS.includes('risk_review'));
    assert.ok(ACTION_KINDS.includes('assessment_batch_preview'));
    assert.ok(ACTION_KINDS.includes('create_follow_up_task'));
    assert.ok(ACTION_KINDS.includes('prepare_session'));
  });

  test('creates a valid action with safe defaults', () => {
    const action = createAssistantAction('risk_review', {
      title: 'Review scores',
      payload: { clientId: 'DEMO-ABC123', assessments: [] },
    });
    assert.equal(action.kind, 'risk_review');
    assert.equal(action.status, 'ready');
    assert.equal(validateAssistantAction(action).ok, true);
  });

  test('rejects unknown action kinds and malformed payloads', () => {
    const validation = validateAssistantAction({
      kind: 'replace_chat_stack',
      title: 'Nope',
      status: 'ready',
      payload: [],
    });
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join(' '), /unsupported action kind/);
    assert.match(validation.errors.join(' '), /payload must be an object/);
  });

  test('emits valid actions as SSE payloads only', () => {
    const sent = [];
    const valid = createAssistantAction('show_client', {
      title: 'Client profile',
      payload: { patientId: 1, clientId: 'DEMO-ABC123' },
    });
    assert.equal(emitAssistantAction(payload => sent.push(payload), valid), true);
    assert.deepEqual(sent[0], { type: 'assistant_action', action: valid });

    assert.equal(emitAssistantAction(payload => sent.push(payload), { kind: 'bad', title: '' }), false);
    assert.equal(sent.length, 1);
  });
});
