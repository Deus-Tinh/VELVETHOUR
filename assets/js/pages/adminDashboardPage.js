/**
 * Bảng Điều Khiển Quản Trị Hệ Thống (/admin).
 * Tính năng:
 * - KPIs thời gian thực tính toán hoàn toàn từ Repositories (Array methods).
 * - Biểu đồ Doanh thu & Lượt khách 7 ngày bằng HTML5 Canvas API thuần.
 * - Tabs CRUD đầy đủ:
 *   1. Quản lý Dịch vụ (Services CRUD, Soft Delete nếu có booking).
 *   2. Quản lý Danh mục (Categories CRUD).
 *   3. Quản lý Chuyên viên (Staff CRUD & Ca làm việc).
 *   4. Quản lý Lịch hẹn (Bookings Management & Status Workflow).
 *   5. Quản lý Khuyến mãi (Promotions CRUD).
 *   6. Quản lý Liên hệ (Contacts Viewer).
 *   7. Cài đặt Spa (Settings Form).
 *   8. Khôi phục Dữ liệu Demo (Reset Demo Data).
 */
import { analyticsService, contactService } from '../services/socialAndAnalyticsService.js';
import { serviceService, categoryService } from '../services/serviceService.js';
import { staffService, promotionService, settingsService } from '../services/staffSettingsPromoService.js';
import { bookingService } from '../services/bookingService.js';
import { authService } from '../services/authService.js';
import { apiClient } from '../services/apiClient.js';
import { resetDemoData } from '../data/seed.js';
import { drawRevenueChart } from '../ui/canvasChart.js';
import { formatVND, esc, formatDate } from '../core/utils.js';
import { businessNow, timeToMin } from '../core/utils.js';
import { showToast, showConfirmModal, openChangePasswordModal } from '../ui/components.js';
import { getImageById, getServiceImage } from '../imageManifest.js';
import { bookingMessage, customerChannelLinks, rebookingMessage } from '../services/customerMessaging.js';
import { THERAPY_GROUPS, getTherapyGroupName } from '../domain/therapyGroupModel.js';
import { renderAdminAgent } from './adminAgentPage.js';
import { renderAdminHolidaySales } from './adminHolidaySalesPage.js';

let adminActiveTab = 'overview'; // 'overview' | 'bookings' | 'agent' | 'services' | 'packages' | 'categories' | 'staff' | 'finance' | 'reconciliation' | 'customers' | 'promotions' | 'contacts' | 'settings'
let activePackagePreviewCleanup = null;
let activeTherapyPreviewCleanup = null;

export function renderAdminDashboardPage() {
  const root = document.getElementById('appRoot');
  if (!root) return;

  const currentUser = authService.getCurrentUser();

  // Kiểm tra quyền Admin (hoặc cho phép chuyển sang tài khoản Admin)
  if (!currentUser || currentUser.role !== 'admin') {
    root.innerHTML = `
      <div class="section-container" style="text-align: center; padding: 90px 20px;">
        <div style="font-size: 48px; margin-bottom: 15px;">🛡</div>
        <h2>Bảng Quản Trị Hệ Thống (Admin Portal)</h2>
        <p style="color: var(--text-light); margin: 15px 0 25px 0;">Vui lòng đăng nhập với tài khoản Quản Trị Viên (Admin) để truy cập.</p>
        <a href="/dang-nhap" class="btn-primary" style="display: inline-block; text-decoration: none;">Đăng Nhập Quản Trị</a>
      </div>
    `;
    return;
  }

  const kpis = analyticsService.getDashboardKPIs();

  root.innerHTML = `
    <div class="page-banner" style="padding: 35px 20px;">
      <div class="breadcrumbs"><a href="/" style="color:inherit;text-decoration:none;">Trang Chủ</a> / Admin Portal</div>
      <h1 style="font-size: 2.2rem;">HỆ THỐNG QUẢN TRỊ SPA &amp; THỐNG KÊ</h1>
      <p>Xin chào, <strong>${esc(currentUser.name)}</strong> (${esc(currentUser.email)}) • Quản lý dịch vụ, chuyên viên và điều phối lịch hẹn.</p>
    </div>

    <div class="section-container" style="padding-top: 35px; padding-bottom: 70px;">
      <!-- Backup shared data; reset remains limited to the offline demo. -->
      <div style="display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; margin-bottom: 20px;">
        <a href="/nhac" class="btn-outline btn-sm" style="text-decoration: none;">♫ Quản Lý Nhạc Nền</a>
        <button type="button" class="btn-outline btn-sm" id="adminChangePasswordBtn">🔑 Đổi Mật Khẩu</button>
        <button type="button" class="btn-outline btn-sm" id="adminLogoutBtn">Đăng Xuất</button>
        ${apiClient.isOnline() ? `<button type="button" class="btn-outline btn-sm" id="downloadBackupBtn">⬇ Tải bản sao lưu dữ liệu</button>` : `<button type="button" class="btn-outline btn-sm" id="resetDemoBtn" style="color: #dc2626; border-color: #dc2626;">
          ↺ Khôi Phục Dữ Liệu Demo Ban Đầu
        </button>`}
      </div>

      <!-- KPI Grid -->
      <div class="kpi-grid">
        <div class="kpi-card green">
          <div class="kpi-title">Giá Trị Lịch Hoàn Tất</div>
          <div class="kpi-value">${formatVND(kpis.revenue)}</div>
        </div>
        <div class="kpi-card orange">
          <div class="kpi-title">Tổng Lịch Hẹn</div>
          <div class="kpi-value">${kpis.bookings.total} <small style="font-size:12px;color:#64748b;">(${kpis.bookings.today} hôm nay)</small></div>
        </div>
        <div class="kpi-card blue">
          <div class="kpi-title">Đang Chờ / Đã Xác Nhận</div>
          <div class="kpi-value">${kpis.bookings.pending} / ${kpis.bookings.confirmed}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Dịch Vụ Hoạt Động</div>
          <div class="kpi-value">${kpis.activeServices} / ${kpis.totalServices}</div>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="dash-tabs-bar">
        <button type="button" class="dash-tab-btn ${adminActiveTab === 'overview' ? 'active' : ''}" data-tab="overview">📊 Tổng Quan</button>
        <button type="button" class="dash-tab-btn ${adminActiveTab === 'bookings' ? 'active' : ''}" data-tab="bookings">📅 Lịch Hẹn</button>
        <button type="button" class="dash-tab-btn ${adminActiveTab === 'agent' ? 'active' : ''}" data-tab="agent">✿ Agent Spa</button>
        <button type="button" class="dash-tab-btn ${adminActiveTab === 'finance' ? 'active' : ''}" data-tab="finance">💰 Thu Chi</button>
        <button type="button" class="dash-tab-btn ${adminActiveTab === 'reconciliation' ? 'active' : ''}" data-tab="reconciliation">🏦 Đối Soát QR / Hoàn Tiền</button>
        <button type="button" class="dash-tab-btn ${adminActiveTab === 'customers' ? 'active' : ''}" data-tab="customers">🧑‍🤝‍🧑 Khách Hàng</button>
        <button type="button" class="dash-tab-btn ${adminActiveTab === 'services' ? 'active' : ''}" data-tab="services">💆 Liệu Trình</button>
        <button type="button" class="dash-tab-btn ${adminActiveTab === 'packages' ? 'active' : ''}" data-tab="packages">🎁 Gói Trị Liệu</button>
        <button type="button" class="dash-tab-btn ${adminActiveTab === 'categories' ? 'active' : ''}" data-tab="categories">📁 Danh Mục</button>
        <button type="button" class="dash-tab-btn ${adminActiveTab === 'staff' ? 'active' : ''}" data-tab="staff">👥 Chuyên Viên</button>
        <button type="button" class="dash-tab-btn ${adminActiveTab === 'promotions' ? 'active' : ''}" data-tab="promotions">🏷 Khuyến Mãi</button>
        <button type="button" class="dash-tab-btn ${adminActiveTab === 'contacts' ? 'active' : ''}" data-tab="contacts">✉ Liên Hệ</button>
        <button type="button" class="dash-tab-btn ${adminActiveTab === 'settings' ? 'active' : ''}" data-tab="settings">⚙ Cài Đặt</button>
      </div>

      <!-- Tab Content -->
      <div id="adminTabContentArea"></div>
    </div>
  `;

  // Sự kiện chuyển Tab
  document.querySelectorAll('.dash-tabs-bar .dash-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      adminActiveTab = btn.getAttribute('data-tab');
      document.querySelectorAll('.dash-tabs-bar .dash-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderAdminCurrentTab(kpis);
    });
  });

  document.getElementById('adminChangePasswordBtn')?.addEventListener('click', () => {
    openChangePasswordModal({
      user: currentUser,
      onChangePassword: (uid, oldPass, newPass, confirmPass) =>
        authService.changePassword(uid, oldPass, newPass, confirmPass),
    });
  });

  document.getElementById('adminLogoutBtn')?.addEventListener('click', async () => {
    await authService.logout();
    showToast('Đã đăng xuất tài khoản quản trị.', 'normal');
    renderAdminDashboardPage();
  });

  // Sự kiện Khôi phục demo
  document.getElementById('resetDemoBtn')?.addEventListener('click', () => {
    showConfirmModal({
      title: 'Khôi Phục Dữ Liệu Mẫu?',
      message: 'Hành động này sẽ thiết lập lại toàn bộ dịch vụ, chuyên viên, tài khoản và lịch hẹn mẫu ban đầu.',
      confirmText: 'Khôi Phục Ngay',
      onConfirm: () => {
        resetDemoData();
        showToast('Đã khôi phục dữ liệu demo thành công!', 'success');
        renderAdminDashboardPage();
      }
    });
  });

  document.getElementById('downloadBackupBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const filename = await apiClient.downloadBackup();
      showToast(`Đã tải bản sao lưu ${filename}.`, 'success');
    } catch (error) {
      showToast(error.message || 'Không thể tải bản sao lưu.', 'danger');
    } finally {
      button.disabled = false;
    }
  });

  renderAdminCurrentTab(kpis);
}

function renderAdminCurrentTab(kpis) {
  const container = document.getElementById('adminTabContentArea');
  if (!container) return;

  if (adminActiveTab === 'overview') renderTabOverview(container, kpis);
  else if (adminActiveTab === 'bookings') renderTabBookings(container);
  else if (adminActiveTab === 'agent') renderAdminAgent(container);
  else if (adminActiveTab === 'finance') renderTabFinance(container);
  else if (adminActiveTab === 'reconciliation') renderTabReconciliation(container);
  else if (adminActiveTab === 'customers') renderTabCustomers(container);
  else if (adminActiveTab === 'services') renderTabServices(container);
  else if (adminActiveTab === 'packages') renderTabPackages(container);
  else if (adminActiveTab === 'categories') renderTabCategories(container);
  else if (adminActiveTab === 'staff') renderTabStaff(container);
  else if (adminActiveTab === 'promotions') {
    renderTabPromotions(container);
    const saleArea = document.createElement('div');
    container.prepend(saleArea);
    renderAdminHolidaySales(saleArea);
  }
  else if (adminActiveTab === 'contacts') renderTabContacts(container);
  else if (adminActiveTab === 'settings') renderTabSettings(container);
}

/* ---------------- 1. TAB TỔNG QUAN & BIỂU ĐỒ CANVAS ---------------- */
function renderTabOverview(container, kpis) {
  container.innerHTML = `
    <div style="background: #fff; padding: 25px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.04); margin-bottom: 30px;">
      <h3 style="font-family: var(--font-heading); font-size: 1.3rem; margin-bottom: 15px; color: var(--text-dark);">
        Giá Trị Dịch Vụ Hoàn Tất Trong 7 Ngày Gần Nhất (VND)
      </h3>
      <p style="color: #64748b; font-size: 13px; margin-bottom: 20px;">
        * Giá trị dịch vụ theo lịch đã hoàn tất; báo cáo tiền thực thu và hoàn tiền nằm trong mục Thu / Hoàn Tiền.
      </p>
      <div style="width: 100%; height: 280px; position: relative;">
        <canvas id="adminRevenueCanvas" style="width: 100%; height: 100%;"></canvas>
      </div>
    </div>

    <!-- Liệu trình được ưa chuộng -->
    <div style="background: #fff; padding: 25px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.04);">
      <h3 style="font-family: var(--font-heading); font-size: 1.3rem; margin-bottom: 15px; color: var(--text-dark);">
        Top Liệu Trình Đặt Nhiều Nhất
      </h3>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tên Liệu Trình</th>
              <th>Giá Tiêu Chuẩn</th>
              <th>Số Lượt Đặt</th>
            </tr>
          </thead>
          <tbody>
            ${(kpis.popularServices || []).map((p) => `
              <tr>
                <td><strong>${esc(p.name)}</strong></td>
                <td>${formatVND(p.price)}</td>
                <td><span class="badge-status badge-confirmed">${p.count} lượt</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  setTimeout(() => {
    drawRevenueChart('adminRevenueCanvas', kpis.dailyStats);
  }, 50);
}

