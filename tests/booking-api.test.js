import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';

// Exercise the exported HTTP handler without listening on a port or opening the app's database.
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'serenity-booking-api-'));
process.env.SERENITY_DB_PATH = path.join(temporaryDirectory, 'test.sqlite');
const { server } = await import('../server/server.js');
const handler = server.listeners('request')[0];
const database = new DatabaseSync(process.env.SERENITY_DB_PATH);
// Successful test bookings must not create backups in server/data/backups.
database.prepare('INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  .run('last_backup_date', new Date().toISOString().slice(0, 10));

async function request(method, url, body, cookie = '') {
  const source = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const incoming = Readable.from(source);
  Object.assign(incoming, { method, url, headers: { host: 'localhost:3001', cookie }, socket: { remoteAddress: 'booking-api-test' } });
  const outgoing = {
    headers: {}, status: 0, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers = {}) {
      this.status = status;
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
      return this;
    },
    end(body = '') { this.body = body; return this; },
  };
  await handler(incoming, outgoing);
  return { status: outgoing.status, headers: outgoing.headers, payload: outgoing.body ? JSON.parse(outgoing.body) : null };
}

async function login(email, password) {
  const result = await request('POST', '/api/auth/login', { email, password });
  assert.equal(result.status, 200);
  return { user: result.payload.user, cookie: result.headers['set-cookie'].split(';')[0] };
}

function futureDate(days) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type).value;
  const date = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function futureDateOnWeekday(day, minDays = 1) {
  for (let offset = minDays; offset <= 60; offset += 1) {
    const date = futureDate(offset);
    const [year, month, dayOfMonth] = date.split('-').map(Number);
    if (new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay() === day) return date;
  }
  throw new Error('Could not find a future date for the requested weekday.');
}

function bookingBody(days = 20) {
  return { serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: futureDate(days), startTime: '10:00',
    customerName: 'Nguyễn Minh Anh', customerPhone: '0987654321', customerEmail: '', note: '', submissionKey: `booking-api-test-${days}` };
}

function readStoredBooking(id) {
  const row = database.prepare('SELECT payload FROM collection_records WHERE collection = ? AND id = ?').get('bookings', id);
  return row ? JSON.parse(row.payload) : null;
}

function writeStoredBooking(booking) {
  database.prepare('UPDATE collection_records SET payload = ? WHERE collection = ? AND id = ?')
    .run(JSON.stringify(booking), 'bookings', booking.id);
  database.prepare("INSERT INTO collection_versions(collection, version) VALUES ('bookings', 1) ON CONFLICT(collection) DO UPDATE SET version = version + 1").run();
}

function persistedState() {
  return {
    bookings: database.prepare("SELECT COUNT(*) AS total FROM collection_records WHERE collection = 'bookings'").get().total,
    users: database.prepare("SELECT COUNT(*) AS total FROM collection_records WHERE collection = 'users'").get().total,
    dedupe: database.prepare('SELECT COUNT(*) AS total FROM booking_dedupe').get().total,
    audit: database.prepare('SELECT COUNT(*) AS total FROM audit_log').get().total,
    versions: database.prepare('SELECT * FROM collection_versions ORDER BY collection').all(),
  };
}

