import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { addDays, todayStr } from '../assets/js/core/utils.js';

const directory = await mkdtemp(path.join(tmpdir(), 'serenity-site-content-api-'));
process.env.SERENITY_DB_PATH = path.join(directory, 'test.sqlite');
for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'GEMINI_API_KEY', 'OPENAI_API_KEY']) delete process.env[key];
const { server } = await import('../server/server.js');
const handler = server.listeners('request')[0];
const db = new DatabaseSync(process.env.SERENITY_DB_PATH);
db.prepare("INSERT INTO metadata(key,value) VALUES ('last_backup_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
  .run(new Date().toISOString().slice(0, 10));

async function request(method, url, body, cookie = '', origin) {
  const incoming = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(incoming, { method, url, headers: { host: 'localhost:3001', cookie, ...(origin ? { origin } : {}) }, socket: { remoteAddress: 'site-content-test' } });
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
const pageInput = (patch = {}) => ({ title: 'Ưu đãi lễ kiểm thử', menuLabel: 'Ưu đãi lễ', content: {
  eyebrow: 'Ưu đãi đặc biệt', subtitle: 'Chăm sóc và thư giãn dịp lễ.', body: 'Đặt lịch trước để nhận giá tốt.',
  highlights: ['Áp dụng tại spa', 'Theo ngày sử dụng'], conditions: 'Cần đặt lịch trước.', ctaLabel: 'Chọn ngày ưu đãi',
}, ...patch });

test('site page and menu writes are admin-only, same-origin, schema-bound and idempotent', async () => {
  const body = { page: pageInput(), requestId: randomUUID() };
  assert.equal((await request('POST', '/api/admin/site-pages/promotion', body)).status, 401);
  assert.equal((await request('POST', '/api/admin/site-pages/promotion', body, customer.cookie)).status, 403);
  assert.equal((await request('POST', '/api/admin/site-pages/promotion', body, admin.cookie, 'https://untrusted.example')).status, 403);
  assert.equal((await request('POST', '/api/admin/site-pages/promotion', { page: pageInput({ content: { ...pageInput().content, arbitraryHtml: '<script>alert(1)</script>' } }), requestId: randomUUID() }, admin.cookie)).status, 400);

  const created = await request('POST', '/api/admin/site-pages/promotion', body, admin.cookie);
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.verified, true);
  assert.equal(created.payload.page.templateId, 'holiday-offer-v1');
  assert.match(created.payload.page.slug, /^uu-dai-le-kiem-thu-[a-f0-9]{8}$/);
  assert.equal(created.payload.menuItem.targetHref, `#/pages/${created.payload.page.slug}`);
  const repeated = await request('POST', '/api/admin/site-pages/promotion', body, admin.cookie);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.payload.replayed, true);
  assert.equal(repeated.payload.page.id, created.payload.page.id);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM audit_log WHERE action='site_page.created'").get().total, 1);
  const conflict = await request('POST', '/api/admin/site-pages/promotion', { ...body, page: pageInput({ title: 'Khác' }) }, admin.cookie);
  assert.equal(conflict.payload.code, 'REQUEST_CONFLICT');

  const publicPage = await request('GET', `/api/site-pages/${created.payload.page.slug}`);
  assert.equal(publicPage.status, 200);
  assert.equal(publicPage.payload.page.content.body, 'Đặt lịch trước để nhận giá tốt.');
  const publicSnapshot = await request('GET', '/api/bootstrap');
  assert.ok(publicSnapshot.payload.siteContent.pages.some((page) => page.slug === created.payload.page.slug));
  assert.ok(publicSnapshot.payload.siteContent.menuItems.some((item) => item.targetHref === `#/pages/${created.payload.page.slug}`));
  assert.equal((await request('GET', '/api/admin/site-content')).status, 401);
  assert.equal((await request('GET', '/api/admin/site-content', undefined, admin.cookie)).status, 200);
});

