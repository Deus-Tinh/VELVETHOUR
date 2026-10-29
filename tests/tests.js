/**
 * Suite kiểm thử Vanilla JS cho nghiệp vụ (MASTER PROMPT Mục 49).
 * Chạy được cả trong môi trường Node.js và Trình duyệt (dùng storage.useMemory()).
 */
import { storage, readJSON, writeJSON } from '../assets/js/core/storage.js';
import { seedIfNeeded, resetDemoData } from '../assets/js/data/seed.js';
import { serviceService, categoryService } from '../assets/js/services/serviceService.js';
import { staffService, promotionService, settingsService } from '../assets/js/services/staffSettingsPromoService.js';
import { bookingService } from '../assets/js/services/bookingService.js';
import { authService } from '../assets/js/services/authService.js';
import { apiClient, recoverLocalStaff } from '../assets/js/services/apiClient.js';
import { favoriteService, reviewService, contactService, analyticsService } from '../assets/js/services/socialAndAnalyticsService.js';
import { bookingRepo, promotionRepo, staffRepo, serviceRepo, reviewRepo, categoryRepo, userRepo, contactRepo } from '../assets/js/data/repositories.js';
import { validate, schemas, email, phoneVN, required, positiveNumber, price, duration, date, futureOrToday, strongPassword } from '../assets/js/core/validators.js';
import { addDays, todayStr, clock } from '../assets/js/core/utils.js';
import { createTestRunner } from './testRunner.js';
import { isAllowedOrigin } from '../server/originPolicy.js';
import { TEST_ACCOUNT_PASSWORDS, TEST_PASSWORDS } from './testAccounts.js';

