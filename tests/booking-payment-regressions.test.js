import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

process.env.NODE_ENV = 'test';
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'serenity-payment-regressions-'));
process.env.SERENITY_DB_PATH = path.join(temporaryDirectory, 'api-test.sqlite');
const { server } = await import('../server/server.js');
const database = new DatabaseSync(process.env.SERENITY_DB_PATH);
database.prepare("INSERT INTO metadata(key,value) VALUES ('last_backup_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
  .run(new Date().toISOString().slice(0, 10));

const readRecord = (collection, id) => {
  const row = database.prepare('SELECT payload FROM collection_records WHERE collection=? AND id=?').get(collection, id);
  return row ? JSON.parse(row.payload) : null;
};
const writeRecord = (collection, record) => database.prepare(`INSERT INTO collection_records(collection,id,payload) VALUES (?,?,?)
  ON CONFLICT(collection,id) DO UPDATE SET payload=excluded.payload`).run(collection, record.id, JSON.stringify(record));
const allRecords = (collection) => database.prepare('SELECT payload FROM collection_records WHERE collection=? ORDER BY rowid').all(collection).map((row) => JSON.parse(row.payload));
const bookingCount = () => Number(database.prepare("SELECT COUNT(*) count FROM collection_records WHERE collection='bookings'").get().count);

for (const staff of allRecords('staff')) {
  writeRecord('staff', { ...staff, workingDays: [0, 1, 2, 3, 4, 5, 6], daysOff: [],
    specialties: [...new Set([...(staff.specialties || []), 'body-massages'])] });
}

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;

async function request(method, endpoint, body, cookie = '', extraHeaders = {}) {
  const headers = new Headers({ origin, ...extraHeaders });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(new URL(endpoint, origin), {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  return { status: response.status, payload: raw ? JSON.parse(raw) : null,
    cookie: response.headers.getSetCookie?.()[0]?.split(';')[0] || '' };
}

async function login(email, password) {
  const result = await request('POST', '/api/auth/login', { email, password });
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.ok(result.cookie);
  return { cookie: result.cookie, user: result.payload.user };
}

const customer = await login('khach@example.invalid', process.env.SERENITY_TEST_CUSTOMER_PASSWORD);
const admin = await login('admin@example.invalid', process.env.SERENITY_TEST_ADMIN_PASSWORD);
const testRefundRecipient = { bankName: 'Techcombank', accountHolder: 'TEST CUSTOMER', accountNumber: '123456789012' };

function localToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function addDays(date, count) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
}
function futureDate(days) { return addDays(localToday(), days); }

function bookingBody(date = futureDate(20), patch = {}) {
  return { serviceId: 'signature-body', duration: 60, staffId: 'st-01', date, startTime: '10:00',
    customerName: 'Khách API kiểm thử', customerPhone: '0987654321', customerEmail: '', note: '',
    submissionKey: `payment-regression-${randomUUID()}`, ...patch };
}
async function createBooking(date, patch = {}) {
  const result = await request('POST', '/api/bookings', bookingBody(date, patch), customer.cookie);
  assert.equal(result.status, 201, JSON.stringify(result.payload));
  assert.equal(result.payload.booking.status, 'Pending');
  assert.equal(result.payload.booking.paymentStatus, 'awaiting_payment');
  return result.payload.booking;
}
async function sendPayment(booking, amount = booking.finalPrice, id = `local-test-${randomUUID()}`, paymentCode = booking.paymentCode) {
  const result = await request('POST', '/api/payments/sepay/webhook', {
    id, transferAmount: amount, transferType: 'in', accountNumber: process.env.SEPAY_ACCOUNT_NUMBER,
    content: paymentCode, referenceCode: 'LOCAL-TEST', transactionDate: new Date().toISOString(),
  }, '', { authorization: `Apikey ${process.env.SEPAY_WEBHOOK_API_KEY}` });
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  return result.payload;
}
async function cancel(booking, refund = false) {
  return request('POST', `/api/bookings/${booking.id}/cancel`, refund ? { refundRecipient: testRefundRecipient } : {}, customer.cookie);
}

async function withFrozenTime(iso, callback) {
  const NativeDate = globalThis.Date;
  let milliseconds = NativeDate.parse(iso);
  class FrozenDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [milliseconds])); }
    static now() { return milliseconds; }
  }
  globalThis.Date = FrozenDate;
  try { return await callback((value) => { milliseconds = NativeDate.parse(value); }); }
  finally { globalThis.Date = NativeDate; }
}

