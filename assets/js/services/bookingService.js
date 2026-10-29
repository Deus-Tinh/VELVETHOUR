/**
 * Booking Service — Nghiệp vụ cốt lõi của Serenity Spa & Wellness.
 * Xử lý:
 * 1. Tính toán khung giờ khả dụng (Availability Slots) theo cài đặt Spa & ca làm việc của nhân viên.
 * 2. Phát hiện xung đột lịch (Conflict Detection): newStart < existingEnd && newEnd > existingStart.
 * 3. Tính toán giá (Price Calculation): originalPrice, discountAmount, finalPrice từ dữ liệu thật.
 * 4. Tạo lịch hẹn (Idempotency lock tránh double submit, sinh mã bookingCode, lưu snapshot giá).
 * 5. Luồng trạng thái (Status Workflow): Pending -> Confirmed -> Completed, Hủy lịch theo chính sách.
 */
import { bookingRepo, serviceRepo, staffRepo, promotionRepo } from '../data/repositories.js';
import { settingsService, promotionService } from './staffSettingsPromoService.js';
import { authService } from './authService.js';
import { apiClient } from './apiClient.js';
import { AppError } from '../core/errors.js';
import { validate, schemas } from '../core/validators.js';
import { isServiceBookable } from '../domain/serviceCatalogModel.js';
import { calculatePrice as calculateDomainPrice } from '../domain/pricingService.js';
import {
  todayStr, businessNow, clock, timeToMin, minToTime, bookingLockEndMinute, addDays, weekday,
  isValidDateStr, isValidTimeStr, bookingCode
} from '../core/utils.js';

// Khóa chống double submit (idempotency lock theo phiên)
const activeSubmissions = new Set();

function staffBreaks(staff) {
  const breaks = Array.isArray(staff.breaks) ? staff.breaks : [];
  if (staff.breakStart && staff.breakEnd) breaks.push({ startTime: staff.breakStart, endTime: staff.breakEnd });
  return breaks.filter((b) => isValidTimeStr(b.startTime) && isValidTimeStr(b.endTime) && timeToMin(b.startTime) < timeToMin(b.endTime));
}

const OCCUPYING_STATUSES = new Set(['Pending', 'Confirmed', 'CheckedIn']);

function activeBookingsForDay(date, excludeBookingId = null) {
  const merged = new Map();
  for (const booking of bookingRepo.findBy((item) => item.date === date && OCCUPYING_STATUSES.has(item.status))) merged.set(booking.id, booking);
  if (apiClient.isOnline()) {
    for (const booking of apiClient.getOccupiedSlots()) {
      if (booking.date === date && OCCUPYING_STATUSES.has(booking.status)) merged.set(booking.id, booking);
    }
  }
  merged.delete(excludeBookingId);
  return [...merged.values()];
}

function overlappingBookings(bookings, startMin, endMin) {
  return bookings.filter((booking) => startMin < timeToMin(booking.endTime) && endMin > timeToMin(booking.startTime));
}

function availableRoomNumber(bookings, startMin, endMin, roomCount) {
  const capacity = Number(roomCount ?? 0);
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 100) return null;
  if (capacity <= 0) return null;
  const used = new Set();
  let unassignedCount = 0;
  for (const booking of overlappingBookings(bookings, startMin, endMin)) {
    const roomNumber = Number(booking.roomNumber);
    if (Number.isInteger(roomNumber) && roomNumber >= 1 && roomNumber <= capacity) used.add(roomNumber);
    else unassignedCount += 1;
  }
  // Older bookings may not have a room assigned. Reserve a free room for each
  // overlapping legacy booking before allocating the new booking.
  for (let i = 0; i < unassignedCount; i += 1) {
    const roomNumber = Array.from({ length: capacity }, (_, index) => index + 1).find((room) => !used.has(room));
    if (!roomNumber) return null;
    used.add(roomNumber);
  }
  return Array.from({ length: capacity }, (_, index) => index + 1).find((room) => !used.has(room)) || null;
}

