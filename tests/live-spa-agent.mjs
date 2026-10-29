// Explicit opt-in integration check. Never included in npm test; uses Gemini and a fresh temporary database.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { todayStr, addDays, formatVND } from '../assets/js/core/utils.js';
import { redactContactText } from '../server/contactRedaction.js';

if (!process.argv.includes('--live')) {
  console.error('Opt in explicitly: node --env-file-if-exists=.env tests/live-spa-agent.mjs --live [--case update] [--model MODEL]');
  process.exit(2);
}
const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const selectedCases = option('--case')?.split(',');
if (option('--model')) process.env.AI_MODEL = option('--model');
if (process.env.AI_PROVIDER !== 'gemini' || !(process.env.GEMINI_API_KEY || process.env.AI_API_KEY)) throw new Error('Configure a Gemini provider before live testing.');

const directory = await mkdtemp(path.join(tmpdir(), 'serenity-agent-live-'));
process.env.SERENITY_DB_PATH = path.join(directory, 'test.sqlite');
assert.ok(path.resolve(process.env.SERENITY_DB_PATH).startsWith(`${path.resolve(tmpdir())}${path.sep}`));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const redact = (value) => {
  let safe = String(value || '');
  for (const name of ['AI_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY']) if (process.env[name]) safe = safe.split(process.env[name]).join('<REDACTED>');
  return redactContactText(safe);
};
const realFetch = globalThis.fetch;
let providerEvents = [];
globalThis.fetch = async (url, options) => {
  const started = Date.now();
  const model = decodeURIComponent(new URL(url).pathname.split('/').at(-1).split(':')[0]);
  try {
    const response = await realFetch(url, options);
    const payload = await response.clone().json().catch(() => ({}));
    const candidate = payload.candidates?.[0];
    const event = { model, elapsedMs: Date.now() - started, httpStatus: response.status, errorStatus: payload.error?.status,
      finishReason: candidate?.finishReason, tools: (candidate?.content?.parts || []).filter((part) => part.functionCall).map((part) => part.functionCall.name) };
    providerEvents.push(event);
    console.log(JSON.stringify({ provider: event }));
    return response;
  } catch (error) {
    const event = { model, elapsedMs: Date.now() - started, error: error.name };
    providerEvents.push(event); console.log(JSON.stringify({ provider: event })); throw error;
  }
};
const { server } = await import('../server/server.js');
const handler = server.listeners('request')[0];
const db = new DatabaseSync(process.env.SERENITY_DB_PATH);
db.prepare("INSERT INTO metadata(key,value) VALUES ('last_backup_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date().toISOString().slice(0, 10));

async function request(method, url, body, cookie = '') {
  const incoming = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(incoming, { method, url, headers: { host: 'localhost:3001', cookie }, socket: { remoteAddress: 'isolated-live-agent-test' } });
  const outgoing = { status: 0, headers: {}, body: '', setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.entries(headers).forEach(([name, value]) => this.setHeader(name, value)); return this; }, end(body = '') { this.body = body; } };
  await handler(incoming, outgoing);
  return { status: outgoing.status, payload: outgoing.body ? JSON.parse(outgoing.body) : {}, headers: outgoing.headers };
}
const login = await request('POST', '/api/auth/login', { email: 'admin@example.invalid', password: process.env.SERENITY_TEST_ADMIN_PASSWORD });
assert.equal(login.status, 200);
const cookie = login.headers['set-cookie'].split(';')[0];
const holiday = todayStr();
const dayMonth = `${Number(holiday.slice(8))}/${Number(holiday.slice(5, 7))}`;
const saleName = `Ưu đãi ${dayMonth}`;
const fixtureSale = await request('POST', '/api/admin/holiday-sales', { requestId: randomUUID(), sale: {
  name: saleName, occasion: 'Lễ thử nghiệm', serviceDateFrom: holiday, serviceDateTo: holiday,
  enabled: true, discountType: 'percent', percentageBps: 2000, scopeType: 'all', targets: [],
} }, cookie);
assert.equal(fixtureSale.status, 201);
const saleId = fixtureSale.payload.sale.id;
const saleRow = () => db.prepare('SELECT * FROM holiday_sales WHERE id=?').get(saleId);
const count = (table) => db.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total;
const bookings = () => db.prepare("SELECT payload FROM collection_records WHERE collection='bookings' ORDER BY id").all().map((row) => JSON.parse(row.payload));
const snapshots = () => JSON.stringify({ sales: db.prepare('SELECT * FROM holiday_sales ORDER BY id').all(), pages: db.prepare('SELECT * FROM site_pages ORDER BY id').all(), menus: db.prepare('SELECT * FROM site_menu_items ORDER BY id').all(), bookings: bookings() });

