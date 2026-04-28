const { Pool } = require('pg');
const { getDb, initDb, persist } = require('../db');
const { createPostgresAdapter } = require('./postgresAdapter');
const { applyPostgresSchema } = require('./postgresSchema');

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

async function initAsyncDb() {
  if (!wantsPostgres()) return initDb();

  const db = getAsyncDb();
  await db.get('SELECT 1 AS ok');
  await applyPostgresSchema(db);
  return db;
}

async function persistIfNeeded(options) {
  if (wantsPostgres()) return;
  persist(options);
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
  initAsyncDb,
  persistIfNeeded,
  wantsPostgres,
};
