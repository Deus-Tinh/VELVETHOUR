import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { addDays, todayStr, formatVND } from '../assets/js/core/utils.js';

const directory = await mkdtemp(path.join(tmpdir(), 'serenity-holiday-api-'));
process.env.SERENITY_DB_PATH = path.join(directory, 'test.sqlite');
for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'GEMINI_API_KEY', 'OPENAI_API_KEY']) delete process.env[key];
const { server } = await import('../server/server.js');
const handler = server.listeners('request')[0];
const db = new DatabaseSync(process.env.SERENITY_DB_PATH);
db.prepare("INSERT INTO metadata(key,value) VALUES ('last_backup_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date().toISOString().slice(0, 10));
const record = (collection, id) => JSON.parse(db.prepare('SELECT payload FROM collection_records WHERE collection=? AND id=?').get(collection, id).payload);
const write = (collection, value) => db.prepare('UPDATE collection_records SET payload=? WHERE collection=? AND id=?').run(JSON.stringify(value), collection, value.id);
const seedPromos = db.prepare("SELECT * FROM collection_records WHERE collection='promotions'").all();
const originalStaff = record('staff', 'st-01');
write('staff', { ...originalStaff, workingDays: [0, 1, 2, 3, 4, 5, 6], daysOff: [] });
const basePrice = record('services', 'signature-body').variants.find((row) => row.duration === 60).price;
const holiday = addDays(todayStr(), 25);
const regular = addDays(todayStr(), 26);

async function request(method, url, body, cookie = '', origin, extraHeaders = {}) {
  const incoming = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(incoming, { method, url, headers: { host: 'localhost:3001', cookie, ...(origin ? { origin } : {}), ...extraHeaders }, socket: { remoteAddress: 'holiday-api-test' } });
  const outgoing = { headers: {}, status: 0, body: '', setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.entries(headers).forEach(([name, value]) => this.setHeader(name, value)); return this; },
    end(body = '') { this.body = body; return this; } };
  await handler(incoming, outgoing);
  return { status: outgoing.status, payload: outgoing.body ? JSON.parse(outgoing.body) : {}, headers: outgoing.headers };
}
async function login(email, password) {
  const result = await request('POST', '/api/auth/login', { email, password });
  assert.equal(result.status, 200);
  return { cookie: result.headers['set-cookie'].split(';')[0], user: result.payload.user };
}
const admin = await login('admin@example.invalid', process.env.SERENITY_TEST_ADMIN_PASSWORD);
const customer = await login('khach@example.invalid', process.env.SERENITY_TEST_CUSTOMER_PASSWORD);
const other = await login('bao@example.invalid', process.env.SERENITY_TEST_CUSTOMER_PASSWORD);
const staff = await login('linh@example.invalid', process.env.SERENITY_TEST_STAFF_PASSWORD);
function reset() {
  db.exec("DELETE FROM holiday_sale_targets; DELETE FROM holiday_sales; DELETE FROM reschedule_quotes; DELETE FROM booking_dedupe; DELETE FROM audit_log; DELETE FROM collection_records WHERE collection IN ('bookings','promotions'); DELETE FROM metadata WHERE key LIKE 'holiday-sale-request:%'");
  const insert = db.prepare('INSERT INTO collection_records VALUES (?,?,?)');
  seedPromos.forEach((row) => insert.run(row.collection, row.id, row.payload));
  db.exec("UPDATE collection_versions SET version=version+1 WHERE collection IN ('bookings','promotions','holidaySales')");
}
function sale(patch = {}) {
  return { name: 'Sale lễ thử nghiệm', occasion: 'Lễ thử nghiệm', serviceDateFrom: holiday, serviceDateTo: holiday,
    enabled: true, discountType: 'percent', percentageBps: 1500, scopeType: 'service', targets: [{ targetId: 'signature-body' }], ...patch };
}
async function createSale(patch = {}) {
  const result = await request('POST', '/api/admin/holiday-sales', { sale: sale(patch), requestId: randomUUID() }, admin.cookie);
  assert.equal(result.status, 201, JSON.stringify(result.payload));
  return result.payload.sale;
}
async function createBooking(date = regular, patch = {}) {
  const body = { serviceId: 'signature-body', duration: 60, staffId: 'st-01', date, startTime: '10:00',
    customerName: 'Khách kiểm thử', customerPhone: '0987654321', customerEmail: '', note: '', submissionKey: randomUUID(), ...patch };
  const result = await request('POST', '/api/bookings', body, customer.cookie);
  assert.equal(result.status, 201, JSON.stringify(result.payload));
  const booking = result.payload.booking;
  const payment = await sendSePayPayment(booking);
  assert.equal(payment.status, 'paid', JSON.stringify(payment));
  return record('bookings', booking.id);
}
async function sendSePayPayment(booking, amount = booking.finalPrice) {
  const response = await request('POST', '/api/payments/sepay/webhook', {
    id: `local-test-${randomUUID()}`, transferAmount: amount, transferType: 'in',
    accountNumber: process.env.SEPAY_ACCOUNT_NUMBER, content: booking.paymentCode,
    referenceCode: 'LOCAL-TEST', transactionDate: new Date().toISOString(),
  }, '', undefined, { authorization: `Apikey ${process.env.SEPAY_WEBHOOK_API_KEY}` });
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  return response.payload;
}
async function quote(booking, date, patch = {}, actor = customer) {
  const result = await request('POST', `/api/bookings/${booking.id}/reschedule/quote`, { date, startTime: '10:00', ...patch }, actor.cookie);
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  return result.payload.quote;
}
const testRefundRecipient = { bankName: 'Techcombank', accountHolder: 'TEST CUSTOMER', accountNumber: '123456789012' };
const confirm = (booking, quoteId, actor = customer) => request('POST', `/api/bookings/${booking.id}/reschedule/confirm`,
  { quoteId, refundRecipient: testRefundRecipient }, actor.cookie);
