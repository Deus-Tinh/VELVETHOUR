import { apiClient } from '../services/apiClient.js';
import { formatVND, formatDate, esc } from '../core/utils.js';
import { renderPaymentCheckout } from './paymentCheckout.js';

export function renderRescheduleQuote(container, quote, { phone = '', onConfirmed = () => {} } = {}) {
  const settlement = quote.settlement;
  container.innerHTML = `
    <section class="reschedule-price-quote" aria-label="Báo giá dời lịch">
      <h4>Kiểm tra thay đổi lịch ${esc(quote.bookingCode || '')}</h4>
      <p>${esc(formatDate(quote.oldDate))} ${esc(quote.oldStartTime)} → <strong>${esc(formatDate(quote.change.date))} ${esc(quote.change.startTime)}</strong></p>
      <p>Chuyên viên: ${esc(quote.change.staffName)}</p>
      <p>Giá cũ: ${formatVND(settlement.oldFinalPrice)} → <strong>Giá mới: ${formatVND(settlement.newFinalPrice)}</strong></p>
      <p>${settlement.priceDelta > 0 ? 'Tổng giá tăng' : settlement.priceDelta < 0 ? 'Tổng giá giảm' : 'Chênh lệch giá'}: <strong>${formatVND(Math.abs(settlement.priceDelta))}</strong></p>
      <p>Đã thanh toán ròng: ${formatVND(settlement.netPaid)} · Còn phải thanh toán: <strong>${formatVND(settlement.amountDue)}</strong></p>
      ${settlement.amountDue > 0 ? `<p style="padding:11px;background:#fff7ed;border-radius:8px;color:#9a3412;">Lịch hiện tại vẫn được giữ. Để đổi sang lịch mới, hãy thanh toán chính xác phần chênh lệch ${formatVND(settlement.amountDue)} bằng QR trong 3 phút. Nếu hết giờ hoặc không nhận đủ tiền, lịch cũ vẫn còn hiệu lực.</p>` : ''}
      ${settlement.refundDue > 0 ? `<p>Cần hoàn 100% phần chênh lệch: <strong>${formatVND(settlement.refundDue)}</strong>. Nhân viên sẽ chuyển thủ công sau khi lịch mới được lưu.</p>
        <div class="form-group"><label for="rescheduleRefundBank">Ngân hàng nhận hoàn</label><input class="form-control" id="rescheduleRefundBank" maxlength="80" autocomplete="off" placeholder="Ví dụ: Techcombank" /></div>
        <div class="form-group"><label for="rescheduleRefundAccount">Số tài khoản nhận hoàn</label><input class="form-control" id="rescheduleRefundAccount" inputmode="numeric" maxlength="19" autocomplete="off" placeholder="Nhập số tài khoản" /></div>
        <div class="form-group"><label for="rescheduleRefundHolder">Tên chủ tài khoản</label><input class="form-control" id="rescheduleRefundHolder" maxlength="80" autocomplete="off" placeholder="Tên chủ tài khoản" /></div>` : ''}
      <p>${quote.newPricing.discountDetails?.sale ? `Áp dụng ${esc(quote.newPricing.campaignName)}${quote.newPricing.promoCode ? ` + voucher ${esc(quote.newPricing.promoCode)}` : ''}. Các khoản giảm được cộng dồn trên giá niêm yết.` : quote.newPricing.promoCode ? `Áp dụng mã ${esc(quote.newPricing.promoCode)}.` : 'Giá niêm yết, không áp dụng sale lễ.'}</p>
      <small>Báo giá có hiệu lực 5 phút và chưa giữ chỗ. Lịch hiện tại chỉ đổi sau khi bạn xác nhận.</small>
      <button type="button" class="btn-primary" data-confirm-price>Xác nhận thay đổi giá</button>
      <p role="status" data-quote-status></p>
    </section>`;
  const button = container.querySelector('[data-confirm-price]');
  const status = container.querySelector('[data-quote-status]');
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = 'Đang kiểm tra giá và khung giờ…';
    try {
      let refundRecipient = null;
      if (settlement.refundDue > 0) {
        refundRecipient = {
          bankName: document.getElementById('rescheduleRefundBank')?.value.trim(),
          accountNumber: document.getElementById('rescheduleRefundAccount')?.value.trim(),
          accountHolder: document.getElementById('rescheduleRefundHolder')?.value.trim(),
        };
        if (!refundRecipient.bankName || !/^\d{6,19}$/.test(refundRecipient.accountNumber)
          || !/^[\p{L} ]{5,80}$/u.test(refundRecipient.accountHolder)) {
          status.textContent = 'Vui lòng nhập đúng thông tin tài khoản nhận hoàn.';
          button.disabled = false;
          return;
        }
      }
      const result = await apiClient.confirmReschedule(quote.bookingId, quote.id, phone, refundRecipient);
      if (result.paymentRequired) {
        status.textContent = 'Lịch cũ vẫn được giữ trong khi xác nhận thanh toán phần chênh lệch.';
        const request = result.booking.reschedulePaymentRequest;
        const paymentBooking = {
          ...result.booking, reschedulePayment: true,
          date: request.change.date, startTime: request.change.startTime, endTime: request.change.endTime,
          staffId: request.change.staffId, staffName: request.change.staffName,
          originalPrice: request.pricing.originalPrice, discountAmount: request.pricing.discountAmount,
          finalPrice: request.pricing.finalPrice, pricingSnapshot: request.pricing,
          rescheduleAmount: request.amount, reschedulePriorPaid: request.settlement.netPaid,
        };
        await renderPaymentCheckout(container, paymentBooking, result.payment, { onPaid: () => onConfirmed(result) });
        return;
      }
      status.textContent = result.refundRequest
        ? `Đã lưu lịch mới. Yêu cầu hoàn phần chênh lệch ${formatVND(result.refundRequest.amount)} đang chờ nhân viên chuyển khoản.`
        : 'Đã lưu lịch mới thành công.';
      button.textContent = 'Đã lưu lịch mới';
      try { await onConfirmed(result); }
      catch {
        status.textContent += ' Không thể làm mới dữ liệu hiển thị; hãy tải lại trang để xem lịch mới.';
      }
    } catch (error) {
      status.textContent = error.message || 'Chưa thể xác nhận. Vui lòng thử lại.';
      if (['QUOTE_STALE', 'QUOTE_EXPIRED', 'BOOKING_CONFLICT', 'STATUS_INVALID', 'RESCHEDULE_TOO_LATE', 'QUOTE_FORBIDDEN'].includes(error.code)) {
        button.textContent = 'Cần lấy báo giá mới';
      } else button.disabled = false;
    }
  });
}
