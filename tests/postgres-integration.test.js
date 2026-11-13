import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createPostgresPool, runPostgresMigrations } from '../server/postgresDatabase.js';
import { openAsyncDatabase } from '../server/asyncDatabase.js';
import { TEST_PASSWORDS } from './testAccounts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suppliedUrl = process.env.PG_TEST_DATABASE_URL || '';
let adminPool;
let appPool;
let appDatabaseName;
let importDatabaseName;
let appDatabaseUrl;
let importDatabaseUrl;
let serverProcess;
let origin;
let dataDirectory;
let customerCookie;
let adminCookie;
let persistentBookingId;
let persistentRosterId;

function assertIsolatedTestDatabase(raw) {
  assert.ok(raw, 'PG_TEST_DATABASE_URL must point to a disposable PostgreSQL test database.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('PG_TEST_DATABASE_URL is not a valid URL.'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL test URL is required.');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'PostgreSQL integration tests are restricted to loopback hosts.');
  assert.match(url.pathname.slice(1), /test/i, 'The PostgreSQL database name must contain "test".');
  return url;
}

async function createDatabase(label) {
  const name = `serenity_${label}_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await adminPool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(suppliedUrl);
  url.pathname = `/${name}`;
  return { name, url: url.toString() };
}

async function dropDatabase(name) {
  if (!name) return;
  await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
  await adminPool.query(`DROP DATABASE IF EXISTS "${name}"`);
}

async function unusedPort() {
  const listener = createNetServer();
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(child, baseUrl) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error('PostgreSQL test server exited before becoming healthy.');
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const payload = await response.json();
        assert.equal(payload.database, 'postgres');
        return;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('PostgreSQL test server did not become healthy within 15 seconds.');
}

async function startServer() {
  const port = await unusedPort();
  origin = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: {
      PATH: process.env.PATH,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      NODE_ENV: 'test',
      NODE_TEST_CONTEXT: 'postgres-integration',
      DATABASE_URL: appDatabaseUrl,
      PORT: String(port),
      SERENITY_HOST: '127.0.0.1',
      SERENITY_DATA_DIR: dataDirectory,
      SERENITY_BACKUP_DIR: path.join(dataDirectory, 'backups'),
      SERENITY_MUSIC_DIR: path.join(dataDirectory, 'music'),
      SERENITY_API_RATE_LIMIT: '10000',
      SERENITY_SEED_DEMO_DATA: 'true',
      SERENITY_TEST_ADMIN_PASSWORD: TEST_PASSWORDS.admin,
      SERENITY_TEST_STAFF_PASSWORD: TEST_PASSWORDS.staff,
      SERENITY_TEST_CUSTOMER_PASSWORD: TEST_PASSWORDS.customer,
      SEPAY_ENABLED: 'true',
      SEPAY_BANK_NAME: 'Techcombank',
      SEPAY_ACCOUNT_NUMBER: '1234567890',
      SEPAY_ACCOUNT_HOLDER: 'SERENITY TEST',
      SEPAY_WEBHOOK_API_KEY: 'test-only-not-a-live-key',
    },
  });
  await waitForServer(serverProcess, origin);
}

async function stopServer() {
  const child = serverProcess;
  if (!child || child.exitCode != null) { serverProcess = undefined; return; }
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode == null) child.kill('SIGKILL');
  serverProcess = undefined;
}

async function request(method, endpoint, body, cookie = '', extraHeaders = {}) {
  const headers = new Headers({ origin });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, String(value));
  const response = await fetch(new URL(endpoint, origin), {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  return { status: response.status, payload: raw ? JSON.parse(raw) : null,
    cookie: response.headers.getSetCookie?.()[0]?.split(';')[0] || '' };
}

async function login(email, password) {
  const result = await request('POST', '/api/auth/login', { email, password });
  assert.equal(result.status, 200, 'test account login must work against the PostgreSQL backend');
  assert.ok(result.cookie, 'login should return a persistent session cookie');
  return result.cookie;
}

function localToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function futureDate(days) {
  const value = new Date(`${localToday()}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function bookingBody(date, patch = {}) {
  return {
    serviceId: 'signature-body', duration: 60, staffId: 'st-04', date, startTime: '10:00',
    customerName: 'Khách PostgreSQL test', customerPhone: '0987654321', customerEmail: '', note: '',
    submissionKey: `pg-test-${randomUUID()}`,
    ...patch,
  };
}

async function createBooking(date, patch = {}) {
  return request('POST', '/api/bookings', bookingBody(date, patch), customerCookie);
}

async function setTestRoomCount(count) {
  const row = await appPool.query("SELECT payload FROM collection_records WHERE collection='settings' AND id='main'");
  assert.ok(row.rows[0], 'settings seed must exist in PostgreSQL');
  const settings = { ...JSON.parse(row.rows[0].payload), roomCount: count };
  await appPool.query("UPDATE collection_records SET payload=$1 WHERE collection='settings' AND id='main'", [JSON.stringify(settings)]);
  await appPool.query(`INSERT INTO collection_versions(collection,version) VALUES ('settings',1)
    ON CONFLICT(collection) DO UPDATE SET version=collection_versions.version+1`);
}

async function shortenStoredBookingEndTime(id, endTime) {
  const result = await appPool.query("SELECT payload FROM collection_records WHERE collection='bookings' AND id=$1", [id]);
  assert.ok(result.rows[0], 'booking should be present in the PostgreSQL collection');
  const booking = { ...JSON.parse(result.rows[0].payload), endTime };
  await appPool.query("UPDATE collection_records SET payload=$1 WHERE collection='bookings' AND id=$2", [JSON.stringify(booking), id]);
  await appPool.query(`INSERT INTO collection_versions(collection,version) VALUES ('bookings',1)
    ON CONFLICT(collection) DO UPDATE SET version=collection_versions.version+1`);
}

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', () => resolve({ code: -1, stdout: '', stderr: '' }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

before(async () => {
  assertIsolatedTestDatabase(suppliedUrl);
  adminPool = createPostgresPool({ env: { DATABASE_URL: suppliedUrl }, max: 2 });
  await adminPool.query('SELECT 1');
  const app = await createDatabase('app');
  appDatabaseName = app.name;
  appDatabaseUrl = app.url;
  const importer = await createDatabase('import');
  importDatabaseName = importer.name;
  importDatabaseUrl = importer.url;
  dataDirectory = await mkdtemp(path.join(tmpdir(), 'serenity-postgres-api-'));
});

after(async () => {
  await stopServer();
  await appPool?.end().catch(() => {});
  if (appDatabaseName) await dropDatabase(appDatabaseName).catch(() => {});
  if (importDatabaseName) await dropDatabase(importDatabaseName).catch(() => {});
  await adminPool?.end().catch(() => {});
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true }).catch(() => {});
});

