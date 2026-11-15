export const STAFF_ROLES = Object.freeze({
  specialist: Object.freeze({
    label: 'Chuyên viên',
    permissions: Object.freeze([
      'booking.read_assigned',
      'booking.confirm_assigned',
      'booking.decline_assigned',
      'day_off.request_self',
      'profile.read_self',
      'profile.update_self',
    ]),
  }),
  senior_specialist: Object.freeze({
    label: 'Chuyên viên cấp cao',
    permissions: Object.freeze([
      'booking.read_assigned',
      'booking.confirm_assigned',
      'booking.decline_assigned',
      'booking.checkin_assigned',
      'booking.complete_assigned',
      'booking.no_show_assigned',
      'day_off.request_self',
      'profile.read_self',
      'profile.update_self',
    ]),
  }),
});

export function normalizeStaffRole(role) {
  return Object.hasOwn(STAFF_ROLES, role) ? role : 'specialist';
}

export function staffRoleDetails(role) {
  const normalized = normalizeStaffRole(role);
  return { id: normalized, ...STAFF_ROLES[normalized], permissions: [...STAFF_ROLES[normalized].permissions] };
}

export function permissionsForActor(actor, staffRole = 'specialist') {
  if (actor?.role === 'admin') return ['*'];
  if (actor?.role !== 'staff') return [];
  return [...STAFF_ROLES[normalizeStaffRole(staffRole)].permissions];
}

export function hasPermission(actor, permission, staffRole = 'specialist') {
  const permissions = permissionsForActor(actor, staffRole);
  return permissions.includes('*') || permissions.includes(permission);
}
