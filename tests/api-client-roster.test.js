import test from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};
globalThis.window = { location: { origin: 'https://target.example' } };

let mode = 'success';
let serverRoster = { version: 7, records: [{ id: 'server-only', name: 'Server roster' }] };
let genericScenario = null;
let genericWriteCount = 0;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function bootstrap() {
  return {
    currentUser: { id: 'admin-1', role: 'admin' },
    collections: {
      users: [], categories: [], services: [], staff: serverRoster.records,
      bookings: [], promotions: [], reviews: [], favorites: [], contacts: [], settings: [],
    },
    versions: { staff: serverRoster.version },
    occupiedSlots: [], holidaySales: [], siteContent: { pages: [], menuItems: [] },
  };
}

globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url).pathname;
  if (path === '/api/bootstrap') return jsonResponse(bootstrap());
  if (path === '/api/admin/collections/staff' && options.method === 'PUT') {
    genericWriteCount += 1;
    if (genericScenario === 'disjoint') {
      genericScenario = null;
      serverRoster.records = serverRoster.records.map((record) => record.id === 'server-only'
        ? { ...record, title: 'Remote title edit' } : record);
      serverRoster.version += 1;
      return jsonResponse({ error: 'stale', code: 'VERSION_CONFLICT' }, 409);
    }
    if (genericScenario === 'same-field') {
      genericScenario = null;
      serverRoster.records = serverRoster.records.map((record) => record.id === 'server-only'
        ? { ...record, name: 'Remote conflict' } : record);
      serverRoster.version += 1;
      return jsonResponse({ error: 'stale', code: 'VERSION_CONFLICT' }, 409);
    }
    const expected = Number(options.headers['If-Match'] ?? options.headers['if-match']);
    if (expected !== serverRoster.version) return jsonResponse({ error: 'stale', code: 'VERSION_CONFLICT' }, 409);
    serverRoster = { version: serverRoster.version + 1, records: JSON.parse(options.body).records };
    return jsonResponse({ version: serverRoster.version });
  }
  if (path === '/api/admin/collections/staff' && options.method !== 'PUT') {
    return jsonResponse(structuredClone(serverRoster));
  }
  if (path === '/api/admin/staff-roster' && options.method === 'PUT') {
    if (mode === 'network') throw new TypeError('simulated network disconnect');
    if (mode === 'http-409') return jsonResponse({ error: 'stale roster', code: 'VERSION_CONFLICT' }, 409);
    if (mode === 'http-500') return jsonResponse({ error: 'simulated write error' }, 500);
    const expected = Number(options.headers['If-Match'] ?? options.headers['if-match']);
    if (expected !== serverRoster.version) return jsonResponse({ error: 'stale roster', code: 'VERSION_CONFLICT' }, 409);
    if (mode === 'commit-then-disconnect') {
      const { records } = JSON.parse(options.body);
      const byId = new Map(serverRoster.records.map((record) => [record.id, record]));
      records.forEach((record) => byId.set(record.id, record));
      serverRoster = { version: serverRoster.version + 1, records: [...byId.values()] };
      throw new TypeError('response lost after commit');
    }
    const { records } = JSON.parse(options.body);
    const byId = new Map(serverRoster.records.map((record) => [record.id, record]));
    records.forEach((record) => byId.set(record.id, record));
    serverRoster = { version: serverRoster.version + 1, records: [...byId.values()] };
    return jsonResponse({ version: serverRoster.version });
  }
  return jsonResponse({ error: 'not found' }, 404);
};

const { apiClient, mergeRecords } = await import('../assets/js/services/apiClient.js');

