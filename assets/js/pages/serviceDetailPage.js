/**
 * Trang Chi Tiết Liệu Trình Độc Lập (#/services/:id).
 * Tính năng:
 * - Hiển thị hình ảnh kích thước lớn, thông số chi tiết.
 * - Bộ chọn Biến Thể Thời Lượng (Interactive Variant Picker): tự cập nhật giá trực tiếp.
 * - Danh sách đánh giá thực tế từ khách hàng (Real Reviews list).
 * - Nút Đặt lịch chuyển sang Booking Wizard với biến thể đã chọn.
 */
import { serviceService } from '../services/serviceService.js';
import { reviewService, favoriteService } from '../services/socialAndAnalyticsService.js';
import { authService } from '../services/authService.js';
import { getServiceImage } from '../imageManifest.js';
import { formatVND, esc, formatDateTime, todayStr } from '../core/utils.js';
import { showToast } from '../ui/components.js';
import { getServiceKind } from '../domain/serviceCatalogModel.js';
import { getDisplayPricing, salePriceMarkup } from '../ui/salePrice.js';

export function renderServiceDetailPage(serviceId) {
  const root = document.getElementById('appRoot');
  if (!root) return;

  const service = serviceService.get(serviceId);
  if (!service) {
    root.innerHTML = `
      <div class="section-container" style="text-align: center; padding: 100px 20px;">
        <h2>Liệu trình không tồn tại hoặc đã ngừng hoạt động</h2>
        <a href="#/services" class="btn-primary" style="margin-top: 20px; display: inline-block;">Quay lại danh mục</a>
      </div>
    `;
    return;
  }

  const currentUser = authService.getCurrentUser();
  const isPackage = getServiceKind(service) === 'package';
  const includedTreatments = isPackage ? serviceService.componentServices(service) : [];
  const imgInfo = getServiceImage(service);
  const reviews = reviewService.listByService(service.id);
  const isFav = currentUser ? favoriteService.isFavorite(currentUser.id, service.id) : false;

  // Biến thể mặc định là thời lượng chuẩn của dịch vụ
  let selectedDuration = service.duration;
  let selectedDate = todayStr();
  let selectedPrice = service.price;

  root.innerHTML = `
    <div class="page-banner" style="padding: 40px 20px;">
      <div class="breadcrumbs">
        <a href="#/" style="color:inherit;text-decoration:none;">Trang Chủ</a> / 
        <a href="${isPackage ? '#/packages' : '#/services'}" style="color:inherit;text-decoration:none;">${isPackage ? 'Gói Trị Liệu' : 'Liệu Trình'}</a> / 
        ${isPackage ? 'Gói Trị Liệu' : esc(service.categoryName)}
      </div>
      <h1 style="font-size: 2.2rem;">${esc(service.name)}</h1>
    </div>

    <div class="section-container" style="padding-top: 40px; padding-bottom: 70px;">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 40px; align-items: start;">
        <!-- Cột Ảnh Trái -->
        <div>
          <div style="position: relative; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
            <img src="${esc(imgInfo.url)}" alt="${esc(service.name)}" style="width: 100%; height: auto; display: block; object-fit: cover;" />
            <button type="button" class="fav-btn ${isFav ? 'active' : ''}" id="detailFavBtn" style="position: absolute; top: 15px; right: 15px; background: rgba(255,255,255,0.9); border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;" title="Lưu yêu thích">
              ♥
            </button>
          </div>
          <div style="margin-top: 20px; display: flex; gap: 10px; color: var(--text-light); font-size: 13px;">
            <span>🌿 100% Tinh dầu thiên nhiên</span> • 
            <span>🧖 Phòng đơn &amp; phòng đôi riêng tư</span> • 
            <span>☕ Miễn phí trà thảo mộc</span>
          </div>
        </div>

        <!-- Cột Thông Tin Phải -->
        <div>
          <span class="package-badge" style="display: inline-block; margin-bottom: 15px; background: rgba(142, 110, 63, 0.12); color: var(--primary-brown); padding: 5px 12px; border-radius: 4px; font-size: 12px; text-transform: uppercase; font-weight: 600;">
            ${isPackage ? 'Gói Trị Liệu' : esc(service.categoryName)}
          </span>
          <h2 style="font-family: var(--font-heading); font-size: 2.2rem; color: var(--text-dark); margin-bottom: 12px;">${esc(service.name)}</h2>

          <div style="display: flex; align-items: baseline; gap: 15px; margin-bottom: 20px;">
            <div id="detailPriceDisplay" style="font-size: 2rem; font-weight: bold; color: var(--accent-orange);">
              ${salePriceMarkup(getDisplayPricing(service, selectedDuration, selectedDate))}
            </div>
            <div id="detailDurationDisplay" style="font-size: 1.1rem; color: #64748b; font-weight: 600;">
              ⏱ ${selectedDuration} Phút
            </div>
          </div>

          <label style="display:block;margin-bottom:16px">Ngày đến spa<input type="date" class="form-control" id="detailServiceDate" min="${todayStr()}" value="${selectedDate}" /></label>
          <div style="margin-bottom: 25px;">
            <label style="display: block; font-size: 13px; font-weight: 600; text-transform: uppercase; color: #64748b; margin-bottom: 10px;">
              Chọn ${isPackage ? 'mức thời lượng của gói' : 'thời lượng liệu trình'}:
            </label>
            <div class="variant-btn-group" id="variantPickerGroup">
              ${(service.variants || [{ duration: service.duration, price: service.price }]).map((v) => `
                <button type="button" class="variant-btn ${v.duration === selectedDuration ? 'selected' : ''}" data-duration="${v.duration}" data-price="${v.price}">
                  ⏱ ${v.duration} Phút • <span data-variant-price>${salePriceMarkup(getDisplayPricing(service, v.duration, selectedDate))}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <p style="color: var(--text-light); line-height: 1.8; font-size: 15px; margin-bottom: 25px;">
            ${esc(service.fullDesc || service.shortDesc)}
          </p>

          ${includedTreatments.length ? `
            <div class="detail-package-includes">
              <h4>Gói bao gồm</h4>
              <ul>${includedTreatments.map((item) => `<li>${esc(item.name)}</li>`).join('')}</ul>
              <p>Đây là một gói đặt lịch duy nhất với một chuyên viên theo tổng thời lượng đã chọn.</p>
            </div>
          ` : ''}

          <div style="background: #fafaf9; border: 1px solid #e7ded4; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
            <h4 style="font-size: 1rem; color: var(--text-dark); font-weight: 600; margin-bottom: 12px;">Lợi Ích ${isPackage ? 'Của Gói' : 'Của Liệu Trình'}:</h4>
            <ul style="padding-left: 20px; color: var(--text-light); font-size: 14px; line-height: 1.8;">
              ${(service.benefits || []).map((b) => `<li>${esc(b)}</li>`).join('')}
            </ul>
          </div>

          <div style="display: flex; gap: 15px;">
            <a href="#/booking?service=${esc(service.id)}&duration=${selectedDuration}&date=${selectedDate}" id="detailBookCtaBtn" class="btn-primary" style="flex: 1; text-align: center; padding: 14px 20px; font-size: 15px; text-decoration: none;">
              📅 Đặt Lịch Ngay (${selectedDuration} Phút)
            </a>
            <a href="${isPackage ? '#/packages' : '#/services'}" class="btn-outline" style="text-align: center; padding: 14px 20px; font-size: 14px; text-decoration: none;">
              ← ${isPackage ? 'Xem Gói Khác' : 'Xem Liệu Trình Khác'}
            </a>
          </div>
        </div>
      </div>

      <!-- Đánh Giá Của Khách Hàng -->
      <div style="margin-top: 60px; padding-top: 40px; border-top: 1px solid #e2e8f0;">
        <h3 style="font-family: var(--font-heading); font-size: 1.6rem; color: var(--text-dark); margin-bottom: 20px;">
          Đánh Giá Từ Khách Hàng (${reviews.length})
        </h3>

        ${reviews.length === 0 ? `
          <p style="color: #64748b; font-style: italic;">Chưa có đánh giá nào cho liệu trình này. Hãy là người đầu tiên trải nghiệm và chia sẻ cảm nhận!</p>
        ` : `
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px;">
            ${reviews.map((r) => `
              <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                  <strong style="color: var(--text-dark); font-size: 14px;">${esc(r.userName)}</strong>
                  <span style="color: #f59e0b; font-size: 13px;">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
                </div>
                <p style="color: var(--text-light); font-size: 13px; line-height: 1.6; margin: 0 0 10px 0;">"${esc(r.comment)}"</p>
                <div style="color: #94a3b8; font-size: 11px;">${formatDateTime(r.createdAt)}</div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
  `;

  // Gắn sự kiện chọn Variant
  const priceDisplay = document.getElementById('detailPriceDisplay');
  const durDisplay = document.getElementById('detailDurationDisplay');
  const bookCta = document.getElementById('detailBookCtaBtn');
  document.getElementById('detailServiceDate')?.addEventListener('change', (event) => {
    selectedDate = event.target.value || todayStr();
    priceDisplay.innerHTML = salePriceMarkup(getDisplayPricing(service, selectedDuration, selectedDate));
    bookCta.setAttribute('href', `#/booking?service=${encodeURIComponent(service.id)}&duration=${selectedDuration}&date=${selectedDate}`);
    document.querySelectorAll('#variantPickerGroup .variant-btn').forEach((button) => {
      button.querySelector('[data-variant-price]').innerHTML = salePriceMarkup(getDisplayPricing(service, Number(button.dataset.duration), selectedDate));
    });
  });

  document.querySelectorAll('#variantPickerGroup .variant-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#variantPickerGroup .variant-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');

      selectedDuration = Number(btn.getAttribute('data-duration'));
      selectedPrice = Number(btn.getAttribute('data-price'));

      if (priceDisplay) priceDisplay.innerHTML = salePriceMarkup(getDisplayPricing(service, selectedDuration, selectedDate));
      if (durDisplay) durDisplay.textContent = `⏱ ${selectedDuration} Phút`;
      if (bookCta) {
        bookCta.setAttribute('href', `#/booking?service=${encodeURIComponent(service.id)}&duration=${selectedDuration}&date=${selectedDate}`);
        bookCta.textContent = `📅 Đặt Lịch Ngay (${selectedDuration} Phút)`;
      }
    });
  });

  // Gắn sự kiện Yêu thích
  document.getElementById('detailFavBtn')?.addEventListener('click', async (e) => {
    if (!currentUser) {
      showToast('Vui lòng đăng nhập để lưu liệu trình yêu thích!', 'danger');
      window.location.hash = '#/my-bookings';
      return;
    }
    try {
      const res = await favoriteService.toggle(currentUser.id, service.id);
      e.currentTarget.classList.toggle('active', res.favorited);
      showToast(res.favorited ? 'Đã thêm vào mục yêu thích!' : 'Đã xóa khỏi mục yêu thích.', 'success');
    } catch (error) { showToast(error.message || 'Không cập nhật được mục yêu thích.', 'danger'); }
  });
}
