import { randomBytes, timingSafeEqual } from 'node:crypto';

export const PAYMENT_HOLD_SECONDS = 180;

const digits = (value) => String(value || '').replace(/\D/g, '');

export function paymentConfig(env = process.env) {
  const bankName = String(env.SEPAY_BANK_NAME || '').trim();
  const accountNumber = digits(env.SEPAY_ACCOUNT_NUMBER);
  const accountHolder = String(env.SEPAY_ACCOUNT_HOLDER || '').trim().toUpperCase();
  const webhookApiKey = String(env.SEPAY_WEBHOOK_API_KEY || '').trim();
  const sepayEnabled = String(env.SEPAY_ENABLED || '').trim().toLowerCase() === 'true';
  const directEnabled = String(env.VIETQR_DIRECT_ENABLED || '').trim().toLowerCase() === 'true';
  const accountReady = Boolean(bankName && accountNumber.length >= 6 && accountNumber.length <= 19
    && /^[A-Z ]{5,50}$/.test(accountHolder));
  const sepayReady = sepayEnabled && accountReady && webhookApiKey.length >= 24;
  const directReady = directEnabled && accountReady;
  const ready = sepayReady || directReady;
  const mode = sepayReady ? 'sepay' : directReady ? 'direct_manual' : 'disabled';
  return {
    bankName, accountNumber, accountHolder, webhookApiKey,
    ready,
    configured: accountReady,
    enabled: ready,
    mode,
    holdSeconds: PAYMENT_HOLD_SECONDS,
    cardEnabled: false,
  };
}

export function publicPaymentConfig(env = process.env) {
  const config = paymentConfig(env);
  return {
    enabled: config.ready,
    mode: config.mode,
    bankName: config.ready ? config.bankName : null,
    accountNumber: config.ready ? config.accountNumber : null,
    accountHolder: config.ready ? config.accountHolder : null,
    holdSeconds: config.holdSeconds,
    cardEnabled: false,
    unavailableMessage: config.ready ? null : 'Thanh toán QR đang chờ quản trị viên hoàn tất cấu hình bảo mật SePay hoặc VietQR.',
  };
}

export function createPaymentCode(bookings = []) {
  const existing = new Set(bookings.map((booking) => booking.paymentCode).filter(Boolean));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `VH${randomBytes(5).toString('hex').toUpperCase()}`;
    if (!existing.has(code)) return code;
  }
  throw new Error('Unable to allocate a unique payment code.');
}

export function paymentInstructions(booking, env = process.env, overrides = {}) {
  const config = paymentConfig(env);
  if (!config.ready) return null;
  const amount = Number.isSafeInteger(overrides.amount) ? overrides.amount : booking.finalPrice;
  const expiresAt = overrides.expiresAt || booking.paymentExpiresAt;
  const params = new URLSearchParams({
    acc: config.accountNumber,
    bank: config.bankName,
    amount: String(amount),
    des: booking.paymentCode,
    template: 'compact',
    showinfo: 'true',
    fullacc: 'true',
    holder: config.accountHolder,
  });
  return {
    method: 'bank',
    mode: config.mode,
    bankName: config.bankName,
    accountNumber: config.accountNumber,
    accountHolder: config.accountHolder,
    amount,
    paymentCode: booking.paymentCode,
    expiresAt,
    qrUrl: `https://vietqr.app/img?${params.toString()}`,
    holdSeconds: config.holdSeconds,
    warning: config.mode === 'direct_manual'
      ? 'Vui lòng chuyển chính xác số tiền và mã nội dung. Sau khi chuyển xong, bấm nút "Tôi đã chuyển khoản" để Spa xác nhận lịch.'
      : 'Nếu chuyển thiếu hoặc sai mã, đơn không được tiếp tục và chúng tôi sẽ không hoàn tiền lại.',
  };
}

