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
const MAX_IMAGE_DIMENSION = 8192;
const MAX_IMAGE_PIXELS = 16_777_216;

/** Các trường nhân viên được phép chuyển; mọi trường khác bị từ chối để tránh lẫn dữ liệu tài khoản. */
export const STAFF_ROSTER_FIELDS = Object.freeze([
  'id', 'name', 'title', 'imageId', 'imageUrl', 'specialties', 'workingDays',
  'shiftStart', 'shiftEnd', 'daysOff', 'breaks', 'breakStart', 'breakEnd',
  'active', 'createdAt', 'updatedAt',
]);
const FIELD_SET = new Set(STAFF_ROSTER_FIELDS);
/** Trường so sánh khi quyết định "thay đổi" hay "giống hệt" (bỏ qua mốc thời gian). */
const COMPARE_FIELDS = STAFF_ROSTER_FIELDS.filter((field) => !['createdAt', 'updatedAt'].includes(field));
const CLEARABLE_FIELDS = new Set(['imageUrl', 'imageId', 'breaks', 'breakStart', 'breakEnd']);

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const IMAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;

export class StaffRosterError extends Error {
  constructor(message, code = 'ROSTER_INVALID') {
    super(message);
    this.name = 'StaffRosterError';
    this.code = code;
  }
}

/** Chỉ giữ các trường nhân viên trong whitelist (dùng khi xuất). */
export function pickStaffRosterFields(staff) {
  if (!staff || typeof staff !== 'object' || Array.isArray(staff)) {
    throw new StaffRosterError('Hồ sơ chuyên viên không hợp lệ.');
  }
  const out = {};
  for (const field of STAFF_ROSTER_FIELDS) {
    if (staff[field] === undefined) continue;
    const value = staff[field];
    // Empty optional strings are the legacy representation of "no value". Export
    // them as explicit null so a later overwrite can clear them intentionally.
    out[field] = CLEARABLE_FIELDS.has(field) && value === '' ? null : structuredClone(value);
  }
  return out;
}

export function buildStaffRosterExport(staffList, { source = '', exportedAt = new Date().toISOString(), categoryIds } = {}) {
  if (!Array.isArray(staffList)) throw new StaffRosterError('Danh sách chuyên viên không hợp lệ.');
  if (categoryIds !== undefined && !(categoryIds instanceof Set) && !Array.isArray(categoryIds)) {
    throw new StaffRosterError('Danh sách danh mục nguồn không hợp lệ.');
  }
  const staff = staffList.map(pickStaffRosterFields);
  if (staff.length > STAFF_ROSTER_MAX_RECORDS) {
    throw new StaffRosterError(`Tối đa ${STAFF_ROSTER_MAX_RECORDS} chuyên viên mỗi lần xuất.`, 'ROSTER_TOO_LARGE');
  }
  const availableCategoryIds = categoryIds === undefined
    ? new Set(staff.flatMap((record) => Array.isArray(record.specialties) ? record.specialties : []))
    : new Set(categoryIds);
  const ids = new Set();
  for (const record of staff) {
    if (ids.has(record.id)) throw new StaffRosterError(`ID chuyên viên bị trùng: ${String(record.id)}.`);
    ids.add(record.id);
    const validation = validateStaffRosterRow(record, availableCategoryIds);
    if (validation.errors.length) {
      throw new StaffRosterError(`Không thể xuất hồ sơ ${String(record.id || '(không có ID)')}: ${validation.errors.join(' ')}`);
    }
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

const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function pngCrc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = PNG_CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validPng(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 45 || signature.some((byte, index) => bytes[index] !== byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let hasHeader = false;
  let hasImageData = false;
  let hasEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) return false;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (!hasHeader) {
      if (type !== 'IHDR' || length !== 13) return false;
      const width = view.getUint32(dataStart, false);
      const height = view.getUint32(dataStart + 4, false);
      if (!width || !height || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
          || width * height > MAX_IMAGE_PIXELS) return false;
      hasHeader = true;
    } else if (type === 'IHDR') return false;
    if (view.getUint32(dataEnd, false) !== pngCrc32(bytes, offset + 4, dataEnd)) return false;
    if (type === 'IDAT') hasImageData = true;
    if (type === 'IEND') {
      if (length !== 0 || !hasImageData || chunkEnd !== bytes.length) return false;
      hasEnd = true;
      break;
    }
    offset = chunkEnd;
  }
  return hasHeader && hasImageData && hasEnd;
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function dimensionsWithinLimit(width, height) {
  return Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && height > 0
    && width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION
    && width * height <= MAX_IMAGE_PIXELS;
}

function isJpegStartOfFrame(marker) {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

/** Check JPEG marker/segment structure and bound dimensions before image decoding. */
function validJpeg(bytes) {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  let hasFrame = false;
  let hasScan = false;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9) return hasFrame && hasScan && offset === bytes.length;
    if (marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) return false;
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length) return false;

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    if (isJpegStartOfFrame(marker)) {
      if (hasFrame || segmentLength < 8) return false;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const components = bytes[offset + 7];
      if (!components || segmentLength !== 8 + components * 3 || !dimensionsWithinLimit(width, height)) return false;
      hasFrame = true;
    }

    if (marker !== 0xda) {
      offset += segmentLength;
      continue;
    }

    const components = bytes[offset + 2];
    if (!hasFrame || !components || segmentLength !== 6 + components * 2) return false;
    hasScan = true;
    offset += segmentLength;

    // Scan entropy bytes until the next unstuffed marker. Restart markers and FF00
    // are part of the scan; other markers are parsed by the outer loop.
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const markerStart = offset;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return false;
      const scanMarker = bytes[offset];
      if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
        offset += 1;
        continue;
      }
      offset = markerStart;
      break;
    }
  }
  return false;
}

