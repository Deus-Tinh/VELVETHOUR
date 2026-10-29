const CHAT_API = '/api/chat';

async function request(path, options = {}) {
  const response = await fetch(`${CHAT_API}${path}`, {
    credentials: 'include',
    signal: options.signal || AbortSignal.timeout(15000),
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'Không thể kết nối trợ lý Serenity.');
    error.code = result.code || 'CHAT_API_ERROR';
    error.status = response.status;
    throw error;
  }
  return result;
}

export const chatbotService = {
  loadSession(signal) { return request('/session', { signal }); },
  sendMessage(conversationId, message, signal, { serviceId = null, serviceDuration = null } = {}) {
    return request('/messages', { method: 'POST', body: JSON.stringify({
      conversationId, message, ...(serviceId ? { serviceId } : {}),
      ...(Number.isInteger(serviceDuration) ? { serviceDuration } : {}),
    }), signal });
  },
  startNewConversation(signal) { return request('/reset', { method: 'POST', body: '{}', signal }); },
};
