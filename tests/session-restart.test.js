import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

test('hashed SQLite session remains authenticated after the Node process restarts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'serenity-session-restart-'));
  const databasePath = path.join(directory, 'session.sqlite');
  const run = (mode, sessionCookie = '') => spawnSync(process.execPath,
    ['--import', './tests/api-test-env.js', './tests/session-probe.mjs', mode], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, NODE_ENV: 'test', SERENITY_DB_PATH: databasePath,
        SERENITY_SEED_DEMO_DATA: 'true', SERENITY_TEST_SESSION_COOKIE: sessionCookie },
    });

  try {
    const loginProcess = run('login');
    assert.equal(loginProcess.status, 0, loginProcess.stderr);
    const login = JSON.parse(loginProcess.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(login.status, 200);
    assert.equal(login.userId, 'usr_cust1');
    const [cookieName, token] = login.cookie.split('=');
    assert.equal(cookieName, 'serenity.sid');
    assert.ok(token.length >= 40);

    const database = new DatabaseSync(databasePath, { readOnly: true });
    const sessions = database.prepare('SELECT token_hash,user_id,expires_at FROM sessions').all();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].token_hash, createHash('sha256').update(token).digest('hex'));
    assert.notEqual(sessions[0].token_hash, token, 'database stores only the hash, never the browser token');
    assert.equal(sessions[0].user_id, login.userId);
    assert.ok(sessions[0].expires_at > Date.now());
    database.close();

    const restartedProcess = run('session', login.cookie);
    assert.equal(restartedProcess.status, 0, restartedProcess.stderr);
    const session = JSON.parse(restartedProcess.stdout.trim().split(/\r?\n/).at(-1));
    assert.deepEqual(session, { status: 200, userId: 'usr_cust1', role: 'customer' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