test('10. Booking remains Pending/awaiting_payment until an exact-code full-payment webhook confirms it', async () => {
  const booking = await createBooking(futureDate(20));
  const createdMs = Date.parse(booking.createdAt);
  const expiryMs = Date.parse(booking.paymentExpiresAt);
  assert.ok(expiryMs - createdMs >= 180_000 && expiryMs - createdMs <= 180_010);
  const details = await request('GET', `/api/bookings/${booking.id}/payment`, undefined, customer.cookie);
  assert.equal(details.status, 200);
  assert.equal(details.payload.payment.paymentStatus, 'awaiting_payment');
  assert.equal(details.payload.instructions.holdSeconds, 180);
  assert.equal(new URL(details.payload.instructions.qrUrl).searchParams.get('des'), booking.paymentCode);

  const wrongCode = await sendPayment(booking, booking.finalPrice, `local-wrong-code-${randomUUID()}`, 'WRONG-CODE');
  assert.equal(wrongCode.status, 'unmatched');
  assert.equal(readRecord('bookings', booking.id).status, 'Pending');

  const eventId = `local-valid-${randomUUID()}`;
  const paid = await sendPayment(booking, booking.finalPrice, eventId);
  assert.equal(paid.status, 'paid');
  const confirmed = readRecord('bookings', booking.id);
  assert.equal(confirmed.status, 'Confirmed');
  assert.equal(confirmed.paymentStatus, 'paid');
  assert.equal(confirmed.paymentRecords[0].amount, booking.finalPrice);
  const duplicate = await sendPayment(booking, booking.finalPrice, eventId);
  assert.equal(duplicate.duplicate, true, 'replayed provider transaction must not write twice');
  assert.equal(readRecord('bookings', booking.id).paymentRecords.length, 1);
});

test('11. Overlapping booking is rejected while the first booking holds its slot', async () => {
  const date = futureDate(21);
  const first = await createBooking(date, { submissionKey: randomUUID(), startTime: '10:00' });
  const conflict = await request('POST', '/api/bookings', bookingBody(date, { submissionKey: randomUUID(), startTime: '10:30' }), customer.cookie);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.payload.code, 'BOOKING_CONFLICT');
  assert.equal(readRecord('bookings', first.id).paymentStatus, 'awaiting_payment');
});

test('12. Adjacent booking windows are accepted without a false overlap', async () => {
  const date = futureDate(22);
  const first = await createBooking(date, { submissionKey: randomUUID(), startTime: '10:00' });
  const adjacent = await request('POST', '/api/bookings', bookingBody(date, { submissionKey: randomUUID(), startTime: '11:00' }), customer.cookie);
  assert.equal(adjacent.status, 201, JSON.stringify(adjacent.payload));
  assert.notEqual(adjacent.payload.booking.id, first.id);
  assert.equal(adjacent.payload.booking.startTime, '11:00');
  assert.equal(adjacent.payload.booking.paymentStatus, 'awaiting_payment');
});

test('17. Underpayment is not confirmed/refunded; customer cancellation refunds 50% of the paid amount', async () => {
  const underpaid = await createBooking(futureDate(23));
  const issue = await sendPayment(underpaid, underpaid.finalPrice - 1);
  assert.equal(issue.status, 'underpaid');
  const rejected = readRecord('bookings', underpaid.id);
  assert.equal(rejected.status, 'Cancelled');
  assert.equal(rejected.paymentStatus, 'payment_issue');
  assert.equal(rejected.paymentIssue.noRefund, true);
  assert.equal(rejected.refundRequest, undefined);

  const unpaid = await createBooking(futureDate(24));
  const unpaidCancel = await cancel(unpaid);
  assert.equal(unpaidCancel.status, 200);
  assert.equal(unpaidCancel.payload.booking.status, 'Cancelled');
  assert.equal(unpaidCancel.payload.booking.refundRequest, undefined);

  const paid = await createBooking(futureDate(25));
  assert.equal((await sendPayment(paid)).status, 'paid');
  const cancelled = await cancel(readRecord('bookings', paid.id), true);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.payload));
  assert.equal(cancelled.payload.booking.status, 'Cancelled');
  assert.equal(cancelled.payload.booking.refundRequest.paidAmount, paid.finalPrice);
  assert.equal(cancelled.payload.booking.refundRequest.amount, Math.round(paid.finalPrice / 2));
  assert.equal(cancelled.payload.booking.refundRequest.status, 'pending');
});

