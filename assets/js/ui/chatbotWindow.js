import { chatbotService } from '../services/chatbotService.js';
import { getServiceImage } from '../imageManifest.js';
import { cleanSpaHref } from '../core/spaRouter.js';

const MAX_LENGTH = 1200;
const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
let panel;
let launcher;
let messageList;
let composer;
let sendButton;
let statusLine;
let headerStatus;
let conversationId = null;
let busy = false;
let initialized = false;
let controller = null;

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function ensureStyles() {
  if (document.querySelector('link[data-serenity-chat-style]')) return;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = '/assets/css/chatbot.css';
  style.dataset.serenityChatStyle = 'true';
  document.head.append(style);
}

function safeRoute(path) {
  const cleaned = cleanSpaHref(path, window.location.href);
  return cleaned.startsWith('/') && !cleaned.startsWith('//') ? cleaned : '/';
}

function formatBookingDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return 'Ngày chưa xác định';
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'long', timeZone: 'Asia/Ho_Chi_Minh' })
    .format(new Date(Date.UTC(year, month - 1, day, 5)));
}

function isNearBottom() {
  return messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 72;
}

function scrollIfFollowing(wasAtBottom, instant = false) {
  if (!wasAtBottom) return;
  messageList.scrollTo({ top: messageList.scrollHeight, behavior: instant || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function addServiceCard(container, service, selectedServiceId = null) {
  const card = el('article', 'serenity-chat-service-card');
  const imageInfo = getServiceImage(service);
  const image = el('img', 'serenity-chat-service-image');
  image.src = imageInfo.url;
  image.alt = service.name || 'Dịch vụ Serenity Spa';
  image.loading = 'lazy';
  card.append(image);

  const details = el('div', 'serenity-chat-service-details');
  const category = el('p', 'serenity-chat-service-category', service.categoryName || 'Dịch vụ Serenity Spa');
  const title = el('h4', '', service.name || 'Dịch vụ');
  const desc = el('p', 'serenity-chat-service-desc', service.shortDesc || '');
  const meta = el('p', 'serenity-chat-service-meta');
  if (['holiday_sale', 'holiday_sale_and_coupon'].includes(service.pricing?.discountSource)) meta.append(el('del', '', money.format(service.originalPrice)), document.createTextNode(' → '));
  meta.append(document.createTextNode(`${money.format(Number(service.price) || 0)} · ${Number(service.duration) || 0} phút${service.serviceDate ? ` · ngày ${service.serviceDate}` : ''}`));
  details.append(category, title, meta, desc);

  const actions = el('div', 'serenity-chat-service-actions');
  const detailsLink = el('a', 'serenity-chat-card-link', 'Xem chi tiết');
  detailsLink.href = `/dich-vu/${encodeURIComponent(service.id)}${service.serviceDate ? `?date=${encodeURIComponent(service.serviceDate)}` : ''}`;
  const bookParams = new URLSearchParams({ service: service.id, duration: String(service.duration) });
  if (service.serviceDate) bookParams.set('date', service.serviceDate);
  const bookingLink = el('a', 'serenity-chat-card-primary', 'Đặt lịch');
  bookingLink.href = `/dat-lich?${bookParams}`;
  const slots = el('button', 'serenity-chat-card-link', 'Kiểm tra lịch');
  slots.type = 'button';
  slots.dataset.action = 'checkAvailability';
  slots.dataset.serviceName = service.name || '';
  slots.dataset.serviceId = service.id || '';
  slots.dataset.serviceDuration = String(service.duration || '');
  const selected = selectedServiceId === service.id;
  const selectButton = el('button', 'serenity-chat-card-select', selected ? 'Đã chọn dịch vụ' : 'Chọn dịch vụ này');
  selectButton.type = 'button';
  selectButton.dataset.action = 'selectService';
  selectButton.dataset.serviceName = service.name || '';
  selectButton.dataset.serviceId = service.id || '';
  selectButton.dataset.serviceDuration = String(service.duration || '');
  selectButton.dataset.alreadySelected = String(selected);
  selectButton.disabled = selected;
  actions.append(detailsLink, slots, selectButton, bookingLink);
  details.append(actions);
  card.append(details);
  container.append(card);
}

function addMessage(message, options = {}) {
  const wasAtBottom = options.forceBottom || isNearBottom();
  const article = el('article', `serenity-chat-message serenity-chat-message-${message.role === 'user' ? 'user' : 'assistant'}`);
  const bubble = el('div', 'serenity-chat-bubble');
  const text = el('p', 'serenity-chat-message-text', message.text || '');
  bubble.append(text);

  if (Array.isArray(message.services) && message.services.length) {
    const cards = el('div', 'serenity-chat-service-list');
    message.services.forEach((service) => addServiceCard(cards, service, message.selectedServiceId));
    bubble.append(cards);
  }

  if (Array.isArray(message.bookings) && message.bookings.length) {
    const bookings = el('div', 'serenity-chat-booking-list');
    message.bookings.forEach((booking) => {
      const card = el('div', 'serenity-chat-booking-card');
      const code = el('strong', '', booking.code || 'Lịch hẹn');
      const service = el('span', '', booking.serviceName || 'Dịch vụ Serenity Spa');
      const schedule = el('span', '', `${booking.startTime || ''} · ${formatBookingDate(booking.date)}`);
      const state = el('span', 'serenity-chat-booking-state', booking.status || 'Đang cập nhật');
      card.append(code, service, schedule, state);
      bookings.append(card);
    });
    bubble.append(bookings);
  }

  if (Array.isArray(message.quickReplies) && message.quickReplies.length) {
    const replies = el('div', 'serenity-chat-quick-replies');
    message.quickReplies.forEach((reply) => {
      const button = el('button', 'serenity-chat-quick-reply', reply.label || reply.value || 'Chọn');
      button.type = 'button';
      button.dataset.action = 'quickReply';
      button.dataset.value = reply.value || reply.label || '';
      replies.append(button);
    });
    bubble.append(replies);
  }

  if (Array.isArray(message.actions) && message.actions.length) {
    const actions = el('div', 'serenity-chat-actions');
    message.actions.forEach((action) => {
      const link = el('a', 'serenity-chat-action-link', action.label || 'Tiếp tục');
      link.href = safeRoute(action.href);
      actions.append(link);
    });
    bubble.append(actions);
  }

  article.append(bubble);
  messageList.append(article);
  scrollIfFollowing(wasAtBottom, options.forceBottom);
  return article;
}

function addTyping() {
  statusLine.hidden = false;
  statusLine.textContent = 'Đang tìm thông tin phù hợp…';
  panel.classList.add('is-busy');
}

function removeTyping() {
  statusLine.hidden = true;
  statusLine.textContent = '';
  panel.classList.remove('is-busy');
}

function setBusy(next) {
  busy = next;
  sendButton.disabled = busy;
  composer.querySelector('input').disabled = busy;
  panel.querySelectorAll('[data-action="quickReply"], [data-action="checkAvailability"], [data-action="selectService"]').forEach((button) => {
    button.disabled = busy || button.dataset.alreadySelected === 'true';
  });
  if (busy) addTyping();
  else removeTyping();
}

function showLoadError(error) {
  messageList.replaceChildren();
  addMessage({ role: 'assistant', text: error?.message || 'Không thể kết nối trợ lý. Hãy thử tải lại cuộc trò chuyện.' });
  statusLine.hidden = true;
}

async function loadSession() {
  try {
    const state = await chatbotService.loadSession(controller.signal);
    conversationId = state.conversationId;
    messageList.replaceChildren();
    (state.messages || []).forEach((message) => addMessage(message, { forceBottom: true }));
    if (!state.messages?.length) addMessage({ role: 'assistant', text: 'Xin chào! Mình có thể giúp bạn tìm dịch vụ hoặc kiểm tra lịch trống.' });
    headerStatus.textContent = state.aiAvailable ? 'Trợ lý tư vấn 24/7' : 'Tư vấn nhanh · AI chưa cấu hình';
    statusLine.textContent = '';
    statusLine.hidden = true;
    scrollIfFollowing(true, true);
    return true;
  } catch (error) {
    showLoadError(error);
    return false;
  }
}

async function sendMessage(value, options = {}) {
  const message = String(value || '').trim();
  if (!message || busy || !conversationId) return;
  const input = composer.querySelector('input');
  if (message.length > MAX_LENGTH) {
    input.setCustomValidity(`Tin nhắn tối đa ${MAX_LENGTH} ký tự.`);
    input.reportValidity();
    return;
  }
  const sentFromComposer = input.value.trim() === message;
  setBusy(true);
  const optimisticMessage = addMessage({ role: 'user', text: message }, { forceBottom: true });
  if (sentFromComposer) {
    input.value = '';
    input.setCustomValidity('');
  }
  try {
    const response = await chatbotService.sendMessage(conversationId, message, controller.signal, options);
    (response.messages || []).filter((item) => item.role !== 'user').forEach((item) => addMessage(item));
    if (response.aiFailed) headerStatus.textContent = 'Trợ lý AI tạm thời không khả dụng';
  } catch (error) {
    optimisticMessage.remove();
    const retryHint = sentFromComposer
      ? 'Nội dung vẫn được giữ trong ô nhập để bạn gửi lại.'
      : 'Bạn có thể thử lại sau.';
    addMessage({ role: 'assistant', text: `${error?.message || 'Trợ lý đang gặp sự cố.'} ${retryHint}` });
    if (sentFromComposer && !input.value) input.value = message;
  } finally {
    setBusy(false);
    input.focus({ preventScroll: true });
  }
}

async function resetConversation() {
  if (busy) return;
  setBusy(true);
  try {
    const state = await chatbotService.startNewConversation(controller.signal);
    conversationId = state.conversationId;
    headerStatus.textContent = state.aiAvailable ? 'Trợ lý tư vấn 24/7' : 'Tư vấn nhanh · AI chưa cấu hình';
    messageList.replaceChildren();
    (state.messages || []).forEach((message) => addMessage(message, { forceBottom: true }));
    composer.querySelector('input').value = '';
  } catch (error) {
    addMessage({ role: 'assistant', text: error?.message || 'Không thể bắt đầu cuộc trò chuyện mới.' });
  } finally {
    setBusy(false);
    composer.querySelector('input').focus({ preventScroll: true });
  }
}

function minimize() {
  panel.classList.add('is-minimized');
  panel.setAttribute('aria-expanded', 'false');
  launcher?.setAttribute('aria-expanded', 'false');
  launcher?.focus({ preventScroll: true });
}

function closePanel() {
  panel.hidden = true;
  panel.classList.remove('is-minimized');
  panel.setAttribute('aria-expanded', 'false');
  launcher?.setAttribute('aria-expanded', 'false');
  launcher?.focus({ preventScroll: true });
}

async function openPanel() {
  panel.hidden = false;
  panel.classList.remove('is-minimized');
  panel.setAttribute('aria-expanded', 'true');
  launcher?.setAttribute('aria-expanded', 'true');
  if (!initialized) {
    initialized = true;
    controller = new AbortController();
    statusLine.hidden = false;
    statusLine.textContent = 'Đang kết nối trợ lý…';
    await loadSession();
  } else {
    scrollIfFollowing(true, true);
    composer.querySelector('input').focus({ preventScroll: true });
  }
}

function createWindow() {
  ensureStyles();
  launcher = document.getElementById('serenityChatLauncher');
  const root = el('div', 'serenity-chat-widget');
  root.id = 'serenityChatWidget';
  panel = el('section', 'serenity-chat-panel');
  panel.id = 'serenityChatPanel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Trợ lý Serenity Spa');
  panel.setAttribute('aria-modal', 'false');

  const header = el('header', 'serenity-chat-header');
  const avatar = el('span', 'serenity-chat-avatar', '✿');
  avatar.setAttribute('aria-hidden', 'true');
  const identity = el('div', 'serenity-chat-identity');
  identity.append(el('strong', '', 'Serenity Spa AI'));
  const subline = el('span', 'serenity-chat-subline');
  const live = el('span', 'serenity-chat-live-dot');
  live.setAttribute('aria-hidden', 'true');
  headerStatus = el('span', 'serenity-chat-status', 'Trợ lý tư vấn 24/7');
  subline.append(live, headerStatus);
  identity.append(subline);
  const controls = el('div', 'serenity-chat-header-controls');
  const minimizeButton = el('button', 'serenity-chat-header-button', '—');
  minimizeButton.type = 'button';
  minimizeButton.dataset.action = 'minimize';
  minimizeButton.setAttribute('aria-label', 'Thu nhỏ trợ lý');
  const closeButton = el('button', 'serenity-chat-header-button serenity-chat-close', '×');
  closeButton.type = 'button';
  closeButton.dataset.action = 'close';
  closeButton.setAttribute('aria-label', 'Đóng trợ lý');
  controls.append(minimizeButton, closeButton);
  header.append(avatar, identity, controls);

  messageList = el('div', 'serenity-chat-messages');
  messageList.id = 'serenityChatMessages';
  messageList.setAttribute('aria-live', 'polite');
  messageList.setAttribute('aria-relevant', 'additions text');
  statusLine = el('div', 'serenity-chat-typing');
  statusLine.hidden = true;

  const footer = el('footer', 'serenity-chat-footer');
  const tools = el('div', 'serenity-chat-footer-tools');
  const menuButton = el('button', 'serenity-chat-footer-link', 'Menu chính');
  menuButton.type = 'button';
  menuButton.dataset.action = 'menu';
  const newButton = el('button', 'serenity-chat-footer-link', 'Cuộc trò chuyện mới');
  newButton.type = 'button';
  newButton.dataset.action = 'newConversation';
  tools.append(menuButton, newButton);
  composer = el('form', 'serenity-chat-composer');
  const input = el('input', 'serenity-chat-input');
  input.type = 'text';
  input.name = 'message';
  input.maxLength = MAX_LENGTH;
  input.autocomplete = 'off';
  input.placeholder = 'Nhập câu hỏi của bạn…';
  input.setAttribute('aria-label', 'Nhập câu hỏi của bạn');
  input.required = true;
  input.addEventListener('input', () => input.setCustomValidity(''));
  sendButton = el('button', 'serenity-chat-send', '➤');
  sendButton.type = 'submit';
  sendButton.setAttribute('aria-label', 'Gửi tin nhắn');
  composer.append(input, sendButton);
  footer.append(tools, composer);

  panel.append(header, messageList, statusLine, footer);
  root.append(panel);
  document.body.append(root);

  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });
  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !root.contains(target)) return;
    const action = target.dataset.action;
    if (action === 'close') closePanel();
    else if (action === 'minimize') minimize();
    else if (action === 'menu') sendMessage('Bắt đầu lại');
    else if (action === 'newConversation') resetConversation();
    else if (action === 'quickReply') sendMessage(target.dataset.value);
    else if (action === 'checkAvailability') sendMessage(`Kiểm tra lịch trống cho ${target.dataset.serviceName}`, {
      serviceId: target.dataset.serviceId, serviceDuration: Number(target.dataset.serviceDuration),
    });
    else if (action === 'selectService') sendMessage(`Mình chọn dịch vụ ${target.dataset.serviceName}.`, {
      serviceId: target.dataset.serviceId, serviceDuration: Number(target.dataset.serviceDuration),
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) closePanel();
  });
}

export async function toggleChatbot() {
  if (!panel) createWindow();
  if (panel.hidden || panel.classList.contains('is-minimized')) await openPanel();
  else closePanel();
}
