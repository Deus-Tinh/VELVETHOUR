/**
 * Định dạng chuyển hồ sơ chuyên viên (staff roster) giữa các site — CHỈ dữ liệu nhân viên.
 * Không chứa tài khoản, mật khẩu, lời mời hay lịch hẹn.
 *
 * Module thuần (không đọc repository, không ghi dữ liệu) để dễ kiểm tra:
 * - buildStaffRosterExport(): tạo payload JSON có phiên bản.
 * - parseStaffRosterFile(): đọc + kiểm tra nghiêm ngặt từng dòng.
 * - planStaffRosterImport(): so khớp theo ID với danh sách hiện có (không bao giờ xóa).
 * - applyStaffRosterPlan(): trả về danh sách đã gộp để ghi một lần.
 */
import { isValidDateStr, isValidTimeStr, timeToMin } from '../core/utils.js';

export const STAFF_ROSTER_FORMAT = 'velvethour.staff-roster';
export const STAFF_ROSTER_VERSION = 1;
/** Khớp giới hạn body 8 MB của PUT /api/admin/collections/staff, chừa biên an toàn. */
export const STAFF_ROSTER_MAX_FILE_BYTES = 6 * 1024 * 1024;
export const STAFF_ROSTER_MAX_COLLECTION_BYTES = 7.5 * 1024 * 1024;
export const STAFF_ROSTER_MAX_RECORDS = 200;
/** Máy chủ từ chối hơn 1000 bản ghi mỗi collection. */
export const STAFF_COLLECTION_MAX_RECORDS = 1000;
const MAX_IMAGE_DATA_URL_CHARS = 600 * 1024;
const MAX_URL_CHARS = 2048;

/** Các trường nhân viên được phép chuyển; mọi trường khác bị từ chối để tránh lẫn dữ liệu tài khoản. */
export const STAFF_ROSTER_FIELDS = Object.freeze([
  'id', 'name', 'title', 'imageId', 'imageUrl', 'specialties', 'workingDays',
  'shiftStart', 'shiftEnd', 'daysOff', 'breaks', 'breakStart', 'breakEnd',
  'active', 'createdAt', 'updatedAt',
]);
const FIELD_SET = new Set(STAFF_ROSTER_FIELDS);
/** Trường so sánh khi quyết định "thay đổi" hay "giống hệt" (bỏ qua mốc thời gian). */
const COMPARE_FIELDS = STAFF_ROSTER_FIELDS.filter((field) => !['createdAt', 'updatedAt'].includes(field));

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const IMAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export class StaffRosterError extends Error {
  constructor(message, code = 'ROSTER_INVALID') {
    super(message);
    this.name = 'StaffRosterError';
    this.code = code;
  }
}

/** Chỉ giữ các trường nhân viên trong whitelist (dùng khi xuất). */
export function pickStaffRosterFields(staff) {
  const out = {};
  for (const field of STAFF_ROSTER_FIELDS) {
    if (staff[field] === undefined) continue;
    if (['imageUrl', 'breaks', 'breakStart', 'breakEnd'].includes(field)
        && (staff[field] === null || staff[field] === '')) continue;
    out[field] = structuredClone(staff[field]);
  }
  return out;
}