test('Booking API requires explicit valid contact data before creating a booking', async (t) => {
  const customer = await login('khach@example.invalid', process.env.SERENITY_TEST_CUSTOMER_PASSWORD);

  await t.test('regression: logged-in customer clearing both required fields cannot book using account details', async () => {
    const before = persistedState();
    const result = await request('POST', '/api/bookings', { ...bookingBody(), customerName: '', customerPhone: '' }, customer.cookie);
    assert.equal(result.status, 400, 'empty form fields must not be replaced with the signed-in account name/phone');
    assert.equal(result.payload.code, 'VALIDATION');
    assert.ok(result.payload.fields.name);
    assert.ok(result.payload.fields.phone);
    assert.deepEqual(persistedState(), before, 'rejected booking must not write any booking, dedupe token or audit entry');
  });

  await t.test('missing, whitespace, malformed and non-text contact fields are rejected without writes', async () => {
    const invalidCases = [
      [{ customerName: undefined, customerPhone: undefined }, ['name', 'phone']],
      [{ customerName: '   ', customerPhone: ' \t ' }, ['name', 'phone']],
      [{ customerName: 'A' }, ['name']],
      [{ customerName: 'A'.repeat(61) }, ['name']],
      [{ customerPhone: '1234' }, ['phone']],
      [{ customerEmail: 'missing-at-sign' }, ['email']],
      [{ customerEmail: 'a@b.c' }, ['email']],
      [{ note: 'A'.repeat(301) }, ['note']],
      [{ customerName: ['Nguyễn Minh Anh'] }, ['name']],
      [{ customerName: { name: 'Nguyễn Minh Anh' } }, ['name']],
      [{ customerName: 1234 }, ['name']],
      [{ customerPhone: 987654321 }, ['phone']],
      [{ customerPhone: ['0987654321'] }, ['phone']],
      [{ customerEmail: ['test@example.com'] }, ['email']],
      [{ note: { message: 'test' } }, ['note']],
    ];
    for (const [changes, fields] of invalidCases) {
      const before = persistedState();
      const result = await request('POST', '/api/bookings', { ...bookingBody(21), ...changes }, customer.cookie);
      assert.equal(result.status, 400, JSON.stringify(changes));
      assert.equal(result.payload.code, 'VALIDATION');
      for (const field of fields) assert.ok(result.payload.fields[field], `${field} must have a field error`);
      assert.deepEqual(persistedState(), before);
    }
    for (const body of [null, []]) {
      const before = persistedState();
      const result = await request('POST', '/api/bookings', body, customer.cookie);
      assert.equal(result.status, 400);
      assert.deepEqual(persistedState(), before);
    }
  });

  await t.test('guest and staff booking creation are rejected', async () => {
    const before = persistedState();
    const guest = await request('POST', '/api/bookings', bookingBody());
    assert.equal(guest.status, 401);
    const staff = await login('linh@example.invalid', process.env.SERENITY_TEST_STAFF_PASSWORD);
    const staffResult = await request('POST', '/api/bookings', bookingBody(), staff.cookie);
    assert.equal(staffResult.status, 403);
    assert.deepEqual(persistedState(), before);
  });

  await t.test('invalid or missing slot inputs receive a client error without writes', async () => {
    const invalidCases = [
      { serviceId: undefined }, { serviceId: '' }, { serviceId: {} }, { serviceId: ['signature-body'] },
      { staffId: undefined }, { staffId: {} }, { staffId: ['st-01'] },
      { date: undefined }, { date: '2026-02-30' }, { date: [futureDate(23)] },
      { startTime: undefined }, { startTime: '25:00' }, { startTime: ['10:00'] },
      { duration: 14 }, { duration: 481 }, { duration: 65 }, { duration: ['60'] }, { duration: {} },
    ];
    for (const changes of invalidCases) {
      const before = persistedState();
      const result = await request('POST', '/api/bookings', { ...bookingBody(23), ...changes }, customer.cookie);
      assert.equal(result.status, 400, JSON.stringify(changes));
      assert.deepEqual(persistedState(), before);
    }
  });

  await t.test('valid contact creates a Pending booking owned by the customer and permits an identical retry', async () => {
    const body = { ...bookingBody(24), customerName: '  Nguyễn Minh Anh  ', customerPhone: ' +84 987 654 321 ', note: '  Massage nhẹ  ' };
    const created = await request('POST', '/api/bookings', body, customer.cookie);
    assert.equal(created.status, 201);
    assert.equal(created.payload.booking.status, 'Pending');
    assert.equal(created.payload.booking.userId, customer.user.id);
    assert.equal(created.payload.booking.customerName, 'Nguyễn Minh Anh');
    assert.equal(created.payload.booking.customerPhone, '0987654321');
    assert.equal(created.payload.booking.customerEmail, '', 'optional blank email must remain blank rather than use account email');
    assert.equal(created.payload.booking.note, 'Massage nhẹ');
    const beforeRetry = persistedState();
    const retried = await request('POST', '/api/bookings', body, customer.cookie);
    assert.equal(retried.status, 200);
    assert.equal(retried.payload.booking.id, created.payload.booking.id);
    assert.deepEqual(persistedState(), beforeRetry);

    const invalidRetry = await request('POST', '/api/bookings', { ...body, customerName: '', customerPhone: '' }, customer.cookie);
    assert.equal(invalidRetry.status, 400, 'dedupe lookup must not bypass required field validation');
    assert.deepEqual(persistedState(), beforeRetry);

    database.prepare('INSERT INTO booking_dedupe(token, booking_id) VALUES (?, ?)').run('legacy-booking-api-test', created.payload.booking.id);
    const beforeLegacyRetry = persistedState();
    const legacyRetry = await request('POST', '/api/bookings', { ...body, submissionKey: 'legacy-booking-api-test' }, customer.cookie);
    assert.equal(legacyRetry.status, 200, 'the same owner can retry a token from before scoping was introduced');
    assert.equal(legacyRetry.payload.booking.id, created.payload.booking.id);
    assert.deepEqual(persistedState(), beforeLegacyRetry);
  });

  await t.test('submission keys do not return another account booking', async () => {
    const secondCustomer = await login('bao@example.invalid', process.env.SERENITY_TEST_CUSTOMER_PASSWORD);
    const created = await request('POST', '/api/bookings', { ...bookingBody(25), submissionKey: 'booking-api-test-24',
      customerName: secondCustomer.user.name, customerPhone: '0987654322' }, secondCustomer.cookie);
    assert.equal(created.status, 201);
    assert.equal(created.payload.booking.userId, secondCustomer.user.id);
    assert.equal(created.payload.booking.date, futureDate(25));
    const list = await request('GET', '/api/bookings', undefined, secondCustomer.cookie);
    assert.ok(list.payload.bookings.some((booking) => booking.id === created.payload.booking.id));
    assert.ok(list.payload.bookings.every((booking) => booking.userId === secondCustomer.user.id));

    const legacyResult = await request('POST', '/api/bookings', { ...bookingBody(26), submissionKey: 'legacy-booking-api-test',
      customerName: secondCustomer.user.name, customerPhone: '0987654322' }, secondCustomer.cookie);
    assert.equal(legacyResult.status, 201, 'another account using an old unscoped token must create their own booking');
    assert.equal(legacyResult.payload.booking.userId, secondCustomer.user.id);

    const firstCustomerBooking = (await request('GET', '/api/bookings', undefined, customer.cookie)).payload.bookings.find((booking) => booking.date === futureDate(24));
    database.prepare('INSERT INTO booking_dedupe(token, booking_id) VALUES (?, ?)')
      .run(`${secondCustomer.user.id}:legacy-prefix-collision`, firstCustomerBooking.id);
    const beforeCollision = persistedState();
    const collision = await request('POST', '/api/bookings', { ...bookingBody(27), submissionKey: 'legacy-prefix-collision',
      customerName: secondCustomer.user.name, customerPhone: '0987654322' }, secondCustomer.cookie);
    assert.equal(collision.status, 409, 'an old global token resembling a new scoped token must not expose another booking');
    assert.equal(collision.payload.booking, undefined);
    assert.deepEqual(persistedState(), beforeCollision);
  });
});

