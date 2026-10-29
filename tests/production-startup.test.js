import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function bootProduction(overrides = {}) {
  const unusedDbPath = path.join(tmpdir(), `serenity-production-guard-${randomUUID()}.sqlite`);
  const source = "await import('./server/server.js')";
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SERENITY_DB_PATH: unusedDbPath,
      SERENITY_DATA_DIR: '',
      SERENITY_BACKUP_DIR: '',
      SERENITY_PROXY_TOKEN: 'local-test-token-that-is-not-a-secret',
      ...overrides,
    },
  });
  assert.equal(existsSync(unusedDbPath), false, 'the production guard must reject startup before opening SQLite');
  return result;
}

test('production startup refuses missing persistent volume configuration before creating SQLite', () => {
  const result = bootProduction();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SERENITY_DATA_DIR must be set/);
});

test('production startup refuses an unmounted or missing SQLite path before creating a database', () => {
  const unusedDataDir = path.join(tmpdir(), `serenity-production-data-${randomUUID()}`);
  const result = bootProduction({ SERENITY_DATA_DIR: unusedDataDir, SERENITY_BACKUP_DIR: path.join(unusedDataDir, 'backups') });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /persistent data volume is missing|application filesystem/);
  assert.equal(existsSync(unusedDataDir), false, 'production startup must not create the data mount path');
});
