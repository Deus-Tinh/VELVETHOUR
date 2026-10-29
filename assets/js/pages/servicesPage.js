/**
 * Trang Danh Mục Dịch Vụ & Gói Trị Liệu (#/services & #/packages).
 * Tính năng:
 * - Tìm kiếm tiếng Việt không dấu (NormalizeText).
 * - Bộ lọc theo Nhóm dịch vụ, Khoảng giá, Thời lượng.
 * - Sắp xếp theo Giá (tăng/giảm), Tên (A-Z/Z-A), Mới nhất.
 * - Phân trang Array Methods.
 * - Xem chi tiết Modal / Trang riêng.
 * - Nút Yêu thích (Favorite toggle) gắn với tài khoản.
 */
import { serviceService } from '../services/serviceService.js';
import { favoriteService } from '../services/socialAndAnalyticsService.js';
import { authService } from '../services/authService.js';
import { apiClient } from '../services/apiClient.js';
import { getDisplayPricing, saleBadgeMarkup, salePriceMarkup } from '../ui/salePrice.js';
import { getServiceImage } from '../imageManifest.js';
import { SERVICE_CATALOG_PAGE_SIZE } from '../core/constants.js';
import { formatVND, esc, todayStr, isValidDateStr } from '../core/utils.js';
import { showToast, openServiceModal } from '../ui/components.js';
import { THERAPY_GROUPS, getTherapyGroupName } from '../domain/therapyGroupModel.js';
import { getServiceKind } from '../domain/serviceCatalogModel.js';

let filterState = {
  q: '',
  serviceDate: todayStr(),
  kind: 'therapy',
  category: 'all',
  therapyGroup: 'all',
  minPrice: '',
  maxPrice: '',
  duration: 'all',
  sort: 'featured',
  page: 1,
  pageSize: SERVICE_CATALOG_PAGE_SIZE
};
let activeCatalogRoute = null;
let catalogRequestId = 0;
let searchTimer = null;
let advancedFiltersOpen = false;

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash || '#/';
    if (hash !== '#/services' && hash !== '#/packages') activeCatalogRoute = null;
  });
}

