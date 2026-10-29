import { randomUUID } from 'node:crypto';
import { open, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { backup } from 'node:sqlite';

export function assertSqliteIntegrity(db) {
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    throw new Error(`SQLite integrity check failed: ${integrity.map((row) => Object.values(row).join(':')).join('; ') || 'no result'}`);
  }
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeys.length) throw new Error(`SQLite foreign key check failed (${foreignKeys.length} row(s)).`);
  return { integrity: 'ok', foreignKeyViolations: 0 };
}

/** Creates a consistent online snapshot without checkpointing or deleting WAL/SHM. */
export async function createSqliteBackup(db, backupDir, now = new Date()) {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const file = path.join(backupDir, `serenity-${stamp}-${randomUUID()}.sqlite`);
  const reservation = await open(file, 'wx', 0o600);
  await reservation.close();
  try {
    await backup(db, file);
  } catch (error) {
    // The reserved path is unique and owned by this call; prior backups are untouched.
    await unlink(file).catch(() => {});
    throw error;
  }
  return file;
}
