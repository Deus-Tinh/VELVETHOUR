/**
 * Kết nối máy chủ Serenity. Khi không có backend, ứng dụng giữ chế độ demo localStorage.
 * Chạy `npm start` để dùng SQLite dùng chung và phiên đăng nhập HttpOnly.
 */
import { emit, on } from '../core/events.js';
import { readJSON, writeJSON, removeKey } from '../core/storage.js';
import { setState } from '../core/store.js';
import { repos } from '../data/repositories.js';
import { todayStr } from '../core/utils.js';

const ADMIN_COLLECTIONS = new Set(['categories', 'services', 'staff', 'promotions', 'settings']);
let online = false;
let initialized = false;
let versions = {};
let occupiedSlots = [];
let currentRole = null;
let holidaySales = [];
let siteContent = { pages: [], menuItems: [] };
let pricingDate = todayStr();
let refreshTimer = null;
const SYNC_STATE_KEY = '__shared_sync_state';
const syncState = readJSON(SYNC_STATE_KEY, { dirty: [], baselines: {} });
const dirtyCollections = new Set(Array.isArray(syncState.dirty) ? syncState.dirty : []);
const syncTasks = new Map();
const syncErrors = new Map();
let serverBaselines = {};

function sameRecords(a, b) {
  const sort = (rows) => JSON.stringify([...(rows || [])].sort((left, right) => String(left.id).localeCompare(String(right.id))));
  return sort(a) === sort(b);
}

function mergeRecords(baseRows, localRows, remoteRows) {
  const base = new Map((baseRows || []).map((row) => [row.id, row]));
  const local = new Map((localRows || []).map((row) => [row.id, row]));
  const remote = new Map((remoteRows || []).map((row) => [row.id, row]));
  const ids = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
  const merged = [];
  for (const id of ids) {
    const before = base.get(id);
    const localRecord = local.get(id);
    const remoteRecord = remote.get(id);
    if (JSON.stringify(localRecord) !== JSON.stringify(before)) {
      if (localRecord) merged.push(localRecord);
    } else if (remoteRecord) merged.push(remoteRecord);
  }
  return merged;
}

/** Nhận lại hồ sơ chuyên viên còn trong LocalStorage cũ khi lần đầu nối máy chủ chung. */
export function recoverLocalStaff(remoteRows, localRows) {
  const recovered = [...(remoteRows || [])];
  for (const local of localRows || []) {
    const index = recovered.findIndex((remote) => remote.id === local.id);
    if (index < 0) {
      // ID do form tạo có dạng st_<uuid>; không đưa các bản ghi seed cũ bị xóa trở lại.
      if (/^st_[a-z0-9]+$/i.test(local.id || '')) recovered.push(local);
      continue;
    }
    const remote = recovered[index];
    const localUpdated = Date.parse(local.updatedAt || '');
    const remoteUpdated = Date.parse(remote.updatedAt || '');
    if (Number.isFinite(localUpdated) && (!Number.isFinite(remoteUpdated) || localUpdated > remoteUpdated)) {
      recovered[index] = local;
    }
  }
  return recovered;
}

function persistSyncState() {
  try {
    writeJSON(SYNC_STATE_KEY, { dirty: [...dirtyCollections], baselines: syncState.baselines || {} });
  } catch (error) {
    console.warn('[shared-data] Không thể ghi trạng thái đồng bộ vào bộ nhớ trình duyệt:', error.message);
  }
}

function markCollectionDirty(collection) {
  if (!dirtyCollections.has(collection)) {
    syncState.baselines ||= {};
    syncState.baselines[collection] = Object.hasOwn(serverBaselines, collection) ? serverBaselines[collection] : null;
    dirtyCollections.add(collection);
    persistSyncState();
  }
  syncErrors.delete(collection);
}