async function completeRefund(bookingId) {
  const result = await request('POST', `/api/admin/bookings/${bookingId}/refund-complete`,
    { referenceCode: `LOCAL-TEST-${randomUUID()}` }, admin.cookie);
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  return result.payload.booking;
}

test('sale writes require admin, same origin, valid targets and explicit revisions', async () => {
  reset();
  for (const [cookie, status] of [['', 401], [staff.cookie, 403], [customer.cookie, 403]]) {
    assert.equal((await request('POST', '/api/admin/holiday-sales', { sale: sale(), requestId: randomUUID() }, cookie)).status, status);
  }
  assert.equal((await request('POST', '/api/admin/holiday-sales', { sale: sale(), requestId: randomUUID() }, admin.cookie, 'https://untrusted.example')).status, 403);
  const missing = await request('POST', '/api/admin/holiday-sales', { sale: sale({ targets: [{ targetId: 'missing' }] }), requestId: randomUUID() }, admin.cookie);
  assert.equal(missing.status, 400);
  const current = await createSale();
  const result = await request('PATCH', `/api/admin/holiday-sales/${current.id}`, { patch: { enabled: false }, expectedRevision: 0, requestId: randomUUID() }, admin.cookie);
  assert.equal(result.payload.code, 'VERSION_CONFLICT');
});

test('sale creation is idempotent, audited and immediately readable; repeated keys cannot change their command', async () => {
  reset();
  const body = { sale: sale(), requestId: randomUUID() };
  const first = await request('POST', '/api/admin/holiday-sales', body, admin.cookie);
  const repeated = await request('POST', '/api/admin/holiday-sales', body, admin.cookie);
  assert.equal(first.status, 201);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.payload.sale.id, first.payload.sale.id);
  assert.equal(repeated.payload.replayed, true);
  assert.equal(first.payload.verified, true);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM holiday_sales').get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM audit_log WHERE action='holiday_sale.created'").get().count, 1);
  assert.equal((await request('POST', '/api/admin/holiday-sales', { ...body, sale: sale({ name: 'Khác' }) }, admin.cookie)).payload.code, 'REQUEST_CONFLICT');
  const fetched = await request('GET', '/api/admin/holiday-sales', undefined, admin.cookie);
  assert.equal(fetched.payload.sales[0].name, body.sale.name);
});

