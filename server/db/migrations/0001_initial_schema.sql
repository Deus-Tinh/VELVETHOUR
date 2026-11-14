CREATE TABLE IF NOT EXISTS collection_records (
  inserted_order bigserial NOT NULL UNIQUE,
  collection text NOT NULL,
  id text NOT NULL,
  payload text NOT NULL CHECK (jsonb_typeof(payload::jsonb) IS NOT NULL),
  PRIMARY KEY (collection, id)
);

CREATE TABLE IF NOT EXISTS collection_versions (
  collection text PRIMARY KEY,
  version integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS package_images (
  id text PRIMARY KEY,
  mime_type text NOT NULL,
  data bytea NOT NULL,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS therapy_images (
  id text PRIMARY KEY,
  mime_type text NOT NULL,
  data bytea NOT NULL,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS metadata (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL,
  expires_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_invites (
  staff_id text PRIMARY KEY,
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_by text NOT NULL,
  created_at text NOT NULL,
  expires_at text NOT NULL,
  accepted_at text
);

CREATE TABLE IF NOT EXISTS password_reset_otps (
  email text PRIMARY KEY,
  user_id text NOT NULL,
  otp_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at bigint NOT NULL,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_dedupe (
  token text PRIMARY KEY,
  booking_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  actor_id text,
  actor_role text,
  action text NOT NULL,
  booking_id text,
  details text NOT NULL CHECK (jsonb_typeof(details::jsonb) IS NOT NULL),
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id text PRIMARY KEY,
  user_id text,
  guest_session_hash text,
  context text NOT NULL CHECK (jsonb_typeof(context::jsonb) IS NOT NULL),
  status text NOT NULL DEFAULT 'active',
  created_at text NOT NULL,
  updated_at text NOT NULL,
  expires_at bigint NOT NULL,
  CHECK ((user_id IS NULL) <> (guest_session_hash IS NULL))
);
CREATE INDEX IF NOT EXISTS chat_conversations_user_expiry ON chat_conversations(user_id, expires_at, updated_at);
CREATE INDEX IF NOT EXISTS chat_conversations_guest_expiry ON chat_conversations(guest_session_hash, expires_at, updated_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  inserted_order bigserial NOT NULL UNIQUE,
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  message_type text NOT NULL,
  content text NOT NULL,
  metadata text NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata::jsonb) IS NOT NULL),
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_messages_conversation_time ON chat_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS holiday_sales (
  id text PRIMARY KEY NOT NULL CHECK (length(btrim(id)) BETWEEN 1 AND 120),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  occasion text NOT NULL DEFAULT '',
  service_date_from text NOT NULL CHECK (service_date_from ~ '^\d{4}-\d{2}-\d{2}$' AND service_date_from::date::text = service_date_from),
  service_date_to text NOT NULL CHECK (service_date_to ~ '^\d{4}-\d{2}-\d{2}$' AND service_date_to::date::text = service_date_to),
  enabled integer NOT NULL CHECK (enabled IN (0, 1)),
  discount_type text NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  percentage_bps integer,
  fixed_amount_vnd integer,
  max_discount_vnd integer CHECK (max_discount_vnd IS NULL OR max_discount_vnd BETWEEN 1 AND 100000000),
  scope_type text NOT NULL CHECK (scope_type IN ('all', 'category', 'service', 'service_variant')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at text NOT NULL,
  updated_at text NOT NULL CHECK (updated_at >= created_at),
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  updated_by text NOT NULL CHECK (length(btrim(updated_by)) > 0),
  UNIQUE (id, scope_type),
  CHECK (service_date_from <= service_date_to),
  CHECK ((discount_type = 'percent' AND percentage_bps IS NOT NULL AND percentage_bps BETWEEN 1 AND 10000 AND fixed_amount_vnd IS NULL)
    OR (discount_type = 'fixed' AND fixed_amount_vnd IS NOT NULL AND fixed_amount_vnd BETWEEN 1 AND 100000000 AND percentage_bps IS NULL))
);
CREATE INDEX IF NOT EXISTS holiday_sales_enabled_dates ON holiday_sales(enabled, service_date_from, service_date_to);

CREATE TABLE IF NOT EXISTS holiday_sale_targets (
  campaign_id text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('category', 'service', 'service_variant')),
  target_id text NOT NULL CHECK (length(btrim(target_id)) BETWEEN 1 AND 120),
  duration_minutes integer NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, target_id, duration_minutes),
  FOREIGN KEY (campaign_id, scope_type) REFERENCES holiday_sales(id, scope_type) ON DELETE CASCADE,
  CHECK ((scope_type = 'service_variant' AND duration_minutes BETWEEN 15 AND 480 AND duration_minutes % 5 = 0)
    OR (scope_type IN ('category', 'service') AND duration_minutes = 0))
);
CREATE INDEX IF NOT EXISTS holiday_sale_targets_lookup ON holiday_sale_targets(scope_type, target_id, duration_minutes);

CREATE TABLE IF NOT EXISTS reschedule_quotes (
  id text PRIMARY KEY NOT NULL CHECK (length(id) >= 16),
  booking_id text NOT NULL CHECK (length(btrim(booking_id)) > 0),
  actor_binding text NOT NULL CHECK (length(btrim(actor_binding)) > 0),
  booking_revision integer NOT NULL CHECK (booking_revision >= 0),
  requested_change text NOT NULL CHECK (jsonb_typeof(requested_change::jsonb) = 'object'),
  old_pricing text NOT NULL CHECK (jsonb_typeof(old_pricing::jsonb) = 'object'),
  new_pricing text NOT NULL CHECK (jsonb_typeof(new_pricing::jsonb) = 'object'),
  pricing_versions text NOT NULL CHECK (jsonb_typeof(pricing_versions::jsonb) = 'object'),
  settlement text NOT NULL CHECK (jsonb_typeof(settlement::jsonb) = 'object'),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  created_at text NOT NULL,
  expires_at text NOT NULL CHECK (expires_at > created_at),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired', 'superseded')),
  confirmed_at text,
  result_json text CHECK (result_json IS NULL OR jsonb_typeof(result_json::jsonb) = 'object'),
  CHECK ((status = 'confirmed' AND confirmed_at IS NOT NULL AND confirmed_at >= created_at AND confirmed_at < expires_at AND result_json IS NOT NULL)
    OR (status != 'confirmed' AND confirmed_at IS NULL AND result_json IS NULL))
);
CREATE INDEX IF NOT EXISTS reschedule_quotes_booking_status ON reschedule_quotes(booking_id, status);
CREATE INDEX IF NOT EXISTS reschedule_quotes_actor_expiry ON reschedule_quotes(actor_binding, expires_at);

CREATE TABLE IF NOT EXISTS payment_transactions (
  provider text NOT NULL CHECK (provider = 'sepay'),
  provider_transaction_id text NOT NULL CHECK (length(btrim(provider_transaction_id)) BETWEEN 1 AND 80),
  booking_id text,
  payment_code text,
  transfer_amount integer NOT NULL CHECK (transfer_amount >= 0),
  transfer_type text NOT NULL,
  transfer_content text NOT NULL DEFAULT '',
  reference_code text NOT NULL DEFAULT '',
  transaction_at text,
  status text NOT NULL CHECK (status IN ('paid', 'underpaid', 'overpaid', 'late', 'slot_taken', 'extra_payment', 'unmatched', 'wrong_account', 'wrong_direction')),
  reason text NOT NULL DEFAULT '',
  received_at text NOT NULL,
  PRIMARY KEY (provider, provider_transaction_id)
);
CREATE INDEX IF NOT EXISTS payment_transactions_booking ON payment_transactions(booking_id, received_at DESC);
CREATE INDEX IF NOT EXISTS payment_transactions_status ON payment_transactions(status, received_at DESC);

CREATE TABLE IF NOT EXISTS site_pages (
  id text PRIMARY KEY NOT NULL,
  slug text NOT NULL UNIQUE CHECK (length(slug) BETWEEN 3 AND 70 AND slug ~ '^[a-z0-9][a-z0-9-]*$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  template_id text NOT NULL CHECK (template_id = 'holiday-offer-v1'),
  content_json text NOT NULL CHECK (jsonb_typeof(content_json::jsonb) = 'object'),
  campaign_id text REFERENCES holiday_sales(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  revision integer NOT NULL CHECK (revision > 0),
  created_at text NOT NULL,
  updated_at text NOT NULL CHECK (updated_at >= created_at),
  created_by text NOT NULL,
  updated_by text NOT NULL
);
CREATE INDEX IF NOT EXISTS site_pages_public ON site_pages(status, slug);
CREATE INDEX IF NOT EXISTS site_pages_campaign ON site_pages(campaign_id);

CREATE TABLE IF NOT EXISTS site_menu_items (
  id text PRIMARY KEY NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  target_type text NOT NULL CHECK (target_type IN ('route', 'page')),
  route_key text,
  page_id text REFERENCES site_pages(id) ON DELETE CASCADE,
  enabled integer NOT NULL CHECK (enabled IN (0, 1)),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 10000),
  revision integer NOT NULL CHECK (revision > 0),
  created_at text NOT NULL,
  updated_at text NOT NULL CHECK (updated_at >= created_at),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  CHECK ((target_type = 'route' AND route_key IS NOT NULL AND page_id IS NULL)
    OR (target_type = 'page' AND route_key IS NULL AND page_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS site_menu_route_unique ON site_menu_items(route_key) WHERE route_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS site_menu_page_unique ON site_menu_items(page_id) WHERE page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_menu_public ON site_menu_items(enabled, position, label);

CREATE TABLE IF NOT EXISTS site_content_requests (
  request_key text PRIMARY KEY NOT NULL,
  input_hash text NOT NULL,
  response_json text NOT NULL CHECK (jsonb_typeof(response_json::jsonb) = 'object')
);

CREATE TABLE IF NOT EXISTS admin_agent_conversations (
  owner_id text NOT NULL,
  id text NOT NULL,
  title text NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  deleted_at bigint,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX IF NOT EXISTS admin_agent_conversations_owner_time ON admin_agent_conversations(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS admin_agent_messages (
  id bigserial PRIMARY KEY,
  owner_id text NOT NULL,
  conversation_id text NOT NULL,
  request_id text NOT NULL,
  request_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'completed', 'failed', 'interrupted')),
  metadata_json text NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata_json::jsonb) IS NOT NULL),
  created_at bigint NOT NULL,
  UNIQUE (owner_id, request_id, role),
  FOREIGN KEY (owner_id, conversation_id) REFERENCES admin_agent_conversations(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS admin_agent_messages_history ON admin_agent_messages(owner_id, conversation_id, id);
CREATE INDEX IF NOT EXISTS admin_agent_messages_expiry ON admin_agent_messages(created_at);
