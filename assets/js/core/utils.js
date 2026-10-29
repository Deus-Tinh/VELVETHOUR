/**
 * Tiện ích dùng chung: định danh, thời gian (múi giờ Asia/Ho_Chi_Minh), định dạng, chuẩn hóa tiếng Việt, escape HTML.
 */

/* ---------- Đồng hồ có thể thay thế (phục vụ test) ---------- */
let nowFn = () => new Date();
export const clock = {
  now: () => nowFn(),
  set(fn) { nowFn = fn; },
  reset() { nowFn = () => new Date(); },
};

export const BUSINESS_TZ = 'Asia/Ho_Chi_Minh';

/** Ngày + số phút trong ngày theo giờ Việt Nam, không phụ thuộc múi giờ máy. */
export function businessNow(d = clock.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, minutes: Number(g('hour')) * 60 + Number(g('minute')) };
}

export const todayStr = () => businessNow().date;

/* ---------- Ngày / giờ dạng chuỗi ---------- */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDateStr(ds) {
  if (typeof ds !== 'string' || !DATE_RE.test(ds)) return false;
  const [y, m, d] = ds.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
export const isValidTimeStr = (t) => typeof t === 'string' && TIME_RE.test(t);

export function addDays(ds, n) {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** 0 = Chủ nhật … 6 = Thứ bảy */
export function weekday(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export const timeToMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const minToTime = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** Giờ kết thúc khóa chuyên viên, làm tròn lên theo bước đặt lịch. */
export function bookingLockEndMinute(startMinute, durationMinutes, slotStep) {
  if (![startMinute, durationMinutes, slotStep].every(Number.isInteger) || durationMinutes <= 0 || slotStep <= 0) {
    throw new RangeError('Thời gian khóa chuyên viên không hợp lệ.');
  }
  return startMinute + Math.ceil(durationMinutes / slotStep) * slotStep;
}

const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export const weekdayLabel = (ds) => WD[weekday(ds)];
export function formatDate(ds) {
  if (!isValidDateStr(ds)) return '—';
  const [y, m, d] = ds.split('-');
  return `${d}/${m}/${y}`;
}
export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: BUSINESS_TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}
export const formatVND = (n) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(n) || 0);

/* ---------- Định danh ---------- */
export function uid(prefix = 'id') {
  const raw = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replace(/-/g, '')
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  return `${prefix}_${raw.slice(0, 12)}`;
}
/** Mã đặt lịch dễ đọc: SER-YYMMDD-XXXX (đảm bảo không trùng với danh sách codes đã có). */
export function bookingCode(existing = []) {
  const set = new Set(existing);
  const stamp = todayStr().slice(2).replace(/-/g, '');
  let code;
  do { code = `SER-${stamp}-${Math.floor(1000 + Math.random() * 9000)}`; } while (set.has(code));
  return code;
}

/* ---------- Văn bản ---------- */
/** Bỏ dấu tiếng Việt + hạ chữ thường để tìm kiếm không phân biệt hoa/thường/dấu. */
export function normalizeText(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape mọi dữ liệu động trước khi đưa vào innerHTML. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const clone = (obj) => (typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function sum(list, pick = (x) => x) {
  return list.reduce((acc, item) => acc + (Number(pick(item)) || 0), 0);
}