test('promotion edits use revision checks; drafting a page hides its menu and public route', async () => {
  const created = await request('POST', '/api/admin/site-pages/promotion', { page: pageInput({ slug: 'sale-le-chinh-sach' }), requestId: randomUUID() }, admin.cookie);
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const body = { patch: { content: { subtitle: 'Nội dung mới cho mùa lễ.' } }, expectedRevision: 1, requestId: randomUUID() };
  const updated = await request('PATCH', `/api/admin/site-pages/${created.payload.page.id}`, body, admin.cookie);
  assert.equal(updated.status, 200, JSON.stringify(updated.payload));
  assert.equal(updated.payload.page.revision, 2);
  assert.equal(updated.payload.page.content.body, pageInput().content.body);
  assert.equal((await request('PATCH', `/api/admin/site-pages/${created.payload.page.id}`, { ...body, requestId: randomUUID() }, admin.cookie)).payload.code, 'VERSION_CONFLICT');

  const drafted = await request('PATCH', `/api/admin/site-pages/${created.payload.page.id}`, {
    patch: { status: 'draft' }, expectedRevision: 2, requestId: randomUUID(),
  }, admin.cookie);
  assert.equal(drafted.status, 200);
  assert.equal(drafted.payload.menuItem.enabled, false);
  assert.equal((await request('GET', `/api/site-pages/${created.payload.page.slug}`)).status, 404);
  assert.ok(!(await request('GET', '/api/bootstrap')).payload.siteContent.menuItems.some((item) => item.pageSlug === created.payload.page.slug));
});

test('menu links can point only to approved routes and use revisions for edits', async () => {
  const bad = await request('POST', '/api/admin/site-menu', { menuItem: { label: 'Lạ', routeKey: 'https://evil.example' }, requestId: randomUUID() }, admin.cookie);
  assert.equal(bad.status, 400);
  const created = await request('POST', '/api/admin/site-menu', {
    menuItem: { label: 'Đặt lịch', routeKey: 'booking' }, requestId: randomUUID(),
  }, admin.cookie);
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.menuItem.targetHref, '#/booking');
  const updated = await request('PATCH', `/api/admin/site-menu/${created.payload.menuItem.id}`, {
    patch: { label: 'Đặt lịch nhanh', enabled: false, position: 0 }, expectedRevision: 1, requestId: randomUUID(),
  }, admin.cookie);
  assert.equal(updated.status, 200, JSON.stringify(updated.payload));
  assert.equal(updated.payload.menuItem.enabled, false);
  assert.equal((await request('POST', '/api/admin/site-menu', {
    menuItem: { label: 'Đặt lịch khác', routeKey: 'booking' }, requestId: randomUUID(),
  }, admin.cookie)).payload.code, 'MENU_TARGET_EXISTS');
  const override = await request('POST', '/api/admin/site-menu', {
    menuItem: { label: 'Chăm sóc', routeKey: 'services' }, requestId: randomUUID(),
  }, admin.cookie);
  assert.equal(override.status, 201);
  const hiddenOverride = await request('PATCH', `/api/admin/site-menu/${override.payload.menuItem.id}`, {
    patch: { enabled: false }, expectedRevision: 1, requestId: randomUUID(),
  }, admin.cookie);
  assert.equal(hiddenOverride.status, 200);
  const publicOverride = (await request('GET', '/api/bootstrap')).payload.siteContent.menuItems.find((item) => item.routeKey === 'services');
  assert.equal(publicOverride.enabled, false, 'disabled route override must stay visible to the navigation renderer so it can hide the default link');
});

test('admin spa agent exposes safe page/menu tools and returns the verified saved page', async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  let advertisedTools = [];
  process.env.AI_PROVIDER = 'gemini'; process.env.AI_API_KEY = 'test-only-key'; process.env.AI_MODEL = 'test-model';
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    advertisedTools = payload.tools[0].functionDeclarations.map((row) => row.name);
    call += 1;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: call === 1
      ? [{ functionCall: { name: 'create_promotion_page', args: pageInput({ slug: undefined }) } }]
      : [{ text: 'Trang ưu đãi đã được tạo và xác minh.' }] } }] }) };
  };
  try {
    const requestBody = { conversationId: randomUUID(), requestId: randomUUID(), message: 'Tạo trang ưu đãi lễ và mục menu theo mẫu.' };
    const response = await request('POST', '/api/admin/agent/messages', requestBody, admin.cookie);
    assert.equal(response.status, 200, JSON.stringify(response.payload));
    assert.ok(['list_site_content', 'list_navigation_targets', 'create_promotion_page', 'update_promotion_page', 'create_menu_link', 'update_menu_link'].every((name) => advertisedTools.includes(name)));
    assert.equal(response.payload.siteChanges.length, 1);
    assert.equal(response.payload.siteChanges[0].verified, true);
    assert.equal(response.payload.siteChanges[0].page.templateId, 'holiday-offer-v1');
    assert.match(response.payload.siteChanges[0].menuItem.targetHref, /^#\/pages\//);
    assert.ok((await request('GET', '/api/bootstrap')).payload.siteContent.pages.some((page) => page.id === response.payload.siteChanges[0].page.id));
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL']) delete process.env[key];
  }
});