test('three-way collection merge combines disjoint field edits and keeps same-field conflicts local without retrying them', () => {
  const baseline = [{ id: 'staff-1', name: 'Before', title: 'Therapist', active: true }];
  const local = [{ id: 'staff-1', name: 'Local edit', title: 'Therapist', active: true }];
  const remote = [{ id: 'staff-1', name: 'Before', title: 'Senior therapist', active: true }];
  const disjoint = mergeRecords(baseline, local, remote);
  assert.deepEqual(disjoint.conflicts, []);
  assert.deepEqual(disjoint.records[0], { id: 'staff-1', name: 'Local edit', title: 'Senior therapist', active: true });

  const concurrent = mergeRecords(baseline,
    [{ id: 'staff-1', name: 'Local edit', title: 'Therapist', active: true }],
    [{ id: 'staff-1', name: 'Remote edit', title: 'Therapist', active: true }]);
  assert.deepEqual(concurrent.conflicts, [{ id: 'staff-1', fields: ['name'] }]);
  assert.equal(concurrent.records[0].name, 'Local edit', 'conflicting local work remains available for review');
});

test('roster API client reads server data independently and never treats failed HTTP/network writes as success', async () => {
  try {
    assert.equal(await apiClient.initialize(), true);
    assert.equal(apiClient.canSyncAdminCollections(), true);
    const localKey = 'serenity:v2:staff';
    const cachedStaff = globalThis.localStorage.getItem(localKey);
    globalThis.localStorage.setItem(localKey, JSON.stringify([{ id: 'local-only', name: 'Local cache only' }]));
    assert.deepEqual((await apiClient.getServerStaffRoster()).records.map((record) => record.id), ['server-only']);
    if (cachedStaff === null) globalThis.localStorage.removeItem(localKey);
    else globalThis.localStorage.setItem(localKey, cachedStaff);

    const record = { id: 'retry-safe', name: 'Imported staff' };
    mode = 'http-409';
    await assert.rejects(apiClient.importStaffRoster([record], 7), (error) => error.status === 409);
    mode = 'http-500';
    await assert.rejects(apiClient.importStaffRoster([record], 7), (error) => error.status === 500);
    mode = 'network';
    await assert.rejects(apiClient.importStaffRoster([record], 7), /network disconnect/);
    assert.equal(apiClient.hasPendingCollectionSync('staff'), false);

    mode = 'commit-then-disconnect';
    await assert.rejects(apiClient.importStaffRoster([record], 7), /response lost after commit/);
    const uncertain = await apiClient.getServerStaffRoster();
    assert.equal(uncertain.version, 8);
    assert.equal(uncertain.records.filter((row) => row.id === 'retry-safe').length, 1);
    assert.equal(uncertain.records.some((row) => row.id === 'local-only'), false);

    mode = 'success';
    const saved = await apiClient.importStaffRoster([record], 8);
    assert.equal(saved.version, 9);
    const confirmed = await apiClient.getServerStaffRoster();
    assert.equal(confirmed.records.filter((row) => row.id === 'retry-safe').length, 1);
    assert.equal(confirmed.records.find((row) => row.id === 'retry-safe').name, 'Imported staff');

    const { staffRepo } = await import('../assets/js/data/repositories.js');
    genericScenario = 'disjoint';
    staffRepo.update('server-only', { name: 'Local title-safe edit' });
    await apiClient.waitForCollectionSync('staff');
    let merged = await apiClient.getServerStaffRoster();
    assert.equal(merged.records.find((row) => row.id === 'server-only').name, 'Local title-safe edit');
    assert.equal(merged.records.find((row) => row.id === 'server-only').title, 'Remote title edit');

    genericScenario = 'same-field';
    const writesBeforeConflict = genericWriteCount;
    staffRepo.update('server-only', { name: 'Local conflict' });
    await assert.rejects(apiClient.waitForCollectionSync('staff'), (error) => error.code === 'SYNC_CONFLICT');
    assert.equal(genericWriteCount, writesBeforeConflict + 1, 'a same-field conflict must not trigger an automatic second PUT');
    assert.equal(staffRepo.getById('server-only').name, 'Local conflict');
    assert.equal((await apiClient.getServerStaffRoster()).records.find((row) => row.id === 'server-only').name, 'Remote conflict');
    await apiClient.refresh();
    await assert.rejects(apiClient.waitForCollectionSync('staff'), (error) => error.code === 'SYNC_CONFLICT');
    assert.equal(genericWriteCount, writesBeforeConflict + 1, 'an unresolved conflict must remain blocked after refresh');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalLocalStorage;
  }
});
