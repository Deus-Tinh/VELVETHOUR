/**
 * Favorites, Reviews, Contacts và Analytics Service.
 * - Review chỉ cho phép nếu Booking có trạng thái Completed và chưa từng review.
 * - Khi có review mới, tự động tính lại rating trung bình cho Service tương ứng.
 * - Analytics tính toán doanh thu thuần từ các booking có status === 'Completed'.
 */
import { favoriteRepo, reviewRepo, contactRepo, bookingRepo, serviceRepo, userRepo, staffRepo } from '../data/repositories.js';
import { AppError } from '../core/errors.js';
import { validate, schemas } from '../core/validators.js';
import { todayStr, addDays } from '../core/utils.js';
import { authService } from './authService.js';
import { apiClient } from './apiClient.js';

function requireAdmin() {
  if (authService.getCurrentUser()?.role !== 'admin') throw new AppError('UNAUTHORIZED', 'Chỉ quản trị viên mới được quản lý dữ liệu này.');
}

/* ---------------- FAVORITES ---------------- */
export const favoriteService = {
  list(userId) {
    const actor = authService.getCurrentUser();
    if (!actor || actor.role !== 'customer' || actor.id !== userId) return [];
    const favs = favoriteRepo.findBy((f) => f.userId === userId);
    return favs.map((f) => {
      const svc = serviceRepo.getById(f.serviceId);
      return { ...f, service: svc };
    }).filter((f) => f.service != null);
  },

  isFavorite(userId, serviceId) {
    const actor = authService.getCurrentUser();
    if (!actor || actor.role !== 'customer' || actor.id !== userId) return false;
    return favoriteRepo.findBy((f) => f.userId === userId && f.serviceId === serviceId).length > 0;
  },

  toggle(userId, serviceId) {
    const actor = authService.getCurrentUser();
    if (!actor || actor.role !== 'customer' || actor.id !== userId) throw new AppError('AUTH_REQUIRED', 'Vui lòng đăng nhập bằng tài khoản khách hàng để lưu liệu trình yêu thích.');
    const service = serviceRepo.getById(serviceId);
    if (!service || service.active === false) throw new AppError('SERVICE_NOT_FOUND', 'Dịch vụ không tồn tại hoặc đã ngừng hoạt động.');
    const existing = favoriteRepo.findBy((f) => f.userId === userId && f.serviceId === serviceId);
    if (apiClient.isOnline()) {
      return apiClient.toggleFavorite(serviceId).then(({ favorited }) => {
        if (favorited && !existing.length) favoriteRepo.create({ userId, serviceId });
        if (!favorited && existing.length) favoriteRepo.remove(existing[0].id);
        return { favorited };
      });
    }
    if (existing.length) {
      favoriteRepo.remove(existing[0].id);
      return { favorited: false };
    }
    favoriteRepo.create({ userId, serviceId });
    return { favorited: true };
  }
};

