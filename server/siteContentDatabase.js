const VERSION_KEY = 'site_content_schema_version';
export const SITE_CONTENT_SCHEMA_VERSION = 1;

const SCHEMA_V1 = `
  CREATE TABLE site_pages (
    id TEXT PRIMARY KEY NOT NULL,
    slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 3 AND 70 AND slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    template_id TEXT NOT NULL CHECK (template_id = 'holiday-offer-v1'),
    content_json TEXT NOT NULL CHECK (json_valid(content_json) AND json_type(content_json) = 'object'),
    campaign_id TEXT REFERENCES holiday_sales(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL CHECK (updated_at >= created_at),
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL
  ) STRICT;
  CREATE INDEX site_pages_public ON site_pages(status, slug);
  CREATE INDEX site_pages_campaign ON site_pages(campaign_id);

  CREATE TABLE site_menu_items (
    id TEXT PRIMARY KEY NOT NULL,
    label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 60),
    target_type TEXT NOT NULL CHECK (target_type IN ('route', 'page')),
    route_key TEXT,
    page_id TEXT REFERENCES site_pages(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 10000),
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL CHECK (updated_at >= created_at),
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    CHECK ((target_type = 'route' AND route_key IS NOT NULL AND page_id IS NULL)
      OR (target_type = 'page' AND route_key IS NULL AND page_id IS NOT NULL))
  ) STRICT;
  CREATE UNIQUE INDEX site_menu_route_unique ON site_menu_items(route_key) WHERE route_key IS NOT NULL;
  CREATE UNIQUE INDEX site_menu_page_unique ON site_menu_items(page_id) WHERE page_id IS NOT NULL;
  CREATE INDEX site_menu_public ON site_menu_items(enabled, position, label);

  CREATE TABLE site_content_requests (
    request_key TEXT PRIMARY KEY NOT NULL,
    input_hash TEXT NOT NULL,
    response_json TEXT NOT NULL CHECK (json_valid(response_json) AND json_type(response_json) = 'object')
  ) STRICT;
`;

export function migrateSiteContentDatabase(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const rawVersion = db.prepare('SELECT value FROM metadata WHERE key = ?').get(VERSION_KEY)?.value ?? '0';
    if (!/^\d+$/.test(rawVersion) || !Number.isSafeInteger(Number(rawVersion)) || Number(rawVersion) > SITE_CONTENT_SCHEMA_VERSION) {
      throw new Error('Unsupported site content database version.');
    }
    if (Number(rawVersion) === 0) {
      db.exec(SCHEMA_V1);
      db.prepare('INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(VERSION_KEY, String(SITE_CONTENT_SCHEMA_VERSION));
    }
    db.exec('COMMIT');
    return SITE_CONTENT_SCHEMA_VERSION;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