/* ---------------- 2. TAB QUẢN LÝ LỊCH HẸN ---------------- */
function renderTabBookings(container) {
  const allBookings = bookingService.list().sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`));

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h3 style="font-family: var(--font-heading); color: var(--text-dark); margin: 0;">Danh Sách Lịch Hẹn Toàn Hệ Thống</h3>
      <div style="font-size: 13px; color: #64748b;">Tổng: <strong>${allBookings.length}</strong> lịch hẹn</div>
    </div>

    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Mã Đặt Lịch</th>
            <th>Khách Hàng &amp; SĐT</th>
            <th>Liệu Trình</th>
            <th>Chuyên Viên</th>
            <th>Phòng</th>
            <th>Thời Gian</th>
            <th>Thanh Toán</th>
            <th>Trạng Thái</th>
            <th>Thao Tác</th>
          </tr>
        </thead>
        <tbody>
          ${allBookings.map((b) => {
            const financial = paymentSummary(b);
            return `
            <tr>
              <td><strong>${esc(b.code)}</strong></td>
              <td>
                <div><strong>${esc(b.customerName)}</strong></div>
                <div style="font-size:11px;color:#64748b;">${esc(b.customerPhone)}</div>
              </td>
              <td>${esc(b.serviceName)}</td>
              <td>${esc(b.staffName)}</td>
              <td>${b.roomNumber ? `Phòng ${Number(b.roomNumber)}` : '—'}</td>
              <td>
                <div style="font-weight:600;color:var(--primary-brown);">${b.startTime} - ${b.endTime}</div>
                <div style="font-size:11px;color:#64748b;">${formatDate(b.date)}</div>
              </td>
              <td>
                <div><strong>${formatVND(financial.netPaid)}</strong> <small style="color:#64748b;">/ ${formatVND(b.finalPrice)}</small></div>
                <small style="display:block;color:#64748b;">Còn ${formatVND(Math.max(0, Number(b.finalPrice || 0) - financial.netPaid))} • Hoàn ${formatVND(financial.refunded)}</small>
                <button type="button" class="btn-sm btn-outline adm-bk-payment" data-id="${esc(b.id)}" style="margin-top:5px;">Thu / Hoàn</button>
              </td>
              <td>
                <span class="badge-status ${statusBadgeClass(b.status)}">
                  ${b.paymentStatus === 'awaiting_payment' ? 'Chờ thanh toán' : b.paymentStatus === 'expired' ? 'QR hết hạn' : ['payment_issue', 'paid_with_issue'].includes(b.paymentStatus) ? 'Cần đối soát' : ({ Pending: 'Chờ xác nhận', Confirmed: 'Đã xác nhận', CheckedIn: 'Đã đến', Completed: 'Hoàn tất', Cancelled: 'Đã hủy', NoShow: 'Vắng mặt' }[b.status] || b.status)}
                </span>
              </td>
              <td>
                <div style="display:flex;gap:4px;flex-wrap:wrap;">
                  ${b.status === 'Pending' ? `
                    ${b.paymentCode ? '<small style="color:#a16207;">Tự xác nhận khi đủ tiền</small>' : `<button type="button" class="btn-sm btn-outline adm-bk-status" data-id="${esc(b.id)}" data-status="Confirmed">Xác Nhận</button>`}
                    <button type="button" class="btn-sm btn-outline adm-bk-status" data-id="${esc(b.id)}" data-status="Cancelled" style="color:#dc2626;">Hủy</button>
                  ` : ''}
                  ${b.status === 'Confirmed' ? `
                    <button type="button" class="btn-sm btn-success adm-bk-status" data-id="${esc(b.id)}" data-status="CheckedIn">✓ Khách đã đến</button>
                    <button type="button" class="btn-sm btn-outline adm-bk-status" data-id="${esc(b.id)}" data-status="Cancelled" style="color:#dc2626;">Hủy</button>
                    ${canMarkNoShow(b) ? `<button type="button" class="btn-sm btn-outline adm-bk-status" data-id="${esc(b.id)}" data-status="NoShow" style="color:#dc2626;">Vắng mặt</button>` : ''}
                  ` : ''}
                  ${b.status === 'CheckedIn' ? `<button type="button" class="btn-sm btn-success adm-bk-status" data-id="${esc(b.id)}" data-status="Completed">Hoàn tất liệu trình</button>` : ''}
                  ${['Completed', 'Cancelled', 'NoShow'].includes(b.status) ? `<small style="color:#94a3b8;">Đã khóa</small>` : ''}
                  ${['Pending', 'Confirmed'].includes(b.status) ? `<button type="button" class="btn-sm btn-outline adm-bk-message" data-id="${esc(b.id)}" data-kind="confirmation">Tin xác nhận</button>` : ''}
                  ${b.status === 'Confirmed' && isUpcomingBooking(b) ? `<button type="button" class="btn-sm btn-outline adm-bk-message" data-id="${esc(b.id)}" data-kind="reminder">Nhắc lịch</button>` : ''}
                </div>
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('.adm-bk-status').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const bid = btn.getAttribute('data-id');
      const st = btn.getAttribute('data-status');
      try {
        await bookingService.updateStatus(bid, st, 'Quản trị viên cập nhật thủ công');
        showToast(`Đã chuyển trạng thái sang "${st}" thành công!`, 'success');
        renderTabBookings(container);
        if (st === 'Confirmed') openBookingMessageModal(bid, 'confirmation');
      } catch (err) {
        showToast(err.message || 'Lỗi cập nhật.', 'danger');
      }
    });
  });

  container.querySelectorAll('.adm-bk-payment').forEach((btn) => {
    btn.addEventListener('click', () => openPaymentModal(btn.getAttribute('data-id'), container));
  });
  container.querySelectorAll('.adm-bk-message').forEach((btn) => {
    btn.addEventListener('click', () => openBookingMessageModal(btn.getAttribute('data-id'), btn.getAttribute('data-kind')));
  });
}

function paymentSummary(booking) {
  const records = Array.isArray(booking.paymentRecords) ? booking.paymentRecords : [];
  const collected = records.filter((record) => record.type !== 'refund').reduce((sum, record) => sum + (Number(record.amount) || 0), 0);
  const refunded = records.filter((record) => record.type === 'refund').reduce((sum, record) => sum + (Number(record.amount) || 0), 0);
  return { collected, refunded, netPaid: collected - refunded };
}

function isUpcomingBooking(booking) {
  const now = businessNow();
  return booking.date > now.date || (booking.date === now.date && timeToMin(booking.startTime) > now.minutes);
}

function openPaymentModal(bookingId, container) {
  const booking = bookingService.get(bookingId);
  const modal = document.getElementById('paymentModal');
  const body = document.getElementById('paymentModalBody');
  if (!booking || !modal || !body) return;
  const financial = paymentSummary(booking);
  const outstanding = Math.max(0, Number(booking.finalPrice || 0) - financial.netPaid);
  body.innerHTML = `
    <div style="padding:28px;max-height:85vh;overflow:auto;">
      <h3 style="font-family:var(--font-heading);font-size:1.4rem;color:var(--text-dark);margin:0 45px 8px 0;">Thu / Hoàn Tiền • ${esc(booking.code)}</h3>
      <p style="color:#64748b;margin:0 0 16px;">${esc(booking.customerName)} · ${esc(booking.serviceName)}</p>
      <div style="padding:12px 15px;background:#f8fafc;border-radius:8px;margin-bottom:18px;">
        Giá dịch vụ: <strong>${formatVND(booking.finalPrice)}</strong> · Đã thu: <strong>${formatVND(financial.collected)}</strong> · Đã hoàn: <strong>${formatVND(financial.refunded)}</strong> · Còn nợ: <strong>${formatVND(outstanding)}</strong>
      </div>
      <div style="margin-bottom:18px;">
        <h4 style="margin:0 0 8px;">Lịch sử giao dịch</h4>
        ${(booking.paymentRecords || []).length ? `<div style="display:grid;gap:6px;">${booking.paymentRecords.map((record) => `<div style="font-size:13px;color:#475569;">${esc(paymentTypeLabel(record.type, record.refundable))}: <strong>${formatVND(record.amount)}</strong> · ${esc(paymentMethodLabel(record.method))} · ${esc(formatDate(String(record.at || '').slice(0, 10)))}${record.reference ? ` · ${esc(record.reference)}` : ''}</div>`).join('')}</div>` : '<small style="color:#64748b;">Chưa có giao dịch nào được ghi nhận.</small>'}
      </div>
      ${booking.refundRequest?.status === 'pending' ? `<p style="padding:11px;background:#fff7ed;border-radius:8px;color:#9a3412;font-size:13px;">Đang có đề nghị hoàn ${formatVND(booking.refundRequest.amount)}. Thực hiện trong tab “Đối Soát QR / Hoàn Tiền” để lưu người nhận và mã chuyển khoản.</p>` : ''}
      <div class="form-group"><label for="paymentTypeInput">Loại giao dịch</label><select class="form-control" id="paymentTypeInput"><option value="deposit">Thu tiền cọc</option><option value="payment">Thu thanh toán</option></select></div>
      <div class="form-group"><label for="paymentAmountInput">Số tiền (VND)</label><input type="number" min="1" step="1000" max="${outstanding}" class="form-control" id="paymentAmountInput" value="${outstanding}" /></div>
      <div class="form-group"><label for="paymentMethodInput">Phương thức</label><select class="form-control" id="paymentMethodInput"><option value="cash">Tiền mặt</option><option value="bank">Chuyển khoản</option><option value="momo">Ví MoMo</option><option value="card">Thẻ</option><option value="other">Khác</option></select></div>
      <div class="form-group"><label for="paymentReferenceInput">Mã giao dịch / ghi chú đối soát</label><input type="text" maxlength="120" class="form-control" id="paymentReferenceInput" placeholder="Ví dụ: mã giao dịch ngân hàng" /></div>
      <div class="form-group"><label for="paymentNoteInput">Ghi chú / lý do hoàn</label><input type="text" maxlength="300" class="form-control" id="paymentNoteInput" placeholder="Không bắt buộc" /></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;"><button type="button" class="btn-outline" id="cancelPaymentFormBtn">Đóng</button><button type="button" class="btn-primary" id="savePaymentBtn">Lưu giao dịch</button></div>
    </div>
  `;
  const closeModal = () => { modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); };
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  const closeButton = document.getElementById('closePaymentModalTop');
  if (closeButton) closeButton.onclick = closeModal;
  document.getElementById('cancelPaymentFormBtn')?.addEventListener('click', closeModal);
  document.getElementById('paymentTypeInput')?.addEventListener('change', () => {
    const amountInput = document.getElementById('paymentAmountInput');
    if (amountInput) { amountInput.max = String(outstanding); amountInput.value = outstanding; }
  });
  document.getElementById('savePaymentBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const updated = await bookingService.recordPayment(bookingId, {
        type: document.getElementById('paymentTypeInput')?.value,
        amount: Number(document.getElementById('paymentAmountInput')?.value),
        method: document.getElementById('paymentMethodInput')?.value,
        reference: document.getElementById('paymentReferenceInput')?.value,
        note: document.getElementById('paymentNoteInput')?.value,
      });
      closeModal();
      showToast(`Đã ghi nhận ${paymentTypeLabel(updated.paymentRecords.at(-1).type).toLowerCase()}.`, 'success');
      renderTabBookings(container);
    } catch (error) {
      showToast(error.message || 'Không thể lưu giao dịch.', 'danger');
      button.disabled = false;
    }
  });
}

function paymentTypeLabel(type, refundable = true) {
  if (type === 'payment' && refundable === false || type === 'unmatched_payment') return 'Chuyển sai mã · không hoàn';
  return ({ deposit: 'Tiền cọc', payment: 'Thanh toán', refund: 'Hoàn tiền' })[type] || 'Giao dịch';
}

function paymentMethodLabel(method) {
  return ({ cash: 'Tiền mặt', bank: 'Chuyển khoản', momo: 'MoMo', card: 'Thẻ', other: 'Khác' })[method] || 'Khác';
}

async function renderTabReconciliation(container) {
  container.innerHTML = '<div style="padding:24px;background:#fff;border-radius:10px;color:#64748b;">Đang tải giao dịch và đề nghị hoàn…</div>';
  let data;
  try { data = await apiClient.getPaymentReconciliation(); }
  catch (error) {
    container.innerHTML = `<div style="padding:24px;background:#fff;border-radius:10px;color:#b42318;">${esc(error.message || 'Không tải được dữ liệu đối soát.')}</div>`;
    return;
  }
  if (!container.isConnected) return;
  const events = data.events || [];
  const refunds = data.refunds || [];
  const reconcileBookings = data.bookings || [];
  container.innerHTML = `
    <section style="padding:18px 20px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:18px;">
      <h3 style="margin:0 0 6px;">Trạng thái nhận tiền</h3>
      <p style="margin:0;color:${data.payment?.enabled ? '#087f6e' : '#b42318'};">${data.payment?.enabled ? 'SePay đã cấu hình sẵn sàng nhận giao dịch.' : esc(data.payment?.unavailableMessage || 'Cấu hình thanh toán chưa hoàn tất.')}</p>
      <small style="display:block;margin-top:7px;color:#64748b;">QR chờ tối đa 3 phút · Webhook cần URL HTTPS công khai · Thanh toán thẻ đang khóa.</small>
    </section>
    <section style="padding:18px 20px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:18px;">
      <h3 style="margin:0 0 12px;">Yêu cầu hoàn tiền (${refunds.filter((item) => item.status === 'pending').length} đang chờ)</h3>
      ${refunds.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Đơn / Khách</th><th>Hoàn</th><th>Người nhận</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
        ${refunds.map((item) => `<tr>
          <td><strong>${esc(item.bookingCode)}</strong><br /><small>${esc(item.customerName)} · ${esc(item.customerPhone)}</small></td>
          <td><strong>${formatVND(item.amount)}</strong><br /><small>${item.kind === 'reschedule_price_difference' ? 'Hoàn chênh lệch giá' : item.kind === 'manual_payment_review' ? 'Theo quyết định đối soát' : `50% của ${formatVND(item.paidAmount)}`}</small></td>
          <td><strong>${esc(item.recipient?.bankName || '')}</strong><br /><small>${esc(item.recipient?.accountNumber || '')}</small><br /><small>${esc(item.recipient?.accountHolder || '')}</small></td>
          <td><span class="badge-status ${item.status === 'pending' ? 'badge-pending' : 'badge-completed'}">${item.status === 'pending' ? 'Chờ chuyển khoản' : 'Đã hoàn'}</span>${item.referenceCode ? `<br /><small>${esc(item.referenceCode)}</small>` : ''}</td>
          <td>${item.status === 'pending' ? `<button type="button" class="btn-sm btn-primary complete-refund-btn" data-id="${esc(item.bookingId)}" data-code="${esc(item.bookingCode)}" data-amount="${Number(item.amount)}" data-kind="${esc(item.kind)}">Đã chuyển hoàn</button>` : '—'}</td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p style="color:#64748b;">Chưa có đề nghị hoàn tiền.</p>'}
    </section>
    <section style="padding:18px 20px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;">
      <h3 style="margin:0 0 12px;">Giao dịch SePay gần đây (${events.length})</h3>
      ${events.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Thời gian</th><th>Đơn / mã</th><th>Số tiền</th><th>Nội dung nhận được</th><th>Kết quả đối soát</th><th>Mã giao dịch</th><th>Xử lý</th></tr></thead><tbody>
        ${events.map((item) => `<tr>
          <td><small>${esc(paymentTimestamp(item.transactionAt || item.receivedAt))}</small></td>
          <td><strong>${esc(item.bookingCode || 'Chưa ghép đơn')}</strong><br /><small>${esc(item.paymentCode || 'Không nhận được mã')}</small></td>
          <td>${formatVND(item.amount)}</td>
          <td><small>${esc(item.content || '—')}</small></td>
          <td><span class="badge-status ${item.status === 'paid' ? 'badge-confirmed' : 'badge-cancelled'}">${esc(paymentEventLabel(item.status))}</span><br /><small>${esc(item.reason || '')}</small></td>
          <td><small>${esc(item.referenceCode || item.providerTransactionId)}</small></td>
          <td>${item.status === 'unmatched' && !item.bookingId ? `<div style="display:grid;gap:6px;min-width:220px;"><select class="form-control unmatched-booking-select" data-event-id="${esc(item.providerTransactionId)}"><option value="">Chọn đơn khách báo</option>${reconcileBookings.map((booking) => `<option value="${esc(booking.id)}">${esc(booking.code)} · ${esc(booking.customerName)} · ${formatVND(booking.amount)} · ${esc(({ Pending: 'đang giữ chỗ', Confirmed: 'đã xác nhận', CheckedIn: 'đã check-in', Completed: 'đã hoàn tất', Cancelled: 'đã hủy', NoShow: 'vắng mặt' })[booking.status] || booking.status)}</option>`).join('')}</select><button type="button" class="btn-sm btn-outline link-unmatched-payment-btn" data-event-id="${esc(item.providerTransactionId)}">Gắn giao dịch · không xác nhận</button></div>` : item.bookingId && item.status === 'unmatched' ? '<small>Đã gắn thủ công; đơn không được xác nhận</small>' : ['overpaid', 'late', 'slot_taken', 'extra_payment'].includes(item.status) && item.bookingId ? item.refundStatus ? `<small>${item.refundStatus === 'pending' ? 'Đang chờ hoàn thủ công' : 'Đã hoàn'}</small>` : `<button type="button" class="btn-sm btn-outline issue-refund-btn" data-event-id="${esc(item.providerTransactionId)}" data-code="${esc(item.bookingCode || '')}" data-amount="${Number(item.amount)}">Tạo đề nghị hoàn</button>` : '—'}</td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p style="color:#64748b;">Chưa nhận webhook giao dịch nào.</p>'}
      <p style="margin:12px 0 0;color:#9a3412;font-size:12px;line-height:1.5;">Chỉ gắn giao dịch sai/thiếu mã sau khi xác minh với khách. Thao tác này lưu giao dịch vào đúng hồ sơ để báo khách, đồng thời hủy lượt giữ chỗ nếu còn chờ; không xác nhận lịch và không tự động hoàn tiền. Sau khi gắn, hệ thống mở sẵn nội dung để nhân viên gửi qua kênh liên hệ.</p>
    </section>
  `;

  container.querySelectorAll('.complete-refund-btn').forEach((button) => button.addEventListener('click', () => {
    openRefundCompletionForm({ bookingId: button.dataset.id, bookingCode: button.dataset.code,
      amount: Number(button.dataset.amount), kind: button.dataset.kind }, container);
  }));
  container.querySelectorAll('.link-unmatched-payment-btn').forEach((button) => button.addEventListener('click', async () => {
    const select = button.closest('tr')?.querySelector('.unmatched-booking-select');
    const bookingId = select?.value;
    if (!bookingId) { showToast('Chọn đúng lịch khách báo trước khi ghép giao dịch.', 'danger'); return; }
    button.disabled = true;
    try {
      const { booking } = await apiClient.linkUnmatchedPayment({ providerTransactionId: button.dataset.eventId, bookingId });
      const event = events.find((item) => item.providerTransactionId === button.dataset.eventId);
      const bookingStateMessage = booking.status === 'Cancelled' ? ' Lịch hiện vẫn ở trạng thái đã hủy.'
        : ['Confirmed', 'CheckedIn', 'Completed', 'NoShow'].includes(booking.status)
          ? ` Trạng thái lịch hiện tại (${({ Confirmed: 'đã xác nhận', CheckedIn: 'đã check-in', Completed: 'đã hoàn tất', NoShow: 'vắng mặt' })[booking.status]}) không thay đổi từ giao dịch sai mã.`
          : ' Lịch chưa được xác nhận và khung giờ giữ chỗ đã được giải phóng.';
      const message = `Chào ${booking.customerName}, Spa đã kiểm tra giao dịch ${formatVND(event?.amount || 0)} cho lịch ${booking.code}. Nội dung chuyển khoản không khớp mã yêu cầu nên giao dịch này không xác nhận lịch và không được hoàn lại theo chính sách đã thông báo.${bookingStateMessage} Nếu cần trao đổi thêm, vui lòng liên hệ Spa.`;
      await renderTabReconciliation(container);
      openCustomerMessageModal({ title: 'Thông báo giao dịch sai mã',
        customer: { name: booking.customerName, phone: booking.customerPhone, email: booking.customerEmail },
        message, preferredChannel: settingsService.get().notificationChannel });
    } catch (error) {
      showToast(error.message || 'Không thể ghép giao dịch.', 'danger');
      button.disabled = false;
    }
  }));
  container.querySelectorAll('.issue-refund-btn').forEach((button) => button.addEventListener('click', () => {
    openIssueRefundForm({ providerTransactionId: button.dataset.eventId, bookingCode: button.dataset.code,
      maxAmount: Number(button.dataset.amount) }, container);
  }));
}

function paymentTimestamp(value) {
  const milliseconds = Date.parse(value || '');
  return Number.isFinite(milliseconds) ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(milliseconds)) : '—';
}

function paymentEventLabel(status) {
  return ({ paid: 'Đã xác nhận', underpaid: 'Chuyển thiếu · không hoàn', overpaid: 'Chuyển thừa · cần xem', late: 'Chuyển sau hạn', slot_taken: 'Khung giờ đã được đặt', extra_payment: 'Đơn đã thu trước đó', unmatched: 'Sai mã / không ghép được', wrong_account: 'Sai tài khoản nhận', wrong_direction: 'Không phải tiền vào' })[status] || status;
}

function openRefundCompletionForm(refund, container) {
  const modal = document.getElementById('serviceModal');
  const body = document.getElementById('serviceModalBody');
  if (!modal || !body) return;
  body.innerHTML = `
    <div style="padding:26px;max-width:540px;margin:0 auto;">
      <h3 style="font-family:var(--font-heading);margin:0 0 9px;">Ghi nhận đã hoàn tiền · ${esc(refund.bookingCode)}</h3>
      <p style="color:#64748b;">Chỉ xác nhận sau khi đã chuyển ${formatVND(refund.amount)} đến tài khoản khách.</p>
      <div class="form-group"><label for="refundTransferReference">Mã giao dịch chuyển hoàn</label><input class="form-control" id="refundTransferReference" maxlength="120" placeholder="Mã tham chiếu trên ngân hàng" /></div>
      <div class="form-group"><label for="refundTransferNote">Ghi chú</label><input class="form-control" id="refundTransferNote" maxlength="300" value="${refund.kind === 'reschedule_price_difference' ? 'Hoàn phần chênh lệch giá sau khi dời lịch' : refund.kind === 'manual_payment_review' ? 'Hoàn theo quyết định đối soát' : 'Hoàn 50% số tiền đã thanh toán'}" /></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;"><button type="button" class="btn-outline" id="refundTransferCancel">Quay lại</button><button type="button" class="btn-primary" id="refundTransferConfirm">Đã chuyển khoản</button></div>
    </div>
  `;
  modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false');
  const close = () => { modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); };
  document.getElementById('refundTransferCancel')?.addEventListener('click', close);
  document.getElementById('refundTransferConfirm')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const referenceCode = document.getElementById('refundTransferReference')?.value.trim();
    const note = document.getElementById('refundTransferNote')?.value.trim();
    if (!referenceCode || referenceCode.length < 3) { showToast('Nhập mã tham chiếu chuyển khoản để lưu vết hoàn tiền.', 'danger'); return; }
    button.disabled = true;
    try {
      await apiClient.completeRefund(refund.bookingId, { referenceCode, note });
      close();
      showToast(`Đã ghi nhận chuyển hoàn ${formatVND(refund.amount)}.`, 'success');
      await renderTabReconciliation(container);
    } catch (error) { showToast(error.message || 'Không thể cập nhật hoàn tiền.', 'danger'); button.disabled = false; }
  });
}

