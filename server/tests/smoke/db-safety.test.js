/**
 * Direct unit tests for the db.js safety guards we added in response to
 * the 2026-04-18 data-loss incident. These don't go through the HTTP layer
 * — they exercise initDb() and persist() directly with synthetic file
 * contents.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function freshDir() {
  const d = path.join(os.tmpdir(), 'miwa-db-safety', `${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

test('boot integrity check refuses corrupted DB file', async () => {
  const dir = freshDir();
  const dbPath = path.join(dir, 'mftbrain.db');
  // Write a non-trivial file that is NOT a valid SQLite database
  fs.writeFileSync(dbPath, Buffer.from('this is not a sqlite file at all but it has bytes'));

  // Re-require db.js with a fresh module cache so DB_PATH is read fresh
  delete require.cache[require.resolve('../../db')];
  process.env.DB_PATH = dbPath;
  const db = require('../../db');

  await assert.rejects(
    db.initDb(),
    /does not look like a valid SQLite file|Refusing to start/i,
  );

  // Original (bad) bytes must still be on disk — initDb must NOT have
  // overwritten them. This is the exact regression that ate prod.
  const after = fs.readFileSync(dbPath);
  assert.ok(after.toString('utf8').startsWith('this is not a sqlite file'));
});

test('persist() refuses to write a snapshot dramatically smaller than current file', async () => {
  const dir = freshDir();
  const dbPath = path.join(dir, 'mftbrain.db');

  // Reset module cache, then init normally so the file is created legit
  delete require.cache[require.resolve('../../db')];
  process.env.DB_PATH = dbPath;
  process.env.ALLOW_DB_SHRINK = '';
  const db = require('../../db');
  await db.initDb();
  const initialSize = fs.statSync(dbPath).size;
  assert.ok(initialSize > 0, 'initial DB file should exist with bytes');

  // Now simulate the original failure mode: replace the on-disk file with
  // a much LARGER fake-but-valid SQLite file, then call persist(). The
  // shrink guard should refuse to write the (smaller) in-memory snapshot
  // over the (larger) on-disk file.
  const fakeBig = Buffer.concat([
    Buffer.from('SQLite format 3\0'),
    Buffer.alloc(initialSize * 4, 0xff),
  ]);
  fs.writeFileSync(dbPath, fakeBig);
  const beforeSize = fs.statSync(dbPath).size;

  db.persist(); // would normally write the small in-memory DB

  const afterSize = fs.statSync(dbPath).size;
  assert.equal(afterSize, beforeSize, 'shrink guard must refuse the write');
});

test('ALLOW_DB_SHRINK=true overrides the shrink guard', async () => {
  const dir = freshDir();
  const dbPath = path.join(dir, 'mftbrain.db');

  delete require.cache[require.resolve('../../db')];
  process.env.DB_PATH = dbPath;
  process.env.ALLOW_DB_SHRINK = 'true';
  const db = require('../../db');
  await db.initDb();
  const initialSize = fs.statSync(dbPath).size;

  const fakeBig = Buffer.concat([
    Buffer.from('SQLite format 3\0'),
    Buffer.alloc(initialSize * 4, 0xff),
  ]);
  fs.writeFileSync(dbPath, fakeBig);

  db.persist(); // override is set → write should go through

  const afterSize = fs.statSync(dbPath).size;
  assert.ok(afterSize <= initialSize * 2, 'with override, persist should write the smaller in-memory snapshot');

  // Cleanup the override so it doesn't leak into other tests
  process.env.ALLOW_DB_SHRINK = '';
});

test('persist() recreates missing DB parent directory', async () => {
  const dir = freshDir();
  const nested = path.join(dir, 'missing-parent');
  const dbPath = path.join(nested, 'mftbrain.db');

  delete require.cache[require.resolve('../../db')];
  process.env.DB_PATH = dbPath;
  process.env.ALLOW_DB_SHRINK = '';
  const db = require('../../db');
  await db.initDb();

  fs.rmSync(nested, { recursive: true, force: true });
  assert.equal(fs.existsSync(nested), false);

  db.persist();

  assert.equal(fs.existsSync(dbPath), true);
  assert.ok(fs.statSync(dbPath).size > 0);
});
