async function request(path, options = {}) {
  const response = await fetch(`/api/admin/agent${path}`, {
    credentials: 'include',
    ...options,
    signal: options.signal || AbortSignal.timeout(100000),
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'Không thể kết nối agent quản lý spa.');
    error.code = result.code || 'ADMIN_AGENT_ERROR';
    error.status = response.status;
    throw error;
  }
  return result;
}

export const adminAgentService = {
  listConversations() { return request('/conversations'); },
  createConversation() { return request('/conversations', { method: 'POST', body: '{}' }); },
  getConversation(id, before = null) {
    return request(`/conversations/${encodeURIComponent(id)}${before === null ? '' : `?before=${encodeURIComponent(before)}`}`);
  },
  deleteConversation(id) { return request(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  clearHistory() { return request('/conversations', { method: 'DELETE' }); },
  sendMessage(conversationId, message, signal, requestId = globalThis.crypto.randomUUID()) {
    return request('/messages', { method: 'POST', body: JSON.stringify({ conversationId, message, requestId }), signal });
  },
};
