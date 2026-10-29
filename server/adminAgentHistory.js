import { randomUUID } from 'node:crypto';
import { formatVND } from '../assets/js/core/utils.js';
import { redactContactText } from './contactRedaction.js';

export const AGENT_HISTORY_RETENTION_DAYS = 30;
export const AGENT_HISTORY_TTL_MS = AGENT_HISTORY_RETENTION_DAYS * 86400000;

export function redactAgentHistoryText(value) {
  return redactContactText(value);
}

export function migrateAdminAgentHistory(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const key = 'admin_agent_history_schema_version';
    const raw = db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value ?? '0';
    if (!/^[01]$/.test(raw)) throw new Error('Unsupported admin agent history database version.');
    if (raw === '0') {
      db.exec(`
        CREATE TABLE admin_agent_conversations (
          owner_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
          deleted_at INTEGER, PRIMARY KEY(owner_id,id)
        ) STRICT;
        CREATE INDEX admin_agent_conversations_owner_time ON admin_agent_conversations(owner_id,updated_at DESC);
        CREATE TABLE admin_agent_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
          request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('pending','completed','failed','interrupted')),
          metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)), created_at INTEGER NOT NULL,
          UNIQUE(owner_id,request_id,role),
          FOREIGN KEY(owner_id,conversation_id) REFERENCES admin_agent_conversations(owner_id,id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX admin_agent_messages_history ON admin_agent_messages(owner_id,conversation_id,id);
        CREATE INDEX admin_agent_messages_expiry ON admin_agent_messages(created_at);
      `);
      db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run(key, '1');
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function effectSummaries(payload) {
  const effects = [];
  for (const action of payload.actions || []) if (action.sale) {
    const sale = action.sale;
    effects.push(`Sale đã xác minh: ${sale.name} · ${sale.serviceDateFrom} đến ${sale.serviceDateTo} · ${sale.enabled ? 'Bật' : 'Tắt'} · phiên bản ${sale.revision}.`);
  }
  for (const change of payload.siteChanges || []) {
    if (change.page) effects.push(`Trang đã xác minh: ${change.page.title} · #/pages/${change.page.slug} · phiên bản ${change.page.revision}.`);
    if (change.menuItem) effects.push(`Menu đã xác minh: ${change.menuItem.label} → ${change.menuItem.targetHref} · ${change.menuItem.enabled ? 'Hiện' : 'Ẩn'}.`);
  }
  for (const quote of payload.quotes || []) effects.push(`Báo giá dời lịch ${quote.bookingCode || ''}: ${formatVND(quote.settlement.oldFinalPrice)} → ${formatVND(quote.settlement.newFinalPrice)}, ngày mới ${quote.change.date}. Đây là báo giá trong lịch sử; cần lấy báo giá mới để xác nhận.`);
  return effects.map((value) => redactAgentHistoryText(value).slice(0, 1200));
}

export function createAdminAgentHistory({ db, transaction, HttpError, now = Date.now }) {
  const fail = (status, message, code) => { throw new HttpError(status, message, code); };
  const conversationRow = (owner, id) => db.prepare('SELECT * FROM admin_agent_conversations WHERE owner_id=? AND id=?').get(owner, id);
  const summary = (row) => ({ id: row.id, title: row.title || 'Cuộc trò chuyện mới', createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() });

  function scrubReceipts(owner, conversationIds, cutoff = null) {
    const ids = new Set(conversationIds || []);
    const rows = db.prepare("SELECT key,value FROM metadata WHERE key LIKE 'admin-agent-request:%'").all();
    for (const row of rows) {
      if (owner && !row.key.startsWith(`admin-agent-request:${owner}:`)) continue;
      const receipt = JSON.parse(row.value);
      if (receipt.response && (conversationIds === null || ids.has(receipt.response.conversationId)
        || (cutoff !== null && receipt.savedAt && receipt.savedAt <= cutoff))) {
        db.prepare('UPDATE metadata SET value=? WHERE key=?').run(JSON.stringify({ messageHash: receipt.messageHash, deleted: true }), row.key);
      }
    }
  }

  function prune() {
    const time = now();
    return transaction(() => {
      const expired = db.prepare('SELECT owner_id,id FROM admin_agent_conversations WHERE deleted_at IS NULL AND expires_at<=?').all(time);
      for (const row of expired) {
        scrubReceipts(row.owner_id, [row.id]);
        db.prepare('DELETE FROM admin_agent_messages WHERE owner_id=? AND conversation_id=?').run(row.owner_id, row.id);
        db.prepare("UPDATE admin_agent_conversations SET title='',deleted_at=? WHERE owner_id=? AND id=?").run(time, row.owner_id, row.id);
      }
      db.prepare('DELETE FROM admin_agent_messages WHERE created_at<=?').run(time - AGENT_HISTORY_TTL_MS);
      // Keep each title within the same retention window as its first surviving message.
      const active = db.prepare("SELECT owner_id,id FROM admin_agent_conversations WHERE deleted_at IS NULL AND title!=''").all();
      for (const row of active) {
        const first = db.prepare("SELECT content FROM admin_agent_messages WHERE owner_id=? AND conversation_id=? AND role='user' ORDER BY id LIMIT 1").get(row.owner_id, row.id);
        db.prepare('UPDATE admin_agent_conversations SET title=? WHERE owner_id=? AND id=?').run(first?.content.slice(0, 80) || '', row.owner_id, row.id);
      }
      scrubReceipts(null, [], time - AGENT_HISTORY_TTL_MS);
      return expired.length;
    });
  }

  function create(owner, id = randomUUID()) {
    const time = now();
    db.prepare('INSERT INTO admin_agent_conversations(owner_id,id,created_at,updated_at,expires_at) VALUES (?,?,?,?,?)')
      .run(owner, id, time, time, time + AGENT_HISTORY_TTL_MS);
    return summary(conversationRow(owner, id));
  }

  function requireConversation(owner, id) {
    const row = conversationRow(owner, id);
    if (!row || row.deleted_at !== null || row.expires_at <= now()) fail(404, 'Không tìm thấy cuộc trò chuyện còn hiệu lực.', 'CONVERSATION_NOT_FOUND');
    return row;
  }

  function list(owner) {
    prune();
    return db.prepare('SELECT * FROM admin_agent_conversations WHERE owner_id=? AND deleted_at IS NULL ORDER BY updated_at DESC,rowid DESC').all(owner).map(summary);
  }

  function read(owner, id, { before = null } = {}) {
    prune();
    const row = requireConversation(owner, id);
    if (before !== null && (!Number.isSafeInteger(before) || before < 1)) fail(400, 'Mốc tin nhắn không hợp lệ.', 'VALIDATION');
    const rows = db.prepare(`SELECT * FROM admin_agent_messages WHERE owner_id=? AND conversation_id=? ${before === null ? '' : 'AND id < ?'} ORDER BY id DESC LIMIT 101`)
      .all(...(before === null ? [owner, id] : [owner, id, before]));
    const hasMore = rows.length > 100;
    const messages = rows.slice(0, 100).reverse().map((message) => ({ id: message.id, requestId: message.request_id,
      role: message.role, content: message.content, state: message.state, metadata: JSON.parse(message.metadata_json), createdAt: new Date(message.created_at).toISOString() }));
    return { conversation: summary(row), messages, hasMore, beforeCursor: hasMore ? messages[0].id : null };
  }

  function begin(owner, id, requestId, hash, message) {
    prune();
    return transaction(() => {
      const row = conversationRow(owner, id);
      if (row && row.deleted_at !== null) fail(410, 'Cuộc trò chuyện đã bị xóa hoặc hết hạn. Hãy tạo cuộc trò chuyện mới.', 'CONVERSATION_DELETED');
      const previous = db.prepare("SELECT * FROM admin_agent_messages WHERE owner_id=? AND request_id=? AND role='assistant'").get(owner, requestId);
      if (previous) {
        if (previous.request_hash !== hash || previous.conversation_id !== id) fail(409, 'Mã yêu cầu đã dùng cho nội dung khác.', 'REQUEST_CONFLICT');
        if (previous.state !== 'failed') fail(409, 'Yêu cầu đã được xử lý hoặc bị gián đoạn. Hãy xem lịch sử và kiểm tra dữ liệu trước khi gửi lệnh mới.', 'REQUEST_ALREADY_RECORDED');
        db.prepare("UPDATE admin_agent_messages SET state='pending',content=CASE WHEN role='assistant' THEN 'Đang xử lý yêu cầu…' ELSE content END,metadata_json='{}' WHERE owner_id=? AND request_id=?")
          .run(owner, requestId);
      } else {
        if (!row) create(owner, id);
        const insert = db.prepare('INSERT INTO admin_agent_messages(owner_id,conversation_id,request_id,request_hash,role,content,state,created_at) VALUES (?,?,?,?,?,?,?,?)');
        insert.run(owner, id, requestId, hash, 'user', redactAgentHistoryText(message).slice(0, 1200), 'pending', now());
        insert.run(owner, id, requestId, hash, 'assistant', 'Đang xử lý yêu cầu…', 'pending', now());
      }
      db.prepare("UPDATE admin_agent_conversations SET title=CASE WHEN title='' THEN ? ELSE title END,updated_at=?,expires_at=? WHERE owner_id=? AND id=?")
        .run(redactAgentHistoryText(message).slice(0, 80), now(), now() + AGENT_HISTORY_TTL_MS, owner, id);
    });
  }

  function history(owner, id) {
    requireConversation(owner, id);
    return db.prepare("SELECT role,content FROM admin_agent_messages WHERE owner_id=? AND conversation_id=? AND state='completed' ORDER BY id DESC LIMIT 20")
      .all(owner, id).reverse().map(({ role, content }) => ({ role, content }));
  }

  function recordEffects(owner, id, requestId, payload) {
    requireConversation(owner, id);
    db.prepare("UPDATE admin_agent_messages SET metadata_json=? WHERE owner_id=? AND conversation_id=? AND request_id=? AND role='assistant' AND state='pending'")
      .run(JSON.stringify({ effects: effectSummaries(payload) }), owner, id, requestId);
  }

  function finish(owner, id, requestId, hash, payload) {
    const response = { ...payload, reply: redactAgentHistoryText(payload.reply).slice(0, 1800) };
    transaction(() => {
      requireConversation(owner, id);
      db.prepare("UPDATE admin_agent_messages SET state='completed' WHERE owner_id=? AND request_id=?").run(owner, requestId);
      db.prepare("UPDATE admin_agent_messages SET content=?,metadata_json=? WHERE owner_id=? AND request_id=? AND role='assistant'")
        .run(response.reply, JSON.stringify({ effects: effectSummaries(payload) }), owner, requestId);
      db.prepare('UPDATE admin_agent_conversations SET updated_at=?,expires_at=? WHERE owner_id=? AND id=?').run(now(), now() + AGENT_HISTORY_TTL_MS, owner, id);
      db.prepare('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run(`admin-agent-request:${owner}:${requestId}`, JSON.stringify({ messageHash: hash, response, savedAt: now() }));
    });
    return response;
  }

  function markFailed(owner, requestId, message, code) {
    transaction(() => {
      db.prepare("UPDATE admin_agent_messages SET state='failed' WHERE owner_id=? AND request_id=?").run(owner, requestId);
      db.prepare("UPDATE admin_agent_messages SET content=?,metadata_json=json_set(metadata_json,'$.errorCode',?) WHERE owner_id=? AND request_id=? AND role='assistant'")
        .run(redactAgentHistoryText(message).slice(0, 1800), code, owner, requestId);
    });
  }

  function remove(owner, id = null) {
    return transaction(() => {
      if (id) requireConversation(owner, id);
      const rows = id ? [{ id }] : db.prepare('SELECT id FROM admin_agent_conversations WHERE owner_id=? AND deleted_at IS NULL').all(owner);
      const ids = rows.map((row) => row.id);
      scrubReceipts(owner, id ? ids : null);
      for (const conversationId of ids) {
        db.prepare('DELETE FROM admin_agent_messages WHERE owner_id=? AND conversation_id=?').run(owner, conversationId);
        db.prepare("UPDATE admin_agent_conversations SET title='',deleted_at=? WHERE owner_id=? AND id=?").run(now(), owner, conversationId);
      }
      return { deletedCount: ids.length };
    });
  }

  function recoverInterrupted() {
    db.prepare("UPDATE admin_agent_messages SET state='interrupted',content=CASE WHEN role='assistant' THEN 'Yêu cầu bị gián đoạn khi máy chủ khởi động lại. Hãy kiểm tra dữ liệu và nhật ký thao tác; mở lại hội thoại không thực hiện lại lệnh.' ELSE content END WHERE state='pending'").run();
  }

  return { create, list, read, begin, history, recordEffects, finish, markFailed, remove, prune, recoverInterrupted };
}
