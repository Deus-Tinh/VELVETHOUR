/**
 * Seed dữ liệu demo.
 * - seedIfNeeded(): chỉ nạp collection còn THIẾU trong storage → không bao giờ ghi đè dữ liệu đã chỉnh sửa.
 * - resetDemoData(): xóa toàn bộ namespace rồi nạp lại (hành động có chủ đích, có xác nhận ở UI).
 * Booking mẫu được tạo theo ngày tương đối so với hôm nay để dashboard luôn có số liệu.
 */
import { hasKey, clearAll } from '../core/storage.js';
import { hashPassword } from '../core/hash.js';
import { todayStr, addDays, minToTime, timeToMin } from '../core/utils.js';
import { repos } from './repositories.js';
import { SERVICES_SEED } from './servicesSeed.js';

const SEED_USERS = [ // Synthetic demo users only; never store real account data here.
  { id: 'usr_admin', name: "Demo Admin", email: "admin@example.invalid", phone: "", role: 'admin' },
  { id: 'usr_staff1', name: "Demo Staff 1", email: "linh@example.invalid", phone: "", role: 'staff', staffId: 'st-01' },
  { id: 'usr_staff2', name: "Demo Staff 2", email: "trang@example.invalid", phone: "", role: 'staff', staffId: 'st-02' },
  { id: 'usr_cust1', name: "Demo Customer 1", email: "khach@example.invalid", phone: "", role: 'customer' },
  { id: 'usr_cust2', name: "Demo Customer 2", email: "bao@example.invalid", phone: "", role: 'customer' },
];

const CATEGORIES = [
  { id: 'body-massages', name: 'Body Massages', active: true },
  { id: 'focus-therapy', name: 'Focus Therapy', active: true },
  { id: 'hair-spa', name: 'Hair Spa', active: true },
  { id: 'packages', name: 'Combo Packages', active: true },
];

const ALL_CATS = CATEGORIES.map((c) => c.id);
const STAFF = [
  { id: 'st-01', name: 'Mai Linh', title: 'Senior Therapist • 7 năm kinh nghiệm', imageId: 'staff-01', specialties: ALL_CATS, workingDays: [0, 1, 2, 3, 4, 5, 6], shiftStart: '10:00', shiftEnd: '22:00', daysOff: [], active: true },
  { id: 'st-02', name: 'Thu Trang', title: 'Skin & Facial Specialist • Chăm sóc da', imageId: 'staff-02', specialties: ['focus-therapy', 'hair-spa', 'packages'], workingDays: [1, 2, 3, 4, 5, 6], shiftStart: '10:00', shiftEnd: '20:00', daysOff: [], active: true },
  { id: 'st-03', name: 'Khánh Vy', title: 'Aroma & Hair Spa Master • Dưỡng sinh', imageId: 'staff-03', specialties: ['body-massages', 'hair-spa', 'packages'], workingDays: [0, 2, 3, 4, 5, 6], shiftStart: '12:00', shiftEnd: '22:00', daysOff: [], active: true },
  { id: 'st-04', name: 'Hoàng Nam', title: 'Shiatsu & Deep Tissue Specialist', imageId: 'staff-04', specialties: ['body-massages', 'focus-therapy'], workingDays: [0, 1, 2, 3, 4, 5, 6], shiftStart: '10:00', shiftEnd: '22:00', daysOff: [], active: true },
];

const PROMOTIONS = [
  { id: 'pro_siz10', code: 'SERENITY10', type: 'percent', value: 10, minOrder: 300000, maxDiscount: 150000, expiresAt: '2030-12-31', usageLimit: 1000, usedCount: 0, active: true, description: 'Giảm 10% (tối đa 150.000₫) cho đơn từ 300.000₫' },
  { id: 'pro_vip20', code: 'VIP20', type: 'percent', value: 20, minOrder: 800000, maxDiscount: 400000, expiresAt: '2030-12-31', usageLimit: 500, usedCount: 0, active: true, description: 'Giảm 20% (tối đa 400.000₫) cho đơn từ 800.000₫' },
  { id: 'pro_welcome', code: 'WELCOME50K', type: 'fixed', value: 50000, minOrder: 200000, maxDiscount: 50000, expiresAt: '2030-12-31', usageLimit: 1000, usedCount: 0, active: true, description: 'Giảm 50.000₫ cho khách mới' },
  { id: 'pro_old', code: 'TET2020', type: 'percent', value: 15, minOrder: 0, maxDiscount: 200000, expiresAt: '2020-02-01', usageLimit: 100, usedCount: 100, active: false, description: 'Mã đã hết hạn (dùng để demo kiểm tra)' },
];

const SETTINGS = [{
  id: 'main', spaName: 'Serenity Spa & Wellness', phone: '', email: '',
  address: '285B Đường Hoàng Sa, Phường Tân Định, Quận 1, TP. Hồ Chí Minh',
  openTime: '10:00', closeTime: '22:15', slotStep: 30, closedDates: [], cancelBeforeHours: 2, maxAdvanceDays: 60,
}];

/** Booking mẫu: [offsetDays, start, serviceId, staffId, status, userId, promo] */
const BOOKING_PLAN = [
  [-12, '14:00', 'signature-body', 'st-01', 'Completed', 'usr_cust1'],
  [-9, '11:00', 'aroma-therapy', 'st-03', 'Completed', 'usr_cust1'],
  [-6, '16:00', 'signature-body', 'st-04', 'Completed', 'usr_cust2', 'SERENITY10'],
  [-3, '19:00', 'aroma-therapy', 'st-01', 'Cancelled', 'usr_cust2'],
  [0, '15:00', 'signature-body', 'st-01', 'Confirmed', 'usr_cust1'],
  [1, '11:00', 'aroma-therapy', 'st-03', 'Pending', 'usr_cust2'],
  [2, '17:00', 'signature-body', 'st-04', 'Confirmed', 'usr_cust1'],
];

