/**
 * Trang Đặt Lịch Chuyên Nghiệp (/dat-lich).
 * Booking flow:
 * - Bước 1: Chọn liệu trình và thời lượng.
 * - Bước 2: Chọn chuyên viên, ngày và giờ trên cùng một lịch.
 * - Bước cuối: Nhập thông tin khách hàng và xác nhận đặt lịch.
 */
import { serviceService } from '../services/serviceService.js';
import { staffService, promotionService } from '../services/staffSettingsPromoService.js';
import { bookingService } from '../services/bookingService.js';
import { apiClient } from '../services/apiClient.js';
import { authService } from '../services/authService.js';
import { getImageById, getServiceImage } from '../imageManifest.js';
import { todayStr, addDays, weekdayLabel, formatVND, esc, formatDate, isValidDateStr, isValidTimeStr, normalizeText } from '../core/utils.js';
import { showToast } from '../ui/components.js';
import { getDisplayPricing, salePriceMarkup } from '../ui/salePrice.js';
import { validate, schemas } from '../core/validators.js';
import { SERVICE_CATALOG_PAGE_SIZE } from '../core/constants.js';
import { getServiceKind } from '../domain/serviceCatalogModel.js';
import { THERAPY_GROUPS, getTherapyGroup, getTherapyGroupId } from '../domain/therapyGroupModel.js';
import { renderPaymentCheckout } from '../ui/paymentCheckout.js';

function createBookingDraft(user = null) {
  return {
    step: 1,
    serviceId: null,
    duration: 60,
    staffId: null,
    date: todayStr(),
    time: null,
    promoCode: '',
    customerName: user?.name || '',
    customerPhone: user?.phone || '',
    customerEmail: user?.email || '',
    note: '',
    submission: null
  };
}

export function filterServicesWithEligibleStaff(services, findSpecialists = (serviceId) => staffService.forService(serviceId)) {
  return services.filter((service) => findSpecialists(service.id).length > 0);
}

let wizard = createBookingDraft();
let wizardContext = null;
let submissionInFlight = false;
let bookingGateMode = 'gate';
let bookingAuthDraft = { name: '', phone: '', email: '', password: '' };
let bookingAuthErrors = {};
let bookingAuthPending = false;
let bookingPaymentReady = false;
let scheduleStaffQuery = '';
let bookingCatalogTab = 'therapy';
let bookingCatalogPages = { therapy: 1, package: 1 };
let bookingCatalogSearch = { therapy: '', package: '' };
let bookingTherapyGroup = 'all';

export function renderBookingPage(preSelectedServiceId = null, preDuration = null, preselectedSlot = null) {
  const root = document.getElementById('appRoot');
  if (!root) return;

  const currentUser = authService.getCurrentUser();
  if (!currentUser || !['customer', 'admin'].includes(currentUser.role)) {
    renderBookingAccessGate(root, currentUser, preSelectedServiceId, preDuration, preselectedSlot);
    return;
  }

  const allServices = serviceService.listActive();
  if (!allServices.length) {
    root.innerHTML = '<section class="section-container"><h2>Chưa có liệu trình để đặt lịch</h2><p>Vui lòng quay lại sau hoặc liên hệ Spa để được tư vấn.</p></section>';
    return;
  }
  const bookableServices = filterServicesWithEligibleStaff(allServices);
  if (!bookableServices.length) {
    root.innerHTML = `
      <section class="section-container staff-empty-state" role="status">
        <h3>Đặt lịch trực tuyến tạm thời chưa khả dụng</h3>
        <p>Hiện chưa có chuyên viên phù hợp để nhận lịch. Vui lòng liên hệ Serenity Spa để được hỗ trợ.</p>
        <div class="booking-access-actions">
          <a class="btn-primary" href="#/contact">LIÊN HỆ SERENITY SPA</a>
          <a class="btn-outline" href="#/services">XEM DỊCH VỤ</a>
        </div>
      </section>
    `;
    return;
  }

  // Refresh dữ liệu cùng trang giữ bản nháp; đổi trang hoặc tài khoản bắt đầu lịch mới.
  const context = JSON.stringify([currentUser.id, preSelectedServiceId, preDuration, preselectedSlot?.date, preselectedSlot?.time, preselectedSlot?.staffId]);
  if (!root.querySelector('#wizardContentArea') || wizardContext !== context) {
    wizard = createBookingDraft(currentUser);
    wizardContext = context;
    scheduleStaffQuery = '';
    bookingCatalogPages = { therapy: 1, package: 1 };
    bookingCatalogSearch = { therapy: '', package: '' };
    bookingTherapyGroup = 'all';
    const firstTherapy = bookableServices.find((service) => getServiceKind(service) === 'therapy') || bookableServices[0];
    wizard.serviceId = bookableServices.some((s) => s.id === preSelectedServiceId) ? preSelectedServiceId : firstTherapy.id;
    const selectedService = serviceService.get(wizard.serviceId);
    bookingCatalogTab = getServiceKind(selectedService);
    const variants = selectedService.variants || [{ duration: selectedService.duration }];
    wizard.duration = variants.some((v) => Number(v.duration) === Number(preDuration))
      ? Number(preDuration) : Number(selectedService.duration);
    wizard.date = isValidDateStr(preselectedSlot?.date) && preselectedSlot.date >= todayStr() ? preselectedSlot.date : todayStr();
    wizard.staffId = typeof preselectedSlot?.staffId === 'string' ? preselectedSlot.staffId : null;
    wizard.time = isValidTimeStr(preselectedSlot?.time) ? preselectedSlot.time : null;
    wizard.step = wizard.time ? 3 : 1;
  }

  if (!bookableServices.some((s) => s.id === wizard.serviceId)) {
    const fallback = bookableServices.find((service) => getServiceKind(service) === 'therapy') || bookableServices[0];
    wizard.serviceId = fallback.id;
    bookingCatalogTab = getServiceKind(fallback);
    wizard.duration = Number(fallback.duration);
    wizard.step = 1;
    wizard.time = null;
    wizard.promoCode = '';
  }
  const currentService = serviceService.get(wizard.serviceId);
  const currentVariants = currentService.variants || [{ duration: currentService.duration }];
  if (!currentVariants.some((v) => Number(v.duration) === Number(wizard.duration))) {
    wizard.duration = Number(currentService.duration);
    wizard.time = null;
    wizard.promoCode = '';
    wizard.step = 1;
  }

  // Chỉ giữ chuyên viên còn phù hợp với dịch vụ; màn hình lịch không tự chọn người đầu tiên.
  const suitableStaff = staffService.forService(currentService.id);
  if (wizard.staffId && !suitableStaff.some((st) => st.id === wizard.staffId)) {
    wizard.staffId = null;
    wizard.time = null;
    if (wizard.step > 2) wizard.step = 2;
  }
  if (wizard.time && wizard.staffId && !bookingService.getAvailableSlots(wizard.date, wizard.staffId, wizard.duration)
    .some((slot) => slot.time === wizard.time && slot.available)) {
    wizard.time = null;
    wizard.step = 2;
  }

  root.innerHTML = `
    <div class="page-banner" style="padding: 35px 20px;">
      <div class="breadcrumbs"><a href="/" style="color:inherit;text-decoration:none;">Trang Chủ</a> / Đặt Lịch Hẹn</div>
      <h1 style="font-size: 2.2rem;">ĐẶT LỊCH TRỊ LIỆU ONLINE</h1>
      <p>Chọn liệu trình, chuyên viên và khung giờ riêng tư để tận hưởng phút giây thư giãn tuyệt đối.</p>
    </div>

    <div class="booking-page-container">
      <!-- Steps Indicator -->
      <div class="booking-steps-bar">
        <div class="step-item-badge ${wizard.step >= 1 ? 'active' : ''} ${wizard.step > 1 ? 'completed' : ''}">
          <div class="step-circle">${wizard.step > 1 ? '✓' : '1'}</div>
          <div class="step-title">1. Liệu Trình &amp; Gói</div>
        </div>
        <div class="step-item-badge ${wizard.step >= 2 && wizard.step < 4 ? 'active' : ''} ${wizard.step >= 4 ? 'completed' : ''}">
          <div class="step-circle">${wizard.step >= 4 ? '✓' : '2'}</div>
          <div class="step-title">2. Chuyên Viên &amp; Giờ</div>
        </div>
        <div class="step-item-badge ${wizard.step >= 4 ? 'active' : ''}">
          <div class="step-circle">3</div>
          <div class="step-title">3. Thông Tin &amp; Xác Nhận</div>
        </div>
      </div>

      <!-- Wizard Main Content Card -->
      <div class="wizard-card" id="wizardContentArea">
        <!-- Render động theo bước -->
      </div>
    </div>
  `;

  renderCurrentWizardStep();
}