test('18. Paid status transitions work; unpaid confirmation and reverse transitions are blocked', async () => {
  const booking = await createBooking(futureDate(26));
  const premature = await request('POST', `/api/bookings/${booking.id}/status`, { status: 'Confirmed' }, admin.cookie);
  assert.equal(premature.status, 409);
  assert.equal(premature.payload.code, 'PAYMENT_REQUIRED');
  assert.equal((await sendPayment(booking)).status, 'paid');
  const checkedIn = await request('POST', `/api/bookings/${booking.id}/status`, { status: 'CheckedIn' }, admin.cookie);
  assert.equal(checkedIn.status, 200);
  const completed = await request('POST', `/api/bookings/${booking.id}/status`, { status: 'Completed' }, admin.cookie);
  assert.equal(completed.status, 200);
  const reverse = await request('POST', `/api/bookings/${booking.id}/status`, { status: 'Pending' }, admin.cookie);
  assert.equal(reverse.status, 409);
  assert.equal(reverse.payload.code, 'STATUS_INVALID');
});

test('43. Same time is allowed for another staff member and after cancelling an unpaid hold', async () => {
  const date = futureDate(27);
  const first = await createBooking(date, { submissionKey: randomUUID(), staffId: 'st-01' });
  const otherStaff = await request('POST', '/api/bookings', bookingBody(date, { submissionKey: randomUUID(), staffId: 'st-04' }), customer.cookie);
  assert.equal(otherStaff.status, 201, JSON.stringify(otherStaff.payload));
  assert.equal(otherStaff.payload.booking.staffId, 'st-04');
  assert.equal((await cancel(first)).status, 200);
  const replacement = await request('POST', '/api/bookings', bookingBody(date, { submissionKey: randomUUID(), staffId: 'st-01' }), customer.cookie);
  assert.equal(replacement.status, 201, JSON.stringify(replacement.payload));
  assert.equal(replacement.payload.booking.startTime, '10:00');
});

test('45. Exact 30-minute lead is accepted; earlier, closed-date and too-far bookings are rejected', async () => {
  await withFrozenTime('2026-11-02T02:31:00.000Z', async (setTime) => {
    const date = '2026-11-02';
    const tooSoon = await request('POST', '/api/bookings', bookingBody(date, { submissionKey: randomUUID(), startTime: '10:00' }), customer.cookie);
    assert.equal(tooSoon.status, 400);
    assert.equal(tooSoon.payload.code, 'PAST_TIME');
    setTime('2026-11-02T02:30:00.000Z');
    const exact = await request('POST', '/api/bookings', bookingBody(date, { submissionKey: randomUUID(), startTime: '10:00' }), customer.cookie);
    assert.equal(exact.status, 201, JSON.stringify(exact.payload));
    assert.equal(exact.payload.booking.startTime, '10:00');

    const settings = readRecord('settings', 'main');
    writeRecord('settings', { ...settings, closedDates: [...new Set([...(settings.closedDates || []), '2026-11-03'])] });
    const closed = await request('POST', '/api/bookings', bookingBody('2026-11-03', { submissionKey: randomUUID() }), customer.cookie);
    assert.equal(closed.status, 400);
    assert.equal(closed.payload.code, 'SPA_CLOSED');
    const far = await request('POST', '/api/bookings', bookingBody('2027-01-02', { submissionKey: randomUUID() }), customer.cookie);
    assert.equal(far.status, 400);
    assert.equal(far.payload.code, 'ADVANCE_LIMIT');
    writeRecord('settings', settings);
  });
});

