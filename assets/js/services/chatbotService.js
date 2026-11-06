const CHAT_API = '/api/chat';

async function request(path, options = {}) {
  const response = await fetch(`${CHAT_API}${path}`, {
    credentials: 'include',
    signal: options.signal || AbortSignal.timeout(25000),
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

/** Automatically retry once on transient network errors or 5xx during session load. */
async function requestWithRetry(path, options = {}) {
  try {
    return await request(path, options);
  } catch (err) {
    const isRetryable = !err.status || err.status === 502 || err.status === 503 || err.status === 504;
    if (isRetryable) {
      return request(path, options);
    }
    throw err;
  }
}

export const chatbotService = {
  loadSession(signal) { return requestWithRetry('/session', { signal }); },
  sendMessage(conversationId, message, signal, { serviceId = null, serviceDuration = null } = {}) {
    return request('/messages', { method: 'POST', body: JSON.stringify({
      conversationId, message, ...(serviceId ? { serviceId } : {}),
      ...(Number.isInteger(serviceDuration) ? { serviceDuration } : {}),
    }), signal });
  },
  startNewConversation(signal) { return request('/reset', { method: 'POST', body: '{}', signal }); },
};
