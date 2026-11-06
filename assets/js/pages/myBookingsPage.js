/**
 * Trang Lịch Hẹn Của Tôi & Hồ Sơ Khách Hàng (/lich-cua-toi).
 * Tính năng:
 * - Tra cứu lịch theo SĐT hoặc xem theo tài khoản đăng nhập.
 * - Danh sách Lịch sắp tới & Lịch sử hoàn thành.
 * - Hủy lịch hẹn (kiểm tra điều kiện chính sách Spa không được hủy sát giờ).
 * - Đặt lại dịch vụ (Rebook CTA).
 * - Gửi đánh giá cho các lịch Completed.
 * - Quản lý liệu trình yêu thích (Favorites).
 * - Đăng nhập / Đăng ký / Cập nhật hồ sơ cá nhân.
 */
import { bookingService } from '../services/bookingService.js';
import { authService } from '../services/authService.js';
import { apiClient } from '../services/apiClient.js';
import { staffService } from '../services/staffSettingsPromoService.js';
import { favoriteService, reviewService } from '../services/socialAndAnalyticsService.js';
import { formatVND, esc, formatDate, todayStr } from '../core/utils.js';
import { showToast, openChangePasswordModal } from '../ui/components.js';
import { renderRescheduleQuote } from '../ui/rescheduleQuote.js';
import { renderPaymentCheckout } from '../ui/paymentCheckout.js';
import { bindInvoiceDownloadButtons } from '../ui/invoicePdf.js';

let activeTab = 'bookings'; // 'bookings' | 'favorites' | 'profile'

export function renderMyBookingsPage() {
  const root = document.getElementById('appRoot');
  if (!root) return;

  const currentUser = authService.getCurrentUser();

  root.innerHTML = `
    <div class="page-banner" style="padding: 40px 20px;">
      <div class="breadcrumbs"><a href="/" style="color:inherit;text-decoration:none;">Trang Chủ</a> / Lịch Của Tôi</div>
      <h1 style="font-size: 2.2rem;">TRUNG TÂM KHÁCH HÀNG &amp; LỊCH HẸN</h1>
      <p>Tra cứu lịch trị liệu, đánh giá trải nghiệm và quản lý các liệu trình spa yêu thích.</p>
    </div>

    <div class="section-container" style="padding-top: 35px; padding-bottom: 70px;">
      <!-- Khối Đăng Nhập / Thông Tin Tài Khoản -->
      <div style="background: #fff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); padding: 20px; margin-bottom: 30px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 15px;">
        ${currentUser ? `
          <div style="display: flex; align-items: center; gap: 15px;">
            <div style="width: 50px; height: 50px; border-radius: 50%; background: var(--primary-brown); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: bold;">
              ${currentUser.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style="font-weight: bold; font-size: 16px; color: var(--text-dark);">
                Xin chào, ${esc(currentUser.name)}
                <span class="badge-status badge-confirmed" style="margin-left: 6px; font-size: 10px;">${currentUser.role}</span>
              </div>
              <div style="font-size: 13px; color: #64748b;">${esc(currentUser.phone)} • ${esc(currentUser.email)}</div>
            </div>
          </div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button type="button" class="btn-outline btn-sm" id="custChangePasswordBtn">🔑 Đổi Mật Khẩu</button>
            <button type="button" class="btn-outline btn-sm" id="custLogoutBtn">Đăng Xuất</button>
          </div>
        ` : `
          <div>
            <strong style="color: var(--text-dark); font-size: 15px;">Quý khách chưa đăng nhập?</strong>
            <p style="color: var(--text-light); font-size: 13px; margin: 4px 0 0 0;">
              Đăng nhập để tự động đồng bộ tất cả lịch hẹn hoặc tra cứu nhanh bằng số điện thoại bên dưới.
            </p>
          </div>
          <div>
            <a href="/dang-nhap" class="btn-primary" style="padding: 9px 18px; font-size: 13px; text-decoration: none;">
              🔑 Đăng Nhập / Đăng Ký
            </a>
          </div>
        `}
      </div>

      <!-- Tabs Navigation -->
      <div class="dash-tabs-bar">
        <button type="button" class="dash-tab-btn ${activeTab === 'bookings' ? 'active' : ''}" data-tab="bookings">
          📅 Danh Sách Lịch Hẹn
        </button>
        <button type="button" class="dash-tab-btn ${activeTab === 'favorites' ? 'active' : ''}" data-tab="favorites">
          ♥ Liệu Trình Yêu Thích
        </button>
        ${currentUser ? `
          <button type="button" class="dash-tab-btn ${activeTab === 'profile' ? 'active' : ''}" data-tab="profile">
            👤 Hồ Sơ Của Tôi
          </button>
        ` : ''}
      </div>

      <!-- Tab Content Area -->
      <div id="myTabContentArea"></div>
    </div>
  `;

  document.getElementById('custChangePasswordBtn')?.addEventListener('click', () => {
    openChangePasswordModal({
      user: currentUser,
      onChangePassword: (uid, oldPass, newPass, confirmPass) =>
        authService.changePassword(uid, oldPass, newPass, confirmPass),
    });
  });

  document.getElementById('custLogoutBtn')?.addEventListener('click', () => {
    authService.logout();
    showToast('Đã đăng xuất tài khoản.', 'normal');
    renderMyBookingsPage();
  });

  document.querySelectorAll('.dash-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.getAttribute('data-tab');
      document.querySelectorAll('.dash-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderTabContent();
    });
  });

  renderTabContent();
}

