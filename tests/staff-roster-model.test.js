import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAFF_ROSTER_FORMAT, STAFF_ROSTER_VERSION, STAFF_ROSTER_MAX_FILE_BYTES,
  STAFF_ROSTER_MAX_RECORDS, STAFF_COLLECTION_MAX_RECORDS,
  StaffRosterError, buildStaffRosterExport, parseStaffRosterFile,
  planStaffRosterImport, applyStaffRosterPlan, staffRosterPlanSignature,
  staffRosterRecordMatches, staffRosterRecordSnapshotMatches, attachStaffRosterImageErrors,
} from '../assets/js/domain/staffRosterModel.js';

const categoryIds = new Set(['body-massages']);
const now = '2026-11-12T00:00:00.000Z';

function staff(id = 'st-01', patch = {}) {
  return {
    id, name: 'Nguyễn Minh An', title: 'Chuyên viên trị liệu',
    imageId: 'staff-01', specialties: ['body-massages'],
    workingDays: [1, 2, 3, 4, 5], shiftStart: '09:00', shiftEnd: '18:00',
    daysOff: [], breaks: [{ startTime: '12:00', endTime: '13:00' }],
    active: true, createdAt: now, updatedAt: now,
    ...patch,
  };
}

function fileText(records, patch = {}) {
  return JSON.stringify({
    format: STAFF_ROSTER_FORMAT, version: STAFF_ROSTER_VERSION, kind: 'staff-only',
    exportedAt: now, source: 'https://source.example', count: records.length, staff: records,
    ...patch,
  });
}

function parse(records, patch) {
  return parseStaffRosterFile(fileText(records, patch), { categoryIds });
}

test('valid roster exports and imports without creating phantom changes', () => {
  const exported = buildStaffRosterExport([staff()], { source: 'https://source.example', exportedAt: now });
  const parsed = parseStaffRosterFile(JSON.stringify(exported), { categoryIds });
  const plan = planStaffRosterImport(parsed, [staff()]);
  assert.equal(parsed.valid.length, 1);
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.creates.length + plan.updates.length, 0);
  assert.equal(staffRosterRecordMatches(staff(), parsed.valid[0].record), true);
});

test('empty export round-trips as a safe no-op and record count limits are enforced', () => {
  const emptyExport = buildStaffRosterExport([]);
  const parsedEmpty = parseStaffRosterFile(JSON.stringify(emptyExport), { categoryIds });
  const plan = planStaffRosterImport(parsedEmpty, [staff('destination-only')]);
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.preserved.length, 1);
  assert.deepEqual(applyStaffRosterPlan(plan, [staff('destination-only')]), [staff('destination-only')]);
  assert.throws(() => buildStaffRosterExport(Array.from({ length: STAFF_ROSTER_MAX_RECORDS + 1 }, (_, index) => staff('export-' + index))),
    (error) => error instanceof StaffRosterError && error.code === 'ROSTER_TOO_LARGE');
});

test('export contains only roster fields and never account, invitation, booking, or token data', () => {
  const exported = buildStaffRosterExport([staff('st-safe', {
    email: 'private@example.invalid', passwordHash: 'secret-hash', sessionToken: 'secret-token',
    invitation: { token: 'invite-token' }, bookings: [{ id: 'booking-private' }], userId: 'usr-private',
  })]);
  const json = JSON.stringify(exported);
  for (const secret of ['private@example.invalid', 'secret-hash', 'secret-token', 'invite-token', 'booking-private', 'usr-private']) {
    assert.equal(json.includes(secret), false);
  }
  assert.equal(Object.hasOwn(exported.staff[0], 'userId'), false);
});

test('export rejects specialties that do not exist in the source site categories', () => {
  assert.throws(() => buildStaffRosterExport([staff('orphan', { specialties: ['missing-category'] })], {
    categoryIds,
  }), /danh mục không tồn tại/);
});

test('new import adds a record and preserves staff that exist only at the destination', () => {
  const destination = [staff('site-only')];
  const plan = planStaffRosterImport(parse([staff('new-staff')]), destination);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.preserved.length, 1);
  const merged = applyStaffRosterPlan(plan, destination, { overwriteMatching: true, now });
  assert.deepEqual(merged.map((row) => row.id), ['site-only', 'new-staff']);
  assert.equal(merged[0], destination[0]);
});

test('matching ID remains unchanged until overwrite is confirmed', () => {
  const current = [staff('same-id')];
  const plan = planStaffRosterImport(parse([staff('same-id', { name: 'Tên từ tệp' })]), current);
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(applyStaffRosterPlan(plan, current, { now }), current);
  assert.equal(applyStaffRosterPlan(plan, current, { overwriteMatching: true, now })[0].name, 'Tên từ tệp');
});