function clearCollectionDirty(collection, syncedRows) {
  serverBaselines[collection] = syncedRows;
  dirtyCollections.delete(collection);
  delete syncState.baselines?.[collection];
  syncErrors.delete(collection);
  persistSyncState();
}

function apiBase() {
  if (typeof window === 'undefined') return '';
  // Giao diện và API cùng chạy trên cổng chính 3001.
  return `${window.location.origin}/api`;
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'Không thể kết nối máy chủ Serenity.');
    error.status = response.status;
    error.code = result.code || 'API_ERROR';
    error.fields = result.fields || {};
    throw error;
  }
  return result;
}

function hydrate(snapshot) {
  const collections = snapshot.collections || {};
  const changedCollections = [];
  if (pricingDate !== todayStr()) { pricingDate = todayStr(); changedCollections.push('pricingDate'); }
  const nextSales = Array.isArray(snapshot.holidaySales) ? snapshot.holidaySales : [];
  if (JSON.stringify(nextSales) !== JSON.stringify(holidaySales)) changedCollections.push('holidaySales');
  holidaySales = nextSales;
  const nextSiteContent = snapshot.siteContent && typeof snapshot.siteContent === 'object'
    ? { pages: Array.isArray(snapshot.siteContent.pages) ? snapshot.siteContent.pages : [],
      menuItems: Array.isArray(snapshot.siteContent.menuItems) ? snapshot.siteContent.menuItems : [] }
    : { pages: [], menuItems: [] };
  if (JSON.stringify(nextSiteContent) !== JSON.stringify(siteContent)) changedCollections.push('siteContent');
  siteContent = nextSiteContent;
  for (const [name, repo] of Object.entries(repos)) {
    const rows = Array.isArray(collections[name]) ? collections[name] : [];
    const currentRows = repo.getAll();
    serverBaselines[name] = rows;
    let nextRows = rows;
    if (dirtyCollections.has(name)) {
      const baseline = syncState.baselines?.[name];
      nextRows = name === 'staff' && !Array.isArray(baseline)
        ? recoverLocalStaff(rows, currentRows)
        : mergeRecords(baseline || [], currentRows, rows);
      if (name === 'staff') {
        syncState.baselines.staff = rows;
        syncState.staffRecoveryDone = true;
        persistSyncState();
      }
      if (sameRecords(nextRows, rows)) clearCollectionDirty(name, rows);
    } else if (name === 'staff' && !syncState.staffRecoveryDone) {
      nextRows = recoverLocalStaff(rows, currentRows);
      syncState.staffRecoveryDone = true;
      if (!sameRecords(nextRows, rows)) {
        syncState.baselines ||= {};
        syncState.baselines.staff = rows;
        dirtyCollections.add('staff');
      }
      persistSyncState();
    }
    if (JSON.stringify(currentRows) !== JSON.stringify(nextRows)) changedCollections.push(name);
    // Không phát sự kiện ghi dữ liệu ở đây: đây là bản sao cache của dữ liệu máy chủ.
    writeJSON(name, nextRows);
  }
  if (snapshot.currentUser) writeJSON('session', { userId: snapshot.currentUser.id, loggedInAt: new Date().toISOString() });
  else removeKey('session');
  versions = { ...(snapshot.versions || {}) };
  occupiedSlots = Array.isArray(snapshot.occupiedSlots) ? snapshot.occupiedSlots : [];
  currentRole = snapshot.currentUser?.role || null;
  setState({ currentUser: snapshot.currentUser || null });
  if (initialized) changedCollections.forEach((collection) => emit('data:changed', { collection, source: 'remote' }));
}

function rememberBooking(booking) {
  if (!booking?.id) return;
  occupiedSlots = occupiedSlots.filter((item) => item.id !== booking.id);
  if (['Pending', 'Confirmed', 'CheckedIn'].includes(booking.status)) {
    occupiedSlots.push({ id: booking.id, staffId: booking.staffId, roomNumber: booking.roomNumber, date: booking.date, startTime: booking.startTime, endTime: booking.endTime, status: booking.status });
  }
}

