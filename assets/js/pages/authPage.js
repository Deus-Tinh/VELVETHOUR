/**
 * Trang Đăng Nhập & Đăng Ký Tài Khoản (#/login & #/register).
 * Tính năng:
 * - Hỗ trợ đăng nhập vai trò Customer, Staff, Admin.
 * - Đăng ký tài khoản Customer mới với validation đầy đủ.
 * - Không nhúng tài khoản hoặc mật khẩu mẫu vào giao diện public.
 */
import { authService } from '../services/authService.js';
import { esc } from '../core/utils.js';
import { showToast } from '../ui/components.js';

let authRequestPending = false;
const AUTH_FIELD_IDS = { name: 'authRegName', phone: 'authRegPhone', email: 'authEmail', password: 'authPassword' };

function showAuthErrors(form, error) {
  const fields = { ...(error.fields || {}) };
  if (error.code === 'DUPLICATE_EMAIL') fields.email = error.message;
  if (error.code === 'DUPLICATE_PHONE') fields.phone = error.message;
  if (error.code === 'STAFF_INVITE_PENDING') fields.email = error.message;
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
  if (returnTo === 'booking' && user.role === 'customer') return '#/booking';
  if (user.role === 'admin') return '#/admin';
  if (user.role === 'staff') return '#/staff';
  return '#/my-bookings';
}

export function renderAuthPage(mode = 'login', returnTo = null) {
  const root = document.getElementById('appRoot');
  if (!root) return;

  const authMode = mode === 'register' ? 'register' : 'login';
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
        <div style="display: flex; gap: 12px; justify-content: center;">
          <a href="#/my-bookings" class="btn-primary" style="text-decoration:none;">Lịch Của Tôi</a>
          ${currentUser.role === 'admin' ? `<a href="#/admin" class="btn-primary" style="text-decoration:none;background:#1e293b!important;">Admin Portal</a>` : ''}
          ${currentUser.role === 'staff' ? `<a href="#/staff" class="btn-primary" style="text-decoration:none;background:#059669!important;">Staff Portal</a>` : ''}
          <button type="button" class="btn-outline" id="authLogoutBtn">Đăng Xuất</button>
        </div>
      </div>
    `;
    document.getElementById('authLogoutBtn')?.addEventListener('click', async () => {
      await authService.logout();
      showToast('Đã đăng xuất.', 'normal');
      renderAuthPage('login', authReturnTo);
    });
    return;
  }

  root.innerHTML = `
    <div class="page-banner" style="padding: 35px 20px;">
      <h1 style="font-size: 2.2rem;">${authMode === 'login' ? 'ĐĂNG NHẬP HỆ THỐNG' : 'ĐĂNG KÝ TÀI KHOẢN'}</h1>
      <p>Đăng nhập hoặc tạo tài khoản để quản lý lịch hẹn tại Serenity Spa &amp; Wellness.</p>
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

            <div class="form-group">
              <label for="authEmail">Địa Chỉ Email <span style="color:#ef4444;">*</span></label>
              <input type="email" class="form-control" id="authEmail" placeholder="Ví dụ: ten@gmail.com" autocomplete="email" inputmode="email" aria-describedby="authEmailError" required />
              <span class="form-error-msg" id="authEmailError" data-auth-error="email" style="display:none;"></span>
            </div>

            <div class="form-group">
              <label for="authPassword">Mật Khẩu <span style="color:#ef4444;">*</span></label>
              <input type="password" class="form-control" id="authPassword" placeholder="${authMode === 'register' ? '8+ ký tự, có số và ký tự đặc biệt' : 'Nhập mật khẩu...'}" aria-describedby="${authMode === 'register' ? 'authPasswordHint ' : ''}authPasswordError" ${authMode === 'register' ? 'minlength="8" autocomplete="new-password"' : 'autocomplete="current-password"'} required />
              ${authMode === 'register' ? '<small id="authPasswordHint" style="display:block;margin-top:6px;color:#64748b;">Mật khẩu cần ít nhất 8 ký tự, có ít nhất một số (0–9) và một ký tự đặc biệt (ví dụ: !, @, #).</small>' : ''}
              <span class="form-error-msg" id="authPasswordError" data-auth-error="password" style="display:none;"></span>
            </div>

            <button type="submit" class="btn-primary" id="authSubmitBtn" ${authRequestPending ? 'disabled' : ''} style="width: 100%; padding: 13px; font-size: 15px; margin-top: 10px;">
              ${authMode === 'login' ? 'ĐĂNG NHẬP' : 'TẠO TÀI KHOẢN'}
            </button>
          </form>
        </div>

      </div>
    </div>
  `;

  const form = document.getElementById('authForm');
  for (const [field, id] of Object.entries(AUTH_FIELD_IDS)) {
    const input = form.querySelector(`#${id}`);
    if (!input) continue;
    input.value = draft[field] || '';
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
    const hash = `#/${nextMode}${authReturnTo ? '?returnTo=booking' : ''}`;
    if (window.location.hash === hash) renderAuthPage(nextMode, authReturnTo);
    else window.location.hash = hash;
  };
  document.getElementById('tabLoginBtn')?.addEventListener('click', () => switchMode('login'));
  document.getElementById('tabRegisterBtn')?.addEventListener('click', () => switchMode('register'));

  // Submit form
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (authRequestPending) return;
    const email = form.querySelector('#authEmail')?.value.trim();
    const password = form.querySelector('#authPassword')?.value;
    const submitBtn = form.querySelector('#authSubmitBtn');
    const idleLabel = authMode === 'login' ? 'ĐĂNG NHẬP' : 'TẠO TÀI KHOẢN';
    authRequestPending = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = authMode === 'login' ? 'Đang đăng nhập...' : 'Đang tạo tài khoản...';
    }

    try {
      if (authMode === 'login') {
        const user = await authService.login({ email, password });
        showToast(`Đăng nhập thành công! Chào mừng ${user.name}`, 'success');
        window.location.hash = authDestination(user, authReturnTo);
      } else {
        const name = form.querySelector('#authRegName')?.value.trim();
        const phone = form.querySelector('#authRegPhone')?.value.trim();
        const user = await authService.register({ name, email, phone, password });
        showToast('Đăng ký tài khoản thành công!', 'success');
        window.location.hash = authDestination(user, authReturnTo);
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
          : currentMode === 'register' ? 'TẠO TÀI KHOẢN' : 'ĐĂNG NHẬP';
      }
    }
  });
}
