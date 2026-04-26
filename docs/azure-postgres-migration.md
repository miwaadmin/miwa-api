# Azure PostgreSQL Migration Runbook

Miwa currently runs on a SQLite file through `sql.js`. That was acceptable for
the Railway prototype, but the production HIPAA direction should be Azure
Database for PostgreSQL Flexible Server under the Microsoft BAA.

This runbook keeps PHI out of Git. Do not commit database files, exports, or
connection strings.

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

## Local Preflight

From the Azure repo root:

```bash
npm install
npm run postgres:check
npm run postgres:migrate:dry-run
```

The dry run only reads the local SQLite database and prints table counts. It
does not send PHI anywhere.

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

After the one-time copy, compare table existence, column presence, and row
counts without printing PHI:

```bash
set SQLITE_DB_PATH=C:\path\to\mftbrain.db
set DATABASE_URL=postgres://USER:PASSWORD@HOST.postgres.database.azure.com:5432/miwa?sslmode=require
set PGSSLMODE=require
npm run postgres:verify
```

The verifier exits non-zero if tables are missing, columns are missing, or row
counts differ. It does not print row data or secrets.

## Runtime Cutover

These scripts prepare Azure PostgreSQL and copy the data. The app still needs
the runtime database layer switched from the synchronous SQLite wrapper to an
async PostgreSQL implementation before production can set `DB_PROVIDER=postgres`.
Today, the server intentionally refuses to boot if `DB_PROVIDER=postgres` is
set before that runtime cutover is complete, so we do not accidentally believe
PHI is in Postgres while the app is still writing to SQLite.

That runtime cutover should be a separate, reviewed change because every route
currently expects `db.get`, `db.all`, `db.run`, and `db.insert` to return
synchronously.

## Verification

After the runtime cutover:

```bash
npm test
npm run build
npm start
```

Then verify:

- `https://miwa.care/api/health`
- login with a known migrated account
- public network page
- patient list and session notes for a migrated therapist
- document upload path and generated report path