/* ---------------- REVIEWS ---------------- */
export const reviewService = {
  listByService(serviceId) {
    return reviewRepo.findBy((r) => r.serviceId === serviceId && r.status !== 'hidden')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  canReview(bookingId, userId) {
    const booking = bookingRepo.getById(bookingId);
    if (!booking) return { allowed: false, reason: 'Không tìm thấy lịch hẹn' };
    if (booking.status !== 'Completed') return { allowed: false, reason: 'Chỉ có thể đánh giá sau khi hoàn thành buổi trị liệu' };
    const actor = authService.getCurrentUser();
    if (!actor || actor.role !== 'customer' || booking.userId !== actor.id || (userId && userId !== actor.id)) {
      return { allowed: false, reason: 'Lịch hẹn không thuộc tài khoản khách hàng đang đăng nhập' };
    }
    const reviewed = reviewRepo.findBy((r) => r.bookingId === bookingId);
    if (reviewed.length) return { allowed: false, reason: 'Bạn đã đánh giá lịch hẹn này rồi' };
    return { allowed: true, booking };
  },

  createReview({ bookingId, rating, comment }, currentUser = null) {
    const actor = authService.getCurrentUser();
    const check = this.canReview(bookingId, actor?.id);
    if (!check.allowed) throw new AppError('REVIEW_NOT_ALLOWED', check.reason);

    const booking = check.booking;
    const { valid, errors } = validate({ rating, comment }, schemas.review);
    if (!valid) throw new AppError('VALIDATION', 'Đánh giá chưa hợp lệ', errors);

    const reviewData = {
      bookingId,
      serviceId: booking.serviceId,
      userId: actor.id,
      userName: actor.name,
      rating: Number(rating),
      comment: (comment || '').trim(),
      status: 'visible'
    };

    if (apiClient.isOnline()) {
      return apiClient.createReview(reviewData).then(({ review, service: updatedService }) => {
        const newRev = reviewRepo.create(review);
        if (updatedService && serviceRepo.getById(updatedService.id)) serviceRepo.update(updatedService.id, updatedService);
        return newRev;
      });
    }

    const newRev = reviewRepo.create(reviewData);

    // Keep the seed's aggregate rating/count and fold this new rating into it.
    const service = serviceRepo.getById(booking.serviceId);
    const previousCount = Math.max(0, Number(service?.reviewsCount) || 0);
    const previousRating = Math.max(0, Number(service?.rating) || 0);
    const nextCount = previousCount + 1;
    const nextRating = previousCount
      ? (previousRating * previousCount + Number(rating)) / nextCount
      : Number(rating);
    serviceRepo.update(booking.serviceId, {
      rating: Number(nextRating.toFixed(1)),
      reviewsCount: nextCount
    });

    return newRev;
  }
};

/* ---------------- CONTACTS ---------------- */
export const contactService = {
  list() {
    requireAdmin();
    return contactRepo.getAll().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  },

  create(data) {
    const { valid, errors } = validate(data, schemas.contact);
    if (!valid) throw new AppError('VALIDATION', 'Vui lòng kiểm tra lại thông tin liên hệ.', errors);

    const record = {
      name: data.name.trim(),
      phone: data.phone.trim(),
      email: (data.email || '').trim(),
      subject: (data.subject || 'Tư vấn liệu trình').trim(),
      message: data.message.trim(),
      status: 'new'
    };
    if (apiClient.isOnline()) {
      return apiClient.createContact(record).then(({ contact }) => contactRepo.create(contact));
    }
    return contactRepo.create(record);
  },

  updateStatus(id, status) {
    requireAdmin();
    if (!contactRepo.getById(id)) throw new AppError('NOT_FOUND', 'Liên hệ không tồn tại.');
    if (apiClient.isOnline()) {
      return apiClient.updateContactStatus(id, status).then(({ contact }) => {
        contactRepo.update(id, contact);
        return contact;
      });
    }
    return contactRepo.update(id, { status });
  }
};

/* ---------------- ANALYTICS ---------------- */
export const analyticsService = {
  getDashboardKPIs() {
    requireAdmin();
    const allBookings = bookingRepo.getAll();
    const allServices = serviceRepo.getAll();
    const allStaff = staffRepo.getAll();
    const allUsers = userRepo.getAll();

    const today = todayStr();

    const statusCounts = {
      total: allBookings.length,
      pending: allBookings.filter((b) => b.status === 'Pending').length,
      confirmed: allBookings.filter((b) => b.status === 'Confirmed').length,
      completed: allBookings.filter((b) => b.status === 'Completed').length,
      cancelled: allBookings.filter((b) => b.status === 'Cancelled').length,
      today: allBookings.filter((b) => b.date === today).length
    };

    // DOANH THU: Chỉ tính trên các booking có trạng thái 'Completed'
    const totalRevenue = allBookings
      .filter((b) => b.status === 'Completed')
      .reduce((sum, b) => sum + (Number(b.finalPrice) || 0), 0);

    // Dịch vụ phổ biến (sắp xếp theo số lượng đặt)
    const serviceCounts = {};
    allBookings.filter((b) => ['Confirmed', 'Completed'].includes(b.status)).forEach((b) => {
      serviceCounts[b.serviceId] = (serviceCounts[b.serviceId] || 0) + 1;
    });

    const popularServices = Object.entries(serviceCounts)
      .map(([id, count]) => {
        const s = allServices.find((item) => item.id === id);
        return { id, name: s ? s.name : id, count, price: s ? s.price : 0 };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Dữ liệu biểu đồ 7 ngày gần nhất (doanh thu & số lượng lịch)
    const dailyStats = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i);
      const dayBookings = allBookings.filter((b) => b.date === d);
      const completedBookings = dayBookings.filter((b) => b.status === 'Completed');
      const dayRev = completedBookings.reduce((sum, b) => sum + (Number(b.finalPrice) || 0), 0);

      dailyStats.push({
        date: d,
        label: d.slice(5),
        count: dayBookings.length,
        revenue: dayRev
      });
    }

    return {
      totalServices: allServices.length,
      activeServices: allServices.filter((s) => s.active !== false).length,
      totalCustomers: allUsers.filter((u) => u.role === 'customer').length,
      totalStaff: allStaff.filter((s) => s.active !== false).length,
      bookings: statusCounts,
      revenue: totalRevenue,
      popularServices,
      dailyStats
    };
  },

  getFinancialReport({ from = '', to = '' } = {}) {
    requireAdmin();
    const allBookings = bookingRepo.getAll();
    const byId = new Map(allBookings.map((booking) => [booking.id, booking]));
    const events = [];
    for (const booking of allBookings) {
      for (const entry of Array.isArray(booking.paymentRecords) ? booking.paymentRecords : []) {
        const timestamp = Date.parse(entry.at || '');
        if (!Number.isFinite(timestamp) || !Number.isSafeInteger(Number(entry.amount)) || Number(entry.amount) <= 0) continue;
        const dateParts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(new Date(timestamp));
        const date = `${dateParts.find((part) => part.type === 'year').value}-${dateParts.find((part) => part.type === 'month').value}-${dateParts.find((part) => part.type === 'day').value}`;
        if ((from && date < from) || (to && date > to)) continue;
        events.push({
          bookingId: booking.id, bookingCode: booking.code, date,
          serviceId: booking.serviceId, serviceName: booking.serviceName || booking.serviceId,
          staffId: booking.staffId, staffName: booking.staffName || booking.staffId,
          type: entry.type === 'refund' ? 'refund' : entry.refundable === false ? 'unmatched_payment' : entry.type === 'deposit' ? 'deposit' : 'payment',
          amount: Number(entry.amount), method: entry.method || 'other', at: entry.at,
        });
      }
    }
    const summarize = (keyFor, nameFor) => {
      const groups = new Map();
      for (const event of events) {
        const key = keyFor(event);
        const group = groups.get(key) || { key, name: nameFor(event), collected: 0, refunded: 0, transactions: 0 };
        if (event.type === 'refund') group.refunded += event.amount;
        else group.collected += event.amount;
        group.transactions += 1;
        groups.set(key, group);
      }
      return [...groups.values()].map((group) => ({ ...group, net: group.collected - group.refunded }))
        .sort((a, b) => b.net - a.net);
    };
    const collected = events.filter((event) => event.type !== 'refund').reduce((sum, event) => sum + event.amount, 0);
    const deposits = events.filter((event) => event.type === 'deposit').reduce((sum, event) => sum + event.amount, 0);
    const refunded = events.filter((event) => event.type === 'refund').reduce((sum, event) => sum + event.amount, 0);
    const outstanding = allBookings.filter((booking) => (!from || booking.date >= from) && (!to || booking.date <= to) && !['Cancelled', 'NoShow'].includes(booking.status))
      .reduce((sum, booking) => {
        const records = Array.isArray(booking.paymentRecords) ? booking.paymentRecords : [];
        const paid = records.filter((entry) => entry.type !== 'refund').reduce((subtotal, entry) => subtotal + (Number(entry.amount) || 0), 0);
        const refunds = records.filter((entry) => entry.type === 'refund').reduce((subtotal, entry) => subtotal + (Number(entry.amount) || 0), 0);
        return sum + Math.max(0, Number(booking.finalPrice || 0) - paid + refunds);
      }, 0);
    return {
      from, to, collected, deposits, refunded, net: collected - refunded, outstanding, transactions: events.length,
      byDate: summarize((event) => event.date, (event) => event.date).sort((a, b) => b.key.localeCompare(a.key)),
      byService: summarize((event) => event.serviceId, (event) => event.serviceName),
      byStaff: summarize((event) => event.staffId, (event) => event.staffName),
      events: events.sort((a, b) => b.at.localeCompare(a.at)).map((event) => ({ ...event, booking: byId.get(event.bookingId) || null })),
    };
  },

  getCustomerHistories() {
    requireAdmin();
    const groups = new Map();
    const normalizePhone = (phone) => String(phone || '').replace(/\D/g, '').replace(/^84/, '0');
    for (const booking of bookingRepo.getAll()) {
      const phone = normalizePhone(booking.customerPhone);
      const key = phone || booking.customerEmail || booking.userId || booking.id;
      const group = groups.get(key) || {
        id: key, name: booking.customerName || 'Khách hàng', phone: booking.customerPhone || '',
        email: booking.customerEmail || '', userId: booking.userId || null, bookings: [],
      };
      group.bookings.push(booking);
      if (booking.date >= group.lastVisitDate || !group.lastVisitDate) {
        group.lastVisitDate = booking.date;
        group.name = booking.customerName || group.name;
      }
      if (!group.phone && booking.customerPhone) group.phone = booking.customerPhone;
      if (!group.email && booking.customerEmail) group.email = booking.customerEmail;
      groups.set(key, group);
    }
    return [...groups.values()].map((customer) => {
      const bookings = customer.bookings.sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`));
      const completedBookings = bookings.filter((booking) => booking.status === 'Completed');
      const paymentRecords = bookings.flatMap((booking) => Array.isArray(booking.paymentRecords) ? booking.paymentRecords : []);
      const collected = paymentRecords.filter((entry) => entry.type !== 'refund').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      const refunded = paymentRecords.filter((entry) => entry.type === 'refund').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      return {
        ...customer, bookings, bookingCount: bookings.length, completedCount: completedBookings.length,
        noShowCount: bookings.filter((booking) => booking.status === 'NoShow').length,
        lastCompletedDate: completedBookings.map((booking) => booking.date).sort().at(-1) || '',
        netPaid: collected - refunded,
      };
    }).sort((a, b) => (b.lastCompletedDate || b.lastVisitDate || '').localeCompare(a.lastCompletedDate || a.lastVisitDate || ''));
  }
};