test('PostgreSQL migrations are idempotent, adapter transactions are safe, and run() returns changes', async () => {
  const pool = createPostgresPool({ env: { DATABASE_URL: appDatabaseUrl }, max: 3 });
  const first = await runPostgresMigrations(pool);
  const second = await runPostgresMigrations(pool);
  assert.deepEqual(second, first);
  assert.ok(first.includes('0001_initial_schema'));
  await pool.end();

  const db = await openAsyncDatabase({ databaseUrl: appDatabaseUrl });
  try {
    const inserted = await db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run('adapter_probe', 'first');
    assert.equal(inserted.changes, 1);
    const ignored = await db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)').run('adapter_probe', 'ignored');
    assert.equal(ignored.changes, 0);

    await assert.rejects(db.transaction(async () => {
      await db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run('rollback_probe', 'temporary');
      throw new Error('expected rollback');
    }), /expected rollback/);
    assert.equal(await db.prepare('SELECT value FROM metadata WHERE key=?').get('rollback_probe'), undefined);

    const versions = await Promise.all(Array.from({ length: 24 }, () => db.prepare(`
      INSERT INTO collection_versions(collection,version) VALUES ('parallel-version-test',1)
      ON CONFLICT(collection) DO UPDATE SET version=collection_versions.version+1 RETURNING version
    `).get()));
    assert.deepEqual(versions.map((row) => row.version).sort((a, b) => a - b), Array.from({ length: 24 }, (_, index) => index + 1));
  } finally { await db.close(); }
});

