import { AppError } from '../core/errors.js';
import { businessNow, isValidDateStr } from '../core/utils.js';
import { isUtcTimestamp, MAX_PRICE_VND, normalizeHolidaySale, SALE_SCOPE_RANK } from './holidaySaleModel.js';

export const PRICING_POLICY_VERSION = 2;

function money(value, field, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_PRICE_VND) {
    throw new AppError('INVALID_PRICE', `Số tiền ${field} không hợp lệ.`);
  }
  return value;
}

function matches(sale, service, duration, serviceDate) {
  if (!sale.enabled || serviceDate < sale.serviceDateFrom || serviceDate > sale.serviceDateTo) return false;
  if (sale.scopeType === 'all') return true;
  return sale.targets.some((target) => sale.scopeType === 'category'
    ? target.targetId === service.category
    : target.targetId === service.id && (sale.scopeType !== 'service_variant' || target.durationMinutes === duration));
}

function compareCandidates(left, right) {
  return right.discountAmount - left.discountAmount
    || SALE_SCOPE_RANK[right.sale.scopeType] - SALE_SCOPE_RANK[left.sale.scopeType]
    || left.sale.targets.length - right.sale.targets.length
    || Date.parse(right.sale.updatedAt) - Date.parse(left.sale.updatedAt)
    || (left.sale.id < right.sale.id ? -1 : left.sale.id > right.sale.id ? 1 : 0);
}

function couponDiscount(coupon, code, originalPrice, evaluatedDate) {
  const invalid = () => { throw new AppError('PROMO_INVALID', 'Mã khuyến mãi không hợp lệ hoặc đang bị tắt.'); };
  if (!coupon || typeof coupon.code !== 'string' || coupon.code.trim().toUpperCase() !== code || coupon.active !== true
    || !['percent', 'fixed'].includes(coupon.type) || !Number.isFinite(coupon.value) || coupon.value <= 0
    || (coupon.type === 'percent' && coupon.value > 100) || (coupon.type === 'fixed' && !Number.isSafeInteger(coupon.value))
    || !isValidDateStr(coupon.expiresAt) || (coupon.startDate != null && !isValidDateStr(coupon.startDate))) invalid();
  const minOrder = coupon.minOrder ?? 0;
  const maxDiscount = coupon.maxDiscount ?? 0;
  const usageLimit = coupon.usageLimit ?? 0;
  const usedCount = coupon.usedCount ?? 0;
  if (![minOrder, maxDiscount, usageLimit, usedCount].every((value) => Number.isSafeInteger(value) && value >= 0)
    || (coupon.startDate && coupon.startDate > coupon.expiresAt)) invalid();
  if (coupon.startDate && evaluatedDate < coupon.startDate) throw new AppError('PROMO_NOT_STARTED', 'Mã khuyến mãi chưa đến thời gian sử dụng.');
  if (evaluatedDate > coupon.expiresAt) throw new AppError('PROMO_EXPIRED', 'Mã khuyến mãi đã hết hạn.');
  if (usageLimit > 0 && usedCount >= usageLimit) throw new AppError('PROMO_LIMIT', 'Mã khuyến mãi đã hết lượt sử dụng.');
  if (originalPrice < minOrder) throw new AppError('PROMO_MIN', 'Giá dịch vụ chưa đạt giá trị tối thiểu để dùng mã.');
  const raw = coupon.type === 'percent' ? Math.floor(originalPrice * coupon.value / 100) : coupon.value;
  return Math.min(originalPrice, raw, maxDiscount > 0 ? maxDiscount : raw);
}

