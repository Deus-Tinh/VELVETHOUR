import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'serenity-chat-api-'));
process.env.SERENITY_DB_PATH = path.join(temporaryDirectory, 'test.sqlite');
delete process.env.AI_PROVIDER;
delete process.env.AI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.AI_MODEL;
const { server } = await import('../server/server.js');
const handler = server.listeners('request')[0];
const database = new DatabaseSync(process.env.SERENITY_DB_PATH);
database.prepare('INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  .run('last_backup_date', new Date().toISOString().slice(0, 10));

async function request(method, url, body, cookie = '') {
  const source = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const incoming = Readable.from(source);
  Object.assign(incoming, { method, url, headers: { host: 'localhost:3001', cookie }, socket: { remoteAddress: 'chat-api-test' } });
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
  return result.headers['set-cookie'].split(';')[0];
}

function appendCookie(cookie, setCookie) {
  const pair = String(setCookie || '').split(';')[0];
  return cookie ? `${cookie}; ${pair}` : pair;
}

test('without provider configuration a general question gets a controlled response without spa recommendations', async () => {
  const session = await request('GET', '/api/chat/session');
  const cookie = session.headers['set-cookie'].split(';')[0];
  const result = await request('POST', '/api/chat/messages', {
    conversationId: session.payload.conversationId, message: '1+1=?',
  }, cookie);

  assert.equal(result.status, 200);
  assert.equal(result.payload.messages[1].type, 'text');
  assert.match(result.payload.messages[1].text, /AI chưa được cấu hình/);
  assert.deepEqual(result.payload.messages[1].services, []);
});

test('Gemini receives the original question and its direct answer is returned without spa cards', async () => {
  const originalFetch = globalThis.fetch;
  const previousEnvironment = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
  };
  let sentPayload;
  process.env.AI_PROVIDER = 'gemini';
  process.env.AI_API_KEY = 'test-only-key';
  process.env.AI_MODEL = 'gemini-test-model';
  globalThis.fetch = async (_url, options) => {
    sentPayload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      intent: 'FALLBACK', service_category: null, budget_min: null, budget_max: null,
      desired_duration: null, keywords: [], assistant_reply: '1 + 1 = 2.',
    }) }] } }] }) };
  };
  try {
    const session = await request('GET', '/api/chat/session');
    const cookie = session.headers['set-cookie'].split(';')[0];
    const result = await request('POST', '/api/chat/messages', {
      conversationId: session.payload.conversationId, message: '1+1=?',
    }, cookie);
    const modelInput = JSON.parse(sentPayload.contents[0].parts[0].text);

    assert.equal(modelInput.message, '1+1=?');
    assert.equal(result.status, 200);
    assert.equal(result.payload.aiUsed, true);
    assert.equal(result.payload.messages[1].type, 'text');
    assert.match(result.payload.messages[1].text, /2/);
    assert.deepEqual(result.payload.messages[1].services, []);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Gemini authentication failure produces a controlled answer without fabricated recommendations', async () => {
  const originalFetch = globalThis.fetch;
  const previousEnvironment = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    AI_FALLBACK_MODEL: process.env.AI_FALLBACK_MODEL,
  };
  process.env.AI_PROVIDER = 'gemini';
  process.env.AI_API_KEY = 'invalid-test-key';
  process.env.AI_MODEL = 'gemini-test-model';
  process.env.AI_FALLBACK_MODEL = 'gemini-test-model';
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { status: 'UNAUTHENTICATED' } }) });
  try {
    const session = await request('GET', '/api/chat/session');
    const cookie = session.headers['set-cookie'].split(';')[0];
    const result = await request('POST', '/api/chat/messages', {
      conversationId: session.payload.conversationId, message: '1+1=?',
    }, cookie);

    assert.equal(result.status, 200);
    assert.equal(result.payload.aiFailed, true);
    assert.match(result.payload.messages[1].text, /AI đang gặp sự cố/);
    assert.deepEqual(result.payload.messages[1].services, []);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('service catalog failure is friendly and cannot be replaced by fabricated services', async () => {
  const serviceRow = database.prepare("SELECT id, payload FROM collection_records WHERE collection = 'services' LIMIT 1").get();
  assert.ok(serviceRow);
  const session = await request('GET', '/api/chat/session');
  const cookie = session.headers['set-cookie'].split(';')[0];
  database.prepare("UPDATE collection_records SET payload = ? WHERE collection = 'services' AND id = ?").run('{invalid-json', serviceRow.id);
  try {
    const result = await request('POST', '/api/chat/messages', {
      conversationId: session.payload.conversationId, message: 'Spa có dịch vụ gì?',
    }, cookie);

    assert.equal(result.status, 503);
    assert.equal(result.payload.code, 'DATABASE_ERROR');
    assert.match(result.payload.error, /chưa thể tải danh sách dịch vụ/);
    assert.equal(result.payload.error.includes('JSON'), false);
  } finally {
    database.prepare("UPDATE collection_records SET payload = ? WHERE collection = 'services' AND id = ?").run(serviceRow.payload, serviceRow.id);
  }
});

test('promotion questions read only currently valid promotion records', async () => {
  const session = await request('GET', '/api/chat/session');
  const cookie = session.headers['set-cookie'].split(';')[0];
  const result = await request('POST', '/api/chat/messages', {
    conversationId: session.payload.conversationId, message: 'Spa đang có khuyến mãi nào?',
  }, cookie);

  assert.equal(result.status, 200);
  assert.match(result.payload.messages[1].text, /SERENITY10/);
  assert.equal(result.payload.messages[1].services.length, 0);
});

test('chat recommendations sort by current database price and keep ordinal selection in conversation context', async () => {
  const session = await request('GET', '/api/chat/session');
  const cookie = session.headers['set-cookie'].split(';')[0];
  let result = await request('POST', '/api/chat/messages', {
    conversationId: session.payload.conversationId, message: 'Dịch vụ nào rẻ nhất?',
  }, cookie);
  assert.equal(result.status, 200);
  assert.equal(result.payload.messages[1].type, 'service_cards');
  assert.ok(result.payload.messages[1].services.length >= 2);
  const services = result.payload.messages[1].services;
  assert.deepEqual(services.map((service) => service.price), services.map((service) => service.price).toSorted((a, b) => a - b));
  assert.equal(result.payload.context.last_recommended_services[1].serviceId, services[1].id);

  result = await request('POST', '/api/chat/messages', {
    conversationId: session.payload.conversationId, message: 'Cái thứ 2 bao nhiêu?',
  }, cookie);
  assert.equal(result.payload.context.service_id, services[1].id);
  assert.equal(result.payload.messages[1].services[0].id, services[1].id);

  result = await request('POST', '/api/chat/messages', {
    conversationId: session.payload.conversationId, message: 'Đặt cái đó',
  }, cookie);
  assert.equal(result.payload.context.service_id, services[1].id);
  assert.match(result.payload.messages[1].actions[0].href, new RegExp(`service=${services[1].id}`));
});

test('chat API persists guest context, filters live services, checks slots and protects account bookings', async () => {
  const firstSession = await request('GET', '/api/chat/session');
  assert.equal(firstSession.status, 200);
  assert.match(firstSession.headers['set-cookie'], /serenity\.chat=.*HttpOnly/);
  const guestCookie = firstSession.headers['set-cookie'].split(';')[0];
  const guestConversationId = firstSession.payload.conversationId;
  assert.match(firstSession.payload.messages[0].text, /Xin chào/);

  let result = await request('POST', '/api/chat/messages', { conversationId: guestConversationId, message: 'Cần thư giãn' }, guestCookie);
  assert.equal(result.status, 200);
  assert.equal(result.payload.messages[1].quickReplies.some((reply) => reply.label.includes('500.000')), true);

  result = await request('POST', '/api/chat/messages', {
    conversationId: guestConversationId, message: 'Mình muốn thư giãn, ngân sách khoảng 300.000đ – 500.000đ.',
  }, guestCookie);
  assert.equal(result.status, 200);
  assert.equal(result.payload.messages[1].type, 'service_cards');
  assert.ok(result.payload.messages[1].services.length > 0);
  assert.ok(result.payload.messages[1].services.every((service) => service.price >= 300000 && service.price <= 500000));

  const refreshed = await request('GET', '/api/chat/session', undefined, guestCookie);
  assert.equal(refreshed.payload.conversationId, guestConversationId);
  assert.ok(refreshed.payload.context.budget_max <= 500000);
  assert.ok(refreshed.payload.messages.some((message) => message.services?.length));

  result = await request('POST', '/api/chat/messages', {
    conversationId: guestConversationId, message: 'Mình muốn chăm sóc da, gọi lại 0987654321 hoặc abc@example.com nhé.',
  }, guestCookie);
  assert.equal(result.status, 200);
  const storedMessage = database.prepare("SELECT content FROM chat_messages WHERE conversation_id = ? AND role = 'user' ORDER BY rowid DESC LIMIT 1")
    .get(guestConversationId).content;
  assert.equal(storedMessage.includes('0987654321'), false);
  assert.equal(storedMessage.includes('abc@example.com'), false);
  const storedContext = database.prepare('SELECT context FROM chat_conversations WHERE id = ?').get(guestConversationId).context;
  assert.equal(storedContext.includes('0987654321'), false);
  assert.equal(storedContext.includes('abc@example.com'), false);

  const secondGuest = await request('GET', '/api/chat/session');
  const otherGuestCookie = secondGuest.headers['set-cookie'].split(';')[0];
  result = await request('POST', '/api/chat/messages', { conversationId: guestConversationId, message: 'Lịch của tôi' }, otherGuestCookie);
  assert.equal(result.status, 404, 'an unrelated guest cookie cannot open another chat');

  result = await request('POST', '/api/chat/messages', { conversationId: guestConversationId, message: 'x'.repeat(1201) }, guestCookie);
  assert.equal(result.status, 413, 'oversized messages are rejected before they are stored');
  const reset = await request('POST', '/api/chat/reset', {}, guestCookie);
  assert.equal(reset.status, 201);
  assert.notEqual(reset.payload.conversationId, guestConversationId);
  assert.equal(reset.payload.messages.length, 1);
  result = await request('POST', '/api/chat/messages', { conversationId: guestConversationId, message: 'Chăm sóc da' }, guestCookie);
  assert.equal(result.status, 404, 'a restarted conversation cannot continue the ended transcript');

  const future = new Date();
  future.setDate(future.getDate() + 1);
  const nextDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(future);
  const slotConversation = await request('GET', '/api/chat/session');
  const slotCookie = slotConversation.headers['set-cookie'].split(';')[0];
  const slotId = slotConversation.payload.conversationId;
  await request('POST', '/api/chat/messages', {
    conversationId: slotId, message: 'Kiểm tra lịch trống', serviceId: 'signature-body', serviceDuration: 60,
  }, slotCookie);
  assert.equal(database.prepare('SELECT context FROM chat_conversations WHERE id = ?').get(slotId).context.includes('"desired_duration":60'), true);
  result = await request('POST', '/api/chat/messages', { conversationId: slotId, message: 'Ngày mai' }, slotCookie);
  assert.match(result.payload.messages[1].text, /Signature Body Massage/);
  assert.match(result.payload.messages[1].text, /còn trống/);
  result = await request('POST', '/api/chat/messages', { conversationId: slotId, message: '3 giờ' }, slotCookie);
  assert.equal(result.payload.messages[1].actions.length, 1);
  assert.match(result.payload.messages[1].actions[0].href, /service=signature-body/);
  assert.match(result.payload.messages[1].actions[0].href, /date=/);
  assert.match(result.payload.messages[1].actions[0].href, /time=15%3A00/);
  assert.match(result.payload.messages[1].actions[0].href, /duration=60/);
  assert.match(result.payload.messages[1].text, /kiểm tra lại/);
  assert.ok(nextDate, 'test computes an upcoming local date without touching shared data');

  const customerOneSid = await login('khach@example.invalid', process.env.SERENITY_TEST_CUSTOMER_PASSWORD);
  const customerTwoSid = await login('bao@example.invalid', process.env.SERENITY_TEST_CUSTOMER_PASSWORD);
  const customerOneSession = await request('GET', '/api/chat/session', undefined, customerOneSid);
  const customerOneCookie = appendCookie(customerOneSid, customerOneSession.headers['set-cookie']);
  result = await request('POST', '/api/chat/messages', {
    conversationId: customerOneSession.payload.conversationId, message: 'Lịch hẹn của tôi',
  }, customerOneCookie);
  assert.equal(result.status, 200);
  const ownerIds = new Set(database.prepare("SELECT id FROM collection_records WHERE collection = 'bookings' AND json_extract(payload, '$.userId') = 'usr_cust1'").all().map((row) => row.id));
  assert.ok(result.payload.messages[1].bookings.length > 0);
  assert.ok(result.payload.messages[1].bookings.every((booking) => ownerIds.has(booking.id)));

  const customerTwoSession = await request('GET', '/api/chat/session', undefined, customerTwoSid);
  const customerTwoCookie = appendCookie(customerTwoSid, customerTwoSession.headers['set-cookie']);
  result = await request('POST', '/api/chat/messages', {
    conversationId: customerOneSession.payload.conversationId, message: 'Lịch hẹn của tôi',
  }, customerTwoCookie);
  assert.equal(result.status, 404, 'a different authenticated customer cannot access another conversation');

  const counts = {
    conversations: database.prepare('SELECT COUNT(*) AS total FROM chat_conversations').get().total,
    messages: database.prepare('SELECT COUNT(*) AS total FROM chat_messages').get().total,
  };
  assert.ok(counts.conversations >= 5);
  assert.ok(counts.messages >= 9);
});