export function buildStaffRosterExport(staffList, { source = '', exportedAt = new Date().toISOString() } = {}) {
  const staff = (staffList || []).map(pickStaffRosterFields);
  if (staff.length > STAFF_ROSTER_MAX_RECORDS) {
    throw new StaffRosterError(`Tối đa ${STAFF_ROSTER_MAX_RECORDS} chuyên viên mỗi lần xuất.`, 'ROSTER_TOO_LARGE');
  }
  const payload = {
    format: STAFF_ROSTER_FORMAT,
    version: STAFF_ROSTER_VERSION,
    kind: 'staff-only',
    exportedAt,
    source: String(source || ''),
    count: staff.length,
    staff,
  };
  if (byteLength(JSON.stringify(payload)) > STAFF_ROSTER_MAX_FILE_BYTES) {
    throw new StaffRosterError('Tệp xuất vượt quá 6 MB. Hãy giảm kích thước ảnh hồ sơ rồi thử lại.', 'ROSTER_TOO_LARGE');
  }
  return payload;
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function classifyImageUrl(value) {
  if (typeof value !== 'string' || !value) return { ok: false };
  if (value.startsWith('data:')) {
    return { ok: value.length <= MAX_IMAGE_DATA_URL_CHARS && DATA_IMAGE_RE.test(value), kind: 'embedded' };
  }
  if (value.length > MAX_URL_CHARS || /[\s"'<>]/.test(value)) return { ok: false };
  if (/^https:\/\/[^/]/i.test(value)) return { ok: true, kind: 'absolute' };
  if (value.startsWith('/') && !value.startsWith('//')) return { ok: true, kind: 'relative' };
  return { ok: false };
}

/**
 * Kiểm tra một dòng nhân viên. Trả về { record, errors, warnings }.
 * `categoryIds` là danh mục của site đích — chuyên môn phải tham chiếu danh mục có thật.
 */
export function validateStaffRosterRow(row, categoryIds) {
  const errors = [];
  const warnings = [];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { record: null, errors: ['Dòng không phải đối tượng JSON.'], warnings };

  const unknown = Object.keys(row).filter((key) => !FIELD_SET.has(key));
  if (unknown.length) errors.push(`Trường không được phép: ${unknown.join(', ')}.`);

  if (typeof row.id !== 'string' || !ID_RE.test(row.id)) errors.push('ID không hợp lệ (chỉ chữ, số, "-", "_"; tối đa 80 ký tự).');

  const name = typeof row.name === 'string' ? row.name.trim() : '';
  if (name.length < 2 || name.length > 60) errors.push('Họ tên phải từ 2 đến 60 ký tự.');
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  if (!title || title.length > 100) errors.push('Chức danh bắt buộc, tối đa 100 ký tự.');

  if (!Array.isArray(row.specialties) || !row.specialties.length) errors.push('Cần ít nhất một chuyên môn.');
  else if (row.specialties.some((id) => typeof id !== 'string' || !id)) errors.push('Chuyên môn phải là mã danh mục dạng chuỗi.');
  else {
    if (new Set(row.specialties).size !== row.specialties.length) errors.push('Chuyên môn bị trùng lặp.');
    const missing = row.specialties.filter((id) => !categoryIds.has(id));
    if (missing.length) errors.push(`Chuyên môn tham chiếu danh mục không tồn tại trên site này: ${missing.join(', ')}.`);
  }

  if (!Array.isArray(row.workingDays) || !row.workingDays.length
      || row.workingDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
      || new Set(row.workingDays).size !== row.workingDays.length) {
    errors.push('Ngày làm việc phải là danh sách số nguyên 0–6, không trùng, không rỗng.');
  }

  if (!isValidTimeStr(row.shiftStart)) errors.push('Giờ bắt đầu ca không hợp lệ (HH:MM).');
  if (!isValidTimeStr(row.shiftEnd)) errors.push('Giờ kết thúc ca không hợp lệ (HH:MM).');
  if (isValidTimeStr(row.shiftStart) && isValidTimeStr(row.shiftEnd) && timeToMin(row.shiftStart) >= timeToMin(row.shiftEnd)) {
    errors.push('Giờ kết thúc ca phải sau giờ bắt đầu.');
  }

  if (row.daysOff !== undefined) {
    if (!Array.isArray(row.daysOff) || row.daysOff.length > 366 || row.daysOff.some((d) => !isValidDateStr(d))) {
      errors.push('Danh sách ngày nghỉ không hợp lệ (YYYY-MM-DD, tối đa 366).');
    }
  }

  if (row.breaks !== undefined) {
    const validBreak = (b) => b && typeof b === 'object' && !Array.isArray(b)
      && Object.keys(b).every((key) => key === 'startTime' || key === 'endTime')
      && isValidTimeStr(b.startTime) && isValidTimeStr(b.endTime) && timeToMin(b.startTime) < timeToMin(b.endTime);
    if (!Array.isArray(row.breaks) || row.breaks.length > 10 || !row.breaks.every(validBreak)) {
      errors.push('Danh sách giờ nghỉ không hợp lệ.');
    }
  }
  if (row.breakStart !== undefined || row.breakEnd !== undefined) {
    if (!isValidTimeStr(row.breakStart) || !isValidTimeStr(row.breakEnd) || timeToMin(row.breakStart) >= timeToMin(row.breakEnd)) {
      errors.push('Khung giờ nghỉ (breakStart/breakEnd) không hợp lệ.');
    }
  }

  if (row.active !== undefined && typeof row.active !== 'boolean') errors.push('Trạng thái "active" phải là true/false.');
  if (row.imageId !== undefined && (typeof row.imageId !== 'string' || !IMAGE_ID_RE.test(row.imageId))) errors.push('Mã ảnh (imageId) không hợp lệ.');

  if (row.imageUrl !== undefined) {
    const image = classifyImageUrl(row.imageUrl);
    if (!image.ok) errors.push('Ảnh (imageUrl) phải là ảnh nhúng PNG/JPEG/WebP ≤ 600 KB, URL https:// hoặc đường dẫn bắt đầu bằng "/".');
    else if (image.kind === 'relative') warnings.push('Ảnh dùng đường dẫn tương đối — tệp có thể không tồn tại trên site đích.');
  }

  if (row.createdAt !== undefined && !isIsoTimestamp(row.createdAt)) errors.push('createdAt không hợp lệ.');
  if (row.updatedAt !== undefined && !isIsoTimestamp(row.updatedAt)) errors.push('updatedAt không hợp lệ.');

  if (errors.length) return { record: null, errors, warnings };
  const record = pickStaffRosterFields(row);
  record.name = name;
  record.title = title;
  if (record.active === undefined) record.active = true;
  if (record.daysOff === undefined) record.daysOff = [];
  return { record, errors, warnings };
}

/**
 * Đọc nội dung tệp JSON. Ném StaffRosterError nếu tệp sai định dạng/quá lớn.
 * Dòng lỗi KHÔNG bị bỏ qua âm thầm: được trả trong `invalid` để giao diện chặn nhập.
 */
export function parseStaffRosterFile(text, { categoryIds }) {
  if (typeof text !== 'string' || !text.trim()) throw new StaffRosterError('Tệp rỗng.');
  if (byteLength(text) > STAFF_ROSTER_MAX_FILE_BYTES) throw new StaffRosterError('Tệp lớn hơn 6 MB.', 'ROSTER_TOO_LARGE');
  let payload;
  try { payload = JSON.parse(text); } catch { throw new StaffRosterError('Tệp không phải JSON hợp lệ.'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new StaffRosterError('Tệp phải là đối tượng JSON xuất từ chức năng "Xuất hồ sơ chuyên viên".');
  if (payload.format !== STAFF_ROSTER_FORMAT) throw new StaffRosterError(`Sai định dạng: cần "${STAFF_ROSTER_FORMAT}". Tệp này không phải danh sách chuyên viên.`);
  if (payload.version !== STAFF_ROSTER_VERSION) throw new StaffRosterError(`Phiên bản tệp ${String(payload.version)} không được hỗ trợ (cần ${STAFF_ROSTER_VERSION}).`);
  const allowedTop = new Set(['format', 'version', 'kind', 'exportedAt', 'source', 'count', 'staff']);
  const extraTop = Object.keys(payload).filter((key) => !allowedTop.has(key));
  if (extraTop.length) throw new StaffRosterError(`Tệp chứa mục không thuộc hồ sơ chuyên viên: ${extraTop.join(', ')}.`);
  if (payload.kind !== undefined && payload.kind !== 'staff-only') throw new StaffRosterError('Trường "kind" phải là "staff-only".');
  if (!Array.isArray(payload.staff)) throw new StaffRosterError('Thiếu danh sách "staff".');
  if (!payload.staff.length) throw new StaffRosterError('Danh sách "staff" rỗng.');
  if (payload.staff.length > STAFF_ROSTER_MAX_RECORDS) throw new StaffRosterError(`Tối đa ${STAFF_ROSTER_MAX_RECORDS} chuyên viên mỗi lần nhập.`, 'ROSTER_TOO_LARGE');
  if (payload.count !== undefined && payload.count !== payload.staff.length) {
    throw new StaffRosterError(`Số lượng khai báo (${String(payload.count)}) khác số dòng thực tế (${payload.staff.length}). Tệp có thể bị cắt hoặc sửa tay.`);
  }

  const valid = [];
  const invalid = [];
  const seen = new Map();
  payload.staff.forEach((row, index) => {
    const { record, errors, warnings } = validateStaffRosterRow(row, categoryIds);
    const id = typeof row?.id === 'string' ? row.id : '';
    const name = typeof row?.name === 'string' ? row.name : '';
    if (id && seen.has(id)) errors.push(`ID trùng với dòng ${seen.get(id) + 1}.`);
    if (id && !seen.has(id)) seen.set(id, index);
    if (errors.length || !record) invalid.push({ index, id, name, errors });
    else valid.push({ index, record, warnings });
  });
  return {
    meta: { exportedAt: typeof payload.exportedAt === 'string' ? payload.exportedAt.slice(0, 40) : '', source: typeof payload.source === 'string' ? payload.source.slice(0, 200) : '' },
    total: payload.staff.length,
    valid,
    invalid,
  };
}

/** Chuẩn hóa giá trị mặc định (active=true, daysOff=[]) để không báo thay đổi giả. */
function normalizedField(record, field) {
  const value = record[field];
  if (field === 'active') return value !== false;
  if (field === 'daysOff') return Array.isArray(value) ? value : [];
  return value ?? null;
}

function changedFields(current, incoming) {
  return COMPARE_FIELDS.filter((field) => field !== 'id'
    && JSON.stringify(normalizedField(current, field)) !== JSON.stringify(normalizedField(incoming, field)));
}

/** Hai hồ sơ có cùng nội dung chuyển được (bỏ qua mốc thời gian) — dùng để xác minh sau khi đồng bộ. */
export function staffRosterRecordMatches(a, b) {
  return Boolean(a && b && a.id === b.id && !changedFields(a, b).length);
}

/**
 * So khớp theo ID. Không bao giờ có hành động xóa: nhân viên chỉ có trên site đích được giữ nguyên.
 */
export function planStaffRosterImport(parsed, currentStaff) {
  const current = new Map((currentStaff || []).map((staff) => [staff.id, staff]));
  const importedIds = new Set(parsed.valid.map((item) => item.record.id));
  const creates = [];
  const updates = [];
  const unchanged = [];
  for (const item of parsed.valid) {
    const existing = current.get(item.record.id);
    if (!existing) { creates.push({ ...item }); continue; }
    const fields = changedFields(existing, item.record);
    if (!fields.length) unchanged.push({ ...item, existing });
    else updates.push({ ...item, existing, fields });
  }
  const preserved = (currentStaff || []).filter((staff) => !importedIds.has(staff.id));
  return { creates, updates, unchanged, preserved, invalid: parsed.invalid, total: parsed.total };
}

/** Chữ ký ổn định của một kế hoạch để phát hiện dữ liệu đích đã đổi giữa lúc xem trước và lúc nhập. */
export function staffRosterPlanSignature(plan) {
  return JSON.stringify({
    c: plan.creates.map((item) => item.record.id).sort(),
    u: plan.updates.map((item) => `${item.record.id}@${item.existing?.updatedAt || ''}`).sort(),
    n: plan.unchanged.map((item) => `${item.record.id}@${item.existing?.updatedAt || ''}`).sort(),
    p: plan.preserved.map((staff) => staff.id).sort(),
  });
}

/**
 * Tạo danh sách gộp: giữ thứ tự hiện có, thêm bản ghi mới ở cuối.
 * Bản ghi trùng ID chỉ bị ghi đè khi overwriteMatching=true (admin đã xác nhận rõ); nếu không thì giữ nguyên.
 */
export function applyStaffRosterPlan(plan, currentStaff, { overwriteMatching = false, now = new Date().toISOString() } = {}) {
  if (plan.invalid.length) throw new StaffRosterError('Tệp còn dòng không hợp lệ; không thể nhập.');
  const updatesById = new Map(overwriteMatching ? plan.updates.map((item) => [item.record.id, item.record]) : []);
  const merged = (currentStaff || []).map((staff) => {
    const incoming = updatesById.get(staff.id);
    if (!incoming) return staff;
    const { createdAt: _c, updatedAt: _u, ...fields } = incoming;
    const next = { ...staff, ...fields, id: staff.id, createdAt: staff.createdAt || incoming.createdAt || now, updatedAt: now };
    // Trường tùy chọn không có trong tệp nguồn thì gỡ khỏi bản đích để phản ánh đúng hồ sơ nguồn.
    for (const optional of ['imageUrl', 'imageId', 'breaks', 'breakStart', 'breakEnd']) {
      if (incoming[optional] === undefined) delete next[optional];
    }
    return next;
  });
  for (const item of plan.creates) {
    merged.push({ ...item.record, createdAt: item.record.createdAt || now, updatedAt: now });
  }
  if (merged.length > STAFF_COLLECTION_MAX_RECORDS) throw new StaffRosterError(`Sau khi gộp sẽ vượt quá ${STAFF_COLLECTION_MAX_RECORDS} chuyên viên.`, 'ROSTER_TOO_LARGE');
  if (byteLength(JSON.stringify({ records: merged })) > STAFF_ROSTER_MAX_COLLECTION_BYTES) {
    throw new StaffRosterError('Dữ liệu chuyên viên sau khi gộp vượt giới hạn tải lên của máy chủ (ảnh nhúng quá lớn).', 'ROSTER_TOO_LARGE');
  }
  return merged;
}