function renderBookingAccessGate(root, currentUser, preSelectedServiceId, preDuration, preselectedSlot = null) {
  const isStaff = currentUser?.role === 'staff';
  root.innerHTML = `
    <div class="page-banner" style="padding:35px 20px;">
      <div class="breadcrumbs"><a href="/" style="color:inherit;text-decoration:none;">Trang Chủ</a> / Đặt Lịch Hẹn</div>
      <h1 style="font-size:2.2rem;">ĐẶT LỊCH TRỊ LIỆU ONLINE</h1>
    </div>
    <section class="booking-access-section">
      <div class="booking-access-card">
        ${isStaff ? `
          <div class="booking-access-icon">👤</div>
          <h2>Tài khoản nhân viên không đặt lịch khách</h2>
          <p>Hãy đăng xuất rồi đăng nhập bằng tài khoản khách hàng để đặt lịch trị liệu.</p>
          <button type="button" class="btn-primary" id="bookingLogoutBtn">ĐĂNG XUẤT</button>
        ` : bookingGateMode === 'gate' ? `
          <div class="booking-access-icon">🔐</div>
          <h2>Đăng nhập để đặt lịch</h2>
          <p>Bạn cần đăng nhập hoặc tạo tài khoản khách hàng trước khi đặt lịch Spa.</p>
          <div class="booking-access-actions">
            <button type="button" class="btn-primary" id="bookingShowLoginBtn">ĐĂNG NHẬP</button>
            <button type="button" class="btn-outline" id="bookingShowRegisterBtn">TẠO TÀI KHOẢN</button>
          </div>
        ` : renderBookingInlineAuthForm()}
      </div>
    </section>`;

  document.getElementById('bookingShowLoginBtn')?.addEventListener('click', () => {
    bookingGateMode = 'login';
    bookingAuthErrors = {};
    renderBookingAccessGate(root, currentUser, preSelectedServiceId, preDuration, preselectedSlot);
    document.getElementById('bookingAuthEmail')?.focus();
  });
  document.getElementById('bookingShowRegisterBtn')?.addEventListener('click', () => {
    bookingGateMode = 'register';
    bookingAuthErrors = {};
    renderBookingAccessGate(root, currentUser, preSelectedServiceId, preDuration, preselectedSlot);
    document.getElementById('bookingAuthName')?.focus();
  });
  document.getElementById('bookingAuthBackBtn')?.addEventListener('click', () => {
    bookingGateMode = 'gate';
    bookingAuthDraft.password = '';
    bookingAuthErrors = {};
    renderBookingAccessGate(root, currentUser, preSelectedServiceId, preDuration, preselectedSlot);
  });
  const changeAuthMode = (mode) => {
    if (bookingAuthPending) return;
    bookingGateMode = mode;
    bookingAuthErrors = {};
    renderBookingAccessGate(root, currentUser, preSelectedServiceId, preDuration, preselectedSlot);
  };
  document.getElementById('bookingAuthLoginTab')?.addEventListener('click', () => changeAuthMode('login'));
  document.getElementById('bookingAuthRegisterTab')?.addEventListener('click', () => changeAuthMode('register'));

  const authForm = document.getElementById('bookingInlineAuthForm');
  if (authForm) {
    const authFields = bookingGateMode === 'register'
      ? { name: 'bookingAuthName', phone: 'bookingAuthPhone', email: 'bookingAuthEmail', password: 'bookingAuthPassword' }
      : { email: 'bookingAuthEmail', password: 'bookingAuthPassword' };
    for (const [field, inputId] of Object.entries(authFields)) {
      const input = authForm.querySelector(`#${inputId}`);
      if (!input) continue;
      input.value = bookingAuthDraft[field] || '';
      if (bookingAuthErrors[field]) {
        input.classList.add('is-invalid');
        input.setAttribute('aria-invalid', 'true');
      }
      input.addEventListener('input', () => {
        bookingAuthDraft[field] = input.value;
        delete bookingAuthErrors[field];
        input.classList.remove('is-invalid');
        input.setAttribute('aria-invalid', 'false');
        const error = authForm.querySelector(`[data-booking-auth-error="${field}"]`);
        if (error) error.textContent = '';
        const summary = authForm.querySelector('#bookingAuthSummary');
        if (summary) summary.textContent = '';
      });
    }

    authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (bookingAuthPending) return;
      const mode = bookingGateMode;
      const schema = mode === 'register' ? schemas.register : schemas.login;
      const email = authForm.querySelector('#bookingAuthEmail')?.value || '';
      const password = authForm.querySelector('#bookingAuthPassword')?.value || '';
      const values = mode === 'register'
        ? {
          name: authForm.querySelector('#bookingAuthName')?.value || '',
          phone: authForm.querySelector('#bookingAuthPhone')?.value || '',
          email,
          password
        }
        : { email, password };
      Object.assign(bookingAuthDraft, values);
      const validation = validate(values, schema);
      bookingAuthErrors = validation.errors;
      if (!validation.valid) {
        renderBookingAccessGate(root, currentUser, preSelectedServiceId, preDuration, preselectedSlot);
        document.querySelector('#bookingInlineAuthForm .is-invalid')?.focus();
        return;
      }

      bookingAuthPending = true;
      const submit = authForm.querySelector('#bookingAuthSubmitBtn');
      if (submit) {
        submit.disabled = true;
        submit.textContent = mode === 'register' ? 'ĐANG TẠO TÀI KHOẢN...' : 'ĐANG ĐĂNG NHẬP...';
      }
      let authenticatedUser = null;
      try {
        authenticatedUser = mode === 'register'
          ? await authService.register(values)
          : await authService.login(values);
      } catch (error) {
        bookingAuthErrors = { ...(error.fields || {}) };
        if (error.code === 'DUPLICATE_EMAIL') bookingAuthErrors.email = error.message;
        if (error.code === 'DUPLICATE_PHONE') bookingAuthErrors.phone = error.message;
        if (error.code === 'STAFF_INVITE_PENDING') bookingAuthErrors.email = error.message;
        if (!Object.keys(bookingAuthErrors).length) bookingAuthErrors.summary = error.message || 'Không thể đăng nhập. Vui lòng thử lại.';
      } finally {
        bookingAuthPending = false;
      }

      if (authenticatedUser) {
        bookingAuthDraft = { name: '', phone: '', email: '', password: '' };
        bookingAuthErrors = {};
        bookingGateMode = 'gate';
        showToast(mode === 'register' ? 'Đăng ký tài khoản thành công!' : `Đăng nhập thành công! Chào mừng ${authenticatedUser.name}`, 'success');
        renderBookingPage(preSelectedServiceId, preDuration, preselectedSlot);
      } else {
        renderBookingAccessGate(root, currentUser, preSelectedServiceId, preDuration, preselectedSlot);
        document.querySelector('#bookingInlineAuthForm .is-invalid')?.focus();
      }
    });
  }

  document.getElementById('bookingLogoutBtn')?.addEventListener('click', async () => {
    await authService.logout();
    bookingGateMode = 'gate';
    bookingAuthDraft.password = '';
    bookingAuthErrors = {};
    showToast('Đã đăng xuất. Hãy đăng nhập bằng tài khoản khách hàng để đặt lịch.', 'normal');
    renderBookingPage(preSelectedServiceId, preDuration, preselectedSlot);
  });
}