export function renderServicesPage(defaultCat = 'all', initialDate = '') {
  if (!filterState.serviceDate || filterState.serviceDate < todayStr()) filterState.serviceDate = todayStr();
  const root = document.getElementById('appRoot');
  if (!root) return;

  clearTimeout(searchTimer);
  // Reset bộ lọc chỉ khi đổi route; các lần render lại sau đồng bộ API giữ nguyên trang.
  if (activeCatalogRoute !== defaultCat) {
    activeCatalogRoute = defaultCat;
    advancedFiltersOpen = false;
    Object.assign(filterState, {
      q: '', category: defaultCat === 'packages' ? 'all' : defaultCat, minPrice: '', maxPrice: '', duration: 'all',
      kind: defaultCat === 'packages' ? 'all' : 'therapy',
      therapyGroup: 'all',
      sort: defaultCat === 'packages' ? 'newest' : 'featured', page: 1, pageSize: SERVICE_CATALOG_PAGE_SIZE,
      serviceDate: isValidDateStr(initialDate) && initialDate >= todayStr() ? initialDate : todayStr(),
    });
  } else if (isValidDateStr(initialDate) && initialDate >= todayStr() && initialDate !== filterState.serviceDate) {
    filterState.serviceDate = initialDate;
    filterState.page = 1;
  }

  const isShopCatalog = defaultCat === 'packages';
  const catalogLabel = isShopCatalog ? 'dịch vụ' : 'liệu trình';
  const activeServices = serviceService.listActive()
    .filter((service) => isShopCatalog || getServiceKind(service) === 'therapy')
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const selectedServiceGroup = filterState.kind === 'package' ? 'packages' : filterState.therapyGroup;
  const selectedPrice = filterState.minPrice === 0 && filterState.maxPrice === 500000 ? 'under500'
    : filterState.minPrice === 500000 && filterState.maxPrice === 800000 ? '500to800'
      : filterState.minPrice === 800000 && filterState.maxPrice === '' ? 'over800' : '';

  root.innerHTML = `
    <div class="page-banner">
      <div class="breadcrumbs"><a href="#/" style="color:inherit;text-decoration:none;">Trang Chủ</a> / ${isShopCatalog ? 'Dịch Vụ' : 'Liệu Trình'}</div>
      <h1>${isShopCatalog ? 'DANH MỤC DỊCH VỤ' : 'DANH MỤC LIỆU TRÌNH'}</h1>
      <p>${isShopCatalog ? 'Chọn liệu trình hoặc gói trị liệu phù hợp, xem chi tiết và đặt lịch trực tiếp tại Serenity Spa &amp; Wellness.' : 'Khám phá các liệu trình độc lập tại Serenity Spa &amp; Wellness, Quận 1.'}</p>
    </div>

    <div class="section-container" style="padding-top: 35px;">
      <!-- Filter Bar -->
      <div class="service-filter-bar catalog-filter-bar">
        <div class="catalog-primary-filters">
          <div class="search-input-wrap catalog-search-field">
            <label for="svcSearchInput">Tìm kiếm ${catalogLabel}</label>
            <div class="catalog-search-input">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
              <input type="search" class="form-control" id="svcSearchInput" placeholder="Tìm kiếm ${catalogLabel}..." list="svcSearchSuggestions" maxlength="120" value="${esc(filterState.q)}" />
            </div>
            <datalist id="svcSearchSuggestions">
              ${activeServices.map((service) => `<option value="${esc(service.name)}"></option>`).join('')}
            </datalist>
          </div>

          ${isShopCatalog ? `
            <div class="catalog-filter-field">
              <label for="svcCategorySelect">Nhóm dịch vụ</label>
              <select class="form-control" id="svcCategorySelect">
                <option value="all" ${selectedServiceGroup === 'all' ? 'selected' : ''}>Tất Cả Dịch Vụ</option>
                ${THERAPY_GROUPS.map((group) => `<option value="${esc(group.id)}" ${selectedServiceGroup === group.id ? 'selected' : ''}>${esc(group.name)}</option>`).join('')}
                <option value="packages" ${selectedServiceGroup === 'packages' ? 'selected' : ''}>Gói trị liệu</option>
              </select>
            </div>
          ` : `
            <div class="catalog-filter-field">
              <label for="svcTherapyGroupSelect">Nhóm liệu trình</label>
              <select class="form-control" id="svcTherapyGroupSelect">
                <option value="all" ${filterState.therapyGroup === 'all' ? 'selected' : ''}>Tất Cả Nhóm Liệu Trình</option>
                ${THERAPY_GROUPS.map((group) => `<option value="${esc(group.id)}" ${filterState.therapyGroup === group.id ? 'selected' : ''}>${esc(group.name)}</option>`).join('')}
              </select>
            </div>
          `}

          <div class="catalog-filter-field">
            <label for="svcPriceSelect">Khoảng giá</label>
            <select class="form-control" id="svcPriceSelect">
              <option value="">Khoảng Giá (Tất Cả)</option>
              <option value="under500" ${selectedPrice === 'under500' ? 'selected' : ''}>Dưới 500.000₫</option>
              <option value="500to800" ${selectedPrice === '500to800' ? 'selected' : ''}>500.000₫ – 800.000₫</option>
              <option value="over800" ${selectedPrice === 'over800' ? 'selected' : ''}>Trên 800.000₫</option>
            </select>
          </div>

          <button type="button" class="catalog-more-filters" id="svcAdvancedFilterToggle" aria-expanded="${advancedFiltersOpen}" aria-controls="svcAdvancedFilters">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>
            Bộ lọc thêm
            <span class="catalog-filter-count" id="svcAdvancedFilterCount" hidden></span>
            <svg class="catalog-filter-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 9 6 6 6-6"/></svg>
          </button>
        </div>

        <div class="catalog-advanced-filters" id="svcAdvancedFilters" role="region" aria-label="Bộ lọc bổ sung" ${advancedFiltersOpen ? '' : 'hidden'}>
          <div class="catalog-filter-field">
            <label for="svcDateInput">Ngày đến spa</label>
            <input type="date" class="form-control" id="svcDateInput" aria-describedby="svcDateHint" min="${todayStr()}" value="${esc(filterState.serviceDate)}" />
          </div>
          <div class="catalog-filter-field">
            <label for="svcDurationSelect">Thời lượng</label>
            <select class="form-control" id="svcDurationSelect">
              <option value="all" ${filterState.duration === 'all' ? 'selected' : ''}>Thời Lượng (Tất Cả)</option>
              <option value="lt60" ${filterState.duration === 'lt60' ? 'selected' : ''}>&lt; 60 Phút</option>
              <option value="60-90" ${filterState.duration === '60-90' ? 'selected' : ''}>60 – 90 Phút</option>
              <option value="gt90" ${filterState.duration === 'gt90' ? 'selected' : ''}>&gt; 90 Phút</option>
            </select>
          </div>
          <div class="catalog-filter-field">
            <label for="svcSortSelect">Sắp xếp</label>
            <select class="form-control" id="svcSortSelect">
              <option value="featured" ${filterState.sort === 'featured' ? 'selected' : ''}>Nổi Bật Nhất</option>
              <option value="price-asc" ${filterState.sort === 'price-asc' ? 'selected' : ''}>Giá: Thấp đến Cao</option>
              <option value="price-desc" ${filterState.sort === 'price-desc' ? 'selected' : ''}>Giá: Cao đến Thấp</option>
              <option value="name-asc" ${filterState.sort === 'name-asc' ? 'selected' : ''}>Tên A – Z</option>
              <option value="name-desc" ${filterState.sort === 'name-desc' ? 'selected' : ''}>Tên Z – A</option>
              <option value="newest" ${filterState.sort === 'newest' ? 'selected' : ''}>Mới Nhất</option>
              <option value="oldest" ${filterState.sort === 'oldest' ? 'selected' : ''}>Cũ Nhất</option>
              <option value="rating-desc" ${filterState.sort === 'rating-desc' ? 'selected' : ''}>Đánh Giá Cao Nhất</option>
            </select>
          </div>
          <p id="svcDateHint">Giá và ưu đãi được tính theo ngày đến spa. Mặc định là hôm nay.</p>
        </div>
      </div>

      <!-- Services Grid Container -->
      <div id="servicesListContainer"></div>

      <!-- Pagination Wrap -->
      <div class="pagination-wrap" id="servicesPaginationContainer"></div>
    </div>
  `;

  bindFilterEvents();
  renderFilteredList();
}

