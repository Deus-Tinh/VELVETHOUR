import { authService } from '../services/authService.js';
import { apiClient } from '../services/apiClient.js';
import { esc } from '../core/utils.js';
import { navigateTo, STAFF_INVITE_TOKEN_KEY } from '../core/spaRouter.js';
import { showToast } from '../ui/components.js';

export async function renderStaffInvitePage(token) {
  const root = document.getElementById('appRoot');
  if (!root) return;
  const route = `${window.location.pathname}${window.location.search}`;
  root.innerHTML = `
    <section class="section-container" style="max-width:620px;padding-top:70px;padding-bottom:90px;">
      <div style="background:#fff;padding:32px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.07);">
        <h1 style="font-family:var(--font-heading);font-size:1.8rem;color:var(--text-dark);margin:0 0 12px;">Kích hoạt tài khoản chuyên viên</h1>
        <p id="staffInviteStatus" role="status" style="color:#64748b;">Đang kiểm tra lời mời…</p>
      </div>
    </section>`;

  if (!token) {
    showInviteError(root, 'Liên kết lời mời thiếu mã xác nhận. Hãy liên hệ quản trị viên để nhận lời mời mới.');
    return;
  }

  try {
    const { invitation } = await apiClient.getStaffInvite(token);
    if (`${window.location.pathname}${window.location.search}` !== route || !root.isConnected) return;
    root.innerHTML = `
      <section class="section-container" style="max-width:620px;padding-top:70px;padding-bottom:90px;">
        <div style="background:#fff;padding:32px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.07);">
          <h1 style="font-family:var(--font-heading);font-size:1.8rem;color:var(--text-dark);margin:0 0 12px;">Kích hoạt tài khoản chuyên viên</h1>
          <p style="color:#64748b;margin:0 0 22px;">Lời mời dành cho <strong>${esc(invitation.name)}</strong> tại <strong>${esc(invitation.email)}</strong>. Đặt số điện thoại và mật khẩu để hoàn tất.</p>
          <form id="staffInviteAcceptForm" novalidate>
            <input type="hidden" id="staffInviteToken" value="${esc(token)}">
            <div class="form-group">
              <label for="staffInvitePhone">Số điện thoại <span style="color:#ef4444;">*</span></label>
              <input type="tel" class="form-control" id="staffInvitePhone" autocomplete="tel" placeholder="Ví dụ: 0987654321" required>
            </div>
            <div class="form-group">
              <label for="staffInvitePassword">Mật khẩu <span style="color:#ef4444;">*</span></label>
              <input type="password" class="form-control" id="staffInvitePassword" autocomplete="new-password" minlength="8" required>
              <small style="display:block;margin-top:6px;color:#64748b;">Ít nhất 8 ký tự, có một chữ số và một ký tự đặc biệt.</small>
            </div>
            <div class="form-group">
              <label for="staffInviteConfirmPassword">Nhập lại mật khẩu <span style="color:#ef4444;">*</span></label>
              <input type="password" class="form-control" id="staffInviteConfirmPassword" autocomplete="new-password" minlength="8" required>
            </div>
            <p id="staffInviteError" role="alert" style="min-height:20px;color:#b91c1c;margin:0 0 12px;"></p>
            <button type="submit" class="btn-primary" id="staffInviteSubmit" style="width:100%;padding:13px;">KÍCH HOẠT TÀI KHOẢN</button>
          </form>
          <p style="font-size:13px;color:#64748b;margin:18px 0 0;">Liên kết có hiệu lực đến ${esc(new Date(invitation.expiresAt).toLocaleString('vi-VN'))} và chỉ dùng được một lần.</p>
        </div>
      </section>`;

    document.getElementById('staffInviteAcceptForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorNode = document.getElementById('staffInviteError');
      const submit = document.getElementById('staffInviteSubmit');
      const phone = document.getElementById('staffInvitePhone')?.value.trim() || '';
      const password = document.getElementById('staffInvitePassword')?.value || '';
      const confirmation = document.getElementById('staffInviteConfirmPassword')?.value || '';
      if (password !== confirmation) {
        if (errorNode) errorNode.textContent = 'Mật khẩu nhập lại chưa khớp.';
        return;
      }
      if (submit) { submit.disabled = true; submit.textContent = 'ĐANG KÍCH HOẠT…'; }
      if (errorNode) errorNode.textContent = '';
      try {
        await authService.acceptStaffInvite({ token, phone, password });
        try { window.sessionStorage.removeItem(STAFF_INVITE_TOKEN_KEY); } catch { /* storage may be unavailable */ }
        showToast('Tài khoản chuyên viên đã được kích hoạt.', 'success');
        navigateTo('/nhan-vien');
      } catch (error) {
        if (errorNode) errorNode.textContent = error.message || 'Không thể kích hoạt lời mời.';
      } finally {
        if (submit?.isConnected) { submit.disabled = false; submit.textContent = 'KÍCH HOẠT TÀI KHOẢN'; }
      }
    });
  } catch (error) {
    if (`${window.location.pathname}${window.location.search}` !== route || !root.isConnected) return;
    showInviteError(root, error.message || 'Lời mời không hợp lệ hoặc đã hết hạn. Hãy liên hệ quản trị viên để nhận lời mời mới.');
  }
}

function showInviteError(root, message) {
  const status = root.querySelector('#staffInviteStatus');
  if (status) status.innerHTML = `${esc(message)}<br><a href="/dang-nhap" style="display:inline-block;margin-top:14px;color:var(--primary-brown);font-weight:600;">Đến trang đăng nhập</a>`;
}