function renderBookingInlineAuthForm() {
  const isRegister = bookingGateMode === 'register';
  const fieldClass = (field) => `form-control${bookingAuthErrors[field] ? ' is-invalid' : ''}`;
  const fieldAriaInvalid = (field) => bookingAuthErrors[field] ? 'true' : 'false';
  const fieldError = (field) => `<span class="form-error-msg" id="bookingAuth${field[0].toUpperCase()}${field.slice(1)}Error" data-booking-auth-error="${field}">${esc(bookingAuthErrors[field] || '')}</span>`;
  return `
    <button type="button" class="booking-auth-back" id="bookingAuthBackBtn" ${bookingAuthPending ? 'disabled' : ''}>← Quay lại</button>
    <div class="booking-access-icon">🔐</div>
    <h2>${isRegister ? 'Tạo tài khoản khách hàng' : 'Đăng nhập để đặt lịch'}</h2>
    <p>${isRegister ? 'Tạo tài khoản ngay tại đây, sau đó tiếp tục chọn liệu trình.' : 'Đăng nhập ngay tại đây để tiếp tục đặt lịch.'}</p>
    <div class="booking-auth-tabs" role="tablist" aria-label="Đăng nhập hoặc đăng ký">
      <button type="button" role="tab" aria-selected="${!isRegister}" class="dash-tab-btn ${!isRegister ? 'active' : ''}" id="bookingAuthLoginTab" ${bookingAuthPending ? 'disabled' : ''}>Đăng nhập</button>
      <button type="button" role="tab" aria-selected="${isRegister}" class="dash-tab-btn ${isRegister ? 'active' : ''}" id="bookingAuthRegisterTab" ${bookingAuthPending ? 'disabled' : ''}>Đăng ký</button>
    </div>
    <form id="bookingInlineAuthForm" class="booking-inline-auth-form" novalidate>
      <div id="bookingAuthSummary" role="alert" class="booking-auth-summary">${esc(bookingAuthErrors.summary || '')}</div>
      ${isRegister ? `
        <div class="form-group">
          <label for="bookingAuthName">Họ và tên <span aria-hidden="true">*</span></label>
          <input id="bookingAuthName" class="${fieldClass('name')}" type="text" autocomplete="name" minlength="2" maxlength="60" required aria-invalid="${fieldAriaInvalid('name')}" aria-describedby="bookingAuthNameError" ${bookingAuthPending ? 'disabled' : ''} />
          ${fieldError('name')}
        </div>
        <div class="form-group">
          <label for="bookingAuthPhone">Số điện thoại <span aria-hidden="true">*</span></label>
          <input id="bookingAuthPhone" class="${fieldClass('phone')}" type="tel" autocomplete="tel" inputmode="tel" required aria-invalid="${fieldAriaInvalid('phone')}" aria-describedby="bookingAuthPhoneError" ${bookingAuthPending ? 'disabled' : ''} />
          ${fieldError('phone')}
        </div>
      ` : ''}
      <div class="form-group">
        <label for="bookingAuthEmail">Email <span aria-hidden="true">*</span></label>
        <input id="bookingAuthEmail" class="${fieldClass('email')}" type="email" autocomplete="email" inputmode="email" required aria-invalid="${fieldAriaInvalid('email')}" aria-describedby="bookingAuthEmailError" ${bookingAuthPending ? 'disabled' : ''} />
        ${fieldError('email')}
      </div>
      <div class="form-group">
        <label for="bookingAuthPassword">Mật khẩu <span aria-hidden="true">*</span></label>
        <input id="bookingAuthPassword" class="${fieldClass('password')}" type="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" ${isRegister ? 'minlength="8"' : ''} required aria-invalid="${fieldAriaInvalid('password')}" aria-describedby="bookingAuthPasswordError" ${bookingAuthPending ? 'disabled' : ''} />
        ${isRegister ? '<small class="booking-auth-hint">Mật khẩu tối thiểu 8 ký tự, gồm ít nhất một số và một ký tự đặc biệt.</small>' : ''}
        ${fieldError('password')}
      </div>
      <button type="submit" class="btn-primary booking-auth-submit" id="bookingAuthSubmitBtn" ${bookingAuthPending ? 'disabled' : ''}>
        ${bookingAuthPending ? (isRegister ? 'ĐANG TẠO TÀI KHOẢN...' : 'ĐANG ĐĂNG NHẬP...') : (isRegister ? 'TẠO TÀI KHOẢN' : 'ĐĂNG NHẬP')}
      </button>
    </form>
  `;
}

function renderCurrentWizardStep() {
  const container = document.getElementById('wizardContentArea');
  if (!container) return;
  if (wizard.step === 4 && !submissionInFlight
      && !bookingService.getAvailableSlots(wizard.date, wizard.staffId, wizard.duration).some((slot) => slot.time === wizard.time && slot.available)) {
    wizard.staffId = null;
    wizard.time = null;
    wizard.step = 3;
    showToast('Khung giờ đã thay đổi. Vui lòng chọn lại giờ còn trống.', 'danger');
  }

  const visibleStep = wizard.step === 1 ? 1 : wizard.step >= 4 ? 3 : 2;
  document.querySelectorAll('.booking-steps-bar .step-item-badge').forEach((badge, index) => {
    const step = index + 1;
    badge.classList.toggle('active', step === visibleStep);
    badge.classList.toggle('completed', step < visibleStep);
    if (step === visibleStep) badge.setAttribute('aria-current', 'step');
    else badge.removeAttribute('aria-current');
    badge.querySelector('.step-circle').textContent = step < visibleStep ? '✓' : String(step);
  });

  if (wizard.step === 1) renderStep1(container);
  else if (wizard.step === 2 || wizard.step === 3) renderScheduleStep(container);
  else if (wizard.step === 4) renderStep4(container);
}

