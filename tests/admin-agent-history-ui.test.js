import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAdminAgent } from '../assets/js/pages/adminAgentPage.js';
import { adminAgentService } from '../assets/js/services/adminAgentService.js';
import { authService } from '../assets/js/services/authService.js';
import { apiClient } from '../assets/js/services/apiClient.js';

class Node {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = new Map(); this.isConnected = true; this.disabled = false; this.value = ''; this.textContent = ''; this.classList = { add() {} }; }
  append(...nodes) { for (const node of nodes) this.children.push(...(node.tag === 'fragment' ? node.children : [node])); }
  prepend(node) { this.children.unshift(...(node.tag === 'fragment' ? node.children : [node])); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  get scrollHeight() { return this.children.length * 50; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  dispatch(type) { return this.listeners.get(type)?.({ preventDefault() {} }); }
  focus() {}
  querySelector(selector) { return this.children.find((node) => node.tag === selector) || null; }
}
function fixture() {
  const selectors = new Map();
  const container = new Node();
  Object.defineProperty(container, 'innerHTML', { set(html) {
    container.markup = html;
    for (const selector of ['.spa-agent-panel', '.spa-agent-transcript', '.spa-agent-form', '#spaAgentMessage', '#spaAgentConversation', '[data-history-status]', '[data-load-older]', '[data-new-conversation]', '[data-delete-conversation]', '[data-clear-history]', '[data-refresh-history]']) selectors.set(selector, new Node());
    const submit = new Node('button');
    selectors.set('submit', submit);
    selectors.get('.spa-agent-form').querySelector = () => submit;
  } });
  container.querySelector = (selector) => selectors.get(selector);
  container.querySelectorAll = () => [];
  const storage = new Map();
  return { container, selectors, document: { createElement: (tag) => new Node(tag), createDocumentFragment: () => new Node('fragment') },
    window: { confirm: () => true, sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } } };
}
async function withUi(work) {
  const originals = { document: globalThis.document, window: globalThis.window, methods: { ...adminAgentService }, currentUser: authService.getCurrentUser, refresh: apiClient.refresh, confirm: apiClient.confirmReschedule };
  const ui = fixture();
  globalThis.document = ui.document; globalThis.window = ui.window;
  authService.getCurrentUser = () => ({ id: 'admin-ui', role: 'admin' });
  apiClient.refresh = async () => {};
  let confirmations = 0;
  apiClient.confirmReschedule = async () => { confirmations++; };
  try { await work(ui, () => confirmations); }
  finally { Object.assign(adminAgentService, originals.methods); authService.getCurrentUser = originals.currentUser; apiClient.refresh = originals.refresh; apiClient.confirmReschedule = originals.confirm; globalThis.document = originals.document; globalThis.window = originals.window; }
}

