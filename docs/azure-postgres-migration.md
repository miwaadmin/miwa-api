# Azure PostgreSQL Migration Runbook

Miwa currently runs on a SQLite file through `sql.js`. That was acceptable for
the Railway prototype, but the production HIPAA direction should be Azure
Database for PostgreSQL Flexible Server under the Microsoft BAA.

This runbook keeps PHI out of Git. Do not commit database files, exports, or
connection strings.

## Current Status

As of May 9, 2026, the application runtime is routed through
`server/db/asyncDb.js`. When `DB_PROVIDER=postgres`, that layer creates a
PostgreSQL pool, applies the Postgres schema sync, and skips SQLite persistence.
Do not flip production to Postgres until the data copy and verification gates
below pass.

## Target Azure Service

Use Azure Database for PostgreSQL Flexible Server in the same Azure resource
group and region as the app:

- Resource group: `miwa-prod-hipaa-rg`
- Region: `West US 2`
- Backups: enable automatic backups and point-in-time restore
- Network: require SSL; start with public access restricted to App Service
  outbound addresses if private networking is not configured yet

## App Settings

Set these in Azure App Service configuration, not in Git:

```text
DATABASE_URL=postgres://USER:PASSWORD@HOST.postgres.database.azure.com:5432/miwa?sslmode=require
PGSSLMODE=require
# Set DB_PROVIDER=postgres only after the runtime adapter cutover is complete.
DB_PROVIDER=postgres
```

Keep `DB_PATH=/home/data/mftbrain.db` only while the SQLite runtime is still
active or while performing the one-time migration.

## Safe Local Preflight

From the Azure repo root:

```bash
npm install
npm run postgres:migrate:dry-run
npm run postgres:verify -- --dry-run
npm test
npm run build
```

The dry runs only read the local SQLite database and print table names, column
counts, row counts, and foreign key counts. They do not send PHI anywhere.

If Docker or a local PostgreSQL server is available, do a non-production restore
before touching Azure:

```bash
set SQLITE_DB_PATH=C:\path\to\local-copy-of-mftbrain.db
set DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/miwa_dry_run
set PGSSLMODE=disable
set MIGRATION_CONFIRM=copy-miwa-sqlite-to-postgres
npm run postgres:migrate -- --wipe-target
npm run postgres:verify
```

This catches schema, data type, identity, and foreign key issues before the
production window.

## Production Backup Gate

Before copying data, preserve the current SQLite file as the rollback artifact.
The expected App Service path is usually:

```text
/home/data/mftbrain.db
```

Download or copy that file to a secure location outside the App Service
container. Keep it for at least 7 days after cutover. Do not proceed if the
file cannot be copied and opened.

Minimum backup checks:

- File exists and has a plausible size.
- File opens with SQLite tooling or Miwa's dry-run scripts.
- The backup timestamp, source path, and file size are recorded outside Git.

## One-Time Data Copy

Run this only from a trusted machine that has the current SQLite database and
the Azure PostgreSQL connection string available as environment variables:

```bash
set SQLITE_DB_PATH=C:\path\to\mftbrain.db
set DATABASE_URL=postgres://USER:PASSWORD@HOST.postgres.database.azure.com:5432/miwa?sslmode=require
set PGSSLMODE=require
set MIGRATION_CONFIRM=copy-miwa-sqlite-to-postgres
npm run postgres:migrate -- --wipe-target
```

`--wipe-target` drops the target tables first. Use it only for the initial
fresh Postgres load.

## Verify Copy Integrity

After the one-time copy, compare table existence, column presence, row counts,
and foreign key constraints without printing PHI:

```bash
set SQLITE_DB_PATH=C:\path\to\mftbrain.db
set DATABASE_URL=postgres://USER:PASSWORD@HOST.postgres.database.azure.com:5432/miwa?sslmode=require
set PGSSLMODE=require
npm run postgres:verify
```

The verifier exits non-zero if tables are missing, columns are missing, row
counts differ, or expected foreign key constraints are missing. It does not
print row data or secrets.

## Runtime Cutover Gate

Only after `npm run postgres:verify` returns `status: "ok"`:

1. In Azure App Service configuration, add or confirm:
   - `DATABASE_URL`
   - `PGSSLMODE=require`
   - `DB_PROVIDER=postgres`
2. Restart the App Service.
3. Hit `/api/health`.
4. Log in with a known migrated account.
5. Confirm patient list, a patient chart, a session note, assessment links, and
   client portal routes load.
6. Watch logs for database errors for at least 10 minutes.

Do not delete `DB_PATH` until the rollback window has passed.

## Rollback

Rollback is simplest before any new production writes happen in Postgres.

If smoke tests fail immediately after the App Service restart:

1. Set `DB_PROVIDER=sqlite` in App Service configuration.
2. Confirm `DB_PATH` still points to the preserved SQLite file.
3. Restart App Service.
4. Log in and verify the same smoke-test paths.
5. Leave the Postgres database untouched for diagnosis.

If clinicians used the app after the Postgres flip, pause before rollback and
decide whether those writes need to be exported or replayed. Do not blindly
switch back after meaningful new Postgres writes.

## Secure Helper Script

For interactive use from PowerShell, the secure wrapper prompts for the
Postgres password and avoids writing the connection string to disk:

```powershell
.\server\scripts\postgres-secure.ps1 -Action check
.\server\scripts\postgres-secure.ps1 -Action migrate -WipeTarget
.\server\scripts\postgres-secure.ps1 -Action verify
```

The wrapper does not flip App Service settings. That remains a manual cutover
gate.
