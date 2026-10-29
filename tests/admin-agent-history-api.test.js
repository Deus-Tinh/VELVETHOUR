import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { addDays, todayStr } from '../assets/js/core/utils.js';

const directory = await mkdtemp(path.join(tmpdir(), 'serenity-agent-history-'));
process.env.SERENITY_DB_PATH = path.join(directory, 'test.sqlite');
for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'GEMINI_API_KEY', 'OPENAI_API_KEY']) delete process.env[key];
const { server } = await import('../server/server.js');
const handler = server.listeners('request')[0];
const db = new DatabaseSync(process.env.SERENITY_DB_PATH);
db.prepare("INSERT INTO metadata(key,value) VALUES ('last_backup_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date().toISOString().slice(0, 10));
const firstAdmin = JSON.parse(db.prepare("SELECT payload FROM collection_records WHERE collection='users' AND json_extract(payload,'$.email')='admin@example.invalid'").get().payload);
db.prepare('INSERT INTO collection_records(collection,id,payload) VALUES (?,?,?)').run('users', 'admin-history-2', JSON.stringify({ ...firstAdmin, id: 'admin-history-2', email: 'history2@example.invalid' }));

async function request(method, url, body, cookie = '', origin) {
  const incoming = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(incoming, { method, url, headers: { host: 'localhost:3001', cookie, ...(origin ? { origin } : {}) }, socket: { remoteAddress: 'agent-history-test' } });
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
const other = await login('history2@example.invalid', process.env.SERENITY_TEST_ADMIN_PASSWORD);
const customer = await login('khach@example.invalid', process.env.SERENITY_TEST_CUSTOMER_PASSWORD);
const endpoint = '/api/admin/agent/conversations';
const newConversation = async (actor = admin) => {
  const result = await request('POST', endpoint, {}, actor.cookie);
  assert.equal(result.status, 201);
  return result.payload.conversation;
};
const bodyFor = (conversationId, message) => ({ conversationId, message, requestId: randomUUID() });
const response = (parts) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts } }] }) });
async function withModel(fetcher, work) {
  const originalFetch = globalThis.fetch;
  process.env.AI_PROVIDER = 'gemini'; process.env.AI_API_KEY = 'test-only-key'; process.env.AI_MODEL = 'test-model';
  process.env.AI_AGENT_FALLBACK_MODEL = '';
  globalThis.fetch = fetcher;
  try { return await work(); }
  finally { globalThis.fetch = originalFetch; for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'AI_AGENT_FALLBACK_MODEL']) delete process.env[key]; }
}

test('history endpoints require admin, enforce ownership and reject cross-origin deletion', async () => {
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal((await request(method, endpoint, undefined)).status, 401);
    assert.equal((await request(method, endpoint, undefined, customer.cookie)).status, 403);
  }
  const conversation = await newConversation();
  assert.equal((await request('GET', `${endpoint}/${conversation.id}`, undefined, other.cookie)).status, 404);
  assert.equal((await request('DELETE', `${endpoint}/${conversation.id}`, undefined, other.cookie)).status, 404);
  assert.equal((await request('DELETE', `${endpoint}/${conversation.id}`, undefined, admin.cookie, 'https://untrusted.example')).status, 403);
  assert.equal((await request('GET', endpoint, undefined, other.cookie)).payload.conversations.length, 0);
});

test('reopened history restores redacted conversation context without invoking AI or replaying a command', async () => {
  const conversation = await newConversation();
  let calls = 0;
  await withModel(async (_url, options) => {
    const payload = JSON.parse(options.body);
    calls++;
    if (calls === 2) {
      assert.ok(payload.contents.some((item) => item.parts.some((part) => part.text?.includes('Nhớ khách [số điện thoại đã ẩn]'))));
      assert.equal(JSON.stringify(payload).includes('0987654321'), false);
    }
    return response([{ text: 'Đã đọc yêu cầu.' }]);
  }, async () => {
    const result = await request('POST', '/api/admin/agent/messages', bodyFor(conversation.id, 'Nhớ khách 0987654321 test@example.com'), admin.cookie);
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    for (let i = 0; i < 2; i++) {
      const read = await request('GET', `${endpoint}/${conversation.id}`, undefined, admin.cookie);
      assert.equal(read.status, 200);
      assert.equal(read.payload.messages.length, 2);
      assert.equal(JSON.stringify(read.payload).includes('0987654321'), false);
      assert.equal(JSON.stringify(read.payload).includes('test@example.com'), false);
    }
    assert.equal(calls, 1, 'opening history must never call a provider');
    assert.equal((await request('POST', '/api/admin/agent/messages', bodyFor(conversation.id, 'Tôi đang nói về khách nào?'), admin.cookie)).status, 200);
    assert.equal(calls, 2);
  });
});

