/**
 * Trang Bảng Làm Việc Của Nhân Viên Trị Liệu (#/staff).
 * Tính năng:
 * - Dành riêng cho tài khoản Staff (hoặc Admin chuyển vai trò).
 * - Tự động tải danh sách booking thuộc về chuyên viên đăng nhập (staffId).
 * - Lọc theo: Hôm nay / Ngày cụ thể / Tuần này.
 * - Cập nhật trạng thái "Hoàn Thành" (Completed) cho lịch hẹn.
 * - Thống kê số lượng ca đã phục vụ và doanh số tương ứng.
 */
import { bookingService } from '../services/bookingService.js';
import { authService } from '../services/authService.js';
import { staffService } from '../services/staffSettingsPromoService.js';
import { todayStr, formatVND, esc, formatDate, businessNow, timeToMin } from '../core/utils.js';
import { showToast, showConfirmModal } from '../ui/components.js';

let filterDate = todayStr();

export function renderStaffDashboardPage() {
  const root = document.getElementById('appRoot');
  if (!root) return;

  const currentUser = authService.getCurrentUser();

  // Kiểm tra quyền
  if (!currentUser || (currentUser.role !== 'staff' && currentUser.role !== 'admin')) {
    root.innerHTML = `
      <div class="section-container" style="text-align: center; padding: 100px 20px;">
        <div style="font-size: 48px; margin-bottom: 15px;">🔒</div>
        <h2>Khu Vực Dành Cho Chuyên Viên Trị Liệu</h2>
        <p style="color: var(--text-light); margin: 15px 0 25px 0;">Vui lòng đăng nhập với tài khoản chuyên viên để xem lịch phân công.</p>
        <a href="#/login" class="btn-primary" style="display: inline-block; text-decoration: none;">Đăng Nhập Chuyên Viên</a>
      </div>
    `;
    return;
  }

  // Lấy thông tin Staff tương ứng
  const staffId = currentUser.staffId || 'st-01';
  const staffInfo = staffService.get(staffId) || { name: currentUser.name, title: 'Senior Therapist' };
  const allStaffBookings = bookingService.byStaff(staffId);
  const todayBookings = bookingService.byStaff(staffId, todayStr());

  const completedCount = allStaffBookings.filter((b) => b.status === 'Completed').length;
  const currentFilteredList = filterDate ? allStaffBookings.filter((b) => b.date === filterDate) : allStaffBookings;

  root.innerHTML = `
    <div class="page-banner" style="padding: 35px 20px;">
      <div class="breadcrumbs"><a href="#/" style="color:inherit;text-decoration:none;">Trang Chủ</a> / Staff Portal</div>
      <h1 style="font-size: 2.2rem;">LỊCH LÀM VIỆC CHUYÊN VIÊN</h1>
      <p>Chuyên viên: <strong>${esc(staffInfo.name)}</strong> (${esc(staffInfo.title)})</p>
    </div>

    <div class="section-container" style="padding-top: 35px; padding-bottom: 70px;">
      <!-- KPI Nhanh -->
      <div class="kpi-grid">
        <div class="kpi-card green">
          <div class="kpi-title">Lịch Hẹn Hôm Nay</div>
          <div class="kpi-value">${todayBookings.length}</div>
        </div>
        <div class="kpi-card blue">
          <div class="kpi-title">Ca Hoàn Thành (Tổng)</div>
          <div class="kpi-value">${completedCount}</div>
        </div>
        <div class="kpi-card orange">
          <div class="kpi-title">Tổng Lịch Được Giao</div>
          <div class="kpi-value">${allStaffBookings.length}</div>
        </div>
      </div>

      <!-- Filter Thanh Ngày -->
      <div style="background: #fff; padding: 15px 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); margin-bottom: 25px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 15px;">
        <div style="display: flex; gap: 10px; align-items: center;">
          <label style="font-size: 13px; font-weight: 600; color: #475569;">Chọn Ngày Xem Ca:</label>
          <input type="date" class="form-control" id="staffDateFilterInput" value="${filterDate}" style="width: auto;" />
          <button type="button" class="btn-outline btn-sm" id="staffTodayBtn">Hôm Nay</button>
          <button type="button" class="btn-outline btn-sm" id="staffAllBtn">Xem Tất Cả</button>
        </div>
        <div style="font-size: 13px; color: #64748b;">
          Đang hiển thị: <strong>${currentFilteredList.length}</strong> ca trị liệu
        </div>
      </div>

      <!-- Danh Sách Lịch Phục Vụ -->
      ${currentFilteredList.length === 0 ? `
        <div style="text-align: center; padding: 50px 20px; background: #fff; border-radius: 8px;">
          <div style="font-size: 36px; margin-bottom: 10px;">☕</div>
          <h4 style="color: var(--text-dark); margin-bottom: 4px;">Không có ca trị liệu nào</h4>
          <p style="color: var(--text-light); font-size: 13px;">Chuyên viên không có lịch hẹn khách trong ngày đã chọn.</p>
        </div>
      ` : `
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Giờ Bắt Đầu</th>
                <th>Khách Hàng &amp; SĐT</th>
                <th>Liệu Trình</th>
                <th>Thời Lượng</th>
                <th>Ghi Chú Yêu Cầu</th>
                <th>Trạng Thái</th>
                <th>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              ${currentFilteredList.map((b) => `
                <tr>
                  <td>
                    <div style="font-weight: bold; color: var(--primary-brown); font-size: 14px;">${b.startTime} - ${b.endTime}</div>
                    <div style="font-size: 11px; color: #64748b;">${formatDate(b.date)}</div>
                    ${b.roomNumber ? `<div style="font-size:11px;color:#64748b;">Phòng ${Number(b.roomNumber)}</div>` : ''}
                  </td>
                  <td>
                    <strong>${esc(b.customerName)}</strong>
                    <div style="font-size: 12px; color: #64748b;"><a href="tel:${esc(b.customerPhone)}" style="color:inherit;">${esc(b.customerPhone)}</a></div>
                  </td>
                  <td>
                    <strong>${esc(b.serviceName)}</strong>
                  </td>
                  <td>⏱ ${b.duration} Phút</td>
                  <td>
                    <small style="color: #64748b;">${esc(b.note || 'Không có ghi chú')}</small>
                  </td>
                  <td>
                    <span class="badge-status ${staffStatusClass(b.status)}">
                      ${{ Pending: 'Chờ xác nhận', Confirmed: 'Đã xác nhận', CheckedIn: 'Đã đến', Completed: 'Hoàn tất', Cancelled: 'Đã hủy', NoShow: 'Vắng mặt' }[b.status] || b.status}
                    </span>
                  </td>
                  <td>
                    ${b.status === 'Confirmed' ? `
                      <button type="button" class="btn-sm btn-success mark-arrived-btn" data-id="${esc(b.id)}">
                        ✓ Khách đã đến
                      </button>
                      ${canStaffMarkNoShow(b) ? `<button type="button" class="btn-sm btn-outline mark-no-show-btn" data-id="${esc(b.id)}" style="color:#dc2626;">Vắng mặt</button>` : ''}
                    ` : b.status === 'CheckedIn' ? `
                      <button type="button" class="btn-sm btn-success mark-complete-btn" data-id="${esc(b.id)}">✓ Hoàn tất</button>
                    ` : `<span style="font-size: 12px; color: #94a3b8;">—</span>`}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  // Sự kiện lọc ngày
  document.getElementById('staffDateFilterInput')?.addEventListener('change', (e) => {
    filterDate = e.target.value;
    renderStaffDashboardPage();
  });
  document.getElementById('staffTodayBtn')?.addEventListener('click', () => {
    filterDate = todayStr();
    renderStaffDashboardPage();
  });
  document.getElementById('staffAllBtn')?.addEventListener('click', () => {
    filterDate = '';
    renderStaffDashboardPage();
  });

  // Sự kiện đánh dấu Hoàn thành ca
  containerListeners(root);
}

function containerListeners(root) {
  root.querySelectorAll('.mark-complete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bid = btn.getAttribute('data-id');
      showConfirmModal({
        title: 'Hoàn Thành Ca Trị Liệu?',
        message: 'Xác nhận khách hàng đã hoàn tất buổi trị liệu và thanh toán tại quầy?',
        confirmText: 'Xác Nhận Hoàn Thành',
        onConfirm: async () => {
          try {
            await bookingService.updateStatus(bid, 'Completed');
            showToast('Đã ghi nhận ca trị liệu hoàn tất thành công!', 'success');
            renderStaffDashboardPage();
          } catch (err) {
            showToast(err.message || 'Lỗi cập nhật trạng thái.', 'danger');
          }
        }
      });
    });
  });
  root.querySelectorAll('.mark-arrived-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await bookingService.updateStatus(btn.getAttribute('data-id'), 'CheckedIn');
        showToast('Đã ghi nhận khách đến spa.', 'success');
        renderStaffDashboardPage();
      } catch (err) { showToast(err.message || 'Lỗi cập nhật trạng thái.', 'danger'); }
    });
  });
  root.querySelectorAll('.mark-no-show-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      showConfirmModal({
        title: 'Ghi Nhận Khách Không Đến?',
        message: 'Chỉ xác nhận khi đã đến giờ hẹn và khách chưa có mặt.',
        confirmText: 'Xác Nhận Vắng Mặt',
        onConfirm: async () => {
          try {
            await bookingService.updateStatus(btn.getAttribute('data-id'), 'NoShow', 'Khách không có mặt sau giờ hẹn.');
            showToast('Đã ghi nhận khách vắng mặt.', 'success');
            renderStaffDashboardPage();
          } catch (err) { showToast(err.message || 'Lỗi cập nhật trạng thái.', 'danger'); }
        }
      });
    });
  });
}

function canStaffMarkNoShow(booking) {
  const now = businessNow();
  return booking.date < now.date || (booking.date === now.date && timeToMin(booking.startTime) <= now.minutes);
}

function staffStatusClass(status) {
  if (status === 'Completed') return 'badge-completed';
  if (status === 'Confirmed' || status === 'CheckedIn') return 'badge-confirmed';
  if (status === 'Pending') return 'badge-pending';
  return 'badge-cancelled';
}