export function migratePaymentDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      provider TEXT NOT NULL CHECK (provider = 'sepay'),
      provider_transaction_id TEXT NOT NULL CHECK (length(trim(provider_transaction_id)) BETWEEN 1 AND 80),
      booking_id TEXT,
      payment_code TEXT,
      transfer_amount INTEGER NOT NULL CHECK (transfer_amount >= 0),
      transfer_type TEXT NOT NULL,
      transfer_content TEXT NOT NULL DEFAULT '',
      reference_code TEXT NOT NULL DEFAULT '',
      transaction_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('paid', 'underpaid', 'overpaid', 'late', 'slot_taken', 'extra_payment', 'unmatched', 'wrong_account', 'wrong_direction')),
      reason TEXT NOT NULL DEFAULT '',
      received_at TEXT NOT NULL,
      PRIMARY KEY (provider, provider_transaction_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS payment_transactions_booking ON payment_transactions(booking_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS payment_transactions_status ON payment_transactions(status, received_at DESC);
  `);
}

function parseSePayDate(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const text = value.trim();
  const explicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const date = explicitZone ? normalized : `${normalized}+07:00`;
  const milliseconds = Date.parse(date);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function codeInText(value, paymentCode) {
  if (typeof value !== 'string' || !paymentCode) return false;
  const escaped = paymentCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escaped}($|[^A-Z0-9])`, 'i').test(value);
}

function transactionIdValue(value) {
  if (!(typeof value === 'string' || typeof value === 'number')) return '';
  const result = String(value).trim();
  return result.length <= 80 ? result : '';
}

function phoneSafeContent(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 1000);
}

function canStillConfirm(booking, eventAt, findConflict, hasRoomConflict) {
  const createdAt = Date.parse(booking.createdAt || '');
  const expiresAt = Date.parse(booking.paymentExpiresAt || '');
  return booking.status === 'Pending' && booking.paymentStatus === 'awaiting_payment'
    && Number.isFinite(createdAt) && Number.isFinite(expiresAt)
    && eventAt >= createdAt - 5000 && eventAt <= expiresAt
    && !findConflict(booking) && !hasRoomConflict(booking);
}

function paymentRecord(booking, { amount, transactionId, reference, at, issue }) {
  const records = Array.isArray(booking.paymentRecords) ? booking.paymentRecords : [];
  return [...records, {
    id: `pay_sepay_${transactionId}`,
    type: 'payment',
    amount,
    method: 'bank',
    ...(issue ? { refundable: false } : {}),
    reference: String(reference || transactionId).slice(0, 120),
    note: issue ? `SePay báo giao dịch chưa hợp lệ để xác nhận lịch (${issue}). Không tự động hoàn tiền.` : 'SePay xác nhận đã nhận đủ thanh toán.',
    at,
    recordedBy: 'sepay-webhook',
  }];
}