test('bootstrap, catalog filters and authoritative quotes use the selected service date without overwriting base prices', async () => {
  reset();
  await createSale();
  const snapshot = await request('GET', '/api/bootstrap');
  assert.equal(snapshot.payload.holidaySales.length, 1);
  const catalogService = record('services', 'signature-body');
  const result = await request('GET', `/api/services?serviceDate=${holiday}&q=Signature&maxPrice=${catalogService.price - 1}`);
  const listed = result.payload.items.find((row) => row.id === 'signature-body');
  assert.ok(listed);
  assert.equal(listed.price, catalogService.price);
  assert.equal(listed.displayPrice, catalogService.price - Math.floor(catalogService.price * 0.15));
  const ordinary = await request('GET', `/api/services?serviceDate=${regular}&q=Signature&maxPrice=${catalogService.price - 1}`);
  assert.equal(ordinary.payload.items.some((row) => row.id === 'signature-body'), false);
  const authoritative = await request('POST', '/api/pricing/quote', { serviceId: 'signature-body', duration: catalogService.duration, serviceDate: holiday });
  assert.equal(authoritative.payload.pricing.finalPrice, listed.displayPrice);
  assert.equal((await request('GET', '/api/services?serviceDate=2026-02-30')).status, 400);
});

test('customer chat quotes the chosen holiday date, retains it after reload and carries it into booking', async () => {
  reset();
  await createSale();
  const session = await request('GET', '/api/chat/session');
  const cookie = session.headers['set-cookie'].split(';')[0];
  const conversationId = session.payload.conversationId;
  db.prepare('UPDATE chat_conversations SET context=? WHERE id=?')
    .run(JSON.stringify({ ...session.payload.context, preferred_date: holiday }), conversationId);
  const chosen = await request('POST', '/api/chat/messages', { conversationId, message: 'Chọn dịch vụ này', serviceId: 'signature-body', serviceDuration: 60 }, cookie);
  assert.equal(chosen.status, 200, JSON.stringify(chosen.payload));
  const card = chosen.payload.messages[1].services[0];
  assert.equal(card.serviceDate, holiday);
  assert.equal(card.price, basePrice - Math.floor(basePrice * 0.15));
  assert.equal(card.originalPrice, basePrice);
  const reloaded = await request('GET', '/api/chat/session', undefined, cookie);
  assert.equal(reloaded.payload.messages.at(-1).services[0].price, card.price);
  const booking = await request('POST', '/api/chat/messages', { conversationId, message: 'Đặt cái đó' }, cookie);
  assert.ok(booking.payload.messages[1].actions.some((action) => action.href.includes(`date=${holiday}`)));
});

test('customer promotion inquiry includes holiday sales and explains additive voucher stacking', async () => {
  reset();
  const campaign = await createSale({ discountType: 'fixed', percentageBps: null, fixedAmountVnd: 100000 });
  const session = await request('GET', '/api/chat/session');
  const cookie = session.headers['set-cookie'].split(';')[0];
  const conversationId = session.payload.conversationId;
  db.prepare('UPDATE chat_conversations SET context=? WHERE id=?')
    .run(JSON.stringify({ ...session.payload.context, preferred_date: holiday }), conversationId);
  const inquiry = await request('POST', '/api/chat/messages', { conversationId, message: 'Spa có khuyến mãi gì?' }, cookie);
  assert.equal(inquiry.status, 200);
  const text = inquiry.payload.messages[1].text;
  assert.ok(text.includes(campaign.name));
  assert.match(text, /100[.,]000/);
  assert.match(text, /cộng thêm voucher hợp lệ trên giá niêm yết/i);
  db.prepare('UPDATE chat_conversations SET context=? WHERE id=?')
    .run(JSON.stringify({ ...inquiry.payload.context, preferred_date: regular }), conversationId);
  const ordinary = await request('POST', '/api/chat/messages', { conversationId, message: 'Spa có khuyến mãi gì?' }, cookie);
  assert.equal(ordinary.payload.messages[1].text.includes(campaign.name), false);
});