const staffRow = db.prepare("SELECT payload FROM collection_records WHERE collection='staff' AND id='st-01'").get();
const staff = { ...JSON.parse(staffRow.payload), workingDays: [0, 1, 2, 3, 4, 5, 6], daysOff: [] };
db.prepare("UPDATE collection_records SET payload=? WHERE collection='staff' AND id='st-01'").run(JSON.stringify(staff));
const bookingFixture = await request('POST', '/api/bookings', { serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: addDays(holiday, 2), startTime: '10:00',
  customerName: 'Khách kiểm thử Gemini', customerPhone: '0987654321', customerEmail: '', note: '', submissionKey: randomUUID() }, cookie);
assert.equal(bookingFixture.status, 201, JSON.stringify(bookingFixture.payload));
const bookingId = bookingFixture.payload.booking.id;
const bookingCode = bookingFixture.payload.booking.code;
if (selectedCases?.includes('reschedule') && !selectedCases.includes('create')) {
  const futureSale = await request('POST', '/api/admin/holiday-sales', { requestId: randomUUID(), sale: {
    name: 'Sale ngày hẹn mới', serviceDateFrom: addDays(holiday, 3), serviceDateTo: addDays(holiday, 3),
    enabled: true, discountType: 'percent', percentageBps: 1000, scopeType: 'all', targets: [],
  } }, cookie);
  assert.equal(futureSale.status, 201);
}
if (selectedCases?.includes('disable') && !selectedCases.includes('page')) {
  const page = await request('POST', '/api/admin/site-pages/promotion', { requestId: randomUUID(), page: {
    title: 'Trang ưu đãi kiểm thử', menuLabel: 'Ưu đãi kiểm thử', campaignId: saleId,
    content: { subtitle: 'Ưu đãi trong ngày lễ', body: 'Giá tính theo ngày sử dụng dịch vụ.' },
  } }, cookie);
  assert.equal(page.status, 201);
}