/* ---------------- BƯỚC 1: CHỌN DỊCH VỤ & THỜI LƯỢNG ---------------- */
function renderStep1(container) {
  const activeServices = serviceService.listActive();
  const bookableServices = filterServicesWithEligibleStaff(activeServices);
  const bookableServiceIds = new Set(bookableServices.map((service) => service.id));
  const unavailableServiceCount = activeServices.length - bookableServices.length;
  const therapies = activeServices.filter((service) => getServiceKind(service) === 'therapy');
  const packages = activeServices.filter((service) => getServiceKind(service) === 'package');
  const therapyGroupCounts = new Map(THERAPY_GROUPS.map((group) => [group.id,
    therapies.filter((service) => getTherapyGroupId(service) === group.id).length,
  ]));
  const visibleServices = bookingCatalogTab === 'therapy'
    ? (bookingTherapyGroup === 'all' ? therapies : therapies.filter((service) => getTherapyGroupId(service) === bookingTherapyGroup))
    : packages;
  let currentService = visibleServices.find((service) => service.id === wizard.serviceId && bookableServiceIds.has(service.id));
  if (!currentService) {
    currentService = visibleServices.find((service) => bookableServiceIds.has(service.id)) || null;
  }
  if (currentService && currentService.id !== wizard.serviceId) {
    wizard.serviceId = currentService.id;
    wizard.duration = Number(currentService.duration);
    wizard.staffId = null;
    wizard.time = null;
    wizard.promoCode = '';
  } else if (!currentService) {
    wizard.serviceId = null;
    wizard.staffId = null;
    wizard.time = null;
    wizard.promoCode = '';
  }

  container.innerHTML = `
    <h3 style="font-family: var(--font-heading); font-size: 1.4rem; color: var(--text-dark); margin-bottom: 8px;">
      Bước 1: Chọn Liệu Trình hoặc Gói Trị Liệu
    </h3>
    <p style="color: var(--text-light); font-size: 14px; margin-bottom: 20px;">
      Chọn một liệu trình riêng lẻ hoặc một gói combo. Gói được đặt thành một lịch liên tục với một chuyên viên.
    </p>
    ${unavailableServiceCount ? `
      <p class="booking-catalog-availability-note" role="status">
        ${unavailableServiceCount} liệu trình hoặc gói hiện chưa có chuyên viên phù hợp để đặt online.
        <a href="#/contact">Liên hệ Serenity Spa</a> để được hỗ trợ.
      </p>
    ` : ''}

    <div class="booking-catalog-tabs" role="tablist" aria-label="Loại hình trị liệu">
      <button type="button" class="booking-catalog-tab ${bookingCatalogTab === 'therapy' ? 'active' : ''}" role="tab" aria-selected="${bookingCatalogTab === 'therapy'}" data-catalog-kind="therapy">
        Liệu trình <span>${therapies.length}</span>
      </button>
      <button type="button" class="booking-catalog-tab ${bookingCatalogTab === 'package' ? 'active' : ''}" role="tab" aria-selected="${bookingCatalogTab === 'package'}" data-catalog-kind="package">
        Gói trị liệu <span>${packages.length}</span>
      </button>
    </div>
    ${bookingCatalogTab === 'therapy' ? `
      <div class="booking-therapy-groups" role="group" aria-label="Phân loại liệu trình">
        <button type="button" class="booking-therapy-group ${bookingTherapyGroup === 'all' ? 'active' : ''}" data-therapy-group="all" aria-pressed="${bookingTherapyGroup === 'all'}">
          Tất cả liệu trình <span>${therapies.length}</span>
        </button>
        ${THERAPY_GROUPS.map((group) => `
          <button type="button" class="booking-therapy-group ${bookingTherapyGroup === group.id ? 'active' : ''}" data-therapy-group="${esc(group.id)}" aria-pressed="${bookingTherapyGroup === group.id}">
            ${esc(group.name)} <span>${therapyGroupCounts.get(group.id) || 0}</span>
          </button>
        `).join('')}
      </div>
    ` : ''}
    <div class="booking-catalog-toolbar">
      <label class="booking-catalog-search-label" for="bookingCatalogSearch">Tìm trong ${bookingCatalogTab === 'package' ? 'gói trị liệu' : 'liệu trình'}</label>
      <input type="search" id="bookingCatalogSearch" class="form-control" maxlength="120" placeholder="Nhập tên để tìm kiếm..." value="${esc(bookingCatalogSearch[bookingCatalogTab])}" />
    </div>
    <div id="bookingCatalogCount" class="booking-catalog-count" aria-live="polite"></div>
    <div id="serviceSelectGrid" class="service-select-grid"></div>
    <div id="bookingCatalogPagination" class="pagination-wrap booking-catalog-pagination"></div>

    <!-- Chọn Biến thể thời lượng -->
    <div id="bookingSelectedServiceOptions" style="margin-top: 25px; padding-top: 20px; border-top: 1px solid #e2e8f0;" ${currentService ? '' : 'hidden'}>
      <label style="display: block; font-size: 13px; font-weight: 600; text-transform: uppercase; color: #64748b; margin-bottom: 10px;">
        ${currentService ? `Chọn ${bookingCatalogTab === 'package' ? 'mức thời lượng của gói' : 'thời lượng'} cho "${esc(currentService.name)}"` : ''}:
      </label>
      <div class="variant-btn-group">
        ${(currentService?.variants || (currentService ? [{ duration: currentService.duration, price: currentService.price }] : [])).map((v) => `
          <button type="button" class="variant-btn ${v.duration === wizard.duration ? 'selected' : ''}" data-duration="${v.duration}">
            ⏱ ${v.duration} Phút • ${formatVND(v.price)}
          </button>
        `).join('')}
      </div>
      ${bookingCatalogTab === 'package' && currentService ? `
        <div class="booking-package-components">
          <strong>Gói bao gồm</strong>
          <ul>${serviceService.componentServices(currentService).map((component) => `<li>${esc(component.name)}</li>`).join('')}</ul>
        </div>
      ` : ''}
    </div>

    <div style="display: flex; justify-content: flex-end; margin-top: 30px;">
      <button type="button" class="btn-primary" id="step1NextBtn" style="padding: 12px 30px; font-size: 14px;" ${currentService ? '' : 'disabled'}>
        Tiếp Tục Chọn Chuyên Viên &amp; Giờ →
      </button>
    </div>
  `;

  renderBookingCatalogResults(container, visibleServices, activeServices, bookableServiceIds);

  container.querySelectorAll('[data-catalog-kind]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextKind = button.getAttribute('data-catalog-kind');
      if (nextKind === bookingCatalogTab) return;
      bookingCatalogTab = nextKind;
      bookingCatalogPages[nextKind] = 1;
      const nextServices = nextKind === 'therapy'
        ? (bookingTherapyGroup === 'all' ? therapies : therapies.filter((service) => getTherapyGroupId(service) === bookingTherapyGroup))
        : packages;
      const nextService = nextServices.find((service) => bookableServiceIds.has(service.id));
      if (nextService) {
        wizard.serviceId = nextService.id;
        wizard.duration = Number(nextService.duration);
        wizard.staffId = null;
        wizard.time = null;
        wizard.promoCode = '';
        scheduleStaffQuery = '';
      } else {
        wizard.serviceId = null;
        wizard.staffId = null;
        wizard.time = null;
        wizard.promoCode = '';
      }
      renderStep1(container);
    });
  });

  container.querySelectorAll('[data-therapy-group]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextGroup = button.getAttribute('data-therapy-group');
      if (nextGroup === bookingTherapyGroup) return;
      bookingTherapyGroup = nextGroup;
      bookingCatalogPages.therapy = 1;
      const nextServices = nextGroup === 'all' ? therapies
        : therapies.filter((service) => getTherapyGroupId(service) === nextGroup);
      const nextBookableServices = nextServices.filter((service) => bookableServiceIds.has(service.id));
      if (nextBookableServices.length && !nextBookableServices.some((service) => service.id === wizard.serviceId)) {
        wizard.serviceId = nextBookableServices[0].id;
        wizard.duration = Number(nextBookableServices[0].duration);
        wizard.staffId = null;
        wizard.time = null;
        wizard.promoCode = '';
      } else if (!nextBookableServices.length) {
        wizard.serviceId = null;
        wizard.staffId = null;
        wizard.time = null;
        wizard.promoCode = '';
      }
      renderStep1(container);
    });
  });

  container.querySelector('#bookingCatalogSearch')?.addEventListener('input', (event) => {
    bookingCatalogSearch[bookingCatalogTab] = event.currentTarget.value.slice(0, 120);
    bookingCatalogPages[bookingCatalogTab] = 1;
    renderBookingCatalogResults(container, visibleServices, activeServices, bookableServiceIds);
  });

  container.querySelectorAll('.variant-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      wizard.duration = Number(btn.getAttribute('data-duration'));
      wizard.staffId = null;
      wizard.time = null;
      wizard.promoCode = '';
      container.querySelectorAll('.variant-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  document.getElementById('step1NextBtn')?.addEventListener('click', () => {
    if (!currentService) return;
    wizard.step = 2;
    renderCurrentWizardStep();
  });
}