test('Public registration creates a signed-in customer and rejects invalid registration data', async (t) => {
  const body = { name: 'Khách Đăng Ký Test', email: 'booking-api-registration@example.com', phone: '0911112223', password: 'Register@123' };

  await t.test('valid registration persists the customer and immediately authenticates its session cookie', async () => {
    const before = persistedState();
    const result = await request('POST', '/api/auth/register', body);
    assert.equal(result.status, 201);
    assert.equal(result.payload.user.role, 'customer');
    assert.equal(result.payload.user.name, body.name);
    assert.equal(result.payload.user.email, body.email);
    assert.equal(persistedState().users, before.users + 1);
    const saved = database.prepare("SELECT payload FROM collection_records WHERE collection = 'users' AND id = ?").get(result.payload.user.id);
    assert.equal(JSON.parse(saved.payload).role, 'customer');
    assert.ok(result.headers['set-cookie'], 'registration must return a session cookie');
    const session = await request('GET', '/api/auth/session', undefined, result.headers['set-cookie'].split(';')[0]);
    assert.equal(session.status, 200);
    assert.equal(session.payload.user.id, result.payload.user.id);
    assert.equal(session.payload.user.role, 'customer');
  });

  await t.test('missing required fields, malformed email/phone and weak passwords do not write user data', async () => {
    const invalidCases = [
      {},
      { ...body, name: undefined }, { ...body, email: undefined }, { ...body, phone: undefined }, { ...body, password: undefined },
      { ...body, name: '   ', email: ' ', phone: ' ', password: '' },
      { ...body, email: 'invalid-email' }, { ...body, phone: '12345' },
      { ...body, password: 'Password123' }, { ...body, password: 'Password@' }, { ...body, password: 'A1@' },
    ];
    for (const invalid of invalidCases) {
      const before = persistedState();
      const result = await request('POST', '/api/auth/register', invalid);
      assert.equal(result.status, 400, JSON.stringify(invalid));
      assert.equal(result.payload.code, 'VALIDATION');
      assert.deepEqual(persistedState(), before, 'invalid registration must not persist a user or alter collection versions');
    }
  });

  await t.test('public registration cannot assign admin or staff privileges from the submitted payload', async () => {
    for (const [index, role] of ['admin', 'staff'].entries()) {
      const result = await request('POST', '/api/auth/register', { ...body, role, staffId: 'st-01',
        email: `booking-api-role-${role}@example.com`, phone: `091111222${index + 4}` });
      assert.equal(result.status, 201);
      assert.equal(result.payload.user.role, 'customer');
      assert.equal(result.payload.user.staffId, undefined);
      const cookie = result.headers['set-cookie'].split(';')[0];
      const session = await request('GET', '/api/auth/session', undefined, cookie);
      assert.equal(session.payload.user.role, 'customer');
      const adminEndpoint = await request('GET', '/api/admin/staff-invites', undefined, cookie);
      assert.equal(adminEndpoint.status, 403, 'a publicly registered customer must remain forbidden from admin operations');
    }
  });
});

