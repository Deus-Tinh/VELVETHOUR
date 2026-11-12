/**
 * Nhân viên, cài đặt (giờ mở cửa → khung giờ), khuyến mãi.
 */
import { staffRepo, bookingRepo, settingsRepo, promotionRepo, serviceRepo, categoryRepo } from '../data/repositories.js';
import { AppError } from '../core/errors.js';
import { validate, schemas, required, time, oneOf } from '../core/validators.js';
import { timeToMin, isValidDateStr, isValidTimeStr, todayStr } from '../core/utils.js';
import { authService } from './authService.js';
import {
  applyStaffRosterPlan, buildStaffRosterExport, parseStaffRosterFile,
  planStaffRosterImport, staffRosterPlanSignature,
} from '../domain/staffRosterModel.js';

function requireAdmin() {
  if (authService.getCurrentUser()?.role !== 'admin') throw new AppError('UNAUTHORIZED', 'Chỉ quản trị viên mới được thay đổi cài đặt, nhân viên hoặc khuyến mãi.');
}

function migrateNamedStaffPortrait() {
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').trim().replace(/\s+/g, ' ').toLowerCase();
  staffRepo.getAll().forEach((staff) => {
    if (normalize(staff.name) === 'tran ha linh' && !staff.imageUrl && staff.imageId !== 'staff-tran-ha-linh') {
      staffRepo.update(staff.id, { imageId: 'staff-tran-ha-linh' });
    }
  });
}

/* ---------------- Staff ---------------- */
function checkStaff(data) {
  const { valid, errors } = validate(data, schemas.staff);
  const e = { ...errors };
  if (!isValidTimeStr(data.shiftStart)) e.shiftStart = 'Giờ bắt đầu không hợp lệ';
  if (!isValidTimeStr(data.shiftEnd)) e.shiftEnd = 'Giờ kết thúc không hợp lệ';
  if (isValidTimeStr(data.shiftStart) && isValidTimeStr(data.shiftEnd) && !(timeToMin(data.shiftStart) < timeToMin(data.shiftEnd))) e.shiftEnd = 'Giờ kết thúc phải sau giờ bắt đầu';
  if (!Array.isArray(data.specialties) || !data.specialties.length) e.specialties = 'Chọn ít nhất một chuyên môn';
  if (!Array.isArray(data.workingDays) || !data.workingDays.length || data.workingDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) e.workingDays = 'Chọn ngày làm việc hợp lệ';
  if (data.daysOff != null && !Array.isArray(data.daysOff)) e.daysOff = 'Danh sách ngày nghỉ không hợp lệ';
  if (Array.isArray(data.daysOff) && data.daysOff.some((d) => !isValidDateStr(d))) e.daysOff = 'Ngày nghỉ không hợp lệ';
  if (data.breaks != null && !Array.isArray(data.breaks)) e.breaks = 'Danh sách giờ nghỉ không hợp lệ';
  if (Array.isArray(data.breaks) && data.breaks.some((b) => !isValidTimeStr(b?.startTime) || !isValidTimeStr(b?.endTime) || timeToMin(b.startTime) >= timeToMin(b.endTime))) e.breaks = 'Khung giờ nghỉ không hợp lệ';
  if (data.breakStart != null || data.breakEnd != null) {
    if (!isValidTimeStr(data.breakStart) || !isValidTimeStr(data.breakEnd) || timeToMin(data.breakStart) >= timeToMin(data.breakEnd)) e.breaks = 'Khung giờ nghỉ không hợp lệ';
  }
  const categoryIds = new Set(categoryRepo.getAll().map((c) => c.id));
  if (Array.isArray(data.specialties) && data.specialties.some((id) => !categoryIds.has(id))) e.specialties = 'Chuyên môn tham chiếu danh mục không tồn tại';
  if (!valid || Object.keys(e).length) throw new AppError('VALIDATION', 'Thông tin nhân viên không hợp lệ', e);
}

