import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertPersistentSQLiteStorage } from '../server/persistentStorage.js';
import { assertSqliteIntegrity, createSqliteBackup } from '../server/sqliteMaintenance.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2];

function requireFilePath(value, label) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${label} must be an explicit absolute path.`);
  return path.resolve(value);
}

if (command === 'verify') {
  const backupPath = requireFilePath(process.argv[3], 'Backup path');
  const backupDb = new DatabaseSync(backupPath, { readOnly: true });
  try {
    console.log(JSON.stringify(assertSqliteIntegrity(backupDb)));
  } finally { backupDb.close(); }
} else if (command === 'check' || command === 'backup') {
  const production = process.env.NODE_ENV === 'production';
  const defaultDataDir = path.join(root, 'server', 'data');
  const dataDir = production
    ? requireFilePath(process.env.SERENITY_DATA_DIR, 'SERENITY_DATA_DIR')
    : path.resolve(process.env.SERENITY_DATA_DIR || defaultDataDir);
  const databasePath = production
    ? requireFilePath(process.env.SERENITY_DB_PATH, 'SERENITY_DB_PATH')
    : path.resolve(process.env.SERENITY_DB_PATH || path.join(dataDir, 'serenity.sqlite'));
  const backupDir = production
    ? requireFilePath(process.env.SERENITY_BACKUP_DIR, 'SERENITY_BACKUP_DIR')
    : path.resolve(process.env.SERENITY_BACKUP_DIR || path.join(dataDir, 'backups'));

  if (production) await assertPersistentSQLiteStorage({ appRoot: root, dataDir, databasePath, backupDir });
  const db = new DatabaseSync(databasePath, command === 'check' ? { readOnly: true } : undefined);
  try {
    db.exec('PRAGMA busy_timeout=5000');
    if (command === 'check') {
      console.log(JSON.stringify(assertSqliteIntegrity(db)));
    } else {
      const file = await createSqliteBackup(db, backupDir);
      const verification = new DatabaseSync(file, { readOnly: true });
      try { assertSqliteIntegrity(verification); } finally { verification.close(); }
      db.prepare('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run('last_backup_date', new Date().toISOString().slice(0, 10));
      console.log(JSON.stringify({ backup: file, integrity: 'ok' }));
    }
  } finally { db.close(); }
} else {
  throw new Error('Usage: sqlite-maintenance.mjs <check|backup|verify> [absolute-backup-path]');
}