function openIssueRefundForm(event, container) {
  const modal = document.getElementById('serviceModal');
  const body = document.getElementById('serviceModalBody');
  if (!modal || !body) return;
  body.innerHTML = `
    <div style="padding:26px;max-width:540px;margin:0 auto;">
      <h3 style="font-family:var(--font-heading);margin:0 0 9px;">Đề nghị hoàn thủ công · ${esc(event.bookingCode)}</h3>
      <p style="color:#64748b;">Bạn quyết định số tiền hoàn cho giao dịch này, tối đa ${formatVND(event.maxAmount)}. Hệ thống chỉ lưu đề nghị; nhân viên vẫn phải chuyển khoản thủ công.</p>
      <div class="form-group"><label for="issueRefundAmount">Số tiền hoàn (VND)</label><input class="form-control" id="issueRefundAmount" type="number" min="1" max="${event.maxAmount}" step="1" value="${event.maxAmount}" /></div>
      <div class="form-group"><label for="issueRefundBank">Ngân hàng nhận</label><input class="form-control" id="issueRefundBank" maxlength="80" placeholder="Ví dụ: Techcombank" /></div>
      <div class="form-group"><label for="issueRefundAccount">Số tài khoản nhận</label><input class="form-control" id="issueRefundAccount" inputmode="numeric" maxlength="19" /></div>
      <div class="form-group"><label for="issueRefundHolder">Tên chủ tài khoản</label><input class="form-control" id="issueRefundHolder" maxlength="80" /></div>
      <div class="form-group"><label for="issueRefundNote">Lý do / ghi chú đối soát</label><input class="form-control" id="issueRefundNote" maxlength="300" placeholder="Lý do quyết định hoàn" /></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;"><button type="button" class="btn-outline" id="issueRefundCancel">Quay lại</button><button type="button" class="btn-primary" id="issueRefundCreate">Tạo đề nghị hoàn</button></div>
    </div>
  `;
  modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false');
  const close = () => { modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); };
  document.getElementById('issueRefundCancel')?.addEventListener('click', close);
  document.getElementById('issueRefundCreate')?.addEventListener('click', async (eventClick) => {
    const button = eventClick.currentTarget;
    const amount = Number(document.getElementById('issueRefundAmount')?.value);
    const recipient = {
      bankName: document.getElementById('issueRefundBank')?.value.trim(),
      accountNumber: document.getElementById('issueRefundAccount')?.value.trim(),
      accountHolder: document.getElementById('issueRefundHolder')?.value.trim(),
    };
    const note = document.getElementById('issueRefundNote')?.value.trim();
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > event.maxAmount) { showToast('Số tiền hoàn phải nằm trong giới hạn giao dịch.', 'danger'); return; }
    if (!recipient.bankName || !/^\d{6,19}$/.test(recipient.accountNumber) || !/^[\p{L} ]{5,80}$/u.test(recipient.accountHolder)) {
      showToast('Vui lòng nhập đúng thông tin ngân hàng nhận hoàn.', 'danger'); return;
    }
    button.disabled = true;
    try {
      await apiClient.createPaymentIssueRefund({ providerTransactionId: event.providerTransactionId, amount, recipient, note });
      close();
      showToast(`Đã tạo đề nghị hoàn ${formatVND(amount)}. Nhân viên cần chuyển khoản thủ công.`, 'success');
      await renderTabReconciliation(container);
    } catch (error) { showToast(error.message || 'Không thể tạo đề nghị hoàn.', 'danger'); button.disabled = false; }
  });
}

function openBookingMessageModal(bookingId, kind) {
  const booking = bookingService.get(bookingId);
  if (!booking) return;
  const settings = settingsService.get();
  openCustomerMessageModal({
    title: kind === 'reminder' ? 'Nhắc Lịch Hẹn' : 'Tin Xác Nhận Lịch',
    customer: { name: booking.customerName, phone: booking.customerPhone, email: booking.customerEmail },
    message: bookingMessage(booking, kind, settings),
    preferredChannel: settings.notificationChannel,
  });
}

function openCustomerMessageModal({ title, customer, message, preferredChannel = 'zalo' }) {
  const modal = document.getElementById('customerMessageModal');
  const body = document.getElementById('customerMessageModalBody');
  if (!modal || !body) return;
  const links = customerChannelLinks({ phone: customer.phone, email: customer.email, message });
  const preferred = links[preferredChannel] ? preferredChannel : links.zalo ? 'zalo' : links.sms ? 'sms' : 'email';
  body.innerHTML = `
    <div style="padding:28px;">
      <h3 style="font-family:var(--font-heading);font-size:1.4rem;color:var(--text-dark);margin:0 45px 16px 0;">${esc(title)}</h3>
      <div class="form-group"><label for="customerMessageText">Nội dung tin nhắn gửi ${esc(customer.name || 'khách hàng')}</label><textarea class="form-control" id="customerMessageText" rows="7" readonly>${esc(message)}</textarea></div>
      <small style="display:block;color:#64748b;margin:-8px 0 15px;">Chọn kênh để mở cuộc trò chuyện. Với Zalo, sao chép nội dung rồi dán vào cuộc trò chuyện để gửi.</small>
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;">
        <button type="button" class="btn-outline" id="copyCustomerMessageBtn">Sao chép nội dung</button>
        ${links.zalo ? `<a class="btn-outline" href="${esc(links.zalo)}" target="_blank" rel="noopener noreferrer">${preferred === 'zalo' ? 'Zalo · ưu tiên' : 'Mở Zalo'}</a>` : ''}
        ${links.sms ? `<a class="btn-outline" href="${esc(links.sms)}">${preferred === 'sms' ? 'SMS · ưu tiên' : 'Mở SMS'}</a>` : ''}
        ${links.email ? `<a class="btn-primary" href="${esc(links.email)}">${preferred === 'email' ? 'Email · ưu tiên' : 'Mở Email'}</a>` : ''}
      </div>
    </div>
  `;
  const closeModal = () => { modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); };
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  const closeButton = document.getElementById('closeCustomerMessageModalTop');
  if (closeButton) closeButton.onclick = closeModal;
  document.getElementById('copyCustomerMessageBtn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(message);
      showToast('Đã sao chép nội dung tin nhắn.', 'success');
    } catch {
      const input = document.getElementById('customerMessageText');
      input?.select();
      showToast('Đã chọn nội dung. Nhấn Ctrl+C để sao chép.', 'success');
    }
  });
}

function canMarkNoShow(booking) {
  const now = businessNow();
  return booking.date < now.date || (booking.date === now.date && timeToMin(booking.startTime) <= now.minutes);
}

function statusBadgeClass(status) {
  if (status === 'Completed') return 'badge-completed';
  if (status === 'Confirmed' || status === 'CheckedIn') return 'badge-confirmed';
  if (status === 'Pending') return 'badge-pending';
  return 'badge-cancelled';
}

