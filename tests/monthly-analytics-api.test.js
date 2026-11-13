import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';

const directory = await mkdtemp(path.join(tmpdir(), 'serenity-monthly-analytics-'));
process.env.SERENITY_DB_PATH = path.join(directory, 'test.sqlite');
const { server } = await import('../server/server.js');
const handler = server.listeners('request')[0];
const database = new DatabaseSync(process.env.SERENITY_DB_PATH);
database.prepare('INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  .run('last_backup_date', new Date().toISOString().slice(0, 10));

async function request(method, url, body, cookie = '') {
  const incoming = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(incoming, { method, url, headers: { host: 'localhost:3001', cookie }, socket: { remoteAddress: 'monthly-analytics-test' } });
  const outgoing = {
    headers: {}, status: 0, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers = {}) { this.status = status; for (const [name, value] of Object.entries(headers)) this.setHeader(name, value); return this; },
    end(body = '') { this.body = body; return this; },
  };
  await handler(incoming, outgoing);
  return { status: outgoing.status, headers: outgoing.headers, payload: outgoing.body ? JSON.parse(outgoing.body) : null };
}

async function login(email, password) {
  const result = await request('POST', '/api/auth/login', { email, password });
  assert.equal(result.status, 200);
  return result.headers['set-cookie'].split(';')[0];
}

function putBooking(record) {
  database.prepare('INSERT INTO collection_records(collection, id, payload) VALUES (?, ?, ?)')
    .run('bookings', record.id, JSON.stringify(record));
}

test('monthly analytics endpoint is admin-only, validates period, and aggregates server records', async () => {
  const adminCookie = await login('admin@example.invalid', process.env.SERENITY_TEST_ADMIN_PASSWORD);
  const staffCookie = await login('linh@example.invalid', process.env.SERENITY_TEST_STAFF_PASSWORD);
  assert.equal((await request('GET', '/api/admin/analytics/monthly?year=2098&month=11')).status, 401);
  assert.equal((await request('GET', '/api/admin/analytics/monthly?year=2098&month=11', undefined, staffCookie)).status, 403);

  const invalidMonth = await request('GET', '/api/admin/analytics/monthly?year=2026&month=13', undefined, adminCookie);
  assert.equal(invalidMonth.status, 400);
  assert.equal(invalidMonth.payload.code, 'ANALYTICS_PERIOD_INVALID');
  const missingPart = await request('GET', '/api/admin/analytics/monthly?year=2026', undefined, adminCookie);
  assert.equal(missingPart.status, 400);

  putBooking({
    id: 'monthly-analytics-completed', status: 'Completed', date: '2098-11-01', serviceId: 'history-service',
    serviceName: 'Dịch vụ lưu lịch sử', userId: 'customer-1', customerName: 'PII không được trả về', customerPhone: '0987654321',
    finalPrice: 120000,
    paymentRecords: [
      { id: 'cash-start', type: 'deposit', amount: 100000, at: '2098-10-31T17:00:00.000Z' },
      { id: 'cash-refund', type: 'refund', amount: 20000, at: '2098-11-30T16:59:00.000Z' },
      { id: 'cash-invalid', type: 'payment', amount: 50000, refundable: false, at: '2098-11-15T04:00:00.000Z' },
    ],
  });
  putBooking({ id: 'monthly-analytics-cancelled', status: 'Cancelled', paymentStatus: 'cancelled', date: '2098-11-05', serviceId: 'c', finalPrice: 500000, paymentRecords: [] });

  const response = await request('GET', '/api/admin/analytics/monthly?year=2098&month=11', undefined, adminCookie);
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.analytics.metrics, {
    collected: 100000, refunded: 20000, netCashFlow: 80000,
    completedBookings: 1, cancelledBookings: 1, customersServed: 1, averageBookingValue: 120000,
  });
  assert.equal(response.payload.analytics.dailyCashFlow.length, 30);
  assert.equal(response.payload.analytics.topServices[0].name, 'Dịch vụ lưu lịch sử');
  const serialized = JSON.stringify(response.payload);
  assert.equal(serialized.includes('PII không được trả về'), false);
  assert.equal(serialized.includes('0987654321'), false);

  const empty = await request('GET', '/api/admin/analytics/monthly?year=2099&month=2', undefined, adminCookie);
  assert.equal(empty.status, 200);
  assert.equal(empty.payload.analytics.dailyCashFlow.length, 28);
  assert.deepEqual(empty.payload.analytics.metrics, {
    collected: 0, refunded: 0, netCashFlow: 0, completedBookings: 0,
    cancelledBookings: 0, customersServed: 0, averageBookingValue: 0,
  });
});
