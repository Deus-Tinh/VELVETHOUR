import { adminAgentService } from '../services/adminAgentService.js';
import { apiClient } from '../services/apiClient.js';
import { authService } from '../services/authService.js';
import { renderRescheduleQuote } from '../ui/rescheduleQuote.js';

const GREETING = 'Xin chào! Mình có thể quản lý lịch, sale lễ, mục menu và trang ưu đãi theo mẫu. Hãy nêu rõ yêu cầu thay đổi. Lịch sử được lưu 30 ngày; mở lại hội thoại không thực hiện lại lệnh cũ.';
const dateLabel = (date) => new Date(date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' });

function addMessage(transcript, role, text, createdAt = null) {
  const message = document.createElement('article');
  message.className = `spa-agent-message is-${role}`;
  const label = document.createElement('span');
  label.className = 'spa-agent-message-label';
  label.textContent = role === 'user' ? 'Bạn' : 'Agent Serenity';
  const content = document.createElement('p');
  content.textContent = text;
  message.append(label, content);
  if (createdAt) {
    const time = document.createElement('time');
    time.dateTime = createdAt;
    time.textContent = dateLabel(createdAt);
    message.append(time);
  }
  transcript.append(message);
  return message;
}

export function renderStoredAgentMessage(transcript, item) {
  const message = addMessage(transcript, item.role, item.content, item.createdAt);
  if (item.state === 'failed' || item.state === 'interrupted') message.classList.add('is-failed');
  for (const effect of item.metadata?.effects || []) {
    const detail = document.createElement('p');
    detail.className = 'spa-agent-history-effect';
    detail.textContent = effect;
    message.append(detail);
  }
  return message;
}

export function renderAdminAgent(container) {
  let conversationId = null;
  let conversations = [];
  let retryRequest = null;
  let busy = true;
  let sequence = 0;
  let beforeCursor = null;
  let pollTimer = null;
  const ownerId = authService.getCurrentUser()?.id || 'admin';
  const storageKey = `spa-agent-active:${ownerId}`;
  const remembered = () => { try { return window.sessionStorage.getItem(storageKey); } catch { return null; } };
  const remember = () => { try { if (conversationId) window.sessionStorage.setItem(storageKey, conversationId); else window.sessionStorage.removeItem(storageKey); } catch { /* Server history remains usable without browser storage. */ } };
  container.innerHTML = `
    <section class="spa-agent-panel" aria-labelledby="spaAgentTitle">
      <header class="spa-agent-header">
        <div class="spa-agent-mark" aria-hidden="true">✿</div>
        <div><h2 id="spaAgentTitle">Agent quản lý lịch, sale &amp; nội dung website</h2>
          <p>Tạo sale theo ngày sử dụng, thêm mục menu và trang ưu đãi theo mẫu. Dời lịch cần xác nhận giá trước khi lưu.</p></div>
        <span class="spa-agent-access">Admin</span>
      </header>
      <div class="spa-agent-history-toolbar">
        <label for="spaAgentConversation">Hội thoại của bạn<select id="spaAgentConversation" aria-label="Chọn hội thoại cũ"><option value="">Đang tải lịch sử…</option></select></label>
        <button type="button" class="btn-outline btn-sm" data-new-conversation>Cuộc trò chuyện mới</button>
        <button type="button" class="btn-outline btn-sm" data-delete-conversation>Xóa cuộc trò chuyện</button>
        <button type="button" class="btn-outline btn-sm" data-clear-history>Xóa toàn bộ lịch sử</button>
        <button type="button" class="btn-outline btn-sm" data-refresh-history>Tải lại</button>
      </div>
      <p class="spa-agent-history-status" role="status" data-history-status></p>
      <div class="spa-agent-prompts" aria-label="Gợi ý câu hỏi">
        <button type="button" data-prompt="Liệt kê các lịch hẹn hôm nay">Lịch hôm nay</button>
        <button type="button" data-prompt="Liệt kê lịch đang chờ xác nhận">Lịch chờ xác nhận</button>
        <button type="button" data-prompt="Liệt kê các chương trình sale lễ và thời gian áp dụng">Các sale lễ</button>
        <button type="button" data-prompt="Tạo trang ưu đãi lễ theo mẫu và thêm mục vào menu website">Trang ưu đãi</button>
      </div>
      <button type="button" class="spa-agent-load-older" data-load-older hidden>Xem tin nhắn cũ hơn</button>
      <div class="spa-agent-transcript" role="log" aria-live="polite" aria-relevant="additions"></div>
      <form class="spa-agent-form"><label class="spa-agent-sr-only" for="spaAgentMessage">Tin nhắn cho agent quản lý</label>
        <textarea id="spaAgentMessage" name="message" rows="2" maxlength="1200" placeholder="Ví dụ: tạo sale 15% cho dịch vụ ... vào ngày ..." required></textarea>
        <button type="submit" class="btn-primary">Gửi</button></form>
      <p class="spa-agent-footnote">Lịch sử lưu 30 ngày, chỉ tài khoản admin của bạn xem được. Số điện thoại và email được ẩn trong lịch sử. Mở lại chat không chạy lại lệnh; kết quả thao tác cũ và báo giá cũ chỉ để xem lại.</p>
    </section>`;

  const panel = container.querySelector('.spa-agent-panel');
  const transcript = container.querySelector('.spa-agent-transcript');
  const form = container.querySelector('.spa-agent-form');
  const input = container.querySelector('#spaAgentMessage');
  const sendButton = form.querySelector('button[type="submit"]');
  const select = container.querySelector('#spaAgentConversation');
  const status = container.querySelector('[data-history-status]');
  const olderButton = container.querySelector('[data-load-older]');
  const newButton = container.querySelector('[data-new-conversation]');
  const deleteButton = container.querySelector('[data-delete-conversation]');
  const clearButton = container.querySelector('[data-clear-history]');
  const refreshButton = container.querySelector('[data-refresh-history]');
  const promptButtons = container.querySelectorAll('[data-prompt]');
  const alive = () => panel.isConnected && container.querySelector('.spa-agent-panel') === panel && authService.getCurrentUser()?.id === ownerId;
  const setBusy = (value) => {
    busy = value;
    input.disabled = value; sendButton.disabled = value; select.disabled = value;
    newButton.disabled = value; deleteButton.disabled = value || !conversationId;
    clearButton.disabled = value || !conversations.length; refreshButton.disabled = value;
    olderButton.disabled = value;
    promptButtons.forEach((button) => { button.disabled = value; });
    sendButton.textContent = value ? 'Đang xử lý…' : 'Gửi';
  };
  const drawOptions = () => {
    select.replaceChildren();
    if (!conversations.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'Chưa có hội thoại'; select.append(option);
    }
    for (const row of conversations) {
      const option = document.createElement('option'); option.value = row.id;
      option.textContent = `${row.title} · ${dateLabel(row.updatedAt)}`;
      select.append(option);
    }
    select.value = conversationId || '';
  };
  const refreshList = async () => {
    const result = await adminAgentService.listConversations();
    if (!alive()) return;
    conversations = result.conversations;
    drawOptions();
  };
  const loadConversation = async (id, before = null) => {
    clearTimeout(pollTimer);
    const ticket = ++sequence;
    setBusy(true);
    let serverBusy = false;
    try {
      const result = await adminAgentService.getConversation(id, before);
      if (!alive() || ticket !== sequence) return;
      conversationId = id; remember(); select.value = id;
      const oldHeight = transcript.scrollHeight;
      if (before === null) { transcript.replaceChildren(); retryRequest = null; }
      const fragment = document.createDocumentFragment();
      for (const item of result.messages) renderStoredAgentMessage(fragment, item);
      if (before === null) transcript.append(fragment); else transcript.prepend(fragment);
      if (!result.messages.length && before === null) addMessage(transcript, 'assistant', GREETING);
      beforeCursor = result.beforeCursor;
      olderButton.hidden = !result.hasMore;
      transcript.scrollTop = before === null ? transcript.scrollHeight : transcript.scrollHeight - oldHeight;
      serverBusy = result.busy;
      status.textContent = serverBusy ? 'Máy chủ đang xử lý yêu cầu đã gửi. Đang chờ kết quả…' : 'Đã tải hội thoại. Các lệnh cũ không được thực hiện lại.';
      if (serverBusy) pollTimer = setTimeout(() => { if (alive() && conversationId === id) loadConversation(id); }, 2500);
      return result;
    } catch (error) {
      if (alive() && ticket === sequence) status.textContent = error.message || 'Không tải được hội thoại.';
    } finally { if (alive() && ticket === sequence) setBusy(serverBusy); }
  };
  const initialize = async () => {
    setBusy(true);
    try {
      await refreshList();
      if (!alive()) return;
      const selected = conversations.find((row) => row.id === remembered()) || conversations[0];
      if (selected) await loadConversation(selected.id);
      else {
        conversationId = null; remember(); beforeCursor = null; olderButton.hidden = true;
        transcript.replaceChildren(); addMessage(transcript, 'assistant', GREETING);
        status.textContent = 'Chưa có lịch sử. Hội thoại sẽ được lưu khi bạn gửi tin nhắn.'; setBusy(false);
      }
    } catch (error) {
      if (alive()) { status.textContent = error.message || 'Không tải được lịch sử. Hãy kiểm tra máy chủ và tải lại.'; setBusy(false); }
    }
  };
  const createConversation = async () => {
    const result = await adminAgentService.createConversation();
    if (!alive()) return;
    conversationId = result.conversation.id; remember(); retryRequest = null;
    await refreshList();
    await loadConversation(conversationId);
  };

  const sendMessage = async (rawMessage) => {
    const message = String(rawMessage || '').trim();
    if (!message || busy) return;
    setBusy(true);
    let polling = false;
    let saved = false;
    try {
      if (!conversationId) {
        const result = await adminAgentService.createConversation();
        if (!alive()) return;
        conversationId = result.conversation.id; remember();
      }
      if (retryRequest?.message !== message || retryRequest.conversationId !== conversationId) {
        retryRequest = { message, id: globalThis.crypto.randomUUID(), conversationId,
          user: addMessage(transcript, 'user', message), pending: addMessage(transcript, 'assistant', 'Đang kiểm tra yêu cầu…') };
      } else retryRequest.pending.querySelector('p').textContent = 'Đang kiểm tra yêu cầu…';
      const pending = retryRequest.pending;
      input.value = ''; transcript.scrollTop = transcript.scrollHeight;
      const result = await adminAgentService.sendMessage(conversationId, message, undefined, retryRequest.id);
      if (!alive()) return;
      saved = true;
      retryRequest = null;
      pending.querySelector('p').textContent = result.reply || 'Agent chưa trả về nội dung.';
      for (const action of result.actions || []) if (action.sale) addMessage(transcript, 'assistant', `Sale đã xác minh: ${action.sale.name} · ${action.sale.serviceDateFrom} đến ${action.sale.serviceDateTo} · phiên bản ${action.sale.revision}.`);
      for (const change of result.siteChanges || []) {
        if (change.page) addMessage(transcript, 'assistant', `Trang đã xác minh: ${change.page.title} · /uu-dai/${change.page.slug}.`);
        if (change.menuItem) addMessage(transcript, 'assistant', `Menu đã xác minh: ${change.menuItem.label} → ${change.menuItem.targetHref}.`);
      }
      for (const quote of result.quotes || []) {
        const area = document.createElement('div'); transcript.append(area);
        renderRescheduleQuote(area, quote, { onConfirmed: () => apiClient.refresh() });
      }
      status.textContent = 'Đã lưu tin nhắn và kết quả vào lịch sử.';
      await refreshList();
      apiClient.refresh().catch(() => {});
    } catch (error) {
      if (!alive()) return;
      if (saved) {
        input.value = '';
        status.textContent = 'Máy chủ đã xử lý và lưu kết quả. Chưa tải lại được danh sách hội thoại; hãy bấm Tải lại để xem.';
        return;
      }
      input.value = message;
      if (retryRequest?.pending) retryRequest.pending.querySelector('p').textContent = error.message || 'Không thể gửi yêu cầu. Vui lòng thử lại.';
      status.textContent = error.message || 'Không thể gửi yêu cầu.';
      // A disconnected client may have left a request running. Reading history only polls its result.
      if ((!error.status || ['CONVERSATION_BUSY', 'REQUEST_IN_PROGRESS'].includes(error.code)) && conversationId) {
        const requestId = retryRequest?.id;
        const restored = await loadConversation(conversationId);
        if (restored?.messages.some((item) => item.requestId === requestId && item.role === 'assistant' && item.state === 'completed')) input.value = '';
        polling = busy;
      } else if (error.status === 410) {
        conversationId = null; retryRequest = null; remember(); await initialize(); polling = busy;
      }
      refreshList().catch(() => {});
    } finally {
      if (alive() && !polling) { setBusy(false); input.focus(); transcript.scrollTop = transcript.scrollHeight; }
    }
  };

  form.addEventListener('submit', (event) => { event.preventDefault(); return sendMessage(input.value); });
  promptButtons.forEach((button) => button.addEventListener('click', () => sendMessage(button.dataset.prompt)));
  select.addEventListener('change', () => { if (!busy && select.value) { input.value = ''; return loadConversation(select.value); } });
  olderButton.addEventListener('click', () => { if (!busy && beforeCursor) return loadConversation(conversationId, beforeCursor); });
  refreshButton.addEventListener('click', () => initialize());
  newButton.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true); input.value = '';
    try { await createConversation(); } catch (error) { if (alive()) { status.textContent = error.message; setBusy(false); } }
  });
  deleteButton.addEventListener('click', async () => {
    if (busy || !conversationId || !window.confirm('Xóa nội dung cuộc trò chuyện này? Các thay đổi đã thực hiện trên website vẫn được giữ trong nhật ký thao tác.')) return;
    setBusy(true);
    try { await adminAgentService.deleteConversation(conversationId); conversationId = null; retryRequest = null; transcript.replaceChildren(); remember(); input.value = ''; await initialize(); }
    catch (error) { if (alive()) { status.textContent = error.message; setBusy(false); } }
  });
  clearButton.addEventListener('click', async () => {
    if (busy || !window.confirm('Xóa toàn bộ lịch sử Agent Spa của tài khoản bạn? Các admin khác không bị ảnh hưởng.')) return;
    setBusy(true);
    try { await adminAgentService.clearHistory(); conversationId = null; retryRequest = null; transcript.replaceChildren(); remember(); input.value = ''; await initialize(); }
    catch (error) { if (alive()) { status.textContent = error.message; setBusy(false); } }
  });
  return initialize();
}