test('46. Retry is idempotent and client-supplied prices cannot alter the server price', async () => {
  const body = bookingBody(futureDate(28), { submissionKey: `retry-${randomUUID()}`, originalPrice: 1, discountAmount: 999999, finalPrice: 0 });
  const before = bookingCount();
  const created = await request('POST', '/api/bookings', body, customer.cookie);
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.booking.originalPrice, 490000);
  assert.equal(created.payload.booking.discountAmount, 0);
  assert.equal(created.payload.booking.finalPrice, 490000);
  const retry = await request('POST', '/api/bookings', body, customer.cookie);
  assert.equal(retry.status, 200);
  assert.equal(retry.payload.booking.id, created.payload.booking.id);
  assert.equal(bookingCount(), before + 1);
  assert.equal(readRecord('bookings', created.payload.booking.id).paymentStatus, 'awaiting_payment');
});

test('48. Cancellation boundary accepts exactly two hours and rejects one minute later', async () => {
  await withFrozenTime('2026-11-03T02:30:00.000Z', async (setTime) => {
    const settings = readRecord('settings', 'main');
    writeRecord('settings', { ...settings, cancelBeforeHours: 2 });
    const date = '2026-11-03';
    const exact = await createBooking(date, { submissionKey: randomUUID(), startTime: '11:30' });
    const accepted = await cancel(exact);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.payload));
    assert.equal(accepted.payload.booking.status, 'Cancelled');

    setTime('2026-11-03T02:31:00.000Z');
    const late = await createBooking(date, { submissionKey: randomUUID(), startTime: '11:30' });
    const rejected = await cancel(late);
    assert.equal(rejected.status, 409);
    assert.equal(rejected.payload.code, 'CANCEL_TOO_LATE');
    writeRecord('settings', settings);
  });
});

