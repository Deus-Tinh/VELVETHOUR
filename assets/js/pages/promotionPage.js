import { apiClient } from '../services/apiClient.js';
import { esc, formatDate, formatVND, todayStr } from '../core/utils.js';

let renderSequence = 0;

function discountLabel(campaign) {
  if (!campaign) return '';
  return campaign.discountType === 'percent'
    ? `Giảm ${Number(campaign.percentageBps || 0) / 100}%`
    : `Giảm ${formatVND(Number(campaign.fixedAmountVnd || 0))}`;
}

export async function renderPromotionPage(slug) {
  const sequence = ++renderSequence;
  const root = document.getElementById('appRoot');
  if (!root) return;
  root.innerHTML = '<section class="promotion-page-loading" role="status">Đang tải ưu đãi…</section>';
  try {
    const { page } = await apiClient.getSitePage(slug);
    if (sequence !== renderSequence || !root.isConnected || window.location.hash.split('?')[0] !== `#/pages/${slug}`) return;
    if (page.templateId !== 'holiday-offer-v1') throw new Error('Mẫu trang ưu đãi không được hỗ trợ.');
    const campaign = page.campaign;
    const content = page.content || {};
    const today = todayStr();
    const bookingDate = campaign?.serviceDateFrom > today ? campaign.serviceDateFrom : today;
    const campaignDetails = campaign ? `
      <section class="promotion-offer-card" aria-label="Chi tiết ưu đãi">
        <span class="promotion-offer-chip">Ưu đãi dịp lễ</span>
        <h2>${esc(campaign.name)}</h2>
        <strong>${esc(discountLabel(campaign))}</strong>
        <p>Áp dụng cho ngày sử dụng dịch vụ từ ${esc(formatDate(campaign.serviceDateFrom))} đến ${esc(formatDate(campaign.serviceDateTo))}.</p>
        ${campaign.occasion ? `<p>${esc(campaign.occasion)}</p>` : ''}
        <small>Giá ưu đãi được tính theo ngày khách chọn khi đặt lịch.</small>
      </section>` : '';
    root.innerHTML = `
      <main class="promotion-page">
        <a class="promotion-back-link" href="#/packages">← Xem tất cả dịch vụ</a>
        <header class="promotion-hero">
          ${content.eyebrow ? `<p class="promotion-eyebrow">${esc(content.eyebrow)}</p>` : ''}
          <h1>${esc(page.title)}</h1>
          <p class="promotion-subtitle">${esc(content.subtitle)}</p>
        </header>
        ${campaignDetails}
        <section class="promotion-copy">
          <p>${esc(content.body).replace(/\r?\n/g, '<br>')}</p>
          ${Array.isArray(content.highlights) && content.highlights.length ? `<ul>${content.highlights.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
          ${content.conditions ? `<aside class="promotion-conditions"><h2>Điều kiện áp dụng</h2><p>${esc(content.conditions).replace(/\r?\n/g, '<br>')}</p></aside>` : ''}
        </section>
        <a class="btn-primary promotion-booking-cta" href="#/packages?date=${encodeURIComponent(bookingDate)}">${esc(content.ctaLabel || 'Đặt lịch ưu đãi')}</a>
      </main>
    `;
  } catch (error) {
    if (sequence !== renderSequence || !root.isConnected || window.location.hash.split('?')[0] !== `#/pages/${slug}`) return;
    root.innerHTML = `<main class="promotion-page promotion-page-error"><h1>Không tải được trang ưu đãi</h1><p>${esc(error.message || 'Trang này không còn được xuất bản.')}</p><a class="btn-outline" href="#/packages">Quay lại dịch vụ</a></main>`;
  }
}
