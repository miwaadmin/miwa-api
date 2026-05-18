const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer, api, bootstrapAdminAndLogin } = require('./_helpers');
const { getAsyncDb } = require('../../db/asyncDb');

function isoDateDaysFromNow(delta) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

test('brief list/save/unsave flow and lazy retention sweep', async (t) => {
  await startTestServer();
  t.after(stopTestServer);

  const { cookie, therapist } = await bootstrapAdminAndLogin({
    email: 'briefs@miwa.test',
    password: 'test-password-1234',
  });
  const db = getAsyncDb();
  await db.run(
    "UPDATE therapists SET preferred_timezone = 'America/Los_Angeles' WHERE id = ?",
    therapist.id,
  );

  const today = isoDateDaysFromNow(0);
  const old = isoDateDaysFromNow(-10);
  const currentInsert = await db.insert(
    `INSERT INTO research_briefs
       (therapist_id, brief_type, title, content, local_date, timezone, saved, created_at)
     VALUES (?, 'daily', 'Today brief', '## Focus\\nStay close to the clinical question.', ?, 'America/Los_Angeles', 0, datetime('now'))`,
    therapist.id,
    today,
  );
  const savedInsert = await db.insert(
    `INSERT INTO research_briefs
       (therapist_id, brief_type, title, content, local_date, timezone, saved, saved_at, created_at)
     VALUES (?, 'daily', 'Saved brief', 'Saved content', ?, 'America/Los_Angeles', 1, datetime('now', '-1 day'), datetime('now', '-1 day'))`,
    therapist.id,
    old,
  );
  const oldUnsavedInsert = await db.insert(
    `INSERT INTO research_briefs
       (therapist_id, brief_type, title, content, local_date, timezone, saved, created_at)
     VALUES (?, 'daily', 'Old unsaved brief', 'Old content', ?, 'America/Los_Angeles', 0, datetime('now', '-10 days'))`,
    therapist.id,
    old,
  );

  const listed = await api('GET', '/api/brief', null, cookie);
  assert.equal(listed.status, 200);
  assert.ok(Array.isArray(listed.body.this_week));
  assert.ok(Array.isArray(listed.body.saved));
  assert.equal(listed.body.this_week.some(brief => brief.id === currentInsert.lastInsertRowid), true);
  assert.equal(listed.body.saved.some(brief => brief.id === savedInsert.lastInsertRowid), true);
  assert.equal(listed.body.this_week.some(brief => brief.id === oldUnsavedInsert.lastInsertRowid), false);

  const swept = await db.get('SELECT id FROM research_briefs WHERE id = ?', oldUnsavedInsert.lastInsertRowid);
  assert.equal(swept, undefined);

  const saved = await api('POST', `/api/brief/${currentInsert.lastInsertRowid}/save`, null, cookie);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.brief.saved, true);
  assert.ok(saved.body.brief.saved_at);

  const unsaved = await api('POST', `/api/brief/${currentInsert.lastInsertRowid}/unsave`, null, cookie);
  assert.equal(unsaved.status, 200);
  assert.equal(unsaved.body.brief.saved, false);
  assert.equal(unsaved.body.brief.saved_at, null);
});
