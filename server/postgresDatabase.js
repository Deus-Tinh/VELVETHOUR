import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
pg.types.setTypeParser(20, (value) => Number(value));
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');
const MIGRATION_LOCK_ID = '731208541920261112';

function databaseUrlFromEnv(env = process.env) {
  const raw = String(env.DATABASE_URL || '').trim();
  if (!raw) throw new Error('DATABASE_URL is required for PostgreSQL mode.');
  let url;
  try { url = new URL(raw); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error('DATABASE_URL must include a PostgreSQL host and database name.');
  }
  return raw;
}

export function createPostgresPool({ env = process.env, max = 5 } = {}) {
  const connectionString = databaseUrlFromEnv(env);
  return new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'serenity-spa-api',
  });
}

export async function checkPostgresReady(pool) {
  await pool.query('SELECT 1');
  return true;
}

export async function withPostgresTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function runPostgresMigrations(pool, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const files = (await readdir(migrationsDir))
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const client = await pool.connect();
  let lockHeld = false;
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_ID]);
    lockHeld = true;
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((row) => row.version));
    for (const name of files) {
      const version = name.slice(0, name.length - '.sql'.length);
      if (applied.has(version)) continue;
      const sql = await readFile(path.join(migrationsDir, name), 'utf8');
      if (!sql.trim()) throw new Error(`PostgreSQL migration ${name} is empty.`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`PostgreSQL migration ${name} failed: ${error.message}`, { cause: error });
      }
      applied.add(version);
    }
    return [...applied].sort();
  } finally {
    if (lockHeld) {
      try { await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_ID]); } catch {}
    }
    client.release();
  }
}
