import test from 'node:test';
import assert from 'node:assert/strict';
import { redactAgentHistoryText } from '../server/adminAgentHistory.js';
import { redactChatText } from '../server/chatbot.js';

for (const [name, redact] of [['admin history', redactAgentHistoryText], ['customer chat', redactChatText]]) {
  test(`${name} preserves appointment dates and times while hiding contact details`, () => {
    const schedule = 'Ngày cũ: 2026-10-22 (10:00). Ngày mới: 03-05-2026 (10:00), 20/10/2026 và 2026/10/23.';
    assert.equal(redact(schedule), schedule);
    assert.equal(redact(`${schedule} SĐT 0987654321, +84 (987) 654-321, email test@example.com.`),
      `${schedule} SĐT [số điện thoại đã ẩn], [số điện thoại đã ẩn], email [email đã ẩn].`);
    assert.equal(redact('Ngày 03-05-2026 0987654321'), 'Ngày 03-05-2026 [số điện thoại đã ẩn]');
    assert.equal(redact('0987-65-4321'), '[số điện thoại đã ẩn]');
  });
}