test('Staff capabilities keep booking access scoped and make confirmation atomic', async () => {
  const admin = await login('admin@example.invalid', process.env.SERENITY_TEST_ADMIN_PASSWORD);
  const specialist = await login('linh@example.invalid', process.env.SERENITY_TEST_STAFF_PASSWORD);
  const otherStaff = await login('nam@example.invalid', process.env.SERENITY_TEST_STAFF_PASSWORD);
  const customer = await login('khach@example.invalid', process.env.SERENITY_TEST_CUSTOMER_PASSWORD);

  const staffEscalation = await request('PATCH', '/api/admin/staff/st-01/role', { staffRole: 'senior_specialist' }, specialist.cookie);
  assert.equal(staffEscalation.status, 403, 'staff cannot raise their own role by calling the admin API');
  const otherRoleEscalation = await request('PATCH', '/api/admin/staff/st-04/role', { staffRole: 'senior_specialist' }, specialist.cookie);
  assert.equal(otherRoleEscalation.status, 403, 'staff cannot change another account\'s role');
  assert.equal((await request('GET', '/api/admin/payments/reconciliation', undefined, specialist.cookie)).status, 403,
    'staff must not access financial reconciliation data');
  const invalidRole = await request('PATCH', '/api/admin/staff/st-01/role', { staffRole: 'admin' }, admin.cookie);
  assert.equal(invalidRole.status, 400);
  const massAssignment = await request('PATCH', '/api/admin/staff/st-01/role', { staffRole: 'senior_specialist', permissions: ['*'] }, admin.cookie);
  assert.equal(massAssignment.status, 400, 'the role endpoint rejects client-supplied permissions');
  const roleUpdated = await request('PATCH', '/api/admin/staff/st-01/role', { staffRole: 'senior_specialist' }, admin.cookie);
  assert.equal(roleUpdated.status, 200);
  const updatedSession = await request('GET', '/api/auth/session', undefined, specialist.cookie);
  assert.equal(updatedSession.payload.user.staffRole, 'senior_specialist');
  assert.ok(updatedSession.payload.user.permissions.includes('booking.complete_assigned'));
  const roleList = await request('GET', '/api/admin/staff-invites', undefined, admin.cookie);
  assert.ok(roleList.payload.invitations.find((row) => row.staffId === 'st-01').permissions.includes('booking.confirm_assigned'));
  await request('PATCH', '/api/admin/staff/st-01/role', { staffRole: 'specialist' }, admin.cookie);

  const bookingPayload = { ...bookingBody(40), submissionKey: 'staff-confirm-atomic', startTime: '10:00' };
  const created = await request('POST', '/api/bookings', bookingPayload, customer.cookie);
  assert.equal(created.status, 201);
  const booking = readStoredBooking(created.payload.booking.id);
  delete booking.paymentCode;
  booking.paymentStatus = 'not_required';
  booking.revision = Number(booking.revision || 0) + 1;
  writeStoredBooking(booking);

  const [firstConfirm, secondConfirm] = await Promise.all([
    request('PATCH', `/api/bookings/${booking.id}/status`, { status: 'Confirmed' }, specialist.cookie),
    request('PATCH', `/api/bookings/${booking.id}/status`, { status: 'Confirmed' }, specialist.cookie),
  ]);
  assert.deepEqual([firstConfirm.status, secondConfirm.status].sort(), [200, 409]);
  const confirmed = readStoredBooking(booking.id);
  assert.equal(confirmed.status, 'Confirmed');
  assert.equal(confirmed.confirmedBy, specialist.user.id);
  assert.ok(confirmed.confirmedAt);
  assert.equal(confirmed.statusHistory.filter((entry) => entry.status === 'Confirmed').length, 1);
  const specialistCheckin = await request('PATCH', `/api/bookings/${booking.id}/status`, { status: 'CheckedIn' }, specialist.cookie);
  assert.equal(specialistCheckin.status, 403, 'a regular specialist cannot perform senior-specialist status actions');

  const otherBookingResult = await request('POST', '/api/bookings', {
    ...bookingBody(41), staffId: 'st-04', startTime: '13:00', submissionKey: 'staff-other-booking',
  }, customer.cookie);
  assert.equal(otherBookingResult.status, 201);
  const otherBooking = otherBookingResult.payload.booking;
  const assignedList = await request('GET', '/api/bookings', undefined, specialist.cookie);
  assert.ok(assignedList.payload.bookings.every((row) => row.staffId === 'st-01'));
  assert.ok(!assignedList.payload.bookings.some((row) => row.id === otherBooking.id), 'staff list must not include another specialist\'s booking');
  const foreignConfirm = await request('PATCH', `/api/bookings/${otherBooking.id}/status`, { status: 'Confirmed' }, specialist.cookie);
  assert.equal(foreignConfirm.status, 403);

  const declineBookingResult = await request('POST', '/api/bookings', {
    ...bookingBody(42), startTime: '14:00', submissionKey: 'staff-decline-request',
  }, customer.cookie);
  assert.equal(declineBookingResult.status, 201);
  const declineBooking = declineBookingResult.payload.booking;
  const missingReason = await request('POST', `/api/bookings/${declineBooking.id}/decline-request`, {}, specialist.cookie);
  assert.equal(missingReason.status, 400);
  assert.equal(missingReason.payload.code, 'REASON_REQUIRED');
  const missingOtherNote = await request('POST', `/api/bookings/${declineBooking.id}/decline-request`, { reason: 'other' }, specialist.cookie);
  assert.equal(missingOtherNote.status, 400);
  const wrongStaffDecline = await request('POST', `/api/bookings/${declineBooking.id}/decline-request`, { reason: 'health' }, otherStaff.cookie);
  assert.equal(wrongStaffDecline.status, 403);
  const xssNote = '<img src=x onerror=alert(1)>';
  const declined = await request('POST', `/api/bookings/${declineBooking.id}/decline-request`, { reason: 'other', note: xssNote }, specialist.cookie);
  assert.equal(declined.status, 201);
  assert.equal(declined.payload.request.smsStatus, 'not_configured');
  assert.equal(readStoredBooking(declineBooking.id).status, 'Pending', 'decline request must not cancel or delete the booking');
  const adminRequests = await request('GET', '/api/admin/booking-decline-requests', undefined, admin.cookie);
  const alert = adminRequests.payload.requests.find((row) => row.id === declined.payload.request.id);
  assert.equal(alert.customerPhone, declineBooking.customerPhone);
  assert.equal(alert.serviceName, declineBooking.serviceName);
  assert.equal(alert.note, xssNote);
  assert.equal(alert.smsStatus, 'not_configured');
  const resolved = await request('POST', `/api/admin/booking-decline-requests/${alert.id}/resolve`, { action: 'keep' }, admin.cookie);
  assert.equal(resolved.status, 200);
  assert.equal(readStoredBooking(declineBooking.id).status, 'Pending');
  const cancelByStaff = await request('PATCH', `/api/bookings/${declineBooking.id}/status`, { status: 'Cancelled' }, specialist.cookie);
  assert.equal(cancelByStaff.status, 403, 'staff cancellation must use the admin review flow');
});