test('AI failure is saved and an explicit retry updates the same turn without duplicate messages', async () => {
  const conversation = await newConversation();
  const body = bodyFor(conversation.id, 'Liệt kê các sale lễ');
  let calls = 0;
  await withModel(async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('Simulated timeout'), { name: 'AbortError' });
    return response([{ text: 'Đã đọc các chương trình.' }]);
  }, async () => {
    assert.equal((await request('POST', '/api/admin/agent/messages', body, admin.cookie)).status, 503);
    const failed = await request('GET', `${endpoint}/${conversation.id}`, undefined, admin.cookie);
    assert.equal(failed.payload.messages.length, 2);
    assert.equal(failed.payload.messages[1].state, 'failed');
    assert.equal(failed.payload.messages[1].metadata.errorCode, 'AI_PROVIDER_TIMEOUT');
    assert.equal((await request('POST', '/api/admin/agent/messages', body, admin.cookie)).status, 200);
    const retried = await request('GET', `${endpoint}/${conversation.id}`, undefined, admin.cookie);
    assert.equal(retried.payload.messages.length, 2);
    assert.equal(retried.payload.messages[1].state, 'completed');
  });
});

test('in-flight requests survive a history read and block deletion and concurrent commands in the same conversation', async () => {
  const conversation = await newConversation();
  let release;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  await withModel(() => { signalStarted(); return new Promise((resolve) => { release = () => resolve(response([{ text: 'Hoàn tất.' }])); }); }, async () => {
    const pending = request('POST', '/api/admin/agent/messages', bodyFor(conversation.id, 'Kiểm tra lịch'), admin.cookie);
    await started;
    const read = await request('GET', `${endpoint}/${conversation.id}`, undefined, admin.cookie);
    assert.equal(read.payload.busy, true);
    assert.equal(read.payload.messages[1].state, 'pending');
    assert.equal((await request('DELETE', `${endpoint}/${conversation.id}`, undefined, admin.cookie)).payload.code, 'CONVERSATION_BUSY');
    assert.equal((await request('POST', '/api/admin/agent/messages', bodyFor(conversation.id, 'Lệnh tiếp theo'), admin.cookie)).payload.code, 'CONVERSATION_BUSY');
    release();
    assert.equal((await pending).status, 200);
    assert.equal((await request('GET', `${endpoint}/${conversation.id}`, undefined, admin.cookie)).payload.busy, false);
  });
});

test('deleting history removes chat and receipts, blocks old retries, and preserves completed business changes', async () => {
  const conversation = await newConversation();
  const date = addDays(todayStr(), 20);
  const body = bodyFor(conversation.id, `Tạo sale lễ 10% toàn menu ngày ${date}`);
  let calls = 0;
  await withModel(async () => {
    calls++;
    return response(calls === 1 ? [{ functionCall: { name: 'create_holiday_sale', args: { sale: {
      name: 'Sale từ hội thoại sẽ xóa', serviceDateFrom: date, serviceDateTo: date, enabled: true,
      discountType: 'percent', percentageBps: 1000, scopeType: 'all', targets: [],
    } } } }] : [{ text: 'Đã tạo sale.' }]);
  }, async () => {
    const result = await request('POST', '/api/admin/agent/messages', body, admin.cookie);
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    const saleId = result.payload.actions[0].sale.id;
    const read = await request('GET', `${endpoint}/${conversation.id}`, undefined, admin.cookie);
    assert.match(read.payload.messages[1].metadata.effects[0], /Sale đã xác minh/);
    assert.equal(calls, 2);
    assert.equal((await request('DELETE', `${endpoint}/${conversation.id}`, undefined, admin.cookie)).status, 200);
    assert.equal((await request('GET', `${endpoint}/${conversation.id}`, undefined, admin.cookie)).status, 404);
    assert.equal((await request('POST', '/api/admin/agent/messages', body, admin.cookie)).status, 410);
    assert.equal(calls, 2);
    assert.ok(db.prepare('SELECT id FROM holiday_sales WHERE id=?').get(saleId));
    const receipt = JSON.parse(db.prepare('SELECT value FROM metadata WHERE key=?').get(`admin-agent-request:${admin.user.id}:${body.requestId}`).value);
    assert.equal(receipt.deleted, true);
    assert.equal(receipt.response, undefined);
  });
  const otherConversation = await newConversation(other);
  assert.equal((await request('DELETE', endpoint, undefined, admin.cookie)).status, 200);
  assert.equal((await request('GET', endpoint, undefined, admin.cookie)).payload.conversations.length, 0);
  assert.equal((await request('GET', `${endpoint}/${otherConversation.id}`, undefined, other.cookie)).status, 200);
});
