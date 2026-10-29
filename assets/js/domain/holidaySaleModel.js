import { AppError } from '../core/errors.js';
import { isValidDateStr } from '../core/utils.js';

export const SALE_SCOPE_RANK = Object.freeze({ all: 0, category: 1, service: 2, service_variant: 3 });
export const MAX_PRICE_VND = 100000000;

function invalid(field, message) {
  throw new AppError('HOLIDAY_SALE_INVALID', message, { [field]: message });
}

function text(value, field, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    invalid(field, `Trường ${field} không hợp lệ.`);
  }
  return value.trim();
}

export function isUtcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

/** Canonical campaign data shared by persistence, pricing and future admin tools. */
export function normalizeHolidaySale(input, { services, categories } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('campaign', 'Chiến dịch sale không hợp lệ.');
  const id = text(input.id, 'id', 120);
  const name = text(input.name, 'name', 160);
  const occasion = text(input.occasion ?? '', 'occasion', 160, true);
  if (!isValidDateStr(input.serviceDateFrom) || !isValidDateStr(input.serviceDateTo) || input.serviceDateFrom > input.serviceDateTo) {
    invalid('serviceDate', 'Khoảng ngày sử dụng dịch vụ không hợp lệ.');
  }
  if (typeof input.enabled !== 'boolean') invalid('enabled', 'Trạng thái sale phải là bật hoặc tắt.');
  if (!Object.hasOwn(SALE_SCOPE_RANK, input.scopeType)) invalid('scopeType', 'Phạm vi sale không hợp lệ.');
  if (!['percent', 'fixed'].includes(input.discountType)) invalid('discountType', 'Loại giảm giá không hợp lệ.');
  const percentageBps = input.percentageBps ?? null;
  const fixedAmountVnd = input.fixedAmountVnd ?? null;
  const maxDiscountVnd = input.maxDiscountVnd ?? null;
  if (input.discountType === 'percent') {
    if (!Number.isSafeInteger(percentageBps) || percentageBps < 1 || percentageBps > 10000 || fixedAmountVnd !== null) {
      invalid('percentageBps', 'Phần trăm sale phải từ 0,01% đến 100%.');
    }
  } else if (!Number.isSafeInteger(fixedAmountVnd) || fixedAmountVnd < 1 || fixedAmountVnd > MAX_PRICE_VND || percentageBps !== null) {
    invalid('fixedAmountVnd', 'Mức giảm phải là số nguyên VND hợp lệ.');
  }
  if (maxDiscountVnd !== null && (!Number.isSafeInteger(maxDiscountVnd) || maxDiscountVnd < 1 || maxDiscountVnd > MAX_PRICE_VND)) {
    invalid('maxDiscountVnd', 'Trần giảm phải là số nguyên VND dương hoặc để trống.');
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) invalid('revision', 'Phiên bản chiến dịch không hợp lệ.');
  if (!isUtcTimestamp(input.createdAt) || !isUtcTimestamp(input.updatedAt) || input.updatedAt < input.createdAt) {
    invalid('updatedAt', 'Thời điểm tạo/cập nhật chiến dịch không hợp lệ.');
  }
  if (!Array.isArray(input.targets) || input.targets.length > 1000 || (input.scopeType === 'all') !== (input.targets.length === 0)) {
    invalid('targets', 'Danh sách đối tượng áp dụng không phù hợp với phạm vi sale.');
  }
  const seen = new Set();
  const targets = input.targets.map((target) => {
    if (!target || typeof target !== 'object' || Array.isArray(target)) invalid('targets', 'Đối tượng áp dụng không hợp lệ.');
    const targetId = text(target.targetId, 'targetId', 120);
    const durationMinutes = target.durationMinutes ?? 0;
    if (input.scopeType === 'service_variant') {
      if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480 || durationMinutes % 5 !== 0) {
        invalid('targets', 'Mức thời lượng áp dụng sale không hợp lệ.');
      }
    } else if (durationMinutes !== 0) invalid('targets', 'Chỉ phạm vi dịch vụ và thời lượng mới được giới hạn thời lượng.');
    const key = JSON.stringify([targetId, durationMinutes]);
    if (seen.has(key)) invalid('targets', 'Đối tượng áp dụng sale bị trùng.');
    seen.add(key);
    if (input.scopeType === 'category' && categories && !categories.some((category) => category.id === targetId)) {
      invalid('targets', 'Danh mục áp dụng sale không tồn tại.');
    }
    if (input.scopeType !== 'category' && services) {
      const service = services.find((row) => row.id === targetId);
      if (!service) invalid('targets', 'Dịch vụ áp dụng sale không tồn tại.');
      if (input.scopeType === 'service_variant') {
        const variants = service.variants?.length ? service.variants : [{ duration: service.duration }];
        if (!variants.some((variant) => variant.duration === durationMinutes)) invalid('targets', 'Dịch vụ không có mức thời lượng được chọn.');
      }
    }
    return { targetId, durationMinutes };
  });
  targets.sort((left, right) => left.targetId < right.targetId ? -1 : left.targetId > right.targetId ? 1 : left.durationMinutes - right.durationMinutes);
  return {
    id, name, occasion, serviceDateFrom: input.serviceDateFrom, serviceDateTo: input.serviceDateTo,
    enabled: input.enabled, discountType: input.discountType, percentageBps, fixedAmountVnd, maxDiscountVnd,
    scopeType: input.scopeType, targets, revision: input.revision, createdAt: input.createdAt, updatedAt: input.updatedAt,
  };
}