/** Pure quote: the caller supplies authoritative records, service date and evaluation time. */
export function calculatePrice({ service, duration, serviceDate, campaigns = [], promoCode = '', coupon = null, evaluatedAt } = {}) {
  if (!service || typeof service.id !== 'string' || !service.id.trim() || service.active === false) {
    throw new AppError('SERVICE_NOT_FOUND', 'Dịch vụ không tồn tại hoặc đã ngừng hoạt động.');
  }
  if (!isValidDateStr(serviceDate)) throw new AppError('INVALID_SERVICE_DATE', 'Cần ngày sử dụng dịch vụ hợp lệ để tính giá.');
  if (!isUtcTimestamp(evaluatedAt)) throw new AppError('INVALID_EVALUATION_TIME', 'Cần thời điểm đánh giá giá hợp lệ từ máy chủ.');
  if (!Number.isSafeInteger(duration) || duration < 15 || duration > 480 || duration % 5 !== 0) {
    throw new AppError('INVALID_DURATION', 'Mức thời lượng không hợp lệ.');
  }
  if (service.variants != null && !Array.isArray(service.variants)) throw new AppError('INVALID_PRICE', 'Danh sách mức giá không hợp lệ.');
  const variants = service.variants?.length ? service.variants : [{ duration: service.duration, price: service.price }];
  const matchedVariants = variants.filter((variant) => variant?.duration === duration);
  if (matchedVariants.length !== 1) throw new AppError('INVALID_DURATION', 'Dịch vụ không có một mức giá duy nhất cho thời lượng đã chọn.');
  const originalPrice = money(matchedVariants[0].price, 'niêm yết', false);
  if (!Array.isArray(campaigns)) throw new AppError('HOLIDAY_SALE_INVALID', 'Danh sách chiến dịch không hợp lệ.');
  if (typeof promoCode !== 'string') throw new AppError('PROMO_INVALID', 'Mã khuyến mãi phải là chuỗi ký tự.');
  const code = promoCode.trim().toUpperCase();
  const seen = new Set();
  const candidates = [];
  for (const input of campaigns) {
    const sale = normalizeHolidaySale(input);
    if (seen.has(sale.id)) throw new AppError('HOLIDAY_SALE_INVALID', 'Mã chiến dịch bị trùng trong nguồn dữ liệu.');
    seen.add(sale.id);
    if (!matches(sale, service, duration, serviceDate)) continue;
    const raw = sale.discountType === 'percent' ? Math.floor(originalPrice * sale.percentageBps / 10000) : sale.fixedAmountVnd;
    candidates.push({ sale, discountAmount: Math.min(originalPrice, raw, sale.maxDiscountVnd ?? raw) });
  }
  candidates.sort(compareCandidates);
  const winner = candidates[0];
  const sale = winner?.sale;
  const saleDiscountAmount = winner?.discountAmount || 0;
  const couponDiscountAmount = code
    ? couponDiscount(coupon, code, originalPrice, businessNow(new Date(evaluatedAt)).date)
    : 0;
  // A date campaign and one valid coupon stack against the published price.
  // The combined reduction is capped at the published price so the customer never gets a negative total.
  const discountAmount = Math.min(originalPrice, saleDiscountAmount + couponDiscountAmount);
  const couponApplied = Boolean(code && couponDiscountAmount > 0);
  return {
    pricingPolicyVersion: PRICING_POLICY_VERSION, serviceId: service.id, duration, serviceDate, evaluatedAt,
    originalPrice, discountAmount, finalPrice: originalPrice - discountAmount,
    discountSource: sale && couponApplied ? 'holiday_sale_and_coupon' : sale ? 'holiday_sale' : couponApplied ? 'coupon' : 'none',
    campaignId: sale?.id ?? null, campaignRevision: sale?.revision ?? null, campaignName: sale?.name ?? null,
    promoCode: couponApplied ? code : null, ignoredPromoCode: null,
    selectionReason: sale && couponApplied ? 'best_holiday_sale_plus_coupon'
      : sale ? 'holiday_sale_discount_scope_recency' : couponApplied ? 'requested_coupon' : 'list_price',
    discountDetails: sale || couponApplied ? {
      sale: sale ? {
        discountType: sale.discountType, percentageBps: sale.percentageBps, fixedAmountVnd: sale.fixedAmountVnd,
        discountAmount: saleDiscountAmount, maxDiscountVnd: sale.maxDiscountVnd, scopeType: sale.scopeType,
        targetCount: sale.targets.length, serviceDateFrom: sale.serviceDateFrom, serviceDateTo: sale.serviceDateTo,
        updatedAt: sale.updatedAt,
      } : null,
      coupon: couponApplied ? { code, type: coupon.type, value: coupon.value,
        discountAmount: couponDiscountAmount, maxDiscount: coupon.maxDiscount ?? 0 } : null,
      stacking: 'additive_on_list_price',
    } : null,
  };
}

/** Price changes describe a debt/refund due; they never create money movements. */
export function calculateRescheduleAdjustment({ oldFinalPrice, newFinalPrice, paymentRecords = [] } = {}) {
  money(oldFinalPrice, 'cũ');
  money(newFinalPrice, 'mới');
  if (!Array.isArray(paymentRecords)) throw new AppError('INVALID_PAYMENT_HISTORY', 'Lịch sử thanh toán không hợp lệ.');
  let collected = 0;
  let refunded = 0;
  for (const record of paymentRecords) {
    if (!record || !['deposit', 'payment', 'refund'].includes(record.type) || !Number.isSafeInteger(record.amount) || record.amount <= 0) {
      throw new AppError('INVALID_PAYMENT_HISTORY', 'Giao dịch thanh toán không hợp lệ.');
    }
    if (record.type === 'refund') refunded += record.amount;
    else if (record.refundable !== false) collected += record.amount;
    if (!Number.isSafeInteger(collected) || !Number.isSafeInteger(refunded)) throw new AppError('INVALID_PAYMENT_HISTORY', 'Tổng giao dịch vượt giới hạn tính toán.');
  }
  if (refunded > collected) throw new AppError('INVALID_PAYMENT_HISTORY', 'Tổng hoàn tiền vượt số tiền đã thu.');
  const netPaid = collected - refunded;
  return {
    oldFinalPrice, newFinalPrice, priceDelta: newFinalPrice - oldFinalPrice, collected, refunded, netPaid,
    amountDue: Math.max(0, newFinalPrice - netPaid), refundDue: Math.max(0, netPaid - newFinalPrice),
  };
}
