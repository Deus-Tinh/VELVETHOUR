import { apiClient } from '../services/apiClient.js';
import { esc, formatDate, formatVND } from '../core/utils.js';
import { bindInvoiceDownloadButtons } from './invoicePdf.js';

let countdownTimer = null;
let statusTimer = null;

function stopTimers() {
  if (countdownTimer) clearInterval(countdownTimer);
  if (statusTimer) clearInterval(statusTimer);
  countdownTimer = null;
  statusTimer = null;
}

function renderResult(container, booking, paymentStatus, issue = null) {
  const paid = paymentStatus === 'paid';
  const failed = ['expired', 'cancelled', 'payment_issue', 'paid_with_issue'].includes(paymentStatus);
  const title = booking.reschedulePayment
    ? paid ? 'Đã nhận tiền chênh lệch · lịch mới đã lưu' : failed ? 'Chưa hoàn tất dời lịch' : 'Đang chờ thanh toán chênh lệch'
    : paid ? 'Đã nhận đủ thanh toán' : failed ? 'Chưa thể xác nhận lịch hẹn' : 'Đang chờ thanh toán';
  const color = paid ? '#087f6e' : failed ? '#b42318' : '#a16207';
  const description = booking.reschedulePayment
    ? paid ? 'Lịch mới đã được cập nhật sau khi nhận đủ phần chênh lệch.'
      : failed ? `${issue?.reason || 'Không nhận đủ phần chênh lệch.'} Lịch cũ vẫn được giữ nguyên.`
        : 'Lịch cũ vẫn được giữ cho đến khi thanh toán đủ phần chênh lệch.'
    : paid ? 'Lịch hẹn đã được xác nhận sau khi hệ thống nhận đủ tiền.'
      : failed ? (issue?.reason || 'Khung giờ đã được giải phóng hoặc giao dịch cần nhân viên đối soát.')
        : 'Lịch chỉ được xác nhận sau khi hệ thống nhận đủ tiền.';
  container.innerHTML = `
    <section style="padding:26px;background:#fff;border:1px solid #e7ded4;border-radius:14px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <div>
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#087f6e;font-weight:700;">Thanh toán đặt lịch · ${esc(booking.code)}</div>
          <h3 style="margin:8px 0;color:${color};font-family:var(--font-heading);">${title}</h3>
          <p style="margin:0;color:#64748b;">${esc(description)}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${paid && !booking.reschedulePayment ? `<button type="button" class="btn-primary" data-download-invoice="${esc(booking.id)}">Tải hóa đơn PDF</button>` : ''}
          <a class="btn-outline" href="#/my-bookings" style="text-decoration:none;">Mở lịch của tôi</a>
        </div>
      </div>
      ${issue?.noRefund ? '<p style="margin:16px 0 0;padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412;font-size:13px;">Nếu chuyển thiếu hoặc sai mã, chúng tôi sẽ không hoàn tiền lại. Giao dịch đang được ghi nhận để nhân viên đối soát.</p>' : ''}
      ${paymentStatus === 'expired' ? '<p style="margin:14px 0 0;color:#64748b;font-size:13px;">Mã QR đã hết hạn và chỗ đã được giải phóng. Nếu bạn đã chuyển tiền sát giờ, vui lòng liên hệ Spa để được kiểm tra giao dịch.</p>' : ''}
      ${booking.refundRequest?.status === 'pending' ? `<p style="margin:14px 0 0;color:#64748b;font-size:13px;">Yêu cầu hoàn ${formatVND(booking.refundRequest.amount)} đang chờ nhân viên chuyển khoản.</p>` : ''}
    </section>
  `;
  if (paid && !booking.reschedulePayment) bindInvoiceDownloadButtons(container);
}

function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function paymentBreakdown(booking) {
  const details = booking.pricingSnapshot?.discountDetails;
  const rows = [];
  if (details?.sale) rows.push(`<div class="summary-row" style="color:#15803d;"><span>Khuyến mãi ngày (${esc(booking.pricingSnapshot.campaignName || 'ưu đãi')}):</span><span>− ${formatVND(details.sale.discountAmount)}</span></div>`);
  if (details?.coupon) rows.push(`<div class="summary-row" style="color:#15803d;"><span>Voucher ${esc(details.coupon.code)}:</span><span>− ${formatVND(details.coupon.discountAmount)}</span></div>`);
  if (!rows.length && Number(booking.discountAmount || 0) > 0) rows.push(`<div class="summary-row" style="color:#15803d;"><span>Giảm giá:</span><span>− ${formatVND(booking.discountAmount)}</span></div>`);
  return rows.join('');
}

