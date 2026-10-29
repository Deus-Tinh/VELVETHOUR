import { apiClient } from '../services/apiClient.js';
import { calculatePrice } from '../domain/pricingService.js';
import { clock, todayStr, formatVND, formatDate, esc } from '../core/utils.js';

export function getDisplayPricing(service, duration = service.duration, serviceDate = todayStr()) {
  return calculatePrice({ service, duration, serviceDate, campaigns: apiClient.isOnline() ? apiClient.getHolidaySales() : [], evaluatedAt: clock.now().toISOString() });
}

export function salePriceMarkup(pricing) {
  if (!['holiday_sale', 'holiday_sale_and_coupon'].includes(pricing.discountSource)) return formatVND(pricing.finalPrice);
  const labels = [pricing.campaignName, pricing.promoCode ? `voucher ${pricing.promoCode}` : null].filter(Boolean).map(esc).join(' + ');
  return `<span class="holiday-price"><del>${formatVND(pricing.originalPrice)}</del><strong>${formatVND(pricing.finalPrice)}</strong><small>${labels} · áp dụng ngày ${esc(formatDate(pricing.serviceDate))}</small></span>`;
}

export function saleBadgeMarkup(pricing) {
  if (!['holiday_sale', 'holiday_sale_and_coupon'].includes(pricing?.discountSource)) return '';
  return `<span class="holiday-sale-badge" aria-label="Đang có ${esc(pricing.campaignName)}">ƯU ĐÃI LỄ</span>`;
}