/* ---------------- REPORTS: FINANCE & RETURNING CUSTOMERS ---------------- */
function renderTabFinance(container, fromValue = '', toValue = '') {
  const today = businessNow().date;
  const from = fromValue || `${today.slice(0, 8)}01`;
  const to = toValue || today;
  const report = analyticsService.getFinancialReport({ from, to });
  const summaryTable = (title, rows, nameHeading) => `
    <section style="background:#fff;padding:22px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.04);margin-top:18px;">
      <h3 style="font-family:var(--font-heading);font-size:1.1rem;margin:0 0 14px;color:var(--text-dark);">${title}</h3>
      <div class="data-table-wrap"><table class="data-table"><thead><tr><th>${nameHeading}</th><th>Đã thu</th><th>Đã hoàn</th><th>Thực thu</th><th>Giao dịch</th></tr></thead><tbody>
        ${rows.length ? rows.map((row) => `<tr><td>${esc(row.name)}</td><td>${formatVND(row.collected)}</td><td>${formatVND(row.refunded)}</td><td><strong>${formatVND(row.net)}</strong></td><td>${row.transactions}</td></tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:#64748b;">Chưa có giao dịch trong khoảng thời gian này.</td></tr>'}
      </tbody></table></div>
    </section>`;
  container.innerHTML = `
    <div style="background:#fff;padding:22px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.04);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
        <div><h3 style="font-family:var(--font-heading);font-size:1.25rem;margin:0 0 5px;color:var(--text-dark);">Báo Cáo Thu / Hoàn Tiền</h3><small style="color:#64748b;">Báo cáo dựa trên các giao dịch đã ghi nhận, không suy diễn từ trạng thái hoàn tất dịch vụ.</small></div>
        <div style="display:flex;align-items:end;gap:9px;flex-wrap:wrap;">
          <label style="font-size:12px;color:#64748b;">Từ ngày<input type="date" class="form-control" id="financeFromDate" value="${esc(from)}"></label>
          <label style="font-size:12px;color:#64748b;">Đến ngày<input type="date" class="form-control" id="financeToDate" value="${esc(to)}"></label>
          <button type="button" class="btn-primary btn-sm" id="applyFinanceRangeBtn">Xem báo cáo</button>
        </div>
      </div>
      <div class="kpi-grid" style="margin-top:18px;">
        <div class="kpi-card"><div class="kpi-title">Đã Thu</div><div class="kpi-value">${formatVND(report.collected)}</div><small style="color:#64748b;">Gồm ${formatVND(report.deposits)} tiền cọc</small></div>
        <div class="kpi-card orange"><div class="kpi-title">Đã Hoàn</div><div class="kpi-value">${formatVND(report.refunded)}</div></div>
        <div class="kpi-card green"><div class="kpi-title">Thực Thu</div><div class="kpi-value">${formatVND(report.net)}</div></div>
        <div class="kpi-card blue"><div class="kpi-title">Còn Thu / Chưa Đối Soát</div><div class="kpi-value">${formatVND(report.outstanding)}</div></div>
      </div>
      <small style="display:block;color:#64748b;margin-top:10px;">Khoảng ngày lọc giao dịch theo ngày thu/hoàn; khoản còn phải thu được tính theo ngày hẹn. Lịch cũ chưa ghi giao dịch sẽ hiện là chưa đối soát.</small>
    </div>
    ${summaryTable('Thực Thu Theo Ngày', report.byDate, 'Ngày')}
    ${summaryTable('Thực Thu Theo Dịch Vụ', report.byService, 'Dịch vụ')}
    ${summaryTable('Thực Thu Theo Chuyên Viên', report.byStaff, 'Chuyên viên')}
    <section style="background:#fff;padding:22px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.04);margin-top:18px;">
      <h3 style="font-family:var(--font-heading);font-size:1.1rem;margin:0 0 14px;color:var(--text-dark);">Giao Dịch Gần Đây</h3>
      <div class="data-table-wrap"><table class="data-table"><thead><tr><th>Thời điểm</th><th>Mã lịch</th><th>Khách hàng</th><th>Loại</th><th>Phương thức</th><th>Số tiền</th></tr></thead><tbody>
        ${report.events.length ? report.events.slice(0, 30).map((event) => `<tr><td>${formatDate(event.date)}</td><td>${esc(event.bookingCode)}</td><td>${esc(event.booking?.customerName || 'Khách hàng')}</td><td>${paymentTypeLabel(event.type)}</td><td>${paymentMethodLabel(event.method)}</td><td><strong>${event.type === 'refund' ? '−' : '+'}${formatVND(event.amount)}</strong></td></tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:#64748b;">Chưa có giao dịch nào được ghi nhận.</td></tr>'}
      </tbody></table></div>
    </section>
  `;
  document.getElementById('applyFinanceRangeBtn')?.addEventListener('click', () => {
    const nextFrom = document.getElementById('financeFromDate')?.value || '';
    const nextTo = document.getElementById('financeToDate')?.value || '';
    if (!nextFrom || !nextTo || nextFrom > nextTo) return showToast('Vui lòng chọn khoảng ngày hợp lệ.', 'danger');
    renderTabFinance(container, nextFrom, nextTo);
  });
}

function renderTabCustomers(container) {
  const customers = analyticsService.getCustomerHistories();
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
      <div><h3 style="font-family:var(--font-heading);color:var(--text-dark);margin:0 0 5px;">Lịch Sử &amp; Chăm Sóc Khách Hàng</h3><small style="color:#64748b;">Gộp lịch theo tài khoản hoặc số điện thoại để theo dõi khách quay lại.</small></div>
      <strong>${customers.length} khách</strong>
    </div>
    <div class="data-table-wrap"><table class="data-table"><thead><tr><th>Khách hàng</th><th>Số điện thoại</th><th>Lịch / Hoàn tất / Vắng</th><th>Thực thu</th><th>Lần gần nhất</th><th>Thao tác</th></tr></thead><tbody>
      ${customers.map((customer, index) => `
        <tr>
          <td><strong>${esc(customer.name)}</strong><div style="font-size:11px;color:#64748b;">${esc(customer.email || '')}</div></td>
          <td>${esc(customer.phone || '—')}</td>
          <td>${customer.bookingCount} / ${customer.completedCount} / ${customer.noShowCount}</td>
          <td><strong>${formatVND(customer.netPaid)}</strong></td>
          <td>${customer.lastVisitDate ? formatDate(customer.lastVisitDate) : '—'}</td>
          <td><div style="display:flex;gap:6px;flex-wrap:wrap;"><button type="button" class="btn-sm btn-outline customer-history-toggle">Lịch sử</button><button type="button" class="btn-sm btn-primary customer-rebook-btn" data-customer-index="${index}">Mời đặt lại</button></div></td>
        </tr>
        <tr hidden><td colspan="6"><div style="padding:8px 2px;display:grid;gap:8px;">${customer.bookings.map((booking) => `<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:1px solid #e2e8f0;padding:5px 0;"><span><strong>${esc(booking.code)}</strong> · ${esc(booking.serviceName)} · ${esc(booking.staffName)}</span><span>${formatDate(booking.date)} ${esc(booking.startTime)} · ${esc(booking.status)}</span></div>`).join('')}</div></td></tr>
      `).join('') || '<tr><td colspan="6" style="text-align:center;color:#64748b;">Chưa có lịch sử khách hàng.</td></tr>'}
    </tbody></table></div>
  `;
  container.querySelectorAll('.customer-history-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const detailsRow = button.closest('tr')?.nextElementSibling;
      if (detailsRow) detailsRow.hidden = !detailsRow.hidden;
    });
  });
  container.querySelectorAll('.customer-rebook-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const customer = customers[Number(button.getAttribute('data-customer-index'))];
      if (!customer) return;
      const lastService = customer.bookings.find((booking) => booking.status === 'Completed');
      const message = rebookingMessage({ ...customer, lastService: lastService?.serviceName }, settingsService.get());
      openCustomerMessageModal({ title: 'Mời Khách Quay Lại', customer, message, preferredChannel: settingsService.get().notificationChannel });
    });
  });
}

/* ---------------- 3. TAB QUẢN LÝ DỊCH VỤ (CRUD) ---------------- */
function renderTabServices(container) {
  const services = serviceService.listTherapies();
  const categories = categoryService.listActive().filter((category) => category.id !== 'packages');

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h3 style="font-family: var(--font-heading); color: var(--text-dark); margin: 0;">Quản Lý Liệu Trình</h3>
      <button type="button" class="btn-primary btn-sm" id="addNewServiceBtn">+ Thêm Liệu Trình Mới</button>
    </div>

    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Tên Dịch Vụ</th>
            <th>Nhóm Hiển Thị</th>
            <th>Danh Mục Chuyên Môn</th>
            <th>Thời Lượng</th>
            <th>Giá Tiêu Chuẩn</th>
            <th>Trạng Thái</th>
            <th>Thao Tác</th>
          </tr>
        </thead>
        <tbody>
          ${services.map((s) => `
            <tr>
              <td><strong>${esc(s.name)}</strong></td>
              <td>${esc(getTherapyGroupName(s) || 'Chưa phân loại')}</td>
              <td>${esc(s.categoryName)}</td>
              <td>⏱ ${s.duration} Phút</td>
              <td>${formatVND(s.price)}</td>
              <td>
                <span class="badge-status ${s.active !== false ? 'badge-confirmed' : 'badge-cancelled'}">
                  ${s.active !== false ? 'Hoạt Động' : 'Tạm Ẩn'}
                </span>
              </td>
              <td>
                <div style="display:flex;gap:6px;">
                  <button type="button" class="btn-sm btn-outline edit-svc-btn" data-id="${esc(s.id)}">Sửa</button>
                  <button type="button" class="btn-sm btn-outline del-svc-btn" data-id="${esc(s.id)}" style="color:#dc2626;">Xóa</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Thêm mới
  document.getElementById('addNewServiceBtn')?.addEventListener('click', () => {
    openServiceFormModal(null, categories);
  });

  // Sửa
  container.querySelectorAll('.edit-svc-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sid = btn.getAttribute('data-id');
      const s = serviceService.get(sid);
      openServiceFormModal(s, categories);
    });
  });

  // Xóa / Soft delete
  container.querySelectorAll('.del-svc-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sid = btn.getAttribute('data-id');
      showConfirmModal({
        title: 'Xóa Liệu Trình?',
        message: 'Nếu liệu trình này đã có lịch sử đặt hoặc đang là thành phần của gói, hệ thống sẽ tạm ẩn liệu trình và các gói liên quan để giữ dữ liệu an toàn.',
        confirmText: 'Xác Nhận',
        onConfirm: async () => {
          try {
            const res = serviceService.remove(sid);
            if (apiClient.isOnline()) await apiClient.waitForCollectionSync('services');
            showToast(res.mode === 'deleted' ? 'Đã xóa hoàn toàn liệu trình.' : res.packagesDeactivated
              ? `Đã tạm ẩn liệu trình và ${res.packagesDeactivated} gói đang sử dụng liệu trình này.`
              : 'Liệu trình đã có lịch hẹn nên được chuyển sang Tạm Ẩn an toàn.', 'success');
            renderTabServices(container);
          } catch (error) {
            showToast(error.message || 'Không thể xóa liệu trình.', 'danger');
          }
        }
      });
    });
  });
}

function renderTabPackages(container) {
  const catalog = serviceService.list();
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  const packages = catalog.filter((item) => item.kind === 'package');
  const therapies = catalog.filter((item) => item.kind === 'therapy' && item.active !== false);
  const bookablePackageIds = new Set(serviceService.listActive().filter((item) => item.kind === 'package').map((item) => item.id));

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
      <div>
        <h3 style="font-family:var(--font-heading);color:var(--text-dark);margin:0 0 5px;">Quản Lý Gói Trị Liệu</h3>
        <p style="margin:0;color:#64748b;font-size:13px;">Mỗi gói ghép các liệu trình đang hoạt động; giá và các mức thời lượng được cấu hình riêng cho gói.</p>
      </div>
      <button type="button" class="btn-primary btn-sm" id="addNewPackageBtn">+ Thêm Gói Trị Liệu</button>
    </div>
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr><th>Tên Gói</th><th>Liệu Trình Bao Gồm</th><th>Các Mức Đặt</th><th>Trạng Thái</th><th>Thao Tác</th></tr></thead>
        <tbody>
          ${packages.length ? packages.map((item) => {
            const componentNames = serviceService.componentServices(item, catalogById).map((therapy) => therapy.name);
            const variants = item.variants || [{ duration: item.duration, price: item.price }];
            const packageBookable = bookablePackageIds.has(item.id);
            const packageStatus = item.active === false ? 'Tạm Ẩn' : packageBookable ? 'Hoạt Động' : 'Cần Cấu Hình';
            return `
              <tr>
                <td><strong>${esc(item.name)}</strong><br /><small style="color:#64748b;">${esc(item.shortDesc)}</small></td>
                <td>${componentNames.length ? componentNames.map(esc).join('<br />') : '<span style="color:#b91c1c;">Chưa cấu hình thành phần</span>'}</td>
                <td>${variants.map((variant) => `${Number(variant.duration)} phút · ${formatVND(variant.price)}`).map(esc).join('<br />')}</td>
                <td><span class="badge-status ${packageBookable ? 'badge-confirmed' : 'badge-cancelled'}">${packageStatus}</span></td>
                <td><div style="display:flex;gap:6px;"><button type="button" class="btn-sm btn-outline edit-package-btn" data-id="${esc(item.id)}">Sửa</button><button type="button" class="btn-sm btn-outline del-package-btn" data-id="${esc(item.id)}" style="color:#dc2626;">Xóa</button></div></td>
              </tr>
            `;
          }).join('') : '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:24px;">Chưa có gói trị liệu. Tạo gói bằng cách chọn các liệu trình đang hoạt động.</td></tr>'}
        </tbody>
      </table>
    </div>
    ${therapies.length ? '' : '<p role="status" style="margin-top:14px;color:#b45309;">Cần có ít nhất một liệu trình đang hoạt động trước khi tạo gói.</p>'}
  `;

  document.getElementById('addNewPackageBtn')?.addEventListener('click', () => openPackageFormModal(null, therapies));
  container.querySelectorAll('.edit-package-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const item = serviceService.get(button.getAttribute('data-id'));
      if (item) openPackageFormModal(item, therapies);
    });
  });
  container.querySelectorAll('.del-package-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const packageId = button.getAttribute('data-id');
      showConfirmModal({
        title: 'Xóa Gói Trị Liệu?',
        message: 'Gói đã có lịch hẹn sẽ được tạm ẩn để bảo toàn lịch sử; các liệu trình thành phần không bị xóa.',
        confirmText: 'Xác Nhận',
        onConfirm: async () => {
          try {
            const result = serviceService.remove(packageId);
            if (apiClient.isOnline()) await apiClient.waitForCollectionSync('services');
            showToast(result.mode === 'deleted' ? 'Đã xóa gói trị liệu.' : 'Gói đã có lịch hẹn nên đã được tạm ẩn.', 'success');
            renderTabPackages(container);
          } catch (error) {
            showToast(error.message || 'Không thể xóa gói trị liệu.', 'danger');
          }
        },
      });
    });
  });
}

