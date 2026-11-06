import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertPersistentSQLiteStorage } from '../server/persistentStorage.js';
import { assertSqliteIntegrity, createSqliteBackup } from '../server/sqliteMaintenance.js';

test('persistent-volume guard accepts only an existing writable database on a separate Linux filesystem', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'serenity-volume-guard-'));
  const appRoot = path.join(directory, 'app');
  const dataDir = path.join(directory, 'volume');
  const databasePath = path.join(dataDir, 'serenity.sqlite');
  const backupDir = path.join(dataDir, 'backups');
  await mkdir(appRoot);
  await mkdir(dataDir);
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE preserved (id TEXT PRIMARY KEY); INSERT INTO preserved VALUES (\'existing-data\')');
  db.close();
  const fsOps = {
    access: async (...args) => (await import('node:fs/promises')).access(...args),
    lstat: async (...args) => (await import('node:fs/promises')).lstat(...args),
    mkdir: async (...args) => (await import('node:fs/promises')).mkdir(...args),
    open: async (...args) => (await import('node:fs/promises')).open(...args),
    realpath: async (...args) => (await import('node:fs/promises')).realpath(...args),
    rm: async (...args) => (await import('node:fs/promises')).rm(...args),
    stat: async (value) => {
      const info = await stat(value);
      return { dev: path.resolve(value) === path.resolve(appRoot) ? 11 : 22 };
    },
  };

  try {
    const result = await assertPersistentSQLiteStorage({ appRoot, dataDir, databasePath, backupDir, platform: 'linux', fsOps });
    assert.equal(result.databasePath, databasePath);
    assert.ok((await readdir(backupDir)).every((name) => name.startsWith('.serenity-write-check-') === false));

    const sameFilesystemOps = { ...fsOps, stat: async () => ({ dev: 11 }) };
    await assert.rejects(() => assertPersistentSQLiteStorage({ appRoot, dataDir, databasePath, backupDir,
      platform: 'linux', fsOps: sameFilesystemOps }), /application filesystem/);
    await assert.rejects(() => assertPersistentSQLiteStorage({ appRoot, dataDir,
      databasePath: path.join(dataDir, 'missing.sqlite'), backupDir, platform: 'linux', fsOps }), /does not exist/);
    await assert.rejects(() => assertPersistentSQLiteStorage({ appRoot, dataDir, databasePath,
      backupDir: path.join(directory, 'outside-backups'), platform: 'linux', fsOps }), /backups must stay on that volume/);
    const preserved = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(preserved.prepare('SELECT id FROM preserved').get().id, 'existing-data');
    preserved.close();
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      .catch((error) => { if (process.platform !== 'win32' || !['EBUSY', 'EPERM'].includes(error.code)) throw error; }); // Windows keeps SQLite -shm/-wal handles briefly locked
  }
});

test('online backup preserves WAL data and BLOBs; restore copy passes integrity without pruning old backups', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'serenity-online-backup-'));
  const sourcePath = path.join(directory, 'source.sqlite');
  const backupDir = path.join(directory, 'backups');
  const restorePath = path.join(directory, 'restored.sqlite');
  await mkdir(backupDir);
  const source = new DatabaseSync(sourcePath);
  source.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE customers(id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE images(id TEXT PRIMARY KEY, bytes BLOB NOT NULL);
    INSERT INTO customers VALUES ('customer-1', 'persisted customer');
  `);
  source.prepare('INSERT INTO images VALUES (?, ?)').run('image-1', Buffer.from('image-blob-test'));
  const oldBackups = [];
  for (let index = 0; index < 31; index += 1) {
    const name = `serenity-old-${String(index).padStart(2, '0')}.sqlite`;
    await (await import('node:fs/promises')).writeFile(path.join(backupDir, name), 'test-only-old-backup');
    oldBackups.push(name);
  }

  try {
    const snapshotPath = await createSqliteBackup(source, backupDir);
    assert.ok(snapshotPath.endsWith('.sqlite'));
    const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    assert.deepEqual(assertSqliteIntegrity(snapshot), { integrity: 'ok', foreignKeyViolations: 0 });
    assert.equal(snapshot.prepare('SELECT name FROM customers WHERE id=?').get('customer-1').name, 'persisted customer');
    assert.deepEqual(Buffer.from(snapshot.prepare('SELECT bytes FROM images WHERE id=?').get('image-1').bytes), Buffer.from('image-blob-test'));
    snapshot.close();

    await copyFile(snapshotPath, restorePath);
    const restored = new DatabaseSync(restorePath, { readOnly: true });
    assert.deepEqual(assertSqliteIntegrity(restored), { integrity: 'ok', foreignKeyViolations: 0 });
    assert.equal(restored.prepare('SELECT COUNT(*) count FROM customers').get().count, 1);
    assert.equal(restored.prepare('SELECT hex(bytes) value FROM images').get().value, Buffer.from('image-blob-test').toString('hex').toUpperCase());
    restored.close();
    assert.deepEqual((await readdir(backupDir)).filter((name) => oldBackups.includes(name)).sort(), oldBackups.sort());
    assert.equal((await stat(sourcePath)).isFile(), true);
  } finally {
    source.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      .catch((error) => { if (process.platform !== 'win32' || !['EBUSY', 'EPERM'].includes(error.code)) throw error; }); // Windows keeps SQLite -shm/-wal handles briefly locked
  }
});