function transitionBooking(id, newStatus, reason = '') {
  const booking = bookingRepo.getById(id);
  if (!booking) throw new AppError('NOT_FOUND', 'Không tìm thấy lịch hẹn.');
  if (booking.status === newStatus) return booking;
  if (booking.status === 'Completed' || booking.status === 'Cancelled') {
    throw new AppError('STATUS_INVALID', booking.status === 'Completed'
      ? 'Lịch hẹn đã hoàn thành, không thể thay đổi trạng thái.'
      : 'Lịch hẹn đã bị hủy, không thể kích hoạt lại.');
  }

  const validTransitions = { Pending: ['Confirmed', 'Cancelled'], Confirmed: ['CheckedIn', 'Completed', 'Cancelled', 'NoShow'], CheckedIn: ['Completed'], Completed: [], Cancelled: [], NoShow: [] };
  if (!validTransitions[booking.status]?.includes(newStatus)) {
    throw new AppError('STATUS_INVALID', `Không thể chuyển trạng thái từ "${booking.status}" sang "${newStatus}".`);
  }
  const now = new Date().toISOString();
  const updates = {
    status: newStatus,
    statusHistory: [...(booking.statusHistory || []), { status: newStatus, at: now, reason }],
  };
  if (newStatus === 'Cancelled' && reason) {
    updates.cancelReason = reason;
      updates.cancelledAt = now;
  } else if (newStatus === 'Completed') {
    updates.completedAt = now;
  } else if (newStatus === 'CheckedIn') {
    updates.checkedInAt = now;
  } else if (newStatus === 'NoShow') {
    updates.noShowAt = now;
  }
  return bookingRepo.update(id, updates);
}