test('agent retry after a page write replays its receipt instead of creating a second page', async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  process.env.AI_PROVIDER = 'gemini'; process.env.AI_API_KEY = 'test-only-key'; process.env.AI_MODEL = 'test-model';
  globalThis.fetch = async (_url, options) => {
    call += 1;
    if (call > 1) throw new Error('Simulated AI failure after saving the page.');
    const payload = JSON.parse(options.body);
    assert.ok(payload.tools[0].functionDeclarations.some((tool) => tool.name === 'create_promotion_page'));
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [
      { functionCall: { name: 'create_promotion_page', args: pageInput({ title: 'Trang ưu đãi thử lại' }) } },
    ] } }] }) };
  };
  try {
    const requestBody = { conversationId: randomUUID(), requestId: randomUUID(), message: 'Tạo trang ưu đãi thử lại và thêm menu.' };
    const first = await request('POST', '/api/admin/agent/messages', requestBody, admin.cookie);
    assert.equal(first.status, 200, JSON.stringify(first.payload));
    assert.equal(first.payload.siteChanges.length, 1);
    assert.match(first.payload.reply, /đã xử lý/i);
    const repeated = await request('POST', '/api/admin/agent/messages', requestBody, admin.cookie);
    assert.deepEqual(repeated.payload.siteChanges, first.payload.siteChanges);
    assert.equal(call, 2, 'a durable response receipt should skip another provider call');
    assert.equal(db.prepare('SELECT COUNT(*) total FROM site_pages WHERE id=?').get(first.payload.siteChanges[0].page.id).total, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL']) delete process.env[key];
  }
});

test('sale-linked promo pages only appear publicly while the linked campaign remains eligible', async () => {
  const firstDay = addDays(todayStr(), 30);
  const saleResponse = await request('POST', '/api/admin/holiday-sales', { requestId: randomUUID(), sale: {
    name: 'Sale liên kết trang', occasion: 'Ngày hội spa', serviceDateFrom: firstDay, serviceDateTo: firstDay,
    enabled: true, discountType: 'percent', percentageBps: 1000, scopeType: 'service', targets: [{ targetId: 'signature-body' }],
  } }, admin.cookie);
  assert.equal(saleResponse.status, 201, JSON.stringify(saleResponse.payload));
  const page = await request('POST', '/api/admin/site-pages/promotion', {
    page: pageInput({ campaignId: saleResponse.payload.sale.id }), requestId: randomUUID(),
  }, admin.cookie);
  assert.equal(page.status, 201, JSON.stringify(page.payload));
  const publicPage = await request('GET', `/api/site-pages/${page.payload.page.slug}`);
  assert.equal(publicPage.status, 200);
  assert.equal(publicPage.payload.page.campaign.id, saleResponse.payload.sale.id);
  const disabled = await request('PATCH', `/api/admin/holiday-sales/${saleResponse.payload.sale.id}`, {
    patch: { enabled: false }, expectedRevision: 1, requestId: randomUUID(),
  }, admin.cookie);
  assert.equal(disabled.status, 200, JSON.stringify(disabled.payload));
  assert.equal((await request('GET', `/api/site-pages/${page.payload.page.slug}`)).status, 404);
  assert.ok(!(await request('GET', '/api/bootstrap')).payload.siteContent.menuItems.some((item) => item.pageSlug === page.payload.page.slug));
});
