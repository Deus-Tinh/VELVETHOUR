/**
 * Dịch vụ & danh mục: CRUD + tìm kiếm / lọc / sắp xếp / phân trang (dùng Array methods).
 * Quy tắc xóa: nếu dịch vụ đã có booking (lịch sử) → chỉ ngừng hoạt động (soft delete), không phá booking cũ.
 */
import { serviceRepo, categoryRepo, bookingRepo, favoriteRepo } from '../data/repositories.js';
import { AppError } from '../core/errors.js';
import { validate, schemas, required, minLength, maxLength } from '../core/validators.js';
import { normalizeText } from '../core/utils.js';
import { SERVICE_CATALOG_PAGE_SIZE } from '../core/constants.js';
import { authService } from './authService.js';
import {
  getPackageComponentIds, getPackageComponents, getServiceKind, isServiceBookable,
  normalizeServiceRecord, PACKAGE_CATEGORY_ID,
} from '../domain/serviceCatalogModel.js';
import { getTherapyGroupId, isTherapyGroupId } from '../domain/therapyGroupModel.js';

function requireAdmin() {
  if (authService.getCurrentUser()?.role !== 'admin') throw new AppError('UNAUTHORIZED', 'Chỉ quản trị viên mới được quản lý dịch vụ và danh mục.');
}