async function refresh() {
  if (!online) return null;
  const snapshot = await request('/bootstrap');
  hydrate(snapshot);
  return snapshot;
}

async function saveCollection(collection, retryConflict = true) {
  const submittedRows = repos[collection].getAll();
  try {
    const result = await request(`/admin/collections/${encodeURIComponent(collection)}`, {
      method: 'PUT',
      headers: { 'If-Match': String(versions[collection] ?? 0) },
      body: JSON.stringify({ records: submittedRows }),
    });
    versions[collection] = result.version;
    const currentRows = repos[collection].getAll();
    if (sameRecords(currentRows, submittedRows)) clearCollectionDirty(collection, submittedRows);
    else {
      syncState.baselines ||= {};
      syncState.baselines[collection] = submittedRows;
      persistSyncState();
    }
    emit('data:sync-success', { collection });
  } catch (error) {
    if (error.status === 409 && retryConflict) {
      // Gộp thay đổi theo ID rồi thử lại với version mới; giữ các bản ghi mới ở máy chủ.
      const snapshot = await request('/bootstrap');
      hydrate(snapshot);
      return saveCollection(collection, false);
    }
    throw error;
  }
}

function queueCollectionSync(collection) {
  const previous = syncTasks.get(collection) || Promise.resolve();
  const task = previous.catch(() => {}).then(() => saveCollection(collection));
  syncTasks.set(collection, task);
  task.then(() => {
    if (syncTasks.get(collection) === task) syncTasks.delete(collection);
  }, (error) => {
    syncErrors.set(collection, error);
    console.error(`[shared-data] Không đồng bộ được ${collection}:`, error.message);
    emit('data:sync-error', { collection, message: error.message });
    if (syncTasks.get(collection) === task) syncTasks.delete(collection);
  });
  return task;
}

function syncPendingCollections() {
  if (!online || currentRole !== 'admin') return;
  for (const collection of dirtyCollections) queueCollectionSync(collection);
}

function installSync() {
  if (!initialized) {
    initialized = true;
    on('auth:login', (user) => {
      currentRole = user?.role || null;
      syncPendingCollections();
    });
    on('auth:logout', () => { currentRole = null; });
    on('data:changed', ({ collection, source }) => {
      if (source === 'remote' || currentRole !== 'admin' || !ADMIN_COLLECTIONS.has(collection)) return;
      markCollectionDirty(collection);
      if (online) queueCollectionSync(collection);
    });
  }
  if (online && typeof document !== 'undefined' && !refreshTimer) {
    refreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh().catch((error) => console.warn('[shared-data] Làm mới dữ liệu thất bại:', error.message));
    }, 30000);
  }
}