function renderBookingCatalogResults(container, services, catalog = null, bookableServiceIds = null) {
  const grid = container.querySelector('#serviceSelectGrid');
  const count = container.querySelector('#bookingCatalogCount');
  const pagination = container.querySelector('#bookingCatalogPagination');
  if (!grid || !pagination) return;

  const query = normalizeText(bookingCatalogSearch[bookingCatalogTab] || '');
  const serviceCatalog = catalog instanceof Map ? catalog : new Map((catalog || serviceService.list()).map((service) => [service.id, service]));
  const filtered = services.filter((service) => {
    const componentNames = serviceService.componentServices(service, serviceCatalog).map((component) => component.name).join(' ');
    return !query || normalizeText(`${service.name} ${service.shortDesc || ''} ${componentNames}`).includes(query);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / SERVICE_CATALOG_PAGE_SIZE));
  bookingCatalogPages[bookingCatalogTab] = Math.min(Math.max(1, bookingCatalogPages[bookingCatalogTab] || 1), totalPages);
  const page = bookingCatalogPages[bookingCatalogTab];
  const start = (page - 1) * SERVICE_CATALOG_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + SERVICE_CATALOG_PAGE_SIZE);

  if (count) count.textContent = filtered.length
    ? `${filtered.length} ${bookingCatalogTab === 'package' ? 'gói trị liệu' : 'liệu trình'} · Trang ${page}/${totalPages}`
    : `Không tìm thấy ${bookingCatalogTab === 'package' ? 'gói trị liệu' : 'liệu trình'} phù hợp.`;
  grid.innerHTML = pageItems.map((service) => {
    const img = getServiceImage(service);
    const isSelected = service.id === wizard.serviceId;
    const isBookable = bookableServiceIds?.has(service.id) ?? staffService.forService(service.id).length > 0;
    const packageCount = serviceService.componentServices(service, serviceCatalog).length;
    return `
      <button type="button" class="service-select-item ${isSelected ? 'selected' : ''}" data-svc-id="${esc(service.id)}" aria-pressed="${isSelected}" ${isBookable ? '' : 'disabled aria-disabled="true"'}>
        <img src="${esc(img.url)}" alt="" class="service-thumb-sm" loading="lazy" />
        <span class="booking-service-item-copy">
          <span class="booking-service-item-name">${esc(service.name)}</span>
          <span class="booking-service-item-meta">⏱ ${service.duration} Phút · ${salePriceMarkup(getDisplayPricing(service, service.duration, wizard.date))}</span>
          ${bookingCatalogTab === 'package' ? `<span class="booking-service-item-includes">${packageCount} liệu trình thành phần</span>` : ''}
          ${isBookable ? '' : '<span class="booking-service-item-includes">Chưa có chuyên viên phù hợp</span>'}
        </span>
        <span class="booking-service-radio" aria-hidden="true">${isSelected ? '●' : '○'}</span>
      </button>
    `;
  }).join('') || (() => {
    const emptyGroup = bookingCatalogTab === 'therapy' && services.length === 0 ? getTherapyGroup(bookingTherapyGroup) : null;
    if (emptyGroup) {
      return `<div class="booking-catalog-empty booking-catalog-demo-empty">
        <strong>Nhóm “${esc(emptyGroup.name)}” chưa có liệu trình đang hoạt động.</strong>
        <p>Đây là nhóm trong bản demo phân loại. Các gợi ý bên dưới chưa phải dịch vụ có thể đặt lịch.</p>
        <span>${emptyGroup.examples.map(esc).join(' · ')}</span>
      </div>`;
    }
    return `<div class="booking-catalog-empty">${services.length ? 'Không tìm thấy kết quả. Hãy thử từ khóa khác.' : `Chưa có ${bookingCatalogTab === 'package' ? 'gói trị liệu' : 'liệu trình'} đang hoạt động.`}</div>`;
  })();

  pagination.innerHTML = totalPages > 1 ? `
    <button type="button" class="page-btn" data-catalog-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Trang trước</button>
    <span class="booking-catalog-page-label">Trang ${page} / ${totalPages}</span>
    <button type="button" class="page-btn" data-catalog-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Trang sau →</button>
  ` : '';

  grid.querySelectorAll('[data-svc-id]').forEach((item) => {
    item.addEventListener('click', () => {
      const selected = serviceService.get(item.getAttribute('data-svc-id'));
      if (!selected || !bookableServiceIds?.has(selected.id) || getServiceKind(selected) !== bookingCatalogTab) return;
      wizard.serviceId = selected.id;
      wizard.duration = Number(selected.duration);
      wizard.staffId = null;
      wizard.time = null;
      wizard.promoCode = '';
      scheduleStaffQuery = '';
      renderStep1(container);
    });
  });

  pagination.querySelectorAll('[data-catalog-page]').forEach((button) => {
    button.addEventListener('click', () => {
      bookingCatalogPages[bookingCatalogTab] = Number(button.getAttribute('data-catalog-page'));
      renderBookingCatalogResults(container, services, serviceCatalog, bookableServiceIds);
    });
  });
}