export function createPaymentOperations({ db, getRecord, parseRows, saveRecord, nextVersion, transaction,
  withAudit, findConflict, hasRoomConflict, finalizeReschedulePayment, HttpError, env = process.env }) {
  migratePaymentDatabase(db);
  const insertTransaction = db.prepare(`INSERT OR IGNORE INTO payment_transactions(
    provider, provider_transaction_id, booking_id, payment_code, transfer_amount, transfer_type,
    transfer_content, reference_code, transaction_at, status, reason, received_at
  ) VALUES ('sepay', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const authenticateWebhook = (authorization) => {
    const config = paymentConfig(env);
    const expected = config.mode === 'sepay' ? config.webhookApiKey : '';
    if (!expected || expected.length < 24) return false;
    const provided = typeof authorization === 'string' ? authorization : '';
    const expectedHeader = `Apikey ${expected}`;
    const left = Buffer.from(provided);
    const right = Buffer.from(expectedHeader);
    return left.length === right.length && timingSafeEqual(left, right);
  };

  function expirePendingPayments(now = new Date()) {
    const nowIso = now.toISOString();
    const candidates = parseRows('bookings').filter((booking) => (booking.status === 'Pending'
      && booking.paymentStatus === 'awaiting_payment'
      && (!Number.isFinite(Date.parse(booking.paymentExpiresAt || '')) || Date.parse(booking.paymentExpiresAt || '') <= now.getTime()))
      || (booking.reschedulePaymentRequest && Date.parse(booking.reschedulePaymentRequest.expiresAt || '') <= now.getTime()));
    if (!candidates.length) return 0;
    transaction(() => {
      for (const candidate of candidates) {
        const booking = getRecord('bookings', candidate.id);
        if (!booking) continue;
        const rescheduleRequest = booking.reschedulePaymentRequest;
        if (rescheduleRequest && Date.parse(rescheduleRequest.expiresAt || '') <= now.getTime()) {
          releaseRescheduleCouponReservation(rescheduleRequest);
          saveRecord('bookings', { ...booking, reschedulePaymentRequest: null,
            lastReschedulePaymentStatus: 'expired', lastReschedulePaymentAt: nowIso,
            lastReschedulePaymentRequest: rescheduleRequest, updatedAt: nowIso });
          if (rescheduleRequest.quoteId) db.prepare("UPDATE reschedule_quotes SET status = 'expired' WHERE id = ? AND status = 'pending'").run(rescheduleRequest.quoteId);
          withAudit({ id: 'payment-expiry', role: 'system' }, 'booking.reschedule_payment.expired', booking.id,
            { quoteId: rescheduleRequest.quoteId, amount: rescheduleRequest.amount, expiresAt: rescheduleRequest.expiresAt });
          nextVersion('bookings');
          continue;
        }
        if (booking.status !== 'Pending' || booking.paymentStatus !== 'awaiting_payment'
          || (Number.isFinite(Date.parse(booking.paymentExpiresAt || '')) && Date.parse(booking.paymentExpiresAt || '') > now.getTime())) continue;
        const updated = {
          ...booking,
          status: 'Cancelled',
          paymentStatus: 'expired',
          paymentExpiredAt: nowIso,
          cancelReason: 'Không nhận đủ thanh toán trong 3 phút; đã giải phóng khung giờ.',
          updatedAt: nowIso,
          statusHistory: [...(booking.statusHistory || []), { status: 'Cancelled', at: nowIso, by: 'system', reason: 'payment_expired' }],
        };
        releaseCouponForUnpaidBooking(booking);
        saveRecord('bookings', updated);
        withAudit({ id: 'payment-expiry', role: 'system' }, 'booking.payment.expired', booking.id,
          { paymentCode: booking.paymentCode, expiresAt: booking.paymentExpiresAt });
      }
      nextVersion('bookings');
    });
    return candidates.length;
  }

  function releaseCouponForUnpaidBooking(booking) {
    if (!booking || booking.paymentStatus !== 'awaiting_payment' || !booking.promoCode) return false;
    const coupon = parseRows('promotions').find((row) => row.code?.toUpperCase() === booking.promoCode.toUpperCase());
    if (!coupon || Number(coupon.usedCount || 0) <= 0) return false;
    saveRecord('promotions', { ...coupon, usedCount: Number(coupon.usedCount || 0) - 1 });
    nextVersion('promotions');
    return true;
  }

  function releaseRescheduleCouponReservation(request) {
    if (!request?.reservedPromoId) return false;
    const coupon = getRecord('promotions', request.reservedPromoId);
    if (!coupon || Number(coupon.usedCount || 0) <= 0) return false;
    saveRecord('promotions', { ...coupon, usedCount: Number(coupon.usedCount || 0) - 1 });
    nextVersion('promotions');
    return true;
  }

  function handleWebhook(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(400, 'Dữ liệu webhook SePay không hợp lệ.', 'SEPAY_PAYLOAD_INVALID');
    const providerId = transactionIdValue(payload.id);
    const amount = Number(payload.transferAmount);
    const transferType = String(payload.transferType || '').trim().toLowerCase();
    const destinationAccount = digits(payload.accountNumber);
    const content = phoneSafeContent(payload.content || payload.description || '');
    const referenceCode = String(payload.referenceCode || '').trim().slice(0, 120);
    const eventMilliseconds = parseSePayDate(payload.transactionDate);
    if (!providerId || !Number.isSafeInteger(amount) || amount < 0 || !['in', 'out'].includes(transferType)) {
      throw new HttpError(400, 'Thiếu mã giao dịch, số tiền hoặc chiều giao dịch hợp lệ.', 'SEPAY_PAYLOAD_INVALID');
    }

    const config = paymentConfig(env);
    const receivedAt = new Date().toISOString();
    return transaction(() => {
      // Classify against the current booking while the write lock is held. This
      // prevents two near-simultaneous transfers from both seeing "unpaid" and
      // incorrectly treating the second transfer as the payment that confirms it.
      const bookings = parseRows('bookings');
      const suppliedCode = String(payload.code || '').trim().toUpperCase();
      const matchedBooking = bookings.find((booking) => codeInText(content, booking.paymentCode)
        || (suppliedCode !== '' && suppliedCode === String(booking.paymentCode || '').toUpperCase())) || null;
      const paymentCode = matchedBooking?.paymentCode || String(payload.code || '').trim().toUpperCase().slice(0, 80) || null;
      let status = 'unmatched';
      let reason = 'Không tìm thấy mã thanh toán chính xác trong nội dung giao dịch.';
      if (transferType !== 'in') { status = 'wrong_direction'; reason = 'Webhook không phải giao dịch tiền vào.'; }
      else if (destinationAccount !== config.accountNumber) { status = 'wrong_account'; reason = 'Giao dịch không vào tài khoản nhận đã cấu hình.'; }
      else if (!matchedBooking) { status = 'unmatched'; }
      else if (matchedBooking.reschedulePaymentRequest) {
        const adjustment = matchedBooking.reschedulePaymentRequest;
        if (amount < Number(adjustment.amount)) { status = 'underpaid'; reason = 'Số tiền chuyển thiếu so với phần chênh lệch khi dời lịch.'; }
        else if (amount > Number(adjustment.amount)) { status = 'overpaid'; reason = 'Số tiền chuyển vượt phần chênh lệch khi dời lịch; cần nhân viên đối soát.'; }
        else if (!eventMilliseconds || eventMilliseconds < Date.parse(adjustment.createdAt || '')
          || eventMilliseconds > Date.parse(adjustment.expiresAt || '')) {
          status = 'late'; reason = 'Giao dịch phần chênh lệch không phát sinh trong thời hạn giữ chỗ 3 phút.';
        } else if (matchedBooking.status !== 'Confirmed' || !['paid', 'paid_with_issue'].includes(matchedBooking.paymentStatus)
          || findConflict({ staffId: adjustment.change.staffId, date: adjustment.change.date,
            startTime: adjustment.change.startTime, durationMinutes: matchedBooking.duration, excludeId: matchedBooking.id })
          || hasRoomConflict({ ...matchedBooking, ...adjustment.change })) {
          status = 'slot_taken'; reason = 'Khung giờ mới không còn khả dụng; lịch cũ vẫn được giữ.';
        } else { status = 'paid'; reason = ''; }
      }
      else if (matchedBooking.lastReschedulePaymentRequest
        && amount === Number(matchedBooking.lastReschedulePaymentRequest.amount)
        && (!eventMilliseconds || eventMilliseconds >= Date.parse(matchedBooking.lastReschedulePaymentRequest.createdAt || ''))) {
        status = 'late'; reason = 'Giao dịch phần chênh lệch đến sau khi mã giữ khung giờ mới hết hạn; lịch cũ vẫn được giữ.';
      }
      else if (['paid', 'paid_with_issue'].includes(matchedBooking.paymentStatus)) {
        status = 'extra_payment';
        reason = 'Đơn đã nhận đủ thanh toán trước đó; giao dịch mới cần nhân viên đối soát riêng.';
      } else if (amount < Number(matchedBooking.finalPrice)) {
        status = 'underpaid'; reason = 'Số tiền chuyển thiếu so với tổng thanh toán; đơn không được xác nhận.';
      } else if (amount > Number(matchedBooking.finalPrice)) {
        status = 'overpaid'; reason = 'Số tiền chuyển vượt tổng thanh toán; cần nhân viên đối soát.';
      } else if (!eventMilliseconds) {
        status = 'late'; reason = 'Không đọc được thời điểm giao dịch để xác minh thời hạn giữ lịch.';
      } else if (!canStillConfirm(matchedBooking, eventMilliseconds,
        (booking) => findConflict({ staffId: booking.staffId, date: booking.date, startTime: booking.startTime, durationMinutes: booking.duration, excludeId: booking.id }),
        (booking) => hasRoomConflict(booking))) {
        status = Date.parse(matchedBooking.paymentExpiresAt || '') < eventMilliseconds ? 'late' : 'slot_taken';
        reason = status === 'late' ? 'Giao dịch phát sinh sau thời hạn giữ lịch.' : 'Khung giờ đã được giải phóng hoặc không còn khả dụng.';
      } else {
        status = 'paid'; reason = '';
      }
      const inserted = insertTransaction.run(providerId, matchedBooking?.id || null, paymentCode,
        amount, transferType, content, referenceCode, eventMilliseconds == null ? null : new Date(eventMilliseconds).toISOString(),
        status, reason, receivedAt);
      if (inserted.changes === 0) return { success: true, duplicate: true, status: 'duplicate' };
      if (!matchedBooking) return { success: true, duplicate: false, status };

      const booking = getRecord('bookings', matchedBooking.id);
      if (!booking) return { success: true, duplicate: false, status: 'unmatched' };
      const paidAt = eventMilliseconds == null ? receivedAt : new Date(eventMilliseconds).toISOString();
      const now = new Date().toISOString();
      if (status === 'paid' && booking.reschedulePaymentRequest && ['paid', 'paid_with_issue'].includes(booking.paymentStatus)) {
        const request = booking.reschedulePaymentRequest;
        finalizeReschedulePayment(booking, request, {
          amount, transactionId: providerId, reference: referenceCode, at: paidAt,
        });
        withAudit({ id: 'sepay-webhook', role: 'system' }, 'booking.rescheduled.payment_confirmed', booking.id,
          { providerTransactionId: providerId, amount, paymentCode: booking.paymentCode, quoteId: request.quoteId });
      } else if (status === 'paid' && booking.status === 'Pending' && booking.paymentStatus === 'awaiting_payment') {
        const updated = { ...booking, status: 'Confirmed', paymentStatus: 'paid', paymentPaidAt: paidAt,
          paymentRecords: paymentRecord(booking, { amount, transactionId: providerId, reference: referenceCode, at: paidAt }),
          invoiceSnapshot: {
            number: `HD-${booking.code || booking.id}`,
            issuedAt: paidAt,
            customer: { name: booking.customerName || '', phone: booking.customerPhone || '', email: booking.customerEmail || '' },
            booking: {
              code: booking.code || '', serviceName: booking.serviceName || '', date: booking.date || '',
              startTime: booking.startTime || '', endTime: booking.endTime || '', duration: Number(booking.duration) || 0,
              staffName: booking.staffName || '', roomNumber: booking.roomNumber || null,
              originalPrice: Number(booking.originalPrice) || 0, discountAmount: Number(booking.discountAmount) || 0,
              total: Number(booking.finalPrice) || amount,
            },
            payment: { method: 'Chuyển khoản ngân hàng', amount, reference: String(referenceCode || providerId).slice(0, 120), paidAt },
          },
          statusHistory: [...(booking.statusHistory || []), { status: 'Confirmed', at: now, by: 'sepay-webhook', reason: 'Đã nhận đủ thanh toán.' }],
          updatedAt: now };
        saveRecord('bookings', updated);
        withAudit({ id: 'sepay-webhook', role: 'system' }, 'booking.payment.confirmed', booking.id,
          { providerTransactionId: providerId, amount, paymentCode: booking.paymentCode });
        nextVersion('bookings');
      } else if (status === 'underpaid' || status === 'overpaid' || status === 'late' || status === 'slot_taken' || status === 'extra_payment') {
        const alreadyPaid = ['paid', 'paid_with_issue'].includes(booking.paymentStatus);
        const failedReschedule = Boolean(booking.reschedulePaymentRequest);
        const cancelled = !alreadyPaid && booking.status === 'Pending';
        const issue = status === 'underpaid' ? 'chuyển thiếu' : status === 'overpaid' ? 'chuyển thừa'
          : status === 'late' ? 'chuyển sau hạn' : status === 'slot_taken' ? 'lịch không còn trống' : 'đơn đã nhận thanh toán trước đó';
        const noRefund = status === 'underpaid';
        const updated = {
          ...booking,
          ...(cancelled ? { status: 'Cancelled', cancelledAt: now,
            cancelReason: 'Thanh toán không khớp yêu cầu; đơn không được tiếp tục.' } : {}),
          paymentStatus: failedReschedule ? booking.paymentStatus : alreadyPaid ? 'paid_with_issue' : 'payment_issue',
          paymentIssue: { kind: status, reason, providerTransactionId: providerId, amount, at: paidAt, noRefund },
          paymentRecords: paymentRecord(booking, { amount, transactionId: providerId, reference: referenceCode, at: paidAt, issue }),
          ...(failedReschedule ? { reschedulePaymentRequest: null, lastReschedulePaymentStatus: 'issue',
            lastReschedulePaymentAt: now, lastReschedulePaymentRequest: booking.reschedulePaymentRequest } : {}),
          ...(cancelled ? { statusHistory: [...(booking.statusHistory || []), { status: 'Cancelled', at: now,
            by: 'sepay-webhook', reason: `payment_${status}` }] } : {}),
          updatedAt: now,
        };
        if (cancelled) releaseCouponForUnpaidBooking(booking);
        if (failedReschedule && booking.reschedulePaymentRequest.quoteId) {
          releaseRescheduleCouponReservation(booking.reschedulePaymentRequest);
          db.prepare("UPDATE reschedule_quotes SET status = 'expired' WHERE id = ? AND status = 'pending'").run(booking.reschedulePaymentRequest.quoteId);
        }
        saveRecord('bookings', updated);
        withAudit({ id: 'sepay-webhook', role: 'system' }, `booking.payment.${status}`, booking.id,
          { providerTransactionId: providerId, amount, expectedAmount: booking.finalPrice, paymentCode: booking.paymentCode });
        nextVersion('bookings');
      }
      return { success: true, duplicate: false, status, bookingId: booking.id };
    });
  }

  function paymentStatusFor(booking) {
    return {
      bookingId: booking.id,
      bookingCode: booking.code,
      bookingStatus: booking.status,
      paymentStatus: booking.paymentStatus || 'legacy',
      customerTransferReport: booking.customerTransferReport || null,
      reschedulePaymentStatus: booking.reschedulePaymentRequest ? 'awaiting_payment'
        : booking.lastReschedulePaymentStatus || null,
      reschedulePayment: booking.reschedulePaymentRequest ? {
        amount: Number(booking.reschedulePaymentRequest.amount),
        expiresAt: booking.reschedulePaymentRequest.expiresAt,
        quoteId: booking.reschedulePaymentRequest.quoteId,
      } : null,
      amount: Number(booking.finalPrice || 0),
      paymentCode: booking.paymentCode || null,
      expiresAt: booking.paymentExpiresAt || null,
      issue: booking.paymentIssue ? { kind: booking.paymentIssue.kind, reason: booking.paymentIssue.reason,
        noRefund: booking.paymentIssue.noRefund === true } : null,
      refundRequest: booking.refundRequest ? {
        amount: booking.refundRequest.amount,
        kind: booking.refundRequest.kind || 'customer_cancellation_50',
        status: booking.refundRequest.status,
        requestedAt: booking.refundRequest.requestedAt,
      } : null,
    };
  }

  function reconciliation() {
    const events = db.prepare(`SELECT provider_transaction_id, booking_id, payment_code, transfer_amount, transfer_type,
      transfer_content, reference_code, transaction_at, status, reason, received_at
      FROM payment_transactions ORDER BY received_at DESC LIMIT 200`).all().map((row) => ({
      providerTransactionId: row.provider_transaction_id, bookingId: row.booking_id, paymentCode: row.payment_code,
      amount: row.transfer_amount, transferType: row.transfer_type, content: row.transfer_content,
      referenceCode: row.reference_code, transactionAt: row.transaction_at, status: row.status,
      reason: row.reason, receivedAt: row.received_at,
      bookingCode: row.booking_id ? getRecord('bookings', row.booking_id)?.code || null : null,
      refundStatus: row.booking_id ? (() => {
        const booking = getRecord('bookings', row.booking_id);
        const request = booking?.refundRequest;
        if (request?.sourceTransactionId === row.provider_transaction_id) return request.status;
        return booking?.paymentRecords?.some((record) => record.type === 'refund'
          && record.sourceTransactionId === row.provider_transaction_id) ? 'completed' : null;
      })() : null,
    }));
    const refunds = parseRows('bookings').filter((booking) => booking.refundRequest).map((booking) => ({
      bookingId: booking.id, bookingCode: booking.code, customerName: booking.customerName,
      customerPhone: booking.customerPhone, serviceName: booking.serviceName, amount: booking.refundRequest.amount,
      paidAmount: booking.refundRequest.paidAmount, kind: booking.refundRequest.kind || 'customer_cancellation_50', status: booking.refundRequest.status,
      requestedAt: booking.refundRequest.requestedAt, recipient: booking.refundRequest.recipient,
      referenceCode: booking.refundRequest.referenceCode || null,
    }));
    const bookings = parseRows('bookings')
      .filter((booking) => booking.paymentCode)
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
      .slice(0, 300)
      .map((booking) => ({ id: booking.id, code: booking.code, customerName: booking.customerName,
        customerPhone: booking.customerPhone, serviceName: booking.serviceName, amount: Number(booking.finalPrice || 0),
        status: booking.status, paymentStatus: booking.paymentStatus, paymentCode: booking.paymentCode,
        customerTransferReport: booking.customerTransferReport || null, createdAt: booking.createdAt }));
    return { events, refunds, bookings, payment: publicPaymentConfig(env) };
  }

  function linkUnmatchedTransaction({ providerTransactionId, bookingId, actor }) {
    const id = transactionIdValue(providerTransactionId);
    if (!id) throw new HttpError(400, 'Mã giao dịch không hợp lệ.', 'PAYMENT_TRANSACTION_INVALID');
    const result = transaction(() => {
      const event = db.prepare(`SELECT provider_transaction_id, booking_id, payment_code, transfer_amount,
        transfer_type, reference_code, transaction_at, received_at, status, reason FROM payment_transactions
        WHERE provider = 'sepay' AND provider_transaction_id = ?`).get(id);
      if (!event || event.status !== 'unmatched' || event.booking_id) {
        throw new HttpError(409, 'Giao dịch này đã được ghép hoặc không thuộc nhóm sai/thiếu mã.', 'PAYMENT_EVENT_NOT_LINKABLE');
      }
      const booking = getRecord('bookings', String(bookingId || ''));
      if (!booking?.paymentCode) throw new HttpError(404, 'Không tìm thấy đơn QR để đối soát.', 'BOOKING_NOT_FOUND');
      const now = new Date().toISOString();
      const reason = `Nhân viên đã gắn thủ công giao dịch sai/thiếu mã vào đơn ${booking.code}. Đơn không được xác nhận và không hoàn tiền tự động.`;
      const matchedTime = event.transaction_at || event.received_at || now;
      const alreadyPaid = booking.paymentStatus === 'paid';
      const failedReschedule = Boolean(booking.reschedulePaymentRequest);
      const cancelPending = booking.status === 'Pending';
      const updated = {
        ...booking,
        ...(cancelPending ? { status: 'Cancelled', cancelledAt: now,
          cancelReason: 'Giao dịch không có đúng mã chuyển khoản; đơn không được tiếp tục.' } : {}),
        paymentStatus: failedReschedule ? booking.paymentStatus : alreadyPaid ? 'paid_with_issue' : 'payment_issue',
        paymentIssue: { kind: 'unmatched', reason, providerTransactionId: id, amount: Number(event.transfer_amount), at: matchedTime, noRefund: true },
        paymentRecords: [...(booking.paymentRecords || []), {
          id: `pay_sepay_${id}`, type: 'payment', amount: Number(event.transfer_amount), method: 'bank',
          refundable: false,
          reference: String(event.reference_code || id).slice(0, 120),
          note: 'Đã ghép thủ công giao dịch sai/thiếu mã để báo khách; đơn không được xác nhận, không hoàn tự động.',
          at: matchedTime, recordedBy: 'admin-reconciliation',
        }],
        ...(failedReschedule ? { reschedulePaymentRequest: null, lastReschedulePaymentStatus: 'issue',
          lastReschedulePaymentAt: now, lastReschedulePaymentRequest: booking.reschedulePaymentRequest } : {}),
        ...(cancelPending ? { statusHistory: [...(booking.statusHistory || []), { status: 'Cancelled', at: now,
          by: actor.id, reason: 'payment_unmatched' }] } : {}),
        updatedAt: now,
      };
      const updateEvent = db.prepare(`UPDATE payment_transactions SET booking_id = ?, reason = ?
        WHERE provider = 'sepay' AND provider_transaction_id = ? AND status = 'unmatched' AND booking_id IS NULL`)
        .run(booking.id, reason, id);
      if (!updateEvent.changes) throw new HttpError(409, 'Giao dịch vừa được đối soát ở nơi khác.', 'PAYMENT_EVENT_NOT_LINKABLE');
      if (cancelPending) releaseCouponForUnpaidBooking(booking);
      if (failedReschedule) {
        releaseRescheduleCouponReservation(booking.reschedulePaymentRequest);
        db.prepare("UPDATE reschedule_quotes SET status = 'expired' WHERE id = ? AND status = 'pending'").run(booking.reschedulePaymentRequest.quoteId);
      }
      saveRecord('bookings', updated);
      nextVersion('bookings');
      withAudit(actor, 'booking.payment.unmatched_linked', booking.id, { providerTransactionId: id,
        amount: Number(event.transfer_amount), noRefund: true, bookingCode: booking.code });
      return updated;
    });
    return result;
  }

  function markRefundComplete(booking, { referenceCode, note, actor }) {
    if (!booking?.refundRequest || booking.refundRequest.status !== 'pending') {
      throw new HttpError(409, 'Không có yêu cầu hoàn tiền đang chờ xử lý.', 'REFUND_NOT_PENDING');
    }
    const reference = String(referenceCode || '').trim();
    if (reference.length < 3 || reference.length > 120) throw new HttpError(400, 'Cần mã giao dịch chuyển hoàn hợp lệ.', 'REFUND_REFERENCE_INVALID');
    const request = booking.refundRequest;
    const entry = {
      id: `refund_${request.id}`, type: 'refund', amount: request.amount, method: 'bank',
      ...(request.sourceTransactionId ? { sourceTransactionId: request.sourceTransactionId } : {}),
      reference, note: String(note || (request.kind === 'reschedule_price_difference'
        ? 'Nhân viên xác nhận đã hoàn phần chênh lệch giá.'
        : request.kind === 'manual_payment_review' ? 'Đã hoàn theo quyết định đối soát của Admin.'
          : 'Nhân viên xác nhận đã chuyển khoản hoàn 50%.')).trim().slice(0, 300),
      at: new Date().toISOString(), recordedBy: actor.id,
    };
    const updated = { ...booking, refundRequest: { ...request, status: 'completed', completedAt: entry.at,
      completedBy: actor.id, referenceCode: reference },
    paymentRecords: [...(booking.paymentRecords || []), entry], updatedAt: entry.at };
    return updated;
  }

  function createIssueRefund({ providerTransactionId, amount, recipient: inputRecipient, note, actor }) {
    const id = transactionIdValue(providerTransactionId);
    const refundAmount = Number(amount);
    if (!id || !Number.isSafeInteger(refundAmount) || refundAmount <= 0) {
      throw new HttpError(400, 'Mã giao dịch và số tiền hoàn phải hợp lệ.', 'REFUND_AMOUNT_INVALID');
    }
    return transaction(() => {
      const event = db.prepare(`SELECT booking_id, transfer_amount, status, provider_transaction_id
        FROM payment_transactions WHERE provider = 'sepay' AND provider_transaction_id = ?`).get(id);
      if (!event || !event.booking_id || !['overpaid', 'late', 'slot_taken', 'extra_payment'].includes(event.status)) {
        throw new HttpError(409, 'Chỉ giao dịch thừa, đến sau hạn, mất khung giờ hoặc chuyển lặp mới được đưa ra quyết định hoàn thủ công.', 'REFUND_EVENT_NOT_ELIGIBLE');
      }
      if (refundAmount > Number(event.transfer_amount)) throw new HttpError(409, 'Số tiền đề nghị hoàn không được vượt giao dịch đang đối soát.', 'REFUND_EXCEEDS_TRANSACTION');
      const booking = getRecord('bookings', event.booking_id);
      if (!booking) throw new HttpError(404, 'Không tìm thấy đơn liên quan giao dịch.', 'BOOKING_NOT_FOUND');
      const records = Array.isArray(booking.paymentRecords) ? booking.paymentRecords : [];
      if (records.some((record) => record.type === 'refund' && record.sourceTransactionId === id)) {
        throw new HttpError(409, 'Giao dịch này đã được hoàn trước đó.', 'REFUND_ALREADY_COMPLETED');
      }
      if (booking.refundRequest?.status === 'pending') {
        throw new HttpError(409, 'Đơn đang có yêu cầu hoàn tiền khác cần xử lý trước.', 'REFUND_PENDING');
      }
      const bankName = String(inputRecipient?.bankName || '').trim().slice(0, 80);
      const accountHolder = String(inputRecipient?.accountHolder || '').trim().toUpperCase().slice(0, 80);
      const accountNumber = String(inputRecipient?.accountNumber || '').replace(/\D/g, '');
      if (!bankName || !/^[\p{L} ]{5,80}$/u.test(accountHolder) || !/^\d{6,19}$/.test(accountNumber)) {
        throw new HttpError(400, 'Cần nhập đúng ngân hàng, số tài khoản và tên chủ tài khoản nhận hoàn.', 'REFUND_RECIPIENT_INVALID');
      }
      const now = new Date().toISOString();
      const request = { id: `rfd_${randomBytes(12).toString('hex')}`, kind: 'manual_payment_review',
        amount: refundAmount, paidAmount: Number(event.transfer_amount), status: 'pending', requestedAt: now,
        recipient: { bankName, accountHolder, accountNumber }, sourceTransactionId: id,
        note: String(note || 'Admin đã quyết định hoàn thủ công sau đối soát giao dịch.').trim().slice(0, 300) };
      const updated = { ...booking, refundRequest: request, updatedAt: now };
      saveRecord('bookings', updated);
      nextVersion('bookings');
      withAudit(actor, 'booking.payment_issue.refund_requested', booking.id,
        { providerTransactionId: id, amount: refundAmount, bookingCode: booking.code });
      return updated;
    });
  }

  return { authenticateWebhook, expirePendingPayments, handleWebhook, paymentStatusFor, reconciliation,
    linkUnmatchedTransaction, markRefundComplete, createIssueRefund, releaseCouponForUnpaidBooking };
}
