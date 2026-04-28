const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCreateTableSql,
  parseCreateTables,
  splitTopLevelComma,
  transformColumnDefinition,
} = require('../db/postgresSchema');

test('splitTopLevelComma ignores commas inside defaults and constraints', () => {
  assert.deepEqual(
    splitTopLevelComma("id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT DEFAULT '{}', UNIQUE(therapist_id, category, key)"),
    [
      'id INTEGER PRIMARY KEY AUTOINCREMENT',
      "value TEXT DEFAULT '{}'",
      'UNIQUE(therapist_id, category, key)',
    ],
  );
});

test('transformColumnDefinition converts SQLite id and datetime columns', () => {
  assert.equal(
    transformColumnDefinition('id INTEGER PRIMARY KEY AUTOINCREMENT'),
    'id SERIAL PRIMARY KEY',
  );
  assert.equal(
    transformColumnDefinition('created_at DATETIME DEFAULT CURRENT_TIMESTAMP'),
    'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
  );
});

test('parseCreateTables extracts table definitions from SQLite schema source', () => {
  const tables = parseCreateTables(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(client_id)
    );
  `);

  assert.equal(tables.length, 1);
  assert.equal(tables[0].table, 'patients');
  assert.match(buildCreateTableSql(tables[0]), /id SERIAL PRIMARY KEY/);
  assert.match(buildCreateTableSql(tables[0]), /created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP/);
});