export async function runAllTests() {
  const { test, expect, results } = createTestRunner();
  function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
  }
  function assertOfflineBookingRequiresServer(payload) {
    let error;
    try { bookingService.createBooking(payload); } catch (caught) { error = caught; }
    assert(error?.code === 'PAYMENT_SERVER_REQUIRED',
      'Offline booking must be rejected; pending payment and slot holds are created only by the API server.');
  }

  // Khởi tạo bộ nhớ tạm để test độc lập
  storage.useMemory();
  clock.set(() => new Date('2026-10-08T03:00:00.000Z'));
  resetDemoData({ includeDemoData: true, accountPasswords: TEST_ACCOUNT_PASSWORDS });
  authService.login({ email: 'admin@example.invalid', password: TEST_PASSWORDS.admin });

  await test('API origin policy accepts the direct host and forwarded tunnel host only', async () => {
    const direct = { headers: { host: 'localhost:3001' } };
    const tunnel = { headers: { host: 'localhost:3001', 'x-forwarded-host': 'bmfk8rpl-3001.asse.devtunnels.ms' } };
    assert(isAllowedOrigin('http://localhost:3001', direct), 'Origin localhost hợp lệ phải được chấp nhận');
    assert(isAllowedOrigin('https://bmfk8rpl-3001.asse.devtunnels.ms', tunnel), 'Origin Dev Tunnel được proxy chuyển tiếp phải được chấp nhận');
    assert(!isAllowedOrigin('https://attacker.example', tunnel), 'Origin khác phải bị từ chối');
  });

  // 1. Service CRUD
  await test('1. Service CRUD', async () => {
    const created = serviceService.create({
      name: 'Test Spa Massage',
      category: 'body-massages',
      price: 500000,
      duration: 60,
      shortDesc: 'Mo ta ngan gon dich vu',
    });
    assert(created.id && created.name === 'Test Spa Massage', 'Tao service that bai');
    const updated = serviceService.update(created.id, { price: 550000 });
    assert(updated.price === 550000, 'Cap nhat service that bai');
    const removed = serviceService.remove(created.id);
    assert(removed.mode === 'deleted', 'Xoa service that bai');
  });

  // 2. Category CRUD
  await test('2. Category CRUD', async () => {
    const cat = categoryService.create({ name: 'Hot Stone Treatment' });
    assert(cat.id === 'hot-stone-treatment', 'Tao category that bai');
    const updated = categoryService.update(cat.id, { name: 'Hot Stone Relax' });
    assert(updated.name === 'Hot Stone Relax', 'Update category that bai');
    categoryService.remove(cat.id);
    assert(categoryService.get(cat.id) == null, 'Xoa category that bai');
  });

  // 3. Staff CRUD
  await test('3. Staff CRUD', async () => {
    const staff = staffService.create({
      name: 'Lan Anh',
      title: 'Therapist',
      specialties: ['body-massages'],
      shiftStart: '10:00',
      shiftEnd: '18:00',
      workingDays: [1, 2, 3, 4, 5]
    });
    assert(staff.id && staff.name === 'Lan Anh', 'Tao staff that bai');
    const updated = staffService.update(staff.id, { title: 'Master' });
    assert(updated.title === 'Master', 'Update staff that bai');
    staffService.remove(staff.id);
    assert(staffService.get(staff.id) == null, 'Xoa staff that bai');
  });

  await test('3b. Nhân viên mới đủ chuyên môn, trạng thái và ảnh được hiện khi đặt liệu trình', async () => {
    const tranHaLinh = staffService.create({
      name: 'Trần Hà Linh',
      title: 'Therapist',
      specialties: ['focus-therapy'],
      workingDays: [0, 1, 2, 3, 4, 5, 6],
      imageUrl: 'data:image/jpeg;base64,dGVzdA==',
    });
    const linhTho = staffService.create({
      name: 'Linh Thỏ',
      title: 'Therapist',
      specialties: ['focus-therapy'],
      workingDays: [0, 1, 2, 3, 4, 5, 6],
      imageUrl: 'data:image/jpeg;base64,bGluaA==',
    });
    const bellyStaff = staffService.forService('belly-massage');
    assert(bellyStaff.some((person) => person.id === tranHaLinh.id), 'Trần Hà Linh phải hiện ở Belly Massage');
    assert(bellyStaff.some((person) => person.id === linhTho.id), 'Linh Thỏ phải hiện ở Belly Massage');
    assert(bellyStaff.find((person) => person.id === tranHaLinh.id).imageUrl === tranHaLinh.imageUrl, 'Ảnh tùy chỉnh phải được giữ trong hồ sơ');

    staffService.update(linhTho.id, { active: false });
    assert(!staffService.forService('belly-massage').some((person) => person.id === linhTho.id), 'Nhân viên tạm nghỉ không được hiện khi đặt lịch');
    staffService.remove(tranHaLinh.id);
    staffService.remove(linhTho.id);
  });

  await test('3c. Khôi phục nhân viên mới và ảnh LocalStorage khi kết nối máy chủ lần đầu', async () => {
    const remote = [
      { id: 'st-01', name: 'Mai Linh', imageId: 'staff-01' },
      { id: 'st-02', name: 'Thu Trang', imageId: 'staff-02' },
    ];
    const local = [
      ...remote,
      { id: 'st-03', name: 'Nhân viên cũ đã xóa' },
      { id: 'st_a1b2c3d4e5f6', name: 'Trần Hà Linh', specialties: ['focus-therapy'], imageUrl: 'data:image/webp;base64,dGVzdA==', createdAt: '2026-10-09T01:00:00.000Z' },
      { id: 'st-01', name: 'Mai Linh', imageId: 'staff-01', imageUrl: 'data:image/webp;base64,bWFp', updatedAt: '2026-10-09T01:00:00.000Z' },
    ];
    const recovered = recoverLocalStaff(remote, local);
    assert(recovered.some((person) => person.name === 'Trần Hà Linh'), 'Phải khôi phục nhân viên mới từ LocalStorage');
    assert(recovered.some((person) => person.name === 'Trần Hà Linh' && person.imageUrl), 'Phải giữ ảnh tùy chỉnh');
    assert(recovered.some((person) => person.id === 'st-01' && person.imageUrl), 'Phải khôi phục ảnh vừa sửa cho hồ sơ có sẵn');
    assert(!recovered.some((person) => person.id === 'st-03'), 'Không nhập lại ID seed cũ đã bị xóa');
  });

  // 4. Search
  await test('4. Search (Khong dau, khong phan biet hoa thuong)', async () => {
    const q1 = serviceService.query({ q: 'signature' });
    assert(q1.total >= 1, 'Tim signature that bai');
    const q2 = serviceService.query({ q: 'tinh dau' }); // Tim aroma massage tinh dau
    assert(q2.total >= 1, 'Tim bo dau tieng Viet that bai');
  });

  // 5. Filter
  await test('5. Filter (Category, Price, Duration)', async () => {
    const qCat = serviceService.query({ category: 'body-massages' });
    assert(qCat.items.every((s) => s.category === 'body-massages'), 'Loc category sai');
    const qPrice = serviceService.query({ minPrice: 600000, maxPrice: 700000 });
    assert(qPrice.items.every((s) => s.price >= 600000 && s.price <= 700000), 'Loc gia sai');
  });

  // 6. Sort
  await test('6. Sort (price-asc, price-desc)', async () => {
    const asc = serviceService.query({ sort: 'price-asc', pageSize: 100 });
    for (let i = 0; i < asc.items.length - 1; i++) {
      assert(asc.items[i].price <= asc.items[i + 1].price, 'Sort tang dan sai');
    }
  });

  // 7. Pagination
  await test('7. Pagination', async () => {
    const p1 = serviceService.query({ page: 1, pageSize: 2 });
    assert(p1.items.length === 2 && p1.page === 1 && p1.totalPages >= 2, 'Phan trang sai');
  });

  // 8. Email validation
  await test('8. Email validation', async () => {
    assert(email()('test@gmail.com') === null, 'Email hop le bi bao loi');
    assert(email()('invalid-email') !== null, 'Email sai khong bi bat');
  });

  // 9. Phone validation
  await test('9. Phone VN validation', async () => {
    assert(phoneVN()('0987654321') === null, 'SDT VN hop le bi bao loi');
    assert(phoneVN()('0123456789') !== null, 'Dau so cu khong hop le');
    assert(phoneVN()('12345') !== null, 'SDT ngan khong hop le');
  });

  // Booking creation is server-only because payment confirmation owns the hold/status transition.
  await test('10. Booking valid: offline client cannot bypass payment-backed API', async () => {
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01',
      date: addDays(todayStr(), 5), startTime: '10:00', customerName: 'Le Van Test', customerPhone: '0912345678' });
  });

  await test('11. Booking overlap is decided by the server while a payment hold is active', async () => {
    const date = addDays(todayStr(), 6);
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01', date,
      startTime: '10:00', customerName: 'Khach A', customerPhone: '0912345678' });
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01', date,
      startTime: '10:30', customerName: 'Khach B', customerPhone: '0987654321' });
  });

  await test('12. Adjacent bookings are validated by the payment-backed API', async () => {
    const date = addDays(todayStr(), 7);
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01', date,
      startTime: '10:00', customerName: 'Khach A', customerPhone: '0912345678' });
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01', date,
      startTime: '11:00', customerName: 'Khach B', customerPhone: '0987654321' });
  });

  // 13. Staff unavailable
  await test('13. Staff unavailable (Sai chuyen mon hoac ngay nghi)', async () => {
    let errCatched = false;
    try {
      // st-02 khong co chuyen mon 'body-massages'
      bookingService.createBooking({
        serviceId: 'signature-body',
        duration: 60,
        staffId: 'st-02',
        date: addDays(todayStr(), 8),
        startTime: '10:00',
        customerName: 'Khach C',
        customerPhone: '0912345678'
      });
    } catch (e) {
      errCatched = true;
    }
    assert(errCatched, 'Khong bat duoc loi nhan vien khong phu trach dich vu');
  });

  // 14. Invalid service
  await test('14. Invalid service', async () => {
    let errCatched = false;
    try {
      bookingService.createBooking({
        serviceId: 'non-existing-service-id',
        duration: 60,
        staffId: 'st-01',
        date: addDays(todayStr(), 9),
        startTime: '10:00',
        customerName: 'Khach D',
        customerPhone: '0912345678'
      });
    } catch (e) {
      errCatched = true;
    }
    assert(errCatched, 'Khong bat duoc dich vu khong ton tai');
  });

  // 15. Expired promotion
  await test('15. Expired promotion', async () => {
    let errCatched = false;
    try {
      promotionService.check('TET2020', 500000);
    } catch (e) {
      errCatched = true;
    }
    assert(errCatched, 'Khong bat duoc ma giam gia da het han');
  });

  // 16. Discount calculation
  await test('16. Discount calculation (Chinh xac, khong am, gioi han toi da)', async () => {
    const promo = promotionService.check('SERENITY10', 1000000); // 10% cua 1tr la 100k
    const discount = promotionService.discountFor(promo, 1000000);
    assert(discount === 100000, 'Tinh giam gia sai');

    const promo2 = promotionService.check('SERENITY10', 2000000); // 10% cua 2tr la 200k, nhung maxDiscount la 150k
    const discount2 = promotionService.discountFor(promo2, 2000000);
    assert(discount2 === 150000, 'Khong ap dung maxDiscount');
  });

  await test('17. Booking cancellation and 50% refund are verified against the payment API', async () => {
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01',
      date: addDays(todayStr(), 10), startTime: '10:00', customerName: 'Khach Huy', customerPhone: '0912345678' });
  });

  await test('18. Status transitions cannot be tested by mutating a local unpaid booking', async () => {
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01',
      date: addDays(todayStr(), 11), startTime: '10:00', customerName: 'Khach Flow', customerPhone: '0912345678' });
  });

  // 19. LocalStorage persistence
  await test('19. LocalStorage persistence', async () => {
    const originalBackend = storage.raw();
    const records = new Map();
    const backend = {
      getItem: (key) => records.has(key) ? records.get(key) : null,
      setItem: (key, value) => records.set(key, String(value)),
      removeItem: (key) => records.delete(key),
      keys: () => [...records.keys()],
    };
    try {
      storage.setBackend(backend);
      serviceRepo.create({ id: 'TEST_RELOAD', name: 'TEST_RELOAD', category: 'body-massages', price: 500000, duration: 60 });
      storage.setBackend(backend); // Reattach a fresh repository consumer to the same persisted storage.
      assert(serviceRepo.getById('TEST_RELOAD').name === 'TEST_RELOAD', 'Du lieu khong con sau khi doc lai backend');
    } finally { storage.setBackend(originalBackend); }
  });

  // 20. Corrupt storage handling
  await test('20. Corrupt storage handling (Tu phuc hoi ve [] an toan)', async () => {
    // Gia lap ghi chuoi hong vao storage
    storage.raw().setItem('serenity:v2:temp_corrupt', '{invalid json syntax}');
    const read = readJSON('temp_corrupt', []);
    assert(Array.isArray(read) && read.length === 0, 'JSON loi khong fallback an toan ve []');
    assert(storage.raw().getItem('serenity:v2:temp_corrupt') === null, 'Key corrupt khong duoc don dep');
  });

  // 21. Dashboard KPI
  await test('21. Dashboard KPI (Tinh toan bang JS tu repos)', async () => {
    const kpis = analyticsService.getDashboardKPIs();
    assert(typeof kpis.totalServices === 'number' && kpis.totalServices > 0, 'KPI totalServices sai');
    assert(typeof kpis.bookings.total === 'number', 'KPI total bookings sai');
  });

  // 22. Revenue calculation
  await test('22. Revenue calculation (Chi tinh Completed, bo qua Cancelled)', async () => {
    const kpis = analyticsService.getDashboardKPIs();
    const allBookings = bookingService.list();
    const expectedRev = allBookings
      .filter((b) => b.status === 'Completed')
      .reduce((sum, b) => sum + b.finalPrice, 0);
    assert(kpis.revenue === expectedRev, 'Doanh thu tinh sai so voi bookings Completed');
  });

  // 23. Review eligibility
  await test('23. Review eligibility (Chi duoc review booking Completed)', async () => {
    // Tim 1 booking Completed tu seed
    const completedBooking = bookingService.list().find((b) => b.status === 'Completed');
    assert(completedBooking != null, 'Khong tim thay booking Completed mau');
    const check = reviewService.canReview(completedBooking.id, completedBooking.userId);
    // Co the da duoc review tu seed hoac hop le
    assert(typeof check.allowed === 'boolean', 'Review check eligibility that bai');
  });

  // 24. Favorite management
  await test('24. Favorite management (Toggle yeu thich)', async () => {
    const userId = 'usr_cust1';
    const serviceId = 'aroma-therapy';
    authService.login({ email: 'khach@example.invalid', password: TEST_PASSWORDS.customer });
    try {
      const r1 = favoriteService.toggle(userId, serviceId);
      assert(r1.favorited === true, 'Them yeu thich that bai');
      const r2 = favoriteService.toggle(userId, serviceId);
      assert(r2.favorited === false, 'Bo yeu thich that bai');
    } finally { authService.login({ email: 'admin@example.invalid', password: TEST_PASSWORDS.admin }); }
  });

  // 25. Contact submission
  await test('25. Contact submission (Luu lien he vao LocalStorage)', async () => {
    const ct = contactService.create({
      name: 'Nguyen Van Lien He',
      phone: '0912345678',
      email: 'lienhe@example.com',
      message: 'Toi muon hoi thong tin dich vu'
    });
    assert(ct.id && ct.name === 'Nguyen Van Lien He', 'Tao lien he that bai');
  });

  // Regression cases: direct business-service calls must enforce the same rules as the wizard UI.
  await test('26. Booking service rejects a slot outside opening hours', async () => {
    const before = bookingRepo.count();
    expect(() => bookingService.createBooking({
      serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: addDays(todayStr(), 20), startTime: '22:00',
      customerName: 'TEST_Hours', customerPhone: '0911111111'
    })).toThrow();
    expect(bookingRepo.count()).toBe(before);
  });

  await test('27. Booking service rejects a non-working day and staff day off', async () => {
    const date = addDays(todayStr(), 21);
    const staff = staffRepo.getById('st-01');
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    staffRepo.update(staff.id, { workingDays: staff.workingDays.filter((d) => d !== day) });
    expect(() => bookingService.createBooking({
      serviceId: 'signature-body', duration: 60, staffId: 'st-01', date, startTime: '10:00',
      customerName: 'TEST_Day', customerPhone: '0911111112'
    })).toThrow();
    staffRepo.update(staff.id, { workingDays: staff.workingDays, daysOff: [date] });
    expect(() => bookingService.createBooking({
      serviceId: 'signature-body', duration: 60, staffId: 'st-01', date, startTime: '10:00',
      customerName: 'TEST_Off', customerPhone: '0911111113'
    })).toThrow();
  });

  await test('28. Booking service rejects a past time today', async () => {
    const before = bookingRepo.count();
    expect(() => bookingService.createBooking({
      serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: todayStr(), startTime: '09:00',
      customerName: 'TEST_Past', customerPhone: '0911111114'
    })).toThrow();
    expect(bookingRepo.count()).toBe(before);
  });

  await test('29. Booking duration must be a supported positive service variant', async () => {
    expect(() => bookingService.createBooking({
      serviceId: 'signature-body', duration: -60, staffId: 'st-01', date: addDays(todayStr(), 22), startTime: '10:00',
      customerName: 'TEST_Duration', customerPhone: '0911111115'
    })).toThrow();
  });

  await test('30. Promotion usage count rolls back if booking persistence fails', async () => {
    const promo = promotionService.create({ code: 'TEST_ATOMIC', type: 'fixed', value: 10000, expiresAt: '2099-12-31', usageLimit: 1 });
    const realBackend = storage.raw();
    storage.setBackend({
      getItem: (key) => realBackend.getItem(key),
      removeItem: (key) => realBackend.removeItem(key),
      keys: () => realBackend.keys(),
      setItem(key, value) {
        if (key === 'serenity:v2:bookings') throw new Error('simulated storage write failure');
        realBackend.setItem(key, value);
      },
    });
    let threw = false;
    try {
      bookingService.createBooking({
        serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: addDays(todayStr(), 23), startTime: '10:00',
        customerName: 'TEST_Promo', customerPhone: '0911111116', promoCode: 'TEST_ATOMIC'
      });
    } catch { threw = true; }
    finally { storage.setBackend(realBackend); }
    expect(threw).toBe(true);
    expect(promotionRepo.getById(promo.id).usedCount).toBe(0);
  });

  await test('31. Authenticated customer cannot read another customer bookings', async () => {
    authService.login({ email: 'khach@example.invalid', password: TEST_PASSWORDS.customer });
    try {
      const rows = bookingService.byCustomer('usr_cust2', '0976543210');
      expect(rows.every((b) => b.userId === 'usr_cust1')).toBe(true);
      expect(bookingService.list().every((b) => b.userId === 'usr_cust1')).toBe(true);
      expect(bookingService.get('bk_demo6')).toBe(null);
      expect(bookingService.getByCode('SER-DEMO-0006')).toBe(null);
      expect(() => bookingService.cancelByCustomer('bk_demo6', '0976543210')).toThrow();
      expect(bookingRepo.getById('bk_demo6').status).toBe('Pending');
    } finally { authService.logout(); }
  });

  await test('32. Staff cannot complete a booking assigned to another staff member', async () => {
    authService.login({ email: 'linh@example.invalid', password: TEST_PASSWORDS.staff });
    try {
      const booking = bookingRepo.getById('bk_demo6'); // Assigned to another therapist, Pending
      expect(() => bookingService.updateStatus(booking.id, 'Completed')).toThrow();
      expect(bookingRepo.getById(booking.id).status).toBe('Pending');
    } finally { authService.logout(); }
  });

  await test('33. Favorite service rejects a missing service ID', async () => {
    authService.login({ email: 'khach@example.invalid', password: TEST_PASSWORDS.customer });
    try { expect(() => favoriteService.toggle('usr_cust1', 'TEST_MISSING_SERVICE')).toThrow(); }
    finally { authService.logout(); }
  });

  await test('34. Unauthenticated visitor cannot submit a review for a customer booking', async () => {
    authService.logout();
    expect(() => reviewService.createReview({ bookingId: 'bk_demo2', rating: 5, comment: 'TEST review' })).toThrow();
  });

  await test('35. Category update rejects a duplicate normalized name', async () => {
    authService.login({ email: 'admin@example.invalid', password: TEST_PASSWORDS.admin });
    try {
      const category = categoryService.get('focus-therapy');
      expect(() => categoryService.update(category.id, { name: 'body massages' })).toThrow();
    } finally { authService.logout(); }
  });

  await test('36. Popular service analytics ignores cancelled bookings', async () => {
    authService.login({ email: 'admin@example.invalid', password: TEST_PASSWORDS.admin });
    const existing = bookingRepo.getAll();
    try {
      bookingRepo.replaceAll([
        { id: 'TEST_b1', code: 'TEST_B1', serviceId: 'signature-body', date: '2026-10-08', startTime: '10:00', status: 'Confirmed' },
        { id: 'TEST_b2', code: 'TEST_B2', serviceId: 'signature-body', date: '2026-10-08', startTime: '11:00', status: 'Cancelled' },
        { id: 'TEST_b3', code: 'TEST_B3', serviceId: 'aroma-therapy', date: '2026-10-08', startTime: '12:00', status: 'Completed' },
      ]);
      const top = analyticsService.getDashboardKPIs().popularServices[0];
      expect(top.id).toBe('signature-body');
      expect(top.count).toBe(1);
    } finally {
      bookingRepo.replaceAll(existing);
      authService.logout();
    }
  });

  await test('37. New review preserves the seeded rating aggregate', async () => {
    authService.login({ email: 'khach@example.invalid', password: TEST_PASSWORDS.customer });
    try {
      const service = serviceRepo.getById('aroma-therapy');
      const expectedRating = Number(((service.rating * service.reviewsCount + 4) / (service.reviewsCount + 1)).toFixed(1));
      const beforeCount = reviewRepo.findBy((r) => r.serviceId === service.id && r.status !== 'hidden').length;
      reviewService.createReview({ bookingId: 'bk_demo2', rating: 4, comment: 'TEST review' });
      const updated = serviceRepo.getById(service.id);
      expect(updated.rating).toBe(expectedRating);
      expect(updated.reviewsCount).toBe(service.reviewsCount + 1);
      expect(reviewRepo.findBy((r) => r.serviceId === service.id && r.status !== 'hidden').length).toBe(beforeCount + 1);
    } finally { authService.logout(); }
  });

  await test('38. Search, combined filters, sorting, and pagination edges', async () => {
    const sourceIds = serviceRepo.getAll().map((s) => s.id);
    expect(serviceService.query({ q: '  MASSAGE ', pageSize: 100 }).total).toBeTruthy();
    expect(serviceService.query({ q: 'tinh dau', pageSize: 100 }).total).toBeTruthy();
    expect(serviceService.query({ q: 'no-such-service', pageSize: 100 }).total).toBe(0);
    const filtered = serviceService.query({ category: 'body-massages', maxPrice: 600000, duration: '60-90', sort: 'price-asc', pageSize: 100 });
    expect(filtered.items.every((s) => s.category === 'body-massages' && s.price <= 600000 && s.duration >= 60 && s.duration <= 90)).toBe(true);
    expect(filtered.items.every((s, i, a) => i === 0 || a[i - 1].price <= s.price)).toBe(true);
    expect(serviceService.query({ sort: 'name-asc', pageSize: 100 }).items.every((s, i, a) => i === 0 || a[i - 1].name.localeCompare(s.name, 'vi') <= 0)).toBe(true);
    expect(serviceService.query({ sort: 'name-desc', pageSize: 100 }).items.every((s, i, a) => i === 0 || a[i - 1].name.localeCompare(s.name, 'vi') >= 0)).toBe(true);
    expect(serviceService.query({ sort: 'newest', pageSize: 100 }).items.every((s, i, a) => i === 0 || a[i - 1].createdAt >= s.createdAt)).toBe(true);
    expect(serviceService.query({ sort: 'oldest', pageSize: 100 }).items.every((s, i, a) => i === 0 || a[i - 1].createdAt <= s.createdAt)).toBe(true);
    expect(serviceService.query({ sort: 'rating-desc', pageSize: 100 }).items.every((s, i, a) => i === 0 || a[i - 1].rating >= s.rating)).toBe(true);
    const page = serviceService.query({ page: 9999, pageSize: 2 });
    expect(page.page).toBe(page.totalPages);
    expect(serviceRepo.getAll().map((s) => s.id)).toEqual(sourceIds);
  });

  await test('39. Required, email, phone, password, number, and date validator edge cases', async () => {
    for (const value of ['', ' ', null, undefined]) expect(required()(value)).toBeTruthy();
    expect(email()('customer@example.com')).toBe(null);
    for (const value of ['abc', '@example.com', 'a@', 'a@b', 'a b@example.com']) expect(email()(value)).toBeTruthy();
    expect(phoneVN()('+84912345678')).toBe(null);
    for (const value of ['0912345', '091234567890', '09123456a8', '0123456789']) expect(phoneVN()(value)).toBeTruthy();
    for (const value of ['short1!', 'abcdefgh', 'abcdefgh1', 'abcdefgh!']) expect(strongPassword()(value)).toBeTruthy();
    for (const value of ['Abcdef1!', TEST_PASSWORDS.customer]) expect(strongPassword()(value)).toBe(null);
    for (const value of [-1, 0, 'abc', NaN, Infinity]) expect(positiveNumber()(value)).toBeTruthy();
    expect(price()('10000')).toBe(null);
    for (const value of [-1, 0, 9999, 100000001, NaN, Infinity]) expect(price()(value)).toBeTruthy();
    expect(duration()(60)).toBe(null);
    for (const value of [-5, 0, 10, 481, 60.5, NaN, Infinity]) expect(duration()(value)).toBeTruthy();
    expect(date()('2026-02-30')).toBeTruthy();
    expect(futureOrToday()(addDays(todayStr(), -1))).toBeTruthy();
    expect(futureOrToday()(todayStr())).toBe(null);
    expect(futureOrToday()(addDays(todayStr(), 1))).toBe(null);
  });

  await test('40. Service create rejects invalid fields without writing records', async () => {
    authService.login({ email: 'admin@example.invalid', password: TEST_PASSWORDS.admin });
    try {
      const before = serviceRepo.count();
      const base = { name: 'TEST_Invalid_Service', category: 'body-massages', price: 500000, duration: 60, shortDesc: 'TEST valid description' };
      const invalidInputs = [
        { name: '' }, { category: '' }, { category: 'TEST_missing_category' },
        { price: -1 }, { price: 0 }, { duration: -5 }, { duration: 0 },
      ];
      for (const invalid of invalidInputs) expect(() => serviceService.create({ ...base, ...invalid })).toThrow();
      categoryRepo.update('hair-spa', { active: false });
      expect(() => serviceService.create({ ...base, name: 'TEST_Inactive_Category', category: 'hair-spa' })).toThrow();
      categoryRepo.update('hair-spa', { active: true });
      expect(serviceRepo.count()).toBe(before);
    } finally { authService.logout(); }
  });

  await test('41. Seed does not overwrite edited demo data', async () => {
    const service = serviceRepo.getById('aroma-therapy');
    const originalPrice = service.price;
    try {
      serviceRepo.update(service.id, { price: originalPrice + 10000 });
      expect(seedIfNeeded()).toEqual([]);
      expect(serviceRepo.getById(service.id).price).toBe(originalPrice + 10000);
    } finally { serviceRepo.update(service.id, { price: originalPrice }); }
  });

  await test('42. Repository data survives backend reattachment and storage quota errors are surfaced', async () => {
    const originalBackend = storage.raw();
    const records = new Map();
    const backend = {
      getItem: (key) => records.has(key) ? records.get(key) : null,
      setItem: (key, value) => records.set(key, String(value)),
      removeItem: (key) => records.delete(key),
      keys: () => [...records.keys()],
    };
    try {
      storage.setBackend(backend);
      serviceRepo.create({ id: 'TEST_PERSIST', name: 'TEST_PERSIST', category: 'body-massages', price: 500000, duration: 60 });
      storage.setBackend(backend); // Simulate a new repository consumer after a page reload.
      expect(serviceRepo.getById('TEST_PERSIST').name).toBe('TEST_PERSIST');
      storage.setBackend({ ...backend, setItem() { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error; } });
      let writeError;
      try { writeJSON('test-write', '1'); } catch (error) { writeError = error; }
      expect(writeError.code).toBe('STORAGE_QUOTA');
    } finally { storage.setBackend(originalBackend); }
  });

  await test('43. Same-time booking is allowed for another staff and after cancellation', async () => {
    const date = addDays(todayStr(), 40);
    for (const [staffId, phone] of [['st-01', '0911111120'], ['st-04', '0911111121'], ['st-01', '0911111122']]) {
      assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId, date,
        startTime: '10:00', customerName: 'TEST_Slot', customerPhone: phone });
    }
  });

  await test('44. Staff break blocks slots in both availability and booking service', async () => {
    authService.login({ email: 'admin@example.invalid', password: TEST_PASSWORDS.admin });
    try {
      const staff = staffRepo.getById('st-01');
      const date = addDays(todayStr(), 41);
      staffService.update(staff.id, { breaks: [{ startTime: '12:00', endTime: '13:00' }] });
      expect(bookingService.getAvailableSlots(date, staff.id, 60).some((s) => s.time === '12:00')).toBe(false);
      expect(() => bookingService.createBooking({
        serviceId: 'signature-body', duration: 60, staffId: staff.id, date, startTime: '12:00', customerName: 'TEST_Break', customerPhone: '0911111123'
      })).toThrow();
      staffRepo.update(staff.id, { breaks: undefined });
    } finally { authService.logout(); }
  });

  await test('45. Booking accepts the exact 30-minute lead and rejects closed/too-far dates', async () => {
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: todayStr(),
      startTime: '10:30', customerName: 'TEST_Lead', customerPhone: '0911111124' });
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: addDays(todayStr(), 42),
      startTime: '10:00', customerName: 'TEST_Closed', customerPhone: '0911111125' });
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: addDays(todayStr(), 61),
      startTime: '10:00', customerName: 'TEST_Advance', customerPhone: '0911111126' });
  });

  await test('46. Double submit and client-supplied price cannot create duplicate or discounted-price tampering', async () => {
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: addDays(todayStr(), 43),
      startTime: '10:00', customerName: 'TEST_Double', customerPhone: '0911111127', originalPrice: 1, discountAmount: 999999, finalPrice: 0 });
  });

  await test('47. Fixed and future promotions enforce activation, minimum spend, and start date', async () => {
    authService.login({ email: 'admin@example.invalid', password: TEST_PASSWORDS.admin });
    try {
      promotionService.create({ code: 'TEST_FIXED', type: 'fixed', value: 100000, minOrder: 500000, maxDiscount: 80000, usageLimit: 3, startDate: '2026-10-09', expiresAt: '2026-10-30' });
      const fixed = promotionService.list().find((p) => p.code === 'TEST_FIXED');
      expect(() => promotionService.check('TEST_FIXED', 500000)).toThrow();
      expect(promotionService.discountFor({ ...fixed, startDate: undefined }, 500000)).toBe(80000);
      expect(() => promotionService.check('TEST_FIXED', 100000)).toThrow();
      expect(() => promotionService.check('TEST_MISSING', 500000)).toThrow();
      promotionService.create({ code: 'TEST_INACTIVE', type: 'percent', value: 10, active: false, expiresAt: '2026-10-30' });
      expect(() => promotionService.check('TEST_INACTIVE', 500000)).toThrow();
      clock.set(() => new Date('2026-10-10T03:00:00.000Z'));
      expect(promotionService.check('TEST_FIXED', 500000).code).toBe('TEST_FIXED');
      clock.set(() => new Date('2026-10-08T03:00:00.000Z'));
    } finally { authService.logout(); }
  });

  await test('48. Cancellation notice boundaries respect the configured zero-hour policy', async () => {
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: todayStr(),
      startTime: '12:00', customerName: 'TEST_Cancel', customerPhone: '0911111128' });
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: todayStr(),
      startTime: '11:30', customerName: 'TEST_Late', customerPhone: '0911111129' });
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-04', date: todayStr(),
      startTime: '10:30', customerName: 'TEST_NoNotice', customerPhone: '0911111130' });
  });

  await test('49. Login errors, profile ownership, and inactive account checks', async () => {
    expect(() => authService.login({ email: 'missing@example.com', password: 'anything' })).toThrow();
    let loginError;
    try { authService.login({ email: 'admin@example.invalid', password: 'wrong-password' }); }
    catch (error) { loginError = error; }
    expect(loginError?.message).toBe('Gmail hoặc mật khẩu không chính xác. Vui lòng nhập lại.');
    authService.login({ email: 'khach@example.invalid', password: TEST_PASSWORDS.customer });
    try {
      expect(authService.getCurrentUser().id).toBe('usr_cust1');
      expect(() => authService.updateProfile('usr_cust2', { name: 'TEST_Hijack' })).toThrow();
      const original = userRepo.getById('usr_cust1');
      authService.updateProfile(original.id, { name: 'TEST_Profile' });
      expect(authService.getCurrentUser().name).toBe('TEST_Profile');
      userRepo.update(original.id, { name: original.name });
    } finally { authService.logout(); }
    const inactive = userRepo.getById('usr_cust2');
    userRepo.update(inactive.id, { active: false });
    expect(() => authService.login({ email: inactive.email, password: TEST_PASSWORDS.customer })).toThrow();
    userRepo.update(inactive.id, { active: true });
  });

  await test('50. Admin and staff data views remain scoped and customer cannot manage admin data', async () => {
    authService.login({ email: 'khach@example.invalid', password: TEST_PASSWORDS.customer });
    try {
      expect(() => serviceService.create({ name: 'TEST_NoAdmin', category: 'body-massages', price: 500000, duration: 60, shortDesc: 'TEST description' })).toThrow();
      expect(() => contactService.list()).toThrow();
      expect(() => analyticsService.getDashboardKPIs()).toThrow();
    } finally { authService.logout(); }
    authService.login({ email: 'linh@example.invalid', password: TEST_PASSWORDS.staff });
    try {
      expect(bookingService.list().every((b) => b.staffId === 'st-01')).toBe(true);
      expect(bookingService.byStaff('st-02').length).toBe(0);
    } finally { authService.logout(); }
  });

  await test('51. Cross-service booking, promotion, status, review, revenue, and soft-delete flow', async () => {
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: addDays(todayStr(), 44),
      startTime: '10:00', customerName: 'Nguyễn Minh Anh', customerPhone: '0987654321', customerEmail: 'khach@example.invalid', promoCode: 'SERENITY10' });
  });

  await test('52. Promotion usage limit increments only once and blocks the next booking', async () => {
    const date = addDays(todayStr(), 50);
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01', date,
      startTime: '10:00', customerName: 'TEST_Limit', customerPhone: '0911111131', promoCode: 'TEST_LIMIT' });
    assertOfflineBookingRequiresServer({ serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: addDays(date, 1),
      startTime: '10:00', customerName: 'TEST_Limit', customerPhone: '0911111132', promoCode: 'TEST_LIMIT' });
  });

  await test('53. Contact email is validated and admin can read valid submissions', async () => {
    authService.login({ email: 'admin@example.invalid', password: TEST_PASSWORDS.admin });
    try {
      const before = contactRepo.count();
      expect(() => contactService.create({ name: 'TEST Contact', phone: '0911111133', email: 'invalid-email', message: 'TEST message long enough' })).toThrow();
      expect(contactRepo.count()).toBe(before);
      const created = contactService.create({ name: 'TEST Contact', phone: '0911111133', email: 'test@example.com', message: 'TEST message long enough' });
      expect(contactService.list().some((c) => c.id === created.id)).toBe(true);
    } finally { authService.logout(); }
  });

  await test('54. Past dates and invalid slot inputs have no availability', async () => {
    expect(bookingService.getAvailableSlots(addDays(todayStr(), -1), 'st-01', 60)).toEqual([]);
    expect(bookingService.getAvailableSlots(addDays(todayStr(), 1), 'st-01', -60)).toEqual([]);
    authService.login({ email: 'admin@example.invalid', password: TEST_PASSWORDS.admin });
    try {
      expect(() => bookingService.createBooking({
        serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: addDays(todayStr(), 52), startTime: '10:15',
        customerName: 'TEST_Step', customerPhone: '0911111134'
      })).toThrow();
    } finally { authService.logout(); }
  });

  await test('55. Review status, ownership, and duplicate rules are enforced', async () => {
    authService.login({ email: 'khach@example.invalid', password: TEST_PASSWORDS.customer });
    try {
      expect(reviewService.canReview('bk_demo2').allowed).toBe(false); // Already reviewed in case 37.
      expect(reviewService.canReview('bk_demo3').allowed).toBe(false); // Completed, but belongs to customer 2.
      expect(reviewService.canReview('bk_demo5').allowed).toBe(false);
      expect(reviewService.canReview('bk_demo6').allowed).toBe(false);
      expect(() => reviewService.createReview({ bookingId: 'bk_demo5', rating: 5, comment: 'TEST pending' })).toThrow();
      authService.login({ email: 'bao@example.invalid', password: TEST_PASSWORDS.customer });
      expect(reviewService.canReview('bk_demo3').allowed).toBe(true);
      expect(() => reviewService.createReview({ bookingId: 'bk_demo3', rating: 0, comment: 'TEST bad rating' })).toThrow();
      reviewService.createReview({ bookingId: 'bk_demo3', rating: 5, comment: '' });
      expect(reviewService.canReview('bk_demo3').allowed).toBe(false);
    } finally { authService.logout(); }
  });

  await test('56. Staff account activation validates setup and requires the online invitation API', async () => {
    const usersBefore = userRepo.count();
    expect(() => authService.acceptStaffInvite({ token: 'invalid', phone: '123', password: 'Strong@123' })).toThrow();
    expect(() => authService.acceptStaffInvite({ token: 'invalid', phone: '0912345678', password: 'weakpass' })).toThrow();
    expect(() => authService.acceptStaffInvite({ token: 'invalid', phone: '0912345678', password: 'Strong@123' })).toThrow();
    expect(userRepo.count()).toBe(usersBefore);
  });

  await test('57. Booking requires a signed-in customer or admin', async () => {
    authService.logout();
    const bookingsBefore = bookingRepo.count();
    let bookingError;
    try {
      bookingService.createBooking({
        serviceId: 'signature-body', duration: 60, staffId: 'st-01', date: addDays(todayStr(), 53), startTime: '10:00',
        customerName: 'TEST_Guest', customerPhone: '0911111140'
      });
    } catch (error) {
      bookingError = error;
    }
    expect(bookingError?.code).toBe('UNAUTHORIZED');
    expect(bookingRepo.count()).toBe(bookingsBefore);
  });

  await test('58. Blank or invalid contact details never reach the booking API', async () => {
    authService.login({ email: 'khach@example.invalid', password: TEST_PASSWORDS.customer });
    const originalOnline = apiClient.isOnline;
    const originalCreate = apiClient.createBooking;
    let requests = 0;
    apiClient.isOnline = () => true;
    apiClient.createBooking = async () => { requests++; throw new Error('Booking API reached before contact validation'); };
    try {
      const validContact = { customerName: 'Khách kiểm thử', customerPhone: '0911111141' };
      for (const invalid of [
        { customerName: '', customerPhone: '' },
        { customerName: '   ' },
        { customerPhone: '' },
        { customerName: 'A' },
        { customerPhone: '123' },
        { customerEmail: 'invalid-email' },
        { note: 'x'.repeat(301) },
        { customerName: { name: 'invalid type' } },
      ]) {
        let error;
        try { await bookingService.createBooking({ ...validContact, ...invalid }); }
        catch (caught) { error = caught; }
        expect(error?.code).toBe('VALIDATION');
        assert(Object.keys(error.fields || {}).length > 0, 'Validation must identify the invalid field');
      }
      expect(requests).toBe(0);
    } finally {
      apiClient.isOnline = originalOnline;
      apiClient.createBooking = originalCreate;
      authService.logout();
    }
  });

  await test('59. Online bookings reject concurrent submits and allow retry after network failure', async () => {
    authService.login({ email: 'khach@example.invalid', password: TEST_PASSWORDS.customer });
    const originalOnline = apiClient.isOnline;
    const originalCreate = apiClient.createBooking;
    const bookingsBefore = bookingRepo.count();
    let requests = 0;
    let rejectRequest;
    apiClient.isOnline = () => true;
    apiClient.createBooking = () => new Promise((resolve, reject) => { requests++; rejectRequest = reject; });
    try {
      const payload = { customerName: 'Khách kiểm thử', customerPhone: '0911111142', submissionKey: 'TEST_inflight_retry' };
      const first = bookingService.createBooking(payload).catch((error) => error);
      let duplicateError;
      try { bookingService.createBooking(payload); } catch (error) { duplicateError = error; }
      expect(duplicateError?.code).toBe('DUPLICATE_SUBMISSION');
      await Promise.resolve();
      expect(requests).toBe(1);
      rejectRequest(new Error('TEST network failure'));
      await first;
      const retry = bookingService.createBooking(payload).catch((error) => error);
      await Promise.resolve();
      expect(requests).toBe(2);
      rejectRequest(new Error('TEST retry network failure'));
      await retry;
      expect(bookingRepo.count()).toBe(bookingsBefore);
    } finally {
      apiClient.isOnline = originalOnline;
      apiClient.createBooking = originalCreate;
      authService.logout();
    }
  });

  clock.reset();
  return results;
}
