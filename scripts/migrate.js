#!/usr/bin/env node
// Apply db/schema.sql to the Postgres database pointed to by DATABASE_URL.
// Idempotent — every CREATE TABLE / CREATE INDEX uses IF NOT EXISTS, so this
// is safe to run on every boot and on every deploy.
//
// Usage:
//   $env:DATABASE_URL = "postgresql://...";  node scripts/migrate.js
//
// Exit codes:
//   0 — schema applied successfully
//   1 — connection or SQL error (message printed)
//   2 — DATABASE_URL not set

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: DATABASE_URL is not set in the environment.');
    process.exit(2);
  }

  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error('ERROR: schema file not found at', schemaPath);
    process.exit(1);
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const redacted = url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  console.log('Migrating:', redacted);

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  const t0 = Date.now();
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    const ms = Date.now() - t0;

    const tables = await client.query(`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name
    `);
    console.log(`\nApplied schema in ${ms}ms.`);
    console.log(`Tables now present (${tables.rows.length}):`);
    for (const r of tables.rows) console.log('  -', r.table_name);
    console.log('\nOK.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('\nFAILED:', err.code || '', err.message);
    if (err.position) console.error('  position:', err.position);
    if (err.where) console.error('  where:', err.where);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();
