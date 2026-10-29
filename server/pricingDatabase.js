import { normalizeHolidaySale } from '../assets/js/domain/holidaySaleModel.js';

const VERSION_KEY = 'holiday_pricing_schema_version';
export const PRICING_SCHEMA_VERSION = 1;

const SCHEMA_V1 = `
  CREATE TABLE holiday_sales (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 120),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
    occasion TEXT NOT NULL DEFAULT '',
    service_date_from TEXT NOT NULL,
    service_date_to TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
    percentage_bps INTEGER,
    fixed_amount_vnd INTEGER,
    max_discount_vnd INTEGER CHECK (max_discount_vnd IS NULL OR max_discount_vnd BETWEEN 1 AND 100000000),
    scope_type TEXT NOT NULL CHECK (scope_type IN ('all', 'category', 'service', 'service_variant')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL CHECK (updated_at >= created_at),
    created_by TEXT NOT NULL CHECK (length(trim(created_by)) > 0),
    updated_by TEXT NOT NULL CHECK (length(trim(updated_by)) > 0),
    UNIQUE (id, scope_type),
    CHECK (length(service_date_from) = 10 AND service_date_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(service_date_from, '+0 days') IS NOT NULL AND date(service_date_from, '+0 days') = service_date_from),
    CHECK (length(service_date_to) = 10 AND service_date_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(service_date_to, '+0 days') IS NOT NULL AND date(service_date_to, '+0 days') = service_date_to),
    CHECK (service_date_from <= service_date_to),
    CHECK ((discount_type = 'percent' AND percentage_bps IS NOT NULL AND percentage_bps BETWEEN 1 AND 10000 AND fixed_amount_vnd IS NULL)
      OR (discount_type = 'fixed' AND fixed_amount_vnd IS NOT NULL AND fixed_amount_vnd BETWEEN 1 AND 100000000 AND percentage_bps IS NULL))
  ) STRICT;
  CREATE INDEX holiday_sales_enabled_dates ON holiday_sales(enabled, service_date_from, service_date_to);

  CREATE TABLE holiday_sale_targets (
    campaign_id TEXT NOT NULL,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('category', 'service', 'service_variant')),
    target_id TEXT NOT NULL CHECK (length(trim(target_id)) BETWEEN 1 AND 120),
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (campaign_id, target_id, duration_minutes),
    FOREIGN KEY (campaign_id, scope_type) REFERENCES holiday_sales(id, scope_type) ON DELETE CASCADE,
    CHECK ((scope_type = 'service_variant' AND duration_minutes BETWEEN 15 AND 480 AND duration_minutes % 5 = 0)
      OR (scope_type IN ('category', 'service') AND duration_minutes = 0))
  ) STRICT;
  CREATE INDEX holiday_sale_targets_lookup ON holiday_sale_targets(scope_type, target_id, duration_minutes);

  CREATE TABLE reschedule_quotes (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) >= 16),
    booking_id TEXT NOT NULL CHECK (length(trim(booking_id)) > 0),
    actor_binding TEXT NOT NULL CHECK (length(trim(actor_binding)) > 0),
    booking_revision INTEGER NOT NULL CHECK (booking_revision >= 0),
    requested_change TEXT NOT NULL CHECK (json_valid(requested_change) AND json_type(requested_change) = 'object'),
    old_pricing TEXT NOT NULL CHECK (json_valid(old_pricing) AND json_type(old_pricing) = 'object'),
    new_pricing TEXT NOT NULL CHECK (json_valid(new_pricing) AND json_type(new_pricing) = 'object'),
    pricing_versions TEXT NOT NULL CHECK (json_valid(pricing_versions) AND json_type(pricing_versions) = 'object'),
    settlement TEXT NOT NULL CHECK (json_valid(settlement) AND json_type(settlement) = 'object'),
    policy_version INTEGER NOT NULL CHECK (policy_version > 0),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL CHECK (expires_at > created_at),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired', 'superseded')),
    confirmed_at TEXT,
    result_json TEXT CHECK (result_json IS NULL OR (json_valid(result_json) AND json_type(result_json) = 'object')),
    CHECK ((status = 'confirmed' AND confirmed_at IS NOT NULL AND confirmed_at >= created_at AND confirmed_at < expires_at AND result_json IS NOT NULL)
      OR (status != 'confirmed' AND confirmed_at IS NULL AND result_json IS NULL))
  ) STRICT;
  CREATE INDEX reschedule_quotes_booking_status ON reschedule_quotes(booking_id, status);
  CREATE INDEX reschedule_quotes_actor_expiry ON reschedule_quotes(actor_binding, expires_at);
`;

/** Additive migration; leave all existing bookings, sessions and payment records untouched. */
export function migratePricingDatabase(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const rawVersion = db.prepare('SELECT value FROM metadata WHERE key = ?').get(VERSION_KEY)?.value ?? '0';
    if (!/^\d+$/.test(rawVersion) || !Number.isSafeInteger(Number(rawVersion)) || Number(rawVersion) > PRICING_SCHEMA_VERSION) {
      throw new Error('Unsupported holiday pricing database version.');
    }
    if (Number(rawVersion) === 0) {
      db.exec(SCHEMA_V1);
      db.prepare('INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(VERSION_KEY, String(PRICING_SCHEMA_VERSION));
    }
    db.exec('COMMIT');
    return PRICING_SCHEMA_VERSION;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Read the single SQLite source into the browser-compatible pricing representation. */
export function readHolidaySales(db, { enabledOnly = false } = {}) {
  const rows = db.prepare(`SELECT * FROM holiday_sales ${enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY id`).all();
  const targets = new Map();
  for (const row of db.prepare('SELECT campaign_id, target_id, duration_minutes FROM holiday_sale_targets ORDER BY campaign_id, target_id, duration_minutes').all()) {
    const list = targets.get(row.campaign_id) || [];
    list.push({ targetId: row.target_id, durationMinutes: row.duration_minutes });
    targets.set(row.campaign_id, list);
  }
  return rows.map((row) => normalizeHolidaySale({
    id: row.id, name: row.name, occasion: row.occasion, serviceDateFrom: row.service_date_from,
    serviceDateTo: row.service_date_to, enabled: row.enabled === 1, discountType: row.discount_type,
    percentageBps: row.percentage_bps, fixedAmountVnd: row.fixed_amount_vnd, maxDiscountVnd: row.max_discount_vnd,
    scopeType: row.scope_type, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    targets: targets.get(row.id) || [],
  }));
}