function validWebp(bytes) {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WEBP') return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== bytes.length - 8) return false;
  let offset = 12;
  let hasImageData = false;
  let dimensions = null;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return false;
    const type = ascii(bytes, offset, offset + 4);
    const length = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + (length % 2);
    if (chunkEnd > bytes.length) return false;

    if (type === 'VP8X') {
      if (length !== 10) return false;
      const width = 1 + bytes[dataStart + 4] + (bytes[dataStart + 5] << 8) + (bytes[dataStart + 6] << 16);
      const height = 1 + bytes[dataStart + 7] + (bytes[dataStart + 8] << 8) + (bytes[dataStart + 9] << 16);
      if (!dimensionsWithinLimit(width, height)) return false;
      dimensions ||= { width, height };
    } else if (type === 'VP8 ' && length >= 10) {
      if (bytes[dataStart + 3] !== 0x9d || bytes[dataStart + 4] !== 0x01 || bytes[dataStart + 5] !== 0x2a) return false;
      const width = ((bytes[dataStart + 6] | (bytes[dataStart + 7] << 8)) & 0x3fff);
      const height = ((bytes[dataStart + 8] | (bytes[dataStart + 9] << 8)) & 0x3fff);
      if (!dimensionsWithinLimit(width, height)) return false;
      dimensions ||= { width, height };
      hasImageData = true;
    } else if (type === 'VP8L' && length >= 5) {
      if (bytes[dataStart] !== 0x2f) return false;
      const width = 1 + (((bytes[dataStart + 2] & 0x3f) << 8) | bytes[dataStart + 1]);
      const height = 1 + (((bytes[dataStart + 4] & 0x0f) << 10) | (bytes[dataStart + 3] << 2) | ((bytes[dataStart + 2] & 0xc0) >> 6));
      if (!dimensionsWithinLimit(width, height)) return false;
      dimensions ||= { width, height };
      hasImageData = true;
    }

    offset = chunkEnd;
  }
  return offset === bytes.length && hasImageData && Boolean(dimensions);
}