test('booking stacks the holiday sale and a valid coupon and ignores forged client totals', async () => {
  reset();
  await createSale();
  const promo = JSON.parse(seedPromos[0].payload);
  write('promotions', { ...promo, type: 'percent', value: 80, minOrder: 0, maxDiscount: 0, active: true, startDate: todayStr(), expiresAt: addDays(todayStr(), 60), usedCount: 0 });
  const booking = await createBooking(holiday, { promoCode: promo.code, finalPrice: 1, discountAmount: 999999 });
  assert.equal(booking.finalPrice, basePrice - Math.min(basePrice, Math.floor(basePrice * 0.15) + Math.floor(basePrice * 0.8)));
  assert.equal(booking.promoCode, promo.code);
  assert.equal(booking.pricingSnapshot.discountSource, 'holiday_sale_and_coupon');
  assert.equal(record('promotions', promo.id).usedCount, 1);
  assert.equal(booking.revision, 2);
});

test('stale expected booking price is rejected without booking, coupon use or dedupe writes', async () => {
  reset();
  await createSale();
  const result = await request('POST', '/api/bookings', { serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: holiday,
    startTime: '10:00', customerName: 'Khách kiểm thử', customerPhone: '0987654321', expectedFinalPrice: basePrice, submissionKey: randomUUID() }, customer.cookie);
  assert.equal(result.payload.code, 'PRICE_CHANGED');
  assert.equal(db.prepare("SELECT COUNT(*) count FROM collection_records WHERE collection='bookings'").get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM booking_dedupe').get().count, 0);
});

test('reschedule quote changes nothing; explicit confirmation reprices and repeated confirmation writes only once', async () => {
  reset();
  await createSale();
  const booking = await createBooking();
  const before = JSON.stringify(record('bookings', booking.id));
  const proposed = await quote(booking, holiday);
  assert.equal(JSON.stringify(record('bookings', booking.id)), before);
  assert.equal(proposed.newPricing.finalPrice, basePrice - Math.floor(basePrice * 0.15));
  assert.equal(proposed.settlement.refundDue, Math.floor(basePrice * 0.15));
  const [first, second] = await Promise.all([confirm(booking, proposed.id), confirm(booking, proposed.id)]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(record('bookings', booking.id).date, holiday);
  assert.equal(record('bookings', booking.id).rescheduleHistory.length, 1);
  assert.equal(first.payload.booking.finalPrice, proposed.newPricing.finalPrice);
  assert.equal(first.payload.booking.revision, 3);
  assert.equal(first.payload.refundRequest.amount, Math.floor(basePrice * 0.15));
  assert.equal(db.prepare("SELECT COUNT(*) count FROM audit_log WHERE action='booking.rescheduled'").get().count, 1);
});

test('moving off a holiday or onto another holiday recalculates instead of carrying the old discount', async () => {
  reset();
  await createSale();
  await createSale({ name: 'Lễ khác', serviceDateFrom: regular, serviceDateTo: regular, percentageBps: 2500 });
  const booking = await createBooking(holiday);
  const next = await quote(booking, regular);
  assert.equal(next.newPricing.discountAmount, Math.floor(basePrice * 0.25));
  const nextResult = await confirm(booking, next.id);
  assert.equal(nextResult.status, 200);
  assert.equal(nextResult.payload.refundRequest.amount, Math.floor(basePrice * 0.10));
  await completeRefund(booking.id);
  const ordinary = await quote(booking, addDays(regular, 1));
  assert.equal(ordinary.newPricing.discountSource, 'none');
  assert.equal(ordinary.newPricing.finalPrice, basePrice);
  const adjustment = await confirm(booking, ordinary.id);
  assert.equal(adjustment.status, 200);
  assert.equal(adjustment.payload.paymentRequired, true);
  assert.equal(record('bookings', booking.id).date, regular, 'the previous appointment remains until the exact adjustment is paid');
  const paidAdjustment = await sendSePayPayment(booking, adjustment.payload.paymentAmount);
  assert.equal(paidAdjustment.status, 'paid');
  assert.equal(record('bookings', booking.id).date, addDays(regular, 1));
});

test('old reschedule endpoint, other customers, staff and cross-actor quote confirmation cannot bypass consent', async () => {
  reset();
  const booking = await createBooking();
  const old = await request('PATCH', `/api/bookings/${booking.id}/reschedule`, { date: holiday, startTime: '10:00', confirmed: true }, customer.cookie);
  assert.equal(old.payload.code, 'QUOTE_REQUIRED');
  for (const actor of [other, staff]) {
    assert.equal((await request('POST', `/api/bookings/${booking.id}/reschedule/quote`, { date: holiday, startTime: '10:00' }, actor.cookie)).status, 403);
  }
  const proposed = await quote(booking, holiday);
  assert.equal((await confirm(booking, proposed.id, admin)).payload.code, 'QUOTE_FORBIDDEN');
  assert.equal(record('bookings', booking.id).date, regular);
});

test('campaign changes and newly added campaigns invalidate previously shown reschedule prices', async () => {
  reset();
  const booking = await createBooking();
  const proposed = await quote(booking, holiday);
  await createSale();
  assert.equal((await confirm(booking, proposed.id)).payload.code, 'QUOTE_STALE');
  assert.equal(record('bookings', booking.id).date, regular);
  const refreshed = await quote(booking, holiday);
  const current = (await request('GET', '/api/admin/holiday-sales', undefined, admin.cookie)).payload.sales[0];
  const stopped = await request('PATCH', `/api/admin/holiday-sales/${current.id}`, { patch: { enabled: false }, expectedRevision: current.revision, requestId: randomUUID() }, admin.cookie);
  assert.equal(stopped.status, 200);
  assert.equal((await confirm(booking, refreshed.id)).payload.code, 'QUOTE_STALE');
});

test('payment updates invalidate settlement and a reduced price creates refund due without recording a refund', async () => {
  reset();
  await createSale();
  const booking = await createBooking();
  const proposed = await quote(booking, holiday);
  const payment = await sendSePayPayment(booking, 100000);
  assert.equal(payment.status, 'extra_payment');
  assert.equal((await confirm(booking, proposed.id)).payload.code, 'QUOTE_STALE');
  const refreshed = await quote(booking, holiday);
  assert.equal(refreshed.settlement.refundDue, Math.floor(basePrice * 0.15));
  const result = await confirm(booking, refreshed.id);
  assert.equal(result.status, 200);
  assert.equal(result.payload.booking.paymentRecords.length, 2);
  assert.equal(result.payload.booking.paymentRecords[0].type, 'payment');
  assert.equal(result.payload.booking.paymentRecords[1].refundable, false);
});

test('expired quotes and slots taken during confirmation never overwrite the original booking', async () => {
  reset();
  const booking = await createBooking();
  const expired = await quote(booking, holiday);
  db.prepare('UPDATE reschedule_quotes SET created_at=?, expires_at=? WHERE id=?').run(new Date(Date.now() - 360000).toISOString(), new Date(Date.now() - 1000).toISOString(), expired.id);
  // Keep the table interval valid while simulating a quote created several minutes ago.
  const blocked = await confirm(booking, expired.id);
  assert.equal(blocked.payload.code, 'QUOTE_EXPIRED');
  const proposed = await quote(booking, holiday);
  await createBooking(holiday);
  assert.equal((await confirm(booking, proposed.id)).payload.code, 'BOOKING_CONFLICT');
  assert.equal(record('bookings', booking.id).date, regular);
});

test('explicit coupon reapplication on reschedule does not consume the same booking redemption twice', async () => {
  reset();
  const promo = JSON.parse(seedPromos[0].payload);
  write('promotions', { ...promo, type: 'percent', value: 10, minOrder: 0, maxDiscount: 0, active: true, startDate: todayStr(), expiresAt: addDays(todayStr(), 60), usageLimit: 1, usedCount: 0 });
  const booking = await createBooking(regular, { promoCode: promo.code });
  assert.equal(record('promotions', promo.id).usedCount, 1);
  const proposed = await quote(booking, holiday, { promoCode: promo.code });
  assert.equal(proposed.newPricing.promoCode, promo.code);
  assert.equal(record('promotions', promo.id).usedCount, 1);
  assert.equal((await confirm(booking, proposed.id)).status, 200);
  assert.equal(record('promotions', promo.id).usedCount, 1);
  const without = await quote(booking, addDays(regular, 2));
  assert.equal(without.newPricing.promoCode, null);
});

async function mockAgent(toolName, args, message, { failAfterTool = false, finalReply = 'Đã kiểm tra yêu cầu trên máy chủ.' } = {}) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let advertisedTools = [];
  process.env.AI_PROVIDER = 'gemini'; process.env.AI_API_KEY = 'test-only-key'; process.env.AI_MODEL = 'test-model';
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    advertisedTools = payload.tools[0].functionDeclarations.map((row) => row.name);
    calls += 1;
    if (calls > 1 && failAfterTool) throw new Error('Simulated AI failure after a committed write.');
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: calls === 1
      ? [{ functionCall: { name: toolName, args } }] : [{ text: finalReply }] } }] }) };
  };
  try {
    const requestBody = { conversationId: randomUUID(), requestId: randomUUID(), message };
    const response = await request('POST', '/api/admin/agent/messages', requestBody, admin.cookie);
    assert.equal(response.status, 200, JSON.stringify(response.payload));
    assert.equal(advertisedTools.some((name) => /confirm_reschedule/.test(name)), false);
    return { ...response, requestBody };
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL']) delete process.env[key];
  }
}