export const bookingService = {
  /** Danh sách booking được giới hạn theo vai trò phiên hiện tại. */
  list() {
    const actor = authService.getCurrentUser();
    if (actor?.role === 'admin') return bookingRepo.getAll();
    if (actor?.role === 'staff') return bookingRepo.findBy((b) => b.staffId === actor.staffId);
    if (actor?.role === 'customer') return bookingRepo.findBy((b) => b.userId === actor.id);
    return [];
  },

  /** Lấy booking theo ID nếu thuộc phạm vi của phiên hiện tại. */
  get(id) {
    const booking = bookingRepo.getById(id);
    const actor = authService.getCurrentUser();
    if (!booking || !actor) return null;
    if (actor.role === 'admin' || (actor.role === 'staff' && booking.staffId === actor.staffId) ||
        (actor.role === 'customer' && booking.userId === actor.id)) return booking;
    return null;
  },

  /** Lấy booking theo Mã code */
  getByCode: (code) => {
    const list = bookingRepo.findBy((b) => b.code.toUpperCase() === String(code || '').trim().toUpperCase());
    const booking = list[0];
    const actor = authService.getCurrentUser();
    if (!booking || !actor) return null;
    if (actor.role === 'admin' || (actor.role === 'staff' && booking.staffId === actor.staffId) ||
        (actor.role === 'customer' && booking.userId === actor.id)) return booking;
    return null;
  },

  /** Lấy booking theo Khách hàng (userId hoặc SĐT) */
  byCustomer: (userId, phone = null) => {
    const actor = authService.getCurrentUser();
    let rows = [];
    if (actor?.role === 'customer') {
      rows = bookingRepo.findBy((b) => b.userId === actor.id);
    } else if (actor?.role === 'admin' && userId) {
      rows = bookingRepo.findBy((b) => b.userId === userId);
    } else if (!actor && phone) {
      // Guest lookup remains available for the demo flow, scoped to an exact phone match.
      rows = bookingRepo.findBy((b) => b.customerPhone === phone);
    }
    return rows.sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));
  },

  /** Lấy booking theo Nhân viên */
  byStaff: (staffId, date = null) => {
    const actor = authService.getCurrentUser();
    if (!actor || (actor.role !== 'admin' && (actor.role !== 'staff' || actor.staffId !== staffId))) return [];
    return bookingRepo.findBy((b) => {
      if (b.staffId !== staffId) return false;
      if (date && b.date !== date) return false;
      return true;
    }).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  },

  /**
   * Tính danh sách slot khả dụng cho một ngày, nhân viên và thời lượng liệu trình cụ thể.
   * @param {string} date YYYY-MM-DD
   * @param {string} staffId
   * @param {number} durationMinutes
   */
  getAvailableSlots(date, staffId, durationMinutes = 60, excludeBookingId = null) {
    if (!isValidDateStr(date) || date < todayStr() || !Number.isInteger(Number(durationMinutes)) || Number(durationMinutes) <= 0 || Number(durationMinutes) > 480) return [];
    const settings = settingsService.get();
    const staff = staffRepo.getById(staffId);
    if (!staff || staff.active === false) return [];

    const maxAdvanceDays = Number.isInteger(Number(settings.maxAdvanceDays)) && Number(settings.maxAdvanceDays) >= 0 ? Number(settings.maxAdvanceDays) : 60;
    if (date > addDays(todayStr(), maxAdvanceDays)) return [];

    // Kiểm tra ngày nghỉ của Spa
    if ((settings.closedDates || []).includes(date)) return [];

    // Kiểm tra ngày làm việc của nhân viên
    const dayOfWeek = weekday(date);
    if (!(staff.workingDays || []).includes(dayOfWeek)) return [];
    if ((staff.daysOff || []).includes(date)) return [];

    const slotStep = Number(settings.slotStep || 30);
    if (![15, 30, 60].includes(slotStep)) return [];
    const openTime = settings.openTime || '10:00';
    const closeTime = settings.closeTime || '22:15';
    const shiftStart = staff.shiftStart || '10:00';
    const shiftEnd = staff.shiftEnd || '22:00';
    if (![openTime, closeTime, shiftStart, shiftEnd].every(isValidTimeStr)) return [];
    const spaOpenMin = timeToMin(openTime);
    const spaCloseMin = timeToMin(closeTime);
    const staffShiftStart = timeToMin(shiftStart);
    const staffShiftEnd = timeToMin(shiftEnd);

    // Khung giờ hiệu lực phải nằm trong giao thoa giữa giờ Spa & giờ ca làm việc
    const effStart = Math.max(spaOpenMin, staffShiftStart);
    const effEnd = Math.min(spaCloseMin, staffShiftEnd);

    // Lấy các lịch hẹn hiện tại của nhân viên trong ngày này (Pending & Confirmed chiếm slot, Cancelled không)
    const dailyBookings = activeBookingsForDay(date, excludeBookingId);
    const existingBookings = dailyBookings.filter((booking) => booking.staffId === staffId);

    const bNow = businessNow();
    const isToday = date === bNow.date;
    const minLeadTime = 30; // Đặt lịch trước ít nhất 30 phút nếu đặt trong ngày
    const breaks = staffBreaks(staff);

    const slots = [];
    for (let startMin = effStart; startMin + durationMinutes <= effEnd; startMin += slotStep) {
      const endMin = startMin + durationMinutes;
      const lockEndMin = bookingLockEndMinute(startMin, Number(durationMinutes), slotStep);

      // Không cho đặt slot quá khứ nếu là hôm nay
      if (isToday && startMin < bNow.minutes + minLeadTime) {
        continue;
      }

      if (breaks.some((b) => startMin < timeToMin(b.endTime) && endMin > timeToMin(b.startTime))) continue;

      // Khóa cả đến mốc slot tiếp theo, nhưng vẫn lưu giờ kết thúc trị liệu thực tế.
      const hasConflict = existingBookings.some((b) => {
        const bStart = timeToMin(b.startTime);
        const storedDuration = Number(b.duration);
        const actualDuration = Number.isInteger(storedDuration) && storedDuration > 0
          ? storedDuration
          : timeToMin(b.endTime) - bStart;
        const bLockEnd = bookingLockEndMinute(bStart, actualDuration, slotStep);
        return startMin < bLockEnd && lockEndMin > bStart;
      });
      const roomNumber = availableRoomNumber(dailyBookings, startMin, endMin, settings.roomCount);
      const hasRoomConflict = Number(settings.roomCount) > 0 && !roomNumber;

      slots.push({
        time: minToTime(startMin),
        endTime: minToTime(endMin),
        available: !hasConflict && !hasRoomConflict,
        unavailableReason: hasConflict ? 'staff' : hasRoomConflict ? 'room' : null,
        roomNumber
      });
    }

    return slots;
  },

  /**
   * Tính toán giá chính xác và áp dụng mã giảm giá (nếu có).
   */
  calculatePrice({ serviceId, duration, promoCode = null, serviceDate = todayStr() }) {
    const service = serviceRepo.getById(serviceId);
    if (!service || service.active === false) {
      throw new AppError('SERVICE_NOT_FOUND', 'Dịch vụ không tồn tại hoặc đã ngừng hoạt động.');
    }
    if (!isServiceBookable(service, serviceRepo.getAll())) throw new AppError('SERVICE_INVALID', 'Gói trị liệu không còn khả dụng vì thiếu liệu trình thành phần đang hoạt động.');

    const durationMinutes = duration == null || duration === '' ? Number(service.duration) : Number(duration);
    const durationValidation = validate({ duration: durationMinutes }, { duration: schemas.service.duration });
    if (!durationValidation.valid) throw new AppError('INVALID_DURATION', 'Thời lượng liệu trình không hợp lệ.', durationValidation.errors);
    const variants = service.variants || [];
    const matchedVariant = variants.find((v) => Number(v.duration) === durationMinutes);
    if (variants.length && !matchedVariant) throw new AppError('INVALID_DURATION', 'Thời lượng này không có trong các lựa chọn của dịch vụ.');
    const originalPrice = matchedVariant ? Number(matchedVariant.price) : Number(service.price);
    if (!Number.isFinite(originalPrice) || originalPrice <= 0) throw new AppError('INVALID_PRICE', 'Giá dịch vụ không hợp lệ.');

    const coupon = promotionRepo.getAll().find((row) => row.code?.toUpperCase() === String(promoCode || '').trim().toUpperCase());
    return { service, ...calculateDomainPrice({ service, duration: durationMinutes, serviceDate,
      campaigns: apiClient.isOnline() ? apiClient.getHolidaySales() : [], promoCode: promoCode || '', coupon,
      evaluatedAt: clock.now().toISOString() }) };
  },

  /**
   * Tạo lịch hẹn mới với cơ chế Validation & Conflict Check đầy đủ.
   */
  createBooking(payload) {
    if (!payload || typeof payload !== 'object') throw new AppError('VALIDATION', 'Thông tin đặt lịch chưa hợp lệ.');
    const actor = authService.getCurrentUser();
    if (!actor) throw new AppError('UNAUTHORIZED', 'Vui lòng đăng nhập tài khoản trước khi đặt lịch.');
    if (!['customer', 'admin'].includes(actor.role)) throw new AppError('FORBIDDEN', 'Tài khoản hiện tại không có quyền đặt lịch khách.');
    const {
      serviceId, duration, staffId, date, startTime,
      customerName, customerPhone, customerEmail, note,
      promoCode, submissionKey
    } = payload;

    const customerValidation = validate(
      { name: customerName, phone: customerPhone, email: customerEmail, note },
      schemas.customerInfo
    );
    if (!customerValidation.valid) {
      throw new AppError('VALIDATION', 'Vui lòng kiểm tra thông tin liên hệ.', customerValidation.errors);
    }

    // Chống double submit (Idempotency)
    const idempotencyToken = submissionKey || `${customerPhone}_${serviceId}_${date}_${startTime}`;
    if (activeSubmissions.has(idempotencyToken)) {
      throw new AppError('DUPLICATE_SUBMISSION', 'Yêu cầu đặt lịch đang được xử lý, vui lòng không nhấn liên tục.');
    }
    activeSubmissions.add(idempotencyToken);

    if (apiClient.isOnline()) {
      return Promise.resolve()
          .then(() => apiClient.createBooking({ ...payload, submissionKey: idempotencyToken }))
          .then(({ booking, payment }) => {
            if (!bookingRepo.getById(booking.id)) bookingRepo.create(booking);
            return { ...booking, paymentInstructions: payment || null };
          })
          .finally(() => activeSubmissions.delete(idempotencyToken));
    }

    activeSubmissions.delete(idempotencyToken);
    throw new AppError('PAYMENT_SERVER_REQUIRED', 'Không thể tạo lịch thanh toán khi chưa kết nối máy chủ. Vui lòng thử lại sau.');

    try {
      // 2. Validate ngày giờ
      if (!isValidDateStr(date)) throw new AppError('INVALID_DATE', 'Ngày đặt lịch không hợp lệ.');
      if (!isValidTimeStr(startTime)) throw new AppError('INVALID_TIME', 'Giờ đặt lịch không hợp lệ.');
      const today = todayStr();
      if (date < today) throw new AppError('PAST_DATE', 'Không thể đặt lịch trong quá khứ.');
      const settings = settingsService.get();
      const maxAdvanceDays = Number.isInteger(Number(settings.maxAdvanceDays)) && Number(settings.maxAdvanceDays) >= 0 ? Number(settings.maxAdvanceDays) : 60;
      if (date > addDays(today, maxAdvanceDays)) throw new AppError('ADVANCE_LIMIT', `Chỉ có thể đặt lịch trước tối đa ${maxAdvanceDays} ngày.`);

      // 3. Validate Service & Staff
      const service = serviceRepo.getById(serviceId);
      if (!service || service.active === false) throw new AppError('SERVICE_INVALID', 'Dịch vụ không tồn tại hoặc đã ngừng hoạt động.');
      if (!isServiceBookable(service, serviceRepo.getAll())) throw new AppError('SERVICE_INVALID', 'Gói trị liệu không còn khả dụng vì thiếu liệu trình thành phần đang hoạt động.');

      const staff = staffRepo.getById(staffId);
      if (!staff || staff.active === false) throw new AppError('STAFF_INVALID', 'Chuyên viên không khả dụng.');

      if ((settings.closedDates || []).includes(date)) throw new AppError('SPA_CLOSED', 'Spa đóng cửa vào ngày này.');
      if (!(staff.workingDays || []).includes(weekday(date)) || (staff.daysOff || []).includes(date)) {
        throw new AppError('STAFF_UNAVAILABLE', 'Chuyên viên không làm việc vào ngày đã chọn.');
      }

      // Kiểm tra chuyên môn của nhân viên
      if (Array.isArray(staff.specialties) && !staff.specialties.includes(service.category)) {
        throw new AppError('STAFF_UNQUALIFIED', `Chuyên viên ${staff.name} không phụ trách liệu trình này.`);
      }

      const durationMinutes = duration == null || duration === '' ? Number(service.duration) : Number(duration);
      const durationValidation = validate({ duration: durationMinutes }, { duration: schemas.service.duration });
      if (!durationValidation.valid) throw new AppError('INVALID_DURATION', 'Thời lượng liệu trình không hợp lệ.', durationValidation.errors);
      const startMin = timeToMin(startTime);
      const endMin = startMin + durationMinutes;
      if (endMin > 24 * 60) throw new AppError('INVALID_TIME', 'Giờ kết thúc nằm ngoài ngày hợp lệ.');
      const endTime = minToTime(endMin);

      const openTime = settings.openTime || '10:00';
      const closeTime = settings.closeTime || '22:15';
      const shiftStart = staff.shiftStart || '10:00';
      const shiftEnd = staff.shiftEnd || '22:00';
      if (![openTime, closeTime, shiftStart, shiftEnd].every(isValidTimeStr)) throw new AppError('SCHEDULE_INVALID', 'Lịch làm việc hoặc giờ mở cửa chưa hợp lệ.');
      const slotStep = Number(settings.slotStep || 30);
      if (![15, 30, 60].includes(slotStep)) throw new AppError('SCHEDULE_INVALID', 'Bước khung giờ chưa hợp lệ.');
      const effectiveStart = Math.max(timeToMin(openTime), timeToMin(shiftStart));
      const effectiveEnd = Math.min(timeToMin(closeTime), timeToMin(shiftEnd));
      if (startMin < effectiveStart || endMin > effectiveEnd) throw new AppError('OUTSIDE_WORKING_HOURS', 'Khung giờ phải nằm trọn trong giờ mở cửa và ca làm việc của chuyên viên.');
      if ((startMin - effectiveStart) % slotStep !== 0) throw new AppError('INVALID_SLOT', 'Giờ bắt đầu không khớp với bước khung giờ của Spa.');
      if (staffBreaks(staff).some((b) => startMin < timeToMin(b.endTime) && endMin > timeToMin(b.startTime))) {
        throw new AppError('STAFF_BREAK', 'Khung giờ trùng với giờ nghỉ của chuyên viên.');
      }
      if (date === today) {
        const now = businessNow();
        if (startMin < now.minutes + 30) throw new AppError('PAST_TIME', 'Lịch trong ngày phải bắt đầu trước ít nhất 30 phút.');
      }

      // 4. Kiểm tra xung đột lịch (Conflict Detection)
      const existing = activeBookingsForDay(date);
      const staffBookings = existing.filter((booking) => booking.staffId === staffId);
      const lockEndMin = bookingLockEndMinute(startMin, durationMinutes, slotStep);

      const hasConflict = staffBookings.some((b) => {
        const bStart = timeToMin(b.startTime);
        const storedDuration = Number(b.duration);
        const actualDuration = Number.isInteger(storedDuration) && storedDuration > 0
          ? storedDuration
          : timeToMin(b.endTime) - bStart;
        const bLockEnd = bookingLockEndMinute(bStart, actualDuration, slotStep);
        return startMin < bLockEnd && lockEndMin > bStart;
      });

      if (hasConflict) {
        throw new AppError('BOOKING_CONFLICT', 'Chuyên viên bận giờ này. Vui lòng chọn giờ hoặc chuyên viên khác.');
      }

      const roomNumber = availableRoomNumber(existing, startMin, endMin, settings.roomCount);
      if (Number(settings.roomCount) > 0 && !roomNumber) {
        throw new AppError('ROOM_CAPACITY', 'Tất cả phòng đều đã được đặt trong khung giờ này. Vui lòng chọn giờ khác.');
      }

      // 5. Tính giá và Snapshot hóa giá đơn
      const pricing = this.calculatePrice({ serviceId, duration: durationMinutes, promoCode, serviceDate: date });

      // 6. Sinh mã đặt lịch duy nhất
      const existingCodes = bookingRepo.getAll().map((b) => b.code);
      const code = bookingCode(existingCodes);

      // 7. Tạo bản ghi Booking lưu trữ lâu dài
      const newBooking = bookingRepo.create({
        code,
        userId: actor.role === 'customer' ? actor.id : null,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerEmail: (customerEmail || '').trim(),
        note: (note || '').trim(),
        serviceId: service.id,
        serviceName: service.name,
        duration: durationMinutes,
        staffId: staff.id,
        staffName: staff.name,
        roomNumber,
        date,
        startTime,
        endTime,
        status: 'Confirmed', // Đặt lịch thành công tự động vào Confirmed (hoặc Pending)
        promoCode: pricing.promoCode,
        originalPrice: pricing.originalPrice,
        discountAmount: pricing.discountAmount,
        finalPrice: pricing.finalPrice,
        paymentRecords: [],
      });

      // Reserve a promotion use only after the booking is stored. Roll the booking back if the counter write fails.
      if (pricing.promoCode) {
        try {
          const promo = promotionService.check(pricing.promoCode, pricing.originalPrice);
          promotionRepo.update(promo.id, { usedCount: (promo.usedCount || 0) + 1 });
        } catch (err) {
          bookingRepo.remove(newBooking.id);
          throw err;
        }
      }

      return newBooking;
    } finally {
      activeSubmissions.delete(idempotencyToken);
    }
  },

  /**
   * Cập nhật trạng thái Booking theo quy tắc nghiêm ngặt.
   * Pending -> Confirmed -> Completed
   * Pending / Confirmed -> Cancelled
   * Completed & Cancelled là trạng thái cuối, không thể đổi ngược lại.
   */
  updateStatus(id, newStatus, reason = '') {
    if (apiClient.isOnline()) {
      return apiClient.updateBookingStatus(id, newStatus, reason).then(({ booking }) => {
        if (bookingRepo.getById(id)) bookingRepo.update(id, booking);
        else bookingRepo.create(booking);
        return booking;
      });
    }
    const booking = bookingRepo.getById(id);
    if (!booking) throw new AppError('NOT_FOUND', 'Không tìm thấy lịch hẹn.');
    const actor = authService.getCurrentUser();
    const isAdmin = actor?.role === 'admin';
    const isAssignedStaffAction = actor?.role === 'staff' && actor.staffId === booking.staffId && ['CheckedIn', 'Completed', 'NoShow'].includes(newStatus);
    if (!isAdmin && !isAssignedStaffAction) throw new AppError('UNAUTHORIZED', 'Bạn không có quyền cập nhật trạng thái lịch hẹn này.');
    return transitionBooking(id, newStatus, reason);
  },

  /** Ghi nhận tiền cọc, thanh toán hoặc hoàn tiền vào sổ giao dịch của lịch hẹn. */
  recordPayment(id, { type, amount, method, reference = '', note = '' } = {}) {
    if (authService.getCurrentUser()?.role !== 'admin') throw new AppError('UNAUTHORIZED', 'Chỉ quản trị viên mới được ghi nhận thu hoặc hoàn tiền.');
    if (apiClient.isOnline()) {
      return apiClient.recordBookingPayment(id, { type, amount, method, reference, note }).then(({ booking }) => {
        if (bookingRepo.getById(id)) bookingRepo.update(id, booking);
        else bookingRepo.create(booking);
        return booking;
      });
    }
    const booking = bookingRepo.getById(id);
    if (!booking) throw new AppError('NOT_FOUND', 'Không tìm thấy lịch hẹn.');
    const value = Number(amount);
    if (!['deposit', 'payment', 'refund'].includes(type)) throw new AppError('PAYMENT_TYPE_INVALID', 'Chọn loại giao dịch hợp lệ.');
    if (!Number.isSafeInteger(value) || value <= 0) throw new AppError('PAYMENT_AMOUNT_INVALID', 'Số tiền phải là số nguyên dương theo VND.');
    if (!['cash', 'bank', 'momo', 'card', 'other'].includes(method)) throw new AppError('PAYMENT_METHOD_INVALID', 'Chọn phương thức thanh toán hợp lệ.');
    const records = Array.isArray(booking.paymentRecords) ? booking.paymentRecords : [];
    const collected = records.filter((record) => record.type !== 'refund').reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const refunded = records.filter((record) => record.type === 'refund').reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const outstanding = Number(booking.finalPrice || 0) - (collected - refunded);
    if (type === 'refund' && value > collected - refunded) throw new AppError('REFUND_EXCEEDS_PAID', 'Số hoàn không được vượt quá tiền đã thu còn lại.');
    if (type !== 'refund' && value > outstanding) throw new AppError('PAYMENT_EXCEEDS_TOTAL', 'Số thu vượt quá số tiền khách còn phải trả.');
    const actor = authService.getCurrentUser();
    const entry = {
      id: globalThis.crypto?.randomUUID?.() || `pay_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type, amount: value, method,
      reference: String(reference || '').trim().slice(0, 120),
      note: String(note || '').trim().slice(0, 300),
      at: new Date().toISOString(), recordedBy: actor?.id || null,
    };
    return bookingRepo.update(id, { paymentRecords: [...records, entry] });
  },

  /**
   * Hủy lịch từ phía khách hàng (tuân thủ cancelBeforeHours của Spa).
   */
  cancelByCustomer(id, userOrPhone, refundRecipient = null) {
    if (apiClient.isOnline()) {
      const phone = typeof userOrPhone === 'string' ? userOrPhone : userOrPhone?.phone || '';
      return apiClient.cancelBooking(id, phone, refundRecipient).then(({ booking }) => {
        if (bookingRepo.getById(id)) bookingRepo.update(id, booking);
        else bookingRepo.create(booking);
        return booking;
      });
    }
    const booking = bookingRepo.getById(id);
    if (!booking) throw new AppError('NOT_FOUND', 'Không tìm thấy lịch hẹn.');

    // Kiểm tra quyền sở hữu lịch hẹn
    const actor = authService.getCurrentUser();
    const isAdmin = actor?.role === 'admin';
    const isOwner = actor?.role === 'customer' && booking.userId === actor.id;
    const isGuestPhoneMatch = !actor && typeof userOrPhone === 'string' && booking.customerPhone === userOrPhone;
    if (!isAdmin && !isOwner && !isGuestPhoneMatch) {
      throw new AppError('UNAUTHORIZED', 'Bạn không có quyền hủy lịch hẹn này.');
    }

    const settings = settingsService.get();
    const configuredNotice = Number(settings.cancelBeforeHours);
    const cancelLimitHours = Number.isFinite(configuredNotice) && configuredNotice >= 0 ? configuredNotice : 2;

    const bNow = businessNow();
    const bookingStartMin = timeToMin(booking.startTime);
    const isToday = booking.date === bNow.date;

    if (booking.date < bNow.date || (isToday && bookingStartMin - bNow.minutes < cancelLimitHours * 60)) {
      throw new AppError('CANCEL_TOO_LATE', `Chính sách Spa: Chỉ được hủy trước giờ hẹn tối thiểu ${cancelLimitHours} tiếng. Vui lòng gọi Hotline để được hỗ trợ.`);
    }

    return transitionBooking(id, 'Cancelled', 'Khách hàng yêu cầu hủy lịch trên giao diện.');
  },

  /** Dời lịch giữ nguyên mã đặt chỗ, chỉ áp dụng trước hạn hủy của Spa. */
  rescheduleByCustomer(id, { quoteId }, userOrPhone) {
    if (!quoteId) throw new AppError('QUOTE_REQUIRED', 'Cần xem và xác nhận báo giá trước khi dời lịch.');
    if (apiClient.isOnline()) {
      const phone = typeof userOrPhone === 'string' ? userOrPhone : userOrPhone?.phone || '';
      return apiClient.confirmReschedule(id, quoteId, phone).then(({ booking }) => {
        if (bookingRepo.getById(id)) bookingRepo.update(id, booking);
        else bookingRepo.create(booking);
        return booking;
      });
    }
    throw new AppError('BACKEND_REQUIRED', 'Cần kết nối máy chủ để xác nhận giá và dời lịch.');
  }
};

function absoluteBookingMinutes(date, time) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 60000) + timeToMin(time);
}
