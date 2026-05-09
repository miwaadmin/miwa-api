require('../lib/loadEnv').loadEnv();

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { Pool } = require('pg');
const {
  getForeignKeys,
} = require('./migrate-sqlite-to-postgres');

const repoRoot = path.join(__dirname, '..', '..');
const sqlitePath = process.env.SQLITE_DB_PATH
  || process.env.DB_PATH
  || path.join(repoRoot, 'mftbrain.db');

const dryRun = process.argv.includes('--dry-run');
const help = process.argv.includes('--help') || process.argv.includes('-h');

function usage() {
  console.log(`
Usage:
  npm run postgres:verify -- --dry-run
  npm run postgres:verify

Environment:
  SQLITE_DB_PATH   Path to source SQLite DB. Defaults to DB_PATH or ./mftbrain.db.
  DATABASE_URL     Azure PostgreSQL connection string. Required unless --dry-run.
  PGSSLMODE        Use "require" for Azure PostgreSQL.

Output:
  Verifies table existence, column presence, row counts, and foreign key constraints.
  Does not print row data, PHI, connection strings, or secrets.
`.trim());
}

function sslConfig() {
  if (String(process.env.PGSSLMODE || '').toLowerCase() === 'disable') return false;
  return { rejectUnauthorized: false };
}

function ident(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function getRows(sqliteDb, sql, params = []) {
  const stmt = sqliteDb.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function getTables(sqliteDb) {
  return getRows(
    sqliteDb,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).map((row) => row.name);
}

function getColumns(sqliteDb, table) {
  return getRows(sqliteDb, `PRAGMA table_info(${ident(table)})`).map((row) => row.name);
}

function getSqliteCount(sqliteDb, table) {
  return Number(getRows(sqliteDb, `SELECT COUNT(*) AS count FROM ${ident(table)}`)[0]?.count || 0);
}

async function getPostgresColumns(pg, table) {
  const result = await pg.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table]
  );
  return result.rows.map((row) => row.column_name);
}

async function getPostgresCount(pg, table) {
  const result = await pg.query(`SELECT COUNT(*)::bigint AS count FROM ${ident(table)}`);
  return Number(result.rows[0]?.count || 0);
}

async function getPostgresForeignKeys(pg, table) {
  const result = await pg.query(
    `SELECT con.conname AS name
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = con.connamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = $1
        AND con.contype = 'f'
      ORDER BY con.conname`,
    [table]
  );
  return result.rows.map((row) => row.name);
}

async function verifyTable(pg, sqliteDb, table) {
  const sqliteColumns = getColumns(sqliteDb, table);
  const postgresColumns = await getPostgresColumns(pg, table);
  const missingColumns = sqliteColumns.filter((col) => !postgresColumns.includes(col));
  const expectedForeignKeys = getForeignKeys(sqliteDb, table).map((fk) => fk.name);
  const postgresForeignKeys = await getPostgresForeignKeys(pg, table);
  const missingForeignKeys = expectedForeignKeys.filter((name) => !postgresForeignKeys.includes(name));

  let postgresRows = null;
  let rowCountMatches = false;
  const sqliteRows = getSqliteCount(sqliteDb, table);

  if (postgresColumns.length > 0) {
    postgresRows = await getPostgresCount(pg, table);
    rowCountMatches = sqliteRows === postgresRows;
  }

  return {
    table,
    exists: postgresColumns.length > 0,
    sqliteRows,
    postgresRows,
    rowCountMatches,
    sqliteColumns: sqliteColumns.length,
    postgresColumns: postgresColumns.length,
    missingColumns,
    expectedForeignKeys: expectedForeignKeys.length,
    postgresForeignKeys: postgresForeignKeys.length,
    missingForeignKeys,
  };
}

async function main() {
  if (help) {
    usage();
    return;
  }

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at ${sqlitePath}`);
  }

  const SqlJs = await initSqlJs();
  const sqliteDb = new SqlJs.Database(fs.readFileSync(sqlitePath));
  const tables = getTables(sqliteDb);

  if (dryRun) {
    const summary = tables.map((table) => ({
      table,
      columns: getColumns(sqliteDb, table).length,
      rows: getSqliteCount(sqliteDb, table),
      foreignKeys: getForeignKeys(sqliteDb, table).length,
    }));
    console.log(JSON.stringify({ status: 'dry-run', sqlitePath, tables: summary }, null, 2));
    sqliteDb.close();
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required unless --dry-run is used.');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslConfig(),
    max: 2,
  });

  try {
    const results = [];
    for (const table of tables) {
      results.push(await verifyTable(pool, sqliteDb, table));
    }

    const failures = results.filter((item) => (
      !item.exists
        || item.missingColumns.length > 0
        || item.missingForeignKeys.length > 0
        || !item.rowCountMatches
    ));

    console.log(JSON.stringify({
      status: failures.length ? 'mismatch' : 'ok',
      provider: 'azure-postgresql',
      sqlitePath,
      tablesChecked: results.length,
      failures,
      results,
    }, null, 2));

    if (failures.length) process.exitCode = 1;
  } finally {
    sqliteDb.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    status: 'error',
    provider: 'azure-postgresql',
    message: err.message,
  }, null, 2));
  process.exit(1);
});
