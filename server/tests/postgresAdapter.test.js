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