const cases = [
  { id: 'read', message: 'Liệt kê các chương trình sale lễ hiện có, gồm mức giảm và ngày áp dụng.',
    check: async (_result, before) => assert.equal(snapshots(), before, 'read request must not change business data') },
  { id: 'update', message: `${dayMonth} sẽ được giảm 15% thay vì 20%. bạn chỉnh lại giúp tôi`,
    check: async (result, before) => {
      assert.equal(saleRow().percentage_bps, 1500, 'the existing campaign must change to 15%');
      assert.equal(count('holiday_sales'), JSON.parse(before).sales.length, 'an edit must not create a duplicate sale');
      assert.ok(result.payload.actions?.some((action) => action.sale?.id === saleId));
      const quote = await request('POST', '/api/pricing/quote', { serviceId: 'signature-body', duration: 60, serviceDate: holiday });
      assert.equal(quote.payload.pricing.discountAmount, Math.floor(quote.payload.pricing.originalPrice * 0.15));
    } },
  { id: 'missing-details', message: 'Tạo một chương trình giảm giá dịp Tết cho spa.',
    check: async (result, before) => { assert.equal(snapshots(), before, 'missing details must not produce writes'); assert.match(result.payload.reply, /ngày|năm|mức|bao nhiêu|phạm vi|dịch vụ/i); } },
  { id: 'create', message: `Tạo sale tên "Lễ thử nghiệm tiếp theo", giảm 10% toàn bộ menu, ngày sử dụng từ ${addDays(holiday, 3)} đến ${addDays(holiday, 3)}, bật ngay, không cần mã và không giới hạn mức giảm.`,
    check: async () => { const row = db.prepare('SELECT * FROM holiday_sales WHERE name=?').get('Lễ thử nghiệm tiếp theo'); assert.ok(row); assert.equal(row.percentage_bps, 1000); assert.equal(row.scope_type, 'all'); } },
  { id: 'page', message: `Tạo và xuất bản trang ưu đãi theo mẫu holiday-offer-v1 gắn với sale "${saleName}", đồng thời thêm menu "Ưu đãi lễ". Tiêu đề "Thư giãn dịp ${dayMonth}". Mô tả ngắn: "Chọn liệu trình phù hợp và tận hưởng ưu đãi dịp lễ". Nội dung: "Đặt lịch chăm sóc cơ thể tại Serenity Spa theo mức giảm của chiến dịch". Điểm nổi bật: "Đặt trước vẫn được ưu đãi nếu đến đúng ngày". Điều kiện: "Áp dụng theo ngày sử dụng dịch vụ, không cộng dồn mã giảm giá". Nút: "Đặt lịch ưu đãi".`,
    check: async () => { const page = db.prepare('SELECT * FROM site_pages WHERE campaign_id=?').get(saleId); assert.ok(page); assert.equal(page.status, 'published'); assert.equal(page.template_id, 'holiday-offer-v1'); assert.ok(db.prepare('SELECT id FROM site_menu_items WHERE page_id=? AND enabled=1').get(page.id)); assert.equal((await request('GET', `/api/site-pages/${page.slug}`)).status, 200); } },
  { id: 'menu', message: 'Thêm mục menu "Đặt lịch nhanh" trỏ đến trang đặt lịch có sẵn của website và bật hiển thị mục đó.',
    check: async () => { const item = db.prepare("SELECT * FROM site_menu_items WHERE route_key='booking'").get(); assert.ok(item); assert.equal(item.enabled, 1); assert.equal(item.label, 'Đặt lịch nhanh'); } },
  { id: 'booking-read', message: 'Liệt kê lịch hẹn hôm nay.',
    check: async (_result, before) => assert.equal(snapshots(), before) },
  { id: 'reschedule', message: `Dời lịch ${bookingCode} sang ngày ${addDays(holiday, 3)} lúc 10:00, giữ nguyên chuyên viên.`,
    check: async (result) => {
      assert.ok(result.payload.quotes?.length > 0, 'must return a confirmation quote');
      assert.equal(result.payload.quotes[0].newPricing.discountAmount, Math.floor(result.payload.quotes[0].newPricing.originalPrice * 0.1));
      assert.equal(bookings().find((row) => row.id === bookingId).date, addDays(holiday, 2), 'must not change the booking without clicking confirmation');
      assert.doesNotMatch(result.payload.reply, /\d\[số điện thoại đã ẩn\]:\d/, 'contact redaction must not consume an appointment date');
      for (const value of [result.payload.quotes[0].oldDate, result.payload.quotes[0].change.date,
        formatVND(result.payload.quotes[0].settlement.oldFinalPrice), formatVND(result.payload.quotes[0].settlement.newFinalPrice)]) {
        assert.ok(result.payload.reply.includes(value), 'the reply must use the authoritative quote dates and prices');
      }
    } },
  { id: 'disable', message: `Tắt chương trình sale "${saleName}" áp dụng ngày ${holiday}.`,
    check: async () => { assert.equal(saleRow().enabled, 0); const page = db.prepare('SELECT slug FROM site_pages WHERE campaign_id=?').get(saleId); if (page) assert.equal((await request('GET', `/api/site-pages/${page.slug}`)).status, 404); } },
];

const results = [];
try {
  for (const entry of cases.filter((item) => !selectedCases || selectedCases.includes(item.id))) {
    console.log(JSON.stringify({ case: entry.id, state: 'running', message: entry.message }));
    const started = Date.now(); providerEvents = [];
    const before = snapshots();
    const response = await request('POST', '/api/admin/agent/messages', { conversationId: randomUUID(), requestId: randomUUID(), message: entry.message }, cookie);
    let failure = null;
    try { assert.equal(response.status, 200, response.payload.error || 'HTTP error'); await entry.check(response, before); }
    catch (error) { failure = redact(error.message).slice(0, 500); }
    const result = { id: entry.id, passed: !failure, elapsedMs: Date.now() - started, httpStatus: response.status,
      code: response.payload.code, reply: redact(response.payload.reply || response.payload.error), failure, providerEvents };
    results.push(result); console.log(JSON.stringify({ result }));
  }
} finally {
  globalThis.fetch = realFetch;
  const report = { createdAt: new Date().toISOString(), configuredModel: process.env.AI_MODEL, productionDatabaseUntouched: true, temporaryDatabase: process.env.SERENITY_DB_PATH,
    total: results.length, passed: results.filter((row) => row.passed).length, results };
  await mkdir(path.join(root, '.scratch'), { recursive: true });
  const reportPath = path.join(root, '.scratch', `spa-agent-live-${Date.now()}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ summary: { passed: report.passed, total: report.total, reportPath, productionDatabaseUntouched: true } }));
  db.close();
  if (report.passed !== report.total || !report.total) process.exitCode = 1;
}
