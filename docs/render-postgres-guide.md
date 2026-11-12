# Render PostgreSQL rollout, backup, and rollback

This repository can start the API on PostgreSQL when `DATABASE_URL` is set. The
application applies versioned PostgreSQL migrations while holding a PostgreSQL
advisory lock. `/api/health` and `/api/ready` check the active database and return
HTTP 503 when the connection is unavailable.

## Before a Render rollout

1. Take a verified SQLite backup using the existing `npm run db:backup` and
   `npm run db:verify` commands against the current persistent SQLite volume.
   Keep the backup encrypted and outside the Render service filesystem.
2. Provision or select the PostgreSQL database that the administrator intends
   to use. Do not point the importer at a database with existing application
   rows: it refuses nonempty tables.
3. Restore the verified SQLite backup to PostgreSQL with
   `npm run db:postgres:migrate`, then
   `npm run db:postgres:import-sqlite -- <verified-backup-path>`. Run these
   commands with `DATABASE_URL` supplied through a protected environment
   variable or secret manager. The importer checks SQLite integrity and foreign
   keys, imports in one transaction, preserves insertion order and serial
   values, and excludes expiring sessions and password reset OTPs.
4. Verify the imported row counts and representative accounts, bookings,
   payments, settings, and admin-managed content using read-only queries before
   changing the Render service.
5. In the Render dashboard, set `DATABASE_URL` to the selected database's
   internal connection URL. Confirm the database is the intended target and
   that the configured backup retention meets the administrator's recovery
   needs. Set `SERENITY_INITIAL_ADMIN_EMAIL` and
   `SERENITY_INITIAL_ADMIN_PASSWORD` only if the migrated database has no active
   administrator. Keep both values in Render's secret settings.
6. Deploy only after the owner approves the reviewed PR and the migration
   verification. Confirm the Render health check returns `200` from
   `/api/health` and reports PostgreSQL; then check the admin booking list.

No production database was read or modified while preparing this integration.
The repository does not have Render credentials, so a Render operator must
perform and verify the environment setup and any deployment.

## PostgreSQL backups

Use a PostgreSQL custom-format backup and store it in encrypted, access-limited
storage. Avoid placing the connection URL in shell history or logs. Example on
Linux/macOS, with `DATABASE_URL` already loaded from a secret manager:

```sh
pg_dump --format=custom --no-owner --file=serenity-postgres.dump "$DATABASE_URL"
pg_restore --list serenity-postgres.dump
```

Test restores into a separate disposable database. Keep the last verified
SQLite backup until the PostgreSQL restore has been rehearsed and approved.

## Rollback

If the new application release fails its health or booking checks, roll the
Render service back to the last known-good application release while keeping
the PostgreSQL database intact. Do not point the old SQLite release at the
PostgreSQL URL. If database contents need recovery, restore the last verified
PostgreSQL dump into a separate database, validate it, then have the operator
change `DATABASE_URL` after review. Reconcile bookings created after the backup
before restoring so those customer records are not silently lost. Retain the
failed database and logs until recovery is confirmed.
