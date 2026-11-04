/**
 * UI Components & Helpers: Toasts, Modals, Confirm Dialogs, Form Helpers.
 * Tuyệt đối không dùng alert() hay confirm() của trình duyệt.
 * Dữ liệu động được escape an toàn bằng esc() trước khi chèn vào DOM.
 */
import { esc, formatVND, todayStr } from '../core/utils.js';
import { serviceService } from '../services/serviceService.js';
import { getImageById, getServiceImage } from '../imageManifest.js';
import { getServiceKind } from '../domain/serviceCatalogModel.js';
import { getDisplayPricing, salePriceMarkup } from './salePrice.js';

export function showToast(message, type = 'normal') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'danger' ? '⚠' : 'ℹ'}</span>
    <span class="toast-msg">${esc(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

export function showConfirmModal({ title, message, confirmText = 'Xác Nhận', cancelText = 'Hủy Bỏ', onConfirm }) {
  const modal = document.getElementById('serviceModal');
  const body = document.getElementById('serviceModalBody');
  if (!modal || !body) return;

  body.innerHTML = `
    <div style="padding: 25px; text-align: center; max-width: 450px; margin: 0 auto;">
      <div style="font-size: 40px; margin-bottom: 15px; color: var(--accent-orange);">⚠</div>
      <h3 style="font-family: var(--font-heading); font-size: 1.4rem; color: var(--text-dark); margin-bottom: 12px;">${esc(title)}</h3>
      <p style="color: var(--text-light); line-height: 1.6; margin-bottom: 25px; font-size: 14px;">${esc(message)}</p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button type="button" class="btn-outline" id="confirmCancelBtn" style="padding: 10px 20px; font-size: 13px;">${esc(cancelText)}</button>
        <button type="button" class="btn-primary" id="confirmOkBtn" style="padding: 10px 20px; font-size: 13px; background: #dc2626 !important; border-color: #dc2626 !important;">${esc(confirmText)}</button>
      </div>
    </div>
  `;

  modal.classList.add('show');

  const close = () => {
    modal.classList.remove('show');
  };

  document.getElementById('confirmCancelBtn')?.addEventListener('click', close);
  document.getElementById('confirmOkBtn')?.addEventListener('click', () => {
    close();
    if (typeof onConfirm === 'function') onConfirm();
  });
}

export function openServiceModal(serviceId, serviceDate = todayStr()) {
  const service = serviceService.get(serviceId);
  if (!service) return;

  const modal = document.getElementById('serviceModal');
  const body = document.getElementById('serviceModalBody');
  if (!modal || !body) return;

  const imgInfo = getServiceImage(service);
  const includedTreatments = serviceService.componentServices(service);
  const isPackage = getServiceKind(service) === 'package';

  body.innerHTML = `
    <div class="modal-img-container">
      <img src="${esc(imgInfo.url)}" alt="${esc(service.name)}" />
    </div>
    <div class="modal-info">
      <span class="package-badge" style="display: inline-block; width: fit-content; margin-bottom: 12px; background: rgba(142, 110, 63, 0.12); color: var(--primary-brown); padding: 5px 12px; border-radius: 4px; font-size: 11px; text-transform: uppercase; font-weight: 600;">
        ${isPackage ? 'Gói trị liệu' : esc(service.categoryName)}
      </span>
      <h3 style="font-family: var(--font-heading); font-size: 1.8rem; color: var(--text-dark); margin-bottom: 10px;">${esc(service.name)}</h3>
      <div style="font-size: 15px; font-weight: 600; color: var(--primary-brown); margin-bottom: 15px;">
        ⏱ ${service.duration} Phút • <span style="color: var(--accent-orange); font-size: 1.2rem;">${salePriceMarkup(getDisplayPricing(service, service.duration, serviceDate))}</span>
      </div>
      <div class="modal-desc">
        <p style="color: var(--text-light); line-height: 1.7; margin-bottom: 15px;">${esc(service.fullDesc || service.shortDesc)}</p>
        ${includedTreatments.length ? `
          <h4 style="font-size: 0.95rem; margin-top: 15px; margin-bottom: 10px; color: var(--text-dark); font-weight: 600;">Gói bao gồm:</h4>
          <ul style="padding-left: 20px; font-size: 0.88rem; line-height: 1.7; color: var(--text-light); margin-bottom: 20px;">
            ${includedTreatments.map((item) => `<li>${esc(item.name)}</li>`).join('')}
          </ul>
        ` : ''}
        <h4 style="font-size: 0.95rem; margin-top: 15px; margin-bottom: 10px; color: var(--text-dark); font-weight: 600;">Lợi Ích ${isPackage ? 'Gói Trị Liệu' : 'Liệu Trình'}:</h4>
        <ul style="padding-left: 20px; font-size: 0.88rem; line-height: 1.7; color: var(--text-light); margin-bottom: 20px;">
          ${(service.benefits || []).map((b) => `<li style="margin-bottom: 6px;">${esc(b)}</li>`).join('')}
        </ul>
      </div>
      <div style="display: flex; gap: 12px; margin-top: 15px;">
        <a href="/dat-lich?service=${esc(service.id)}&date=${esc(serviceDate)}" class="btn-primary" style="flex: 1; text-align: center; text-decoration: none;" id="modalBookBtn">
          Đặt Lịch Ngay
        </a>
        <a href="/dich-vu/${esc(service.id)}?date=${esc(serviceDate)}" class="btn-outline" style="flex: 1; text-align: center; text-decoration: none;" id="modalDetailBtn">
          Xem Trang Riêng
        </a>
      </div>
    </div>
  `;

  document.getElementById('modalBookBtn')?.addEventListener('click', () => modal.classList.remove('show'));
  document.getElementById('modalDetailBtn')?.addEventListener('click', () => modal.classList.remove('show'));

  modal.classList.add('show');
}

// Gắn helper an toàn vào window phục vụ tương thích các event listeners
window.openServiceModal = openServiceModal;
window.showToast = showToast;
