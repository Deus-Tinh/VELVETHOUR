/**
 * Trang Hồ Sơ & Thông Tin Tài Khoản (/tai-khoan).
 * Hiển thị thông tin hồ sơ tài khoản và các thao tác liên quan:
 * - Cập nhật thông tin cá nhân (Họ tên, SĐT, Email).
 * - Đổi mật khẩu tài khoản.
 * - Thẻ tổng quan tài khoản (vai trò, trạng thái, thống kê).
 * - Các lối tắt & thao tác tài khoản liên quan (Admin Portal, Staff Portal, Lịch Của Tôi, Đặt Lịch, Đăng Xuất).
 */
import { authService } from '../services/authService.js';
import { bookingService } from '../services/bookingService.js';
import { favoriteService } from '../services/socialAndAnalyticsService.js';
import { esc } from '../core/utils.js';
import { showToast } from '../ui/components.js';
import { navigateTo } from '../core/spaRouter.js';

export function renderAccountProfilePage() {
  const root = document.getElementById('appRoot');
  if (!root) return;

  const currentUser = authService.getCurrentUser();

  if (!currentUser) {
    root.innerHTML = `
      <div class="page-banner" style="padding: 40px 20px;">
        <div class="breadcrumbs"><a href="/" style="color:inherit;text-decoration:none;">Trang Chủ</a> / Tài Khoản</div>
        <h1 style="font-size: 2.2rem;">THÔNG TIN TÀI KHOẢN</h1>
        <p>Vui lòng đăng nhập để xem và quản lý thông tin tài khoản của bạn.</p>
      </div>
      <div class="section-container" style="text-align: center; padding: 70px 20px;">
        <div style="font-size: 48px; margin-bottom: 15px;">🔒</div>
        <h2 style="color: var(--text-dark); margin-bottom: 10px;">Yêu Cầu Đăng Nhập</h2>
        <p style="color: var(--text-light); margin-bottom: 25px;">Quý khách cần đăng nhập để quản lý thông tin cá nhân và bảo mật tài khoản.</p>
        <a href="/dang-nhap" class="btn-primary" style="display: inline-block; text-decoration: none;">🔑 Đăng Nhập / Đăng Ký</a>
      </div>
    `;
    return;
  }

  const bookings = bookingService.byCustomer(currentUser.id, currentUser.phone);
  const completedCount = bookings.filter((b) => b.status === 'Completed').length;
  const favorites = favoriteService.list(currentUser.id);
  const roleBadgeText = currentUser.role === 'admin'
    ? 'Quản Trị Viên'
    : (currentUser.role === 'staff' ? 'Chuyên Viên' : 'Khách Hàng');

  root.innerHTML = `
    <div class="page-banner" style="padding: 40px 20px;">
      <div class="breadcrumbs"><a href="/" style="color:inherit;text-decoration:none;">Trang Chủ</a> / Thông Tin Tài Khoản</div>
      <h1 style="font-size: 2.2rem;">HỒ SƠ TÀI KHOẢN</h1>
      <p>Quản lý thông tin cá nhân, cập nhật mật khẩu và thiết lập tài khoản của bạn.</p>
    </div>

    <div class="section-container" style="padding-top: 35px; padding-bottom: 70px;">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 24px; align-items: start;">
        <!-- Cột Trái: Thông Tin Cá Nhân & Đổi Mật Khẩu -->
        <div style="display: flex; flex-direction: column; gap: 24px;">
          <div style="background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); border: 1px solid #f1f5f9;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
              <div style="width: 36px; height: 36px; border-radius: 8px; background: #fef3c7; color: #b45309; display: flex; align-items: center; justify-content: center; font-size: 18px;">👤</div>
              <div>
                <h3 style="font-family: var(--font-heading); font-size: 1.25rem; color: var(--text-dark); margin: 0;">Thông Tin Cá Nhân</h3>
                <p style="font-size: 12px; color: #64748b; margin: 2px 0 0 0;">Cập nhật họ tên, số điện thoại và email liên lạc của bạn</p>
              </div>
            </div>

            <div class="form-group" style="margin-bottom: 16px;">
              <label for="profNameInput" style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Họ và Tên</label>
              <input type="text" class="form-control" id="profNameInput" value="${esc(currentUser.name)}" placeholder="Nhập họ và tên..." />
            </div>
            <div class="form-group" style="margin-bottom: 16px;">
              <label for="profPhoneInput" style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Số Điện Thoại</label>
              <input type="tel" class="form-control" id="profPhoneInput" value="${esc(currentUser.phone)}" placeholder="09xxxxxxxx" />
            </div>
            <div class="form-group" style="margin-bottom: 20px;">
              <label for="profEmailInput" style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Địa Chỉ Email</label>
              <input type="email" class="form-control" id="profEmailInput" value="${esc(currentUser.email)}" placeholder="email@example.com" />
            </div>
            <button type="button" class="btn-primary" id="saveProfileBtn" style="padding: 11px 24px; font-size: 14px; width: 100%;">
              Lưu Thay Đổi
            </button>
          </div>

          <div style="background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); border: 1px solid #f1f5f9;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <div style="width: 36px; height: 36px; border-radius: 8px; background: #f1f5f9; color: #475569; display: flex; align-items: center; justify-content: center; font-size: 18px;">🔒</div>
              <div>
                <h4 style="font-family: var(--font-heading); font-size: 1.15rem; color: var(--text-dark); margin: 0;">Đổi Mật Khẩu</h4>
                <p style="font-size: 12px; color: #64748b; margin: 2px 0 0 0;">Bảo mật tài khoản với mật khẩu mạnh</p>
              </div>
            </div>
            <div class="form-group" style="margin-bottom: 14px;">
              <label for="currentPasswordInput" style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Mật khẩu hiện tại</label>
              <input type="password" class="form-control" id="currentPasswordInput" autocomplete="current-password" placeholder="Nhập mật khẩu đang dùng..." />
            </div>
            <div class="form-group" style="margin-bottom: 14px;">
              <label for="newPasswordInput" style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Mật khẩu mới</label>
              <input type="password" class="form-control" id="newPasswordInput" autocomplete="new-password" minlength="8" placeholder="Nhập mật khẩu mới..." />
              <small style="display: block; margin-top: 5px; color: #64748b; font-size: 12px;">Ít nhất 8 ký tự, gồm một chữ số và một ký tự đặc biệt.</small>
            </div>
            <div class="form-group" style="margin-bottom: 20px;">
              <label for="confirmNewPasswordInput" style="font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; display: block;">Xác nhận mật khẩu mới</label>
              <input type="password" class="form-control" id="confirmNewPasswordInput" autocomplete="new-password" minlength="8" placeholder="Nhập lại mật khẩu mới..." />
            </div>
            <button type="button" class="btn-outline" id="changePasswordBtn" style="width: 100%; padding: 11px 20px; font-size: 14px;">
              Cập Nhật Mật Khẩu
            </button>
          </div>
        </div>

        <!-- Cột Phải: Thẻ Tổng Quan Tài Khoản & Thao Tác Liên Quan -->
        <div style="display: flex; flex-direction: column; gap: 24px;">
          <!-- Thẻ Tổng Quan Tài Khoản -->
          <div style="background: linear-gradient(135deg, #3d271d 0%, #291a13 100%); color: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 6px 20px rgba(41,26,19,0.15); position: relative; overflow: hidden;">
            <div style="position: absolute; right: -20px; bottom: -20px; font-size: 130px; opacity: 0.06; line-height: 1; user-select: none;">✿</div>
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
              <div style="width: 60px; height: 60px; border-radius: 50%; background: rgba(255,255,255,0.15); border: 2px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: bold; color: #fef3c7;">
                ${currentUser.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style="font-size: 18px; font-weight: bold; letter-spacing: 0.3px;">${esc(currentUser.name)}</div>
                <div style="font-size: 13px; color: rgba(255,255,255,0.7); margin-top: 2px;">${esc(currentUser.email)}</div>
                <span style="display: inline-block; margin-top: 8px; font-size: 11px; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,0.18); color: #fde68a; font-weight: 600; letter-spacing: 0.5px;">
                  ${roleBadgeText}
                </span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; background: rgba(0,0,0,0.2); border-radius: 8px; padding: 14px; text-align: center;">
              <div>
                <div style="font-size: 20px; font-weight: bold; color: #fde68a;">${bookings.length}</div>
                <div style="font-size: 11px; color: rgba(255,255,255,0.75); margin-top: 2px;">Tổng lịch hẹn</div>
              </div>
              <div>
                <div style="font-size: 20px; font-weight: bold; color: #86efac;">${completedCount}</div>
                <div style="font-size: 11px; color: rgba(255,255,255,0.75); margin-top: 2px;">Đã hoàn thành</div>
              </div>
              <div>
                <div style="font-size: 20px; font-weight: bold; color: #f472b6;">${favorites.length}</div>
                <div style="font-size: 11px; color: rgba(255,255,255,0.75); margin-top: 2px;">Yêu thích</div>
              </div>
            </div>
          </div>

          <!-- Khối Tiện Ích & Thao Tác Tài Khoản Liên Quan -->
          <div style="background: #fff; border-radius: 12px; padding: 26px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); border: 1px solid #f1f5f9;">
            <h4 style="font-family: var(--font-heading); font-size: 1.15rem; color: var(--text-dark); margin: 0 0 16px 0;">Thao Tác &amp; Lối Tắt</h4>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              ${currentUser.role === 'admin' ? `
                <a href="/admin" class="btn-outline" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 8px; text-decoration: none; font-size: 13.5px; color: var(--text-dark); background: #f8fafc;">
                  <span>🛡️ Quản Trị Hệ Thống (Admin Portal)</span>
                  <span style="color: #94a3b8;">→</span>
                </a>
              ` : ''}
              ${currentUser.role === 'staff' ? `
                <a href="/nhan-vien" class="btn-outline" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 8px; text-decoration: none; font-size: 13.5px; color: var(--text-dark); background: #f8fafc;">
                  <span>📋 Bảng Phân Công Chuyên Viên (Staff Portal)</span>
                  <span style="color: #94a3b8;">→</span>
                </a>
              ` : ''}
              <a href="/lich-cua-toi" class="btn-outline" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 8px; text-decoration: none; font-size: 13.5px; color: var(--text-dark);">
                <span>📅 Lịch Của Tôi (Lịch hẹn &amp; Yêu thích)</span>
                <span style="color: #94a3b8;">→</span>
              </a>
              <a href="/dat-lich" class="btn-outline" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 8px; text-decoration: none; font-size: 13.5px; color: var(--text-dark);">
                <span>💆 Đặt Lịch Trị Liệu Mới</span>
                <span style="color: #94a3b8;">→</span>
              </a>
              <a href="/dich-vu" class="btn-outline" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 8px; text-decoration: none; font-size: 13.5px; color: var(--text-dark);">
                <span>✨ Khám Phá Bảng Giá &amp; Dịch Vụ</span>
                <span style="color: #94a3b8;">→</span>
              </a>
              <button type="button" class="btn-outline" id="accountLogoutBtn" style="display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 16px; border-radius: 8px; font-size: 13.5px; color: #dc2626; border-color: #fca5a5; background: #fef2f2; cursor: pointer; margin-top: 6px; width: 100%;">
                <span>🚪</span> Đăng Xuất Tài Khoản
              </button>
            </div>
          </div>

          <!-- Cam Kết Dịch Vụ & Hỗ Trợ -->
          <div style="background: #fdfbf7; border: 1px dashed #d6c7b2; border-radius: 12px; padding: 20px 22px; display: flex; gap: 14px; align-items: flex-start;">
            <span style="font-size: 24px; line-height: 1;">🌿</span>
            <div style="font-size: 13px; color: #574838; line-height: 1.6;">
              <strong>Bảo Vệ &amp; Chăm Sóc Khách Hàng Serenity</strong><br />
              Thông tin cá nhân của bạn được bảo mật tuyệt đối. Nếu có bất kỳ thay đổi nào hoặc cần hỗ trợ tài khoản, vui lòng liên hệ hotline hoặc gửi tin nhắn cho Serenity Spa.
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('saveProfileBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('profNameInput')?.value.trim();
    const phone = document.getElementById('profPhoneInput')?.value.trim();
    const email = document.getElementById('profEmailInput')?.value.trim();
    try {
      await authService.updateProfile(currentUser.id, { name, phone, email });
      showToast('Cập nhật thông tin thành công!', 'success');
      renderAccountProfilePage();
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

  document.getElementById('accountLogoutBtn')?.addEventListener('click', async () => {
    try {
      await authService.logout();
      showToast('Đã đăng xuất tài khoản.', 'normal');
      navigateTo('/dang-nhap');
    } catch (err) {
      showToast(err.message || 'Đăng xuất không thành công.', 'danger');
    }
  });
}
