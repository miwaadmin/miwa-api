const { Pool } = require('pg');
const { getDb, persist } = require('../db');
const { createPostgresAdapter } = require('./postgresAdapter');

let pgPool;
let pgAdapter;

function wantsPostgres() {
  return ['postgres', 'postgresql'].includes(String(process.env.DB_PROVIDER || '').toLowerCase());
}

function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when DB_PROVIDER=postgres');
  }

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: String(process.env.PGSSLMODE || '').toLowerCase() === 'require'
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

function getAsyncDb() {
  if (!wantsPostgres()) return getDb();

  if (!pgAdapter) {
    pgPool = pgPool || createPool();
    pgAdapter = createPostgresAdapter(pgPool);
  }

  return pgAdapter;
}

async function persistIfNeeded() {
  if (wantsPostgres()) return;
  persist();
}

async function closeAsyncDb() {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
    pgAdapter = null;
  }
}

module.exports = {
  closeAsyncDb,
  getAsyncDb,
  persistIfNeeded,
  wantsPostgres,
};