export const staffService = {
  list: () => { migrateNamedStaffPortrait(); return staffRepo.getAll(); },
  listActive: () => { migrateNamedStaffPortrait(); return staffRepo.findBy((s) => s.active !== false); },
  get: (id) => staffRepo.getById(id),
  create(data) {
    requireAdmin();
    const record = { imageId: 'staff-01', daysOff: [], active: true, shiftStart: '10:00', shiftEnd: '22:00', workingDays: [0, 1, 2, 3, 4, 5, 6], specialties: [], ...data };
    checkStaff(record);
    return staffRepo.create({ ...record, name: record.name.trim(), title: record.title.trim() });
  },
  update(id, data) {
    requireAdmin();
    const cur = staffRepo.getById(id);
    if (!cur) throw new AppError('NOT_FOUND', 'Không tìm thấy nhân viên.');
    const merged = { ...cur, ...data };
    checkStaff(merged);
    return staffRepo.update(id, merged);
  },
  /** Nhân viên đã có booking → ngừng hoạt động; chưa có → xóa hẳn. */
  remove(id) {
    requireAdmin();
    if (!staffRepo.getById(id)) throw new AppError('NOT_FOUND', 'Không tìm thấy nhân viên.');
    if (bookingRepo.findBy((b) => b.staffId === id).length) { staffRepo.update(id, { active: false }); return { mode: 'deactivated' }; }
    staffRepo.remove(id);
    return { mode: 'deleted' };
  },
  /** Nhân viên có chuyên môn phù hợp với dịch vụ. */
  forService(serviceId) {
    const svc = serviceRepo.getById(serviceId);
    if (!svc) return [];
    return this.listActive().filter((s) => (s.specialties || []).includes(svc.category));
  },
  /** Xuất hồ sơ chuyên viên (chỉ dữ liệu nhân viên, không tài khoản/mật khẩu/lịch hẹn). */
  exportRoster() {
    requireAdmin();
    const source = typeof window !== 'undefined' ? window.location.origin : '';
    return buildStaffRosterExport(staffRepo.getAll(), {
      source,
      categoryIds: categoryRepo.getAll().map((category) => category.id),
    });
  },
  /** Đọc tệp và lập kế hoạch nhập — KHÔNG ghi dữ liệu. */
  previewRosterImport(text, { currentStaff = staffRepo.getAll(), version = null } = {}) {
    requireAdmin();
    const categoryIds = new Set(categoryRepo.getAll().map((c) => c.id));
    const parsed = parseStaffRosterFile(text, { categoryIds });
    const plan = planStaffRosterImport(parsed, currentStaff);
    return { meta: parsed.meta, plan, signature: staffRosterPlanSignature(plan), version };
  },
  /**
   * Chuẩn bị danh sách upsert theo ID. Không ghi LocalStorage; giao diện gửi trực tiếp lên API
   * có version để server kiểm tra lại và chỉ thay đổi các ID đã xác nhận trong preview.
   */
  applyRosterImport(text, { overwriteMatching = false, expectedSignature, currentStaff = staffRepo.getAll(), expectedVersion = null } = {}) {
    requireAdmin();
    const categoryIds = new Set(categoryRepo.getAll().map((c) => c.id));
    const plan = planStaffRosterImport(parseStaffRosterFile(text, { categoryIds }), currentStaff);
    if (plan.invalid.length) throw new AppError('VALIDATION', 'Tệp còn dòng không hợp lệ; không thể nhập.');
    if (expectedSignature !== staffRosterPlanSignature(plan)) {
      throw new AppError('ROSTER_STALE', 'Dữ liệu chuyên viên trên site đã thay đổi kể từ lúc xem trước. Hãy chọn lại tệp để xem trước lần nữa.');
    }
    // Run the same merge limits client-side for clear preview feedback; only touched
    // records are sent to the server, which repeats the limits in its transaction.
    applyStaffRosterPlan(plan, currentStaff, { overwriteMatching });
    const createdIds = plan.creates.map((item) => item.record.id);
    const updatedIds = overwriteMatching ? plan.updates.map((item) => item.record.id) : [];
    const records = [
      ...plan.creates.map((item) => item.record),
      ...(overwriteMatching ? plan.updates.map((item) => item.record) : []),
    ];
    records.forEach(checkStaff);
    return {
      createdIds, updatedIds, records,
      skippedUpdates: overwriteMatching ? 0 : plan.updates.length,
      unchanged: plan.unchanged.length, preserved: plan.preserved.length,
      preservedIds: plan.preserved.map((staff) => staff.id),
      expectedVersion, wrote: records.length > 0,
    };
  },
};

