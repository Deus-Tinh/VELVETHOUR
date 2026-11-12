import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';

process.env.NODE_ENV = 'test';
const directory = await mkdtemp(path.join(tmpdir(), 'serenity-staff-roster-'));
process.env.SERENITY_DB_PATH = path.join(directory, 'test.sqlite');
const { server } = await import('../server/server.js');
const handler = server.listeners('request')[0];
const db = new DatabaseSync(process.env.SERENITY_DB_PATH);
db.prepare("INSERT INTO metadata(key,value) VALUES ('last_backup_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
  .run(new Date().toISOString().slice(0, 10));

after(() => db.close());

async function request(method, url, body, cookie = '', extraHeaders = {}) {
  const headers = Object.fromEntries(Object.entries(extraHeaders).map(([key, value]) => [key.toLowerCase(), value]));
  headers.host = 'localhost:3001';
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const incoming = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(incoming, { method, url, headers, socket: { remoteAddress: 'staff-roster-test' } });
  const outgoing = {
    headers: {}, status: 0, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, responseHeaders = {}) {
      this.status = status;
      for (const [name, value] of Object.entries(responseHeaders)) this.setHeader(name, value);
      return this;
    },
    end(bodyText = '') { this.body = bodyText; return this; },
  };
  await handler(incoming, outgoing);
  return { status: outgoing.status, headers: outgoing.headers, payload: outgoing.body ? JSON.parse(outgoing.body) : {} };
}

async function login(email, password) {
  const result = await request('POST', '/api/auth/login', { email, password });
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  return { user: result.payload.user, cookie: result.headers['set-cookie'].split(';')[0] };
}

function allRows(collection) {
  return db.prepare('SELECT id,payload FROM collection_records WHERE collection=? ORDER BY id').all(collection)
    .map((row) => JSON.parse(row.payload));
}

function recordFor(id, categoryId, patch = {}) {
  return {
    id, name: 'Chuyên viên kiểm thử', title: 'Chuyên viên trị liệu',
    imageId: 'staff-01', specialties: [categoryId], workingDays: [1, 2, 3, 4, 5],
    shiftStart: '09:00', shiftEnd: '18:00', daysOff: [],
    breaks: [{ startTime: '12:00', endTime: '13:00' }], active: true,
    ...patch,
  };
}

const admin = await login('admin@example.invalid', process.env.SERENITY_TEST_ADMIN_PASSWORD);
const customer = await login('khach@example.invalid', process.env.SERENITY_TEST_CUSTOMER_PASSWORD);
const staffUser = await login('linh@example.invalid', process.env.SERENITY_TEST_STAFF_PASSWORD);