const slugify = (s) => normalizeText(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const enrich = (s, cats) => normalizeServiceRecord({
  ...s,
  categoryName: cats.find((c) => c.id === s.category)?.name || s.category,
});

export const categoryService = {
  list: () => categoryRepo.getAll(),
  listActive: () => categoryRepo.findBy((c) => c.active !== false),
  get: (id) => categoryRepo.getById(id),
  create({ name }) {
    requireAdmin();
    const { valid, errors } = validate({ name }, { name: [required('Vui lòng nhập tên danh mục'), minLength(2), maxLength(40)] });
    if (!valid) throw new AppError('VALIDATION', 'Dữ liệu danh mục không hợp lệ', errors);
    const id = slugify(name);
    if (!id || categoryRepo.getById(id) || categoryRepo.findBy((c) => normalizeText(c.name) === normalizeText(name)).length) {
      throw new AppError('DUPLICATE', 'Danh mục đã tồn tại.', { name: 'Tên danh mục bị trùng' });
    }
    return categoryRepo.create({ id, name: name.trim(), active: true });
  },
  update(id, { name, active }) {
    requireAdmin();
    if (!categoryRepo.getById(id)) throw new AppError('NOT_FOUND', 'Không tìm thấy danh mục.');
    const patch = {};
    if (name !== undefined) {
      const { valid, errors } = validate({ name }, { name: [required('Vui lòng nhập tên danh mục'), minLength(2), maxLength(40)] });
      if (!valid) throw new AppError('VALIDATION', 'Dữ liệu danh mục không hợp lệ', errors);
      if (categoryRepo.findBy((c) => c.id !== id && normalizeText(c.name) === normalizeText(name)).length) {
        throw new AppError('DUPLICATE', 'Danh mục đã tồn tại.', { name: 'Tên danh mục bị trùng' });
      }
      patch.name = name.trim();
    }
    if (active !== undefined) {
      if (id === PACKAGE_CATEGORY_ID && !active) throw new AppError('VALIDATION', 'Danh mục hệ thống của gói trị liệu không thể tạm ẩn.');
      patch.active = !!active;
    }
    return categoryRepo.update(id, patch);
  },
  /** Có dịch vụ thuộc danh mục → ngừng hoạt động; ngược lại xóa hẳn. */
  remove(id) {
    requireAdmin();
    if (!categoryRepo.getById(id)) throw new AppError('NOT_FOUND', 'Không tìm thấy danh mục.');
    if (id === PACKAGE_CATEGORY_ID) throw new AppError('VALIDATION', 'Danh mục hệ thống của gói trị liệu không thể xóa hoặc tạm ẩn.');
    if (serviceRepo.findBy((s) => s.category === id).length) {
      categoryRepo.update(id, { active: false });
      return { mode: 'deactivated' };
    }
    categoryRepo.remove(id);
    return { mode: 'deleted' };
  },
};

function checkServiceInput(data, existingId = null) {
  const kind = getServiceKind(data);
  const categoryId = kind === 'package' ? PACKAGE_CATEGORY_ID : data.category;
  if (kind === 'therapy' && data.therapyGroup != null && !isTherapyGroupId(data.therapyGroup)) {
    throw new AppError('VALIDATION', 'Nhóm liệu trình không hợp lệ.', { therapyGroup: 'Chọn một nhóm có sẵn' });
  }
  const therapyGroup = kind === 'therapy' ? getTherapyGroupId({ ...data, category: categoryId }) : null;
  const validatedData = { ...data, category: categoryId };
  const { valid, errors } = validate(validatedData, schemas.service);
  if (!valid) throw new AppError('VALIDATION', 'Vui lòng kiểm tra lại thông tin dịch vụ.', errors);
  const category = categoryRepo.getById(categoryId);
  if (!category || (category.active === false && categoryId !== PACKAGE_CATEGORY_ID)) {
    throw new AppError('VALIDATION', 'Danh mục không tồn tại hoặc đã tạm ẩn.', { category: 'Danh mục không khả dụng' });
  }
  const dup = serviceRepo.findBy((s) => normalizeText(s.name) === normalizeText(data.name) && s.id !== existingId);
  if (dup.length) throw new AppError('VALIDATION', 'Tên dịch vụ đã tồn tại.', { name: 'Tên dịch vụ bị trùng' });

  const variantDurations = new Set();
  for (const variant of Array.isArray(data.variants) ? data.variants : []) {
    const result = validate({ duration: variant?.duration, price: variant?.price }, {
      duration: schemas.service.duration,
      price: schemas.service.price,
    });
    if (!result.valid) throw new AppError('VALIDATION', 'Một mức giá hoặc thời lượng không hợp lệ.', result.errors);
    const duration = Number(variant.duration);
    if (variantDurations.has(duration)) throw new AppError('VALIDATION', 'Không thể khai báo trùng mức thời lượng.', { variants: 'Thời lượng bị trùng' });
    variantDurations.add(duration);
  }

  let componentIds = [];
  if (kind === 'package') {
    componentIds = getPackageComponentIds({ ...data, kind, category: categoryId });
    const therapies = serviceRepo.getAll().filter((service) => service.id !== existingId && getServiceKind(service) === 'therapy');
    const byId = new Map(therapies.map((service) => [service.id, service]));
    if (!componentIds.length) {
      throw new AppError('VALIDATION', 'Gói trị liệu cần có ít nhất một liệu trình thành phần.', { components: 'Chọn ít nhất một liệu trình' });
    }
    const unavailable = componentIds.find((id) => !byId.has(id) || byId.get(id).active === false);
    if (unavailable) {
      throw new AppError('VALIDATION', 'Một hoặc nhiều liệu trình thành phần không còn hoạt động.', { components: 'Chỉ chọn liệu trình đang hoạt động' });
    }
  }
  return { kind, categoryId, componentIds, therapyGroup };
}

function normalizeVariants(data) {
  const base = { duration: Number(data.duration), price: Number(data.price) };
  const given = Array.isArray(data.variants) ? data.variants : [];
  const merged = [...given.map((v) => ({ duration: Number(v.duration), price: Number(v.price) })), base];
  const unique = merged.filter((v, i, arr) => arr.findIndex((x) => x.duration === v.duration) === i);
  return unique.sort((a, b) => a.duration - b.duration);
}

export const serviceService = {
  list() { const cats = categoryRepo.getAll(); return serviceRepo.getAll().map((s) => enrich(s, cats)); },
  listActive() {
    const services = this.list();
    const byId = new Map(services.map((service) => [service.id, service]));
    return services.filter((service) => isServiceBookable(service, byId));
  },
  listTherapies({ activeOnly = false } = {}) {
    const services = activeOnly ? this.listActive() : this.list();
    return services.filter((service) => getServiceKind(service) === 'therapy');
  },
  listPackages({ activeOnly = false } = {}) {
    const services = activeOnly ? this.listActive() : this.list();
    return services.filter((service) => getServiceKind(service) === 'package');
  },
  componentServices(service, catalog = null) { return getPackageComponents(service, catalog || this.list()); },
  get(id) { const s = serviceRepo.getById(id); return s ? enrich(s, categoryRepo.getAll()) : null; },
  byCategory(category) { return this.listActive().filter((s) => s.category === category); },

  create(data) {
    requireAdmin();
    const { kind, categoryId, componentIds, therapyGroup } = checkServiceInput(data);
    let id = slugify(data.name), n = 2;
    while (serviceRepo.getById(id)) id = `${slugify(data.name)}-${n++}`;
    const record = {
      id, name: data.name.trim(), kind, category: categoryId, imageId: data.imageId || (kind === 'package' ? 'pkg-01' : 'massage-01'),
      ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
      duration: Number(data.duration), price: Number(data.price), rating: 0, reviewsCount: 0,
      shortDesc: data.shortDesc.trim(), fullDesc: (data.fullDesc || data.shortDesc).trim(),
      benefits: Array.isArray(data.benefits) ? data.benefits.filter(Boolean) : [],
      variants: normalizeVariants(data), active: data.active !== false,
      ...(kind === 'package' ? { components: componentIds } : {}),
      ...(therapyGroup ? { therapyGroup } : {}),
    };
    return enrich(serviceRepo.create(record), categoryRepo.getAll());
  },

  /** Sửa giá chỉ ảnh hưởng booking MỚI: booking cũ giữ snapshot giá trong chính bản ghi booking. */
  update(id, data) {
    requireAdmin();
    const current = serviceRepo.getById(id);
    if (!current) throw new AppError('NOT_FOUND', 'Không tìm thấy dịch vụ.');
    const merged = { ...current, ...data };
    const { kind, categoryId, componentIds, therapyGroup } = checkServiceInput(merged, id);
    const patch = {
      name: merged.name.trim(), kind, category: categoryId, imageId: merged.imageId,
      ...(merged.imageUrl ? { imageUrl: merged.imageUrl } : {}),
      duration: Number(merged.duration), price: Number(merged.price),
      shortDesc: merged.shortDesc.trim(), fullDesc: (merged.fullDesc || merged.shortDesc).trim(),
      benefits: merged.benefits, active: merged.active !== false,
      variants: normalizeVariants({ ...merged, variants: data.variants ?? current.variants }),
      ...(kind === 'package' ? { components: componentIds } : {}),
      ...(therapyGroup ? { therapyGroup } : {}),
    };
    // Giữ giá biến thể mặc định đồng bộ với giá chính.
    patch.variants = patch.variants.map((v) => (v.duration === patch.duration ? { ...v, price: patch.price } : v));
    return enrich(serviceRepo.update(id, patch), categoryRepo.getAll());
  },

  setActive(id, active) {
    requireAdmin();
    const service = serviceRepo.getById(id);
    if (!service) throw new AppError('NOT_FOUND', 'Không tìm thấy dịch vụ.');
    if (active && !isServiceBookable({ ...service, active: true }, serviceRepo.getAll())) {
      throw new AppError('VALIDATION', 'Không thể bật gói khi liệu trình thành phần chưa hoạt động.');
    }
    return serviceRepo.update(id, { active: !!active });
  },

  /** @returns {{mode:'deleted'|'deactivated'}} */
  remove(id) {
    requireAdmin();
    const target = serviceRepo.getById(id);
    if (!target) throw new AppError('NOT_FOUND', 'Không tìm thấy dịch vụ.');
    const allServices = serviceRepo.getAll();
    const packagesUsingTherapy = getServiceKind(target) === 'therapy'
      ? allServices.filter((service) => getServiceKind(service) === 'package' && getPackageComponentIds(service).includes(id))
      : [];
    if (bookingRepo.findBy((b) => b.serviceId === id).length || packagesUsingTherapy.length) {
      const updatedAt = new Date().toISOString();
      const packageIds = new Set(packagesUsingTherapy.map((service) => service.id));
      const nextServices = allServices.map((service) => (
        service.id === id || packageIds.has(service.id)
          ? { ...service, active: false, updatedAt }
          : service
      ));
      serviceRepo.replaceAll(nextServices);
      if (packagesUsingTherapy.length) return { mode: 'deactivated', packagesDeactivated: packagesUsingTherapy.filter((service) => service.active !== false).length };
      return { mode: 'deactivated' };
    }
    serviceRepo.remove(id);
    favoriteRepo.findBy((f) => f.serviceId === id).forEach((f) => favoriteRepo.remove(f.id));
    return { mode: 'deleted' };
  },

  /**
   * Truy vấn danh sách: search → filter → sort → paginate.
   * @param {{q?:string,category?:string,status?:'all'|'active'|'inactive',minPrice?:number|string,maxPrice?:number|string,
   *          duration?:'all'|'lt60'|'60-90'|'gt90',sort?:string,page?:number,pageSize?:number}} opts
   */
  query(opts = {}) {
    const { q = '', category = 'all', kind = 'all', therapyGroup = 'all', status = 'active', minPrice = '', maxPrice = '', duration = 'all', sort = 'featured', page = 1, pageSize = SERVICE_CATALOG_PAGE_SIZE } = opts;
    const needle = normalizeText(q);
    const min = minPrice === '' || minPrice == null ? null : Number(minPrice);
    const max = maxPrice === '' || maxPrice == null ? null : Number(maxPrice);
    const durationOk = (d) => duration === 'all' || (duration === 'lt60' && d < 60) || (duration === '60-90' && d >= 60 && d <= 90) || (duration === 'gt90' && d > 90);

    const all = this.list();
    const byId = new Map(all.map((service) => [service.id, service]));
    const filtered = all
      .filter((s) => kind === 'all' || getServiceKind(s) === kind)
      .filter((s) => therapyGroup === 'all' || getTherapyGroupId(s) === therapyGroup)
      .filter((s) => !needle || normalizeText(`${s.name} ${s.shortDesc}`).includes(needle))
      .filter((s) => category === 'all' || s.category === category)
      .filter((s) => status === 'all' || (status === 'active' ? s.active !== false : s.active === false))
      .filter((s) => status !== 'active' || isServiceBookable(s, byId))
      .filter((s) => (min == null || s.price >= min) && (max == null || s.price <= max))
      .filter((s) => durationOk(s.duration));

    const byName = (a, b) => a.name.localeCompare(b.name, 'vi');
    const sorters = {
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      'name-asc': byName,
      'name-desc': (a, b) => byName(b, a),
      newest: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
      oldest: (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)),
      'rating-desc': (a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0),
    };
    const sorted = sorters[sort] ? [...filtered].sort(sorters[sort]) : filtered;
    return paginate(sorted, page, pageSize);
  },
};

/** Phân trang thuần: trả về { items, total, page, pageSize, totalPages }. */
export function paginate(list, page = 1, pageSize = SERVICE_CATALOG_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const current = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (current - 1) * pageSize;
  return { items: list.slice(start, start + pageSize), total: list.length, page: current, pageSize, totalPages };
}
