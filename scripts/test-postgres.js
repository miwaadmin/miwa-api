#!/usr/bin/env node
// One-shot connectivity test for Azure Postgres flexible server.
// Usage:
//   cd miwa-api
//   npm install pg
//   node scripts/test-postgres.js
//
// Reads DATABASE_URL from the environment. Set it in your shell or a local
// .env file before running. Does NOT use dotenv to avoid masking real env
// problems on Azure.

const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: DATABASE_URL is not set in the environment.');
    process.exit(2);
  }

  // Print a redacted form so we can confirm shape without leaking the password.
  const redacted = url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  console.log('Connecting to:', redacted);

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 5000,
    query_timeout: 5000,
  });

  const t0 = Date.now();
  try {
    await client.connect();
    const ms = Date.now() - t0;
    console.log(`Connected in ${ms}ms.`);

    const ver = await client.query('SELECT version() AS version');
    console.log('Server version:', ver.rows[0].version);

    const db = await client.query('SELECT current_database() AS db, current_user AS user');
    console.log('Current database:', db.rows[0].db);
    console.log('Current user:    ', db.rows[0].user);

    const ssl = await client.query("SELECT ssl_is_used() AS ssl");
    console.log('SSL in use:      ', ssl.rows[0].ssl);

    console.log('\nOK — connectivity verified.');
  } catch (err) {
    console.error('\nFAILED:', err.code || '', err.message);
    if (err.message.includes('no pg_hba.conf entry')) {
      console.error('Hint: your client IP is not in the Postgres firewall allow-list.');
    }
    if (err.message.includes('password authentication failed')) {
      console.error('Hint: password in DATABASE_URL is wrong, or needs URL-encoding.');
    }
    if (err.message.includes('database') && err.message.includes('does not exist')) {
      console.error('Hint: create the database first via psql or Azure portal.');
    }
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();