test('opening, switching, creating and deleting conversations never sends an old command or confirms an archived quote', async () => {
  await withUi(async (ui, confirmations) => {
    let conversations = [{ id: 'conversation-first', title: '<script>title</script>', updatedAt: '2026-10-20T05:00:00Z' }, { id: 'conversation-second', title: 'Cũ hơn', updatedAt: '2026-10-19T05:00:00Z' }];
    let sends = 0;
    const reads = [];
    adminAgentService.listConversations = async () => ({ conversations });
    adminAgentService.getConversation = async (id) => {
      reads.push(id);
      return { conversation: { id }, messages: id === 'conversation-new' ? [] : [
        { id: 1, role: 'user', content: '<img onerror=alert(1)>', state: 'completed', createdAt: '2026-10-20T05:00:00Z' },
        { id: 2, role: 'assistant', content: 'Đã lấy báo giá.', state: 'completed', metadata: { effects: ['Báo giá cũ chỉ để xem lại.'], quotes: [{ id: 'must-not-confirm' }] } },
      ], hasMore: false, busy: false };
    };
    adminAgentService.sendMessage = async () => { sends++; };
    adminAgentService.createConversation = async () => { const conversation = { id: 'conversation-new', title: 'Mới', updatedAt: '2026-10-20T06:00:00Z' }; conversations = [conversation, ...conversations]; return { conversation }; };
    adminAgentService.deleteConversation = async (id) => { assert.equal(id, 'conversation-new'); conversations = conversations.filter((row) => row.id !== id); return {}; };
    adminAgentService.clearHistory = async () => { conversations = []; return {}; };
    await renderAdminAgent(ui.container);
    const transcript = ui.selectors.get('.spa-agent-transcript');
    assert.equal(transcript.children[0].querySelector('p').textContent, '<img onerror=alert(1)>');
    assert.equal(ui.selectors.get('#spaAgentConversation').children[0].textContent.startsWith('<script>title</script>'), true);
    assert.equal(ui.container.markup.includes('<img onerror=alert(1)>'), false);
    assert.equal(confirmations(), 0);
    const select = ui.selectors.get('#spaAgentConversation'); select.value = 'conversation-second';
    await select.dispatch('change');
    assert.deepEqual(reads, ['conversation-first', 'conversation-second']);
    await ui.selectors.get('[data-new-conversation]').dispatch('click');
    await ui.selectors.get('[data-delete-conversation]').dispatch('click');
    await ui.selectors.get('[data-clear-history]').dispatch('click');
    assert.equal(sends, 0);
    assert.equal(confirmations(), 0);
  });
});

test('an explicit send retry reuses the request ID and existing bubbles after a saved AI error', async () => {
  await withUi(async (ui) => {
    const conversation = { id: 'conversation-existing', title: 'Chat', updatedAt: '2026-10-20T05:00:00Z' };
    adminAgentService.listConversations = async () => ({ conversations: [conversation] });
    adminAgentService.getConversation = async () => ({ conversation, messages: [], busy: false, hasMore: false });
    const requests = [];
    adminAgentService.sendMessage = async (_id, _message, _signal, requestId) => {
      requests.push(requestId);
      if (requests.length === 1) throw Object.assign(new Error('AI chưa phản hồi'), { status: 503, code: 'AGENT_UNAVAILABLE' });
      return { reply: 'Đã kiểm tra.', actions: [], quotes: [], siteChanges: [] };
    };
    await renderAdminAgent(ui.container);
    const input = ui.selectors.get('#spaAgentMessage');
    input.value = 'Kiểm tra lịch';
    await ui.selectors.get('.spa-agent-form').dispatch('submit');
    assert.equal(input.value, 'Kiểm tra lịch');
    await ui.selectors.get('.spa-agent-form').dispatch('submit');
    assert.equal(requests.length, 2);
    assert.equal(requests[0], requests[1]);
    assert.equal(ui.selectors.get('.spa-agent-transcript').children.length, 3, 'greeting plus one user and one assistant bubble');
  });
});

test('a history-list refresh failure after a committed send never restores the command as an unsent draft', async () => {
  await withUi(async (ui) => {
    const conversation = { id: 'conversation-existing', title: 'Chat', updatedAt: '2026-10-20T05:00:00Z' };
    let lists = 0;
    adminAgentService.listConversations = async () => { if (++lists > 1) throw new Error('Network during list refresh'); return { conversations: [conversation] }; };
    adminAgentService.getConversation = async () => ({ conversation, messages: [], busy: false, hasMore: false });
    let sends = 0;
    adminAgentService.sendMessage = async () => { sends++; return { reply: 'Đã lưu thay đổi.', actions: [], quotes: [], siteChanges: [] }; };
    await renderAdminAgent(ui.container);
    ui.selectors.get('#spaAgentMessage').value = 'Tạo sale lễ';
    await ui.selectors.get('.spa-agent-form').dispatch('submit');
    assert.equal(ui.selectors.get('#spaAgentMessage').value, '');
    assert.match(ui.selectors.get('[data-history-status]').textContent, /đã xử lý và lưu/i);
    await ui.selectors.get('.spa-agent-form').dispatch('submit');
    assert.equal(sends, 1);
  });
});