function bindFilterEvents() {
  document.getElementById('svcAdvancedFilterToggle')?.addEventListener('click', (event) => {
    const panel = document.getElementById('svcAdvancedFilters');
    if (!panel) return;
    advancedFiltersOpen = !advancedFiltersOpen;
    panel.hidden = !advancedFiltersOpen;
    event.currentTarget.setAttribute('aria-expanded', String(advancedFiltersOpen));
  });
  document.getElementById('svcDateInput')?.addEventListener('change', (event) => {
    filterState.serviceDate = event.target.value || todayStr();
    filterState.page = 1;
    renderFilteredList();
  });
  const searchInput = document.getElementById('svcSearchInput');
  const catSelect = document.getElementById('svcCategorySelect');
  const therapyGroupSelect = document.getElementById('svcTherapyGroupSelect');
  const priceSelect = document.getElementById('svcPriceSelect');
  const durSelect = document.getElementById('svcDurationSelect');
  const sortSelect = document.getElementById('svcSortSelect');

  searchInput?.addEventListener('input', (e) => {
    filterState.q = e.target.value;
    filterState.page = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { renderFilteredList(); }, 250);
  });

  catSelect?.addEventListener('change', (e) => {
    const group = e.target.value;
    // Nhóm hiển thị dùng therapyGroup; gói trị liệu dùng kind, không đổi danh mục vận hành.
    filterState.category = 'all';
    filterState.kind = group === 'packages' ? 'package' : group === 'all' ? 'all' : 'therapy';
    filterState.therapyGroup = group === 'packages' ? 'all' : group;
    filterState.page = 1;
    clearTimeout(searchTimer);
    renderFilteredList();
  });

  therapyGroupSelect?.addEventListener('change', (e) => {
    filterState.therapyGroup = e.target.value;
    filterState.page = 1;
    clearTimeout(searchTimer);
    renderFilteredList();
  });

  priceSelect?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'under500') { filterState.minPrice = 0; filterState.maxPrice = 500000; }
    else if (val === '500to800') { filterState.minPrice = 500000; filterState.maxPrice = 800000; }
    else if (val === 'over800') { filterState.minPrice = 800000; filterState.maxPrice = ''; }
    else { filterState.minPrice = ''; filterState.maxPrice = ''; }
    filterState.page = 1;
    clearTimeout(searchTimer);
    renderFilteredList();
  });

  durSelect?.addEventListener('change', (e) => {
    filterState.duration = e.target.value;
    filterState.page = 1;
    clearTimeout(searchTimer);
    renderFilteredList();
  });

  sortSelect?.addEventListener('change', (e) => {
    filterState.sort = e.target.value;
    filterState.page = 1;
    clearTimeout(searchTimer);
    renderFilteredList();
  });
}

