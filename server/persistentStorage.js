import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, open, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const fail = (reason) => { throw new Error(`Production startup refused: ${reason}`); };

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Require an already-populated SQLite database on a separate, writable Linux
 * filesystem before production opens it. Dependencies are injectable so the
 * mount checks can be exercised without a cloud VM.
 */
export async function assertPersistentSQLiteStorage({
  appRoot,
  dataDir,
  databasePath,
  backupDir,
  platform = process.platform,
  fsOps = { access, lstat, mkdir, open, realpath, rm, stat },
}) {
  if (platform !== 'linux') fail('Oracle production storage validation requires Linux.');
  for (const [name, value] of Object.entries({ appRoot, dataDir, databasePath, backupDir })) {
    if (typeof value !== 'string' || !value || !path.isAbsolute(value)) fail(`${name} must be an absolute path.`);
  }

  const appPath = path.resolve(appRoot);
  const dataPath = path.resolve(dataDir);
  const dbPath = path.resolve(databasePath);
  const backupsPath = path.resolve(backupDir);
  if (path.resolve(dataDir) !== dataPath || path.resolve(databasePath) !== dbPath || path.resolve(backupDir) !== backupsPath) {
    fail('storage paths must be normalized absolute paths.');
  }

  let volumeStat;
  let appStat;
  try {
    const dataEntry = await fsOps.lstat(dataPath);
    if (!dataEntry.isDirectory() || dataEntry.isSymbolicLink()) fail('SERENITY_DATA_DIR must be a mounted directory, not a symlink.');
    if (await fsOps.realpath(dataPath) !== dataPath) fail('SERENITY_DATA_DIR must resolve to its exact mount path.');
    volumeStat = await fsOps.stat(dataPath);
    appStat = await fsOps.stat(appPath);
  } catch (error) {
    if (error.message?.startsWith('Production startup refused:')) throw error;
    fail('the configured persistent data volume is missing or cannot be inspected.');
  }

  if (volumeStat.dev === appStat.dev) fail('SERENITY_DATA_DIR is on the application filesystem; mount the persistent block volume first.');
  if (path.dirname(dbPath) !== dataPath || !isWithin(dataPath, backupsPath) || backupsPath === dataPath) {
    fail('the database must be directly inside SERENITY_DATA_DIR and backups must stay on that volume.');
  }

  try {
    const database = await fsOps.lstat(dbPath);
    if (!database.isFile() || database.isSymbolicLink()) fail('SERENITY_DB_PATH must point to an existing regular SQLite database file.');
  } catch (error) {
    if (error.message?.startsWith('Production startup refused:')) throw error;
    if (error.code === 'ENOENT') fail('SERENITY_DB_PATH does not exist; restore the verified SQLite database onto the mounted volume first.');
    fail('SERENITY_DB_PATH cannot be inspected.');
  }

  try {
    await fsOps.mkdir(backupsPath, { recursive: true, mode: 0o700 });
    const backupEntry = await fsOps.lstat(backupsPath);
    if (!backupEntry.isDirectory() || backupEntry.isSymbolicLink() || await fsOps.realpath(backupsPath) !== backupsPath) {
      fail('SERENITY_BACKUP_DIR must be a real directory on the persistent volume.');
    }
    if ((await fsOps.stat(backupsPath)).dev !== volumeStat.dev) fail('SERENITY_BACKUP_DIR is not on the persistent volume.');
    await fsOps.access(dataPath);
    const probePath = path.join(backupsPath, `.serenity-write-check-${randomUUID()}`);
    const probe = await fsOps.open(probePath, 'wx', 0o600);
    await probe.close();
    await fsOps.rm(probePath, { force: false });
  } catch (error) {
    if (error.message?.startsWith('Production startup refused:')) throw error;
    fail('the persistent volume is not writable by the backend service account.');
  }

  return { dataDir: dataPath, databasePath: dbPath, backupDir: backupsPath };
}
