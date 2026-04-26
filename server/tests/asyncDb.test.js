const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PROVIDER = 'postgres';
delete process.env.DATABASE_URL;

const { initAsyncDb } = require('../db/asyncDb');

test('Postgres startup path fails on missing DATABASE_URL without calling SQLite init', async () => {
  await assert.rejects(
    initAsyncDb(),
    /DATABASE_URL is required when DB_PROVIDER=postgres/
  );
});
