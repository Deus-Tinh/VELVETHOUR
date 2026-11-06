/**
 * Trang Đăng Nhập, Đăng Ký & Khôi Phục Mật Khẩu (/dang-nhap, /dang-ky, /quen-mat-khau).
 * Tính năng:
 * - Hỗ trợ đăng nhập vai trò Customer, Staff, Admin.
 * - Đăng ký tài khoản Customer mới với validation đầy đủ.
 * - Quên mật khẩu: gửi mã OTP 6 chữ số qua Email (SMTP) và đặt lại mật khẩu mới.
 * - Đổi mật khẩu trực tiếp khi đã đăng nhập.
 */
import { authService } from '../services/authService.js';
import { esc } from '../core/utils.js';
import { navigateTo } from '../core/spaRouter.js';
import { showToast, openChangePasswordModal } from '../ui/components.js';

let authRequestPending = false;
let forgotResetEmail = '';
const AUTH_FIELD_IDS = {
  name: 'authRegName',
  phone: 'authRegPhone',
  email: 'authEmail',
  password: 'authPassword',
  otp: 'authResetOtp',
  newPassword: 'authNewPassword',
  confirmPassword: 'authConfirmPassword',
};

export function resetForgotPasswordFlow() {
  forgotResetEmail = '';
}

function showAuthErrors(form, error) {
  const fields = { ...(error.fields || {}) };
  if (error.code === 'DUPLICATE_EMAIL' || error.code === 'USER_NOT_FOUND') fields.email = error.message;
  if (error.code === 'DUPLICATE_PHONE') fields.phone = error.message;
  if (error.code === 'STAFF_INVITE_PENDING') fields.email = error.message;
  if (error.code === 'OTP_INVALID' || error.code === 'OTP_MAX_ATTEMPTS') fields.otp = error.message;
  let firstInvalid = null;
  for (const [field, inputId] of Object.entries(AUTH_FIELD_IDS)) {
    const input = form.querySelector(`#${inputId}`);
    const feedback = form.querySelector(`[data-auth-error="${field}"]`);
    if (!input || !feedback) continue;
    const message = fields[field] || '';
    input.classList.toggle('is-invalid', !!message);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    feedback.textContent = message;
    feedback.style.display = message ? 'block' : 'none';
    if (message && !firstInvalid) firstInvalid = input;
  }
  const summary = form.querySelector('#authFormError');
  if (summary) {
    summary.textContent = Object.keys(fields).length
      ? 'Vui lòng sửa các thông tin được đánh dấu bên dưới.'
      : error.message || 'Thao tác không thành công. Vui lòng thử lại.';
    summary.style.display = 'block';
  }
  firstInvalid?.focus();
  return Object.values(fields)[0] || error.message || 'Thao tác không thành công. Vui lòng thử lại.';
}

function authDestination(user, returnTo) {
  if (returnTo === 'booking' && user.role === 'customer') return '/dat-lich';
  if (user.role === 'admin') return '/admin';
  if (user.role === 'staff') return '/nhan-vien';
  return '/lich-cua-toi';
}