test('Approved date-specific day off preserves weekly schedule and blocks new bookings', async () => {
  const admin = await login('admin@example.invalid', process.env.SERENITY_TEST_ADMIN_PASSWORD);
  const staff = await login('linh@example.invalid', process.env.SERENITY_TEST_STAFF_PASSWORD);
  const customer = await login('bao@example.invalid', process.env.SERENITY_TEST_CUSTOMER_PASSWORD);
  const offDate = futureDateOnWeekday(1, 50);
  assert.equal(new Date(`${offDate}T00:00:00Z`).getUTCDay(), 1);
  const created = await request('POST', '/api/bookings', {
    ...bookingBody(47), date: offDate, startTime: '20:00', submissionKey: 'staff-day-off-affected-booking',
  }, customer.cookie);
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const beforeStaffRow = database.prepare('SELECT payload FROM collection_records WHERE collection = ? AND id = ?').get('staff', 'st-01');
  const beforeStaff = JSON.parse(beforeStaffRow.payload);
  assert.ok(beforeStaff.workingDays.includes(1), 'the normal weekly Monday schedule is active before this exception');

  const forgedStaffId = await request('POST', '/api/staff/day-off-requests', {
    staffId: 'st-04', date: offDate, reason: 'Sức khỏe',
  }, staff.cookie);
  assert.equal(forgedStaffId.status, 400, 'staff identity must come from the authenticated account');
  const requestOff = await request('POST', '/api/staff/day-off-requests', {
    date: offDate, reason: 'Sức khỏe', note: 'Xin nghỉ một ngày.',
  }, staff.cookie);
  assert.equal(requestOff.status, 201);
  assert.equal(requestOff.payload.affectedBookings.length, 1);
  let currentStaff = JSON.parse(database.prepare('SELECT payload FROM collection_records WHERE collection = ? AND id = ?').get('staff', 'st-01').payload);
  assert.ok(!currentStaff.daysOff.includes(offDate), 'a pending request must not change availability');
  assert.deepEqual(currentStaff.workingDays, beforeStaff.workingDays);

  const pending = await request('GET', '/api/admin/staff-day-off-requests', undefined, admin.cookie);
  const dayOff = pending.payload.requests.find((row) => row.id === requestOff.payload.request.id);
  assert.equal(dayOff.affectedBookings[0].id, created.payload.booking.id);
  const blockedApproval = await request('POST', `/api/admin/staff-day-off-requests/${dayOff.id}/decision`, { decision: 'approved' }, admin.cookie);
  assert.equal(blockedApproval.status, 409);
  assert.equal(blockedApproval.payload.code, 'BOOKINGS_AFFECTED');
  assert.equal(blockedApproval.payload.impactedBookings[0].customerName, created.payload.booking.customerName);

  const reassign = await request('POST', `/api/admin/bookings/${created.payload.booking.id}/reassign`, {
    staffId: 'st-04', note: 'Chuyển để xử lý ngày nghỉ.',
  }, admin.cookie);
  assert.equal(reassign.status, 200);
  assert.equal(readStoredBooking(created.payload.booking.id).status, 'Pending');
  assert.equal(readStoredBooking(created.payload.booking.id).staffId, 'st-04');
  const approval = await request('POST', `/api/admin/staff-day-off-requests/${dayOff.id}/decision`, { decision: 'approved' }, admin.cookie);
  assert.equal(approval.status, 200);
  currentStaff = JSON.parse(database.prepare('SELECT payload FROM collection_records WHERE collection = ? AND id = ?').get('staff', 'st-01').payload);
  assert.ok(currentStaff.daysOff.includes(offDate));
  assert.deepEqual(currentStaff.workingDays, beforeStaff.workingDays, 'weekly Monday/weekday configuration must remain unchanged');

  const blockedBooking = await request('POST', '/api/bookings', {
    ...bookingBody(47), date: offDate, startTime: '12:00', submissionKey: 'staff-day-off-blocked-booking',
  }, customer.cookie);
  assert.equal(blockedBooking.status, 400);
  assert.equal(blockedBooking.payload.code, 'STAFF_UNAVAILABLE');
});

