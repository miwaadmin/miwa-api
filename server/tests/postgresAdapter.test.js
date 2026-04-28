const test = require('node:test');
const assert = require('node:assert/strict');

const {
  appendReturningId,
  createPostgresAdapter,
  translateSqliteSql,
} = require('../db/postgresAdapter');

test('translateSqliteSql converts positional placeholders without touching quoted text', () => {
  const sql = "SELECT * FROM patients WHERE id = ? AND note = '?' AND name = ?";
  assert.equal(
    translateSqliteSql(sql),
    "SELECT * FROM patients WHERE id = $1 AND note = '?' AND name = $2"
  );
});

test('translateSqliteSql converts sqlite datetime now helper', () => {
  assert.equal(
    translateSqliteSql("UPDATE patients SET updated_at = datetime('now') WHERE id = ?"),
    'UPDATE patients SET updated_at = CURRENT_TIMESTAMP WHERE id = $1'
  );
});

test('translateSqliteSql converts sqlite date now helpers used by dashboard queries', () => {
  assert.equal(
    translateSqliteSql("SELECT date('now') AS today, date('now', '-7 days') AS week_start WHERE therapist_id = ?"),
    "SELECT CURRENT_DATE AS today, (CURRENT_DATE - INTERVAL '7 days') AS week_start WHERE therapist_id = $1"
  );
});

test('translateSqliteSql converts date casts on timestamp/text columns', () => {
  assert.equal(
    translateSqliteSql('SELECT * FROM appointments WHERE DATE(scheduled_start) = ? AND date(created_at) >= ?'),
    'SELECT * FROM appointments WHERE (scheduled_start::date) = $1 AND (created_at::date) >= $2'
  );
});

test('translateSqliteSql converts sqlite collation and datetime range helpers', () => {
  assert.equal(
    translateSqliteSql("SELECT * FROM contacts WHERE created_at >= datetime('now', '-30 days') ORDER BY name COLLATE NOCASE ASC"),
    "SELECT * FROM contacts WHERE created_at >= (CURRENT_TIMESTAMP - INTERVAL '30 days') ORDER BY name ASC"
  );
});

test('translateSqliteSql converts sqlite start-of-month helper', () => {
  assert.equal(
    translateSqliteSql("SELECT * FROM cost_events WHERE created_at >= date('now', 'start of month') AND therapist_id = ?"),
    "SELECT * FROM cost_events WHERE created_at >= date_trunc('month', CURRENT_DATE) AND therapist_id = $1"
  );
});

test('translateSqliteSql converts parameterized relative datetime helpers', () => {
  assert.equal(
    translateSqliteSql("SELECT * FROM appointments WHERE scheduled_start BETWEEN datetime('now', '+' || ? || ' minutes') AND datetime('now', '+' || ? || ' minutes')"),
    "SELECT * FROM appointments WHERE scheduled_start BETWEEN (CURRENT_TIMESTAMP + ($1::int * INTERVAL '1 minute')) AND (CURRENT_TIMESTAMP + ($2::int * INTERVAL '1 minute'))"
  );
  assert.equal(
    translateSqliteSql("SELECT * FROM patients WHERE last_session_date < datetime('now', '-' || ? || ' days')"),
    "SELECT * FROM patients WHERE last_session_date < (CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day'))"
  );
});

test('translateSqliteSql converts concrete relative datetime helpers', () => {
  assert.equal(
    translateSqliteSql("INSERT INTO assessment_links (expires_at) VALUES (datetime('now', '+30 days'))"),
    "INSERT INTO assessment_links (expires_at) VALUES ((CURRENT_TIMESTAMP + INTERVAL '30 days'))"
  );
  assert.equal(
    translateSqliteSql("SELECT * FROM research_briefs WHERE created_at > datetime('now', '-24 hours')"),
    "SELECT * FROM research_briefs WHERE created_at > (CURRENT_TIMESTAMP - INTERVAL '24 hours')"
  );
});

test('translateSqliteSql converts datetime anchored to a bound timestamp', () => {
  assert.equal(
    translateSqliteSql("INSERT INTO checkin_links (created_at, expires_at) VALUES (?, datetime(?,'+7 days'))"),
    "INSERT INTO checkin_links (created_at, expires_at) VALUES ($1, ($2::timestamp + INTERVAL '7 days'))"
  );
});

test('translateSqliteSql converts julianday comparison helpers', () => {
  assert.equal(
    translateSqliteSql("SELECT ABS(JULIANDAY(a.administered_at) - JULIANDAY(COALESCE(s.session_date, s.created_at))) <= 3"),
    "SELECT ABS((EXTRACT(EPOCH FROM a.administered_at::timestamp) / 86400) - (EXTRACT(EPOCH FROM COALESCE(s.session_date, s.created_at)::timestamp) / 86400)) <= 3"
  );
});

test('translateSqliteSql converts simple json_extract lookups', () => {
  assert.equal(
    translateSqliteSql("SELECT * FROM agent_actions WHERE json_extract(payload_json, '$.patientId') = ?"),
    "SELECT * FROM agent_actions WHERE (payload_json::jsonb ->> 'patientId') = $1"
  );
});

test('translateSqliteSql converts SQLite empty double-string literal in COALESCE', () => {
  assert.equal(
    translateSqliteSql('SELECT lower(coalesce(t.full_name, "")) LIKE ?'),
    "SELECT lower(COALESCE(t.full_name, '')) LIKE $1"
  );
});

test('translateSqliteSql casts mixed text/timestamp COALESCE date ordering', () => {
  assert.equal(
    translateSqliteSql('ORDER BY COALESCE(session_date, created_at) DESC'),
    "ORDER BY COALESCE(NULLIF(session_date, '')::timestamp, created_at::timestamp) DESC"
  );
  assert.equal(
    translateSqliteSql('ORDER BY COALESCE(a.scheduled_start, a.created_at) DESC'),
    "ORDER BY COALESCE(NULLIF(a.scheduled_start, '')::timestamp, a.created_at::timestamp) DESC"
  );
});

test('appendReturningId adds RETURNING id to inserts only once', () => {
  assert.equal(
    appendReturningId('INSERT INTO patients (client_id) VALUES (?)'),
    'INSERT INTO patients (client_id) VALUES (?) RETURNING id'
  );
  assert.equal(
    appendReturningId('INSERT INTO patients (client_id) VALUES (?) RETURNING id'),
    'INSERT INTO patients (client_id) VALUES (?) RETURNING id'
  );
});

test('postgres adapter preserves get/all/insert result shapes', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/RETURNING id/i.test(sql)) return { rows: [{ id: 42 }] };
      if (/LIMIT 1/i.test(sql)) return { rows: [{ id: 7, email: 'test@example.com' }] };
      return { rows: [{ id: 1 }, { id: 2 }] };
    },
  };
  const db = createPostgresAdapter(pool);

  assert.deepEqual(await db.all('SELECT * FROM patients WHERE therapist_id = ?', 5), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(await db.get('SELECT * FROM therapists WHERE id = ? LIMIT 1', 7), { id: 7, email: 'test@example.com' });
  assert.deepEqual(await db.insert('INSERT INTO patients (client_id) VALUES (?)', 'C-1'), { lastInsertRowid: 42 });

  assert.deepEqual(calls.map((call) => call.sql), [
    'SELECT * FROM patients WHERE therapist_id = $1',
    'SELECT * FROM therapists WHERE id = $1 LIMIT 1',
    'INSERT INTO patients (client_id) VALUES ($1) RETURNING id',
  ]);
});
