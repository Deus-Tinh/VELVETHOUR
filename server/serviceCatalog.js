import { SERVICE_CATALOG_PAGE_SIZE } from '../assets/js/core/constants.js';
import { normalizeText } from '../assets/js/core/utils.js';
import { getServiceKind, isServiceBookable, normalizeServiceRecord } from '../assets/js/domain/serviceCatalogModel.js';
import { getTherapyGroupId, isTherapyGroupId } from '../assets/js/domain/therapyGroupModel.js';
import { calculatePrice } from '../assets/js/domain/pricingService.js';
import { businessNow, isValidDateStr } from '../assets/js/core/utils.js';

export class ServiceCatalogQueryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ServiceCatalogQueryError';
    this.code = 'CATALOG_QUERY_INVALID';
  }
}

/** Public catalog query: active records only, filtered and sorted before server-side pagination. */
export function queryPublicServiceCatalog({ searchParams, services, categories, campaigns = [], evaluatedAt = new Date().toISOString() }) {
  const invalidQuery = (message) => { throw new ServiceCatalogQueryError(message); };
  const serviceDate = searchParams.get('serviceDate') || businessNow(new Date(evaluatedAt)).date;
  if (!isValidDateStr(serviceDate)) invalidQuery('Ngày sử dụng dịch vụ không hợp lệ.');
  const positiveInteger = (name, fallback, max = Number.MAX_SAFE_INTEGER) => {
    const raw = searchParams.get(name);
    if (raw == null || raw === '') return fallback;
    if (!/^\d+$/.test(raw)) invalidQuery(`Tham số ${name} phải là số nguyên dương.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) invalidQuery(`Tham số ${name} phải là số nguyên dương.`);
    return Math.min(value, max);
  };
  const optionalPrice = (name) => {
    const raw = searchParams.get(name);
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) invalidQuery(`Tham số ${name} phải là số VND không âm.`);
    return value;
  };

  const rawQuery = searchParams.get('q') || '';
  if (rawQuery.length > 120) invalidQuery('Từ khóa tìm kiếm tối đa 120 ký tự.');
  const needle = normalizeText(rawQuery);
  const category = searchParams.get('category') || 'all';
  if (category.length > 80) invalidQuery('Danh mục không hợp lệ.');
  const kind = searchParams.get('kind') || 'all';
  if (!['all', 'therapy', 'package'].includes(kind)) invalidQuery('Loại dịch vụ không hợp lệ.');
  const therapyGroup = searchParams.get('therapyGroup') || 'all';
  if (therapyGroup !== 'all' && !isTherapyGroupId(therapyGroup)) invalidQuery('Nhóm liệu trình không hợp lệ.');
  const minPrice = optionalPrice('minPrice');
  const maxPrice = optionalPrice('maxPrice');
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) invalidQuery('Khoảng giá không hợp lệ.');

  const duration = searchParams.get('duration') || 'all';
  if (!['all', 'lt60', '60-90', 'gt90'].includes(duration)) invalidQuery('Bộ lọc thời lượng không hợp lệ.');
  const sort = searchParams.get('sort') || 'featured';
  const sorters = {
    'price-asc': (a, b) => (a.displayPrice ?? a.price) - (b.displayPrice ?? b.price),
    'price-desc': (a, b) => (b.displayPrice ?? b.price) - (a.displayPrice ?? a.price),
    'name-asc': (a, b) => a.name.localeCompare(b.name, 'vi'),
    'name-desc': (a, b) => b.name.localeCompare(a.name, 'vi'),
    newest: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    oldest: (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
    'rating-desc': (a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0),
  };
  if (sort !== 'featured' && !sorters[sort]) invalidQuery('Kiểu sắp xếp không hợp lệ.');

  const page = positiveInteger('page', 1, 1_000_000);
  const pageSize = positiveInteger('pageSize', SERVICE_CATALOG_PAGE_SIZE, SERVICE_CATALOG_PAGE_SIZE);
  const durationMatches = (minutes) => duration === 'all'
    || (duration === 'lt60' && minutes < 60)
    || (duration === '60-90' && minutes >= 60 && minutes <= 90)
    || (duration === 'gt90' && minutes > 90);
  const normalizedServices = services.map(normalizeServiceRecord);
  const serviceById = new Map(normalizedServices.map((service) => [service.id, service]));
  const filtered = normalizedServices
    .filter((service) => isServiceBookable(service, serviceById))
    .map((service) => {
      if (!campaigns.length) return service;
      const salePricing = calculatePrice({ service, duration: service.duration, serviceDate, campaigns, evaluatedAt });
      return { ...service, displayPrice: salePricing.finalPrice, salePricing };
    })
    .filter((service) => kind === 'all' || getServiceKind(service) === kind)
    .filter((service) => therapyGroup === 'all' || getTherapyGroupId(service) === therapyGroup)
    .filter((service) => category === 'all' || service.category === category)
    .filter((service) => !needle || normalizeText(`${service.name} ${service.shortDesc}`).includes(needle))
    .filter((service) => (minPrice == null || (service.displayPrice ?? service.price) >= minPrice) && (maxPrice == null || (service.displayPrice ?? service.price) <= maxPrice))
    .filter((service) => durationMatches(service.duration));
  const sorted = sorters[sort] ? filtered.sort(sorters[sort]) : filtered;
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const categoryNames = new Map(categories.map((item) => [item.id, item.name]));
  const items = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    .map((service) => ({ ...service, categoryName: categoryNames.get(service.category) || service.category }));
  return { items, total, page: currentPage, pageSize, totalPages };
}