/* ---------------- Settings ---------------- */
export const DEFAULT_SETTINGS = { id: 'main', spaName: 'Serenity Spa & Wellness', phone: '', email: '', address: '', openTime: '10:00', closeTime: '22:15', slotStep: 30, roomCount: 0, notificationChannel: 'zalo', closedDates: [], cancelBeforeHours: 2, maxAdvanceDays: 60 };

export const settingsService = {
  get() { return { ...DEFAULT_SETTINGS, ...(settingsRepo.getById('main') || {}) }; },
  update(data) {
    requireAdmin();
    const merged = { ...this.get(), ...data };
    const errors = { ...validate(merged, { openTime: [required(), time()], closeTime: [required(), time()], slotStep: [oneOf([15, 30, 60], 'Bước khung giờ: 15, 30 hoặc 60 phút')] }).errors };
    if (!['zalo', 'sms', 'email'].includes(merged.notificationChannel)) errors.notificationChannel = 'Chọn kênh nhắn tin hợp lệ';
    if (!errors.openTime && !errors.closeTime && timeToMin(merged.openTime) >= timeToMin(merged.closeTime)) errors.closeTime = 'Giờ đóng cửa phải sau giờ mở cửa';
    if (!Number.isFinite(Number(merged.cancelBeforeHours)) || Number(merged.cancelBeforeHours) < 0) errors.cancelBeforeHours = 'Thời gian báo hủy không hợp lệ';
    if (!Number.isInteger(Number(merged.maxAdvanceDays)) || Number(merged.maxAdvanceDays) < 0) errors.maxAdvanceDays = 'Số ngày đặt trước không hợp lệ';
    if (!Number.isInteger(Number(merged.roomCount)) || Number(merged.roomCount) < 0 || Number(merged.roomCount) > 100) errors.roomCount = 'Số phòng phải từ 0 đến 100';
    if (!Array.isArray(merged.closedDates) || merged.closedDates.some((d) => !isValidDateStr(d))) errors.closedDates = 'Danh sách ngày đóng cửa không hợp lệ';
    if (Object.keys(errors).length) throw new AppError('VALIDATION', 'Cài đặt không hợp lệ', errors);
    return settingsRepo.getById('main') ? settingsRepo.update('main', merged) : settingsRepo.create(merged);
  },
};

/* ---------------- Promotions ---------------- */
function checkPromo(data, existingId = null) {
  const { errors } = validate(data, schemas.promotion);
  const e = { ...errors };
  if (!['percent', 'fixed'].includes(data.type)) e.type = 'Loại giảm giá không hợp lệ';
  if (data.type === 'percent' && Number(data.value) > 100) e.value = 'Phần trăm tối đa 100';
  if (Number(data.minOrder) < 0 || !Number.isFinite(Number(data.minOrder))) e.minOrder = 'Giá trị đơn tối thiểu không hợp lệ';
  if (Number(data.maxDiscount) < 0 || !Number.isFinite(Number(data.maxDiscount))) e.maxDiscount = 'Mức giảm tối đa không hợp lệ';
  if (Number(data.usageLimit) < 0 || !Number.isFinite(Number(data.usageLimit))) e.usageLimit = 'Giới hạn lượt dùng không hợp lệ';
  if (data.startDate && !isValidDateStr(data.startDate)) e.startDate = 'Ngày bắt đầu không hợp lệ';
  if (data.startDate && data.expiresAt && isValidDateStr(data.expiresAt) && data.startDate > data.expiresAt) e.startDate = 'Ngày bắt đầu phải trước ngày hết hạn';
  if (promotionRepo.findBy((p) => p.code.toUpperCase() === String(data.code).trim().toUpperCase() && p.id !== existingId).length) e.code = 'Mã đã tồn tại';
  if (Object.keys(e).length) throw new AppError('VALIDATION', 'Thông tin khuyến mãi không hợp lệ', e);
}