test('confirmed overwrite preserves createdAt and assigns a fresh updatedAt', () => {
  const current = [staff('same-id', { createdAt: '2024-01-01T00:00:00.000Z', name: 'Tên cũ' })];
  const incoming = staff('same-id', { createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-02T00:00:00.000Z', name: 'Tên mới' });
  const plan = planStaffRosterImport(parse([incoming]), current);
  const result = applyStaffRosterPlan(plan, current, { overwriteMatching: true, now: '2026-11-12T01:00:00.000Z' })[0];
  assert.equal(result.createdAt, '2024-01-01T00:00:00.000Z');
  assert.equal(result.updatedAt, '2026-11-12T01:00:00.000Z');
  assert.equal(result.name, 'Tên mới');
});

test('rejects malformed JSON, unsupported format, version, and non-roster top-level data', () => {
  assert.throws(() => parseStaffRosterFile('{broken', { categoryIds }), StaffRosterError);
  assert.throws(() => parse([], { format: 'other' }), StaffRosterError);
  assert.throws(() => parse([], { version: 99 }), StaffRosterError);
  assert.throws(() => parse([], { accounts: [] }), StaffRosterError);
});

test('rejects files over the configured byte limit before parsing', () => {
  assert.throws(() => parseStaffRosterFile(' '.repeat(STAFF_ROSTER_MAX_FILE_BYTES + 1), { categoryIds }),
    (error) => error instanceof StaffRosterError && error.code === 'ROSTER_TOO_LARGE');
});

test('duplicate IDs invalidate every repeated row instead of silently skipping one', () => {
  const parsed = parse([staff('duplicate'), staff('duplicate', { name: 'Một người khác' })]);
  assert.equal(parsed.valid.length, 1);
  assert.equal(parsed.invalid.length, 1);
  assert.match(parsed.invalid[0].errors.join(' '), /ID trùng/);
});

test('missing destination category makes the whole import invalid', () => {
  const parsed = parse([staff('wrong-category', { specialties: ['not-on-destination'] })]);
  assert.equal(parsed.valid.length, 0);
  assert.match(parsed.invalid[0].errors.join(' '), /danh mục không tồn tại/);
});

test('invalid source rows are not mislabeled as destination-only records', () => {
  const plan = planStaffRosterImport(
    parse([staff('invalid-at-destination', { imageUrl: 'data:image/jpeg;base64,/9j/2Q==' })]),
    [staff('invalid-at-destination'), staff('destination-only')],
  );
  assert.equal(plan.invalid.length, 1);
  assert.deepEqual(plan.preserved.map((record) => record.id), ['destination-only']);
});

test('rejects malformed shifts, out-of-shift breaks, and overlapping breaks', () => {
  const invalidRows = [
    staff('bad-shift', { shiftStart: '18:00', shiftEnd: '09:00' }),
    staff('outside-break', { breaks: [{ startTime: '08:00', endTime: '09:30' }] }),
    staff('overlap-break', { breaks: [{ startTime: '11:00', endTime: '12:30' }, { startTime: '12:00', endTime: '13:00' }] }),
    staff('bad-weekday', { workingDays: [1, 1] }),
  ];
  const parsed = parse(invalidRows);
  assert.equal(parsed.valid.length, 0);
  assert.equal(parsed.invalid.length, invalidRows.length);
});

test('omitted optional fields preserve destination values during overwrite', () => {
  const current = [staff('optional', {
    imageUrl: 'https://source.example/photo.webp', imageId: 'site-photo',
    breaks: [{ startTime: '12:15', endTime: '12:45' }], breakStart: '15:00', breakEnd: '15:15',
  })];
  const incoming = staff('optional', { name: 'Tên đã cập nhật' });
  for (const field of ['imageUrl', 'imageId', 'breaks', 'breakStart', 'breakEnd']) delete incoming[field];
  const plan = planStaffRosterImport(parse([incoming]), current);
  const result = applyStaffRosterPlan(plan, current, { overwriteMatching: true, now })[0];
  assert.equal(result.name, 'Tên đã cập nhật');
  for (const field of ['imageUrl', 'imageId', 'breaks', 'breakStart', 'breakEnd']) {
    assert.deepEqual(result[field], current[0][field], field + ' must survive an omitted source field');
  }
});

test('explicit null clears optional fields and preview marks them as changes', () => {
  const current = [staff('clearable', {
    imageUrl: 'https://source.example/photo.webp', imageId: 'site-photo',
    breaks: [{ startTime: '12:00', endTime: '13:00' }], breakStart: '15:00', breakEnd: '15:15',
  })];
  const incoming = staff('clearable', { imageUrl: null, imageId: null, breaks: null, breakStart: null, breakEnd: null });
  const plan = planStaffRosterImport(parse([incoming]), current);
  assert.deepEqual(new Set(plan.updates[0].fields), new Set(['imageUrl', 'imageId', 'breaks', 'breakStart', 'breakEnd']));
  const result = applyStaffRosterPlan(plan, current, { overwriteMatching: true, now })[0];
  for (const field of ['imageUrl', 'imageId', 'breaks', 'breakStart', 'breakEnd']) assert.equal(Object.hasOwn(result, field), false);
});

test('preview signature detects same-timestamp content changes and destination-only changes', () => {
  const parsed = parse([staff('source')]);
  const first = planStaffRosterImport(parsed, [staff('target', { name: 'Tên A', updatedAt: now })]);
  const changedSameTimestamp = planStaffRosterImport(parsed, [staff('target', { name: 'Tên B', updatedAt: now })]);
  assert.notEqual(staffRosterPlanSignature(first), staffRosterPlanSignature(changedSameTimestamp));

  const destinationOnlyA = planStaffRosterImport(parsed, [staff('source'), staff('local', { title: 'Kỹ thuật viên A', updatedAt: now })]);
  const destinationOnlyB = planStaffRosterImport(parsed, [staff('source'), staff('local', { title: 'Kỹ thuật viên B', updatedAt: now })]);
  assert.notEqual(staffRosterPlanSignature(destinationOnlyA), staffRosterPlanSignature(destinationOnlyB));
  assert.equal(staffRosterPlanSignature(destinationOnlyA), staffRosterPlanSignature(
    planStaffRosterImport(parsed, [staff('local', { title: 'Kỹ thuật viên A', updatedAt: now }), staff('source')]),
  ), 'object order and row order must not change a stable signature');
});

test('preserved snapshot comparison includes every field and timestamp while ignoring object key order', () => {
  const before = staff('preserved', { imageUrl: '/staff/photo.webp' });
  assert.equal(staffRosterRecordSnapshotMatches(before, Object.fromEntries(Object.entries(before).reverse())), true);
  assert.equal(staffRosterRecordSnapshotMatches(before, { ...before, updatedAt: '2026-11-12T01:00:00.000Z' }), false);
  assert.equal(staffRosterRecordSnapshotMatches(before, { ...before, imageUrl: '/staff/changed.webp' }), false);
});

test('image warnings distinguish embedded images from unverified URLs and paths', () => {
  const embeddedPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
  const parsed = parse([
    staff('embedded', { imageUrl: embeddedPng }),
    staff('relative', { imageUrl: '/uploads/staff/photo.webp' }),
    staff('external', { imageUrl: 'https://source.example/photo.webp' }),
    staff('fake-data', { imageUrl: 'data:image/png;base64,YQ==' }),
    staff('truncated-png', { imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' }),
  ]);
  assert.equal(parsed.valid.length, 3);
  assert.equal(parsed.invalid.length, 2);
  assert.equal(parsed.valid[0].warnings.some((warning) => /chưa được kiểm tra/.test(warning)), false);
  assert.equal(parsed.valid[1].warnings.some((warning) => /site đích/.test(warning)), true);
  assert.equal(parsed.valid[2].warnings.some((warning) => /site đích/.test(warning)), true);
});

test('embedded WebP validates, malformed JPEG is rejected, and image failures leave preview counts accurate', () => {
  const webp = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vz0AAA=';
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AR//Z';
  const parsedImages = parse([
    staff('webp-image', { imageUrl: webp }),
    staff('jpeg-image', { imageUrl: jpeg }),
    staff('fake-jpeg', { imageUrl: 'data:image/jpeg;base64,/9j/2Q==' }),
  ]);
  assert.equal(parsedImages.valid.length, 2);
  assert.equal(parsedImages.invalid.length, 1);
  assert.match(parsedImages.invalid[0].errors.join(' '), /Ảnh/);

  const parsed = parse([
    staff('bad-image-update', { imageUrl: webp, name: 'Tên từ tệp' }),
    staff('valid-create'),
  ]);
  const destination = [staff('bad-image-update', { name: 'Tên tại site' }), staff('destination-only')];
  const plan = planStaffRosterImport(parsed, destination);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.creates.length, 1);
  attachStaffRosterImageErrors(plan, [{
    index: 0, id: 'bad-image-update', name: 'Tên từ tệp', errors: ['Ảnh nhúng không giải mã được.'],
  }]);
  assert.equal(plan.updates.length, 0);
  assert.deepEqual(plan.creates.map((item) => item.record.id), ['valid-create']);
  assert.deepEqual(plan.preserved.map((record) => record.id), ['destination-only']);
  assert.equal(plan.invalid.length, 1);
});

test('retry of the same import plan does not create a duplicate staff ID', () => {
  const parsed = parse([staff('retry-id')]);
  const firstPlan = planStaffRosterImport(parsed, []);
  const once = applyStaffRosterPlan(firstPlan, [], { now });
  const secondPlan = planStaffRosterImport(parsed, once);
  const twice = applyStaffRosterPlan(secondPlan, once, { now });
  assert.equal(twice.length, 1);
  assert.equal(secondPlan.creates.length, 0);
  assert.equal(secondPlan.unchanged.length, 1);
});

test('import refuses to exceed the destination collection limit', () => {
  const destination = Array.from({ length: STAFF_COLLECTION_MAX_RECORDS }, (_, index) => staff('target-' + index));
  const plan = planStaffRosterImport(parse([staff('one-too-many')]), destination);
  assert.throws(() => applyStaffRosterPlan(plan, destination), (error) => error.code === 'ROSTER_TOO_LARGE');
});