async function renderFilteredList() {
  const advancedFilterCount = Number(filterState.serviceDate !== todayStr())
    + Number(filterState.duration !== 'all')
    + Number(filterState.sort !== (activeCatalogRoute === 'packages' ? 'newest' : 'featured'));
  const countBadge = document.getElementById('svcAdvancedFilterCount');
  if (countBadge) {
    countBadge.hidden = advancedFilterCount === 0;
    countBadge.textContent = String(advancedFilterCount);
  }
  document.getElementById('svcAdvancedFilterToggle')?.setAttribute('aria-label', advancedFilterCount
    ? `Bộ lọc thêm (${advancedFilterCount} tùy chọn đang áp dụng)` : 'Bộ lọc thêm');
  const container = document.getElementById('servicesListContainer');
  const pagContainer = document.getElementById('servicesPaginationContainer');
  if (!container) return;
  const isShopCatalog = activeCatalogRoute === 'packages';
  const catalogLabel = isShopCatalog ? 'dịch vụ' : 'liệu trình';

  const requestId = ++catalogRequestId;
  if (pagContainer) pagContainer.innerHTML = '';
  container.innerHTML = '<div role="status" style="text-align:center;padding:36px 20px;color:var(--text-light);">Đang tải danh sách từ máy chủ…</div>';

  let res;
  try {
    // Máy chủ là nguồn chính; local query chỉ giữ chế độ demo khi chưa có API.
    res = apiClient.isOnline() ? await apiClient.listServices(filterState) : serviceService.query(filterState);
  } catch (error) {
    if (requestId !== catalogRequestId || !container.isConnected) return;
    container.innerHTML = `
      <div role="alert" style="text-align:center;padding:40px 20px;background:#fff;border-radius:8px;">
        <p style="color:var(--text-light);">${esc(error.message || 'Không tải được danh sách liệu trình từ máy chủ.')}</p>
        <button type="button" class="btn-outline" id="retryServicesLoadBtn">Thử tải lại</button>
      </div>
    `;
    document.getElementById('retryServicesLoadBtn')?.addEventListener('click', () => { renderFilteredList(); });
    if (pagContainer) pagContainer.innerHTML = '';
    return;
  }

  if (requestId !== catalogRequestId || !container.isConnected) return;
  // Server clamps trang hiện tại nếu số liệu vừa bị xóa hoặc ẩn.
  filterState.page = res.page;
  const currentUser = authService.getCurrentUser();
  const serviceCatalog = new Map(serviceService.list().map((service) => [service.id, service]));

  if (pagContainer) {
    pagContainer.innerHTML = `
      <button type="button" class="page-btn" id="prevPageBtn" aria-label="Trang trước" ${res.page <= 1 ? 'disabled' : ''}>← Trang Trước</button>
      <span aria-live="polite" style="font-size:13px;font-weight:600;color:#64748b;margin:0 8px;">Trang ${res.page} / ${res.totalPages} · ${res.total} kết quả</span>
      <button type="button" class="page-btn" id="nextPageBtn" aria-label="Trang kế tiếp" ${res.page >= res.totalPages ? 'disabled' : ''}>Trang Kế →</button>
    `;
    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
      if (filterState.page > 1) {
        filterState.page--;
        renderFilteredList();
        window.scrollTo({ top: 300, behavior: 'smooth' });
      }
    });
    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
      if (filterState.page < res.totalPages) {
        filterState.page++;
        renderFilteredList();
        window.scrollTo({ top: 300, behavior: 'smooth' });
      }
    });
  }

  if (!res.items.length) {
    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; background: #fff; border-radius: 8px;">
        <div style="font-size: 48px; margin-bottom: 15px;">🍃</div>
          <h3 style="color: var(--text-dark); margin-bottom: 8px;">Không tìm thấy ${catalogLabel} phù hợp</h3>
        <p style="color: var(--text-light); font-size: 14px;">Vui lòng thử điều chỉnh lại từ khóa hoặc xóa bớt bộ lọc.</p>
      </div>
    `;
    if (pagContainer) pagContainer.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="packages-grid">
      ${res.items.map((service) => {
        const imgInfo = getServiceImage(service);
        const isFav = currentUser ? favoriteService.isFavorite(currentUser.id, service.id) : false;
        const isPackage = getServiceKind(service) === 'package';
        const includedTreatments = isPackage ? serviceService.componentServices(service, serviceCatalog) : [];
        const pricing = service.salePricing || getDisplayPricing(service, service.duration, filterState.serviceDate);
        const hasHolidaySale = ['holiday_sale', 'holiday_sale_and_coupon'].includes(pricing.discountSource);

        return `
          <div class="package-card">
            <div class="package-img">
              <img src="${esc(imgInfo.url)}" alt="${esc(service.name)}" loading="lazy" />
              <span class="package-badge">${isPackage ? 'Gói trị liệu' : esc(getTherapyGroupName(service) || service.categoryName)}</span>
              ${saleBadgeMarkup(pricing)}
              <button type="button" class="fav-btn ${isFav ? 'active' : ''}" data-fav-id="${esc(service.id)}" style="position: absolute; top: 12px; right: 12px; background: rgba(255,255,255,0.9); border-radius: 50%; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;" title="Lưu yêu thích">
                ♥
              </button>
            </div>
            <div class="package-info">
              <h3>${esc(service.name)}</h3>
              <div class="service-duration">
                ⏱ ${service.duration} Phút • <span style="color: var(--accent-orange); font-weight: bold;">${salePriceMarkup(pricing)}</span>
                ${service.rating > 0 ? `<span style="margin-left: 8px; color: #f59e0b;">★ ${service.rating}</span>` : ''}
              </div>
              <p class="card-desc">${esc(service.shortDesc)}</p>
              ${includedTreatments.length ? `<p class="package-includes-summary"><strong>Gói gồm:</strong> ${includedTreatments.map((item) => esc(item.name)).join(' · ')}</p>` : ''}
              <div class="service-actions">
                <button type="button" class="view-details-btn" data-modal-id="${esc(service.id)}">Xem Chi Tiết</button>
                <a href="#/booking?service=${esc(service.id)}&date=${esc(filterState.serviceDate)}" class="btn-primary">${hasHolidaySale ? 'Đặt lịch ưu đãi' : 'Đặt Lịch Ngay'}</a>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Gắn sự kiện Xem modal
  container.querySelectorAll('[data-modal-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openServiceModal(btn.getAttribute('data-modal-id'), filterState.serviceDate);
    });
  });

  // Gắn sự kiện Yêu thích
  container.querySelectorAll('[data-fav-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!currentUser) {
        showToast('Vui lòng đăng nhập để lưu liệu trình yêu thích!', 'danger');
        window.location.hash = '#/my-bookings';
        return;
      }
      const sid = btn.getAttribute('data-fav-id');
      try {
        const res = await favoriteService.toggle(currentUser.id, sid);
        btn.classList.toggle('active', res.favorited);
        showToast(res.favorited ? 'Đã thêm vào mục yêu thích!' : 'Đã xóa khỏi mục yêu thích.', 'success');
      } catch (error) { showToast(error.message || 'Không cập nhật được mục yêu thích.', 'danger'); }
    });
  });
}
