const test = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');

const {
  constraintName,
  getForeignKeys,
  normalizeForeignKeyAction,
} = require('../scripts/migrate-sqlite-to-postgres');

test('getForeignKeys preserves SQLite foreign key metadata for Postgres migration', async () => {
  const SqlJs = await initSqlJs();
  const db = new SqlJs.Database();
  db.run(`
    CREATE TABLE therapists (
      id INTEGER PRIMARY KEY AUTOINCREMENT
    );
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      therapist_id INTEGER NOT NULL REFERENCES therapists(id) ON DELETE CASCADE
    );
  `);

  const foreignKeys = getForeignKeys(db, 'patients');

  assert.equal(foreignKeys.length, 1);
  assert.deepEqual(foreignKeys[0], {
    table: 'patients',
    id: 0,
    referencedTable: 'therapists',
    fromColumns: ['therapist_id'],
    toColumns: ['id'],
    onUpdate: 'NO ACTION',
    onDelete: 'CASCADE',
    name: 'fk_patients_0_therapist_id',
  });

  db.close();
});

test('normalizeForeignKeyAction defaults unknown SQLite actions to NO ACTION', () => {
  assert.equal(normalizeForeignKeyAction('SET NULL'), 'SET NULL');
  assert.equal(normalizeForeignKeyAction('NONE'), 'NO ACTION');
});

test('constraintName keeps generated foreign key names under Postgres length limits', () => {
  const name = constraintName(
    'very_long_table_name_for_client_portal_messages_and_assessments',
    4,
    ['very_long_source_column_name_for_patient_relationship']
  );

  assert.ok(name.length <= 55);
  assert.match(name, /^fk_very_long_table_name/);
});