test('51. Cross-service promotion, payment, status, review, revenue record and soft deactivation persist', async () => {
  const originalServices = allRecords('services');
  const base = readRecord('services', 'signature-body');
  const serviceId = `api-test-service-${randomUUID()}`;
  const testService = { ...base, id: serviceId, name: 'Isolated API payment test service', duration: 60, price: 500000,
    variants: [{ duration: 60, price: 500000 }], active: true, rating: 0, reviewsCount: 0, imageUrl: undefined };
  const addService = await request('PUT', '/api/admin/collections/services', { records: [...originalServices, testService] }, admin.cookie,
    { 'if-match': String(database.prepare("SELECT version FROM collection_versions WHERE collection='services'").get().version) });
  assert.equal(addService.status, 200, JSON.stringify(addService.payload));

  const promo = { id: `promo-${randomUUID()}`, code: `API${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
    type: 'fixed', value: 50000, minOrder: 0, maxDiscount: 50000, startDate: localToday(), expiresAt: addDays(localToday(), 60),
    usageLimit: 5, usedCount: 0, active: true, description: 'Isolated integration test' };
  const addPromo = await request('PUT', '/api/admin/collections/promotions', { records: [...allRecords('promotions'), promo] }, admin.cookie,
    { 'if-match': String(database.prepare("SELECT version FROM collection_versions WHERE collection='promotions'").get().version) });
  assert.equal(addPromo.status, 200, JSON.stringify(addPromo.payload));

  const date = futureDate(35);
  const create = await request('POST', '/api/bookings', bookingBody(date, { serviceId, promoCode: promo.code, originalPrice: 1, finalPrice: 1 }), customer.cookie);
  assert.equal(create.status, 201, JSON.stringify(create.payload));
  const booking = create.payload.booking;
  assert.equal(booking.originalPrice, 500000);
  assert.equal(booking.discountAmount, 50000);
  assert.equal(booking.finalPrice, 450000);
  assert.equal(readRecord('promotions', promo.id).usedCount, 1);
  assert.equal((await sendPayment(booking)).status, 'paid');
  assert.equal((await request('POST', `/api/bookings/${booking.id}/status`, { status: 'CheckedIn' }, admin.cookie)).status, 200);
  assert.equal((await request('POST', `/api/bookings/${booking.id}/status`, { status: 'Completed' }, admin.cookie)).status, 200);
  const review = await request('POST', '/api/reviews', { bookingId: booking.id, rating: 5, comment: 'API regression test' }, customer.cookie);
  assert.equal(review.status, 201, JSON.stringify(review.payload));
  assert.equal((await request('POST', '/api/reviews', { bookingId: booking.id, rating: 5 }, customer.cookie)).status, 409);
  assert.equal(readRecord('bookings', booking.id).paymentRecords[0].amount, 450000, 'paid total is the auditable revenue source');

  const currentServices = allRecords('services');
  const repriced = currentServices.map((service) => service.id === serviceId
    ? { ...service, price: 600000, variants: [{ duration: 60, price: 600000 }] } : service);
  const priceUpdate = await request('PUT', '/api/admin/collections/services', { records: repriced }, admin.cookie,
    { 'if-match': String(database.prepare("SELECT version FROM collection_versions WHERE collection='services'").get().version) });
  assert.equal(priceUpdate.status, 200);
  assert.equal(readRecord('bookings', booking.id).finalPrice, 450000, 'a later catalog price cannot rewrite a paid snapshot');

  const deactivated = repriced.map((service) => service.id === serviceId ? { ...service, active: false } : service);
  const softDelete = await request('PUT', '/api/admin/collections/services', { records: deactivated }, admin.cookie,
    { 'if-match': String(database.prepare("SELECT version FROM collection_versions WHERE collection='services'").get().version) });
  assert.equal(softDelete.status, 200);
  assert.equal(readRecord('services', serviceId).active, false);
  assert.equal(readRecord('bookings', booking.id).status, 'Completed');
  assert.equal(readRecord('bookings', booking.id).finalPrice, 450000);
});

test('52. Promotion reservation increments once, expires after 180 seconds and becomes available again', async () => {
  const promo = { id: `promo-${randomUUID()}`, code: `LIMIT${randomUUID().replaceAll('-', '').slice(0, 7).toUpperCase()}`,
    type: 'fixed', value: 10000, minOrder: 0, maxDiscount: 10000, startDate: localToday(), expiresAt: addDays(localToday(), 60),
    usageLimit: 1, usedCount: 0, active: true, description: 'One-use isolated test' };
  writeRecord('promotions', promo);
  const date = futureDate(58);
  const body = bookingBody(date, { promoCode: promo.code, submissionKey: `promo-once-${randomUUID()}` });
  const first = await request('POST', '/api/bookings', body, customer.cookie);
  assert.equal(first.status, 201, JSON.stringify(first.payload));
  assert.equal(readRecord('promotions', promo.id).usedCount, 1);
  const retry = await request('POST', '/api/bookings', body, customer.cookie);
  assert.equal(retry.status, 200);
  assert.equal(retry.payload.booking.id, first.payload.booking.id);
  assert.equal(readRecord('promotions', promo.id).usedCount, 1);

  const beforeBlocked = bookingCount();
  const blocked = await request('POST', '/api/bookings', bookingBody(futureDate(59), { promoCode: promo.code }), customer.cookie);
  assert.notEqual(blocked.status, 201);
  assert.equal(bookingCount(), beforeBlocked, 'usage-limit rejection must not persist a booking');

  const expiredBooking = readRecord('bookings', first.payload.booking.id);
  writeRecord('bookings', { ...expiredBooking, paymentExpiresAt: new Date(Date.now() - 1).toISOString() });
  const expired = await request('GET', `/api/bookings/${expiredBooking.id}/payment`, undefined, customer.cookie);
  assert.equal(expired.status, 200);
  assert.equal(expired.payload.payment.paymentStatus, 'expired');
  assert.equal(readRecord('bookings', expiredBooking.id).status, 'Cancelled');
  assert.equal(readRecord('promotions', promo.id).usedCount, 0, 'expiration releases the reserved coupon use');

  const replacement = await request('POST', '/api/bookings', bookingBody(futureDate(59), { promoCode: promo.code }), customer.cookie);
  assert.equal(replacement.status, 201, JSON.stringify(replacement.payload));
  assert.equal(readRecord('promotions', promo.id).usedCount, 1);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
  // The server module keeps its SQLite handle open for the process lifetime; Windows cannot unlink it.
  await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch((error) => { if (process.platform !== 'win32' || !['EBUSY', 'EPERM'].includes(error.code)) throw error; });
});