function buildServices() {
  return SERVICES_SEED.map((s, i) => {
    const { categoryName: _drop, ...rest } = s;
    return { ...rest, active: true, createdAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() };
  });
}

function randomSeedSecret() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}-${Math.random()}`;
}

function buildUsers(accountPasswords = {}) {
  return SEED_USERS.map((u) => {
    const salt = randomSeedSecret();
    const password = accountPasswords[u.email] || randomSeedSecret();
    return { ...u, salt, passwordHash: hashPassword(password, salt), active: true, createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString() };
  });
}

function buildBookings(services, staff) {
  const today = todayStr();
  const users = buildUsers();
  const codes = [];
  return BOOKING_PLAN.flatMap(([offset, start, serviceId, staffId, status, userId, promoCode], i) => {
    const svc = services.find((s) => s.id === serviceId);
    const st = staff.find((s) => s.id === staffId);
    const user = users.find((u) => u.id === userId);
    if (!svc || !st || !user) return [];
    const promo = promoCode ? PROMOTIONS.find((p) => p.code === promoCode) : null;
    const original = svc.price;
    const discount = promo ? Math.min(Math.floor((original * promo.value) / 100), promo.maxDiscount) : 0;
    const date = addDays(today, offset);
    const code = `SER-DEMO-${String(i + 1).padStart(4, '0')}`;
    codes.push(code);
    return [{
      id: `bk_demo${i + 1}`, code, userId, customerName: user.name, customerPhone: user.phone, customerEmail: user.email, note: '',
      serviceId, serviceName: svc.name, duration: svc.duration, staffId, staffName: st.name,
      date, startTime: start, endTime: minToTime(timeToMin(start) + svc.duration),
      status, promoCode: promoCode || null, originalPrice: original, discountAmount: discount, finalPrice: original - discount,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }];
  });
}

function buildReviews() {
  return [
    { id: 'rev_demo1', bookingId: 'bk_demo1', serviceId: 'signature-body', userId: 'usr_cust1', userName: 'Nguyễn Minh Anh', rating: 5, comment: 'Chuyên viên rất chuyên nghiệp, không gian yên tĩnh.', status: 'visible' },
  ];
}

const BUILDERS = ({ includeDemoData = true, accountPasswords = {} } = {}) => {
  const services = buildServices();
  return {
    categories: () => CATEGORIES,
    services: () => services,
    staff: () => includeDemoData ? STAFF : [],
    users: () => includeDemoData ? buildUsers(accountPasswords) : [],
    promotions: () => includeDemoData ? PROMOTIONS : [],
    settings: () => SETTINGS,
    bookings: () => includeDemoData ? buildBookings(services, STAFF) : [],
    reviews: () => includeDemoData ? buildReviews() : [],
    favorites: () => includeDemoData ? [{ id: 'fav_demo1', userId: 'usr_cust1', serviceId: 'signature-body' }] : [],
    contacts: () => includeDemoData ? [{ id: 'ct_demo1', name: 'Lê Thị Hoa', phone: '0901234567', email: 'hoa@example.com', subject: 'Hỏi về gói couple', message: 'Spa có gói massage cho 2 người không ạ?', status: 'new' }] : [],
  };
};

/** Nạp các collection chưa tồn tại. Trả về danh sách collection vừa seed. */
export function seedIfNeeded(options = {}) {
  const builders = BUILDERS(options);
  const seeded = [];
  Object.entries(builders).forEach(([name, build]) => {
    if (!hasKey(name)) { repos[name].replaceAll(build()); seeded.push(name); }
  });

  // Update only the exact sample values from the previous demo seed; preserve owner-edited settings.
  const settings = repos.settings.getById('main');
  if (settings) {
    const updates = {};
    if (settings.address === '154 Đường Cống Quỳnh, Phường Phạm Ngũ Lão, Quận 1, TP. Hồ Chí Minh') {
      updates.address = '285B Đường Hoàng Sa, Phường Tân Định, Quận 1, TP. Hồ Chí Minh';
    }
    if (settings.phone === '0775271878') updates.phone = '';
    if (settings.email === 'siz.spa@gmail.com') updates.email = '';
    if (Object.keys(updates).length) repos.settings.update('main', updates);
  }

  const admin = repos.users.getById('usr_admin');
  if (admin?.phone === '0775271878') repos.users.update('usr_admin', { phone: '' });

  const legacyPromo = repos.promotions.getById('pro_siz10');
  if (legacyPromo?.code === 'SIZ10') repos.promotions.update('pro_siz10', { code: 'SERENITY10' });

  repos.bookings.getAll().forEach((booking) => {
    const updates = {};
    if (/^SIZ-DEMO-\d{4}$/.test(booking.code)) updates.code = booking.code.replace(/^SIZ-DEMO-/, 'SER-DEMO-');
    if (booking.promoCode === 'SIZ10') updates.promoCode = 'SERENITY10';
    if (Object.keys(updates).length) repos.bookings.update(booking.id, updates);
  });
  return seeded;
}

/** Xóa sạch dữ liệu namespace của ứng dụng và nạp lại dữ liệu demo. */
export function resetDemoData(options = {}) {
  clearAll();
  return seedIfNeeded(options);
}