/* ---------------- BƯỚC 2: CHỌN CHUYÊN VIÊN, NGÀY & GIỜ ---------------- */
function renderScheduleStep(container) {
  const currentService = serviceService.get(wizard.serviceId);
  const staffList = staffService.forService(wizard.serviceId);

  if (!staffList.length) {
    container.innerHTML = `
      <div class="staff-empty-state" role="status">
        <h3>Chưa có chuyên viên cho ${esc(currentService?.name || 'liệu trình này')}</h3>
        <p>Hãy kiểm tra danh sách chuyên viên có chuyên môn phù hợp với liệu trình này.</p>
        <button type="button" class="btn-outline" id="scheduleBackBtn">← Quay lại chọn liệu trình</button>
      </div>
    `;
    document.getElementById('scheduleBackBtn')?.addEventListener('click', () => {
      wizard.step = 1;
      renderCurrentWizardStep();
    });
    return;
  }

  if (wizard.staffId && !staffList.some((staff) => staff.id === wizard.staffId)) {
    wizard.staffId = null;
    wizard.time = null;
  }

  const days = [];
  for (let i = 0; i < 14; i++) {
    const date = addDays(todayStr(), i);
    days.push({
      date,
      dayLabel: i === 0 ? 'Hôm nay' : weekdayLabel(date),
      dayNum: `${date.split('-')[2]}/${date.split('-')[1]}`
    });
  }
  if (!wizard.date || wizard.date < todayStr()) wizard.date = todayStr();

  const availabilityByStaff = new Map(staffList.map((staff) => [
    staff.id,
    new Map(bookingService.getAvailableSlots(wizard.date, staff.id, wizard.duration).map((slot) => [slot.time, slot]))
  ]));
  const searchTerm = scheduleStaffQuery.trim().toLocaleLowerCase('vi');
  const visibleStaff = staffList.filter((staff) =>
    `${staff.name} ${staff.title || ''}`.toLocaleLowerCase('vi').includes(searchTerm)
  );
  const visibleTimes = [...new Set(visibleStaff.flatMap((staff) => [...availabilityByStaff.get(staff.id).keys()]))].sort();

  if (wizard.staffId && wizard.time && !availabilityByStaff.get(wizard.staffId)?.get(wizard.time)?.available) {
    wizard.staffId = null;
    wizard.time = null;
  }

  const selectedStaff = staffList.find((staff) => staff.id === wizard.staffId);
  const selectedSlot = selectedStaff ? availabilityByStaff.get(selectedStaff.id)?.get(wizard.time) : null;
  const dateLabel = `${wizard.date.split('-')[2]}/${wizard.date.split('-')[1]}/${wizard.date.split('-')[0]}`;
  const staffPhoto = (staff) => staff.imageUrl || getImageById(staff.imageId || 'staff-01').url;

  container.innerHTML = `
    <div class="schedule-heading-row">
      <div>
        <span class="schedule-eyebrow">Bước 2 · Lịch hẹn</span>
        <h3>Chọn chuyên viên và giờ phù hợp</h3>
        <p>Đang xem lịch cho <strong>${esc(currentService.name)}</strong>, thời lượng ${wizard.duration} phút. Chọn một ô để chọn cả chuyên viên và giờ hẹn.</p>
      </div>
      <div class="schedule-service-chip"><span aria-hidden="true">◷</span> ${wizard.duration} phút</div>
    </div>

    <section class="schedule-date-section" aria-labelledby="scheduleDateLabel">
      <div class="schedule-section-heading">
        <div><span class="schedule-section-index">01</span><label id="scheduleDateLabel">Chọn ngày</label></div>
        <span class="schedule-date-caption">Trong 14 ngày tới</span>
      </div>
      <div class="calendar-days-bar" role="group" aria-label="Chọn ngày hẹn">
        ${days.map((day) => `
          <button type="button" class="cal-day-btn ${day.date === wizard.date ? 'selected' : ''}"
            data-date="${day.date}" aria-pressed="${day.date === wizard.date}">
            <span class="day-label">${esc(day.dayLabel)}</span><span class="day-num">${day.dayNum}</span>
          </button>
        `).join('')}
      </div>
    </section>

    <section class="schedule-staff-section" aria-labelledby="scheduleStaffLabel">
      <div class="schedule-section-heading schedule-staff-heading-row">
        <div>
          <span class="schedule-section-index">02</span>
          <div><label id="scheduleStaffLabel">Chọn lịch theo chuyên viên</label><span class="schedule-staff-count">${staffList.length} chuyên viên phù hợp</span></div>
        </div>
        <label class="schedule-search-wrap"><span aria-hidden="true">⌕</span>
          <input id="scheduleStaffSearch" type="search" value="${esc(scheduleStaffQuery)}"
            placeholder="Tìm tên chuyên viên" aria-label="Tìm chuyên viên theo tên" autocomplete="off" />
        </label>
      </div>

      ${!visibleStaff.length ? `
        <div class="schedule-no-results" role="status">Không tìm thấy chuyên viên “${esc(scheduleStaffQuery)}”. Hãy thử tên khác.</div>
      ` : !visibleTimes.length ? `
        <div class="schedule-no-results" role="status">Không có khung giờ làm việc phù hợp trong ngày ${dateLabel}. Vui lòng chọn ngày khác hoặc tìm chuyên viên khác.</div>
      ` : `
        ${staffList.length > 2 ? `<div class="schedule-scroll-tools" id="scheduleScrollTools" hidden>
          <span><i aria-hidden="true">↔</i> Cuộn để xem ${visibleStaff.length} chuyên viên</span>
          <div>
            <button type="button" id="scheduleStaffPrev" aria-label="Xem nhóm chuyên viên trước">‹</button>
            <button type="button" id="scheduleStaffNext" aria-label="Xem nhóm chuyên viên tiếp theo">›</button>
          </div>
        </div>` : ''}
        <div class="schedule-table-scroll" role="region" aria-label="Lịch khả dụng theo chuyên viên" tabindex="0">
          <table class="booking-schedule-table">
            <colgroup><col class="schedule-time-col" />${visibleStaff.map(() => '<col class="schedule-staff-col" />').join('')}</colgroup>
            <thead><tr>
              <th class="schedule-time-head" scope="col">Giờ</th>
              ${visibleStaff.map((staff) => `
                <th class="schedule-person-head ${staff.id === wizard.staffId ? 'is-selected' : ''}" scope="col">
                  <div class="schedule-person">
                    <img src="${esc(staffPhoto(staff))}" data-fallback-image="${esc(staff.imageId || 'staff-01')}" alt="" loading="lazy" />
                    <span class="schedule-person-copy"><strong>${esc(staff.name)}</strong><small>${esc(staff.title || 'Chuyên viên trị liệu')}</small></span>
                  </div>
                </th>
              `).join('')}
            </tr></thead>
            <tbody>
              ${visibleTimes.map((time) => `
                <tr><th class="schedule-time-cell" scope="row">${time}</th>
                  ${visibleStaff.map((staff) => {
                    const slot = availabilityByStaff.get(staff.id)?.get(time);
                    if (!slot) return '<td><span class="schedule-slot-empty" title="Ngoài ca làm việc hoặc không nhận khung giờ này">—</span></td>';
                    if (!slot.available) {
                      const reason = slot.unavailableReason === 'staff' ? 'Chuyên viên đang bận' : 'Đã hết phòng';
                      return `<td><button type="button" class="schedule-slot is-unavailable" disabled title="${esc(reason)} lúc ${time}"><span>Đã kín</span><small>${esc(reason)}</small></button></td>`;
                    }
                    const isSelected = staff.id === wizard.staffId && slot.time === wizard.time;
                    return `<td><button type="button" class="schedule-slot is-available ${isSelected ? 'is-selected' : ''}"
                      data-staff-id="${esc(staff.id)}" data-time="${esc(slot.time)}" data-end-time="${esc(slot.endTime)}"
                      aria-pressed="${isSelected}" aria-label="${esc(staff.name)}, ${slot.time} đến ${slot.endTime}, còn lịch">
                      <span>${slot.time}</span><small>đến ${slot.endTime}</small></button></td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}

      <div class="schedule-legend" aria-label="Chú giải lịch">
        <span><i class="is-free"></i>Còn lịch</span><span><i class="is-busy"></i>Đã kín hoặc chuyên viên bận</span><span><i class="is-outside"></i>Ngoài ca</span>
      </div>
    </section>

    <div class="schedule-selection-summary ${selectedSlot?.available ? 'has-selection' : ''}" id="scheduleSelectionSummary" role="status" aria-live="polite">
      ${selectedSlot?.available && selectedStaff ? `
        <span class="schedule-selection-icon" aria-hidden="true">✓</span><span><small>Lịch đang chọn</small><strong>${esc(selectedStaff.name)} · ${dateLabel} · ${selectedSlot.time}–${selectedSlot.endTime}</strong></span>
      ` : `
        <span class="schedule-selection-icon" aria-hidden="true">○</span><span><small>Chưa chọn lịch</small><strong>Chọn một ô còn lịch trong bảng</strong></span>
      `}
    </div>

    <div class="schedule-actions">
      <button type="button" class="btn-outline" id="scheduleBackBtn">← Đổi liệu trình</button>
      <button type="button" class="btn-primary" id="step3NextBtn" ${selectedSlot?.available ? '' : 'disabled'}>Tiếp tục điền thông tin →</button>
    </div>
  `;

  const scheduleViewport = container.querySelector('.schedule-table-scroll');
  const scrollTools = document.getElementById('scheduleScrollTools');
  if (scheduleViewport && scrollTools && scheduleViewport.scrollWidth > scheduleViewport.clientWidth + 4) {
    scrollTools.hidden = false;
  }

  container.querySelectorAll('.cal-day-btn').forEach((button) => {
    button.addEventListener('click', () => {
      wizard.date = button.getAttribute('data-date');
      wizard.staffId = null;
      wizard.time = null;
      renderScheduleStep(container);
    });
  });

  const searchInput = document.getElementById('scheduleStaffSearch');
  searchInput?.addEventListener('input', () => {
    const cursor = searchInput.selectionStart;
    scheduleStaffQuery = searchInput.value;
    renderScheduleStep(container);
    const nextSearchInput = document.getElementById('scheduleStaffSearch');
    nextSearchInput?.focus();
    nextSearchInput?.setSelectionRange(cursor, cursor);
  });

  document.getElementById('scheduleStaffPrev')?.addEventListener('click', () => {
    scheduleViewport?.scrollBy({ left: -Math.max(260, scheduleViewport.clientWidth * 0.8), behavior: 'smooth' });
  });
  document.getElementById('scheduleStaffNext')?.addEventListener('click', () => {
    scheduleViewport?.scrollBy({ left: Math.max(260, scheduleViewport.clientWidth * 0.8), behavior: 'smooth' });
  });

  container.querySelectorAll('.schedule-slot.is-available').forEach((button) => {
    button.addEventListener('click', () => {
      wizard.staffId = button.getAttribute('data-staff-id');
      wizard.time = button.getAttribute('data-time');
      container.querySelectorAll('.schedule-slot.is-available').forEach((slotButton) => {
        const selected = slotButton === button;
        slotButton.classList.toggle('is-selected', selected);
        slotButton.setAttribute('aria-pressed', String(selected));
      });
      const selectedName = staffList.find((staff) => staff.id === wizard.staffId)?.name;
      container.querySelectorAll('.schedule-person-head').forEach((header) => {
        header.classList.toggle('is-selected', header.querySelector('strong')?.textContent === selectedName);
      });
      const staff = staffList.find((person) => person.id === wizard.staffId);
      const summary = document.getElementById('scheduleSelectionSummary');
      if (summary && staff) {
        summary.classList.add('has-selection');
        summary.innerHTML = `<span class="schedule-selection-icon" aria-hidden="true">✓</span><span><small>Lịch đang chọn</small><strong>${esc(staff.name)} · ${dateLabel} · ${esc(wizard.time)}–${esc(button.getAttribute('data-end-time'))}</strong></span>`;
      }
      const nextButton = document.getElementById('step3NextBtn');
      if (nextButton) nextButton.disabled = false;
    });
  });

  container.querySelectorAll('.schedule-person-head img').forEach((image) => {
    image.addEventListener('error', (event) => {
      const img = event.currentTarget;
      const fallback = getImageById(img.dataset.fallbackImage || 'staff-01').url;
      if (img.src !== new URL(fallback, window.location.href).href) img.src = fallback;
    }, { once: true });
  });

  document.getElementById('scheduleBackBtn')?.addEventListener('click', () => {
    wizard.step = 1;
    renderCurrentWizardStep();
  });
  document.getElementById('step3NextBtn')?.addEventListener('click', () => {
    if (!wizard.staffId || !wizard.time) return;
    wizard.step = 4;
    renderCurrentWizardStep();
  });
}

/* ---------------- BƯỚC 4: THÔNG TIN KHÁCH HÀNG & XÁC NHẬN ---------------- */
const contactFields = {
  name: { input: 'bkCustName', error: 'nameError', draft: 'customerName' },
  phone: { input: 'bkCustPhone', error: 'phoneError', draft: 'customerPhone' },
  email: { input: 'bkCustEmail', error: 'emailError', draft: 'customerEmail' },
  note: { input: 'bkCustNote', error: 'noteError', draft: 'note' }
};

function readBookingContact() {
  const values = {};
  for (const [field, config] of Object.entries(contactFields)) {
    const input = document.getElementById(config.input);
    values[field] = input ? input.value.trim() : wizard[config.draft];
    wizard[config.draft] = values[field];
  }
  return values;
}

function updateContactForm(showErrors = false, serverErrors = null) {
  const result = validate(readBookingContact(), schemas.customerInfo);
  const errors = serverErrors || result.errors;
  for (const [field, config] of Object.entries(contactFields)) {
    const input = document.getElementById(config.input);
    const error = document.getElementById(config.error);
    const message = showErrors ? errors[field] || '' : '';
    input?.setAttribute('aria-invalid', String(Boolean(message)));
    input?.classList.toggle('is-invalid', Boolean(message));
    if (input) input.disabled = submissionInFlight;
    if (error) {
      error.textContent = message;
      error.style.display = message ? 'block' : 'none';
    }
  }
  const submit = document.getElementById('confirmBookingSubmitBtn');
  if (submit) {
    submit.disabled = submissionInFlight || !result.valid || !bookingPaymentReady;
    submit.textContent = submissionInFlight ? 'Đang tạo đơn...' : bookingPaymentReady ? 'TẠO MÃ QR & GIỮ LỊCH 3 PHÚT' : 'Đang kiểm tra thanh toán…';
  }
  const hint = document.getElementById('bookingContactHint');
  if (hint) hint.hidden = result.valid || submissionInFlight;
  const paymentHint = document.getElementById('bookingPaymentHint');
  if (paymentHint) {
    paymentHint.hidden = bookingPaymentReady;
    paymentHint.textContent = bookingPaymentReady ? '' : 'Thanh toán QR đang chờ quản trị viên cấu hình SePay. Hiện chưa nhận đặt lịch trả trước.';
  }
  for (const id of ['applyPromoBtn', 'bkPromoInput', 'step4BackBtn']) {
    const control = document.getElementById(id);
    if (control) control.disabled = submissionInFlight;
  }
  return result;
}

function renderStep4(container) {
  bookingPaymentReady = false;
  const currentService = serviceService.get(wizard.serviceId);
  const currentStaff = staffService.get(wizard.staffId);

  // Tính toán bảng giá tức thời
  let pricing;
  try {
    pricing = bookingService.calculatePrice({
      serviceId: wizard.serviceId,
      duration: wizard.duration,
      serviceDate: wizard.date,
      promoCode: wizard.promoCode
    });
  } catch (err) {
    wizard.promoCode = '';
    pricing = bookingService.calculatePrice({ serviceId: wizard.serviceId, duration: wizard.duration, serviceDate: wizard.date });
    showToast(err.message || 'Mã khuyến mãi không còn áp dụng cho lịch này.', 'danger');
  }

  container.innerHTML = `
    <h3 style="font-family: var(--font-heading); font-size: 1.4rem; color: var(--text-dark); margin-bottom: 8px;">
      Bước 4: Xác Nhận Lịch Hẹn &amp; Thông Tin Liên Hệ
    </h3>
    <p style="color: var(--text-light); font-size: 14px; margin-bottom: 25px;">
      Vui lòng kiểm tra lại chi tiết và cung cấp số điện thoại để Spa chuẩn bị đón tiếp:
    </p>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 30px;">
      <!-- Cột Trái: Form Thông Tin -->
      <div>
        <div class="form-group">
          <label for="bkCustName">Họ và Tên Khách Hàng <span style="color:#ef4444;">*</span></label>
          <input type="text" class="form-control" id="bkCustName" required minlength="2" maxlength="60" autocomplete="name" aria-describedby="nameError" placeholder="Ví dụ: Nguyễn Minh Anh" value="${esc(wizard.customerName)}" />
          <span class="form-error-msg" id="nameError" aria-live="polite" style="display:none;"></span>
        </div>

        <div class="form-group">
          <label for="bkCustPhone">Số Điện Thoại (Zalo / WhatsApp) <span style="color:#ef4444;">*</span></label>
          <input type="tel" class="form-control" id="bkCustPhone" required maxlength="25" autocomplete="tel" aria-describedby="phoneError" placeholder="Ví dụ: 0987654321" value="${esc(wizard.customerPhone)}" />
          <span class="form-error-msg" id="phoneError" aria-live="polite" style="display:none;"></span>
        </div>

        <div class="form-group">
          <label for="bkCustEmail">Địa Chỉ Email (không bắt buộc)</label>
          <input type="email" class="form-control" id="bkCustEmail" autocomplete="email" aria-describedby="emailError" placeholder="Ví dụ: email@gmail.com" value="${esc(wizard.customerEmail)}" />
          <span class="form-error-msg" id="emailError" aria-live="polite" style="display:none;"></span>
        </div>

        <div class="form-group">
          <label for="bkCustNote">Yêu Cầu Đặc Biệt Hoặc Ghi Chú (tối đa 300 ký tự)</label>
          <textarea class="form-control" id="bkCustNote" rows="3" maxlength="300" aria-describedby="noteError" placeholder="Ví dụ: Tập trung giảm mỏi vùng vai gáy, phòng riêng tư, massage lực vừa...">${esc(wizard.note)}</textarea>
          <span class="form-error-msg" id="noteError" aria-live="polite" style="display:none;"></span>
        </div>

        <!-- Khuyến Mãi -->
        <div style="margin-top: 20px;">
          <label style="display: block; font-size: 13px; font-weight: 600; color: var(--text-dark); margin-bottom: 6px;">
            Mã Khuyến Mãi (Ưu đãi độc quyền):
          </label>
          <div style="display: flex; gap: 8px;">
            <input type="text" class="form-control" id="bkPromoInput" placeholder="Ví dụ: SERENITY10, VIP20" value="${esc(wizard.promoCode)}" style="text-transform: uppercase;" />
            <button type="button" class="btn-outline" id="applyPromoBtn" style="white-space: nowrap; padding: 10px 18px; font-size: 13px;">
              Áp Dụng
            </button>
          </div>
          <div style="font-size: 12px; color: #64748b; margin-top: 5px;">
            ${pricing.discountDetails?.sale ? `Đang áp dụng ${esc(pricing.campaignName)}; voucher hợp lệ được cộng dồn trên giá niêm yết.` : 'Gợi ý: Nhập <strong>SERENITY10</strong> hoặc <strong>VIP20</strong> nếu đủ điều kiện.'}
          </div>
        </div>

        <div style="margin-top:20px;padding:16px;border:1px solid #d8e5e2;border-radius:10px;background:#f8fffd;">
          <strong style="display:block;margin-bottom:11px;">Chọn phương thức thanh toán</strong>
          <label style="display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid #087f6e;border-radius:8px;background:white;cursor:pointer;">
            <input type="radio" name="bookingPaymentMethod" value="bank" checked />
            <span><strong>Chuyển khoản VietQR · Techcombank</strong><small style="display:block;color:#64748b;margin-top:3px;">Quét mã có sẵn số tiền và mã đơn. Thanh toán đủ trong 3 phút để giữ lịch.</small></span>
          </label>
          <label aria-disabled="true" style="display:flex;gap:10px;align-items:flex-start;padding:12px;margin-top:8px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#94a3b8;">
            <input type="radio" name="bookingPaymentMethod" value="card" disabled />
            <span><strong>Thanh toán bằng thẻ · Chưa mở</strong><small style="display:block;margin-top:3px;">Sẽ được bật sau khi tích hợp cổng thẻ.</small></span>
          </label>
          <p style="margin:10px 0 0;color:#9a3412;font-size:12px;line-height:1.5;">Nếu chuyển thiếu hoặc sai mã, đơn không được tiếp tục và chúng tôi sẽ không hoàn tiền lại.</p>
        </div>
      </div>

      <!-- Cột Phải: Bảng Tóm Tắt & Giá -->
      <div>
        <div class="booking-summary-box">
          <h4 style="font-size: 1.1rem; color: var(--text-dark); margin-bottom: 15px; border-bottom: 1px solid #e7ded4; padding-bottom: 10px;">
            Tóm Tắt Liệu Trình
          </h4>
          <div class="summary-row">
            <span style="color:#64748b;">Liệu trình:</span>
            <strong style="color:var(--text-dark);">${esc(currentService.name)}</strong>
          </div>
          <div class="summary-row">
            <span style="color:#64748b;">Thời lượng:</span>
            <span>⏱ ${wizard.duration} Phút</span>
          </div>
          <div class="summary-row">
            <span style="color:#64748b;">Chuyên viên:</span>
            <strong>${esc(currentStaff ? currentStaff.name : 'Chuyên viên chỉ định')}</strong>
          </div>
          <div class="summary-row">
            <span style="color:#64748b;">Thời gian:</span>
            <strong style="color:var(--primary-brown);">${wizard.time} • ${formatDate(wizard.date)}</strong>
          </div>
          <div class="summary-row">
            <span style="color:#64748b;">Địa chỉ:</span>
            <span>285B Đường Hoàng Sa, Phường Tân Định, Quận 1, TP.HCM</span>
          </div>
          <div class="summary-row" style="margin-top: 15px;">
            <span style="color:#64748b;">Giá gốc liệu trình:</span>
            <span>${formatVND(pricing.originalPrice)}</span>
          </div>
          ${pricing.discountDetails?.sale ? `<div class="summary-row" style="color:#15803d;"><span>Khuyến mãi ngày (${esc(pricing.campaignName)}):</span><span>− ${formatVND(pricing.discountDetails.sale.discountAmount)}</span></div>` : ''}
          ${pricing.discountDetails?.coupon ? `<div class="summary-row" style="color:#15803d;"><span>Voucher ${esc(pricing.discountDetails.coupon.code)}:</span><span>− ${formatVND(pricing.discountDetails.coupon.discountAmount)}</span></div>` : ''}
          ${pricing.discountAmount > 0 && !pricing.discountDetails ? `<div class="summary-row" style="color:#15803d;"><span>Giảm giá:</span><span>− ${formatVND(pricing.discountAmount)}</span></div>` : ''}
          <div class="summary-row total">
            <span>Tổng Thanh Toán:</span>
            <span>${formatVND(pricing.finalPrice)}</span>
          </div>
          <p style="font-size: 12px; color: #64748b; margin-top: 10px; line-height: 1.5;">
            * Lịch chỉ được xác nhận sau khi hệ thống nhận đủ tiền. Nếu QR hết hạn sau 3 phút, khung giờ sẽ được giải phóng.
          </p>
        </div>

        <button type="button" class="btn-primary" id="confirmBookingSubmitBtn" style="width: 100%; padding: 15px; font-size: 16px; font-weight: bold;">
          TẠO MÃ QR &amp; GIỮ LỊCH 3 PHÚT
        </button>
        <p id="bookingContactHint" role="status" style="font-size:13px;color:#b45309;margin-top:10px;">Vui lòng nhập họ tên, số điện thoại hợp lệ và sửa các ô báo lỗi để xác nhận đặt lịch.</p>
        <p id="bookingPaymentHint" role="status" style="font-size:13px;color:#b42318;margin-top:8px;">Đang kiểm tra cấu hình thanh toán…</p>
      </div>
    </div>

    <div style="margin-top: 30px;">
      <button type="button" class="btn-outline" id="step4BackBtn" style="padding: 10px 20px; font-size: 13px;">
        ← Quay Lại Đổi Giờ Hẹn
      </button>
    </div>
  `;

  for (const config of Object.values(contactFields)) {
    const input = document.getElementById(config.input);
    input?.addEventListener('input', () => updateContactForm(true));
    input?.addEventListener('change', () => updateContactForm(true));
    input?.addEventListener('blur', () => updateContactForm(true));
  }
  updateContactForm();
  if (apiClient.isOnline()) {
    apiClient.getPaymentConfig().then(({ payment }) => {
      bookingPaymentReady = payment?.enabled === true;
      if (document.getElementById('confirmBookingSubmitBtn')) updateContactForm(true);
    }).catch(() => {
      bookingPaymentReady = false;
      if (document.getElementById('confirmBookingSubmitBtn')) updateContactForm(true);
    });
  }

  // Áp dụng khuyến mãi
  document.getElementById('applyPromoBtn')?.addEventListener('click', () => {
    readBookingContact();
    const promoVal = document.getElementById('bkPromoInput')?.value.trim();
    if (!promoVal) {
      showToast('Vui lòng nhập mã khuyến mãi!', 'danger');
      return;
    }
    try {
      const calc = bookingService.calculatePrice({
        serviceId: wizard.serviceId,
        duration: wizard.duration,
        serviceDate: wizard.date,
        promoCode: promoVal
      });
      wizard.promoCode = promoVal.toUpperCase();
      showToast(`Áp dụng mã ${wizard.promoCode} thành công! Giảm ${formatVND(calc.discountAmount)}`, 'success');
      renderStep4(container);
    } catch (err) {
      showToast(err.message || 'Mã khuyến mãi không hợp lệ.', 'danger');
    }
  });

  document.getElementById('step4BackBtn')?.addEventListener('click', () => {
    readBookingContact();
    wizard.step = 3;
    renderCurrentWizardStep();
  });

  // Xác nhận đặt lịch
  document.getElementById('confirmBookingSubmitBtn')?.addEventListener('click', async () => {
    if (submissionInFlight) return;
    const validation = updateContactForm(true);
    if (!validation.valid) {
      document.getElementById(contactFields[Object.keys(validation.errors)[0]].input)?.focus();
      showToast('Vui lòng điền đúng các thông tin liên hệ bắt buộc.', 'danger');
      return;
    }
    const submittedDraft = wizard;
    let serverFieldErrors = null;
    const payload = {
      serviceId: wizard.serviceId, duration: wizard.duration, staffId: wizard.staffId,
      date: wizard.date, startTime: wizard.time,
      customerName: wizard.customerName, customerPhone: wizard.customerPhone,
      customerEmail: wizard.customerEmail, note: wizard.note, promoCode: pricing.promoCode || '', expectedFinalPrice: pricing.finalPrice
    };
    const fingerprint = JSON.stringify(payload);
    if (wizard.submission?.fingerprint !== fingerprint) {
      wizard.submission = { fingerprint, key: globalThis.crypto?.randomUUID?.() || `SER-${Date.now()}-${Math.random().toString(16).slice(2)}` };
    }
    submissionInFlight = true;
    updateContactForm();

    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser || !['customer', 'admin'].includes(currentUser.role)) {
        renderBookingAccessGate(document.getElementById('appRoot'), currentUser, wizard.serviceId, wizard.duration);
        showToast('Vui lòng đăng nhập bằng tài khoản khách hàng trước khi đặt lịch.', 'danger');
        return;
      }

      const newBooking = await bookingService.createBooking({ ...payload, submissionKey: wizard.submission.key });

      sessionStorage.setItem('search_phone', newBooking.customerPhone || payload.customerPhone);
      showToast(`Đơn ${newBooking.code} đang chờ thanh toán. Hoàn tất trong 3 phút để giữ lịch.`, 'normal');
      await renderPaymentCheckout(container, newBooking, newBooking.paymentInstructions);
    } catch (err) {
      if (err.code === 'PRICE_CHANGED') {
        await apiClient.refresh();
        if (wizard === submittedDraft && window.location.pathname === '/dat-lich') renderStep4(container);
      } else if (err.code === 'UNAUTHORIZED') {
        await authService.logout();
        if (window.location.pathname === '/dat-lich') renderBookingPage();
      } else if (wizard === submittedDraft && Object.keys(err.fields || {}).length) {
        serverFieldErrors = err.fields;
      }
      showToast(err.message || 'Không thể tạo lịch hẹn. Vui lòng thử lại.', 'danger');
    } finally {
      submissionInFlight = false;
      if (document.getElementById('confirmBookingSubmitBtn')) {
        updateContactForm(true, wizard === submittedDraft ? serverFieldErrors : null);
      }
    }
  });
}
