import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { migrateAdminAgentHistory, createAdminAgentHistory, AGENT_HISTORY_TTL_MS } from '../server/adminAgentHistory.js';

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
function fixture(file = ':memory:', clock = { time: Date.parse('2026-10-20T05:00:00Z') }) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  migrateAdminAgentHistory(db);
  const transaction = (work) => { db.exec('BEGIN IMMEDIATE'); try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const history = createAdminAgentHistory({ db, transaction, HttpError, now: () => clock.time });
  return { db, history, clock };
}
function complete(history, owner, id, text, suffix = '') {
  const requestId = randomUUID();
  const hash = `hash-${requestId}`;
  history.begin(owner, id, requestId, hash, text);
  history.finish(owner, id, requestId, hash, { reply: `Đã đọc ${suffix}`, conversationId: id, actions: [], quotes: [], siteChanges: [] });
  return requestId;
}

test('migration and completed dialogue survive closing/reopening SQLite without restoring transient tool calls', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'serenity-history-reopen-'));
  const file = path.join(dir, 'history.sqlite');
  const first = fixture(file);
  const conversation = first.history.create('admin-one');
  complete(first.history, 'admin-one', conversation.id, 'Khách 0987654321 test@example.com cần tư vấn');
  migrateAdminAgentHistory(first.db);
  first.db.close();
  const second = fixture(file);
  second.history.recoverInterrupted();
  const read = second.history.read('admin-one', conversation.id);
  assert.equal(read.messages.length, 2);
  assert.equal(read.messages[0].content.includes('0987654321'), false);
  assert.equal(read.messages[0].content.includes('test@example.com'), false);
  assert.equal(second.history.history('admin-one', conversation.id).length, 2);
  assert.equal(second.history.list('admin-two').length, 0);
  second.db.close();
});

test('30-day retention removes old messages, titles and receipt text while preserving newer turns', () => {
  const { db, history, clock } = fixture();
  const conversation = history.create('admin');
  const oldRequest = complete(history, 'admin', conversation.id, 'Nội dung cũ cần hết hạn');
  clock.time += 20 * 86400000;
  complete(history, 'admin', conversation.id, 'Nội dung còn trong thời hạn');
  clock.time += 11 * 86400000;
  const read = history.read('admin', conversation.id);
  assert.equal(read.messages.length, 2);
  assert.equal(read.conversation.title, 'Nội dung còn trong thời hạn');
  const receipt = JSON.parse(db.prepare('SELECT value FROM metadata WHERE key=?').get(`admin-agent-request:admin:${oldRequest}`).value);
  assert.equal(receipt.deleted, true);
  clock.time += AGENT_HISTORY_TTL_MS;
  history.prune();
  assert.equal(history.list('admin').length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM admin_agent_messages').get().count, 0);
  assert.throws(() => history.begin('admin', conversation.id, randomUUID(), 'new-hash', 'Đừng mở lại hội thoại hết hạn'), { code: 'CONVERSATION_DELETED' });
  db.close();
});

test('a request interrupted by restart keeps effects visible and cannot automatically resume old writes', () => {
  const { db, history } = fixture();
  const conversation = history.create('admin');
  const requestId = randomUUID();
  history.begin('admin', conversation.id, requestId, 'hash', 'Tạo sale');
  history.recordEffects('admin', conversation.id, requestId, { actions: [{ sale: { name: 'Lễ', serviceDateFrom: '2026-11-20', serviceDateTo: '2026-11-20', enabled: true, revision: 1 } }] });
  history.recoverInterrupted();
  const read = history.read('admin', conversation.id);
  assert.equal(read.messages[1].state, 'interrupted');
  assert.match(read.messages[1].metadata.effects[0], /Sale đã xác minh/);
  assert.throws(() => history.begin('admin', conversation.id, requestId, 'hash', 'Tạo sale'), { code: 'REQUEST_ALREADY_RECORDED' });
  assert.deepEqual(history.history('admin', conversation.id), []);
  db.close();
});

test('long histories page backwards without gaps or duplicate messages', () => {
  const { db, history } = fixture();
  const conversation = history.create('admin');
  for (let i = 0; i < 55; i++) complete(history, 'admin', conversation.id, `Yêu cầu ${i}`, String(i));
  const latest = history.read('admin', conversation.id);
  assert.equal(latest.messages.length, 100);
  assert.equal(latest.hasMore, true);
  const older = history.read('admin', conversation.id, { before: latest.beforeCursor });
  assert.equal(older.messages.length, 10);
  assert.equal(older.hasMore, false);
  assert.equal(new Set([...older.messages, ...latest.messages].map((row) => row.id)).size, 110);
  assert.ok(older.messages.at(-1).id < latest.messages[0].id);
  db.close();
});