export const promotionService = {
  list: () => promotionRepo.getAll(),
  get: (id) => promotionRepo.getById(id),
  create(data) {
    requireAdmin();
    const record = { type: 'percent', minOrder: 0, maxDiscount: 0, usageLimit: 100, usedCount: 0, active: true, description: '', ...data };
    checkPromo(record);
    return promotionRepo.create({ ...record, code: record.code.trim().toUpperCase(), value: Number(record.value), minOrder: Number(record.minOrder) || 0, maxDiscount: Number(record.maxDiscount) || 0, usageLimit: Number(record.usageLimit) || 0, usedCount: 0 });
  },
  update(id, data) {
    requireAdmin();
    const cur = promotionRepo.getById(id);
    if (!cur) throw new AppError('NOT_FOUND', 'Không tìm thấy khuyến mãi.');
    const merged = { ...cur, ...data, usedCount: cur.usedCount };
    checkPromo(merged, id);
    return promotionRepo.update(id, { ...merged, code: merged.code.trim().toUpperCase(), value: Number(merged.value), minOrder: Number(merged.minOrder) || 0, maxDiscount: Number(merged.maxDiscount) || 0, usageLimit: Number(merged.usageLimit) || 0 });
  },
  /** Mã đã được dùng → chỉ tắt; chưa dùng → xóa hẳn. */
  remove(id) {
    requireAdmin();
    const cur = promotionRepo.getById(id);
    if (!cur) throw new AppError('NOT_FOUND', 'Không tìm thấy khuyến mãi.');
    if (cur.usedCount > 0) { promotionRepo.update(id, { active: false }); return { mode: 'deactivated' }; }
    promotionRepo.remove(id);
    return { mode: 'deleted' };
  },
  /** Kiểm tra mã: tồn tại, đang bật, còn hạn, còn lượt, đạt giá trị tối thiểu. Trả về promotion hợp lệ. */
  check(code, subtotal) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) throw new AppError('PROMO_INVALID', 'Vui lòng nhập mã khuyến mãi.');
    const promo = promotionRepo.findBy((p) => p.code.toUpperCase() === c)[0];
    if (!promo) throw new AppError('PROMO_INVALID', 'Mã khuyến mãi không tồn tại.');
    if (promo.active !== true || !['percent', 'fixed'].includes(promo.type) || !Number.isFinite(Number(promo.value)) || Number(promo.value) <= 0 ||
        !Number.isFinite(Number(promo.minOrder)) || Number(promo.minOrder) < 0 || !Number.isFinite(Number(promo.maxDiscount)) || Number(promo.maxDiscount) < 0 ||
        !Number.isFinite(Number(promo.usageLimit)) || Number(promo.usageLimit) < 0 || !Number.isFinite(Number(promo.usedCount)) || Number(promo.usedCount) < 0 ||
        (promo.type === 'percent' && Number(promo.value) > 100) || !isValidDateStr(promo.expiresAt) ||
        (promo.startDate != null && !isValidDateStr(promo.startDate))) {
      throw new AppError('PROMO_INVALID', 'Thông tin khuyến mãi không hợp lệ hoặc mã đang bị tắt.');
    }
    if (promo.startDate && promo.startDate > todayStr()) throw new AppError('PROMO_NOT_STARTED', 'Mã khuyến mãi chưa đến thời gian sử dụng.');
    if (promo.expiresAt < todayStr()) throw new AppError('PROMO_EXPIRED', 'Mã khuyến mãi đã hết hạn.');
    if (promo.usageLimit > 0 && promo.usedCount >= promo.usageLimit) throw new AppError('PROMO_LIMIT', 'Mã khuyến mãi đã hết lượt sử dụng.');
    if (subtotal < (promo.minOrder || 0)) throw new AppError('PROMO_MIN', `Đơn hàng tối thiểu ${new Intl.NumberFormat('vi-VN').format(promo.minOrder)}₫ để dùng mã này.`);
    return promo;
  },
  /** Số tiền giảm — không vượt quá maxDiscount và không vượt quá subtotal (final ≥ 0). */
  discountFor(promo, subtotal) {
    const raw = promo.type === 'percent' ? Math.floor((subtotal * promo.value) / 100) : promo.value;
    const capped = promo.maxDiscount > 0 ? Math.min(raw, promo.maxDiscount) : raw;
    return Math.max(0, Math.min(capped, subtotal));
  },
};
