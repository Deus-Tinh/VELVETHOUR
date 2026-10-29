import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migratePricingDatabase, PRICING_SCHEMA_VERSION, readHolidaySales } from '../server/pricingDatabase.js';
import { calculatePrice } from '../assets/js/domain/pricingService.js';

function fresh() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migratePricingDatabase(db);
  return db;
}
function insertSale(db, patch = {}) {
  const record = {
    id: 'sale', name: 'Sale ngày lễ', occasion: '20/11', service_date_from: '2026-11-20', service_date_to: '2026-11-20',
    enabled: 1, discount_type: 'percent', percentage_bps: 1500, fixed_amount_vnd: null, max_discount_vnd: null,
    scope_type: 'all', revision: 1, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    created_by: 'admin', updated_by: 'admin', ...patch,
  };
  const columns = Object.keys(record);
  db.prepare(`INSERT INTO holiday_sales (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(record));
}
function insertQuote(db, patch = {}) {
  const record = {
    id: 'quote-unique-000001', booking_id: 'existing-booking', actor_binding: 'user:admin', booking_revision: 0,
    requested_change: '{"date":"2026-11-20","startTime":"10:00"}', old_pricing: '{"finalPrice":500000}',
    new_pricing: '{"finalPrice":425000}', pricing_versions: '{"services":1,"holidaySales":1}',
    settlement: '{"priceDelta":-75000,"amountDue":425000,"refundDue":0}', policy_version: 1,
    created_at: '2026-10-19T03:00:00.000Z', expires_at: '2026-10-19T03:05:00.000Z',
    status: 'pending', confirmed_at: null, result_json: null, ...patch,
  };
  const columns = Object.keys(record);
  db.prepare(`INSERT INTO reschedule_quotes (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(record));
}

test('pricing migration creates three typed tables and is safe to run twice', () => {
  const db = fresh();
  try {
    insertSale(db);
    insertQuote(db);
    assert.equal(migratePricingDatabase(db), PRICING_SCHEMA_VERSION);
    assert.equal(db.prepare("SELECT value FROM metadata WHERE key = 'holiday_pricing_schema_version'").get().value, '1');
    assert.equal(readHolidaySales(db).length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM reschedule_quotes').get().count, 1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
    assert.deepEqual(tables, ['holiday_sale_targets', 'holiday_sales', 'metadata', 'reschedule_quotes']);
  } finally { db.close(); }
});

test('migration preserves legacy booking prices, payment records, sessions and collection versions byte for byte', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE collection_records (collection TEXT, id TEXT, payload TEXT, PRIMARY KEY(collection,id));
      CREATE TABLE collection_versions (collection TEXT PRIMARY KEY, version INTEGER);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT, expires_at INTEGER);
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);`);
    const payload = JSON.stringify({ id: 'legacy', date: '2026-11-20', originalPrice: 500000, finalPrice: 450000, paymentRecords: [{ type: 'deposit', amount: 100000 }] });
    db.prepare('INSERT INTO collection_records VALUES (?, ?, ?)').run('bookings', 'legacy', payload);
    db.exec("INSERT INTO collection_versions VALUES ('bookings',7); INSERT INTO sessions VALUES ('hash','admin',12345); INSERT INTO metadata VALUES ('initialized','yes')");
    migratePricingDatabase(db);
    assert.equal(db.prepare('SELECT payload FROM collection_records').get().payload, payload);
    assert.equal(db.prepare('SELECT version FROM collection_versions').get().version, 7);
    assert.equal(db.prepare('SELECT token_hash FROM sessions').get().token_hash, 'hash');
    assert.equal(db.prepare("SELECT value FROM metadata WHERE key = 'initialized'").get().value, 'yes');
  } finally { db.close(); }
});

test('failed migrations roll back every new table and future schema versions are never overwritten', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE holiday_sale_targets (legacy_marker TEXT)');
    assert.throws(() => migratePricingDatabase(db));
    assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE name = 'holiday_sales'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE name = 'metadata'").get().count, 0);
    db.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT); INSERT INTO metadata VALUES ('holiday_pricing_schema_version','99')");
    assert.throws(() => migratePricingDatabase(db), /Unsupported/);
    assert.equal(db.prepare('SELECT value FROM metadata').get().value, '99');
  } finally { db.close(); }
});

test('SQLite rejects impossible dates, contradictory discount fields and invalid money values', () => {
  const db = fresh();
  try {
    for (const patch of [
      { service_date_from: '2026-02-30' }, { service_date_to: '2026-11-19' }, { service_date_to: 'not-a-date' },
      { percentage_bps: 10001 }, { percentage_bps: null }, { fixed_amount_vnd: 10 }, { max_discount_vnd: 0 },
      { discount_type: 'fixed', percentage_bps: null, fixed_amount_vnd: -1 }, { scope_type: 'unknown' },
      { enabled: 2 }, { revision: 0 }, { percentage_bps: 12.5 },
    ]) assert.throws(() => insertSale(db, patch));
    assert.equal(db.prepare('SELECT COUNT(*) count FROM holiday_sales').get().count, 0);
  } finally { db.close(); }
});

test('targets reject duplicates, missing campaigns and scope mismatches; deleting a campaign cascades', () => {
  const db = fresh();
  try {
    insertSale(db, { scope_type: 'service_variant' });
    const insert = db.prepare('INSERT INTO holiday_sale_targets VALUES (?, ?, ?, ?)');
    insert.run('sale', 'service_variant', 'massage', 60);
    assert.throws(() => insert.run('sale', 'service_variant', 'massage', 60));
    assert.throws(() => insert.run('missing', 'service_variant', 'massage', 90));
    assert.throws(() => insert.run('sale', 'service', 'massage', 0));
    assert.throws(() => insert.run('sale', 'service_variant', 'massage', 0));
    assert.throws(() => insert.run('sale', 'service_variant', 'massage', 61));
    db.prepare('DELETE FROM holiday_sales WHERE id = ?').run('sale');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM holiday_sale_targets').get().count, 0);
  } finally { db.close(); }
});

test('non-variant targets use a non-null duration sentinel to enforce uniqueness', () => {
  const db = fresh();
  try {
    insertSale(db, { scope_type: 'service' });
    db.exec("INSERT INTO holiday_sale_targets(campaign_id,scope_type,target_id) VALUES ('sale','service','massage')");
    assert.throws(() => db.exec("INSERT INTO holiday_sale_targets(campaign_id,scope_type,target_id) VALUES ('sale','service','massage')"));
    assert.throws(() => db.exec("INSERT INTO holiday_sale_targets VALUES ('sale','service','massage',NULL)"));
  } finally { db.close(); }
});

test('persisted campaigns round-trip into the same domain pricing calculation', () => {
  const db = fresh();
  try {
    insertSale(db, { scope_type: 'service_variant' });
    insertSale(db, { id: 'disabled', enabled: 0 });
    db.prepare('INSERT INTO holiday_sale_targets VALUES (?, ?, ?, ?)').run('sale', 'service_variant', 'massage', 90);
    const campaigns = readHolidaySales(db, { enabledOnly: true });
    assert.equal(campaigns.length, 1);
    assert.equal(campaigns[0].enabled, true);
    assert.equal(campaigns[0].targets[0].durationMinutes, 90);
    const result = calculatePrice({ service: { id: 'massage', category: 'body-massages', variants: [{ duration: 90, price: 700000 }] },
      duration: 90, serviceDate: '2026-11-20', evaluatedAt: '2026-10-19T03:00:00.000Z', campaigns });
    assert.equal(result.finalPrice, 595000);
    assert.equal(result.campaignId, 'sale');
    assert.equal(readHolidaySales(db).length, 2);
  } finally { db.close(); }
});

test('orphaned scoped campaigns fail closed instead of unexpectedly applying to all services', () => {
  const db = fresh();
  try {
    insertSale(db, { scope_type: 'service' });
    assert.throws(() => readHolidaySales(db), (error) => error.code === 'HOLIDAY_SALE_INVALID');
  } finally { db.close(); }
});

test('quote schema preserves binding and snapshots and rejects incomplete confirmation states', () => {
  const db = fresh();
  try {
    for (const patch of [
      { actor_binding: '' }, { booking_revision: -1 }, { requested_change: 'invalid' }, { old_pricing: '[]' },
      { settlement: 'null' }, { expires_at: '2026-10-19T02:00:00.000Z' }, { status: 'confirmed' },
      { status: 'pending', confirmed_at: '2026-10-19T03:01:00.000Z', result_json: '{}' },
      { status: 'confirmed', confirmed_at: '2026-10-19T03:05:00.000Z', result_json: '{}' },
    ]) assert.throws(() => insertQuote(db, patch));
    insertQuote(db);
    assert.equal(db.prepare('SELECT status FROM reschedule_quotes').get().status, 'pending');
    db.prepare("UPDATE reschedule_quotes SET status = 'confirmed', confirmed_at = ?, result_json = ? WHERE id = ?")
      .run('2026-10-19T03:01:00.000Z', '{"bookingId":"existing-booking"}', 'quote-unique-000001');
    const confirmed = db.prepare('SELECT * FROM reschedule_quotes').get();
    assert.equal(confirmed.actor_binding, 'user:admin');
    assert.equal(JSON.parse(confirmed.result_json).bookingId, 'existing-booking');
    assert.equal(JSON.parse(confirmed.old_pricing).finalPrice, 500000);
  } finally { db.close(); }
});

test('schema and quote snapshots survive closing and reopening a temporary SQLite file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'serenity-pricing-'));
  const filename = path.join(directory, 'pricing.sqlite');
  let db;
  try {
    db = new DatabaseSync(filename);
    db.exec('PRAGMA foreign_keys = ON');
    migratePricingDatabase(db);
    insertSale(db);
    insertQuote(db);
    db.close();
    db = new DatabaseSync(filename);
    migratePricingDatabase(db);
    assert.equal(readHolidaySales(db)[0].name, 'Sale ngày lễ');
    assert.equal(JSON.parse(db.prepare('SELECT new_pricing FROM reschedule_quotes').get().new_pricing).finalPrice, 425000);
  } finally {
    db?.close();
    await rm(filename, { force: true });
    await rmdir(directory);
  }
});
