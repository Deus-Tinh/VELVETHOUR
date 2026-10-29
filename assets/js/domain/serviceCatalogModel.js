import { getTherapyGroupId } from './therapyGroupModel.js';

export const PACKAGE_CATEGORY_ID = 'packages';

const LEGACY_PACKAGE_COMPONENTS = Object.freeze({
  'melt-away-journey': ['foot-head-neck', 'hot-stone', 'herbal-hair-wash'],
  'ultimate-relax': ['body-scrub-bath', 'four-hands', 'facial-dermalogica'],
  'luxe-escape': ['hot-stone', 'foot-head-neck', 'herbal-hair-wash'],
});

export function getServiceKind(service) {
  return service?.kind === 'package' || service?.category === PACKAGE_CATEGORY_ID ? 'package' : 'therapy';
}

export function getPackageComponentIds(service) {
  if (!service || getServiceKind(service) !== 'package') return [];
  const source = Array.isArray(service.components) ? service.components : LEGACY_PACKAGE_COMPONENTS[service.id] || [];
  const ids = source.map((component) => typeof component === 'string' ? component : component?.serviceId)
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim());
  return [...new Set(ids)];
}

export function normalizeServiceRecord(service) {
  if (!service || typeof service !== 'object') return service;
  const kind = getServiceKind(service);
  return kind === 'package'
    ? { ...service, kind, category: PACKAGE_CATEGORY_ID, components: getPackageComponentIds(service) }
    : { ...service, kind, ...(getTherapyGroupId(service) ? { therapyGroup: getTherapyGroupId(service) } : {}) };
}

export function getPackageComponents(service, services) {
  if (getServiceKind(service) !== 'package') return [];
  const ids = getPackageComponentIds(service);
  if (!ids.length) return [];
  const records = services instanceof Map ? services : new Map((services || []).map((item) => [item.id, item]));
  return ids.map((id) => records.get(id)).filter((item) => item && getServiceKind(item) === 'therapy');
}

export function isServiceBookable(service, services) {
  if (!service || service.active === false) return false;
  if (getServiceKind(service) !== 'package') return true;
  const ids = getPackageComponentIds(service);
  if (!ids.length) return false;
  const records = services instanceof Map ? services : new Map((services || []).map((item) => [item.id, item]));
  return ids.every((id) => {
    const component = records.get(id);
    return component && getServiceKind(component) === 'therapy' && component.active !== false;
  });
}