test('admin agent creates a verified sale through declared tools and returns an authoritative receipt', async () => {
  reset();
  const response = await mockAgent('create_holiday_sale', { sale: sale() }, `Tạo sale giảm 15% cho Signature Body Massage ngày ${holiday}.`);
  assert.equal(response.payload.actions.length, 1);
  assert.equal(response.payload.actions[0].verified, true);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM holiday_sales').get().count, 1);
});

test('admin agent uses authoritative quote dates and prices and cannot move a booking itself', async () => {
  reset();
  await createSale();
  const booking = await createBooking();
  const response = await mockAgent('quote_reschedule_booking', { booking_ref: booking.code, date: holiday, start_time: '10:00' }, `Dời lịch ${booking.code} sang ${holiday} lúc 10:00.`,
    { finalReply: 'Đã dời xong sang 2023-10-23, giá 1 đồng.' });
  assert.equal(response.payload.quotes.length, 1);
  assert.equal(response.payload.reply.includes('2023-10-23'), false, 'model text must not contradict the saved quote');
  assert.ok(response.payload.reply.includes(regular));
  assert.ok(response.payload.reply.includes(holiday));
  assert.ok(response.payload.reply.includes(formatVND(response.payload.quotes[0].settlement.oldFinalPrice)));
  assert.ok(response.payload.reply.includes(formatVND(response.payload.quotes[0].settlement.newFinalPrice)));
  assert.match(response.payload.reply, /Xác nhận thay đổi giá/);
  const history = await request('GET', `/api/admin/agent/conversations/${response.requestBody.conversationId}`, undefined, admin.cookie);
  assert.equal(history.payload.messages.at(-1).content, response.payload.reply);
  assert.equal(record('bookings', booking.id).date, regular);
  const confirmed = await confirm(booking, response.payload.quotes[0].id, admin);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.payload.booking.date, holiday);
});

