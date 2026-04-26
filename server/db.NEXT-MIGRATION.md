# Database engine migration — next structural improvement

## What we use today

- **`sql.js`** — SQLite compiled to WebAssembly, runs entirely in memory.
- **Persistence model:** every mutation calls `persist()`, which serializes
  the *entire* in-memory database with `db.export()` and writes the whole
  file to `/data/mftbrain.db`. ~500 KB today, will scale linearly with
  patient count.

## Why this is dangerous

The "rewrite the whole file on every persist" model has structural failure
modes that no amount of defensive coding fully eliminates:

1. **Torn writes during SIGTERM.** Cloud redeploys can SIGTERM the container.
   If a `persist()` write is mid-flight, the file ends up partially old,
   partially new. We mitigated this with atomic temp-file + rename in
   `persist()`, but the underlying model is the root cause.
2. **In-memory state is the source of truth.** If anything bad gets into the
   in-memory DB (a buggy migration, a bad query, an OOM that loses pages),
   the next `persist()` saves that bad state over the good file. Today's
   shrink-protection guard catches the worst case but not subtle corruption.
3. **No incremental durability.** Between persists, you lose any in-flight
   writes if the process crashes. Our cron jobs and SMS schedulers can
   produce minutes of unpersisted state if the DB hasn't been touched.
4. **Concurrent writes are serialised through a single Node process.** Fine
   today (small caseload), structurally limiting at scale.

## Two paths forward

### Option A — `better-sqlite3`

Drop-in replacement for `sql.js` that talks to native SQLite via the actual
file. Writes are real `INSERT/UPDATE` calls into the file with WAL mode, so
torn writes become impossible by construction. Same SQL, same data file
format (we can copy `mftbrain.db` straight over). Synchronous API matches
how we already use the DB.

**Effort:** ~1 day. Replace the wrapper in `server/db.js`. Every `db.run`,
`db.get`, `db.all` call elsewhere in the codebase keeps working with
near-zero changes (the API surface is intentionally similar).

**Wins:**
- Eliminates the "in-memory + full-file write" failure class entirely
- WAL mode adds crash safety: writes are journalled before being committed
- `BEGIN/COMMIT` transactions become free and meaningful

**Tradeoffs:**
- Native compile step on managed app hosts (well-documented, usually straightforward)
- Backup format stays the same (still a SQLite file), so all our
  encryption/restore tooling carries over unchanged

### Option B — PostgreSQL (Azure-managed)

Migrate to Azure Database for PostgreSQL Flexible Server. Real production-grade
DB. Backups, point-in-time recovery, replication, and encryption become managed
Azure infrastructure under the Microsoft BAA instead of app-container file
management.

**Effort:** ~2-4 days. Schema port, every query reviewed for SQLite-isms
(`AUTOINCREMENT` → `SERIAL`, `datetime('now')` → `NOW()`, etc.), connection
pooling, migrations re-tooled.

**Wins:**
- Stops being a single-node DB; survives container restarts trivially
- Azure handles PITR + snapshots
- Concurrent reads/writes
- Standard observability tools work

**Tradeoffs:**
- Much bigger migration than (A)
- Adds a network hop on every query (~1ms latency)
- `sql.js`-style backup encryption code needs to be rewritten for Postgres
  dump format

## Recommendation

**For a pre-launch HIPAA cutover, do (B) now.** If preserving legacy data were
the priority, (A) would be the fastest durability upgrade. Since Miwa is still
pre-launch and the old records are disposable, the cleaner long-term move is
Azure PostgreSQL before clinicians begin storing real PHI.

## What's already in place (stop-gap before migration)

These mitigations make the current `sql.js` setup safe enough to operate:

- Atomic persist (temp file + fsync + rename) — `db.js#persist()`
- SQLite-magic-header check on boot — `db.js#initDb()`
- Shrink-protection (refuses to write a snapshot >50% smaller than current
  file) — `db.js#persist()`
- Verified encrypted backups every night — `services/backup.js`
- Failure-alert email if backups throw — `services/backup.js`
- Manual "Backup now" button in admin panel
- CLI restore tool — `scripts/restore-backup.js`