function renderTabContent() {
  const container = document.getElementById('myTabContentArea');
  if (!container) return;

  const currentUser = authService.getCurrentUser();

  if (activeTab === 'bookings') {
    renderBookingsTab(container, currentUser);
  } else if (activeTab === 'favorites') {
    renderFavoritesTab(container, currentUser);
  } else if (activeTab === 'profile') {
    renderProfileTab(container, currentUser);
  }
}

/* ---------------- TAB LỊCH HẸN ---------------- */
async function renderBookingsTab(container, currentUser) {
  let list = [];
  if (currentUser) {
    if (apiClient.isOnline()) {
      try { await apiClient.refresh(); }
      catch (error) { console.warn('[bookings] Không làm mới được lịch từ máy chủ:', error.message); }
    }
    list = bookingService.byCustomer(currentUser.id, currentUser.phone);
  } else {
    // Nếu chưa đăng nhập, hiển thị ô tra cứu bằng SĐT
    const savedPhone = sessionStorage.getItem('search_phone') || '';
    if (savedPhone) {
      if (apiClient.isOnline()) {
        try { list = (await apiClient.bookingsByPhone(savedPhone)).bookings || []; }
        catch (error) { showToast(error.message || 'Không tra cứu được lịch hẹn.', 'danger'); }
      } else {
        list = bookingService.byCustomer(null, savedPhone);
      }
    }
  }

  container.innerHTML = `
    ${!currentUser ? `
      <div style="background: #fafaf9; border: 1px solid #e7ded4; border-radius: 8px; padding: 18px; margin-bottom: 25px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center;">
        <label style="font-size: 13px; font-weight: 600; color: var(--text-dark);">Tra cứu nhanh theo SĐT:</label>
        <input type="tel" class="form-control" id="searchPhoneInput" placeholder="Nhập số điện thoại đã đặt lịch..." value="${esc(sessionStorage.getItem('search_phone') || '')}" style="width: 250px;" />
        <button type="button" class="btn-primary" id="searchPhoneBtn" style="padding: 10px 18px; font-size: 13px;">Tra Cứu</button>
      </div>
    ` : ''}

    ${list.length === 0 ? `
      <div style="text-align: center; padding: 60px 20px; background: #fff; border-radius: 8px;">
        <div style="font-size: 40px; margin-bottom: 15px;">📅</div>
        <h3 style="color: var(--text-dark); margin-bottom: 8px;">Chưa có lịch hẹn nào</h3>
        <p style="color: var(--text-light); font-size: 14px; margin-bottom: 20px;">
          Quý khách chưa có lịch đặt nào hoặc chưa nhập đúng số điện thoại.
        </p>
        <a href="/dat-lich" class="btn-primary" style="display: inline-block; text-decoration: none;">
          Đặt Lịch Ngay Hôm Nay
        </a>
      </div>
    ` : `
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Mã Đặt Lịch</th>
              <th>Liệu Trình</th>
              <th>Chuyên Viên</th>
              <th>Thời Gian</th>
              <th>Giá Tiền</th>
              <th>Trạng Thái</th>
              <th>Thao Tác</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((b) => {
              const statusBadgeClass = bookingStatusClass(b.status);
              const canReschedule = b.status === 'Confirmed' && (!b.paymentCode || b.paymentStatus === 'paid');

              const canCancel = ['Pending', 'Confirmed'].includes(b.status);
              const canReview = b.status === 'Completed' && currentUser?.role === 'customer' && b.userId === currentUser.id;

              return `
                <tr>
                  <td><strong>${esc(b.code)}</strong></td>
                  <td>
                    <div><strong>${esc(b.serviceName)}</strong></div>
                    <div style="font-size: 11px; color: #64748b;">⏱ ${b.duration} Phút</div>
                  </td>
                  <td>${esc(b.staffName)}</td>
                  <td>
                    <div style="font-weight: 600; color: var(--primary-brown);">${b.startTime} - ${b.endTime}</div>
                    <div style="font-size: 11px; color: #64748b;">${formatDate(b.date)}</div>
                    ${b.roomNumber ? `<div style="font-size:11px;color:#64748b;">Phòng ${Number(b.roomNumber)}</div>` : ''}
                  </td>
                  <td>
                    <div style="font-weight: bold; color: var(--accent-orange);">${formatVND(b.finalPrice)}</div>
                    ${b.discountAmount > 0 ? `<div style="font-size: 10px; color: #15803d;">Đã giảm ${formatVND(b.discountAmount)}</div>` : ''}
                  </td>
                  <td>
                    <span class="badge-status ${statusBadgeClass}">${bookingStatusLabel(b.status, b)}</span>
                    ${b.paymentStatus === 'awaiting_payment' ? '<small style="display:block;color:#a16207;font-size:11px;margin-top:4px;">Mã QR còn hiệu lực tối đa 3 phút</small>' : ''}
                    ${b.reschedulePaymentRequest ? '<small style="display:block;color:#a16207;font-size:11px;margin-top:4px;">Đang giữ khung giờ mới 3 phút để thanh toán chênh lệch</small>' : ''}
                    ${b.paymentIssue ? `<small style="display:block;color:#b42318;font-size:11px;line-height:1.45;margin-top:5px;">${esc(b.paymentIssue.reason || 'Giao dịch cần nhân viên đối soát.')}${b.paymentIssue.noRefund ? ' Nếu chuyển thiếu hoặc sai mã, chúng tôi sẽ không hoàn tiền lại.' : ''}</small>` : ''}
                    ${b.refundRequest ? `<small style="display:block;color:#64748b;font-size:11px;margin-top:4px;">${b.refundRequest.kind === 'reschedule_price_difference' ? 'Hoàn chênh lệch ' : b.refundRequest.kind === 'manual_payment_review' ? 'Hoàn theo đối soát ' : 'Hoàn 50% '}${formatVND(b.refundRequest.amount)} · ${b.refundRequest.status === 'pending' ? 'đang chờ chuyển khoản' : 'đã chuyển khoản'}</small>` : ''}
                  </td>
                  <td>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                      ${b.paymentStatus === 'awaiting_payment' && b.status === 'Pending' ? `<button type="button" class="btn-sm btn-primary continue-payment-btn" data-id="${esc(b.id)}">Tiếp tục thanh toán</button>` : ''}
                      ${b.reschedulePaymentRequest ? `<button type="button" class="btn-sm btn-primary continue-reschedule-payment-btn" data-id="${esc(b.id)}">Thanh toán chênh lệch</button>` : ''}
                      ${b.paymentStatus === 'paid' || b.invoiceSnapshot ? `<button type="button" class="btn-sm btn-outline download-invoice-btn" data-download-invoice="${esc(b.id)}">Hóa đơn PDF</button>` : ''}
                      ${canCancel ? `
                        <button type="button" class="btn-sm btn-outline cancel-booking-btn" data-id="${esc(b.id)}" style="color: #dc2626; border-color: #dc2626;">
                          Hủy Lịch
                        </button>
                      ` : ''}
                      ${canReschedule ? `
                        <button type="button" class="btn-sm btn-outline reschedule-booking-btn" data-id="${esc(b.id)}">
                          Dời Lịch
                        </button>
                      ` : ''}
                      ${canReview ? `
                        <button type="button" class="btn-sm btn-primary review-booking-btn" data-id="${esc(b.id)}">
                          Đánh Giá
                        </button>
                      ` : ''}
                      <a href="/dat-lich?service=${esc(b.serviceId)}" class="btn-sm btn-outline" style="text-decoration:none;">
                        Đặt Lại
                      </a>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;

  bindInvoiceDownloadButtons(container);

  // Tìm kiếm theo SĐT
  document.getElementById('searchPhoneBtn')?.addEventListener('click', async () => {
    const p = document.getElementById('searchPhoneInput')?.value.trim();
    if (!p) { showToast('Vui lòng nhập số điện thoại!', 'danger'); return; }
    sessionStorage.setItem('search_phone', p);
    await renderBookingsTab(container, currentUser);
  });

  container.querySelectorAll('.continue-payment-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const booking = list.find((item) => item.id === btn.getAttribute('data-id'));
      if (!booking) return;
      const modal = document.getElementById('serviceModal');
      const body = document.getElementById('serviceModalBody');
      if (!modal || !body) return;
      try {
        const result = await apiClient.getBookingPayment(booking.id);
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        await renderPaymentCheckout(body, booking, result.instructions);
      } catch (error) { showToast(error.message || 'Không tải lại được mã QR.', 'danger'); }
    });
  });

  container.querySelectorAll('.continue-reschedule-payment-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const booking = list.find((item) => item.id === btn.getAttribute('data-id'));
      const request = booking?.reschedulePaymentRequest;
      if (!booking || !request) return;
      const modal = document.getElementById('serviceModal');
      const body = document.getElementById('serviceModalBody');
      if (!modal || !body) return;
      const paymentBooking = {
        ...booking, reschedulePayment: true,
        date: request.change.date, startTime: request.change.startTime, endTime: request.change.endTime,
        staffId: request.change.staffId, staffName: request.change.staffName,
        originalPrice: request.pricing.originalPrice, discountAmount: request.pricing.discountAmount,
        finalPrice: request.pricing.finalPrice, pricingSnapshot: request.pricing,
        rescheduleAmount: request.amount, reschedulePriorPaid: request.settlement.netPaid,
      };
      try {
        const result = await apiClient.getBookingPayment(booking.id);
        modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false');
        await renderPaymentCheckout(body, paymentBooking, result.instructions, { onPaid: async () => {
          modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true');
          await renderBookingsTab(container, currentUser);
        } });
      } catch (error) { showToast(error.message || 'Không tải được QR thanh toán chênh lệch.', 'danger'); }
    });
  });

  // Hủy lịch
  container.querySelectorAll('.cancel-booking-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bid = btn.getAttribute('data-id');
      const booking = list.find((item) => item.id === bid);
      if (booking) openCancelBookingModal(booking, currentUser, async (refundRecipient) => {
        try {
          const result = await bookingService.cancelByCustomer(bid, currentUser || sessionStorage.getItem('search_phone'), refundRecipient);
          showToast(result.refundRequest
            ? `Lịch đã hủy. Đã ghi nhận đề nghị hoàn ${formatVND(result.refundRequest.amount)}.`
            : 'Đã hủy lịch hẹn thành công.', 'success');
          await renderBookingsTab(container, currentUser);
        } catch (err) {
          showToast(err.message || 'Không thể hủy lịch.', 'danger');
        }
      });
    });
  });

  container.querySelectorAll('.reschedule-booking-btn').forEach((btn) => {
    btn.addEventListener('click', async () => openRescheduleModal(btn.getAttribute('data-id'), currentUser, container));
  });

  // Đánh giá lịch Completed
  container.querySelectorAll('.review-booking-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bid = btn.getAttribute('data-id');
      openReviewModal(bid, currentUser);
    });
  });
}

function netPaidForBooking(booking) {
  const records = Array.isArray(booking.paymentRecords) ? booking.paymentRecords : [];
  const collected = records.filter((record) => record.type !== 'refund' && record.refundable !== false).reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const refunded = records.filter((record) => record.type === 'refund').reduce((sum, record) => sum + Number(record.amount || 0), 0);
  return Math.max(0, collected - refunded);
}

function openCancelBookingModal(booking, currentUser, onConfirm) {
  const modal = document.getElementById('serviceModal');
  const body = document.getElementById('serviceModalBody');
  if (!modal || !body) return;
  const paidAmount = netPaidForBooking(booking);
  const refundAmount = Math.round(paidAmount / 2);
  body.innerHTML = `
    <div style="padding:26px;max-width:540px;margin:0 auto;">
      <h3 style="font-family:var(--font-heading);font-size:1.35rem;margin:0 0 8px;color:var(--text-dark);">Hủy lịch ${esc(booking.code)}?</h3>
      <p style="color:#64748b;line-height:1.55;">Lịch cần được hủy trước giờ hẹn tối thiểu 2 tiếng theo chính sách Spa.</p>
      ${paidAmount > 0 ? `
        <div style="padding:13px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412;font-size:13px;line-height:1.55;">
          Đã thanh toán ${formatVND(paidAmount)}. Spa sẽ hoàn lại 50% (${formatVND(refundAmount)}); nhân viên chuyển khoản thủ công sau khi kiểm tra thông tin bên dưới.
        </div>
        <div class="form-group" style="margin-top:14px;"><label for="refundBankName">Ngân hàng nhận hoàn</label><input class="form-control" id="refundBankName" maxlength="80" autocomplete="off" placeholder="Ví dụ: Techcombank" /></div>
        <div class="form-group"><label for="refundAccountNumber">Số tài khoản nhận hoàn</label><input class="form-control" id="refundAccountNumber" inputmode="numeric" maxlength="19" autocomplete="off" placeholder="Nhập số tài khoản" /></div>
        <div class="form-group"><label for="refundAccountHolder">Tên chủ tài khoản</label><input class="form-control" id="refundAccountHolder" maxlength="80" autocomplete="off" placeholder="Tên không dấu, viết hoa" /></div>
      ` : `
        <p style="padding:12px;background:#f8fafc;border-radius:8px;color:#475569;font-size:13px;">Chưa có thanh toán nào được ghi nhận cho lịch này nên không phát sinh hoàn tiền.</p>
      `}
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;">
        <button type="button" class="btn-outline" id="cancelBookingDialogClose">Quay lại</button>
        <button type="button" class="btn-primary" id="cancelBookingDialogConfirm" style="background:#dc2626;border-color:#dc2626;">Xác nhận hủy</button>
      </div>
    </div>
  `;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  const close = () => { modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); };
  document.getElementById('cancelBookingDialogClose')?.addEventListener('click', close);
  document.getElementById('cancelBookingDialogConfirm')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const refundRecipient = paidAmount > 0 ? {
      bankName: document.getElementById('refundBankName')?.value.trim(),
      accountNumber: document.getElementById('refundAccountNumber')?.value.trim(),
      accountHolder: document.getElementById('refundAccountHolder')?.value.trim(),
    } : null;
    if (paidAmount > 0 && (!refundRecipient.bankName || !/^\d{6,19}$/.test(refundRecipient.accountNumber)
      || !/^[\p{L} ]{5,80}$/u.test(refundRecipient.accountHolder))) {
      showToast('Vui lòng nhập đúng ngân hàng, số tài khoản và tên chủ tài khoản để nhận hoàn tiền.', 'danger');
      return;
    }
    button.disabled = true;
    try { close(); await onConfirm(refundRecipient); }
    finally { if (button.isConnected) button.disabled = false; }
  });
}

async function openRescheduleModal(bookingId, currentUser, container) {
  let booking = bookingService.get(bookingId) || bookingService.byCustomer(currentUser?.id || null, sessionStorage.getItem('search_phone'))
    .find((item) => item.id === bookingId);
  if (!booking && apiClient.isOnline() && !currentUser) {
    try { booking = (await apiClient.bookingsByPhone(sessionStorage.getItem('search_phone') || '')).bookings?.find((item) => item.id === bookingId); }
    catch (error) { showToast(error.message || 'Không tải được lịch hẹn.', 'danger'); return; }
  }
  if (!booking) { showToast('Không tìm thấy lịch hẹn để dời.', 'danger'); return; }
  const modal = document.getElementById('serviceModal');
  const body = document.getElementById('serviceModalBody');
  if (!modal || !body) return;
  const staff = staffService.forService(booking.serviceId);
  body.innerHTML = `
    <div class="reschedule-modal" style="padding:25px;max-width:680px;margin:0 auto;">
      <h3 style="font-family:var(--font-heading);font-size:1.4rem;color:var(--text-dark);margin-bottom:8px;">Dời Lịch Hẹn ${esc(booking.code)}</h3>
      <p style="font-size:13px;color:var(--text-light);margin-bottom:18px;">Mã lịch được giữ nguyên. Có thể tự dời trước hạn hủy của spa.</p>
      <div class="form-group">
        <label for="rescheduleDate">Ngày mới</label>
        <input type="date" class="form-control" id="rescheduleDate" min="${todayStr()}" value="${esc(booking.date)}" />
      </div>
      <div class="form-group">
        <label for="rescheduleStaff">Chuyên viên</label>
        <select class="form-control" id="rescheduleStaff">
          ${staff.map((item) => `<option value="${esc(item.id)}" ${item.id === booking.staffId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="rescheduleTime">Khung giờ khả dụng</label>
        <select class="form-control" id="rescheduleTime"></select>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
        <button type="button" class="btn-outline" id="closeRescheduleBtn">Quay Lại</button>
        <button type="button" class="btn-primary" id="saveRescheduleBtn">Xem giá lịch mới</button>
      </div>
      <div class="form-group" style="margin-top:16px"><label for="reschedulePromo">Áp dụng lại mã giảm giá (nếu có)</label><input id="reschedulePromo" class="form-control" maxlength="20" placeholder="Để trống nếu không dùng mã" /></div>
      <div id="rescheduleQuoteArea"></div>
    </div>
  `;
  modal.classList.add('show');
  const dateInput = document.getElementById('rescheduleDate');
  const staffInput = document.getElementById('rescheduleStaff');
  const timeInput = document.getElementById('rescheduleTime');
  const quoteArea = document.getElementById('rescheduleQuoteArea');
  const promoInput = document.getElementById('reschedulePromo');
  let selectionRevision = 0;
  [dateInput, staffInput, timeInput, promoInput].forEach((input) => input.addEventListener('input', () => { selectionRevision += 1; quoteArea.innerHTML = ''; }));
  [dateInput, staffInput, timeInput, promoInput].forEach((input) => input.addEventListener('change', () => { selectionRevision += 1; quoteArea.innerHTML = ''; }));
  const fillTimes = () => {
    const slots = bookingService.getAvailableSlots(dateInput.value, staffInput.value, Number(booking.duration), booking.id)
      .filter((slot) => slot.available);
    timeInput.innerHTML = slots.length
      ? slots.map((slot) => `<option value="${esc(slot.time)}" ${slot.time === booking.startTime && dateInput.value === booking.date && staffInput.value === booking.staffId ? 'selected' : ''}>${esc(slot.time)} – ${esc(slot.endTime)}</option>`).join('')
      : '<option value="">Không còn khung giờ trống</option>';
  };
  dateInput.addEventListener('change', fillTimes);
  staffInput.addEventListener('change', fillTimes);
  fillTimes();
  document.getElementById('closeRescheduleBtn')?.addEventListener('click', () => modal.classList.remove('show'));
  document.getElementById('saveRescheduleBtn')?.addEventListener('click', async (event) => {
    const saveButton = event.currentTarget;
    if (!timeInput.value) { showToast('Vui lòng chọn ngày và khung giờ còn trống.', 'danger'); return; }
    saveButton.disabled = true;
    try {
      const phone = currentUser ? '' : sessionStorage.getItem('search_phone') || '';
      const requestedRevision = selectionRevision;
      const result = await apiClient.quoteReschedule(booking.id, {
        date: dateInput.value, startTime: timeInput.value, staffId: staffInput.value, promoCode: promoInput.value.trim(), phone,
      });
      if (requestedRevision !== selectionRevision) { showToast('Lựa chọn đã đổi. Hãy xem lại giá lịch mới.', 'normal'); return; }
      renderRescheduleQuote(quoteArea, result.quote, { phone, onConfirmed: async (rescheduleResult) => {
        modal.classList.remove('show');
        showToast(rescheduleResult?.refundRequest
          ? `Đã dời lịch. Yêu cầu hoàn chênh lệch ${formatVND(rescheduleResult.refundRequest.amount)} đang chờ nhân viên chuyển khoản.`
          : 'Đã xác nhận giá và cập nhật lịch hẹn.', 'success');
        await apiClient.refresh();
        await renderBookingsTab(container, currentUser);
      } });
    } catch (error) {
      showToast(error.message || 'Không thể dời lịch.', 'danger');
    } finally {
      saveButton.disabled = false;
    }
  });
}

function bookingStatusLabel(status, booking = null) {
  if (booking?.paymentStatus === 'awaiting_payment') return 'Chờ thanh toán';
  if (booking?.paymentStatus === 'expired') return 'QR hết hạn';
  if (booking?.paymentStatus === 'payment_issue' || booking?.paymentStatus === 'paid_with_issue') return 'Cần đối soát';
  return { Pending: 'Chờ xác nhận', Confirmed: 'Đã xác nhận', CheckedIn: 'Đã đến', Completed: 'Hoàn tất', Cancelled: 'Đã hủy', NoShow: 'Vắng mặt' }[status] || status;
}

function bookingStatusClass(status) {
  if (status === 'Completed') return 'badge-completed';
  if (status === 'Confirmed' || status === 'CheckedIn') return 'badge-confirmed';
  if (status === 'Pending') return 'badge-pending';
  return 'badge-cancelled';
}

/* ---------------- TAB YÊU THÍCH ---------------- */
function renderFavoritesTab(container, currentUser) {
  if (!currentUser) {
    container.innerHTML = `
      <div style="text-align: center; padding: 50px 20px; background: #fff; border-radius: 8px;">
        <p style="color: var(--text-light); margin-bottom: 15px;">Vui lòng đăng nhập để xem danh sách liệu trình yêu thích của bạn.</p>
        <a href="/dang-nhap" class="btn-primary" style="display: inline-block; text-decoration: none;">Đăng Nhập Ngay</a>
      </div>
    `;
    return;
  }

  const favs = favoriteService.list(currentUser.id);
  if (!favs.length) {
    container.innerHTML = `
      <div style="text-align: center; padding: 50px 20px; background: #fff; border-radius: 8px;">
        <div style="font-size: 36px; margin-bottom: 10px;">♥</div>
        <h4 style="color: var(--text-dark); margin-bottom: 6px;">Chưa có liệu trình yêu thích</h4>
        <p style="color: var(--text-light); font-size: 13px;">Hãy bấm biểu tượng trái tim ở trang Dịch Vụ để lưu lại các liệu trình bạn yêu thích.</p>
        <a href="/lieu-trinh" class="btn-outline" style="margin-top: 15px; display: inline-block; text-decoration: none;">Khám Phá Dịch Vụ</a>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="packages-grid">
      ${favs.map((f) => `
        <div class="package-card">
          <div class="package-info">
            <h3>${esc(f.service.name)}</h3>
            <div class="service-duration">⏱ ${f.service.duration} Phút • ${formatVND(f.service.price)}</div>
            <p class="card-desc">${esc(f.service.shortDesc)}</p>
            <div class="service-actions">
              <a href="/dich-vu/${esc(f.service.id)}" class="btn-outline">Xem Chi Tiết</a>
              <a href="/dat-lich?service=${esc(f.service.id)}" class="btn-primary">Đặt Lịch</a>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/* ---------------- TAB HỒ SƠ ---------------- */
function renderProfileTab(container, currentUser) {
  container.innerHTML = `
    <div style="background: #fff; border-radius: 8px; padding: 30px; max-width: 500px; box-shadow: 0 2px 10px rgba(0,0,0,0.04);">
      <h3 style="font-family: var(--font-heading); margin-bottom: 20px; color: var(--text-dark);">Thông Tin Cá Nhân</h3>
      <div class="form-group">
        <label>Họ và Tên</label>
        <input type="text" class="form-control" id="profNameInput" value="${esc(currentUser.name)}" />
      </div>
      <div class="form-group">
        <label>Số Điện Thoại</label>
        <input type="tel" class="form-control" id="profPhoneInput" value="${esc(currentUser.phone)}" />
      </div>
      <div class="form-group">
        <label>Địa Chỉ Email</label>
        <input type="email" class="form-control" id="profEmailInput" value="${esc(currentUser.email)}" />
      </div>
      <button type="button" class="btn-primary" id="saveProfileBtn" style="padding: 12px 25px; margin-top: 10px;">
        Lưu Thay Đổi
      </button>
      <hr style="border:0;border-top:1px solid var(--border-light);margin:25px 0;" />
      <h4 style="font-family:var(--font-heading);margin-bottom:14px;color:var(--text-dark);">Đổi Mật Khẩu</h4>
      <div class="form-group">
        <label for="currentPasswordInput">Mật khẩu hiện tại</label>
        <input type="password" class="form-control" id="currentPasswordInput" autocomplete="current-password" />
      </div>
      <div class="form-group">
        <label for="newPasswordInput">Mật khẩu mới</label>
        <input type="password" class="form-control" id="newPasswordInput" autocomplete="new-password" minlength="8" />
        <small style="display:block;margin-top:6px;color:#64748b;">Ít nhất 8 ký tự, gồm một chữ số và một ký tự đặc biệt.</small>
      </div>
      <div class="form-group">
        <label for="confirmNewPasswordInput">Xác nhận mật khẩu mới</label>
        <input type="password" class="form-control" id="confirmNewPasswordInput" autocomplete="new-password" minlength="8" />
      </div>
      <button type="button" class="btn-outline" id="changePasswordBtn">Cập Nhật Mật Khẩu</button>
    </div>
  `;

  document.getElementById('saveProfileBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('profNameInput')?.value.trim();
    const phone = document.getElementById('profPhoneInput')?.value.trim();
    const email = document.getElementById('profEmailInput')?.value.trim();
    try {
      await authService.updateProfile(currentUser.id, { name, phone, email });
      showToast('Cập nhật thông tin thành công!', 'success');
      renderMyBookingsPage();
    } catch (err) {
      showToast(err.message || 'Cập nhật thất bại.', 'danger');
    }
  });

  document.getElementById('changePasswordBtn')?.addEventListener('click', async () => {
    const currentPassword = document.getElementById('currentPasswordInput')?.value || '';
    const newPassword = document.getElementById('newPasswordInput')?.value || '';
    const confirmPassword = document.getElementById('confirmNewPasswordInput')?.value || '';
    try {
      await authService.changePassword(currentUser.id, currentPassword, newPassword, confirmPassword);
      document.getElementById('currentPasswordInput').value = '';
      document.getElementById('newPasswordInput').value = '';
      document.getElementById('confirmNewPasswordInput').value = '';
      showToast('Đã cập nhật mật khẩu thành công!', 'success');
    } catch (error) {
      showToast(error.message || 'Không đổi được mật khẩu.', 'danger');
    }
  });
}

/* Modal Đánh Giá Trải Nghiệm */
function openReviewModal(bookingId, currentUser) {
  const modal = document.getElementById('serviceModal');
  const body = document.getElementById('serviceModalBody');
  if (!modal || !body) return;

  body.innerHTML = `
    <div style="padding: 25px; max-width: 450px; margin: 0 auto;">
      <h3 style="font-family: var(--font-heading); font-size: 1.4rem; color: var(--text-dark); margin-bottom: 15px;">
        Đánh Giá Trải Nghiệm Trị Liệu
      </h3>
      <div class="form-group">
        <label>Số sao đánh giá (1 - 5 sao):</label>
        <select class="form-control" id="revRatingSelect">
          <option value="5" selected>★★★★★ 5 Sao (Tuyệt vời)</option>
          <option value="4">★★★★☆ 4 Sao (Rất tốt)</option>
          <option value="3">★★★☆☆ 3 Sao (Bình thường)</option>
          <option value="2">★★☆☆☆ 2 Sao (Chưa hài lòng)</option>
          <option value="1">★☆☆☆☆ 1 Sao (Kém)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Nhận xét của quý khách:</label>
        <textarea class="form-control" id="revCommentText" rows="4" placeholder="Chia sẻ cảm nhận về kỹ thuật viên, không gian, mùi hương thảo mộc..."></textarea>
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
        <button type="button" class="btn-outline" id="closeRevModalBtn">Hủy</button>
        <button type="button" class="btn-primary" id="submitRevBtn">Gửi Đánh Giá</button>
      </div>
    </div>
  `;

  modal.classList.add('show');

  document.getElementById('closeRevModalBtn')?.addEventListener('click', () => modal.classList.remove('show'));
  document.getElementById('submitRevBtn')?.addEventListener('click', async () => {
    const rating = document.getElementById('revRatingSelect')?.value;
    const comment = document.getElementById('revCommentText')?.value;
    try {
      await reviewService.createReview({ bookingId, rating, comment }, currentUser);
      modal.classList.remove('show');
      showToast('Cảm ơn bạn đã gửi đánh giá quý báu!', 'success');
      renderMyBookingsPage();
    } catch (err) {
      showToast(err.message || 'Không thể gửi đánh giá.', 'danger');
    }
  });
}
