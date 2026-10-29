/**
 * Repositories — một repository cho mỗi collection (nguồn dữ liệu duy nhất).
 * Mỗi repo có: getAll / getById / findBy / count / create / update / remove / replaceAll.
 * `validate` = kiểm tra schema tối thiểu; bản ghi sai schema bị loại khi đọc.
 */
import { createRepository } from '../core/storage.js';

const str = (v) => typeof v === 'string' && v.length > 0;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

export const userRepo = createRepository('users', {
  idPrefix: 'usr',
  validate: (r) => str(r.id) && str(r.email) && ['customer', 'staff', 'admin'].includes(r.role),
});
export const categoryRepo = createRepository('categories', { idPrefix: 'cat', validate: (r) => str(r.id) && str(r.name) });
export const serviceRepo = createRepository('services', {
  idPrefix: 'svc',
  validate: (r) => str(r.id) && str(r.name) && str(r.category) && num(r.price) && num(r.duration),
});
export const staffRepo = createRepository('staff', { idPrefix: 'st', validate: (r) => str(r.id) && str(r.name) });
export const bookingRepo = createRepository('bookings', {
  idPrefix: 'bk',
  validate: (r) => str(r.id) && str(r.code) && str(r.serviceId) && str(r.date) && str(r.startTime) && str(r.status),
});
export const promotionRepo = createRepository('promotions', { idPrefix: 'pro', validate: (r) => str(r.id) && str(r.code) });
export const reviewRepo = createRepository('reviews', { idPrefix: 'rev', validate: (r) => str(r.id) && str(r.serviceId) && num(r.rating) });
export const favoriteRepo = createRepository('favorites', { idPrefix: 'fav', validate: (r) => str(r.id) && str(r.userId) && str(r.serviceId) });
export const contactRepo = createRepository('contacts', { idPrefix: 'ct', validate: (r) => str(r.id) && str(r.message) });
export const settingsRepo = createRepository('settings', { idPrefix: 'set', validate: (r) => str(r.id) });

export const repos = {
  users: userRepo, categories: categoryRepo, services: serviceRepo, staff: staffRepo, bookings: bookingRepo,
  promotions: promotionRepo, reviews: reviewRepo, favorites: favoriteRepo, contacts: contactRepo, settings: settingsRepo,
};
