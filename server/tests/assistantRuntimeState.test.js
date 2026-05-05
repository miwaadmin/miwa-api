'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  getTherapistAccountState,
} = require(path.join(__dirname, '..', 'services', 'assistantRuntime'));

function fakeDb({ therapist, counts }) {
  const updates = [];
  return {
    updates,
    async get(sql) {
      if (sql.includes('FROM therapists')) return therapist;
      if (sql.includes('FROM patients')) return { c: counts.patients || 0 };
      if (sql.includes('FROM sessions')) return { c: counts.sessions || 0 };
      if (sql.includes('FROM appointments')) return { c: counts.appointments || 0 };
      if (sql.includes('FROM agent_scheduled_tasks')) return { c: counts.scheduledTasks || 0 };
      return null;
    },
    async run(sql) {
      updates.push(sql);
      return { changes: 1 };
    },
  };
}

describe('assistant runtime account state', () => {
  test('infers onboarding complete for established accounts and backfills the flag', async () => {
    const db = fakeDb({
      therapist: {
        id: 7,
        first_name: 'Valdrex',
        full_name: 'Valdrex Provider',
        user_role: 'licensed',
        onboarding_completed: 0,
        soul_markdown: '',
      },
      counts: { patients: 5, sessions: 13, appointments: 1 },
    });

    const state = await getTherapistAccountState(db, 7);
    assert.equal(state.onboarding.completed, true);
    assert.equal(state.onboarding.inferred, true);
    assert.equal(state.onboarding.isEstablished, true);
    assert.equal(db.updates.length, 1);
  });

  test('keeps onboarding incomplete for genuinely empty new accounts', async () => {
    const db = fakeDb({
      therapist: {
        id: 8,
        first_name: 'New',
        full_name: 'New Clinician',
        user_role: 'trainee',
        onboarding_completed: 0,
        soul_markdown: '',
      },
      counts: { patients: 0, sessions: 0, appointments: 0 },
    });

    const state = await getTherapistAccountState(db, 8);
    assert.equal(state.onboarding.completed, false);
    assert.equal(state.onboarding.isEstablished, false);
    assert.equal(db.updates.length, 0);
  });
});