export async function renderPaymentCheckout(container, booking, initialInstructions = null, options = {}) {
  stopTimers();
  if (!container || !booking) return;
  let instructions = initialInstructions;
  let state = null;
  let completionNotified = false;
  const notifyPaid = async () => {
    if (completionNotified) return;
    completionNotified = true;
    await options.onPaid?.();
  };
  try {
    const result = await apiClient.getBookingPayment(booking.id);
    state = result.payment;
    instructions ||= result.instructions;
    booking = { ...booking, paymentStatus: state?.paymentStatus, bookingStatus: state?.bookingStatus,
      refundRequest: state?.refundRequest };
    if (booking.reschedulePayment) {
      if (state?.reschedulePaymentStatus === 'paid') { renderResult(container, booking, 'paid'); await notifyPaid(); return; }
      if (state?.reschedulePaymentStatus === 'expired') { renderResult(container, booking, 'expired', state.issue); return; }
      if (state?.reschedulePaymentStatus === 'issue') { renderResult(container, booking, 'payment_issue', state.issue); return; }
    }
    if (!booking.reschedulePayment && ['paid', 'expired', 'cancelled', 'payment_issue', 'paid_with_issue'].includes(state?.paymentStatus)) {
      renderResult(container, booking, state.paymentStatus, state.issue);
      return;
    }
  } catch (error) {
    if (!instructions) {
      container.innerHTML = `<div style="padding:20px;color:#b42318;">${esc(error.message || 'Không tải được thông tin thanh toán.')}</div>`;
      return;
    }
  }

  if (!instructions) {
    container.innerHTML = '<div style="padding:20px;background:#fff7ed;border-radius:10px;color:#9a3412;">Mã QR hiện không khả dụng. Chỗ chỉ được xác nhận sau khi nhận đủ tiền. Vui lòng liên hệ Spa trước khi chuyển khoản.</div>';
    return;
  }

  container.innerHTML = `
    <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:22px;padding:24px;background:#fff;border:1px solid #e7ded4;border-radius:14px;align-items:start;">
      <div style="text-align:center;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#087f6e;font-weight:700;">${booking.reschedulePayment ? 'Thanh toán phần chênh lệch · Giữ khung mới 03:00' : 'Thanh toán chuyển khoản · Giữ lịch 03:00'}</div>
        <h3 style="margin:9px 0 14px;font-family:var(--font-heading);">Quét mã VietQR</h3>
        <img src="${esc(instructions.qrUrl)}" alt="Mã QR thanh toán Techcombank" style="width:min(100%,320px);height:auto;border:1px solid #e5e7eb;border-radius:12px;background:white;" />
        <div id="paymentCountdown" role="timer" style="margin:12px auto 0;display:inline-block;padding:7px 12px;border-radius:999px;background:#ecfdf5;color:#087f6e;font-weight:700;">Còn 03:00 để giữ chỗ</div>
      </div>
      <div>
        <div style="display:flex;gap:8px;margin-bottom:15px;">
          <span style="padding:6px 10px;border-radius:7px;background:#087f6e;color:white;font-size:12px;font-weight:700;">Chuyển khoản QR</span>
          <span aria-disabled="true" title="Sẽ mở sau khi tích hợp cổng thẻ" style="padding:6px 10px;border-radius:7px;background:#f1f5f9;color:#94a3b8;font-size:12px;">Thẻ · Chưa mở</span>
        </div>
        <h3 style="font-family:var(--font-heading);margin:0 0 12px;">Thông tin chuyển khoản</h3>
        <div style="display:grid;gap:9px;padding:15px;background:#f8fafc;border-radius:10px;">
          <div><small style="display:block;color:#64748b;">Ngân hàng</small><strong>${esc(instructions.bankName)}</strong></div>
          <div><small style="display:block;color:#64748b;">Chủ tài khoản</small><strong>${esc(instructions.accountHolder)}</strong></div>
          <div><small style="display:block;color:#64748b;">Số tài khoản</small><strong>${esc(instructions.accountNumber)}</strong></div>
          <div><small style="display:block;color:#64748b;">Số tiền cần chuyển chính xác</small><strong style="font-size:20px;color:#087f6e;">${formatVND(instructions.amount)}</strong></div>
          <div><small style="display:block;color:#64748b;">Nội dung chuyển khoản bắt buộc</small><strong style="color:#0f4c81;letter-spacing:.06em;">${esc(instructions.paymentCode)}</strong></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px;">
          <button type="button" class="btn-outline" data-copy-payment="${esc(instructions.accountNumber)}">Sao chép số tài khoản</button>
          <button type="button" class="btn-outline" data-copy-payment="${esc(instructions.paymentCode)}">Sao chép mã chuyển khoản</button>
        </div>
        <p style="margin:14px 0 7px;padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412;font-size:13px;line-height:1.55;">${esc(instructions.warning)}</p>
        <p style="margin:0;color:#64748b;font-size:13px;line-height:1.55;">Đơn ${esc(booking.code)} · ${esc(booking.serviceName)} · ${esc(formatDate(booking.date))} lúc ${esc(booking.startTime)}<br />${esc(booking.staffName || '')}</p>
        <div id="paymentStatusMessage" aria-live="polite" style="margin-top:12px;padding:11px;border-radius:8px;background:#ecfdf5;color:#087f6e;font-size:13px;">Đang chờ hệ thống ngân hàng ghi nhận giao dịch…</div>
      </div>
    </section>
    <section class="booking-summary-box" style="margin-top:16px;">
      <h4 style="margin:0 0 12px;">Tóm tắt đơn</h4>
      <div class="summary-row"><span>Liệu trình</span><strong>${esc(booking.serviceName)}</strong></div>
      <div class="summary-row"><span>${booking.reschedulePayment ? 'Giá niêm yết lịch mới' : 'Giá niêm yết'}</span><span>${formatVND(booking.originalPrice)}</span></div>
      ${paymentBreakdown(booking)}
      ${booking.reschedulePayment ? `<div class="summary-row"><span>Đã thanh toán trước</span><span>${formatVND(booking.reschedulePriorPaid)}</span></div><div class="summary-row total"><span>Thanh toán thêm</span><strong>${formatVND(instructions.amount)}</strong></div>` : `<div class="summary-row total"><span>Tổng cần thanh toán</span><strong>${formatVND(booking.finalPrice)}</strong></div>`}
    </section>
  `;

  container.querySelectorAll('[data-copy-payment]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copyPayment || '');
      button.textContent = 'Đã sao chép';
      setTimeout(() => { if (button.isConnected) button.textContent = button.dataset.copyPayment === instructions.paymentCode ? 'Sao chép mã chuyển khoản' : 'Sao chép số tài khoản'; }, 1600);
    } catch {
      const input = document.createElement('textarea');
      input.value = button.dataset.copyPayment || '';
      document.body.append(input); input.select(); document.execCommand('copy'); input.remove();
      button.textContent = 'Đã sao chép';
    }
  }));

  const expiresAt = Date.parse(instructions.expiresAt || '');
  const countdown = document.getElementById('paymentCountdown');
  const statusMessage = document.getElementById('paymentStatusMessage');
  const containerIsActive = () => container.isConnected;
  let inFlight = false;
  let graceUntil = expiresAt + 120000;
  const refreshStatus = async () => {
    if (!containerIsActive()) { stopTimers(); return; }
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await apiClient.getBookingPayment(booking.id);
      const current = result.payment;
      if (booking.reschedulePayment) {
        if (current.reschedulePaymentStatus === 'paid') {
          stopTimers(); renderResult(container, booking, 'paid'); await notifyPaid();
        } else if (current.reschedulePaymentStatus === 'expired') {
          stopTimers(); renderResult(container, booking, 'expired', current.issue);
        } else if (current.reschedulePaymentStatus === 'issue') {
          stopTimers(); renderResult(container, booking, 'payment_issue', current.issue);
        }
        return;
      }
      if (current.paymentStatus === 'paid') {
        stopTimers();
        renderResult(container, { ...booking, refundRequest: current.refundRequest }, 'paid');
      } else if (['payment_issue', 'paid_with_issue', 'expired', 'cancelled'].includes(current.paymentStatus)) {
        if (current.paymentStatus === 'expired' && Date.now() < graceUntil) {
          if (countdownTimer) clearInterval(countdownTimer);
          countdownTimer = null;
          renderResult(container, { ...booking, refundRequest: current.refundRequest }, 'expired', current.issue);
        } else {
          stopTimers();
          renderResult(container, { ...booking, refundRequest: current.refundRequest }, current.paymentStatus, current.issue);
        }
      }
    } catch { /* Keep the QR visible; retry the status check on the next interval. */ }
    finally { inFlight = false; }
  };
  const updateCountdown = () => {
    if (!containerIsActive()) { stopTimers(); return; }
    const remaining = expiresAt - Date.now();
    if (countdown) countdown.textContent = remaining > 0 ? `Còn ${formatCountdown(remaining)} để giữ chỗ` : 'Đã hết giờ giữ chỗ · Đang kiểm tra giao dịch';
    if (remaining <= 0) {
      if (countdown) { countdown.style.background = '#fff7ed'; countdown.style.color = '#9a3412'; }
      if (statusMessage) { statusMessage.textContent = 'Đang kiểm tra giao dịch gửi sát thời hạn. Nếu đã chuyển tiền, vui lòng chờ hệ thống đối soát.'; statusMessage.style.background = '#fff7ed'; statusMessage.style.color = '#9a3412'; }
      refreshStatus();
    }
  };
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
  statusTimer = setInterval(refreshStatus, 2500);
}
