import { createHash, randomUUID } from 'node:crypto';
import { normalizeHolidaySale } from '../assets/js/domain/holidaySaleModel.js';
import { calculatePrice, calculateRescheduleAdjustment, PRICING_POLICY_VERSION } from '../assets/js/domain/pricingService.js';
import { isServiceBookable } from '../assets/js/domain/serviceCatalogModel.js';
import { readHolidaySales } from './pricingDatabase.js';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
const digest = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const EDITABLE = new Set(['name', 'occasion', 'serviceDateFrom', 'serviceDateTo', 'enabled', 'discountType', 'percentageBps', 'fixedAmountVnd', 'maxDiscountVnd', 'scopeType', 'targets']);

export function createHolidaySaleOperations({ db, getRecord, parseRows, saveRecord, versionOf, nextVersion, transaction,
  withAudit, assertSlot, businessNow, normalizeVietnamPhone, canCollectAdjustment = () => true, HttpError }) {
  const fail = (status, message, code) => { throw new HttpError(status, message, code); };
  const admin = (actor) => { if (actor?.role !== 'admin') fail(403, 'Chỉ Admin được quản lý sale lễ.', 'FORBIDDEN'); };
  const all = () => readHolidaySales(db);
  const list = ({ publicOnly = false, query = '' } = {}) => all().filter((row) =>
    (!publicOnly || (row.enabled && row.serviceDateTo >= businessNow().date))
    && (!query || `${row.id} ${row.name} ${row.occasion}`.toLocaleLowerCase('vi').includes(String(query).toLocaleLowerCase('vi'))));

  function price({ serviceId, duration, serviceDate, promoCode = '' }, booking = null) {
    const service = getRecord('services', serviceId);
    if (!isServiceBookable(service, parseRows('services'))) fail(400, 'Dịch vụ không còn khả dụng.', 'SERVICE_INVALID');
    if (typeof promoCode !== 'string') fail(400, 'Mã khuyến mãi không hợp lệ.', 'PROMO_INVALID');
    let coupon = parseRows('promotions').find((row) => row.code?.toUpperCase() === promoCode.trim().toUpperCase()) || null;
    // A redemption already counted for this booking is not consumed a second time.
    if (coupon && (booking?.couponRedemptions?.includes(coupon.id) || booking?.promoCode === coupon.code)) {
      coupon = { ...coupon, usedCount: Math.max(0, Number(coupon.usedCount || 0) - 1) };
    }
    return calculatePrice({ service, duration: Number(duration ?? service.duration), serviceDate,
      campaigns: all(), promoCode, coupon, evaluatedAt: new Date().toISOString() });
  }

  function save(data, actor, { id = null, expectedRevision = 0, requestId } = {}) {
    admin(actor);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some((key) => !EDITABLE.has(key))) {
      fail(400, 'Trường chỉnh sửa sale không hợp lệ.', 'VALIDATION');
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail(400, 'Cần phiên bản sale hợp lệ.', 'VERSION_REQUIRED');
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(requestId)) fail(400, 'Cần mã yêu cầu để tránh tạo sale trùng.', 'REQUEST_ID_REQUIRED');
    const key = `holiday-sale-request:${actor.id}:${requestId}`;
    const inputHash = digest({ id, expectedRevision, data });
    return transaction(() => {
      const previousRequest = db.prepare('SELECT value FROM metadata WHERE key = ?').get(key);
      if (previousRequest) {
        const saved = JSON.parse(previousRequest.value);
        if (saved.inputHash !== inputHash) fail(409, 'Mã yêu cầu đã được dùng cho thao tác khác.', 'REQUEST_CONFLICT');
        return { ...saved.result, replayed: true };
      }
      const before = id ? all().find((row) => row.id === id) : null;
      if (id && !before) fail(404, 'Không tìm thấy chiến dịch sale.', 'NOT_FOUND');
      if ((before?.revision ?? 0) !== expectedRevision) fail(409, 'Sale đã đổi. Hãy đọc lại trước khi sửa.', 'VERSION_CONFLICT');
      if (!id && all().length >= 1000) fail(400, 'Đã đạt giới hạn chiến dịch. Hãy cập nhật chiến dịch hiện có.', 'SALE_LIMIT');
      const now = new Date().toISOString();
      const input = { ...(before || {}), ...data };
      if (data.discountType === 'percent') input.fixedAmountVnd = null;
      if (data.discountType === 'fixed') input.percentageBps = null;
      if (data.scopeType === 'all') input.targets = [];
      const sale = normalizeHolidaySale({ ...input, id: id || `sale_${randomUUID()}`,
        revision: expectedRevision + 1, createdAt: before?.createdAt || now, updatedAt: now },
      saleCatalogs(input.enabled));
      db.prepare('DELETE FROM holiday_sale_targets WHERE campaign_id = ?').run(sale.id);
      db.prepare(`INSERT INTO holiday_sales(id,name,occasion,service_date_from,service_date_to,enabled,discount_type,
        percentage_bps,fixed_amount_vnd,max_discount_vnd,scope_type,revision,created_at,updated_at,created_by,updated_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,occasion=excluded.occasion,
        service_date_from=excluded.service_date_from,service_date_to=excluded.service_date_to,enabled=excluded.enabled,
        discount_type=excluded.discount_type,percentage_bps=excluded.percentage_bps,fixed_amount_vnd=excluded.fixed_amount_vnd,
        max_discount_vnd=excluded.max_discount_vnd,scope_type=excluded.scope_type,revision=excluded.revision,
        updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(sale.id, sale.name, sale.occasion,
        sale.serviceDateFrom, sale.serviceDateTo, Number(sale.enabled), sale.discountType, sale.percentageBps,
        sale.fixedAmountVnd, sale.maxDiscountVnd, sale.scopeType, sale.revision, sale.createdAt, sale.updatedAt, actor.id, actor.id);
      const insertTarget = db.prepare('INSERT INTO holiday_sale_targets(campaign_id,scope_type,target_id,duration_minutes) VALUES (?,?,?,?)');
      for (const target of sale.targets) insertTarget.run(sale.id, sale.scopeType, target.targetId, target.durationMinutes);
      const verified = all().find((row) => row.id === sale.id);
      if (digest(verified) !== digest(sale)) throw new Error('Sale verification failed.');
      nextVersion('holidaySales');
      withAudit(actor, before ? 'holiday_sale.updated' : 'holiday_sale.created', null, { before, after: verified, requestId });
      const result = { sale: verified, verified: true, replayed: false };
      db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run(key, JSON.stringify({ inputHash, result }));
      return result;
    });
  }

  function saleCatalogs(enabled) { return enabled === false ? {} : { services: parseRows('services'), categories: parseRows('categories') }; }

  function authorize(booking, actor, phone) {
    if (!booking) fail(404, 'Không tìm thấy lịch hẹn.', 'NOT_FOUND');
    if (actor?.role === 'admin' || (actor?.role === 'customer' && booking.userId === actor.id)) return `user:${actor.id}`;
    const normalized = normalizeVietnamPhone(phone);
    if (!actor && !booking.userId && normalized && booking.customerPhone === normalized) return `guest:${digest([booking.id, normalized])}`;
    fail(403, 'Bạn không có quyền dời lịch này.', 'FORBIDDEN');
  }
  function reschedulable(booking) {
    if (!['Pending', 'Confirmed'].includes(booking.status)) fail(409, 'Chỉ lịch đang chờ hoặc đã xác nhận mới được dời.', 'STATUS_INVALID');
    if (booking.paymentCode && !['paid', 'paid_with_issue'].includes(booking.paymentStatus)) fail(409, 'Chỉ được dời lịch QR sau khi đã thanh toán đủ.', 'PAYMENT_REQUIRED');
    if (booking.refundRequest?.status === 'pending') fail(409, 'Cần xử lý yêu cầu hoàn tiền đang chờ trước khi dời lịch lần nữa.', 'REFUND_PENDING');
    if (booking.reschedulePaymentRequest && Date.parse(booking.reschedulePaymentRequest.expiresAt || '') > Date.now()) {
      fail(409, 'Đang chờ thanh toán phần chênh lệch của lần dời trước.', 'RESCHEDULE_PAYMENT_PENDING');
    }
    const now = businessNow();
    const minutes = (date, time) => Date.parse(`${date}T00:00:00Z`) / 60000 + Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const limit = Number(getRecord('settings', 'main')?.cancelBeforeHours ?? 2) * 60;
    if (minutes(booking.date, booking.startTime) - (Date.parse(`${now.date}T00:00:00Z`) / 60000 + now.minutes) < limit) {
      fail(409, 'Đã quá thời hạn cho phép dời lịch.', 'RESCHEDULE_TOO_LATE');
    }
  }
  function clearExpiredReschedulePayment(booking) {
    const request = booking?.reschedulePaymentRequest;
    if (!request || Date.parse(request.expiresAt || '') > Date.now()) return booking;
    if (request.reservedPromoId) {
      const promo = getRecord('promotions', request.reservedPromoId);
      if (promo && Number(promo.usedCount || 0) > 0) {
        saveRecord('promotions', { ...promo, usedCount: Number(promo.usedCount || 0) - 1 });
        nextVersion('promotions');
      }
    }
    if (request.quoteId) db.prepare("UPDATE reschedule_quotes SET status = 'expired' WHERE id = ? AND status = 'pending'").run(request.quoteId);
    const updated = { ...booking, reschedulePaymentRequest: null,
      lastReschedulePaymentStatus: 'expired', lastReschedulePaymentAt: new Date().toISOString(),
      lastReschedulePaymentRequest: request, updatedAt: new Date().toISOString() };
    saveRecord('bookings', updated);
    nextVersion('bookings');
    withAudit({ id: 'reschedule-expiry', role: 'system' }, 'booking.reschedule_payment.expired', booking.id,
      { quoteId: request.quoteId, amount: request.amount, expiresAt: request.expiresAt });
    return updated;
  }
  function versions(booking) {
    return { bookingHash: digest(booking), services: versionOf('services'), holidaySales: versionOf('holidaySales'),
      promotions: versionOf('promotions'), staff: versionOf('staff'), settings: versionOf('settings'), policy: PRICING_POLICY_VERSION };
  }
  function viewQuote(row) {
    const booking = getRecord('bookings', row.booking_id);
    return { id: row.id, bookingId: row.booking_id, bookingCode: booking?.code, expiresAt: row.expires_at,
      oldDate: booking?.date, oldStartTime: booking?.startTime, change: JSON.parse(row.requested_change),
      oldPricing: JSON.parse(row.old_pricing), newPricing: JSON.parse(row.new_pricing), settlement: JSON.parse(row.settlement) };
  }
  function prepareReschedule(id, data, actor) {
    return transaction(() => {
      let booking = getRecord('bookings', id);
      booking = clearExpiredReschedulePayment(booking);
      const binding = authorize(booking, actor, data.phone);
      reschedulable(booking);
      const slot = assertSlot({ serviceId: booking.serviceId, duration: booking.duration, staffId: data.staffId || booking.staffId,
        date: data.date, startTime: data.startTime, excludeId: id });
      const change = { date: data.date, startTime: slot.startTime, endTime: slot.endTime, staffId: slot.staff.id,
        staffName: slot.staff.name, roomNumber: slot.roomNumber, promoCode: data.promoCode ?? '' };
      const pricing = price({ serviceId: booking.serviceId, duration: booking.duration, serviceDate: data.date, promoCode: change.promoCode }, booking);
      const settlement = calculateRescheduleAdjustment({ oldFinalPrice: booking.finalPrice, newFinalPrice: pricing.finalPrice, paymentRecords: booking.paymentRecords || [] });
      const now = new Date();
      const quoteId = randomUUID();
      const oldPricing = booking.pricingSnapshot || { discountSource: 'legacy', originalPrice: booking.originalPrice,
        discountAmount: booking.discountAmount || 0, finalPrice: booking.finalPrice, serviceDate: booking.date };
      db.prepare(`INSERT INTO reschedule_quotes(id,booking_id,actor_binding,booking_revision,requested_change,old_pricing,
        new_pricing,pricing_versions,settlement,policy_version,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(quoteId, id, binding, booking.revision || 0, JSON.stringify(change), JSON.stringify(oldPricing), JSON.stringify(pricing),
          JSON.stringify(versions(booking)), JSON.stringify(settlement), PRICING_POLICY_VERSION, now.toISOString(), new Date(now.getTime() + 300000).toISOString());
      return { quote: viewQuote(db.prepare('SELECT * FROM reschedule_quotes WHERE id = ?').get(quoteId)), requiresConfirmation: true };
    });
  }

  function normalizeRefundRecipient(input) {
    const bankName = String(input?.bankName || '').trim().slice(0, 80);
    const accountHolder = String(input?.accountHolder || '').trim().toUpperCase().slice(0, 80);
    const accountNumber = String(input?.accountNumber || '').replace(/\D/g, '');
    if (!bankName || !/^[\p{L} ]{5,80}$/u.test(accountHolder) || !/^\d{6,19}$/.test(accountNumber)) {
      fail(400, 'Để hoàn phần chênh lệch giá, vui lòng nhập ngân hàng, số tài khoản và tên chủ tài khoản hợp lệ.', 'REFUND_RECIPIENT_INVALID');
    }
    return { bankName, accountHolder, accountNumber };
  }

  function applyConfirmedReschedule(booking, request, payment = null) {
    const now = new Date().toISOString();
    const { change, pricing, settlement } = request;
    const redemptions = new Set(booking.couponRedemptions || []);
    if (booking.promoCode) {
      const oldPromo = parseRows('promotions').find((promo) => promo.code === booking.promoCode);
      if (oldPromo) redemptions.add(oldPromo.id);
    }
    let promotionChanged = false;
    if (pricing.promoCode) {
      const promo = parseRows('promotions').find((candidate) => candidate.code === pricing.promoCode);
      const promoId = promo?.id || request.promoId || request.reservedPromoId;
      if (promoId && !redemptions.has(promoId)) {
        if (request.reservedPromoId !== promoId && promo) {
          saveRecord('promotions', { ...promo, usedCount: Number(promo.usedCount || 0) + 1 });
          promotionChanged = true;
        }
        redemptions.add(promoId);
      }
    }
    let refundRequest = null;
    if (settlement.refundDue > 0) {
      if (booking.refundRequest?.status === 'pending') fail(409, 'Đang có yêu cầu hoàn tiền khác cần xử lý trước khi dời lịch.', 'REFUND_PENDING');
      const recipient = request.refundRecipient;
      if (!recipient) fail(409, 'Cần thông tin tài khoản nhận hoàn để xử lý phần chênh lệch.', 'REFUND_RECIPIENT_REQUIRED');
      refundRequest = {
        id: `rfd_${randomUUID()}`, kind: 'reschedule_price_difference', amount: settlement.refundDue,
        paidAmount: settlement.netPaid, status: 'pending', requestedAt: now, recipient,
        note: 'Hoàn 100% phần chênh lệch giảm giá sau khi khách dời lịch; nhân viên chuyển thủ công.',
      };
    }
    const paymentRecords = [...(booking.paymentRecords || [])];
    if (payment) paymentRecords.push({
      id: `pay_sepay_${payment.transactionId}`, type: 'payment', amount: payment.amount, method: 'bank',
      reference: String(payment.reference || payment.transactionId).slice(0, 120),
      note: 'Đã nhận đủ phần chênh lệch để xác nhận lịch mới.', at: payment.at, recordedBy: 'sepay-webhook',
    });
    const updated = {
      ...booking, date: change.date, startTime: change.startTime, endTime: change.endTime,
      roomNumber: change.roomNumber, staffId: change.staffId, staffName: change.staffName,
      originalPrice: pricing.originalPrice, discountAmount: pricing.discountAmount,
      finalPrice: pricing.finalPrice, promoCode: pricing.promoCode, pricingSnapshot: pricing,
      couponRedemptions: [...redemptions], paymentRecords,
      reschedulePaymentRequest: null,
      ...(payment ? { lastReschedulePaymentStatus: 'paid', lastReschedulePaymentAt: now } : {}),
      ...(refundRequest ? { refundRequest } : {}),
      updatedAt: now,
      rescheduleHistory: [...(booking.rescheduleHistory || []), {
        from: { date: booking.date, startTime: booking.startTime, staffId: booking.staffId },
        to: change, oldPricing: request.oldPricing, newPricing: pricing, settlement,
        quoteId: request.quoteId, at: now, by: request.actorId || 'guest',
      }],
    };
    saveRecord('bookings', updated);
    nextVersion('bookings');
    if (promotionChanged) nextVersion('promotions');
    const actor = request.actorId ? { id: request.actorId, role: request.actorRole || 'customer' } : null;
    withAudit(actor, 'booking.rescheduled', booking.id, { quoteId: request.quoteId,
      fromDate: booking.date, toDate: change.date, settlement, additionalPayment: payment?.amount || 0,
      refundAmount: refundRequest?.amount || 0 });
    const result = { booking: updated, settlement, refundRequest, replayed: false };
    const quote = db.prepare('SELECT expires_at FROM reschedule_quotes WHERE id = ?').get(request.quoteId);
    const confirmAt = new Date();
    const minExpiry = new Date(confirmAt.getTime() + 1).toISOString();
    const expiresAt = quote?.expires_at > minExpiry ? quote.expires_at : minExpiry;
    db.prepare("UPDATE reschedule_quotes SET status = 'confirmed', confirmed_at = ?, expires_at = ?, result_json = ? WHERE id = ? AND status = 'pending'")
      .run(confirmAt.toISOString(), expiresAt, JSON.stringify(result), request.quoteId);
    return result;
  }

  function confirmReschedule(id, data, actor) {
    return transaction(() => {
      let booking = getRecord('bookings', id);
      booking = clearExpiredReschedulePayment(booking);
      const binding = authorize(booking, actor, data.phone);
      const row = typeof data.quoteId === 'string' ? db.prepare('SELECT * FROM reschedule_quotes WHERE id = ? AND booking_id = ?').get(data.quoteId, id) : null;
      if (!row || row.actor_binding !== binding) fail(403, 'Báo giá không thuộc phiên thao tác này.', 'QUOTE_FORBIDDEN');
      if (row.status === 'confirmed') return { ...JSON.parse(row.result_json), replayed: true };
      if (booking.reschedulePaymentRequest?.quoteId === row.id
        && Date.parse(booking.reschedulePaymentRequest.expiresAt || '') > Date.now()) {
        return { booking, settlement: booking.reschedulePaymentRequest.settlement,
          paymentRequired: true, paymentAmount: booking.reschedulePaymentRequest.amount,
          paymentExpiresAt: booking.reschedulePaymentRequest.expiresAt, quoteId: row.id, replayed: true };
      }
      if (row.status !== 'pending' || row.expires_at <= new Date().toISOString()) fail(409, 'Báo giá đã hết hiệu lực. Vui lòng lấy báo giá mới.', 'QUOTE_EXPIRED');
      reschedulable(booking);
      if (digest(JSON.parse(row.pricing_versions)) !== digest(versions(booking))) fail(409, 'Dữ liệu đã đổi. Vui lòng xem và xác nhận báo giá mới.', 'QUOTE_STALE');
      const change = JSON.parse(row.requested_change);
      const slot = assertSlot({ serviceId: booking.serviceId, duration: booking.duration, staffId: change.staffId,
        date: change.date, startTime: change.startTime, excludeId: id });
      change.endTime = slot.endTime;
      change.roomNumber = slot.roomNumber;
      const pricing = price({ serviceId: booking.serviceId, duration: booking.duration, serviceDate: change.date, promoCode: change.promoCode }, booking);
      const priorPricing = JSON.parse(row.new_pricing);
      if (digest({ ...pricing, evaluatedAt: null }) !== digest({ ...priorPricing, evaluatedAt: null })) fail(409, 'Giá đã đổi. Vui lòng xác nhận báo giá mới.', 'QUOTE_STALE');
      const now = new Date().toISOString();
      if (now >= row.expires_at) fail(409, 'Báo giá đã hết hiệu lực. Vui lòng lấy báo giá mới.', 'QUOTE_EXPIRED');
      const settlement = JSON.parse(row.settlement);
      const request = { quoteId: row.id, change, pricing, settlement, oldPricing: JSON.parse(row.old_pricing),
        actorId: actor?.id || null, actorRole: actor?.role || null, createdAt: now };
      request.promoId = pricing.promoCode
        ? parseRows('promotions').find((candidate) => candidate.code === pricing.promoCode)?.id || null : null;
      if (settlement.amountDue > 0) {
        if (!canCollectAdjustment()) fail(503, 'Chưa thể thanh toán phần chênh lệch vì SePay chưa sẵn sàng. Lịch cũ vẫn được giữ.', 'PAYMENT_NOT_CONFIGURED');
        const expiresAt = new Date(Date.now() + 180000).toISOString();
        if (pricing.promoCode) {
          const promo = parseRows('promotions').find((candidate) => candidate.code === pricing.promoCode);
          const currentRedemptions = new Set(booking.couponRedemptions || []);
          if (promo && !currentRedemptions.has(promo.id)) {
            saveRecord('promotions', { ...promo, usedCount: Number(promo.usedCount || 0) + 1 });
            nextVersion('promotions');
            request.reservedPromoId = promo.id;
          }
        }
        request.amount = settlement.amountDue;
        request.expiresAt = expiresAt;
        const updated = { ...booking, reschedulePaymentRequest: request,
          lastReschedulePaymentStatus: 'awaiting_payment', updatedAt: now };
        saveRecord('bookings', updated);
        nextVersion('bookings');
        db.prepare('UPDATE reschedule_quotes SET expires_at = ? WHERE id = ? AND status = \'pending\'').run(expiresAt, row.id);
        withAudit(actor, 'booking.reschedule_payment.started', id,
          { quoteId: row.id, amount: request.amount, expiresAt, fromDate: booking.date, toDate: change.date });
        return { booking: updated, settlement, paymentRequired: true, paymentAmount: request.amount,
          paymentExpiresAt: expiresAt, quoteId: row.id, replayed: false };
      }
      if (settlement.refundDue > 0) request.refundRecipient = normalizeRefundRecipient(data.refundRecipient);
      return applyConfirmedReschedule(booking, request);
    });
  }

  function finalizeReschedulePayment(booking, request, payment) {
    if (!booking || booking.status !== 'Confirmed' || !['paid', 'paid_with_issue'].includes(booking.paymentStatus)
      || booking.reschedulePaymentRequest?.quoteId !== request.quoteId) {
      fail(409, 'Lịch cũ không còn hợp lệ để hoàn tất dời lịch.', 'RESCHEDULE_PAYMENT_STALE');
    }
    const slot = assertSlot({ serviceId: booking.serviceId, duration: booking.duration, staffId: request.change.staffId,
      date: request.change.date, startTime: request.change.startTime, excludeId: booking.id });
    const change = { ...request.change, endTime: slot.endTime, roomNumber: slot.roomNumber, staffId: slot.staff.id, staffName: slot.staff.name };
    const result = applyConfirmedReschedule(booking, { ...request, change }, payment);
    return result.booking;
  }
  return { list, save, price, authorize, prepareReschedule, confirmReschedule, finalizeReschedulePayment };
}