test('server staff roster API is admin-only, atomic, versioned, and upserts without replacing the collection', async (t) => {
  await t.test('admin-only server read rejects guests, customers, and staff accounts', async () => {
    assert.equal((await request('GET', '/api/admin/collections/staff')).status, 401);
    assert.equal((await request('GET', '/api/admin/collections/staff', undefined, customer.cookie)).status, 403);
    assert.equal((await request('GET', '/api/admin/collections/staff', undefined, staffUser.cookie)).status, 403);
    assert.equal((await request('GET', '/api/admin/collections/staff', undefined, admin.cookie)).status, 200);
  });

  await t.test('a subset import preserves destination-only staff, accounts, invitations, and bookings', async () => {
    const before = (await request('GET', '/api/admin/collections/staff', undefined, admin.cookie)).payload;
    const usersBefore = allRows('users');
    const bookingsBefore = allRows('bookings');
    const invitesBefore = db.prepare('SELECT * FROM staff_invites ORDER BY staff_id').all();
    const categoryId = allRows('categories')[0].id;
    const id = 'roster-' + randomUUID().replaceAll('-', '');
    const imported = recordFor(id, categoryId);
    const result = await request('PUT', '/api/admin/staff-roster', { records: [imported] }, admin.cookie,
      { 'If-Match': String(before.version) });
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    assert.equal(result.payload.version, before.version + 1);

    const afterRead = (await request('GET', '/api/admin/collections/staff', undefined, admin.cookie)).payload;
    const afterById = new Map(afterRead.records.map((row) => [row.id, row]));
    assert.ok(afterById.has(id));
    for (const existing of before.records) assert.ok(afterById.has(existing.id), 'destination staff ' + existing.id + ' was deleted');
    assert.deepEqual(allRows('users'), usersBefore);
    assert.deepEqual(allRows('bookings'), bookingsBefore);
    assert.deepEqual(db.prepare('SELECT * FROM staff_invites ORDER BY staff_id').all(), invitesBefore);
  });

  await t.test('same-version writes to the same staff row yield one success and one 409', async () => {
    const current = (await request('GET', '/api/admin/collections/staff', undefined, admin.cookie)).payload;
    const source = current.records.find((row) => row.id === 'st-01') || current.records[0];
    const id = source.id;
    const left = recordFor(id, source.specialties[0], { ...source, name: 'Admin A cập nhật' });
    const right = recordFor(id, source.specialties[0], { ...source, name: 'Admin B cập nhật' });
    const writes = await Promise.all([
      request('PUT', '/api/admin/staff-roster', { records: [left] }, admin.cookie, { 'If-Match': String(current.version) }),
      request('PUT', '/api/admin/staff-roster', { records: [right] }, admin.cookie, { 'If-Match': String(current.version) }),
    ]);
    assert.deepEqual(writes.map((item) => item.status).sort(), [200, 409]);
    const winner = (await request('GET', '/api/admin/collections/staff', undefined, admin.cookie)).payload.records.find((row) => row.id === id);
    assert.ok(['Admin A cập nhật', 'Admin B cập nhật'].includes(winner.name));
    assert.equal(allRows('staff').filter((row) => row.id === id).length, 1);
  });

  await t.test('HTTP 409 does not mutate the collection and retry is ID-idempotent', async () => {
    const before = (await request('GET', '/api/admin/collections/staff', undefined, admin.cookie)).payload;
    const categoryId = allRows('categories')[0].id;
    const id = 'retry-' + randomUUID().replaceAll('-', '');
    const write = await request('PUT', '/api/admin/staff-roster', { records: [recordFor(id, categoryId)] }, admin.cookie,
      { 'If-Match': String(before.version) });
    assert.equal(write.status, 200);
    const staleRetry = await request('PUT', '/api/admin/staff-roster', { records: [recordFor(id, categoryId)] }, admin.cookie,
      { 'If-Match': String(before.version) });
    assert.equal(staleRetry.status, 409);
    const after = (await request('GET', '/api/admin/collections/staff', undefined, admin.cookie)).payload;
    assert.equal(after.records.filter((row) => row.id === id).length, 1);
    assert.ok(after.records.some((row) => row.id === 'st-01'));
  });

  await t.test('invalid categories, schedules, duplicate IDs, extra fields, and partial payloads write nothing', async () => {
    const before = (await request('GET', '/api/admin/collections/staff', undefined, admin.cookie)).payload;
    const categoryId = allRows('categories')[0].id;
    const valid = recordFor('invalid-' + randomUUID().replaceAll('-', ''), categoryId);
    const invalidBodies = [
      { records: [recordFor('invalid-cat', 'not-a-category')] },
      { records: [recordFor('invalid-shift', categoryId, { shiftEnd: '08:00' })] },
      { records: [recordFor('invalid-break', categoryId, { breaks: [{ startTime: '08:00', endTime: '09:30' }] })] },
      { records: [valid, valid] },
      { records: [recordFor('sensitive', categoryId, { passwordHash: 'must-not-persist' })] },
      { records: [valid], users: [{ id: 'should-not-be-accepted' }] },
    ];
    for (const body of invalidBodies) {
      const response = await request('PUT', '/api/admin/staff-roster', body, admin.cookie,
        { 'If-Match': String(before.version) });
      assert.equal(response.status, 400, JSON.stringify(response.payload));
    }
    const after = (await request('GET', '/api/admin/collections/staff', undefined, admin.cookie)).payload;
    assert.equal(after.version, before.version);
    assert.deepEqual(after.records, before.records);
  });

  await t.test('a storage failure returns HTTP 500 and rolls the transaction back completely', async () => {
    const before = (await request('GET', '/api/admin/collections/staff', undefined, admin.cookie)).payload;
    const categoryId = allRows('categories')[0].id;
    db.exec("CREATE TRIGGER fail_roster_insert BEFORE INSERT ON collection_records " +
      "WHEN NEW.collection='staff' AND NEW.id='force-roster-500' " +
      "BEGIN SELECT RAISE(ABORT, 'simulated database write failure'); END;");
    try {
      const result = await request('PUT', '/api/admin/staff-roster', { records: [recordFor('force-roster-500', categoryId)] },
        admin.cookie, { 'If-Match': String(before.version) });
      assert.equal(result.status, 500);
      const after = (await request('GET', '/api/admin/collections/staff', undefined, admin.cookie)).payload;
      assert.equal(after.version, before.version);
      assert.equal(after.records.some((row) => row.id === 'force-roster-500'), false);
      assert.deepEqual(allRows('staff'), [...before.records].sort((a, b) => a.id.localeCompare(b.id)));
    } finally {
      db.exec('DROP TRIGGER IF EXISTS fail_roster_insert');
    }
  });
});
