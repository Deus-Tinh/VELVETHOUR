import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkPostgresReady, createPostgresPool, runPostgresMigrations } from '../server/postgresDatabase.js';

const TABLES_IN_IMPORT_ORDER = [
  'metadata',
  'collection_records',
  'collection_versions',
  'package_images',
  'therapy_images',
  'booking_dedupe',
  'audit_log',
  'chat_conversations',
  'chat_messages',
  'holiday_sales',
  'holiday_sale_targets',
  'reschedule_quotes',
  'payment_transactions',
  'site_pages',
  'site_menu_items',
  'site_content_requests',
  'admin_agent_conversations',
  'admin_agent_messages',
  'staff_invites',
];
const EXCLUDED_TABLES = new Set(['sessions', 'password_reset_otps']);
const ALL_SCHEMA_TABLES = [...TABLES_IN_IMPORT_ORDER, ...EXCLUDED_TABLES];
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function quoteIdentifier(value) {
  if (!IDENTIFIER.test(value)) throw new Error(`Unexpected SQLite identifier: ${value}`);
  return `"${value}"`;
}

function sourceTables(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
}

function sourceColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((column) => column.name);
}

async function assertTargetIsEmpty(client) {
  for (const table of ALL_SCHEMA_TABLES) {
    const { rows } = await client.query(`SELECT to_regclass($1) AS relation`, [`public.${table}`]);
    if (!rows[0]?.relation) continue;
    const result = await client.query(`SELECT EXISTS (SELECT 1 FROM ${quoteIdentifier(table)} LIMIT 1) AS has_rows`);
    if (result.rows[0].has_rows) {
      throw new Error(`Target table ${table} is not empty; refusing to import over existing data.`);
    }
  }
}

async function targetColumns(client, table) {
  const result = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
  `, [table]);
  return new Set(result.rows.map((row) => row.column_name));
}

async function importTable({ source, client, table }) {
  const columns = sourceColumns(source, table);
  const destinationColumns = await targetColumns(client, table);
  const unsupported = columns.filter((column) => !destinationColumns.has(column));
  if (unsupported.length) {
    throw new Error(`Source table ${table} has columns missing from PostgreSQL schema: ${unsupported.join(', ')}`);
  }

  const preservesInsertionOrder = ['collection_records', 'chat_messages'].includes(table);
  const selected = preservesInsertionOrder ? `rowid AS "__source_rowid__", *` : '*';
  const rows = source.prepare(`SELECT ${selected} FROM ${quoteIdentifier(table)}${preservesInsertionOrder ? ' ORDER BY rowid' : ''}`).all();
  if (!rows.length) return 0;

  const destinationColumnList = [...columns];
  if (preservesInsertionOrder) destinationColumnList.push('inserted_order');
  const names = destinationColumnList.map(quoteIdentifier).join(', ');
  const placeholders = destinationColumnList.map((_, index) => `$${index + 1}`).join(', ');
  const statement = `INSERT INTO ${quoteIdentifier(table)} (${names}) VALUES (${placeholders})`;

  for (const row of rows) {
    const values = columns.map((column) => {
      const value = row[column];
      if ((column === 'data' && (table === 'package_images' || table === 'therapy_images')) && value != null) {
        return Buffer.from(value);
      }
      return value;
    });
    if (preservesInsertionOrder) values.push(row.__source_rowid__);
    await client.query(statement, values);
  }
  return rows.length;
}

async function resetSerial(client, table, column) {
  const sequenceResult = await client.query('SELECT pg_get_serial_sequence($1, $2) AS sequence', [table, column]);
  const sequence = sequenceResult.rows[0]?.sequence;
  if (!sequence) return;
  const maximum = await client.query(`SELECT MAX(${quoteIdentifier(column)}) AS maximum FROM ${quoteIdentifier(table)}`);
  const maxValue = maximum.rows[0].maximum;
  if (maxValue == null) {
    await client.query('SELECT setval($1::regclass, 1, false)', [sequence]);
    return;
  }
  await client.query('SELECT setval($1::regclass, $2, true)', [sequence, maxValue]);
}

async function main() {
  const sourceArg = process.argv[2];
  if (!sourceArg || process.argv.length !== 3) {
    throw new Error('Usage: DATABASE_URL=... node scripts/import-sqlite-to-postgres.mjs <path-to-verified-sqlite-backup>');
  }
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in the process environment before importing.');

  const sourcePath = path.resolve(sourceArg);
  await access(sourcePath);
  const sourceFile = await stat(sourcePath);
  if (!sourceFile.isFile()) throw new Error('The SQLite backup path must refer to a regular file.');

  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const pool = createPostgresPool({ max: 1 });
  try {
    const integrity = source.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
      throw new Error('SQLite integrity_check failed; import cancelled.');
    }
    if (source.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('SQLite foreign_key_check found violations; import cancelled.');
    }

    await checkPostgresReady(pool);
    await runPostgresMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      try {
        const lockList = ALL_SCHEMA_TABLES.map(quoteIdentifier).join(', ');
        await client.query(`LOCK TABLE ${lockList} IN ACCESS EXCLUSIVE MODE`);
        await assertTargetIsEmpty(client);
        const existing = sourceTables(source);
        const imported = {};
        for (const table of TABLES_IN_IMPORT_ORDER) {
          if (!existing.has(table)) continue;
          imported[table] = await importTable({ source, client, table });
        }
        for (const table of EXCLUDED_TABLES) {
          if (existing.has(table)) imported[table] = 'excluded';
        }
        await resetSerial(client, 'collection_records', 'inserted_order');
        await resetSerial(client, 'chat_messages', 'inserted_order');
        await resetSerial(client, 'admin_agent_messages', 'id');
        await client.query('COMMIT');
        for (const [table, count] of Object.entries(imported)) {
          console.log(`${table}: ${count}`);
        }
        console.log('SQLite import completed. No row values were printed.');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  } finally {
    source.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`SQLite import failed: ${error.message}`);
  process.exitCode = 1;
});