test('AI failure after saving returns verified effects; retry reuses the receipt without another provider call', async () => {
  reset();
  const response = await mockAgent('create_holiday_sale', { sale: sale() }, `Tạo sale 15% ngày ${holiday}.`, { failAfterTool: true });
  assert.equal(response.payload.actions[0].verified, true);
  const repeated = await request('POST', '/api/admin/agent/messages', response.requestBody, admin.cookie);
  assert.equal(repeated.status, 200, 'cached receipt must work even after AI has been disabled');
  assert.deepEqual(repeated.payload.actions, response.payload.actions);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM holiday_sales').get().count, 1);
  const changed = await request('POST', '/api/admin/agent/messages', { ...response.requestBody, message: 'Tạo sale khác' }, admin.cookie);
  assert.equal(changed.payload.code, 'REQUEST_CONFLICT');
});

test('legacy guest bookings retain phone-bound quote confirmation without leaking the phone into quotes', async () => {
  reset();
  const booking = await createBooking();
  write('bookings', { ...booking, userId: null });
  const result = await request('POST', `/api/bookings/${booking.id}/reschedule/quote`, { date: holiday, startTime: '10:00', phone: booking.customerPhone });
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result.payload.quote).includes(booking.customerPhone), false);
  const bad = await request('POST', `/api/bookings/${booking.id}/reschedule/confirm`, { quoteId: result.payload.quote.id, phone: '0911111111' });
  assert.equal(bad.status, 403);
  const accepted = await request('POST', `/api/bookings/${booking.id}/reschedule/confirm`,
    { quoteId: result.payload.quote.id, phone: booking.customerPhone, refundRecipient: testRefundRecipient });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.payload.booking.date, holiday);
});