export function renderAuthPage(mode = 'login', returnTo = null) {
  const root = document.getElementById('appRoot');
  if (!root) return;

  const authMode = mode === 'register' ? 'register' : mode === 'forgot' ? 'forgot' : 'login';
  const authReturnTo = returnTo === 'booking' ? 'booking' : null;
  const previousForm = document.getElementById('authForm');
  const draft = previousForm?.dataset.authMode === authMode
    ? Object.fromEntries(Object.entries(AUTH_FIELD_IDS).map(([field, id]) => [field, previousForm.querySelector(`#${id}`)?.value || '']))
    : {};
  const currentUser = authService.getCurrentUser();

  if (currentUser) {
    root.innerHTML = `
      <div class="section-container" style="text-align: center; padding: 100px 20px;">
        <h2>Bạn đã đăng nhập với vai trò: ${currentUser.role.toUpperCase()}</h2>
        <p style="margin: 15px 0 25px 0; color: var(--text-light);">${esc(currentUser.name)} (${esc(currentUser.email)})</p>
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
          <a href="/lich-cua-toi" class="btn-primary" style="text-decoration:none;">Lịch Của Tôi</a>
          ${currentUser.role === 'admin' ? `<a href="/admin" class="btn-primary" style="text-decoration:none;background:#1e293b!important;">Admin Portal</a>` : ''}
          ${currentUser.role === 'staff' ? `<a href="/nhan-vien" class="btn-primary" style="text-decoration:none;background:#059669!important;">Staff Portal</a>` : ''}
          <button type="button" class="btn-outline" id="authChangePwdBtn">🔑 Đổi Mật Khẩu</button>
          <button type="button" class="btn-outline" id="authLogoutBtn">Đăng Xuất</button>
        </div>
      </div>
    `;
    document.getElementById('authChangePwdBtn')?.addEventListener('click', () => {
      openChangePasswordModal({
        currentUser,
        onChangePassword: (uid, oldPwd, newPwd, confirmPwd) => authService.changePassword(uid, oldPwd, newPwd, confirmPwd),
      });
    });
    document.getElementById('authLogoutBtn')?.addEventListener('click', async () => {
      await authService.logout();
      showToast('Đã đăng xuất.', 'normal');
      renderAuthPage('login', authReturnTo);
    });
    return;
  }

  const isForgotOtpStep = authMode === 'forgot' && Boolean(forgotResetEmail);
  const bannerTitle = authMode === 'register'
    ? 'ĐĂNG KÝ TÀI KHOẢN'
    : authMode === 'forgot'
      ? 'KHÔI PHỤC MẬT KHẨU'
      : 'ĐĂNG NHẬP HỆ THỐNG';
  const bannerSubtitle = authMode === 'forgot'
    ? 'Nhận mã xác thực OTP qua email để đặt lại mật khẩu tài khoản Serenity Spa & Wellness.'
    : 'Đăng nhập hoặc tạo tài khoản để quản lý lịch hẹn tại Serenity Spa & Wellness.';

  const submitIdleLabel = authMode === 'register'
    ? 'TẠO TÀI KHOẢN'
    : authMode === 'forgot'
      ? (isForgotOtpStep ? 'ĐẶT LẠI MẬT KHẨU' : 'GỬI MÃ XÁC THỰC OTP')
      : 'ĐĂNG NHẬP';

  root.innerHTML = `
    <div class="page-banner" style="padding: 35px 20px;">
      <h1 style="font-size: 2.2rem;">${bannerTitle}</h1>
      <p>${bannerSubtitle}</p>
    </div>

    <div class="section-container" style="padding-top: 35px; padding-bottom: 70px;">
      <div style="display: grid; grid-template-columns: minmax(0, 520px); justify-content: center; gap: 40px; max-width: 900px; margin: 0 auto; align-items: start;">
        <!-- Cột Form Chính -->
        <div style="background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
          <div style="display: flex; border-bottom: 2px solid #e2e8f0; margin-bottom: 25px;">
            <button type="button" class="dash-tab-btn ${authMode === 'login' ? 'active' : ''}" id="tabLoginBtn" style="flex:1;">
              Đăng Nhập
            </button>
            <button type="button" class="dash-tab-btn ${authMode === 'register' ? 'active' : ''}" id="tabRegisterBtn" style="flex:1;">
              Đăng Ký
            </button>
            ${authMode === 'forgot' ? `
              <button type="button" class="dash-tab-btn active" id="tabForgotBtn" style="flex:1;">
                Quên Mật Khẩu
              </button>
            ` : ''}
          </div>

          <form id="authForm" data-auth-mode="${authMode}" novalidate>
            <div id="authFormError" role="alert" style="display:none;color:#dc2626;font-size:13px;margin-bottom:16px;"></div>
            ${authMode === 'register' ? `
              <div class="form-group">
                <label for="authRegName">Họ và Tên Khách Hàng <span style="color:#ef4444;">*</span></label>
                <input type="text" class="form-control" id="authRegName" placeholder="Ví dụ: Nguyễn Minh Anh" autocomplete="name" minlength="2" maxlength="60" aria-describedby="authNameError" required />
                <span class="form-error-msg" id="authNameError" data-auth-error="name" style="display:none;"></span>
              </div>
              <div class="form-group">
                <label for="authRegPhone">Số Điện Thoại <span style="color:#ef4444;">*</span></label>
                <input type="tel" class="form-control" id="authRegPhone" placeholder="Ví dụ: 0987654321" autocomplete="tel" inputmode="tel" aria-describedby="authPhoneHint authPhoneError" required />
                <small id="authPhoneHint" style="display:block;margin-top:6px;color:#64748b;">Nhập số Việt Nam gồm 10 số, bắt đầu bằng 03, 05, 07, 08 hoặc 09 (hoặc dùng +84).</small>
                <span class="form-error-msg" id="authPhoneError" data-auth-error="phone" style="display:none;"></span>
              </div>
            ` : ''}

            ${authMode === 'forgot' && isForgotOtpStep ? `
              <div style="background:#faf8f5;border:1px solid #e7ded4;border-radius:8px;padding:12px 14px;margin-bottom:18px;font-size:13px;color:#475569;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                <span>Mã OTP 6 chữ số đã gửi tới <strong>${esc(forgotResetEmail)}</strong> (hiệu lực 10 phút).</span>
                <button type="button" class="btn-outline btn-sm" id="changeForgotEmailBtn" style="padding:4px 10px;font-size:12px;">Đổi Email</button>
              </div>
            ` : ''}

            <div class="form-group" ${isForgotOtpStep ? 'style="display:none;"' : ''}>
              <label for="authEmail">Địa Chỉ Email <span style="color:#ef4444;">*</span></label>
              <input type="email" class="form-control" id="authEmail" placeholder="Ví dụ: ten@gmail.com" autocomplete="email" inputmode="email" aria-describedby="authEmailError" ${isForgotOtpStep ? 'readonly' : ''} required />
              ${authMode === 'forgot' && !isForgotOtpStep ? '<small style="display:block;margin-top:6px;color:#64748b;">Nhập địa chỉ email đã đăng ký tài khoản để nhận mã xác thực OTP gồm 6 chữ số.</small>' : ''}
              <span class="form-error-msg" id="authEmailError" data-auth-error="email" style="display:none;"></span>
            </div>

            ${authMode !== 'forgot' ? `
              <div class="form-group">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <label for="authPassword">Mật Khẩu <span style="color:#ef4444;">*</span></label>
                  ${authMode === 'login' ? `<button type="button" id="forgotPasswordBtn" style="background:none;border:none;padding:0;color:var(--primary-brown);font-size:13px;font-weight:600;cursor:pointer;text-decoration:underline;">Quên mật khẩu?</button>` : ''}
                </div>
                <input type="password" class="form-control" id="authPassword" placeholder="${authMode === 'register' ? '8+ ký tự, có số và ký tự đặc biệt' : 'Nhập mật khẩu...'}" aria-describedby="${authMode === 'register' ? 'authPasswordHint ' : ''}authPasswordError" ${authMode === 'register' ? 'minlength="8" autocomplete="new-password"' : 'autocomplete="current-password"'} required />
                ${authMode === 'register' ? '<small id="authPasswordHint" style="display:block;margin-top:6px;color:#64748b;">Mật khẩu cần ít nhất 8 ký tự, có ít nhất một số (0–9) và một ký tự đặc biệt (ví dụ: !, @, #).</small>' : ''}
                <span class="form-error-msg" id="authPasswordError" data-auth-error="password" style="display:none;"></span>
              </div>
            ` : ''}

            ${isForgotOtpStep ? `
              <div class="form-group">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <label for="authResetOtp">Mã Xác Thực OTP (6 chữ số) <span style="color:#ef4444;">*</span></label>
                  <button type="button" id="resendOtpBtn" style="background:none;border:none;padding:0;color:var(--primary-brown);font-size:12px;font-weight:600;cursor:pointer;text-decoration:underline;">Gửi lại mã OTP</button>
                </div>
                <input type="text" class="form-control" id="authResetOtp" placeholder="Nhập 6 chữ số OTP trong email..." inputmode="numeric" maxlength="6" autocomplete="one-time-code" aria-describedby="authOtpError" required />
                <span class="form-error-msg" id="authOtpError" data-auth-error="otp" style="display:none;"></span>
              </div>

              <div class="form-group">
                <label for="authNewPassword">Mật Khẩu Mới <span style="color:#ef4444;">*</span></label>
                <input type="password" class="form-control" id="authNewPassword" placeholder="8+ ký tự, có số và ký tự đặc biệt" minlength="8" autocomplete="new-password" aria-describedby="authNewPasswordHint authNewPasswordError" required />
                <small id="authNewPasswordHint" style="display:block;margin-top:6px;color:#64748b;">Tối thiểu 8 ký tự, gồm ít nhất 1 chữ số và 1 ký tự đặc biệt.</small>
                <span class="form-error-msg" id="authNewPasswordError" data-auth-error="newPassword" style="display:none;"></span>
              </div>

              <div class="form-group">
                <label for="authConfirmPassword">Xác Nhận Mật Khẩu Mới <span style="color:#ef4444;">*</span></label>
                <input type="password" class="form-control" id="authConfirmPassword" placeholder="Nhập lại mật khẩu mới..." minlength="8" autocomplete="new-password" aria-describedby="authConfirmPasswordError" required />
                <span class="form-error-msg" id="authConfirmPasswordError" data-auth-error="confirmPassword" style="display:none;"></span>
              </div>
            ` : ''}

            <button type="submit" class="btn-primary" id="authSubmitBtn" ${authRequestPending ? 'disabled' : ''} style="width: 100%; padding: 13px; font-size: 15px; margin-top: 10px;">
              ${submitIdleLabel}
            </button>
            ${authMode === 'forgot' ? `
              <div style="text-align:center;margin-top:14px;">
                <button type="button" id="backToLoginBtn" style="background:none;border:none;padding:0;color:var(--primary-brown);font-size:13px;font-weight:600;cursor:pointer;text-decoration:underline;">← Quay lại đăng nhập</button>
              </div>
            ` : ''}
          </form>
        </div>

      </div>
    </div>
  `;

  const form = document.getElementById('authForm');
  for (const [field, id] of Object.entries(AUTH_FIELD_IDS)) {
    const input = form.querySelector(`#${id}`);
    if (!input) continue;
    input.value = field === 'email' && isForgotOtpStep ? forgotResetEmail : (draft[field] || '');
    input.addEventListener('input', () => {
      input.classList.remove('is-invalid');
      input.setAttribute('aria-invalid', 'false');
      const feedback = form.querySelector(`[data-auth-error="${field}"]`);
      if (feedback) feedback.style.display = 'none';
      const summary = form.querySelector('#authFormError');
      if (summary) summary.style.display = 'none';
    });
  }
  const switchMode = (nextMode) => {
    if (authRequestPending) return;
    if (nextMode !== 'forgot') forgotResetEmail = '';
    const path = nextMode === 'register'
      ? '/dang-ky'
      : nextMode === 'forgot'
        ? '/quen-mat-khau'
        : '/dang-nhap';
    const search = authReturnTo ? '?returnTo=booking' : '';
    if (`${window.location.pathname}${window.location.search}` === `${path}${search}`) renderAuthPage(nextMode, authReturnTo);
    else navigateTo(`${path}${search}`);
  };
  document.getElementById('tabLoginBtn')?.addEventListener('click', () => switchMode('login'));
  document.getElementById('tabRegisterBtn')?.addEventListener('click', () => switchMode('register'));
  document.getElementById('tabForgotBtn')?.addEventListener('click', () => switchMode('forgot'));
  document.getElementById('forgotPasswordBtn')?.addEventListener('click', () => switchMode('forgot'));
  document.getElementById('backToLoginBtn')?.addEventListener('click', () => switchMode('login'));

  document.getElementById('changeForgotEmailBtn')?.addEventListener('click', () => {
    if (authRequestPending) return;
    forgotResetEmail = '';
    renderAuthPage('forgot', authReturnTo);
  });

  document.getElementById('resendOtpBtn')?.addEventListener('click', async () => {
    if (authRequestPending || !forgotResetEmail) return;
    authRequestPending = true;
    try {
      const res = await authService.requestPasswordResetOtp({ email: forgotResetEmail });
      showToast(res.message || `Đã gửi lại mã OTP tới ${forgotResetEmail}.`, 'success');
    } catch (err) {
      showToast(showAuthErrors(form, err), 'danger');
    } finally {
      authRequestPending = false;
    }
  });

  // Submit form
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (authRequestPending) return;
    const email = (isForgotOtpStep ? forgotResetEmail : form.querySelector('#authEmail')?.value)?.trim();
    const password = form.querySelector('#authPassword')?.value;
    const submitBtn = form.querySelector('#authSubmitBtn');
    const idleLabel = submitIdleLabel;
    authRequestPending = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = authMode === 'login'
        ? 'Đang đăng nhập...'
        : authMode === 'register'
          ? 'Đang tạo tài khoản...'
          : isForgotOtpStep
            ? 'Đang đặt lại mật khẩu...'
            : 'Đang gửi mã OTP...';
    }

    try {
      if (authMode === 'login') {
        const user = await authService.login({ email, password });
        showToast(`Đăng nhập thành công! Chào mừng ${user.name}`, 'success');
        navigateTo(authDestination(user, authReturnTo));
      } else if (authMode === 'register') {
        const name = form.querySelector('#authRegName')?.value.trim();
        const phone = form.querySelector('#authRegPhone')?.value.trim();
        const user = await authService.register({ name, email, phone, password });
        showToast('Đăng ký tài khoản thành công!', 'success');
        navigateTo(authDestination(user, authReturnTo));
      } else if (!isForgotOtpStep) {
        const result = await authService.requestPasswordResetOtp({ email });
        forgotResetEmail = result.email || email.toLowerCase();
        showToast(result.message || 'Đã gửi mã xác thực OTP qua email.', 'success');
        renderAuthPage('forgot', authReturnTo);
      } else {
        const otp = form.querySelector('#authResetOtp')?.value.trim();
        const newPassword = form.querySelector('#authNewPassword')?.value;
        const confirmPassword = form.querySelector('#authConfirmPassword')?.value;
        const result = await authService.resetPasswordWithOtp({
          email: forgotResetEmail,
          otp,
          newPassword,
          confirmPassword,
        });
        forgotResetEmail = '';
        showToast(result.message || 'Đặt lại mật khẩu thành công! Vui lòng đăng nhập.', 'success');
        switchMode('login');
      }
    } catch (err) {
      showToast(showAuthErrors(form, err), 'danger');
    } finally {
      authRequestPending = false;
      const currentSubmit = document.getElementById('authSubmitBtn');
      if (currentSubmit) {
        currentSubmit.disabled = false;
        const currentMode = document.getElementById('authForm')?.dataset.authMode;
        currentSubmit.textContent = currentMode === authMode
          ? idleLabel
          : currentMode === 'register'
            ? 'TẠO TÀI KHOẢN'
            : currentMode === 'forgot'
              ? (forgotResetEmail ? 'ĐẶT LẠI MẬT KHẨU' : 'GỬI MÃ XÁC THỰC OTP')
              : 'ĐĂNG NHẬP';
      }
    }
  });
}