function classifyImageUrl(value) {
  if (value === null) return { ok: true, kind: 'cleared' };
  if (typeof value !== 'string' || !value) return { ok: false };
  if (value.startsWith('data:')) {
    const match = DATA_IMAGE_RE.exec(value);
    if (!match || value.length > MAX_IMAGE_DATA_URL_CHARS || match[2].length % 4 !== 0) return { ok: false };
    let bytes;
    try { bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0)); }
    catch { return { ok: false }; }
    let signatureMatches = false;
    if (match[1].toLowerCase() === 'png') {
      signatureMatches = validPng(bytes);
    } else if (match[1].toLowerCase() === 'jpeg') {
      signatureMatches = validJpeg(bytes);
    } else if (match[1].toLowerCase() === 'webp') {
      signatureMatches = validWebp(bytes);
    }
    return { ok: signatureMatches, kind: 'embedded' };
  }
  if (value.length > MAX_URL_CHARS || /[\s"'<>]/.test(value)) return { ok: false };
  if (/^https:\/\/[^/]/i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return { ok: true, kind: 'absolute' };
    } catch { /* rejected below */ }
    return { ok: false };
  }
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

  const hasValidShift = isValidTimeStr(row.shiftStart) && isValidTimeStr(row.shiftEnd)
    && timeToMin(row.shiftStart) < timeToMin(row.shiftEnd);
  if (row.breaks !== undefined && row.breaks !== null) {
    const validBreak = (b) => b && typeof b === 'object' && !Array.isArray(b)
      && Object.keys(b).every((key) => key === 'startTime' || key === 'endTime')
      && isValidTimeStr(b.startTime) && isValidTimeStr(b.endTime)
      && timeToMin(b.startTime) < timeToMin(b.endTime)
      && hasValidShift && timeToMin(b.startTime) >= timeToMin(row.shiftStart)
      && timeToMin(b.endTime) <= timeToMin(row.shiftEnd);
    const breaks = Array.isArray(row.breaks) ? [...row.breaks].sort((a, b) => String(a?.startTime).localeCompare(String(b?.startTime))) : [];
    const overlaps = breaks.some((item, index) => index > 0
      && isValidTimeStr(item?.startTime) && isValidTimeStr(breaks[index - 1]?.endTime)
      && timeToMin(item.startTime) < timeToMin(breaks[index - 1].endTime));
    if (!Array.isArray(row.breaks) || row.breaks.length > 10 || !row.breaks.every(validBreak) || overlaps) {
      errors.push('Danh sách giờ nghỉ không hợp lệ.');
    }
  }
  if (row.breakStart !== undefined || row.breakEnd !== undefined) {
    const explicitlyCleared = row.breakStart === null && row.breakEnd === null;
    const validRange = isValidTimeStr(row.breakStart) && isValidTimeStr(row.breakEnd)
      && timeToMin(row.breakStart) < timeToMin(row.breakEnd)
      && hasValidShift && timeToMin(row.breakStart) >= timeToMin(row.shiftStart)
      && timeToMin(row.breakEnd) <= timeToMin(row.shiftEnd);
    if (!explicitlyCleared && !validRange) {
      errors.push('Khung giờ nghỉ (breakStart/breakEnd) không hợp lệ.');
    }
  }

  if (row.active !== undefined && typeof row.active !== 'boolean') errors.push('Trạng thái "active" phải là true/false.');
  if (row.imageId !== undefined && row.imageId !== null
      && (typeof row.imageId !== 'string' || !IMAGE_ID_RE.test(row.imageId))) errors.push('Mã ảnh (imageId) không hợp lệ.');
  if (row.imageId != null) warnings.push('Mã ảnh phụ thuộc bộ tài nguyên đã cài trên site đích; hãy kiểm tra ảnh sau khi chuyển.');

  if (row.imageUrl !== undefined) {
    const image = classifyImageUrl(row.imageUrl);
    if (!image.ok) errors.push('Ảnh (imageUrl) phải là ảnh nhúng PNG/JPEG/WebP ≤ 600 KB, URL https:// hoặc đường dẫn bắt đầu bằng "/".');
    else if (image.kind === 'absolute' || image.kind === 'relative') {
      warnings.push('Đường dẫn ảnh chưa được kiểm tra có tồn tại hoặc truy cập được trên site đích.');
    }
  }

  if (row.createdAt !== undefined && !isIsoTimestamp(row.createdAt)) errors.push('createdAt không hợp lệ.');
  if (row.updatedAt !== undefined && !isIsoTimestamp(row.updatedAt)) errors.push('updatedAt không hợp lệ.');

  if (errors.length) return { record: null, errors, warnings };
  const record = pickStaffRosterFields(row);
  record.name = name;
  record.title = title;
  return { record, errors, warnings };
}

/**
 * Đọc nội dung tệp JSON. Ném StaffRosterError nếu tệp sai định dạng/quá lớn.
 * Dòng lỗi KHÔNG bị bỏ qua âm thầm: được trả trong `invalid` để giao diện chặn nhập.
 */