function openPackageFormModal(existingPackage, therapies) {
  const modal = document.getElementById('serviceModal');
  const body = document.getElementById('serviceModalBody');
  if (!modal || !body) return;
  activeTherapyPreviewCleanup?.();
  modal.querySelector('.modal-content')?.classList.remove('therapy-form-modal');

  const isEdit = !!existingPackage;
  const selectedComponents = new Set(existingPackage?.components || []);
  const fallbackImage = getServiceImage(existingPackage || { imageId: 'pkg-01' });
  const variants = (existingPackage?.variants || [{ duration: existingPackage?.duration || 60, price: existingPackage?.price || 500000 }])
    .map((variant) => ({ duration: Number(variant.duration), price: Number(variant.price) }));
  const variantRows = variants.map((variant) => packageVariantRow(variant)).join('');
  let pendingImageBlob = null;
  let previewObjectUrl = '';
  let imageTask = Promise.resolve();
  let imageVersion = 0;

  const releasePreview = () => {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = '';
    if (activePackagePreviewCleanup === releasePreview) activePackagePreviewCleanup = null;
  };
  activePackagePreviewCleanup?.();
  activePackagePreviewCleanup = releasePreview;

  body.innerHTML = `
    <div class="package-form-layout">
      <section class="package-form-fields" aria-labelledby="packageFormTitle">
        <h3 id="packageFormTitle" class="package-form-title">${isEdit ? 'Chỉnh Sửa Gói Trị Liệu' : 'Thêm Gói Trị Liệu'}</h3>
        <p class="package-form-intro">Gói dùng lại liệu trình có sẵn. Mỗi lịch đặt combo giữ một chuyên viên trong toàn bộ thời lượng đã chọn.</p>
        <div class="form-group"><label for="fPackageName">Tên Gói <span style="color:#ef4444;">*</span></label><input type="text" class="form-control" id="fPackageName" maxlength="80" value="${esc(existingPackage?.name || '')}" /></div>
        <div class="form-group"><label for="fPackageDesc">Mô Tả Ngắn <span style="color:#ef4444;">*</span></label><textarea class="form-control" id="fPackageDesc" rows="3" maxlength="200">${esc(existingPackage?.shortDesc || '')}</textarea></div>
        <div class="form-group package-image-upload">
          <label for="fPackageImage">Ảnh gói trị liệu</label>
          <input type="file" class="form-control" id="fPackageImage" accept="image/jpeg,image/png,image/webp" aria-describedby="packageImageHelp packageImageStatus" />
          <small id="packageImageHelp">JPG, PNG hoặc WebP. Ảnh được tối ưu (tối đa 1400 px, 1 MB) trước khi tải lên.</small>
          <small id="packageImageStatus" class="package-image-status" role="status" aria-live="polite">${isEdit && existingPackage?.imageUrl ? 'Đang dùng ảnh đã tải lên. Chọn ảnh mới nếu muốn thay.' : 'Chưa chọn ảnh mới; hệ thống dùng ảnh mặc định phù hợp.'}</small>
        </div>
        <fieldset class="package-component-fieldset">
          <legend>Liệu Trình Thành Phần <span style="color:#ef4444;">*</span></legend>
          <p>Chọn các liệu trình lẻ nằm trong combo. Chúng được tham chiếu từ catalog, không bị sao chép.</p>
          <div class="package-component-options">
            ${therapies.map((therapy) => `
              <label class="package-component-option">
                <input type="checkbox" name="packageComponent" value="${esc(therapy.id)}" ${selectedComponents.has(therapy.id) ? 'checked' : ''} />
                <span>${esc(therapy.name)} <small>${esc(therapy.categoryName || '')}</small></span>
              </label>
            `).join('') || '<span>Chưa có liệu trình đang hoạt động.</span>'}
          </div>
        </fieldset>
        <label class="package-active-toggle"><input type="checkbox" id="fPackageActive" ${existingPackage?.active === false ? '' : 'checked'} /> Hiển thị gói cho khách và cho phép đặt lịch</label>
        <div class="package-variant-fieldset">
          <div class="package-variant-heading">
            <div><strong>Mức Đặt Của Gói</strong><p>Giữ cách tính hiện tại: nhập từng thời lượng và giá của gói; thời lượng không tự cộng từ các thành phần.</p></div>
            <button type="button" class="btn-outline btn-sm" id="addPackageVariantBtn">+ Mức</button>
          </div>
          <div id="packageVariantRows">${variantRows}</div>
        </div>
        <div class="package-form-actions">
          <button type="button" class="btn-outline" id="closePackageModalBtn">Hủy</button>
          <button type="button" class="btn-primary" id="savePackageModalBtn">${isEdit ? 'Lưu Gói' : 'Tạo Gói'}</button>
        </div>
      </section>
      <aside class="package-preview-panel" aria-label="Xem trước gói trị liệu">
        <div class="package-preview-heading"><span>XEM TRƯỚC</span><small>Khách sẽ thấy nội dung gần như bên dưới</small></div>
        <article class="package-preview-card">
          <div class="package-preview-image-wrap">
            <img id="packagePreviewImage" src="${esc(fallbackImage.url)}" alt="Ảnh minh họa gói trị liệu" />
            <span class="package-preview-badge">GÓI TRỊ LIỆU</span>
          </div>
          <div class="package-preview-content">
            <h4 id="packagePreviewName">${esc(existingPackage?.name || 'Tên gói của bạn')}</h4>
            <p id="packagePreviewDescription">${esc(existingPackage?.shortDesc || 'Mô tả ngắn sẽ hiển thị ở đây.')}</p>
            <div class="package-preview-meta" id="packagePreviewMeta"></div>
            <div class="package-preview-components">
              <strong>Liệu trình trong gói</strong>
              <ul id="packagePreviewComponents"><li>Chưa chọn liệu trình</li></ul>
            </div>
            <div class="package-preview-variants" id="packagePreviewVariants"></div>
          </div>
        </article>
      </aside>
    </div>
  `;

  modal.querySelector('.modal-content')?.classList.add('package-form-modal');
  modal.classList.add('show');
  const rows = body.querySelector('#packageVariantRows');
  const saveButton = body.querySelector('#savePackageModalBtn');
  const imageStatus = body.querySelector('#packageImageStatus');
  const previewImage = body.querySelector('#packagePreviewImage');
  const defaultDuration = Number(existingPackage?.duration);
  const updatePreview = () => {
    const name = body.querySelector('#fPackageName')?.value.trim() || '';
    const description = body.querySelector('#fPackageDesc')?.value.trim() || '';
    body.querySelector('#packagePreviewName').textContent = name || 'Tên gói của bạn';
    body.querySelector('#packagePreviewDescription').textContent = description || 'Mô tả ngắn sẽ hiển thị ở đây.';
    previewImage.alt = name ? `Ảnh ${name}` : 'Ảnh minh họa gói trị liệu';

    const componentNames = [...body.querySelectorAll('input[name="packageComponent"]:checked')]
      .map((input) => therapies.find((therapy) => therapy.id === input.value)?.name)
      .filter(Boolean);
    body.querySelector('#packagePreviewComponents').innerHTML = componentNames.length
      ? componentNames.map((componentName) => `<li>${esc(componentName)}</li>`).join('')
      : '<li>Chưa chọn liệu trình</li>';

    const currentVariants = [...rows.querySelectorAll('[data-package-variant]')].map((row) => ({
      duration: Number(row.querySelector('[data-package-duration]')?.value),
      price: Number(row.querySelector('[data-package-price]')?.value),
    })).filter((variant) => Number.isFinite(variant.duration) && variant.duration > 0 && Number.isFinite(variant.price) && variant.price > 0)
      .sort((left, right) => left.duration - right.duration);
    const defaultVariant = currentVariants.find((variant) => variant.duration === defaultDuration) || currentVariants[0];
    body.querySelector('#packagePreviewMeta').textContent = defaultVariant
      ? `${defaultVariant.duration} phút · ${formatVND(defaultVariant.price)}`
      : 'Thêm thời lượng và giá gói';
    body.querySelector('#packagePreviewVariants').innerHTML = currentVariants.length > 1
      ? `<strong>Các mức khác</strong><div>${currentVariants.map((variant) => `<span>${variant.duration} phút · ${formatVND(variant.price)}</span>`).join('')}</div>`
      : '';
  };

  const bindRemoveButtons = () => rows.querySelectorAll('[data-remove-package-variant]').forEach((button) => {
    button.onclick = () => {
      if (rows.querySelectorAll('[data-package-variant]').length <= 1) return;
      button.closest('[data-package-variant]')?.remove();
      updatePreview();
    };
  });
  bindRemoveButtons();
  body.addEventListener('input', updatePreview);
  body.addEventListener('change', updatePreview);
  body.querySelector('#closePackageModalBtn')?.addEventListener('click', () => {
    releasePreview();
    modal.querySelector('.modal-content')?.classList.remove('package-form-modal');
    modal.classList.remove('show');
  });
  const topCloseButton = document.getElementById('closeModalBtn');
  if (topCloseButton) topCloseButton.onclick = () => {
    releasePreview();
    modal.querySelector('.modal-content')?.classList.remove('package-form-modal');
  };
  if (!modal.dataset.packagePreviewCleanupBound) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        activePackagePreviewCleanup?.();
        modal.querySelector('.modal-content')?.classList.remove('package-form-modal');
      }
    });
    modal.dataset.packagePreviewCleanupBound = 'true';
  }
  const imageInput = body.querySelector('#fPackageImage');
  imageInput?.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    const currentVersion = ++imageVersion;
    saveButton.disabled = true;
    imageStatus.textContent = 'Đang tối ưu ảnh…';
    imageTask = encodeServiceImage(file).then((blob) => {
      if (currentVersion !== imageVersion) return;
      pendingImageBlob = blob;
      releasePreview();
      previewObjectUrl = URL.createObjectURL(blob);
      previewImage.src = previewObjectUrl;
      imageStatus.textContent = `Ảnh đã tối ưu (${Math.max(1, Math.round(blob.size / 1024))} KB). Ảnh sẽ được tải lên khi lưu gói.`;
    }).catch((error) => {
      if (currentVersion !== imageVersion) return;
      imageInput.value = '';
      imageStatus.textContent = `${error.message} Ảnh hiện tại vẫn được giữ.`;
      showToast(error.message, 'danger');
    }).finally(() => {
      if (currentVersion === imageVersion) saveButton.disabled = false;
    });
  });
  body.querySelector('#addPackageVariantBtn')?.addEventListener('click', () => {
    const current = [...rows.querySelectorAll('[data-package-duration]')].map((input) => Number(input.value)).filter(Number.isFinite);
    const nextDuration = Math.min(480, Math.max(30, ...(current.length ? current : [30])) + 30);
    if (current.includes(nextDuration)) {
      showToast('Đã đạt giới hạn thời lượng hoặc mức này đã tồn tại.', 'normal');
      return;
    }
    const priceInput = rows.querySelector('[data-package-price]');
    rows.insertAdjacentHTML('beforeend', packageVariantRow({ duration: nextDuration, price: Number(priceInput?.value || 500000) }));
    bindRemoveButtons();
    updatePreview();
  });
  body.querySelector('#savePackageModalBtn')?.addEventListener('click', async (event) => {
    const currentSaveButton = event.currentTarget;
    if (currentSaveButton.disabled) return;
    await imageTask;
    const name = body.querySelector('#fPackageName')?.value.trim() || '';
    const shortDesc = body.querySelector('#fPackageDesc')?.value.trim() || '';
    const components = [...body.querySelectorAll('input[name="packageComponent"]:checked')].map((input) => input.value);
    const active = body.querySelector('#fPackageActive')?.checked !== false;
    const packageVariants = [...rows.querySelectorAll('[data-package-variant]')].map((row) => ({
      duration: Number(row.querySelector('[data-package-duration]')?.value),
      price: Number(row.querySelector('[data-package-price]')?.value),
    }));
    const duplicateDuration = new Set(packageVariants.map((variant) => variant.duration)).size !== packageVariants.length;
    if (name.length < 3 || shortDesc.length < 1 || !components.length || !packageVariants.length || duplicateDuration
        || packageVariants.some((variant) => !Number.isInteger(variant.duration) || variant.duration < 15 || variant.duration > 480 || variant.duration % 5 !== 0
          || !Number.isInteger(variant.price) || variant.price < 10000 || variant.price > 100000000)) {
      showToast('Kiểm tra tên, mô tả, liệu trình thành phần và từng mức thời lượng/giá của gói.', 'danger');
      return;
    }

    packageVariants.sort((left, right) => left.duration - right.duration);
    const defaultVariant = packageVariants.find((variant) => variant.duration === Number(existingPackage?.duration)) || packageVariants[0];
    currentSaveButton.disabled = true;
    const originalLabel = currentSaveButton.textContent;
    currentSaveButton.textContent = pendingImageBlob ? 'Đang tải ảnh và lưu…' : 'Đang lưu lên máy chủ…';
    let savedLocally = false;
    try {
      let imageUrl = existingPackage?.imageUrl || '';
      if (pendingImageBlob) {
        if (!apiClient.isOnline()) throw new Error('Cần kết nối máy chủ để tải ảnh gói lên. Hãy kết nối lại rồi thử lưu.');
        const uploadedImage = await apiClient.uploadPackageImage(pendingImageBlob);
        imageUrl = uploadedImage.imageUrl;
      }
      const payload = {
        kind: 'package', category: 'packages', components,
        active,
        imageId: existingPackage?.imageId || 'pkg-01',
        ...(imageUrl ? { imageUrl } : {}),
        duration: defaultVariant.duration, price: defaultVariant.price,
        variants: packageVariants, name, shortDesc,
      };
      if (isEdit) serviceService.update(existingPackage.id, payload);
      else serviceService.create(payload);
      savedLocally = true;
      await apiClient.waitForCollectionSync('services');
      showToast(isEdit ? 'Cập nhật gói trị liệu thành công!' : 'Thêm gói trị liệu thành công!', 'success');
      releasePreview();
      modal.querySelector('.modal-content')?.classList.remove('package-form-modal');
      modal.classList.remove('show');
      renderAdminDashboardPage();
    } catch (error) {
      const syncNote = savedLocally ? ' Dữ liệu đã lưu tại trình duyệt nhưng máy chủ chưa xác nhận.' : '';
      showToast(`${error.message || 'Không thể lưu gói trị liệu.'}${syncNote}`, 'danger');
    } finally {
      currentSaveButton.disabled = false;
      currentSaveButton.textContent = originalLabel;
    }
  });
  updatePreview();
}

async function encodeServiceImage(file) {
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!file || !allowedTypes.has(file.type)) throw new Error('Chọn ảnh JPG, PNG hoặc WebP.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Ảnh gốc cần nhỏ hơn 12 MB.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Không đọc được ảnh này. Hãy chọn tệp JPG, PNG hoặc WebP hợp lệ.');
  }
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close?.();
    throw new Error('Không thể tối ưu ảnh này trên trình duyệt.');
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.84));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84));
  if (!blob || blob.size > 1024 * 1024) throw new Error('Ảnh sau khi tối ưu vẫn lớn hơn 1 MB. Hãy chọn ảnh khác.');
  return blob;
}

function packageVariantRow(variant) {
  return `
    <div class="package-variant-row" data-package-variant>
      <label>Thời lượng (phút)<input type="number" min="15" max="480" step="5" class="form-control" data-package-duration value="${Number(variant.duration) || 60}" /></label>
      <label>Giá gói (VND)<input type="number" min="10000" max="100000000" step="10000" class="form-control" data-package-price value="${Number(variant.price) || 500000}" /></label>
      <button type="button" class="btn-sm btn-outline" data-remove-package-variant aria-label="Xóa mức thời lượng">Xóa</button>
    </div>
  `;
}