test('Staff workflow keeps 30, 60, and 90 minute booking windows intact', async () => {
  const customer = await login('khach@example.invalid', process.env.SERENITY_TEST_CUSTOMER_PASSWORD);
  const date = futureDate(55);
  const create = (serviceId, duration, startTime, key) => request('POST', '/api/bookings', {
    ...bookingBody(55), serviceId, duration, date, startTime, submissionKey: `duration-workflow-${key}`,
  }, customer.cookie);

  const thirty = await create('temple-eye-relax', 30, '10:00', '30-a');
  assert.equal(thirty.status, 201);
  const adjacentThirty = await create('temple-eye-relax', 30, '10:30', '30-b');
  assert.equal(adjacentThirty.status, 201);

  const sixty = await create('signature-body', 60, '12:00', '60-a');
  assert.equal(sixty.status, 201);
  const overlapSixty = await create('signature-body', 60, '12:30', '60-overlap');
  assert.equal(overlapSixty.status, 409);
  const adjacentSixty = await create('signature-body', 60, '13:00', '60-b');
  assert.equal(adjacentSixty.status, 201);

  const ninety = await create('signature-body', 90, '15:00', '90-a');
  assert.equal(ninety.status, 201);
  const overlapNinety = await create('signature-body', 90, '16:00', '90-overlap');
  assert.equal(overlapNinety.status, 409);
  const adjacentNinety = await create('signature-body', 90, '16:30', '90-b');
  assert.equal(adjacentNinety.status, 201);
});
