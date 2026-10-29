/**
 * Data Access Layer — LocalStorage (có thể thay backend để test bằng bộ nhớ).
 * Mọi collection đi qua createRepository(): getAll/getById/create/update/remove/findBy.
 * - Xử lý JSON hỏng (corrupt) → tự khôi phục về [] và báo qua bus.
 * - Xử lý đầy dung lượng (QuotaExceededError) → ném AppError có thông điệp rõ ràng.
 * - Mọi lần ghi phát sự kiện 'data:changed' để UI đồng bộ.
 */
import { AppError } from './errors.js';
import { emit } from './events.js';
import { uid, clone } from './utils.js';

export const NS = 'serenity:v2:';

/** Backend mặc định = localStorage; fallback bộ nhớ nếu trình duyệt chặn storage. */
function memoryBackend() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    keys: () => [...m.keys()],
  };
}
function browserBackend() {
  const ls = globalThis.localStorage;
  if (!ls || typeof ls.getItem !== 'function' || typeof ls.setItem !== 'function' || typeof ls.removeItem !== 'function') {
    return memoryBackend();
  }
  try {
    const probe = '__probe__';
    ls.setItem(probe, '1'); ls.removeItem(probe);
    return {
      getItem: (k) => ls.getItem(k),
      setItem: (k, v) => ls.setItem(k, v),
      removeItem: (k) => ls.removeItem(k),
      keys: () => Object.keys(ls),
    };
  } catch (e) {
    console.warn(`[storage] localStorage không khả dụng, dùng bộ nhớ tạm (${e?.name || 'StorageError'}).`);
    return memoryBackend();
  }
}

let backend = browserBackend();
export const storage = {
  useMemory() { backend = memoryBackend(); },
  useBrowser() { backend = browserBackend(); },
  setBackend(b) { backend = b; },
  raw: () => backend,
};

/** Đọc JSON an toàn: trả fallback nếu thiếu/hỏng. */
export function readJSON(key, fallback) {
  const raw = backend.getItem(NS + key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[storage] JSON hỏng tại "${key}", key đã được xóa và dùng giá trị mặc định (${err?.name || 'ParseError'}).`);
    backend.removeItem(NS + key);
    emit('storage:corrupt', { key });
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    backend.setItem(NS + key, JSON.stringify(value));
  } catch (err) {
    const quota = err && (err.name === 'QuotaExceededError' || err.code === 22);
    throw new AppError(quota ? 'STORAGE_QUOTA' : 'STORAGE_ERROR',
      quota ? 'Bộ nhớ trình duyệt đã đầy. Hãy xóa bớt dữ liệu demo.' : 'Không thể lưu dữ liệu vào trình duyệt.');
  }
}

export function removeKey(key) { backend.removeItem(NS + key); }
export function hasKey(key) { return backend.getItem(NS + key) != null; }
export function clearAll() {
  backend.keys().filter((k) => k.startsWith(NS)).forEach((k) => backend.removeItem(k));
}

/**
 * @param {string} name tên collection
 * @param {{ idPrefix?: string, validate?: (record:any)=>boolean }} opts
 *   validate: kiểm tra schema tối thiểu — bản ghi sai schema bị loại khi đọc.
 */
export function createRepository(name, { idPrefix = name.slice(0, 3), validate = () => true } = {}) {
  const read = () => {
    const data = readJSON(name, []);
    if (!Array.isArray(data)) { console.warn(`[storage] "${name}" không phải mảng; dùng danh sách rỗng.`); return []; }
    return data.filter((r) => r && typeof r === 'object' && validate(r));
  };
  const write = (list) => { writeJSON(name, list); emit('data:changed', { collection: name }); };

  return {
    name,
    /** Trả bản sao để caller không mutate trực tiếp dữ liệu nguồn. */
    getAll: () => clone(read()),
    getById(id) {
      if (id == null || id === '') return null;
      const found = read().find((r) => r.id === id);
      return found ? clone(found) : null;
    },
    findBy: (predicate) => clone(read().filter(predicate)),
    count: () => read().length,
    create(data) {
      const list = read();
      let id = data.id;
      if (!id) { do { id = uid(idPrefix); } while (list.some((r) => r.id === id)); }
      else if (list.some((r) => r.id === id)) throw new AppError('DUPLICATE_ID', `ID "${id}" đã tồn tại.`);
      const now = new Date().toISOString();
      const record = { ...clone(data), id, createdAt: data.createdAt || now, updatedAt: now };
      write([...list, record]);
      return clone(record);
    },
    update(id, updates) {
      const list = read();
      const idx = list.findIndex((r) => r.id === id);
      if (idx === -1) throw new AppError('NOT_FOUND', 'Không tìm thấy bản ghi cần cập nhật.');
      const { id: _ignore, createdAt: _c, ...safe } = updates || {};
      const record = { ...list[idx], ...clone(safe), updatedAt: new Date().toISOString() };
      const next = list.slice(); next[idx] = record;
      write(next);
      return clone(record);
    },
    remove(id) {
      const list = read();
      if (!list.some((r) => r.id === id)) throw new AppError('NOT_FOUND', 'Không tìm thấy bản ghi cần xóa.');
      write(list.filter((r) => r.id !== id));
      return true;
    },
    /** Ghi đè toàn bộ — chỉ dùng khi seed / reset. */
    replaceAll(list) { write(clone(list)); },
  };
}
