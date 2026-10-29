/** Display-only therapy taxonomy. Operational service categories remain unchanged for staff matching. */
export const THERAPY_GROUPS = Object.freeze([
  {
    id: 'body-massage',
    name: 'Massage toàn thân',
    englishName: 'Body Massage',
    examples: ['Massage thư giãn toàn thân', 'Massage tinh dầu Aroma', 'Massage đá nóng', 'Massage Thái', 'Massage mô sâu (Deep Tissue)'],
  },
  {
    id: 'neck-shoulder',
    name: 'Massage cổ – vai – gáy',
    englishName: 'Neck, Shoulder & Nape Massage',
    examples: ['Massage cổ vai gáy thư giãn', 'Massage cổ vai gáy kết hợp tinh dầu', 'Massage cổ vai gáy kết hợp chườm ấm'],
  },
  {
    id: 'foot-massage',
    name: 'Massage chân',
    englishName: 'Foot Massage',
    examples: ['Massage chân thư giãn', 'Massage chân kết hợp ngâm thảo dược', 'Massage bấm huyệt bàn chân'],
  },
  {
    id: 'head-face',
    name: 'Massage đầu – mặt',
    englishName: 'Head & Face',
    examples: ['Massage đầu thư giãn', 'Massage mặt', 'Massage đầu kết hợp gội đầu dưỡng sinh'],
  },
  {
    id: 'special-combo',
    name: 'Combo Massage & Liệu trình đặc biệt',
    englishName: 'Massage Combos & Special Treatments',
    examples: ['Combo massage toàn thân + chân', 'Combo massage cổ vai gáy + đầu', 'Liệu trình thư giãn 90–120 phút', 'Massage dành cho cặp đôi'],
  },
]);

const GROUP_IDS = new Set(THERAPY_GROUPS.map((group) => group.id));

// Default display groups for the existing demo catalog. Unknown services are left unassigned
// until an admin chooses a group; their operational category is never used as a substitute.
const LEGACY_SERVICE_GROUPS = Object.freeze({
  'signature-body': 'body-massage',
  'aroma-therapy': 'body-massage',
  'hot-stone': 'body-massage',
  'shiatsu-massage': 'body-massage',
  'thai-massage': 'body-massage',
  'four-hands': 'special-combo',
  'foot-head-neck': 'special-combo',
  'foot-back-neck': 'special-combo',
  'belly-massage': 'special-combo',
  'herbal-hair-wash': 'head-face',
  'cupping-aroma': 'special-combo',
  'body-scrub-bath': 'special-combo',
  'facial-dermalogica': 'head-face',
});

export function isTherapyGroupId(value) {
  return GROUP_IDS.has(value);
}

export function getTherapyGroupId(service) {
  if (!service || service.kind === 'package' || service.category === 'packages') return null;
  if (isTherapyGroupId(service.therapyGroup)) return service.therapyGroup;
  return LEGACY_SERVICE_GROUPS[service.id] || null;
}

export function getTherapyGroup(serviceOrId) {
  const id = typeof serviceOrId === 'string' ? serviceOrId : getTherapyGroupId(serviceOrId);
  return THERAPY_GROUPS.find((group) => group.id === id) || null;
}

export function getTherapyGroupName(serviceOrId) {
  return getTherapyGroup(serviceOrId)?.name || '';
}