export function parseStaffRosterFile(text, { categoryIds }) {
  if (typeof text !== 'string') throw new StaffRosterError('Tệp rỗng.');
  if (byteLength(text) > STAFF_ROSTER_MAX_FILE_BYTES) throw new StaffRosterError('Tệp lớn hơn 6 MB.', 'ROSTER_TOO_LARGE');
  if (!text.trim()) throw new StaffRosterError('Tệp rỗng.');
  let payload;
  try { payload = JSON.parse(text); } catch { throw new StaffRosterError('Tệp không phải JSON hợp lệ.'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new StaffRosterError('Tệp phải là đối tượng JSON xuất từ chức năng "Xuất hồ sơ chuyên viên".');
  if (payload.format !== STAFF_ROSTER_FORMAT) throw new StaffRosterError(`Sai định dạng: cần "${STAFF_ROSTER_FORMAT}". Tệp này không phải danh sách chuyên viên.`);
  if (payload.version !== STAFF_ROSTER_VERSION) throw new StaffRosterError(`Phiên bản tệp ${String(payload.version)} không được hỗ trợ (cần ${STAFF_ROSTER_VERSION}).`);
  const allowedTop = new Set(['format', 'version', 'kind', 'exportedAt', 'source', 'count', 'staff']);
  const extraTop = Object.keys(payload).filter((key) => !allowedTop.has(key));
  if (extraTop.length) throw new StaffRosterError(`Tệp chứa mục không thuộc hồ sơ chuyên viên: ${extraTop.join(', ')}.`);
  if (payload.kind !== 'staff-only') throw new StaffRosterError('Trường "kind" phải là "staff-only".');
  if (!Array.isArray(payload.staff)) throw new StaffRosterError('Thiếu danh sách "staff".');
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
  if (CLEARABLE_FIELDS.has(field) && (value === undefined || value === null || value === '')) return null;
  return value ?? null;
}

function changedFields(current, incoming) {
  return COMPARE_FIELDS.filter((field) => field !== 'id' && incoming[field] !== undefined
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
  const importedIds = new Set([
    ...parsed.valid.map((item) => item.record.id),
    ...parsed.invalid.map((item) => item.id).filter(Boolean),
  ]);
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
  return { creates, updates, unchanged, preserved, invalid: parsed.invalid, total: parsed.total,
    targetSnapshot: structuredClone(currentStaff || []) };
}

/** Attach browser decode failures and keep invalid rows out of actionable preview counts. */
export function attachStaffRosterImageErrors(plan, invalidRows) {
  if (!Array.isArray(invalidRows) || !invalidRows.length) return plan;
  const invalidIndexes = new Set(invalidRows.map((row) => row.index));
  const invalidIds = new Set(invalidRows.map((row) => row.id).filter(Boolean));
  for (const action of ['creates', 'updates', 'unchanged']) {
    plan[action] = plan[action].filter((item) => !invalidIndexes.has(item.index));
  }
  plan.preserved = plan.preserved.filter((record) => !invalidIds.has(record.id));
  plan.invalid = [...plan.invalid, ...invalidRows].sort((left, right) => left.index - right.index);
  return plan;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

/** Compare complete stored snapshots, including timestamps and optional fields. */
export function staffRosterRecordSnapshotMatches(a, b) {
  return Boolean(a && b && JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b)));
}

/** Chữ ký của toàn bộ hồ sơ ở site đích và dữ liệu nhập để phát hiện preview cũ. */
export function staffRosterPlanSignature(plan) {
  const incoming = [
    ...plan.creates.map((item) => item.record),
    ...plan.updates.map((item) => item.record),
    ...plan.unchanged.map((item) => item.record),
  ].map(stableValue).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const target = (plan.targetSnapshot || []).map(stableValue)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify({
    target,
    incoming,
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
    // Missing fields preserve the destination value; explicit null requests a clear.
    for (const optional of CLEARABLE_FIELDS) {
      if (incoming[optional] === null) delete next[optional];
    }
    return next;
  });
  for (const item of plan.creates) {
    const record = { active: true, daysOff: [], ...item.record,
      createdAt: item.record.createdAt || now, updatedAt: now };
    for (const optional of CLEARABLE_FIELDS) if (record[optional] === null) delete record[optional];
    merged.push(record);
  }
  if (merged.length > STAFF_COLLECTION_MAX_RECORDS) throw new StaffRosterError(`Sau khi gộp sẽ vượt quá ${STAFF_COLLECTION_MAX_RECORDS} chuyên viên.`, 'ROSTER_TOO_LARGE');
  if (byteLength(JSON.stringify({ records: merged })) > STAFF_ROSTER_MAX_COLLECTION_BYTES) {
    throw new StaffRosterError('Dữ liệu chuyên viên sau khi gộp vượt giới hạn tải lên của máy chủ (ảnh nhúng quá lớn).', 'ROSTER_TOO_LARGE');
  }
  return merged;
}