test('SQLite backup import preserves bookings, account/payment rows and rejects a second import', async () => {
  const sourceDirectory = await mkdtemp(path.join(tmpdir(), 'serenity-sqlite-import-'));
  const sourcePath = path.join(sourceDirectory, 'verified.sqlite');
  const source = new DatabaseSync(sourcePath);
  try {
    source.exec(`
      CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE collection_records(collection TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(collection,id));
      CREATE TABLE collection_versions(collection TEXT PRIMARY KEY,version INTEGER NOT NULL);
      CREATE TABLE booking_dedupe(token TEXT PRIMARY KEY,booking_id TEXT NOT NULL);
      CREATE TABLE payment_transactions(provider TEXT NOT NULL,provider_transaction_id TEXT NOT NULL,booking_id TEXT,payment_code TEXT,
        transfer_amount INTEGER NOT NULL,transfer_type TEXT NOT NULL,transfer_content TEXT NOT NULL DEFAULT '',reference_code TEXT NOT NULL DEFAULT '',
        transaction_at TEXT,status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',received_at TEXT NOT NULL,PRIMARY KEY(provider,provider_transaction_id));
      CREATE TABLE package_images(id TEXT PRIMARY KEY,mime_type TEXT NOT NULL,data BLOB NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
    `);
    source.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run('initialized', 'yes');
    const insertRecord = source.prepare('INSERT INTO collection_records(collection,id,payload) VALUES (?,?,?)');
    insertRecord.run('users', 'import-admin', JSON.stringify({ id: 'import-admin', email: 'admin-import@example.invalid', role: 'admin' }));
    insertRecord.run('bookings', 'import-booking', JSON.stringify({ id: 'import-booking', duration: 90, startTime: '17:00', endTime: '18:30', status: 'Confirmed' }));
    source.prepare('INSERT INTO collection_versions(collection,version) VALUES (?,?)').run('bookings', 4);
    source.prepare('INSERT INTO booking_dedupe(token,booking_id) VALUES (?,?)').run('import-token', 'import-booking');
    source.prepare(`INSERT INTO payment_transactions(provider,provider_transaction_id,booking_id,payment_code,transfer_amount,transfer_type,
      transfer_content,reference_code,transaction_at,status,reason,received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('sepay', 'import-payment', 'import-booking', 'TEST01', 680000, 'in', 'TEST01', 'IMPORT-REF', null, 'paid', '', '2026-11-12T00:00:00.000Z');
    source.prepare('INSERT INTO package_images(id,mime_type,data,created_at) VALUES (?,?,?,?)')
      .run('import-image', 'image/png', Buffer.from([0, 1, 2, 255]), '2026-11-12T00:00:00.000Z');
    source.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run('ephemeral-session', 'import-admin', 1);
  } finally { source.close(); }

  try {
    const env = { ...process.env, DATABASE_URL: importDatabaseUrl };
    const imported = await runNode(['scripts/import-sqlite-to-postgres.mjs', sourcePath], env);
    assert.equal(imported.code, 0, 'the migration importer should complete successfully on the isolated test database');
    const pool = createPostgresPool({ env: { DATABASE_URL: importDatabaseUrl }, max: 2 });
    try {
      const booking = await pool.query("SELECT payload FROM collection_records WHERE collection='bookings' AND id='import-booking'");
      assert.equal(JSON.parse(booking.rows[0].payload).duration, 90);
      assert.equal((await pool.query("SELECT payload FROM collection_records WHERE collection='users' AND id='import-admin'")).rowCount, 1);
      assert.equal((await pool.query("SELECT version FROM collection_versions WHERE collection='bookings'")).rows[0].version, 4);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM payment_transactions WHERE provider_transaction_id=$1', ['import-payment'])).rows[0].count, 1);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM booking_dedupe WHERE token=$1', ['import-token'])).rows[0].count, 1);
      assert.deepEqual((await pool.query('SELECT data FROM package_images WHERE id=$1', ['import-image'])).rows[0].data, Buffer.from([0, 1, 2, 255]));
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count, 0, 'ephemeral sessions stay excluded from imports');
    } finally { await pool.end(); }
    const duplicateImport = await runNode(['scripts/import-sqlite-to-postgres.mjs', sourcePath], env);
    assert.notEqual(duplicateImport.code, 0, 're-importing into nonempty tables must be refused');
  } finally { await rm(sourceDirectory, { recursive: true, force: true }); }
});

test('PostgreSQL API enforces 30/60/90/120-minute occupancy, adjacent slots, rooms, and concurrent booking safety', async () => {
  await startServer();
  appPool = createPostgresPool({ env: { DATABASE_URL: appDatabaseUrl }, max: 3 });
  customerCookie = await login('khach@example.invalid', TEST_PASSWORDS.customer);
  adminCookie = await login('admin@example.invalid', TEST_PASSWORDS.admin);

  const conversationResult = await request('POST', '/api/admin/agent/conversations', {}, adminCookie);
  assert.equal(conversationResult.status, 201);
  const conversationId = conversationResult.payload.conversation.id;
  const failedAgentTurn = await request('POST', '/api/admin/agent/messages', {
    conversationId, requestId: `pg-agent-${randomUUID()}`, message: 'Kiểm tra lịch sử PostgreSQL',
  }, adminCookie);
  assert.equal(failedAgentTurn.status, 503, 'unconfigured test AI should be saved as a controlled failed turn');
  const history = await request('GET', `/api/admin/agent/conversations/${conversationId}`, undefined, adminCookie);
  assert.equal(history.status, 200);
  assert.equal(history.payload.messages[1].state, 'failed');
  assert.equal(history.payload.messages[1].metadata.errorCode, 'AI_NOT_CONFIGURED');
  assert.equal((await request('DELETE', `/api/admin/agent/conversations/${conversationId}`, undefined, adminCookie)).status, 200);

  for (const [index, duration] of [30, 60, 90, 120].entries()) {
    const date = futureDate(12 + index);
    const serviceId = duration === 30 ? 'temple-eye-relax' : 'signature-body';
    const created = await createBooking(date, { serviceId, duration, staffId: duration === 30 ? 'st-01' : 'st-04', startTime: '10:00' });
    assert.equal(created.status, 201, JSON.stringify(created.payload));
    assert.equal(created.payload.booking.duration, duration);
    assert.equal(created.payload.booking.endTime, duration === 120 ? '12:00' : duration === 90 ? '11:30' : duration === 60 ? '11:00' : '10:30');
  }

  const occupiedDate = futureDate(20);
  const first = await createBooking(occupiedDate, { duration: 90, staffId: 'st-04', startTime: '17:00' });
  assert.equal(first.status, 201, JSON.stringify(first.payload));
  persistentBookingId = first.payload.booking.id;
  assert.equal(first.payload.booking.endTime, '18:30');
  const snapshot = await request('GET', '/api/bootstrap', undefined, customerCookie);
  const occupied = snapshot.payload.occupiedSlots.find((slot) => slot.id === persistentBookingId);
  assert.equal(occupied.duration, 90);

  const overlap = await createBooking(occupiedDate, { duration: 60, staffId: 'st-04', startTime: '18:00' });
  assert.equal(overlap.status, 409);
  assert.equal(overlap.payload.code, 'BOOKING_CONFLICT');
  const adjacent = await createBooking(occupiedDate, { duration: 60, staffId: 'st-04', startTime: '18:30' });
  assert.equal(adjacent.status, 201, JSON.stringify(adjacent.payload));

  await setTestRoomCount(1);
  const legacyDate = futureDate(21);
  const legacy = await createBooking(legacyDate, { duration: 90, staffId: 'st-04', startTime: '17:00' });
  assert.equal(legacy.status, 201, JSON.stringify(legacy.payload));
  await shortenStoredBookingEndTime(legacy.payload.booking.id, '17:30');
  const roomOverlap = await createBooking(legacyDate, { duration: 60, staffId: 'st-01', startTime: '18:00' });
  assert.equal(roomOverlap.status, 409);
  assert.equal(roomOverlap.payload.code, 'ROOM_CAPACITY');
  const roomAdjacent = await createBooking(legacyDate, { duration: 30, serviceId: 'temple-eye-relax', staffId: 'st-01', startTime: '18:30' });
  assert.equal(roomAdjacent.status, 201, JSON.stringify(roomAdjacent.payload));

  const concurrencyDate = futureDate(22);
  const simultaneous = await Promise.all([
    createBooking(concurrencyDate, { duration: 90, staffId: 'st-04', startTime: '10:00' }),
    createBooking(concurrencyDate, { duration: 90, staffId: 'st-04', startTime: '10:00' }),
  ]);
  assert.deepEqual(simultaneous.map((item) => item.status).sort(), [201, 409]);
  assert.equal(simultaneous.filter((item) => item.payload.code === 'BOOKING_CONFLICT').length, 1);
  const adminBookings = await request('GET', '/api/bookings', undefined, adminCookie);
  assert.ok(adminBookings.payload.bookings.some((booking) => booking.id === persistentBookingId), 'admin booking list must read data persisted in PostgreSQL');
});

test('PostgreSQL staff roster imports preserve unrelated data and reject concurrent stale collection writes', async () => {
  const before = await request('GET', '/api/admin/collections/staff', undefined, adminCookie);
  assert.equal(before.status, 200);
  const deniedGuest = await request('PUT', '/api/admin/staff-roster', { records: [] }, '',
    { 'If-Match': String(before.payload.version) });
  const deniedCustomer = await request('PUT', '/api/admin/staff-roster', { records: [] }, customerCookie,
    { 'If-Match': String(before.payload.version) });
  assert.equal(deniedGuest.status, 401);
  assert.equal(deniedCustomer.status, 403);
  const originalStaff = before.payload.records;
  const original = originalStaff.find((row) => row.id === 'st-01');
  assert.ok(original, 'PostgreSQL test seed should include staff st-01');
  persistentRosterId = `pg-roster-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const imported = {
    id: persistentRosterId, name: 'Chuyên viên PostgreSQL', title: 'Chuyên viên kiểm thử',
    specialties: [original.specialties[0]], workingDays: [1, 2, 3, 4, 5],
    shiftStart: '09:00', shiftEnd: '18:00', daysOff: [], active: true,
  };
  const usersBefore = await appPool.query("SELECT id,payload FROM collection_records WHERE collection='users' ORDER BY id");
  const bookingsBefore = await appPool.query("SELECT id,payload FROM collection_records WHERE collection='bookings' ORDER BY id");

  const write = await request('PUT', '/api/admin/staff-roster', { records: [imported] }, adminCookie,
    { 'If-Match': String(before.payload.version) });
  assert.equal(write.status, 200, JSON.stringify(write.payload));
  assert.equal(write.payload.version, before.payload.version + 1);
  const afterImport = await request('GET', '/api/admin/collections/staff', undefined, adminCookie);
  assert.equal(afterImport.status, 200);
  const importedRows = new Map(afterImport.payload.records.map((row) => [row.id, row]));
  assert.deepEqual(importedRows.get(persistentRosterId).name, imported.name);
  for (const destinationRow of originalStaff) {
    assert.deepEqual(importedRows.get(destinationRow.id), destinationRow, `destination staff ${destinationRow.id} must be preserved`);
  }
  assert.deepEqual((await appPool.query("SELECT id,payload FROM collection_records WHERE collection='users' ORDER BY id")).rows, usersBefore.rows);
  assert.deepEqual((await appPool.query("SELECT id,payload FROM collection_records WHERE collection='bookings' ORDER BY id")).rows, bookingsBefore.rows);

  const concurrentVersion = afterImport.payload.version;
  const rosterUpdate = { ...importedRows.get('st-01'), name: 'Roster admin update' };
  const collectionRows = afterImport.payload.records.map((row) => row.id === 'st-01'
    ? { ...row, name: 'Collection admin update' }
    : row);
  const competing = await Promise.all([
    request('PUT', '/api/admin/staff-roster', { records: [rosterUpdate] }, adminCookie,
      { 'If-Match': String(concurrentVersion) }),
    request('PUT', '/api/admin/collections/staff', { records: collectionRows }, adminCookie,
      { 'If-Match': String(concurrentVersion) }),
  ]);
  assert.deepEqual(competing.map((item) => item.status).sort(), [200, 409], 'only one stale-snapshot writer may commit');
  const final = await request('GET', '/api/admin/collections/staff', undefined, adminCookie);
  assert.equal(final.status, 200);
  assert.equal(final.payload.records.filter((row) => row.id === persistentRosterId).length, 1);
  assert.equal(final.payload.records.length, originalStaff.length + 1, 'a stale full collection write must not delete the prior import');
  const finalOriginal = final.payload.records.find((row) => row.id === 'st-01');
  assert.ok(['Roster admin update', 'Collection admin update'].includes(finalOriginal.name));
});

test('bookings, staff roster, sessions, and migration state survive a PostgreSQL server restart', async () => {
  assert.ok(persistentBookingId);
  assert.ok(persistentRosterId);
  await stopServer();
  await startServer();
  const health = await fetch(`${origin}/api/ready`).then((response) => response.json());
  assert.deepEqual(health, { ok: true, database: 'postgres', version: 1 });
  const bookings = await request('GET', '/api/bookings', undefined, customerCookie);
  assert.equal(bookings.status, 200);
  const restored = bookings.payload.bookings.find((booking) => booking.id === persistentBookingId);
  assert.equal(restored.duration, 90);
  assert.equal(restored.endTime, '18:30');
  const roster = await request('GET', '/api/admin/collections/staff', undefined, adminCookie);
  assert.equal(roster.status, 200);
  assert.equal(roster.payload.records.filter((row) => row.id === persistentRosterId).length, 1);
});