function openServiceFormModal(existingService, categories) {
  const modal = document.getElementById('serviceModal');
  const body = document.getElementById('serviceModalBody');
  if (!modal || !body) return;
  activePackagePreviewCleanup?.();
  modal.querySelector('.modal-content')?.classList.remove('package-form-modal');

  const isEdit = !!existingService;
  const fallbackImage = getServiceImage(existingService || { imageId: 'massage-01' });
  let pendingImageBlob = null;
  let previewObjectUrl = '';
  let imageTask = Promise.resolve();
  let imageVersion = 0;
  const releasePreview = () => {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = '';
    if (activeTherapyPreviewCleanup === releasePreview) activeTherapyPreviewCleanup = null;
  };
  activeTherapyPreviewCleanup?.();
  activeTherapyPreviewCleanup = releasePreview;

  body.innerHTML = `
    <div class="therapy-form-layout">
      <section class="therapy-form-fields package-form-fields" aria-labelledby="therapyFormTitle">
        <h3 id="therapyFormTitle" class="package-form-title">${isEdit ? 'Chỉnh Sửa Liệu Trình' : 'Thêm Liệu Trình Mới'}</h3>
        <p class="package-form-intro">Cập nhật thông tin liệu trình và ảnh minh họa để khách dễ chọn trước khi đặt lịch.</p>
        <div class="form-group">
          <label for="fSvcName">Tên Liệu Trình <span style="color:#ef4444;">*</span></label>
          <input type="text" class="form-control" id="fSvcName" maxlength="100" value="${esc(existingService?.name || '')}" />
        </div>
        <div class="form-group">
          <label for="fSvcCategory">Danh Mục <span style="color:#ef4444;">*</span></label>
          <select class="form-control" id="fSvcCategory">
            ${categories.map((c) => `<option value="${esc(c.id)}" ${existingService?.category === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <small class="therapy-group-help">Danh mục chuyên môn dùng để lọc chuyên viên, giữ nguyên theo cách hệ thống đang vận hành.</small>
        </div>
        <div class="form-group">
          <label for="fSvcTherapyGroup">Nhóm Hiển Thị <span style="color:#ef4444;">*</span></label>
          <select class="form-control" id="fSvcTherapyGroup" required>
            <option value="">Chọn nhóm liệu trình</option>
            ${THERAPY_GROUPS.map((group) => `<option value="${esc(group.id)}" ${existingService?.therapyGroup === group.id ? 'selected' : ''}>${esc(group.name)} (${esc(group.englishName)})</option>`).join('')}
          </select>
          <small class="therapy-group-help">Nhóm này chỉ tổ chức cách khách duyệt liệu trình; không đổi danh mục chuyên môn ở trên.</small>
        </div>
        <div class="therapy-form-numbers">
          <div class="form-group">
            <label for="fSvcDuration">Thời Lượng (Phút) <span style="color:#ef4444;">*</span></label>
            <input type="number" min="15" max="480" step="5" class="form-control" id="fSvcDuration" value="${existingService?.duration || 60}" />
          </div>
          <div class="form-group">
            <label for="fSvcPrice">Giá Tiêu Chuẩn (VND) <span style="color:#ef4444;">*</span></label>
            <input type="number" min="10000" step="10000" class="form-control" id="fSvcPrice" value="${existingService?.price || 500000}" />
          </div>
        </div>
        <div class="form-group">
          <label for="fSvcShortDesc">Mô Tả Ngắn <span style="color:#ef4444;">*</span></label>
          <textarea class="form-control" id="fSvcShortDesc" rows="3" maxlength="240">${esc(existingService?.shortDesc || '')}</textarea>
        </div>
        <div class="form-group package-image-upload">
          <label for="fSvcImage">Ảnh liệu trình</label>
          <input type="file" class="form-control" id="fSvcImage" accept="image/jpeg,image/png,image/webp" aria-describedby="therapyImageHelp therapyImageStatus" />
          <small id="therapyImageHelp">JPG, PNG hoặc WebP. Ảnh được tối ưu (tối đa 1400 px, 1 MB) trước khi tải lên.</small>
          <small id="therapyImageStatus" class="package-image-status" role="status" aria-live="polite">${isEdit && existingService?.imageUrl ? 'Đang dùng ảnh đã tải lên. Chọn ảnh mới nếu muốn thay.' : 'Chưa chọn ảnh mới; hệ thống dùng ảnh mặc định phù hợp.'}</small>
        </div>
        <div class="package-form-actions">
          <button type="button" class="btn-outline" id="closeSvcModalBtn">Hủy</button>
          <button type="button" class="btn-primary" id="saveSvcModalBtn">${isEdit ? 'Lưu Liệu Trình' : 'Tạo Liệu Trình'}</button>
        </div>
      </section>
      <aside class="therapy-preview-panel package-preview-panel" aria-label="Xem trước liệu trình">
        <div class="package-preview-heading"><span>XEM TRƯỚC</span><small>Thông tin cập nhật theo nội dung admin nhập</small></div>
        <article class="package-preview-card">
          <div class="package-preview-image-wrap">
            <img id="therapyPreviewImage" src="${esc(fallbackImage.url)}" alt="Ảnh minh họa liệu trình" />
            <span class="package-preview-badge">LIỆU TRÌNH</span>
          </div>
          <div class="package-preview-content">
            <h4 id="therapyPreviewName">${esc(existingService?.name || 'Tên liệu trình')}</h4>
            <p id="therapyPreviewDescription">${esc(existingService?.shortDesc || 'Mô tả liệu trình sẽ hiển thị ở đây.')}</p>
            <div class="therapy-preview-category" id="therapyPreviewCategory"></div>
            <div class="package-preview-meta" id="therapyPreviewMeta"></div>
          </div>
        </article>
      </aside>
    </div>
  `;

  modal.querySelector('.modal-content')?.classList.add('therapy-form-modal');
  modal.classList.add('show');
  const saveButton = body.querySelector('#saveSvcModalBtn');
  const previewImage = body.querySelector('#therapyPreviewImage');
  const imageInput = body.querySelector('#fSvcImage');
  const imageStatus = body.querySelector('#therapyImageStatus');
  const updateTherapyPreview = () => {
    const name = body.querySelector('#fSvcName')?.value.trim() || '';
    const shortDesc = body.querySelector('#fSvcShortDesc')?.value.trim() || '';
    const categoryId = body.querySelector('#fSvcCategory')?.value || '';
    const therapyGroup = THERAPY_GROUPS.find((group) => group.id === body.querySelector('#fSvcTherapyGroup')?.value);
    const duration = Number(body.querySelector('#fSvcDuration')?.value);
    const price = Number(body.querySelector('#fSvcPrice')?.value);
    const categoryName = categories.find((category) => category.id === categoryId)?.name || 'Chưa chọn danh mục';
    body.querySelector('#therapyPreviewName').textContent = name || 'Tên liệu trình';
    body.querySelector('#therapyPreviewDescription').textContent = shortDesc || 'Mô tả liệu trình sẽ hiển thị ở đây.';
    body.querySelector('#therapyPreviewCategory').textContent = `${categoryName}${therapyGroup ? ` · ${therapyGroup.name}` : ''}`;
    body.querySelector('#therapyPreviewMeta').textContent = `${Number.isFinite(duration) && duration > 0 ? `${duration} phút` : 'Thời lượng'} · ${Number.isFinite(price) && price > 0 ? formatVND(price) : 'Giá dịch vụ'}`;
    previewImage.alt = name ? `Ảnh ${name}` : 'Ảnh minh họa liệu trình';
  };
  body.addEventListener('input', updateTherapyPreview);
  body.addEventListener('change', updateTherapyPreview);
  body.querySelector('#closeSvcModalBtn')?.addEventListener('click', () => {
    releasePreview();
    modal.querySelector('.modal-content')?.classList.remove('therapy-form-modal');
    modal.classList.remove('show');
  });
  const topCloseButton = document.getElementById('closeModalBtn');
  if (topCloseButton) topCloseButton.onclick = () => {
    releasePreview();
    modal.querySelector('.modal-content')?.classList.remove('therapy-form-modal');
  };
  if (!modal.dataset.therapyPreviewCleanupBound) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        activeTherapyPreviewCleanup?.();
        modal.querySelector('.modal-content')?.classList.remove('therapy-form-modal');
      }
    });
    modal.dataset.therapyPreviewCleanupBound = 'true';
  }
  imageInput?.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    const currentVersion = ++imageVersion;
    saveButton.disabled = true;
    imageStatus.textContent = 'Đang tối ưu ảnh…';
    imageTask = encodeServiceImage(file).then((blob) => {
      if (currentVersion !== imageVersion) return;
      pendingImageBlob = blob;
      releasePreview();
      previewObjectUrl = URL.createObjectURL(blob);
      previewImage.src = previewObjectUrl;
      imageStatus.textContent = `Ảnh đã tối ưu (${Math.max(1, Math.round(blob.size / 1024))} KB). Ảnh sẽ được tải lên khi lưu liệu trình.`;
    }).catch((error) => {
      if (currentVersion !== imageVersion) return;
      imageInput.value = '';
      imageStatus.textContent = `${error.message} Ảnh hiện tại vẫn được giữ.`;
      showToast(error.message, 'danger');
    }).finally(() => {
      if (currentVersion === imageVersion) saveButton.disabled = false;
    });
  });
  document.getElementById('saveSvcModalBtn')?.addEventListener('click', async (event) => {
    const currentSaveButton = event.currentTarget;
    if (currentSaveButton.disabled) return;
    await imageTask;
    const name = document.getElementById('fSvcName')?.value.trim();
    const category = document.getElementById('fSvcCategory')?.value;
    const therapyGroup = document.getElementById('fSvcTherapyGroup')?.value;
    const duration = Number(document.getElementById('fSvcDuration')?.value);
    const price = Number(document.getElementById('fSvcPrice')?.value);
    const shortDesc = document.getElementById('fSvcShortDesc')?.value.trim();

    if (!therapyGroup) {
      showToast('Vui lòng chọn nhóm hiển thị cho liệu trình.', 'danger');
      document.getElementById('fSvcTherapyGroup')?.focus();
      return;
    }

    currentSaveButton.disabled = true;
    const originalLabel = currentSaveButton.textContent;
    currentSaveButton.textContent = pendingImageBlob ? 'Đang tải ảnh và lưu…' : 'Đang lưu lên máy chủ…';
    let savedLocally = false;
    try {
      let imageUrl = existingService?.imageUrl || '';
      if (pendingImageBlob) {
        if (!apiClient.isOnline()) throw new Error('Cần kết nối máy chủ để tải ảnh liệu trình lên. Hãy kết nối lại rồi thử lưu.');
        const uploadedImage = await apiClient.uploadTherapyImage(pendingImageBlob);
        imageUrl = uploadedImage.imageUrl;
      }
      const payload = { name, category, therapyGroup, duration, price, shortDesc, ...(imageUrl ? { imageUrl } : {}) };
      if (isEdit) {
        serviceService.update(existingService.id, payload);
      } else {
        serviceService.create(payload);
      }
      savedLocally = true;
      // Chỉ báo thành công sau khi bộ sưu tập dịch vụ đã được xác nhận trên API.
      await apiClient.waitForCollectionSync('services');
      showToast(isEdit ? 'Cập nhật liệu trình thành công!' : 'Thêm mới liệu trình thành công!', 'success');
      releasePreview();
      modal.querySelector('.modal-content')?.classList.remove('therapy-form-modal');
      modal.classList.remove('show');
      renderAdminDashboardPage();
    } catch (err) {
      const syncNote = savedLocally ? ' Dữ liệu đã lưu tại trình duyệt nhưng chưa xác nhận được trên máy chủ.' : '';
      showToast(`${err.message || 'Lỗi lưu thông tin liệu trình.'}${syncNote}`, 'danger');
    } finally {
      currentSaveButton.disabled = false;
      currentSaveButton.textContent = originalLabel;
    }
  });
  updateTherapyPreview();
}

/* ---------------- 4. TAB DANH MỤC (CRUD) ---------------- */
function renderTabCategories(container) {
  const cats = categoryService.list();
  const allServices = serviceService.list();
  const serviceCountByCat = new Map();
  allServices.forEach((s) => {
    const cid = s.category;
    if (cid) serviceCountByCat.set(cid, (serviceCountByCat.get(cid) || 0) + 1);
  });

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
      <div>
        <h3 style="font-family: var(--font-heading); color: var(--text-dark); margin: 0 0 4px;">Quản Lý Danh Mục Liệu Trình</h3>
        <p style="font-size: 13px; color: #64748b; margin: 0;">Phân loại dịch vụ hiển thị trên Menu và các bước đặt lịch của khách hàng.</p>
      </div>
      <span style="font-size: 13px; color: #64748b; background: #f8fafc; padding: 6px 14px; border-radius: 20px; border: 1px solid #e2e8f0;">
        Tổng số: <strong>${cats.length}</strong> danh mục
      </span>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 28px; align-items: start;">
      <!-- Cột Trái: Bảng Danh Mục -->
      <div class="data-table-wrap" style="background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); border: 1px solid #f1f5f9; overflow: hidden;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tên Danh Mục</th>
              <th style="text-align: center;">Số Dịch Vụ</th>
              <th>Trạng Thái</th>
              <th>Thao Tác</th>
            </tr>
          </thead>
          <tbody>
            ${cats.map((c) => {
              const count = serviceCountByCat.get(c.id) || 0;
              const isActive = c.active !== false;
              return `
                <tr>
                  <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span style="font-size: 16px;">📁</span>
                      <strong>${esc(c.name)}</strong>
                    </div>
                  </td>
                  <td style="text-align: center;">
                    <span style="background: #f1f5f9; color: #475569; font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 12px;">
                      ${count} liệu trình
                    </span>
                  </td>
                  <td>
                    <span class="badge-status ${isActive ? 'badge-confirmed' : 'badge-cancelled'}">
                      ${isActive ? 'Hoạt Động' : 'Tạm Ẩn'}
                    </span>
                  </td>
                  <td>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                      <button type="button" class="btn-sm btn-outline toggle-cat-btn" data-id="${esc(c.id)}" data-active="${isActive ? 'true' : 'false'}" title="${isActive ? 'Tạm ẩn' : 'Kích hoạt'}">
                        ${isActive ? 'Ẩn' : 'Bật'}
                      </button>
                      <button type="button" class="btn-sm btn-outline del-cat-btn" data-id="${esc(c.id)}" style="color:#dc2626;" title="Xóa danh mục">
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- Cột Phải: Thêm Danh Mục Mới & Hướng Dẫn -->
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <!-- Card Thêm Mới -->
        <div style="background: #fff; padding: 24px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); border: 1px solid #f1f5f9;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
            <div style="width: 36px; height: 36px; border-radius: 8px; background: #fdf6ec; color: var(--primary-brown); display: flex; align-items: center; justify-content: center; font-size: 18px;">✨</div>
            <div>
              <h4 style="font-family: var(--font-heading); margin: 0; color: var(--text-dark); font-size: 1.15rem;">Thêm Danh Mục Mới</h4>
              <p style="font-size: 12px; color: #64748b; margin: 2px 0 0 0;">Tạo nhóm để phân loại liệu trình và gán chuyên viên</p>
            </div>
          </div>
          <form id="inlineAddCatForm" novalidate>
            <div class="form-group" style="margin-bottom: 16px;">
              <label for="newCatNameInput" style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Tên Danh Mục <span style="color:#ef4444;">*</span></label>
              <input type="text" class="form-control" id="newCatNameInput" placeholder="Ví dụ: Chăm Sóc Toàn Thân, Xông Hơi..." maxlength="40" required />
            </div>
            <button type="submit" class="btn-primary" id="saveNewCatBtn" style="width: 100%; padding: 11px 20px; font-size: 14px;">
              + Thêm Danh Mục
            </button>
          </form>
        </div>

        <!-- Card Thông Tin & Hướng Dẫn -->
        <div style="background: #fdfbf7; border: 1px dashed #d6c7b2; border-radius: 12px; padding: 22px; display: flex; gap: 14px; align-items: flex-start;">
          <span style="font-size: 26px; line-height: 1;">💡</span>
          <div style="font-size: 13px; color: #574838; line-height: 1.6;">
            <strong>Vai Trò Của Danh Mục Dịch Vụ</strong><br />
            - <strong>Bộ Lọc Khách Hàng:</strong> Giúp khách hàng nhanh chóng tìm kiếm dịch vụ yêu thích trên trang đặt lịch và menu.<br />
            - <strong>Chuyên Môn Chuyên Viên:</strong> Khi tạo chuyên viên, bạn có thể gán danh mục chuyên môn để hệ thống tự động phân công lịch hẹn phù hợp.<br />
            - <strong>An Toàn Dữ Liệu:</strong> Nếu danh mục đã chứa dịch vụ, thao tác xóa sẽ tự động chuyển thành tạm ẩn để không làm hỏng lịch sử của khách.
          </div>
        </div>
      </div>
    </div>
  `;

  // Thêm danh mục từ form inline
  document.getElementById('inlineAddCatForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('newCatNameInput');
    const name = input?.value.trim();
    if (!name) {
      showToast('Vui lòng nhập tên danh mục.', 'danger');
      return;
    }
    try {
      categoryService.create({ name });
      showToast('Thêm danh mục mới thành công!', 'success');
      renderTabCategories(container);
    } catch (err) {
      showToast(err.message || 'Không thể tạo danh mục.', 'danger');
    }
  });

  // Nút Bật / Ẩn danh mục
  container.querySelectorAll('.toggle-cat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cid = btn.getAttribute('data-id');
      const isCurrentlyActive = btn.getAttribute('data-active') === 'true';
      try {
        categoryService.update(cid, { active: !isCurrentlyActive });
        showToast(`Đã ${isCurrentlyActive ? 'tạm ẩn' : 'kích hoạt'} danh mục thành công.`, 'success');
        renderTabCategories(container);
      } catch (err) {
        showToast(err.message || 'Không thể cập nhật danh mục.', 'danger');
      }
    });
  });

  // Nút Xóa danh mục
  container.querySelectorAll('.del-cat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cid = btn.getAttribute('data-id');
      showConfirmModal({
        title: 'Xóa Danh Mục?',
        message: 'Nếu danh mục đã chứa dịch vụ, hệ thống sẽ tự động tạm ẩn danh mục để bảo vệ dữ liệu.',
        confirmText: 'Xác Nhận',
        onConfirm: () => {
          try {
            const res = categoryService.remove(cid);
            showToast(res.mode === 'deactivated' ? 'Danh mục có dịch vụ nên đã được tạm ẩn.' : 'Đã xóa danh mục hoàn toàn.', 'success');
            renderTabCategories(container);
          } catch (err) {
            showToast(err.message || 'Không thể xóa danh mục.', 'danger');
          }
        }
      });
    });
  });
}

/* ---------------- 5. TAB CHUYÊN VIÊN (CRUD) ---------------- */
function renderTabStaff(container) {
  const staff = staffService.list();
  const categories = categoryService.list();
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const invitationsByStaff = new Map();
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  container.innerHTML = `
    <div class="staff-management-head">
      <div>
        <h3 style="font-family: var(--font-heading); color: var(--text-dark); margin: 0 0 6px;">Quản Lý Đội Ngũ Chuyên Viên</h3>
        <p class="staff-management-hint">Nhân viên chỉ hiện khi đang làm việc và đã chọn đúng chuyên môn. Dùng “Mời đăng nhập” để cấp tài khoản riêng cho từng chuyên viên.</p>
      </div>
      <button type="button" class="btn-primary btn-sm" id="addNewStaffBtn">+ Thêm Chuyên Viên</button>
    </div>
    <div class="staff-sync-status ${apiClient.isOnline() ? 'is-shared' : 'is-local'}" role="status">
      ${apiClient.isOnline()
        ? 'Hồ sơ nhân viên được lưu trên máy chủ Serenity.'
        : 'Máy chủ chưa kết nối. Chưa thể lưu thay đổi nhân viên.'}
    </div>

    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Chuyên Viên</th>
            <th>Chức Danh &amp; Kinh Nghiệm</th>
            <th>Chuyên Môn</th>
            <th>Ca Làm Việc</th>
            <th>Ngày Làm</th>
            <th>Trạng Thái</th>
            <th>Email Tài Khoản</th>
            <th>Tài Khoản</th>
            <th>Thao Tác</th>
          </tr>
        </thead>
        <tbody>
          ${staff.map((st) => `
            <tr>
              <td><div style="display:flex;align-items:center;gap:10px;"><img data-staff-photo src="${esc(st.imageUrl || getImageById(st.imageId).url)}" data-fallback-image="${esc(st.imageId || 'staff-01')}" alt="Ảnh ${esc(st.name)}" loading="lazy" style="width:42px;height:42px;border-radius:50%;object-fit:cover;"><strong>${esc(st.name)}</strong></div></td>
              <td>${esc(st.title)}</td>
              <td><div class="staff-specialty-chips">${(st.specialties || []).map((id) => `<span>${esc(categoryNames.get(id) || id)}</span>`).join('') || '<span class="is-empty">Chưa chọn</span>'}</div></td>
              <td>${esc(st.shiftStart || '10:00')} – ${esc(st.shiftEnd || '22:00')}</td>
              <td>${(st.workingDays || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((day) => dayNames[day] || '').filter(Boolean).join(', ') || '—'}</td>
              <td><span class="badge-status ${st.active !== false ? 'badge-confirmed' : 'badge-cancelled'}">${st.active !== false ? 'Làm Việc' : 'Tạm Nghỉ'}</span></td>
              <td data-staff-invite-email="${esc(st.id)}">${apiClient.isOnline() ? 'Đang tải…' : '—'}</td>
              <td><span data-staff-invite-status="${esc(st.id)}">${apiClient.isOnline() ? 'Đang kiểm tra…' : 'Chưa kết nối'}</span></td>
              <td>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  <button type="button" class="btn-sm btn-outline invite-staff-btn" data-id="${esc(st.id)}" ${!apiClient.isOnline() || st.active === false ? 'disabled' : ''}>Mời đăng nhập</button>
                  <button type="button" class="btn-sm btn-outline edit-staff-btn" data-id="${esc(st.id)}">Sửa</button>
                  <button type="button" class="btn-sm btn-outline del-staff-btn" data-id="${esc(st.id)}" style="color:#dc2626;">Xóa</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('[data-staff-photo]').forEach((image) => {
    image.addEventListener('error', () => {
      const fallback = getImageById(image.dataset.fallbackImage || 'staff-01').url;
      if (image.src !== new URL(fallback, window.location.href).href) image.src = fallback;
    }, { once: true });
  });

  document.getElementById('addNewStaffBtn')?.addEventListener('click', () => openStaffFormModal(null, categories, container));

  container.querySelectorAll('.invite-staff-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const staffMember = staffService.get(btn.getAttribute('data-id'));
      if (staffMember) openStaffInviteForm(staffMember, invitationsByStaff.get(staffMember.id), container);
    });
  });

  container.querySelectorAll('.edit-staff-btn').forEach((btn) => {
    btn.addEventListener('click', () => openStaffFormModal(staffService.get(btn.getAttribute('data-id')), categories, container));
  });

  container.querySelectorAll('.del-staff-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sid = btn.getAttribute('data-id');
      showConfirmModal({
        title: 'Xóa Chuyên Viên?',
        message: 'Nếu chuyên viên đã có lịch phục vụ, hệ thống sẽ tạm ẩn chuyên viên để bảo toàn lịch sử.',
        confirmText: 'Xác Nhận',
        onConfirm: () => {
          staffService.remove(sid);
          showToast('Đã xóa hoặc tạm ẩn chuyên viên.', 'success');
          renderTabStaff(container);
        }
      });
    });
  });

  if (apiClient.isOnline()) {
    apiClient.listStaffInvites().then(({ invitations = [] }) => {
      invitations.forEach((invite) => invitationsByStaff.set(invite.staffId, invite));
      for (const member of staff) {
        const invite = invitationsByStaff.get(member.id);
        const emailCell = container.querySelector(`[data-staff-invite-email="${CSS.escape(member.id)}"]`);
        const statusCell = container.querySelector(`[data-staff-invite-status="${CSS.escape(member.id)}"]`);
        const inviteButton = container.querySelector(`.invite-staff-btn[data-id="${CSS.escape(member.id)}"]`);
        if (emailCell) emailCell.textContent = invite?.email || '—';
        if (statusCell) statusCell.textContent = ({
          active: 'Đã kích hoạt', pending: `Đã mời · hết hạn ${invite?.expiresAt ? formatDate(invite.expiresAt.slice(0, 10)) : 'sau 7 ngày'}`,
          expired: 'Lời mời hết hạn', inactive: 'Tài khoản bị khóa', none: 'Chưa có tài khoản',
        })[invite?.status] || 'Chưa có tài khoản';
        if (inviteButton) {
          inviteButton.textContent = invite?.status === 'active' ? 'Đã kích hoạt' : invite?.status === 'pending' || invite?.status === 'expired' || invite?.status === 'inactive' ? 'Gửi lại lời mời' : 'Mời đăng nhập';
          inviteButton.disabled = member.active === false || invite?.status === 'active';
        }
      }
    }).catch((error) => {
      container.querySelectorAll('[data-staff-invite-status]').forEach((node) => { node.textContent = 'Không tải được trạng thái'; });
      container.querySelectorAll('.invite-staff-btn').forEach((button) => { button.disabled = true; });
      showToast(error.message || 'Không tải được trạng thái lời mời.', 'danger');
    });
  }
}

function openStaffInviteForm(staff, previousInvite, container) {
  const modal = document.getElementById('staffModal');
  const body = document.getElementById('staffModalBody');
  if (!modal || !body) return;
  const closeModal = () => { modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); };
  body.innerHTML = `
    <div style="padding:28px;max-height:85vh;overflow:auto;">
      <h3 style="font-family:var(--font-heading);font-size:1.45rem;color:var(--text-dark);margin:0 45px 10px 0;">Mời chuyên viên đăng nhập</h3>
      <p style="color:#64748b;margin:0 0 20px;">Tạo lời mời riêng cho <strong>${esc(staff.name)}</strong>. Nhân viên sẽ tự đặt mật khẩu và xác nhận số điện thoại.</p>
      <div id="staffInviteModalContent">
        <div class="form-group">
          <label for="staffInviteEmailInput">Email của nhân viên <span style="color:#ef4444;">*</span></label>
          <input type="email" class="form-control" id="staffInviteEmailInput" autocomplete="email" maxlength="254" value="${esc(previousInvite?.email || '')}" placeholder="ten@vidu.vn" required>
        </div>
        <small style="display:block;color:#64748b;line-height:1.55;margin-top:-8px;">Lời mời có hiệu lực 7 ngày. Gửi lại sẽ vô hiệu hóa liên kết cũ.</small>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:22px;">
          <button type="button" class="btn-outline" id="cancelStaffInviteBtn">Hủy</button>
          <button type="button" class="btn-primary" id="createStaffInviteBtn">Tạo lời mời</button>
        </div>
      </div>
    </div>`;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  const closeButton = document.getElementById('closeStaffModalTop');
  if (closeButton) closeButton.onclick = closeModal;
  document.getElementById('cancelStaffInviteBtn')?.addEventListener('click', closeModal);
  document.getElementById('createStaffInviteBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const email = document.getElementById('staffInviteEmailInput')?.value.trim().toLowerCase() || '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      showToast('Vui lòng nhập địa chỉ email hợp lệ.', 'danger');
      return;
    }
    button.disabled = true;
    button.textContent = 'Đang tạo…';
    try {
      const result = await apiClient.createStaffInvite({ staffId: staff.id, email });
      const invitation = { ...result.invitation, status: 'pending' };
      showStaffInviteResult(staff, result.invitationUrl, invitation, closeModal);
      renderTabStaff(container);
    } catch (error) {
      showToast(error.message || 'Không thể tạo lời mời.', 'danger');
      button.disabled = false;
      button.textContent = 'Tạo lời mời';
    }
  });
}

function showStaffInviteResult(staff, invitationUrl, invitation, closeModal) {
  const body = document.getElementById('staffModalBody');
  if (!body) return;
  const subject = encodeURIComponent('Lời mời tham gia đội ngũ Serenity Spa');
  const message = encodeURIComponent(`Chào ${staff.name},\n\nBạn được mời kích hoạt tài khoản chuyên viên tại Serenity Spa. Mở liên kết sau để đặt mật khẩu (liên kết có hiệu lực 7 ngày và chỉ dùng một lần):\n\n${invitationUrl}\n\nMật khẩu cần tối thiểu 8 ký tự, có một chữ số và một ký tự đặc biệt.`);
  const mailto = `mailto:${encodeURIComponent(invitation.email)}?subject=${subject}&body=${message}`;
  body.innerHTML = `
    <div style="padding:28px;max-height:85vh;overflow:auto;">
      <h3 style="font-family:var(--font-heading);font-size:1.45rem;color:var(--text-dark);margin:0 45px 10px 0;">Đã tạo lời mời cho ${esc(staff.name)}</h3>
      <p style="color:#64748b;">Gửi liên kết này đến <strong>${esc(invitation.email)}</strong>. Liên kết hết hạn sau 7 ngày và dùng được một lần.</p>
      <label for="staffInviteLinkOutput" style="display:block;font-weight:600;margin:14px 0 6px;">Liên kết kích hoạt</label>
      <input type="text" class="form-control" id="staffInviteLinkOutput" readonly value="${esc(invitationUrl)}" style="font-size:13px;">
      <small style="display:block;color:#64748b;margin-top:8px;">Chưa cấu hình máy chủ gửi email tự động; nút bên dưới mở ứng dụng email của bạn với nội dung đã soạn sẵn.</small>
      <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:22px;">
        <button type="button" class="btn-outline" id="copyStaffInviteLinkBtn">Sao chép liên kết</button>
        <a class="btn-primary" id="sendStaffInviteEmailBtn" href="${esc(mailto)}" style="text-decoration:none;display:inline-flex;align-items:center;">Mở email để gửi</a>
        <button type="button" class="btn-outline" id="closeStaffInviteResultBtn">Đóng</button>
      </div>
    </div>`;
  const closeButton = document.getElementById('closeStaffModalTop');
  if (closeButton) closeButton.onclick = closeModal;
  document.getElementById('closeStaffInviteResultBtn')?.addEventListener('click', closeModal);
  document.getElementById('copyStaffInviteLinkBtn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(invitationUrl);
      showToast('Đã sao chép liên kết lời mời.', 'success');
    } catch {
      const input = document.getElementById('staffInviteLinkOutput');
      input?.focus(); input?.select();
      showToast('Hãy sao chép liên kết đang được chọn.', 'normal');
    }
  });
}

async function encodeStaffPhoto(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Chọn một tệp ảnh hợp lệ.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Ảnh gốc cần nhỏ hơn 10 MB.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Không thể đọc ảnh này trên trình duyệt.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
  if (!blob || !blob.type.includes('webp')) blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob || blob.size > 300 * 1024) throw new Error('Ảnh sau khi thu nhỏ vẫn lớn hơn 300 KB. Vui lòng chọn ảnh khác.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Không đọc được tệp ảnh.'));
    reader.readAsDataURL(blob);
  });
}

function openStaffFormModal(existingStaff, categories, container) {
  const modal = document.getElementById('staffModal');
  const body = document.getElementById('staffModalBody');
  if (!modal || !body) return;
  const isEdit = Boolean(existingStaff);
  const weekDays = [{ value: 1, label: 'T2' }, { value: 2, label: 'T3' }, { value: 3, label: 'T4' }, { value: 4, label: 'T5' }, { value: 5, label: 'T6' }, { value: 6, label: 'T7' }, { value: 0, label: 'CN' }];
  const defaultSpecialties = ['body-massages', 'focus-therapy'];
  let imageUrl = existingStaff?.imageUrl || '';
  let photoTask = Promise.resolve();
  let photoTaskError = null;
  let photoVersion = 0;
  let staffSavedLocally = false;
  const currentImage = imageUrl || getImageById(existingStaff?.imageId || 'staff-01').url;

  body.innerHTML = `
    <div style="padding:28px;max-height:85vh;overflow:auto;">
      <h3 style="font-family:var(--font-heading);font-size:1.45rem;color:var(--text-dark);margin:0 45px 20px 0;">
        ${isEdit ? 'Chỉnh Sửa Hồ Sơ Chuyên Viên' : 'Thêm Chuyên Viên Mới'}
      </h3>
      <div style="display:grid;grid-template-columns:110px 1fr;gap:18px;align-items:center;margin-bottom:20px;">
        <img id="staffPhotoPreview" src="${esc(currentImage)}" alt="Ảnh xem trước" style="width:100px;height:100px;object-fit:cover;border-radius:50%;border:1px solid #e2e8f0;">
        <div class="form-group" style="margin:0;">
          <label for="staffPhotoInput">Ảnh đại diện</label>
          <input type="file" class="form-control" id="staffPhotoInput" accept="image/*">
          <small style="color:#64748b;">Ảnh mới chỉ được lưu sau khi nén xong (tối đa 300 KB).</small>
          <small id="staffPhotoStatus" role="status" style="display:block;color:#64748b;margin-top:4px;"></small>
        </div>
      </div>
      <div class="form-group">
        <label for="staffNameInput">Họ và tên <span style="color:#ef4444;">*</span></label>
        <input type="text" class="form-control" id="staffNameInput" maxlength="60" value="${esc(existingStaff?.name || '')}" placeholder="Ví dụ: Trần Hà Linh">
      </div>
      <div class="form-group">
        <label for="staffTitleInput">Chức danh / kinh nghiệm <span style="color:#ef4444;">*</span></label>
        <input type="text" class="form-control" id="staffTitleInput" maxlength="100" value="${esc(existingStaff?.title || 'Therapist')}" placeholder="Ví dụ: Senior Therapist • 5 năm kinh nghiệm">
      </div>
      <div class="form-group">
        <label>Chuyên môn phục vụ <span style="color:#ef4444;">*</span></label>
        <div style="display:flex;flex-wrap:wrap;gap:8px 16px;padding:8px 0;">
          ${categories.map((category) => `
            <label style="display:flex;align-items:center;gap:6px;font-weight:400;">
              <input type="checkbox" class="staff-specialty-option" value="${esc(category.id)}" ${(existingStaff?.specialties || defaultSpecialties).includes(category.id) ? 'checked' : ''}>
              ${esc(category.name)}
            </label>
          `).join('')}
        </div>
      </div>
      <div style="display:flex;gap:14px;">
        <div class="form-group" style="flex:1;">
          <label for="staffShiftStart">Bắt đầu ca</label>
          <input type="time" class="form-control" id="staffShiftStart" value="${esc(existingStaff?.shiftStart || '10:00')}">
        </div>
        <div class="form-group" style="flex:1;">
          <label for="staffShiftEnd">Kết thúc ca</label>
          <input type="time" class="form-control" id="staffShiftEnd" value="${esc(existingStaff?.shiftEnd || '22:00')}">
        </div>
      </div>
      <div class="form-group">
        <label>Ngày làm việc <span style="color:#ef4444;">*</span></label>
        <div style="display:flex;flex-wrap:wrap;gap:8px 16px;padding:8px 0;">
          ${weekDays.map((day) => `
            <label style="display:flex;align-items:center;gap:6px;font-weight:400;">
              <input type="checkbox" class="staff-working-day-option" value="${day.value}" ${(existingStaff?.workingDays || [0, 1, 2, 3, 4, 5, 6]).includes(day.value) ? 'checked' : ''}>
              ${day.label}
            </label>
          `).join('')}
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:22px;">
        <button type="button" class="btn-outline" id="cancelStaffFormBtn">Hủy</button>
        <button type="button" class="btn-primary" id="saveStaffFormBtn">${isEdit ? 'Lưu Thay Đổi' : 'Thêm Chuyên Viên'}</button>
      </div>
    </div>
  `;

  const closeModal = () => { modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); };
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  const closeButton = document.getElementById('closeStaffModalTop');
  if (closeButton) closeButton.onclick = closeModal;
  document.getElementById('cancelStaffFormBtn')?.addEventListener('click', closeModal);
  document.getElementById('staffPhotoInput')?.addEventListener('change', (event) => {
    const photoInput = event.currentTarget;
    const file = photoInput.files?.[0];
    if (!file) return;
    const version = ++photoVersion;
    const saveButton = document.getElementById('saveStaffFormBtn');
    const photoStatus = document.getElementById('staffPhotoStatus');
    photoTaskError = null;
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Đang xử lý ảnh…'; }
    if (photoStatus) photoStatus.textContent = 'Đang thu nhỏ ảnh…';
    photoTask = encodeStaffPhoto(file).then((encoded) => {
      if (version !== photoVersion) return;
      imageUrl = encoded;
      const preview = document.getElementById('staffPhotoPreview');
      if (preview) preview.src = imageUrl;
      if (photoStatus) photoStatus.textContent = 'Ảnh mới đã sẵn sàng để lưu.';
    }).catch((error) => {
      if (version !== photoVersion) return;
      photoTaskError = error;
      photoInput.value = '';
      showToast(error.message || 'Không thể dùng ảnh này.', 'danger');
      if (photoStatus) photoStatus.textContent = 'Ảnh chưa được thay đổi. Hãy chọn ảnh khác.';
    }).finally(() => {
      if (version === photoVersion && saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = isEdit ? 'Lưu Thay Đổi' : 'Thêm Chuyên Viên';
      }
    });
  });
  document.getElementById('saveStaffFormBtn')?.addEventListener('click', async (event) => {
    const saveButton = event.currentTarget;
    if (photoTask) await photoTask;
    if (photoTaskError) {
      showToast('Ảnh vừa chọn chưa xử lý được. Hãy chọn ảnh hợp lệ rồi lưu lại.', 'danger');
      return;
    }
    const saveLabel = isEdit ? 'Lưu Thay Đổi' : 'Thêm Chuyên Viên';
    saveButton.disabled = true;
    saveButton.textContent = 'Đang lưu…';
    const name = document.getElementById('staffNameInput')?.value.trim();
    const title = document.getElementById('staffTitleInput')?.value.trim();
    const specialties = [...body.querySelectorAll('.staff-specialty-option:checked')].map((input) => input.value);
    const workingDays = [...body.querySelectorAll('.staff-working-day-option:checked')].map((input) => Number(input.value));
    const data = {
      name,
      title,
      specialties,
      workingDays,
      shiftStart: document.getElementById('staffShiftStart')?.value,
      shiftEnd: document.getElementById('staffShiftEnd')?.value,
      ...(imageUrl ? { imageUrl } : {}),
    };
    try {
      if (!apiClient.isOnline()) throw new Error('Máy chủ ở cổng 3001 chưa kết nối. Thay đổi chưa được lưu.');
      if (!staffSavedLocally) {
        if (isEdit) staffService.update(existingStaff.id, data);
        else staffService.create(data);
        staffSavedLocally = true;
      }
      await apiClient.waitForCollectionSync('staff');
      closeModal();
      showToast(isEdit ? 'Đã cập nhật hồ sơ chuyên viên trên máy chủ.' : 'Đã thêm chuyên viên mới trên máy chủ.', 'success');
      renderTabStaff(container);
    } catch (error) {
      if (staffSavedLocally) {
        saveButton.textContent = 'Thử đồng bộ lại';
        body.querySelectorAll('input').forEach((input) => { input.disabled = true; });
        showToast(`Đã lưu trên máy này nhưng chưa đồng bộ lên máy chủ: ${error.message || 'lỗi kết nối.'}`, 'danger');
      } else {
        saveButton.textContent = saveLabel;
        showToast(error.message || 'Không thể lưu hồ sơ chuyên viên.', 'danger');
      }
    } finally {
      if (modal.classList.contains('show') && !staffSavedLocally) saveButton.disabled = false;
      else if (modal.classList.contains('show')) saveButton.disabled = false;
    }
  });
}

/* ---------------- 6. TAB KHUYẾN MÃI (CRUD) ---------------- */
function renderTabPromotions(container) {
  const promos = promotionService.list();

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h3 style="font-family: var(--font-heading); color: var(--text-dark); margin: 0;">Mã Giảm Giá &amp; Khuyến Mãi</h3>
      <button type="button" class="btn-primary btn-sm" id="addNewPromoBtn">+ Tạo Mã Mới</button>
    </div>

    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Mã Code</th>
            <th>Loại &amp; Mức Giảm</th>
            <th>Đơn Tối Thiểu</th>
            <th>Hết Hạn</th>
            <th>Đã Dùng / Giới Hạn</th>
            <th>Trạng Thái</th>
          </tr>
        </thead>
        <tbody>
          ${promos.map((p) => `
            <tr>
              <td><strong style="color:var(--primary-brown);">${esc(p.code)}</strong></td>
              <td>${p.type === 'percent' ? `Giảm ${p.value}% (tối đa ${formatVND(p.maxDiscount)})` : `Giảm ${formatVND(p.value)}`}</td>
              <td>${formatVND(p.minOrder)}</td>
              <td>${formatDate(p.expiresAt)}</td>
              <td>${p.usedCount} / ${p.usageLimit || '∞'}</td>
              <td><span class="badge-status ${p.active !== false ? 'badge-confirmed' : 'badge-cancelled'}">${p.active !== false ? 'Bật' : 'Tắt'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('addNewPromoBtn')?.addEventListener('click', () => {
    const code = prompt('Nhập mã khuyến mãi mới (Ví dụ: HELLO10):');
    if (code && code.trim()) {
      try {
        promotionService.create({
          code: code.trim(),
          type: 'percent',
          value: 10,
          expiresAt: '2030-12-31',
          minOrder: 200000,
          maxDiscount: 100000
        });
        showToast('Tạo mã khuyến mãi thành công!', 'success');
        renderTabPromotions(container);
      } catch (e) {
        showToast(e.message, 'danger');
      }
    }
  });
}

/* ---------------- 7. TAB LIÊN HỆ ---------------- */
function renderTabContacts(container) {
  const list = contactService.list();

  container.innerHTML = `
    <h3 style="font-family: var(--font-heading); color: var(--text-dark); margin-bottom: 20px;">
      Tin Nhắn &amp; Yêu Cầu Tư Vấn (${list.length})
    </h3>

    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Họ Tên</th>
            <th>Số Điện Thoại</th>
            <th>Tiêu Đề</th>
            <th>Nội Dung</th>
            <th>Trạng Thái</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((c) => `
            <tr>
              <td><strong>${esc(c.name)}</strong></td>
              <td><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></td>
              <td>${esc(c.subject)}</td>
              <td><small>${esc(c.message)}</small></td>
              <td><span class="badge-status ${c.status === 'new' ? 'badge-pending' : 'badge-completed'}">${c.status}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ---------------- 8. TAB CÀI ĐẶT SPA ---------------- */
function renderTabSettings(container) {
  const set = settingsService.get();

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 24px; align-items: start;">
      <!-- Cột Trái: Cài Đặt Vận Hành Spa -->
      <div style="background: #fff; padding: 28px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); border: 1px solid #f1f5f9;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
          <div style="width: 36px; height: 36px; border-radius: 8px; background: #e0f2fe; color: #0369a1; display: flex; align-items: center; justify-content: center; font-size: 18px;">⚙</div>
          <div>
            <h3 style="font-family: var(--font-heading); color: var(--text-dark); margin: 0; font-size: 1.25rem;">
              Cài Đặt Vận Hành Spa &amp; Đặt Lịch
            </h3>
            <p style="font-size: 12px; color: #64748b; margin: 2px 0 0 0;">Cấu hình thời gian phục vụ, bước khung giờ và số phòng spa</p>
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 16px;">
          <label style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Tên Spa &amp; Thương Hiệu</label>
          <input type="text" class="form-control" id="stSpaName" value="${esc(set.spaName)}" />
        </div>

        <div style="display:flex;gap:15px;margin-bottom: 16px;">
          <div class="form-group" style="flex:1;">
            <label style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Giờ Mở Cửa (Hàng ngày)</label>
            <input type="time" class="form-control" id="stOpenTime" value="${set.openTime}" />
          </div>
          <div class="form-group" style="flex:1;">
            <label style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Giờ Đóng Cửa (Hàng ngày)</label>
            <input type="time" class="form-control" id="stCloseTime" value="${set.closeTime}" />
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 16px;">
          <label style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Bước Khung Giờ Đặt Lịch (Slot Step)</label>
          <select class="form-control" id="stSlotStep">
            <option value="15" ${set.slotStep === 15 ? 'selected' : ''}>15 Phút</option>
            <option value="30" ${set.slotStep === 30 ? 'selected' : ''}>30 Phút (Mặc định)</option>
            <option value="60" ${set.slotStep === 60 ? 'selected' : ''}>60 Phút</option>
          </select>
        </div>

        <div class="form-group" style="margin-bottom: 16px;">
          <label style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Số Phòng Có Thể Phục Vụ Cùng Lúc</label>
          <input type="number" class="form-control" id="stRoomCount" value="${Number(set.roomCount) || 0}" min="0" max="100" step="1" />
          <small style="color:#64748b; font-size: 12px; display: block; margin-top: 4px;">Nhập số phòng thực tế để giới hạn lịch trùng giờ giữa các chuyên viên. Để 0 nếu không giới hạn phòng.</small>
        </div>

        <div class="form-group" style="margin-bottom: 16px;">
          <label style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Kênh Nhắn Tin Ưu Tiên</label>
          <select class="form-control" id="stNotificationChannel">
            <option value="zalo" ${set.notificationChannel === 'zalo' ? 'selected' : ''}>Zalo</option>
            <option value="sms" ${set.notificationChannel === 'sms' ? 'selected' : ''}>SMS</option>
            <option value="email" ${set.notificationChannel === 'email' ? 'selected' : ''}>Email</option>
          </select>
          <small style="color:#64748b; font-size: 12px; display: block; margin-top: 4px;">Nút tin nhắn sẽ mở kênh đã chọn để bạn gửi nội dung mẫu cho khách.</small>
        </div>

        <div class="form-group" style="margin-bottom: 20px;">
          <label style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Giới Hạn Hủy Lịch Trước (Tiếng)</label>
          <input type="number" class="form-control" id="stCancelHours" value="${set.cancelBeforeHours ?? 2}" min="0" step="1" />
          <small style="color:#64748b; font-size: 12px; display: block; margin-top: 4px;">Khách hàng chỉ được hủy lịch trực tuyến trước giờ hẹn tối thiểu số tiếng này.</small>
        </div>

        <button type="button" class="btn-primary" id="saveSettingsBtn" style="padding: 12px 28px; width: 100%; font-size: 14px;">
          Lưu Cài Đặt Hệ Thống
        </button>
      </div>

      <!-- Cột Phải: Bảo Mật Tài Khoản & Thông Tin Hệ Thống -->
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div style="background: #fff; padding: 28px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); border: 1px solid #f1f5f9;">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
            <div style="width: 36px; height: 36px; border-radius: 8px; background: #fef2f2; color: #dc2626; display: flex; align-items: center; justify-content: center; font-size: 18px;">🔑</div>
            <div>
              <h4 style="font-family: var(--font-heading); margin: 0; color: var(--text-dark); font-size: 1.15rem;">Đổi Mật Khẩu Quản Trị</h4>
              <p style="font-size: 12px; color: #64748b; margin: 2px 0 0 0;">Cập nhật mật khẩu quản trị viên hiện tại</p>
            </div>
          </div>
          <div class="form-group" style="margin-bottom: 14px;">
            <label for="adminOldPasswordInput" style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Mật khẩu hiện tại</label>
            <input type="password" class="form-control" id="adminOldPasswordInput" autocomplete="current-password" placeholder="Nhập mật khẩu đang dùng..." />
          </div>
          <div class="form-group" style="margin-bottom: 14px;">
            <label for="adminNewPasswordInput" style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Mật khẩu mới</label>
            <input type="password" class="form-control" id="adminNewPasswordInput" autocomplete="new-password" minlength="8" placeholder="Nhập mật khẩu mới..." />
            <small style="display:block;margin-top:5px;color:#64748b;font-size:12px;">Tối thiểu 8 ký tự, gồm ít nhất 1 chữ số và 1 ký tự đặc biệt.</small>
          </div>
          <div class="form-group" style="margin-bottom: 20px;">
            <label for="adminConfirmPasswordInput" style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Xác nhận mật khẩu mới</label>
            <input type="password" class="form-control" id="adminConfirmPasswordInput" autocomplete="new-password" minlength="8" placeholder="Nhập lại mật khẩu mới..." />
          </div>
          <button type="button" class="btn-outline" id="adminSavePasswordBtn" style="width: 100%; padding: 11px 20px; font-size: 14px;">Cập Nhật Mật Khẩu Quản Trị</button>
        </div>

        <div style="background: #fdfbf7; border: 1px dashed #d6c7b2; border-radius: 12px; padding: 22px; display: flex; gap: 14px; align-items: flex-start;">
          <span style="font-size: 26px; line-height: 1;">🛡️</span>
          <div style="font-size: 13px; color: #574838; line-height: 1.6;">
            <strong>Lưu Ý Vận Hành Quản Trị</strong><br />
            - Khi thay đổi giờ mở cửa hoặc bước khung giờ đặt lịch, hệ thống sẽ tự động cập nhật bảng giờ trống (slot picker) cho toàn bộ khách hàng trên website.<br />
            - Nếu cần tạm đóng spa cho ngày nghỉ lễ, bạn có thể tạo chiến dịch khuyến mãi hoặc thông báo qua kênh Zalo/SMS.
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('adminSavePasswordBtn')?.addEventListener('click', async () => {
    const currentUser = authService.getCurrentUser();
    if (!currentUser) return;
    const oldPass = document.getElementById('adminOldPasswordInput')?.value || '';
    const newPass = document.getElementById('adminNewPasswordInput')?.value || '';
    const confirmPass = document.getElementById('adminConfirmPasswordInput')?.value || '';
    try {
      await authService.changePassword(currentUser.id, oldPass, newPass, confirmPass);
      document.getElementById('adminOldPasswordInput').value = '';
      document.getElementById('adminNewPasswordInput').value = '';
      document.getElementById('adminConfirmPasswordInput').value = '';
      showToast('Đã đổi mật khẩu quản trị thành công!', 'success');
    } catch (err) {
      showToast(err.message || 'Không thể đổi mật khẩu.', 'danger');
    }
  });

  document.getElementById('saveSettingsBtn')?.addEventListener('click', () => {
    const spaName = document.getElementById('stSpaName')?.value.trim();
    const openTime = document.getElementById('stOpenTime')?.value;
    const closeTime = document.getElementById('stCloseTime')?.value;
    const slotStep = Number(document.getElementById('stSlotStep')?.value);
    const roomCount = Number(document.getElementById('stRoomCount')?.value);
    const notificationChannel = document.getElementById('stNotificationChannel')?.value;
    const cancelBeforeHours = Number(document.getElementById('stCancelHours')?.value);

    try {
      settingsService.update({ spaName, openTime, closeTime, slotStep, roomCount, notificationChannel, cancelBeforeHours });
      showToast('Đã lưu cài đặt vận hành Spa!', 'success');
      renderAdminDashboardPage();
    } catch (err) {
      showToast(err.message || 'Lỗi lưu cài đặt.', 'danger');
    }
  });
}
