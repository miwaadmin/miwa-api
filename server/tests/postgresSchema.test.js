const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCreateTableSql,
  parseCreateTables,
  splitTopLevelComma,
  transformColumnDefinition,
} = require('../db/postgresSchema');
const fs = require('fs');
const path = require('path');

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

test('parseCreateTables preserves nested table constraints', () => {
  const tables = parseCreateTables(`
    CREATE TABLE IF NOT EXISTS assistant_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id INTEGER REFERENCES therapists(id),
      skill_key TEXT NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(therapist_id, skill_key)
    );
  `);

  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].definitions.at(-1), 'UNIQUE(therapist_id, skill_key)');
  assert.match(buildCreateTableSql(tables[0]), /UNIQUE\(therapist_id, skill_key\)/);
});

test('assessment_links schema includes client portal delivery columns', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  const assessmentLinks = parseCreateTables(source).find((table) => table.table === 'assessment_links');
  assert.ok(assessmentLinks, 'assessment_links table should be parsed from db.js');

  const definitionText = assessmentLinks.definitions.join('\n');
  assert.match(definitionText, /\bclient_account_id\b/);
  assert.match(definitionText, /\bassigned_via\b/);
  assert.match(definitionText, /\bdue_at\b/);
  assert.match(definitionText, /\bassigned_by_therapist_id\b/);
});

test('patients schema includes notification preference columns', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  const patients = parseCreateTables(source).find((table) => table.table === 'patients');
  assert.ok(patients, 'patients table should be parsed from db.js');

  const definitionText = patients.definitions.join('\n');
  assert.match(definitionText, /\bphone\b/);
  assert.match(definitionText, /\bemail\b/);
  assert.match(definitionText, /\bpreferred_contact_method\b/);
  assert.match(definitionText, /\bsms_consent\b/);
});