export const apiClient = {
  getHolidaySales: () => structuredClone(holidaySales),
  getSiteContent: () => structuredClone(siteContent),
  getSitePage(slug) { return request(`/site-pages/${encodeURIComponent(slug)}`); },
  listSiteContent() { return request('/admin/site-content'); },
  createPromotionPage(page, requestId) { return request('/admin/site-pages/promotion', { method: 'POST', body: JSON.stringify({ page, requestId }) }); },
  updatePromotionPage(id, patch, expectedRevision, requestId) {
    return request(`/admin/site-pages/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ patch, expectedRevision, requestId }) });
  },
  createMenuLink(menuItem, requestId) { return request('/admin/site-menu', { method: 'POST', body: JSON.stringify({ menuItem, requestId }) }); },
  updateMenuLink(id, patch, expectedRevision, requestId) {
    return request(`/admin/site-menu/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ patch, expectedRevision, requestId }) });
  },
  quotePrice(details) { return request('/pricing/quote', { method: 'POST', body: JSON.stringify(details) }); },
  listHolidaySales() { return request('/admin/holiday-sales'); },
  saveHolidaySale(sale, requestId) { return request('/admin/holiday-sales', { method: 'POST', body: JSON.stringify({ sale, requestId }) }); },
  updateHolidaySale(id, patch, expectedRevision, requestId) {
    return request(`/admin/holiday-sales/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ patch, expectedRevision, requestId }) });
  },
  isOnline: () => online,
  setLocalRole(role) { if (!online) currentRole = role || null; },
  getOccupiedSlots: () => occupiedSlots.slice(),
  request,
  async listServices(filters = {}) {
    const params = new URLSearchParams();
    for (const key of ['q', 'kind', 'category', 'therapyGroup', 'minPrice', 'maxPrice', 'duration', 'sort', 'page', 'pageSize', 'serviceDate']) {
      const value = filters[key];
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const query = params.toString();
    return request(`/services${query ? `?${query}` : ''}`);
  },
  async uploadPackageImage(imageBlob) {
    if (!(imageBlob instanceof Blob) || !['image/webp', 'image/jpeg', 'image/png'].includes(imageBlob.type)) {
      throw new Error('Ảnh tải lên chưa đúng định dạng. Hãy chọn JPG, PNG hoặc WebP.');
    }
    return request('/admin/package-images', {
      method: 'POST',
      headers: { 'Content-Type': imageBlob.type },
      body: imageBlob,
    });
  },
  async uploadTherapyImage(imageBlob) {
    if (!(imageBlob instanceof Blob) || !['image/webp', 'image/jpeg', 'image/png'].includes(imageBlob.type)) {
      throw new Error('Ảnh tải lên chưa đúng định dạng. Hãy chọn JPG, PNG hoặc WebP.');
    }
    return request('/admin/therapy-images', {
      method: 'POST',
      headers: { 'Content-Type': imageBlob.type },
      body: imageBlob,
    });
  },
  async initialize() {
    if (typeof window === 'undefined') return false;
    installSync();
    try {
      const health = await request('/health');
      if (!health.ok) return false;
      online = true;
      installSync();
      await refresh();
      syncPendingCollections();
      return true;
    } catch {
      online = false;
      return false;
    }
  },
  async refresh() { return refresh(); },
  async waitForCollectionSync(collection) {
    if (!online) throw new Error('Chưa kết nối được máy chủ ở cổng 3001. Hồ sơ chưa được lưu; hãy chạy lại hệ thống rồi thử lại.');
    if (currentRole !== 'admin') throw new Error('Phiên đăng nhập quản trị đã hết hạn. Hãy đăng nhập lại rồi lưu lần nữa.');
    let task = syncTasks.get(collection);
    if (!task && dirtyCollections.has(collection)) task = queueCollectionSync(collection);
    if (task) {
      try { await task; }
      catch (error) { error.localSaved = dirtyCollections.has(collection); throw error; }
    }
    const error = syncErrors.get(collection);
    if (error) {
      error.localSaved = true;
      throw error;
    }
    return { synced: !dirtyCollections.has(collection), localOnly: false };
  },
  async login(credentials) { const result = await request('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }); currentRole = result.user?.role || null; return result; },
  async register(profile) { const result = await request('/auth/register', { method: 'POST', body: JSON.stringify(profile) }); currentRole = result.user?.role || null; return result; },
  async getStaffInvite(token) { return request(`/auth/staff-invite?token=${encodeURIComponent(token)}`); },
  async acceptStaffInvite(invitation) { const result = await request('/auth/staff-invite/accept', { method: 'POST', body: JSON.stringify(invitation) }); currentRole = result.user?.role || null; return result; },
  async listStaffInvites() { return request('/admin/staff-invites'); },
  async createStaffInvite(invitation) { return request('/admin/staff-invites', { method: 'POST', body: JSON.stringify(invitation) }); },
  async logout() { try { return await request('/auth/logout', { method: 'POST', body: '{}' }); } finally { currentRole = null; } },
  async updateProfile(profile) { return request('/auth/profile', { method: 'PATCH', body: JSON.stringify(profile) }); },
  async changePassword(credentials) { return request('/auth/change-password', { method: 'POST', body: JSON.stringify(credentials) }); },
  async createBooking(payload) { const result = await request('/bookings', { method: 'POST', body: JSON.stringify(payload) }); rememberBooking(result.booking); return result; },
  async getPaymentConfig() { return request('/payment/config'); },
  async getBookingPayment(id) { return request(`/bookings/${encodeURIComponent(id)}/payment`); },
  async getBookingInvoice(id) { return request(`/bookings/${encodeURIComponent(id)}/invoice`); },
  async getPaymentReconciliation() { return request('/admin/payments/reconciliation'); },
  async linkUnmatchedPayment({ providerTransactionId, bookingId }) {
    const result = await request('/admin/payments/reconcile-unmatched', {
      method: 'POST', body: JSON.stringify({ providerTransactionId, bookingId }),
    });
    rememberBooking(result.booking);
    return result;
  },
  async createPaymentIssueRefund({ providerTransactionId, amount, recipient, note = '' }) {
    const result = await request('/admin/payments/issue-refund', {
      method: 'POST', body: JSON.stringify({ providerTransactionId, amount, recipient, note }),
    });
    rememberBooking(result.booking);
    return result;
  },
  async completeRefund(id, { referenceCode, note = '' }) {
    const result = await request(`/admin/bookings/${encodeURIComponent(id)}/refund-complete`, {
      method: 'POST', body: JSON.stringify({ referenceCode, note }),
    });
    rememberBooking(result.booking);
    return result;
  },
  async updateBookingStatus(id, status, reason = '') {
    const result = await request(`/bookings/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }); rememberBooking(result.booking); return result;
  },
  async recordBookingPayment(id, payment) {
    const result = await request(`/admin/bookings/${encodeURIComponent(id)}/payments`, { method: 'POST', body: JSON.stringify(payment) });
    return result;
  },
  async cancelBooking(id, phone = '', refundRecipient = null) {
    const result = await request(`/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ phone, refundRecipient }) }); rememberBooking(result.booking); return result;
  },
  async rescheduleBooking(id, details) {
    const result = await request(`/bookings/${encodeURIComponent(id)}/reschedule`, { method: 'PATCH', body: JSON.stringify(details) }); rememberBooking(result.booking); return result;
  },
  quoteReschedule(id, details) {
    return request(`/bookings/${encodeURIComponent(id)}/reschedule/quote`, { method: 'POST', body: JSON.stringify(details) });
  },
  async confirmReschedule(id, quoteId, phone = '', refundRecipient = null) {
    const result = await request(`/bookings/${encodeURIComponent(id)}/reschedule/confirm`, { method: 'POST', body: JSON.stringify({ quoteId, phone, refundRecipient }) });
    rememberBooking(result.booking);
    return result;
  },
  async bookingsByPhone(phone) {
    return request(`/bookings?phone=${encodeURIComponent(phone)}`);
  },
  async createContact(contact) { return request('/contacts', { method: 'POST', body: JSON.stringify(contact) }); },
  async updateContactStatus(id, status) { return request(`/admin/contacts/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); },
  async toggleFavorite(serviceId) { return request('/favorites/toggle', { method: 'POST', body: JSON.stringify({ serviceId }) }); },
  async createReview(review) { return request('/reviews', { method: 'POST', body: JSON.stringify(review) }); },
  async createBackup() { return request('/admin/backup', { method: 'POST', body: '{}' }); },
  async downloadBackup() {
    const response = await fetch(`${apiBase()}/admin/backup`, { credentials: 'include' });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Không thể tạo bản sao lưu.');
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'serenity-backup.sqlite';
    link.click();
    URL.revokeObjectURL(objectUrl);
    return link.download;
  },
};
