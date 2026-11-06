import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { storage } from '../assets/js/core/storage.js';
import { DEFAULT_MANAGED_USERS, DEFAULT_STAFF_ADMIN_PASSWORD, seedIfNeeded } from '../assets/js/data/seed.js';
import { sendPasswordResetOtpEmail } from './mailer.js';
import { ADDITIONAL_PACKAGE_SEED_IDS, ADDITIONAL_THERAPY_SEED_IDS, SERVICES_SEED } from '../assets/js/data/servicesSeed.js';
import { repos } from '../assets/js/data/repositories.js';
import { bookingLockEndMinute, formatVND } from '../assets/js/core/utils.js';
import {
  getPackageComponentIds, getServiceKind, isServiceBookable, normalizeServiceRecord, PACKAGE_CATEGORY_ID,
} from '../assets/js/domain/serviceCatalogModel.js';
import { isTherapyGroupId } from '../assets/js/domain/therapyGroupModel.js';
import { isAllowedOrigin } from './originPolicy.js';
import { apiRateLimitFromEnv, clientAddressForRequest, createApiRateLimiter, HTTP_SERVER_OPTIONS, resolvePublicAsset } from './httpProtection.js';
import { queryPublicServiceCatalog, ServiceCatalogQueryError } from './serviceCatalog.js';
import { isSpaManagerAgentConfigured, runSpaManagerAgent } from './spaManagerAgent.js';
import { migratePricingDatabase } from './pricingDatabase.js';
import { migrateSiteContentDatabase } from './siteContentDatabase.js';
import { createHolidaySaleOperations } from './holidaySaleOperations.js';
import { createSiteContentOperations, SITE_MENU_ROUTES } from './siteContentOperations.js';
import { migrateAdminAgentHistory, createAdminAgentHistory, AGENT_HISTORY_RETENTION_DAYS } from './adminAgentHistory.js';
import { createPaymentCode, createPaymentOperations, paymentInstructions, publicPaymentConfig } from './paymentOperations.js';
import { AppError } from '../assets/js/core/errors.js';
import { calculatePrice as calculateDomainPrice } from '../assets/js/domain/pricingService.js';
import {
  CHAT_MAX_MESSAGE_LENGTH, classifyChatMessage, emptyChatContext, isAiConfigured, mergeChatContext,
  recommendServices, redactChatText, requestAiCriteria,
} from './chatbot.js';
import { isStrongPassword, schemas, validate } from '../assets/js/core/validators.js';
import { buildMusicManifest } from './musicLibrary.js';
import { assertPersistentSQLiteStorage } from './persistentStorage.js';
import { assertSqliteIntegrity, createSqliteBackup } from './sqliteMaintenance.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.NODE_TEST_CONTEXT && typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch {}
}
const SERVER_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
if (IS_PRODUCTION) {
  for (const variable of ['SERENITY_DATA_DIR', 'SERENITY_DB_PATH', 'SERENITY_BACKUP_DIR']) {
    if (!process.env[variable] || !path.isAbsolute(process.env[variable])) {
      throw new Error(`Production startup refused: ${variable} must be set to an absolute persistent-volume path.`);
    }
  }
}
const DATA_DIR = path.resolve(process.env.SERENITY_DATA_DIR || SERVER_DATA_DIR);
const BACKUP_DIR = path.resolve(process.env.SERENITY_BACKUP_DIR || path.join(DATA_DIR, 'backups'));
const MUSIC_DIRECTORY = path.resolve(process.env.SERENITY_MUSIC_DIR || path.join(DATA_DIR, 'music'));
const DATABASE_PATH = path.resolve(process.env.SERENITY_DB_PATH || path.join(DATA_DIR, 'serenity.sqlite'));
const PORT = Number(process.env.PORT || process.env.SERENITY_PORT || 3001);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT or SERENITY_PORT must be an integer between 1 and 65535.');
const HOST = process.env.SERENITY_HOST || '0.0.0.0';

if (IS_PRODUCTION) {
  await assertPersistentSQLiteStorage({ appRoot: ROOT, dataDir: DATA_DIR, databasePath: DATABASE_PATH, backupDir: BACKUP_DIR });
  await mkdir(MUSIC_DIRECTORY, { recursive: true });
} else {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(BACKUP_DIR, { recursive: true });
  await mkdir(MUSIC_DIRECTORY, { recursive: true });
}

const API_RATE_LIMIT = apiRateLimitFromEnv();
const apiRateLimiter = createApiRateLimiter({ limit: API_RATE_LIMIT });
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const CHAT_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const ACTIVE_BOOKING_STATUSES = new Set(['Pending', 'Confirmed', 'CheckedIn']);
const STATUSES = new Set(['Pending', 'Confirmed', 'CheckedIn', 'Completed', 'Cancelled', 'NoShow']);
const ADMIN_COLLECTIONS = new Set(['categories', 'services', 'staff', 'promotions', 'settings']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const db = new DatabaseSync(DATABASE_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS collection_records (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  );
  CREATE TABLE IF NOT EXISTS collection_versions (collection TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS package_images (
    id TEXT PRIMARY KEY, mime_type TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS therapy_images (
    id TEXT PRIMARY KEY, mime_type TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS staff_invites (
    staff_id TEXT PRIMARY KEY, email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, accepted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS password_reset_otps (
    email TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS booking_dedupe (token TEXT PRIMARY KEY, booking_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY, actor_id TEXT, actor_role TEXT, action TEXT NOT NULL,
    booking_id TEXT, details TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY, user_id TEXT, guest_session_hash TEXT,
    context TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at INTEGER NOT NULL,
    CHECK ((user_id IS NULL) != (guest_session_hash IS NULL))
  );
  CREATE INDEX IF NOT EXISTS chat_conversations_user_expiry ON chat_conversations(user_id, expires_at, updated_at);
  CREATE INDEX IF NOT EXISTS chat_conversations_guest_expiry ON chat_conversations(guest_session_hash, expires_at, updated_at);
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    message_type TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_messages_conversation_time ON chat_messages(conversation_id, created_at);
`);

migratePricingDatabase(db);
migrateSiteContentDatabase(db);
migrateAdminAgentHistory(db);

const q = {
  records: db.prepare('SELECT payload FROM collection_records WHERE collection = ? ORDER BY rowid'),
  record: db.prepare('SELECT payload FROM collection_records WHERE collection = ? AND id = ?'),
  insert: db.prepare('INSERT INTO collection_records(collection, id, payload) VALUES (?, ?, ?)'),
  upsert: db.prepare('INSERT INTO collection_records(collection, id, payload) VALUES (?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET payload = excluded.payload'),
  deleteRecord: db.prepare('DELETE FROM collection_records WHERE collection = ? AND id = ?'),
  deleteCollection: db.prepare('DELETE FROM collection_records WHERE collection = ?'),
  version: db.prepare('SELECT version FROM collection_versions WHERE collection = ?'),
  setVersion: db.prepare('INSERT INTO collection_versions(collection, version) VALUES (?, ?) ON CONFLICT(collection) DO UPDATE SET version = excluded.version'),
  meta: db.prepare('SELECT value FROM metadata WHERE key = ?'),
  setMeta: db.prepare('INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  sessionByHash: db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?'),
  insertSession: db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  passwordResetOtpByEmail: db.prepare('SELECT * FROM password_reset_otps WHERE email = ?'),
  upsertPasswordResetOtp: db.prepare(`INSERT INTO password_reset_otps(email, user_id, otp_hash, attempts, expires_at, created_at)
    VALUES (?, ?, ?, 0, ?, ?) ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id, otp_hash = excluded.otp_hash,
    attempts = 0, expires_at = excluded.expires_at, created_at = excluded.created_at`),
  incrementPasswordResetOtpAttempts: db.prepare('UPDATE password_reset_otps SET attempts = attempts + 1 WHERE email = ?'),
  deletePasswordResetOtp: db.prepare('DELETE FROM password_reset_otps WHERE email = ?'),
  deleteExpiredPasswordResetOtps: db.prepare('DELETE FROM password_reset_otps WHERE expires_at <= ?'),
  packageImage: db.prepare('SELECT mime_type, data FROM package_images WHERE id = ?'),
  insertPackageImage: db.prepare('INSERT INTO package_images(id, mime_type, data, created_at) VALUES (?, ?, ?, ?)'),
  therapyImage: db.prepare('SELECT mime_type, data FROM therapy_images WHERE id = ?'),
  insertTherapyImage: db.prepare('INSERT INTO therapy_images(id, mime_type, data, created_at) VALUES (?, ?, ?, ?)'),
  staffInviteByToken: db.prepare('SELECT * FROM staff_invites WHERE token_hash = ?'),
  staffInvitesByEmail: db.prepare('SELECT * FROM staff_invites WHERE email = ? ORDER BY created_at DESC'),
  staffInvites: db.prepare('SELECT * FROM staff_invites ORDER BY created_at DESC'),
  upsertStaffInvite: db.prepare(`INSERT INTO staff_invites(staff_id, email, token_hash, created_by, created_at, expires_at, accepted_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(staff_id) DO UPDATE SET email = excluded.email, token_hash = excluded.token_hash,
    created_by = excluded.created_by, created_at = excluded.created_at, expires_at = excluded.expires_at, accepted_at = NULL`),
  acceptStaffInvite: db.prepare('UPDATE staff_invites SET accepted_at = ? WHERE staff_id = ? AND token_hash = ? AND accepted_at IS NULL'),
  chatConversationForUser: db.prepare("SELECT * FROM chat_conversations WHERE user_id = ? AND expires_at > ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1"),
  chatConversationForGuest: db.prepare("SELECT * FROM chat_conversations WHERE guest_session_hash = ? AND expires_at > ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1"),
  chatConversationById: db.prepare('SELECT * FROM chat_conversations WHERE id = ?'),
  insertChatConversation: db.prepare('INSERT INTO chat_conversations(id, user_id, guest_session_hash, context, status, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  updateChatConversation: db.prepare('UPDATE chat_conversations SET context = ?, updated_at = ?, expires_at = ? WHERE id = ?'),
  chatMessages: db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY rowid DESC LIMIT ?'),
  insertChatMessage: db.prepare('INSERT INTO chat_messages(id, conversation_id, role, message_type, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  pruneChatMessages: db.prepare('DELETE FROM chat_messages WHERE conversation_id = ? AND id NOT IN (SELECT id FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 80)'),
  expireChatConversations: db.prepare('DELETE FROM chat_conversations WHERE expires_at <= ?'),
  endChatConversation: db.prepare("UPDATE chat_conversations SET status = 'ended', updated_at = ? WHERE id = ?"),
  chatConversationsCount: db.prepare('SELECT COUNT(*) AS total FROM chat_conversations WHERE expires_at > ?'),
  chatMessagesCount: db.prepare('SELECT COUNT(*) AS total FROM chat_messages WHERE created_at >= ?'),
};

q.deleteExpiredSessions.run(Date.now());
q.deleteExpiredPasswordResetOtps.run(Date.now());

function transaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function parseRows(collection) { return q.records.all(collection).map((row) => JSON.parse(row.payload)); }
function getRecord(collection, id) {
  const row = q.record.get(collection, id);
  return row ? JSON.parse(row.payload) : null;
}
function saveRecord(collection, record) {
  if (collection === 'bookings') record.revision = Number(getRecord(collection, record.id)?.revision || 0) + 1;
  q.upsert.run(collection, record.id, JSON.stringify(record));
}
function removeRecord(collection, id) { q.deleteRecord.run(collection, id); }
function versionOf(collection) { return q.version.get(collection)?.version || 0; }
function nextVersion(collection) { const version = versionOf(collection) + 1; q.setVersion.run(collection, version); return version; }
function safeUser(user) {
  if (!user) return null;
  const { passwordHash: _hash, passwordSalt: _salt, salt: _oldSalt, ...safe } = user;
  return safe;
}
function visibleBooking(booking, actor) {
  if (!booking || actor?.role !== 'staff') return booking;
  const { paymentRecords: _paymentRecords, refundRequest: _refundRequest, paymentCode: _paymentCode,
    paymentExpiresAt: _paymentExpiresAt, paymentIssue: _paymentIssue,
    invoiceSnapshot: _invoiceSnapshot,
    reschedulePaymentRequest: _reschedulePaymentRequest, lastReschedulePaymentRequest: _lastReschedulePaymentRequest,
    lastReschedulePaymentStatus: _lastReschedulePaymentStatus, lastReschedulePaymentAt: _lastReschedulePaymentAt, ...safe } = booking;
  return safe;
}
function visibleCustomerBooking(booking) {
  if (!booking?.refundRequest) return booking;
  return { ...booking, refundRequest: visibleCustomerRefund(booking.refundRequest) };
}
function visibleCustomerRefund(refundRequest) {
  if (!refundRequest) return refundRequest;
  const { recipient: _recipient, ...safeRefundRequest } = refundRequest;
  return safeRefundRequest;
}

function defaultAccountPasswords(includeDemoData) {
  const adminPassword = process.env.SERENITY_TEST_ADMIN_PASSWORD || DEFAULT_STAFF_ADMIN_PASSWORD;
  const staffPassword = process.env.SERENITY_TEST_STAFF_PASSWORD || DEFAULT_STAFF_ADMIN_PASSWORD;
  const passwords = {
    'admin@example.invalid': adminPassword,
    'linh@example.invalid': staffPassword,
    'trang@example.invalid': staffPassword,
    'vy@example.invalid': staffPassword,
    'nam@example.invalid': staffPassword,
  };
  if (includeDemoData) {
    passwords['khach@example.invalid'] = process.env.SERENITY_TEST_CUSTOMER_PASSWORD || '';
    passwords['bao@example.invalid'] = process.env.SERENITY_TEST_CUSTOMER_PASSWORD || '';
  }
  return passwords;
}

function initializeDatabase() {
  if (q.meta.get('initialized')?.value === 'yes') return;
  const isProduction = process.env.NODE_ENV === 'production';
  const includeDemoData = !isProduction && String(process.env.SERENITY_SEED_DEMO_DATA || '').toLowerCase() === 'true';
  const accountPasswords = isProduction ? {} : defaultAccountPasswords(includeDemoData);
  storage.useMemory();
  seedIfNeeded({ includeDemoData, accountPasswords });
  transaction(() => {
    for (const [collection, repo] of Object.entries(repos)) {
      const records = isProduction && (collection === 'users' || collection === 'staff') ? [] : repo.getAll();
      for (const source of records) {
        let record = { ...source };
        if (collection === 'users') {
          record.passwordSalt = record.salt || randomBytes(16).toString('hex');
          const resolvedPassword = accountPasswords[record.email]
            || ((record.role === 'admin' || record.role === 'staff') ? DEFAULT_STAFF_ADMIN_PASSWORD : '');
          if (resolvedPassword) {
            record.passwordHash = scryptSync(resolvedPassword, record.passwordSalt, 64).toString('hex');
          }
          delete record.salt;
        }
        q.insert.run(collection, record.id, JSON.stringify(record));
      }
      q.setVersion.run(collection, 1);
    }
    q.setMeta.run('initialized', 'yes');
  });
}

initializeDatabase();

function migrateManagedStaffAndAdminAccounts() {
  if (process.env.NODE_ENV === 'production') return;
  const migrationKey = 'managed_staff_admin_default_password_v1';
  if (q.meta.get(migrationKey)?.value === '1') return;

  storage.useMemory();
  seedIfNeeded({ includeDemoData: false });
  const seedStaff = repos.staff.getAll();
  const passwords = defaultAccountPasswords(false);

  transaction(() => {
    let staffChanged = 0;
    for (const member of seedStaff) {
      if (!getRecord('staff', member.id)) {
        saveRecord('staff', member);
        staffChanged += 1;
      }
    }
    if (staffChanged) nextVersion('staff');

    const existingUsers = parseRows('users');
    for (const managed of DEFAULT_MANAGED_USERS) {
      const existing = existingUsers.find((u) => u.id === managed.id || u.email?.toLowerCase() === managed.email.toLowerCase());
      const password = passwords[managed.email] || DEFAULT_STAFF_ADMIN_PASSWORD;
      const passwordSalt = existing?.passwordSalt || randomBytes(16).toString('hex');
      const passwordHash = scryptSync(password, passwordSalt, 64).toString('hex');
      const updated = {
        ...managed,
        ...(existing || {}),
        id: existing?.id || managed.id,
        name: existing?.name || managed.name,
        email: managed.email,
        role: managed.role,
        ...(managed.staffId ? { staffId: managed.staffId } : {}),
        active: true,
        passwordSalt,
        passwordHash,
        createdAt: existing?.createdAt || new Date(Date.UTC(2026, 0, 1)).toISOString(),
        updatedAt: new Date().toISOString(),
      };
      delete updated.salt;
      saveRecord('users', updated);
    }
    nextVersion('users');
    q.setMeta.run(migrationKey, '1');
  });
}

migrateManagedStaffAndAdminAccounts();

function ensureProductionAdmin() {
  if (process.env.NODE_ENV !== 'production') return;
  if (parseRows('users').some((user) => user.role === 'admin' && user.active !== false)) return;

  const email = String(process.env.SERENITY_INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.SERENITY_INITIAL_ADMIN_PASSWORD || '');
  const name = String(process.env.SERENITY_INITIAL_ADMIN_NAME || 'Quản trị Serenity').trim().slice(0, 60);
  if (!email || !password) {
    throw new Error('Production database has no active admin. Set SERENITY_INITIAL_ADMIN_EMAIL and SERENITY_INITIAL_ADMIN_PASSWORD for first-time setup.');
  }
  if (!/^\S+@\S+\.\S{2,}$/.test(email) || !isStrongPassword(password) || name.length < 2) {
    throw new Error('Initial production admin settings are invalid. Check the email, display name, and password strength.');
  }
  if (parseRows('users').some((user) => user.email?.toLowerCase() === email)) {
    throw new Error('Initial production admin email already belongs to a non-admin account.');
  }

  const passwordSalt = randomBytes(16).toString('hex');
  const admin = {
    id: `usr_${randomUUID()}`, name, email, phone: '', role: 'admin', active: true,
    passwordSalt, passwordHash: scryptSync(password, passwordSalt, 64).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  transaction(() => {
    saveRecord('users', admin);
    nextVersion('users');
  });
}

ensureProductionAdmin();

function migrateAdditionalPackageSeeds() {
  const migrationKey = 'additional_package_seed_version';
  if (q.meta.get(migrationKey)?.value === '1') return;

  const seedIds = new Set(ADDITIONAL_PACKAGE_SEED_IDS);
  const packages = SERVICES_SEED.filter((service) => seedIds.has(service.id) && getServiceKind(service) === 'package');
  if (packages.length !== seedIds.size) throw new Error('Additional package seed IDs do not match package records.');

  transaction(() => {
    let inserted = 0;
    for (const service of packages) {
      if (q.record.get('services', service.id)) continue;
      const { categoryName: _categoryName, ...record } = service;
      const seedIndex = SERVICES_SEED.indexOf(service);
      saveRecord('services', {
        ...record,
        active: true,
        createdAt: new Date(Date.UTC(2026, 0, 1 + seedIndex)).toISOString(),
      });
      inserted += 1;
    }
    if (inserted) nextVersion('services');
    q.setMeta.run(migrationKey, '1');
  });
}

migrateAdditionalPackageSeeds();

function migrateAdditionalTherapySeeds() {
  const migrationKey = 'additional_therapy_seed_version';
  if (q.meta.get(migrationKey)?.value === '1') return;

  const seedIds = new Set(ADDITIONAL_THERAPY_SEED_IDS);
  const therapies = SERVICES_SEED.filter((service) => seedIds.has(service.id) && getServiceKind(service) === 'therapy');
  if (therapies.length !== seedIds.size) throw new Error('Additional therapy seed IDs do not match therapy records.');

  transaction(() => {
    let inserted = 0;
    for (const service of therapies) {
      if (q.record.get('services', service.id)) continue;
      const { categoryName: _categoryName, ...record } = service;
      const seedIndex = SERVICES_SEED.indexOf(service);
      saveRecord('services', {
        ...record,
        active: true,
        createdAt: new Date(Date.UTC(2026, 0, 1 + seedIndex)).toISOString(),
      });
      inserted += 1;
    }
    if (inserted) nextVersion('services');
    q.setMeta.run(migrationKey, '1');
  });
}

migrateAdditionalTherapySeeds();

function migrateLegacySeedServiceImages() {
  const migrationKey = 'legacy_seed_service_image_version';
  if (q.meta.get(migrationKey)?.value === '1') return;

  const replacements = new Map([
    ['foot-back-neck', 'back-massage-01'],
    ['deo-dai-nhe-chan', 'thai-stretch-01'],
  ]);
  transaction(() => {
    let updated = 0;
    for (const [serviceId, imageId] of replacements) {
      const service = getRecord('services', serviceId);
      if (!service || service.imageId !== 'foot-01') continue;
      saveRecord('services', { ...service, imageId });
      updated += 1;
    }
    if (updated) nextVersion('services');
    q.setMeta.run(migrationKey, '1');
  });
}

migrateLegacySeedServiceImages();

function migrateServiceCatalogDuplicates() {
  const migrationKey = 'service_catalog_duplicate_cleanup_version';
  if (q.meta.get(migrationKey)?.value === '1') return;

  const imageReplacements = new Map([
    ['foot-back-neck', ['foot-01', 'back-massage-01']],
    ['deo-dai-nhe-chan', ['foot-01', 'thai-stretch-01']],
    ['moc-tam-duong-sinh', ['hair-01', 'pkg-moc-tam-01']],
    ['lam-moi-tha-long', ['body-01', 'pkg-lam-moi-01']],
    ['am-da-sang-da', ['massage-02', 'pkg-am-da-01']],
    ['goi-thao-moc-cham-da', ['facial-01', 'pkg-goi-thao-moc-01']],
  ]);

  transaction(() => {
    let changed = 0;
    for (const [serviceId, [oldImageId, imageId]] of imageReplacements) {
      const service = getRecord('services', serviceId);
      if (!service || service.imageUrl || service.imageId !== oldImageId) continue;
      saveRecord('services', { ...service, imageId });
      changed += 1;
    }

    const duplicate = getRecord('services', 'luxe-escape');
    const duplicateComponents = ['foot-head-neck', 'herbal-hair-wash', 'hot-stone'];
    const sameComponents = duplicate && getServiceKind(duplicate) === 'package'
      && getPackageComponentIds(duplicate).slice().sort().join('|') === duplicateComponents.slice().sort().join('|');
    const matchesSeed = duplicate?.name === 'The Luxe Escape Retreat'
      && duplicate.duration === 180
      && duplicate.price === 1490000
      && duplicate.shortDesc === 'Trải nghiệm xa hoa 180 phút: Xông hơi thảo mộc + Ngâm bồn sữa tươi + Massage đá nóng & Bấm huyệt chân + Gội đầu dưỡng sinh.'
      && duplicate.fullDesc === 'Trải nghiệm đỉnh cao không giới hạn. Dành riêng cho các cặp đôi hoặc cá nhân muốn tận hưởng kỳ nghỉ dưỡng trọn vẹn giữa lòng Sài Gòn mà không cần đi xa.';
    if (sameComponents && matchesSeed) {
      const hasReferences = ['bookings', 'reviews', 'favorites'].some((collection) => (
        parseRows(collection).some((record) => record.serviceId === duplicate.id)
      ));
      if (hasReferences) {
        saveRecord('services', { ...duplicate, active: false, updatedAt: new Date().toISOString() });
      } else {
        removeRecord('services', duplicate.id);
      }
      changed += 1;
    }

    if (changed) nextVersion('services');
    q.setMeta.run(migrationKey, '1');
  });
}

migrateServiceCatalogDuplicates();

class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_ERROR', fields = null) {
    super(message); this.status = status; this.code = code; this.fields = fields;
  }
}

const holidaySales = createHolidaySaleOperations({ db, getRecord, parseRows, saveRecord, versionOf, nextVersion,
  transaction, withAudit, assertSlot, businessNow, normalizeVietnamPhone,
  canCollectAdjustment: () => publicPaymentConfig().enabled, HttpError });
const paymentOperations = createPaymentOperations({ db, getRecord, parseRows, saveRecord, nextVersion, transaction,
  withAudit,
  findConflict: ({ staffId, date, startTime, durationMinutes, excludeId }) => findConflict({
    staffId, date, startTime, durationMinutes, slotStep: Number(getRecord('settings', 'main')?.slotStep || 30), excludeId,
  }),
  hasRoomConflict: (booking) => activeBookings().some((other) => other.id !== booking.id
    && other.date === booking.date && Number(other.roomNumber) > 0 && Number(other.roomNumber) === Number(booking.roomNumber)
    && overlap(minOf(other.startTime), minOf(other.endTime), minOf(booking.startTime), minOf(booking.endTime))),
  finalizeReschedulePayment: holidaySales.finalizeReschedulePayment,
  HttpError,
});
const siteContent = createSiteContentOperations({ db, transaction, nextVersion, withAudit, businessNow, HttpError });
const agentHistory = createAdminAgentHistory({ db, transaction, HttpError });
agentHistory.recoverInterrupted();
agentHistory.prune();

function businessNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function normalizeVietnamPhone(value) {
  let phone = String(value || '').trim().replace(/[\s.-]/g, '');
  if (phone.startsWith('+84')) phone = `0${phone.slice(3)}`;
  return phone;
}
function isVietnamPhone(value) { return /^0(?:3|5|7|8|9)\d{8}$/.test(normalizeVietnamPhone(value)); }

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
function validDate(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
function minOf(time) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)); }
function fromMin(minute) { return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`; }
function weekday(date) { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
function absoluteMinute(date, time) { return Math.floor(Date.parse(`${date}T00:00:00Z`) / 60000) + minOf(time); }
function bookingOccupiesSlot(booking, now = Date.now()) {
  if (!ACTIVE_BOOKING_STATUSES.has(booking.status)) return false;
  const paymentExpiresAt = Date.parse(booking.paymentExpiresAt || '');
  if (booking.paymentStatus === 'awaiting_payment' && (!Number.isFinite(paymentExpiresAt) || paymentExpiresAt <= now)) return false;
  return true;
}
function activeBookings() {
  const now = Date.now();
  const bookings = parseRows('bookings');
  const active = bookings.filter((booking) => bookingOccupiesSlot(booking, now));
  const rescheduleHolds = bookings.filter((booking) => Date.parse(booking.reschedulePaymentRequest?.expiresAt || '') > now)
    .map((booking) => ({
      ...booking,
      status: 'Pending', paymentStatus: 'awaiting_payment',
      date: booking.reschedulePaymentRequest.change.date,
      startTime: booking.reschedulePaymentRequest.change.startTime,
      endTime: booking.reschedulePaymentRequest.change.endTime,
      staffId: booking.reschedulePaymentRequest.change.staffId,
      staffName: booking.reschedulePaymentRequest.change.staffName,
      roomNumber: booking.reschedulePaymentRequest.change.roomNumber,
      duration: booking.duration,
      paymentExpiresAt: booking.reschedulePaymentRequest.expiresAt,
    }));
  return [...active, ...rescheduleHolds];
}
function overlap(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && aEnd > bStart; }
function findConflict({ staffId, date, startTime, durationMinutes, slotStep, excludeId = null }) {
  const requestedStart = minOf(startTime);
  const requestedEnd = bookingLockEndMinute(requestedStart, durationMinutes, slotStep);
  return activeBookings().some((booking) => {
    if (booking.id === excludeId || booking.staffId !== staffId || booking.date !== date) return false;
    const bookingStart = minOf(booking.startTime);
    const storedDuration = Number(booking.duration);
    const actualDuration = Number.isInteger(storedDuration) && storedDuration > 0
      ? storedDuration
      : minOf(booking.endTime) - bookingStart;
    const bookingLockEnd = bookingLockEndMinute(bookingStart, actualDuration, slotStep);
    return overlap(requestedStart, requestedEnd, bookingStart, bookingLockEnd);
  });
}
function allocateRoom({ date, startTime, endTime, excludeId = null, roomCount = 0 }) {
  const capacity = Number(roomCount ?? 0);
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 100) throw new HttpError(503, 'Cài đặt số phòng chưa hợp lệ. Vui lòng báo quản trị viên.', 'SCHEDULE_INVALID');
  if (capacity <= 0) return null;
  const overlapping = activeBookings().filter((booking) => booking.id !== excludeId && booking.date === date &&
    overlap(minOf(startTime), minOf(endTime), minOf(booking.startTime), minOf(booking.endTime)));
  const used = new Set();
  let unassignedCount = 0;
  for (const booking of overlapping) {
    const roomNumber = Number(booking.roomNumber);
    if (Number.isInteger(roomNumber) && roomNumber >= 1 && roomNumber <= capacity) used.add(roomNumber);
    else unassignedCount += 1;
  }
  for (let i = 0; i < unassignedCount; i += 1) {
    const roomNumber = Array.from({ length: capacity }, (_, index) => index + 1).find((room) => !used.has(room));
    if (!roomNumber) throw new HttpError(409, 'Tất cả phòng đều đã được đặt trong khung giờ này. Vui lòng chọn giờ khác.', 'ROOM_CAPACITY');
    used.add(roomNumber);
  }
  const roomNumber = Array.from({ length: capacity }, (_, index) => index + 1).find((room) => !used.has(room));
  if (!roomNumber) throw new HttpError(409, 'Tất cả phòng đều đã được đặt trong khung giờ này. Vui lòng chọn giờ khác.', 'ROOM_CAPACITY');
  return roomNumber;
}
function assertSlot({ serviceId, duration, staffId, date, startTime, excludeId = null }) {
  if (!validDate(date) || typeof startTime !== 'string' || !timePattern.test(startTime)) throw new HttpError(400, 'Ngày hoặc giờ đặt lịch không hợp lệ.', 'INVALID_SLOT');
  if (typeof serviceId !== 'string' || !serviceId.trim()) throw new HttpError(400, 'Vui lòng chọn liệu trình hợp lệ.', 'SERVICE_INVALID');
  if (typeof staffId !== 'string' || !staffId.trim()) throw new HttpError(400, 'Vui lòng chọn chuyên viên hợp lệ.', 'STAFF_INVALID');
  if (duration != null && !['number', 'string'].includes(typeof duration)) throw new HttpError(400, 'Thời lượng liệu trình không hợp lệ.', 'INVALID_DURATION');
  const settings = getRecord('settings', 'main') || {};
  const rawService = getRecord('services', serviceId);
  const services = parseRows('services').map(normalizeServiceRecord);
  const service = normalizeServiceRecord(rawService);
  const staff = getRecord('staff', staffId);
  if (!service || !isServiceBookable(service, services)) throw new HttpError(400, 'Liệu trình hoặc gói trị liệu không còn khả dụng.', 'SERVICE_INVALID');
  if (!staff || staff.active === false) throw new HttpError(400, 'Chuyên viên không khả dụng.', 'STAFF_INVALID');
  const durationMinutes = Number(duration ?? service.duration);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) throw new HttpError(400, 'Thời lượng liệu trình không hợp lệ.', 'INVALID_DURATION');
  if (Array.isArray(service.variants) && service.variants.length && !service.variants.some((variant) => Number(variant.duration) === durationMinutes)) {
    throw new HttpError(400, 'Thời lượng này không có trong lựa chọn của dịch vụ.', 'INVALID_DURATION');
  }
  if (!Array.isArray(staff.workingDays) || !staff.workingDays.includes(weekday(date)) || (staff.daysOff || []).includes(date)) {
    throw new HttpError(400, 'Chuyên viên không làm việc vào ngày đã chọn.', 'STAFF_UNAVAILABLE');
  }
  if ((settings.closedDates || []).includes(date)) throw new HttpError(400, 'Spa đóng cửa vào ngày này.', 'SPA_CLOSED');
  if (Array.isArray(staff.specialties) && !staff.specialties.includes(service.category)) throw new HttpError(400, 'Chuyên viên không phụ trách liệu trình này.', 'STAFF_UNQUALIFIED');
  const now = businessNow();
  const maxDays = Number(settings.maxAdvanceDays ?? 60);
  const maxDate = new Date(`${now.date}T00:00:00Z`);
  maxDate.setUTCDate(maxDate.getUTCDate() + maxDays);
  if (date < now.date || date > maxDate.toISOString().slice(0, 10)) throw new HttpError(400, `Chỉ nhận lịch từ hôm nay đến trước ${maxDays} ngày.`, 'ADVANCE_LIMIT');
  const endMinute = minOf(startTime) + durationMinutes;
  const endTime = fromMin(endMinute);
  const openTime = settings.openTime || '10:00';
  const closeTime = settings.closeTime || '22:15';
  const shiftStart = staff.shiftStart || '10:00';
  const shiftEnd = staff.shiftEnd || '22:00';
  const effectiveStart = Math.max(minOf(openTime), minOf(shiftStart));
  const effectiveEnd = Math.min(minOf(closeTime), minOf(shiftEnd));
  const slotStep = Number(settings.slotStep || 30);
  if (minOf(startTime) < effectiveStart || endMinute > effectiveEnd || (minOf(startTime) - effectiveStart) % slotStep !== 0) {
    throw new HttpError(400, 'Khung giờ nằm ngoài ca làm việc hoặc không khớp bước đặt lịch.', 'OUTSIDE_WORKING_HOURS');
  }
  if (date === now.date && minOf(startTime) < now.minutes + 30) throw new HttpError(400, 'Lịch trong ngày cần đặt trước ít nhất 30 phút.', 'PAST_TIME');
  const breaks = [...(staff.breaks || [])];
  if (staff.breakStart && staff.breakEnd) breaks.push({ startTime: staff.breakStart, endTime: staff.breakEnd });
  if (breaks.some((item) => timePattern.test(item.startTime || '') && timePattern.test(item.endTime || '') &&
      overlap(minOf(startTime), endMinute, minOf(item.startTime), minOf(item.endTime)))) throw new HttpError(400, 'Khung giờ trùng với giờ nghỉ của chuyên viên.', 'STAFF_BREAK');
  if (findConflict({ staffId, date, startTime, durationMinutes, slotStep, excludeId })) {
    throw new HttpError(409, 'Chuyên viên bận giờ này. Vui lòng chọn giờ hoặc chuyên viên khác.', 'BOOKING_CONFLICT');
  }
  const roomNumber = allocateRoom({ date, startTime, endTime, excludeId, roomCount: settings.roomCount });
  const variant = service.variants?.find((item) => Number(item.duration) === durationMinutes);
  return { service, staff, duration: durationMinutes, startTime, endTime, roomNumber, originalPrice: Number(variant?.price ?? service.price) };
}

function validateServiceCollection(records) {
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new HttpError(400, 'Danh sách liệu trình có mã bị trùng.', 'DUPLICATE_SERVICE_ID');
  }
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const record of records) {
    if (record.imageUrl != null) {
      const isPackage = getServiceKind(record) === 'package';
      const validImageUrl = typeof record.imageUrl === 'string' && (isPackage
        ? /^\/api\/package-images\/[0-9a-f-]{36}$/i.test(record.imageUrl)
        : /^\/api\/therapy-images\/[0-9a-f-]{36}$/i.test(record.imageUrl));
      if (!validImageUrl) {
        throw new HttpError(400, isPackage ? 'Ảnh gói trị liệu không hợp lệ.' : 'Ảnh liệu trình không hợp lệ.',
          isPackage ? 'PACKAGE_IMAGE_INVALID' : 'THERAPY_IMAGE_INVALID');
      }
    }
    if (getServiceKind(record) !== 'package') {
      if (record.therapyGroup != null && !isTherapyGroupId(record.therapyGroup)) {
        throw new HttpError(400, `Liệu trình "${record.name || record.id}" có nhóm phân loại không hợp lệ.`, 'THERAPY_GROUP_INVALID');
      }
      continue;
    }
    if (record.category !== PACKAGE_CATEGORY_ID) throw new HttpError(400, 'Gói trị liệu phải thuộc danh mục gói.', 'PACKAGE_CATEGORY_INVALID');
    const packageVariants = Array.isArray(record.variants) && record.variants.length
      ? record.variants
      : [{ duration: record.duration, price: record.price }];
    const packageDurations = new Set();
    if (packageVariants.some((variant) => {
      const duration = Number(variant?.duration);
      const price = Number(variant?.price);
      const duplicate = packageDurations.has(duration);
      packageDurations.add(duration);
      return !Number.isInteger(duration) || duration < 15 || duration > 480 || duration % 5 !== 0
        || !Number.isInteger(price) || price < 10000 || price > 100000000 || duplicate;
    })) throw new HttpError(400, `Gói "${record.name || record.id}" có mức giá hoặc thời lượng không hợp lệ.`, 'PACKAGE_VARIANT_INVALID');
    if (!packageVariants.some((variant) => Number(variant.duration) === Number(record.duration) && Number(variant.price) === Number(record.price))) {
      throw new HttpError(400, `Mức đặt mặc định của gói "${record.name || record.id}" không khớp với danh sách mức đặt.`, 'PACKAGE_DEFAULT_VARIANT_INVALID');
    }
    const componentIds = getPackageComponentIds(record);
    const existing = getRecord('services', record.id);
    const legacyWithoutComponents = existing && existing.kind == null && !Array.isArray(existing.components);
    if (!componentIds.length) {
      // Preserve older custom package records during unrelated catalog saves; they remain hidden from booking until configured.
      if (legacyWithoutComponents) continue;
      throw new HttpError(400, `Gói "${record.name || record.id}" cần có ít nhất một liệu trình thành phần.`, 'PACKAGE_COMPONENTS_REQUIRED');
    }
    let invalidComponent = false;
    for (const componentId of componentIds) {
      const component = byId.get(componentId);
      if (!component || getServiceKind(component) !== 'therapy') {
        invalidComponent = true;
        break;
      }
      if (record.active !== false && component.active === false) {
        if (legacyWithoutComponents) {
          invalidComponent = true;
          break;
        }
        throw new HttpError(400, `Không thể bật gói "${record.name || record.id}" khi có liệu trình thành phần đã tạm ẩn.`, 'PACKAGE_COMPONENT_INACTIVE');
      }
    }
    if (invalidComponent && legacyWithoutComponents) continue;
    if (invalidComponent) throw new HttpError(400, `Gói "${record.name || record.id}" tham chiếu tới liệu trình thành phần không hợp lệ.`, 'PACKAGE_COMPONENT_INVALID');
  }
}

function withAudit(actor, action, bookingId, details = {}) {
  db.prepare('INSERT INTO audit_log(id, actor_id, actor_role, action, booking_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), actor?.id || null, actor?.role || 'guest', action, bookingId || null, JSON.stringify(details), new Date().toISOString());
}

async function createBookingForActor(body, actor) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Dữ liệu đặt lịch chưa hợp lệ.', 'VALIDATION');
  // Validate the submitted form itself before normalization or dedupe lookup. Account profile
  // values must never replace a required field that the customer cleared in the form.
  const contact = { name: body.customerName, phone: body.customerPhone, email: body.customerEmail, note: body.note };
  const result = validate(contact, schemas.customerInfo);
  if (!result.valid) throw new HttpError(400, 'Vui lòng kiểm tra lại thông tin liên hệ.', 'VALIDATION', result.errors);
  const phone = normalizeVietnamPhone(contact.phone);
  const name = contact.name.trim();
  const email = (contact.email ?? '').trim();
  const note = (contact.note ?? '').trim();
  // An idempotency token belongs to one actor; another customer cannot retrieve their booking.
  const submissionKey = String(body.submissionKey || `${phone}_${body.serviceId}_${body.date}_${body.startTime}`).slice(0, 200);
  const dedupe = `${actor.id}:${submissionKey}`;
  const previous = db.prepare('SELECT booking_id FROM booking_dedupe WHERE token = ?').get(dedupe);
  const belongsToActor = (booking) => actor.role === 'customer' ? booking?.userId === actor.id : booking?.statusHistory?.[0]?.by === actor.id;
  if (previous) {
    const booking = getRecord('bookings', previous.booking_id);
    if (!belongsToActor(booking)) throw new HttpError(409, 'Yêu cầu đặt lịch này đã được sử dụng. Vui lòng tải lại rồi thử lại.', 'SUBMISSION_CONFLICT');
    return { booking, status: 200 };
  }
  // Keep retries created before token scoping compatible, but never reveal another actor's record.
  const legacy = db.prepare('SELECT booking_id FROM booking_dedupe WHERE token = ?').get(submissionKey);
  const legacyBooking = legacy ? getRecord('bookings', legacy.booking_id) : null;
  if (belongsToActor(legacyBooking)) return { booking: legacyBooking, status: 200 };
  if (!publicPaymentConfig().enabled) {
    throw new HttpError(503, 'Thanh toán đặt lịch chưa được cấu hình an toàn. Vui lòng liên hệ Spa hoặc thử lại sau.', 'PAYMENT_NOT_CONFIGURED');
  }
  let booking;
  transaction(() => {
  const slot = assertSlot(body);
  const pricing = holidaySales.price({ serviceId: body.serviceId, duration: slot.duration, serviceDate: body.date, promoCode: body.promoCode ?? '' });
  if (body.expectedFinalPrice !== undefined && body.expectedFinalPrice !== pricing.finalPrice) {
    throw new HttpError(409, 'Giá đã thay đổi. Vui lòng xem lại giá và xác nhận đặt lịch.', 'PRICE_CHANGED');
  }
  const promo = pricing.promoCode ? parseRows('promotions').find((row) => row.code === pricing.promoCode) : null;
  const createdAt = new Date().toISOString();
  const paymentExpiresAt = new Date(Date.now() + 180 * 1000).toISOString();
  booking = {
    id: `bk_${randomUUID()}`, code: `SER-${randomBytes(4).toString('hex').toUpperCase()}`,
    userId: actor.role === 'customer' ? actor.id : null, customerName: name, customerPhone: phone, customerEmail: email,
    note, serviceId: slot.service.id, serviceName: slot.service.name,
    duration: slot.duration, staffId: slot.staff.id, staffName: slot.staff.name, roomNumber: slot.roomNumber, date: body.date, startTime: slot.startTime, endTime: slot.endTime,
    status: 'Pending', paymentStatus: 'awaiting_payment', paymentMethod: 'bank',
    paymentCode: createPaymentCode(parseRows('bookings')), paymentExpiresAt,
    promoCode: pricing.promoCode, originalPrice: pricing.originalPrice, discountAmount: pricing.discountAmount,
    finalPrice: pricing.finalPrice, pricingSnapshot: pricing, couponRedemptions: promo ? [promo.id] : [],
    paymentRecords: [], statusHistory: [{ status: 'Pending', at: new Date().toISOString(), by: actor.id }],
    createdAt, updatedAt: createdAt,
  };
    saveRecord('bookings', booking);
    db.prepare('INSERT INTO booking_dedupe(token, booking_id) VALUES (?, ?)').run(dedupe, booking.id);
    if (promo) { const updatedPromo = { ...promo, usedCount: Number(promo.usedCount || 0) + 1 }; saveRecord('promotions', updatedPromo); nextVersion('promotions'); }
    nextVersion('bookings');
    withAudit(actor, 'booking.created', booking.id, { status: booking.status });
  });
  await backupIfDue();
  return { booking, status: 201 };
}

function completeDueBookings() {
  const now = businessNow();
  const nowMinute = absoluteMinute(now.date, fromMin(now.minutes));
  const candidates = parseRows('bookings').filter((booking) => booking.status === 'CheckedIn'
    && validDate(booking.date) && typeof booking.endTime === 'string' && timePattern.test(booking.endTime)
    && absoluteMinute(booking.date, booking.endTime) <= nowMinute);
  if (!candidates.length) return 0;

  const completedAt = new Date().toISOString();
  let completedCount = 0;
  transaction(() => {
    for (const candidate of candidates) {
      const booking = getRecord('bookings', candidate.id);
      if (!booking || booking.status !== 'CheckedIn'
          || absoluteMinute(booking.date, booking.endTime) > nowMinute) continue;
      const updated = { ...booking, status: 'Completed', completedAt, updatedAt: completedAt,
        statusHistory: [...(booking.statusHistory || []), {
          status: 'Completed', at: completedAt, by: 'system', reason: 'Tự động hoàn tất sau giờ kết thúc liệu trình.'
        }] };
      saveRecord('bookings', updated);
      withAudit({ id: 'system', role: 'system' }, 'booking.completed', booking.id,
        { from: 'CheckedIn', to: 'Completed', reason: 'service_end_time_reached' });
      completedCount += 1;
    }
    if (completedCount) nextVersion('bookings');
  });
  return completedCount;
}

const loginAttempts = new Map();
function cookieValue(request, key) {
  const source = request.headers.cookie || '';
  for (const part of source.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === key) return value.join('=');
  }
  return '';
}
function actorFrom(request) {
  const token = cookieValue(request, 'serenity.sid');
  if (!token) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const stored = q.sessionByHash.get(tokenHash);
  if (!stored || stored.expires_at <= Date.now()) {
    if (stored) q.deleteSession.run(tokenHash);
    return null;
  }
  const user = getRecord('users', stored.user_id);
  if (!user || user.active === false) {
    q.deleteSession.run(tokenHash);
    return null;
  }
  return user && user.active !== false ? safeUser(user) : null;
}
function createSession(userId, response) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  q.insertSession.run(tokenHash, userId, Date.now() + SESSION_TTL_MS);
  setSessionCookie(response, token);
}
function requireActor(request, roles = []) {
  const actor = actorFrom(request);
  if (!actor) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.', 'UNAUTHORIZED');
  if (roles.length && !roles.includes(actor.role)) throw new HttpError(403, 'Tài khoản không có quyền thực hiện thao tác này.', 'FORBIDDEN');
  return actor;
}
function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `serenity.sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}
function clearSessionCookie(response) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  response.setHeader('Set-Cookie', `serenity.sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function respond(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  response.end(JSON.stringify(payload));
}
async function readBody(request, limit = 1024 * 1024) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > limit) throw new HttpError(413, `Nội dung gửi lên vượt quá giới hạn ${Math.floor(limit / 1024 / 1024)} MB.`, 'BODY_TOO_LARGE');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Dữ liệu JSON không hợp lệ.', 'INVALID_JSON'); }
}
async function readBinaryBody(request, limit = 5 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) {
      tooLarge = true;
      continue;
    }
    if (!tooLarge) chunks.push(bytes);
  }
  if (tooLarge) throw new HttpError(413, 'Ảnh vượt quá giới hạn 5 MB.', 'PACKAGE_IMAGE_TOO_LARGE');
  if (!size) throw new HttpError(400, 'Tệp ảnh đang trống.', 'PACKAGE_IMAGE_EMPTY');
  return Buffer.concat(chunks, size);
}
function hasImageSignature(bytes, mimeType) {
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
}
async function readMusicBody(request, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) {
      tooLarge = true;
      continue;
    }
    if (!tooLarge) chunks.push(bytes);
  }
  if (tooLarge) throw new HttpError(413, 'Tệp nhạc vượt quá giới hạn 25 MB.', 'MUSIC_FILE_TOO_LARGE');
  if (!size) throw new HttpError(400, 'Tệp nhạc đang trống.', 'MUSIC_FILE_EMPTY');
  return Buffer.concat(chunks, size);
}
function hasMp3Signature(bytes) {
  if (bytes.length < 4) return false;
  if (bytes.toString('ascii', 0, 3) === 'ID3') return true;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) !== 0;
}
function readMusicJson(key, fallback) {
  const raw = q.meta.get(key)?.value;
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
async function getMusicLibrary() {
  let bundled = [];
  try {
    bundled = buildMusicManifest(path.join(ROOT, 'mp3')).tracks.map((track) => ({
      id: track.id,
      title: track.title,
      filename: track.filename,
      url: `/mp3/${encodeURIComponent(track.filename)}`,
      source: 'bundled',
    }));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const uploadedRecords = readMusicJson('music_uploaded_tracks_v1', []);
  const uploaded = [];
  for (const track of Array.isArray(uploadedRecords) ? uploadedRecords : []) {
    if (!track || typeof track.id !== 'string' || typeof track.storageName !== 'string') continue;
    const file = path.resolve(MUSIC_DIRECTORY, track.storageName);
    if (!file.startsWith(`${MUSIC_DIRECTORY}${path.sep}`)) continue;
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) continue;
    uploaded.push({
      id: track.id,
      title: typeof track.title === 'string' && track.title.trim() ? track.title.trim() : track.id,
      filename: typeof track.originalName === 'string' ? track.originalName : track.storageName,
      url: `/api/music/files/${encodeURIComponent(track.id)}`,
      source: 'uploaded',
      sizeBytes: Number(track.sizeBytes) || info.size,
      createdAt: track.createdAt || null,
    });
  }

  const tracks = [...bundled, ...uploaded];
  const validIds = new Set(tracks.map((track) => track.id));
  const savedPlaylist = readMusicJson('music_playlist_ids_v1', null);
  const playlistIds = Array.isArray(savedPlaylist)
    ? savedPlaylist.filter((id, index, list) => typeof id === 'string' && validIds.has(id) && list.indexOf(id) === index)
    : tracks.map((track) => track.id);
  const revision = Number(q.meta.get('music_playlist_revision_v1')?.value) || 0;
  return { tracks, playlistIds, revision };
}
function assertOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  if (!isAllowedOrigin(origin, request)) throw new HttpError(403, 'Nguồn gửi yêu cầu không được cho phép.', 'ORIGIN_REJECTED');
}
function collectionSnapshot(actor) {
  const all = Object.fromEntries(Object.keys(repos).map((name) => [name, parseRows(name)]));
  const records = all.bookings || [];
  all.bookings = actor?.role === 'admin' ? records
    : actor?.role === 'staff' ? records.filter((row) => row.staffId === actor.staffId).map((row) => visibleBooking(row, actor))
      : actor?.role === 'customer' ? records.filter((row) => row.userId === actor.id).map(visibleCustomerBooking) : [];
  all.users = actor?.role === 'admin' ? (all.users || []).map(safeUser) : actor ? [safeUser(getRecord('users', actor.id))].filter(Boolean) : [];
  all.contacts = actor?.role === 'admin' ? all.contacts : [];
  all.favorites = actor?.role === 'customer' ? (all.favorites || []).filter((row) => row.userId === actor.id) : [];
  all.reviews = (all.reviews || []).filter((row) => row.status === 'visible' || actor?.role === 'admin');
  const now = businessNow();
  return {
    collections: all,
    holidaySales: holidaySales.list({ publicOnly: actor?.role !== 'admin' }),
    siteContent: siteContent.list({ publicOnly: actor?.role !== 'admin' }),
    currentUser: actor,
    versions: Object.fromEntries([...ADMIN_COLLECTIONS, 'holidaySales', 'siteContent'].map((name) => [name, versionOf(name)])),
    occupiedSlots: records.filter((row) => bookingOccupiesSlot(row) && row.date >= now.date)
      .map(({ id, staffId, roomNumber, date, startTime, endTime, status }) => ({ id, staffId, roomNumber, date, startTime, endTime, status })),
  };
}

const chatRateWindows = new Map();
const adminAgentConversations = new Map();
const adminAgentPendingRequests = new Set();
const adminAgentPendingConversations = new Set();
function enforceChatRateLimit(identity, now = Date.now(), limit = 20) {
  if (chatRateWindows.size > 5000) {
    for (const [key, times] of chatRateWindows) if (!times.length || now - times[times.length - 1] > 10 * 60 * 1000) chatRateWindows.delete(key);
  }
  const recent = (chatRateWindows.get(identity) || []).filter((time) => now - time < 60 * 1000);
  if (recent.length >= limit) throw new HttpError(429, 'Bạn gửi tin nhắn hơi nhanh. Vui lòng đợi một chút rồi thử lại.', 'CHAT_RATE_LIMIT');
  recent.push(now);
  chatRateWindows.set(identity, recent);
}

function managerBookingSummary(booking) {
  return {
    id: booking.id,
    code: booking.code,
    serviceName: booking.serviceName,
    date: booking.date,
    startTime: booking.startTime,
    endTime: booking.endTime,
    staffName: booking.staffName,
    roomNumber: booking.roomNumber || null,
    status: booking.status,
    finalPrice: Number(booking.finalPrice || 0),
  };
}

function managerRescheduleReply(quotes) {
  const details = quotes.map((quote) => {
    const { oldFinalPrice, newFinalPrice, priceDelta } = quote.settlement;
    const difference = priceDelta === 0 ? 'không đổi' : `${priceDelta > 0 ? 'tăng' : 'giảm'} ${formatVND(Math.abs(priceDelta))}`;
    return `Lịch ${quote.bookingCode}: ${quote.oldDate} ${quote.oldStartTime} → ${quote.change.date} ${quote.change.startTime}.\n`
      + `Giá cũ: ${formatVND(oldFinalPrice)} → Giá mới: ${formatVND(newFinalPrice)}. Chênh lệch giá: ${difference}.`;
  });
  return ['Đã chuẩn bị báo giá từ máy chủ. Lịch hẹn chưa thay đổi. Hãy xem báo giá bên dưới và bấm Xác nhận thay đổi giá để lưu.', ...details].join('\n\n');
}

function managerBookingByRef(reference) {
  const ref = String(reference || '').trim().toLocaleLowerCase('vi');
  if (!ref) throw new HttpError(400, 'Cần mã đặt lịch hoặc ID lịch hẹn.', 'BOOKING_REFERENCE_REQUIRED');
  const matches = parseRows('bookings').filter((booking) =>
    String(booking.code || '').toLocaleLowerCase('vi') === ref || String(booking.id || '').toLocaleLowerCase('vi') === ref);
  if (!matches.length) throw new HttpError(404, 'Không tìm thấy lịch hẹn theo mã hoặc ID đó.', 'NOT_FOUND');
  if (matches.length > 1) throw new HttpError(409, 'Mã tham chiếu khớp nhiều lịch. Hãy dùng mã đặt lịch đầy đủ.', 'BOOKING_REFERENCE_AMBIGUOUS');
  return matches[0];
}

function managerListBookings({ date, status, query }) {
  if (date && !validDate(String(date))) throw new HttpError(400, 'Ngày lọc phải theo định dạng YYYY-MM-DD.', 'INVALID_DATE');
  if (status && !STATUSES.has(String(status))) throw new HttpError(400, 'Trạng thái lọc không hợp lệ.', 'STATUS_INVALID');
  const search = String(query || '').trim().toLocaleLowerCase('vi').slice(0, 100);
  const matching = parseRows('bookings').filter((booking) => {
    if (date && booking.date !== date) return false;
    if (status && booking.status !== status) return false;
    if (search && ![booking.code, booking.customerName, booking.serviceName, booking.staffName]
      .some((value) => String(value || '').toLocaleLowerCase('vi').includes(search))) return false;
    return true;
  }).sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  return { total: matching.length, bookings: matching.slice(0, 15).map(managerBookingSummary), truncated: matching.length > 15 };
}

function managerListBookableServices({ query }) {
  const allServices = parseRows('services').map(normalizeServiceRecord);
  const search = String(query || '').trim().toLocaleLowerCase('vi').slice(0, 100);
  const services = allServices.filter((service) => service.active !== false && isServiceBookable(service, allServices)
    && (!search || [service.id, service.name, service.category, service.categoryName]
      .some((value) => String(value || '').toLocaleLowerCase('vi').includes(search))))
    .slice(0, 30)
    .map((service) => ({
      id: service.id,
      name: service.name,
      category: service.categoryName || service.category,
      variants: (service.variants?.length ? service.variants : [{ duration: service.duration, price: service.price }])
        .map((variant) => ({ duration: Number(variant.duration), price: Number(variant.price) }))
        .filter((variant) => Number.isInteger(variant.duration) && Number.isFinite(variant.price)),
    }));
  return { count: services.length, services };
}

function managerListActiveSpecialists({ serviceId }) {
  const service = serviceId ? normalizeServiceRecord(getRecord('services', String(serviceId))) : null;
  if (serviceId && !service) throw new HttpError(404, 'Không tìm thấy liệu trình.', 'SERVICE_INVALID');
  const staff = parseRows('staff').filter((member) => member.active !== false
    && (!service || !Array.isArray(member.specialties) || member.specialties.includes(service.category)))
    .map((member) => ({
      id: member.id,
      name: member.name,
      specialties: member.specialties || [],
      workingDays: member.workingDays || [],
      daysOff: (member.daysOff || []).slice(0, 30),
      shiftStart: member.shiftStart || null,
      shiftEnd: member.shiftEnd || null,
    }));
  return { count: staff.length, specialists: staff };
}

function managerCheckBookingSlot({ serviceId, duration, staffId, date, startTime }) {
  const slot = assertSlot({ serviceId: String(serviceId || ''), duration: Number(duration), staffId: String(staffId || ''),
    date: String(date || ''), startTime: String(startTime || '') });
  const pricing = holidaySales.price({ serviceId: slot.service.id, duration: slot.duration, serviceDate: date });
  return { available: true, serviceName: slot.service.name, specialist: slot.staff.name, date, startTime: slot.startTime,
    endTime: slot.endTime, duration: slot.duration, price: pricing.finalPrice, pricing, roomNumber: slot.roomNumber };
}

async function managerCreateBooking(args, actor, context) {
  const phonePlaceholder = /(?:đã\s+ẩn|redacted|placeholder)/i.test(String(args.customer_phone || ''));
  const phone = phonePlaceholder ? context.privateContacts.phone : '';
  if (!phone || !isVietnamPhone(phone)) {
    throw new HttpError(400, 'Cần số điện thoại khách hợp lệ để tạo lịch. Hãy gửi số trong tin nhắn; hệ thống sẽ giữ số ở máy chủ và không gửi cho AI.', 'CUSTOMER_PHONE_REQUIRED');
  }
  const emailPlaceholder = /(?:đã\s+ẩn|redacted|placeholder)/i.test(String(args.customer_email || ''));
  const email = emailPlaceholder ? context.privateContacts.email || '' : '';
  const requestHash = createHash('sha256').update(JSON.stringify([
    context.conversationId, phone, args.customer_name, args.service_id, args.duration, args.staff_id, args.date, args.start_time,
  ])).digest('hex');
  const created = await createBookingForActor({
    customerName: String(args.customer_name || ''),
    customerPhone: phone,
    customerEmail: email,
    note: '',
    serviceId: String(args.service_id || ''),
    duration: Number(args.duration),
    staffId: String(args.staff_id || ''),
    date: String(args.date || ''),
    startTime: String(args.start_time || ''),
    submissionKey: `agent_${requestHash}`,
  }, actor);
  context.privateContacts.phone = '';
  context.privateContacts.email = '';
  return { ok: true, created: created.status === 201, booking: managerBookingSummary(created.booking) };
}

async function managerUpdateBookingStatus({ bookingRef, status, reason }, actor) {
  const booking = managerBookingByRef(bookingRef);
  const nextStatus = String(status || '');
  if (!STATUSES.has(nextStatus)) throw new HttpError(400, 'Trạng thái lịch không hợp lệ.', 'STATUS_INVALID');
  const transitions = { Pending: ['Confirmed', 'Cancelled'], Confirmed: ['CheckedIn', 'Cancelled', 'NoShow'], CheckedIn: ['Completed'], Completed: [], Cancelled: [], NoShow: [] };
  if (!transitions[booking.status]?.includes(nextStatus)) {
    throw new HttpError(409, `Không thể chuyển từ ${booking.status} sang ${nextStatus}.`, 'STATUS_INVALID');
  }
  const nowBusiness = businessNow();
  if (nextStatus === 'NoShow' && absoluteMinute(nowBusiness.date, fromMin(nowBusiness.minutes)) < absoluteMinute(booking.date, booking.startTime)) {
    throw new HttpError(409, 'Chỉ ghi nhận vắng mặt sau giờ hẹn.', 'TOO_EARLY');
  }
  const safeReason = redactChatText(String(reason || '').trim()).slice(0, 300);
  const reasonText = safeReason || (nextStatus === 'Cancelled' ? 'Hủy theo yêu cầu của quản trị viên qua trợ lý.' : 'Cập nhật qua trợ lý quản lý.');
  const now = new Date().toISOString();
  const updated = {
    ...booking,
    status: nextStatus,
    updatedAt: now,
    statusHistory: [...(booking.statusHistory || []), { status: nextStatus, at: now, by: actor.id, reason: reasonText }],
    ...(nextStatus === 'Cancelled' ? { cancelledAt: now, cancelReason: reasonText } : {}),
    ...(nextStatus === 'Completed' ? { completedAt: now } : {}),
    ...(nextStatus === 'CheckedIn' ? { checkedInAt: now } : {}),
    ...(nextStatus === 'NoShow' ? { noShowAt: now } : {}),
  };
  transaction(() => {
    saveRecord('bookings', updated);
    nextVersion('bookings');
    withAudit(actor, `booking.${nextStatus.toLowerCase()}`, booking.id, { from: booking.status, to: nextStatus, reason: reasonText });
  });
  await backupIfDue();
  return { ok: true, booking: managerBookingSummary(updated) };
}

function recordAgentEffect(context, actor, field, value) {
  context[field].push(value);
  agentHistory.recordEffects(actor.id, context.conversationId, context.requestId, context);
}

function executeManagerBookingTool(name, args, actor, context) {
  if (name === 'list_sale_targets') return { categories: parseRows('categories').map(({ id, name }) => ({ id, name })), services: managerListBookableServices({}) };
  if (name === 'list_holiday_sales') return holidaySales.list({ query: args.query });
  if (name === 'preview_service_price') return holidaySales.price({ serviceId: args.service_id, duration: args.duration, serviceDate: args.service_date });
  if (name === 'list_site_content') {
    const content = siteContent.list();
    const query = String(args.query || '').trim().toLocaleLowerCase('vi');
    if (!query) return content;
    return { pages: content.pages.filter((page) => `${page.id} ${page.slug} ${page.title}`.toLocaleLowerCase('vi').includes(query)),
      menuItems: content.menuItems.filter((item) => `${item.id} ${item.label} ${item.targetHref}`.toLocaleLowerCase('vi').includes(query)) };
  }
  if (name === 'list_navigation_targets') {
    return { routes: Object.entries(SITE_MENU_ROUTES).map(([key, route]) => ({ routeKey: key, ...route })),
      pages: siteContent.list().pages.map(({ id, slug, title, status, revision }) => ({ id, slug, title, status, revision, href: `#/pages/${slug}` })),
      menuItems: siteContent.list().menuItems };
  }
  const siteRequestId = createHash('sha256').update(JSON.stringify([context.requestId, name, args], (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value)).digest('hex');
  if (name === 'create_promotion_page') {
    const result = siteContent.createPromotionPage(args, actor, { requestId: siteRequestId });
    recordAgentEffect(context, actor, 'siteChanges', { type: 'promotion_page_created', ...result });
    return result;
  }
  if (name === 'update_promotion_page') {
    const result = siteContent.updatePromotionPage(args.page_id, args.patch, actor,
      { expectedRevision: args.expected_revision, requestId: siteRequestId });
    recordAgentEffect(context, actor, 'siteChanges', { type: 'promotion_page_updated', ...result });
    return result;
  }
  if (name === 'create_menu_link') {
    const result = siteContent.createMenuLink({ label: args.label, routeKey: args.route_key, enabled: args.enabled }, actor, { requestId: siteRequestId });
    recordAgentEffect(context, actor, 'siteChanges', { type: 'menu_link_created', ...result });
    return result;
  }
  if (name === 'update_menu_link') {
    const result = siteContent.updateMenuLink(args.menu_id, args.patch, actor,
      { expectedRevision: args.expected_revision, requestId: siteRequestId });
    recordAgentEffect(context, actor, 'siteChanges', { type: 'menu_link_updated', ...result });
    return result;
  }
  if (name === 'create_holiday_sale' || name === 'update_holiday_sale') {
    const patch = args.clear_max_discount ? { ...args.patch, maxDiscountVnd: null } : args.patch;
    const encoded = JSON.stringify([context.requestId, name, args], (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
    const result = holidaySales.save(args.sale || patch, actor, { id: args.campaign_id || null,
      expectedRevision: args.expected_revision ?? 0,
      requestId: createHash('sha256').update(encoded).digest('hex') });
    recordAgentEffect(context, actor, 'actions', { type: 'holiday_sale', ...result });
    return result;
  }
  if (name === 'list_bookings') return managerListBookings({ date: args.date, status: args.status, query: args.query });
  if (name === 'get_booking') return managerBookingSummary(managerBookingByRef(args.booking_ref));
  if (name === 'list_bookable_services') return managerListBookableServices({ query: args.query });
  if (name === 'list_active_specialists') return managerListActiveSpecialists({ serviceId: args.service_id });
  if (name === 'check_booking_slot') return managerCheckBookingSlot({
    serviceId: args.service_id, duration: args.duration, staffId: args.staff_id, date: args.date, startTime: args.start_time,
  });
  if (name === 'create_booking') return managerCreateBooking(args, actor, context);
  if (name === 'update_booking_status') return managerUpdateBookingStatus({
    bookingRef: args.booking_ref, status: args.status, reason: args.reason,
  }, actor);
  if (name === 'quote_reschedule_booking' || name === 'reschedule_booking') {
    const result = holidaySales.prepareReschedule(managerBookingByRef(args.booking_ref).id,
      { date: args.date, startTime: args.start_time, staffId: args.staff_id, promoCode: args.promo_code ?? '' }, actor);
    recordAgentEffect(context, actor, 'quotes', result.quote);
    return result;
  }
  return { error: 'Unknown manager tool.' };
}

function executeAuditorBookingTool(name, args) {
  if (name === 'verify_holiday_sales') return holidaySales.list({ query: args.query });
  if (name === 'verify_list_bookings') return managerListBookings({ date: args.date, status: args.status, query: args.query });
  if (name === 'verify_get_booking') return managerBookingSummary(managerBookingByRef(args.booking_ref));
  return { error: 'Unknown auditor tool.' };
}

function pruneAdminAgentConversations(now = Date.now()) {
  for (const [key, conversation] of adminAgentConversations) {
    if (now - conversation.updatedAt > 60 * 60 * 1000) adminAgentConversations.delete(key);
  }
  while (adminAgentConversations.size > 500) adminAgentConversations.delete(adminAgentConversations.keys().next().value);
}

function extractAdminAgentContacts(message) {
  const source = String(message || '');
  const email = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const phoneMatch = source.match(/(?:\+?84|0)(?:[\s().-]*\d){8,10}/)?.[0] || '';
  let phone = phoneMatch.replace(/[^\d+]/g, '');
  if (phone.startsWith('+84')) phone = `0${phone.slice(3)}`;
  else if (phone.startsWith('84') && phone.length === 11) phone = `0${phone.slice(2)}`;
  return { phone: isVietnamPhone(phone) ? phone : '', email };
}

function setChatCookie(response, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `serenity.chat=${token}; Path=/api/chat; HttpOnly; SameSite=Lax; Max-Age=${CHAT_TTL_MS / 1000}${secure}`);
}

function chatAiAvailable() {
  return isAiConfigured(process.env);
}

function chatDebug(label, details) {
  if (process.env.NODE_ENV === 'production') return;
  console.info(`${label} ${JSON.stringify(details)}`);
}

function chatErrorLog(operation, error) {
  console.error('[CHAT ERROR]', { operation, code: error?.code || error?.name || 'UNKNOWN',
    message: redactChatText(String(error?.message || 'Unknown error')).slice(0, 300) });
}

function chatIdentity(request, response, actor) {
  let token = cookieValue(request, 'serenity.chat');
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
    token = randomBytes(32).toString('base64url');
    setChatCookie(response, token);
  }
  const guestHash = createHash('sha256').update(token).digest('hex');
  return { userId: actor?.id || null, guestHash, rateKey: actor?.id ? `user:${actor.id}` : `guest:${guestHash}` };
}

function findChatConversation(identity, now = Date.now()) {
  return identity.userId
    ? q.chatConversationForUser.get(identity.userId, now)
    : q.chatConversationForGuest.get(identity.guestHash, now);
}

function chatMessageView(row, actor) {
  const metadata = JSON.parse(row.metadata || '{}');
  const message = {
    id: row.id, role: row.role, type: row.message_type, text: row.content,
    quickReplies: Array.isArray(metadata.quickReplies) ? metadata.quickReplies : [],
    actions: Array.isArray(metadata.actions) ? metadata.actions.filter((action) => typeof action.href === 'string' && action.href.startsWith('#/')) : [],
    selectedServiceId: typeof metadata.selectedServiceId === 'string' ? metadata.selectedServiceId : null,
    services: [], bookings: [], createdAt: row.created_at,
  };
  if (Array.isArray(metadata.serviceRefs)) {
    const allServices = parseRows('services').map(normalizeServiceRecord);
    const activeServices = new Map(allServices.filter((service) => isServiceBookable(service, allServices)).map((service) => [service.id, service]));
    message.services = metadata.serviceRefs.map((reference) => {
      const service = activeServices.get(reference.serviceId);
      if (!service) return null;
      const duration = Number(reference.duration);
      const variant = [...(service.variants || []), { duration: service.duration, price: service.price }]
        .find((item) => Number(item.duration) === duration);
      if (!variant) return null;
      const serviceDate = validDate(metadata.pricingServiceDate) ? metadata.pricingServiceDate : businessNow().date;
      const pricing = holidaySales.price({ serviceId: service.id, duration: Number(variant.duration), serviceDate });
      return { id: service.id, name: service.name, kind: service.kind, category: service.category,
        imageId: service.imageId || null, ...(service.imageUrl ? { imageUrl: service.imageUrl } : {}),
        shortDesc: String(service.shortDesc || '').slice(0, 240), categoryName: service.categoryName || service.category,
        price: pricing.finalPrice, originalPrice: pricing.originalPrice, pricing, serviceDate, duration: Number(variant.duration) };
    }).filter(Boolean);
  }
  if (Array.isArray(metadata.bookingRefs) && actor?.role === 'customer') {
    message.bookings = metadata.bookingRefs.map((id) => getRecord('bookings', id))
      .filter((booking) => booking && booking.userId === actor.id)
      .map((booking) => ({ id: booking.id, code: booking.code, serviceName: booking.serviceName,
        date: booking.date, startTime: booking.startTime, status: booking.status }));
  }
  return message;
}

function chatMessagesFor(conversationId, actor) {
  return q.chatMessages.all(conversationId, 80).reverse().map((row) => chatMessageView(row, actor));
}

function persistChatMessage(conversationId, role, type, content, metadata = {}) {
  const safeMetadata = {
    pricingServiceDate: validDate(metadata.pricingServiceDate) ? metadata.pricingServiceDate : null,
    quickReplies: Array.isArray(metadata.quickReplies) ? metadata.quickReplies.slice(0, 8).map(({ label, value }) => ({
      label: String(label || '').slice(0, 60), value: String(value || '').slice(0, 120),
    })) : [],
    actions: Array.isArray(metadata.actions) ? metadata.actions.slice(0, 5).map(({ label, href }) => ({
      label: String(label || '').slice(0, 60), href: String(href || '').slice(0, 240),
    })).filter((action) => action.href.startsWith('#/')) : [],
    serviceRefs: Array.isArray(metadata.serviceRefs) ? metadata.serviceRefs.slice(0, 5).map(({ serviceId, duration }) => ({
      serviceId: String(serviceId || '').slice(0, 120), duration: Number(duration),
    })) : [],
    selectedServiceId: typeof metadata.selectedServiceId === 'string' ? metadata.selectedServiceId.slice(0, 120) : null,
    bookingRefs: Array.isArray(metadata.bookingRefs) ? metadata.bookingRefs.slice(0, 5).map((id) => String(id).slice(0, 120)) : [],
  };
  const createdAt = new Date().toISOString();
  const row = { id: `chat_${randomUUID()}`, conversation_id: conversationId, role,
    message_type: String(type || 'text').slice(0, 40), content: String(content || '').slice(0, 1600),
    metadata: JSON.stringify(safeMetadata), created_at: createdAt };
  q.insertChatMessage.run(row.id, row.conversation_id, row.role, row.message_type, row.content, row.metadata, row.created_at);
  return row;
}

function createChatConversation(identity) {
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const id = `chat_${randomUUID()}`;
  const greeting = {
    id: `chat_${randomUUID()}`, conversation_id: id, role: 'assistant', message_type: 'text',
    content: 'Xin chào! 🌸 Mình là trợ lý Serenity Spa. Bạn muốn thư giãn, chăm sóc da hay tìm hiểu liệu trình nào hôm nay?',
    metadata: JSON.stringify({ quickReplies: [
      { label: 'Cần thư giãn', value: 'Cần thư giãn' }, { label: 'Chăm sóc da', value: 'Chăm sóc da' },
      { label: 'Massage body', value: 'Massage body' }, { label: 'Tư vấn thêm', value: 'Tư vấn thêm' },
    ] }), created_at: timestamp,
  };
  transaction(() => {
    q.insertChatConversation.run(id, identity.userId, identity.userId ? null : identity.guestHash,
      JSON.stringify(emptyChatContext()), 'active', timestamp, timestamp, now + CHAT_TTL_MS);
    q.insertChatMessage.run(greeting.id, id, greeting.role, greeting.message_type, greeting.content, greeting.metadata, greeting.created_at);
  });
  return q.chatConversationById.get(id);
}

function ownsChatConversation(conversation, identity, now = Date.now()) {
  if (!conversation || conversation.expires_at <= now || conversation.status !== 'active') return false;
  if (identity.userId) return conversation.user_id === identity.userId;
  return conversation.user_id == null && conversation.guest_session_hash === identity.guestHash;
}

function businessDatePlus(days = 0) {
  const date = new Date(`${businessNow().date}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function availableChatSlots(service, date, duration) {
  const settings = getRecord('settings', 'main') || {};
  const step = Number(settings.slotStep || 30);
  if (![15, 30, 60].includes(step)) return [];
  const openMinute = minOf(settings.openTime || '10:00');
  const closeMinute = minOf(settings.closeTime || '22:15');
  const slots = [];
  for (const staff of parseRows('staff').filter((person) => person.active !== false)) {
    if (Array.isArray(staff.specialties) && !staff.specialties.includes(service.category)) continue;
    const start = Math.max(openMinute, minOf(staff.shiftStart || '10:00'));
    const end = Math.min(closeMinute, minOf(staff.shiftEnd || '22:00'));
    for (let minute = start; minute + duration <= end; minute += step) {
      const startTime = fromMin(minute);
      try {
        const result = assertSlot({ serviceId: service.id, duration, staffId: staff.id, date, startTime });
        slots.push({ date, startTime, staffId: result.staff.id, staffName: result.staff.name, duration: result.duration });
      } catch { /* A candidate rejected by the booking rules is not advertised. */ }
    }
  }
  return slots.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.staffName.localeCompare(b.staffName, 'vi'));
}

function serviceCard(service, context) {
  const variants = [...(service.variants || []), { duration: service.duration, price: service.price }]
    .map((variant) => ({ duration: Number(variant.duration), price: holidaySales.price({ serviceId: service.id,
      duration: Number(variant.duration), serviceDate: context.preferred_date || businessNow().date }).finalPrice }))
    .filter((variant) => Number.isInteger(variant.duration) && Number.isFinite(variant.price));
  const eligible = variants.filter((variant) =>
    (context.budget_min == null || variant.price >= context.budget_min) &&
    (context.budget_max == null || variant.price <= context.budget_max));
  if ((context.budget_min != null || context.budget_max != null) && !eligible.length) return null;
  const selected = (eligible.length ? eligible : variants).sort((a, b) => context.desired_duration
    ? Math.abs(a.duration - context.desired_duration) - Math.abs(b.duration - context.desired_duration) || a.price - b.price
    : a.price - b.price)[0];
  return selected ? { id: service.id, name: service.name, imageId: service.imageId || null,
    shortDesc: String(service.shortDesc || '').slice(0, 240), categoryName: service.categoryName || service.category,
    price: selected.price, duration: selected.duration } : null;
}

function safeServiceRoute(serviceId, duration, date = null, time = null, staffId = null) {
  const params = new URLSearchParams({ service: String(serviceId), duration: String(duration) });
  if (date) params.set('date', date);
  if (time) params.set('time', time);
  if (staffId) params.set('staff', staffId);
  return `#/booking?${params}`;
}

async function buildChatReply(message, previousContext, actor, identity, services, categories, history = [], preferredServiceId = null, conversationId = null) {
  const rules = classifyChatMessage(message, previousContext, services, preferredServiceId);
  const provisionalContext = rules.reset ? emptyChatContext() : mergeChatContext(previousContext, rules);
  const explicitServiceSelection = Boolean(preferredServiceId && /\bchon\b/.test(message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()));
  chatDebug('[CHAT] input', { conversationId, message: redactChatText(message), historyCount: history.length });
  chatDebug('[AI] route', { intent: rules.intent, configured: isAiConfigured(process.env) });
  let aiCriteria = null;
  let aiAttempted = false;
  const providerConfigured = isAiConfigured(process.env);
  const aiExcludedIntents = ['HUMAN_HANDOFF', 'CONTACT_SUPPORT', 'BOOKING_STATUS', 'BOOKING_CANCEL_REQUEST',
    'BOOKING_REQUEST', 'AVAILABILITY_CHECK', 'BUSINESS_HOURS', 'PROMOTION_INQUIRY', 'SPA_INFORMATION', 'OUT_OF_SCOPE', 'HEALTH_SAFETY'];
  if (providerConfigured && !explicitServiceSelection && !aiExcludedIntents.includes(rules.intent)) {
    aiAttempted = true;
    const aiKey = `${identity.rateKey}:ai`;
    try {
      enforceChatRateLimit(aiKey, Date.now(), 6);
      const activeServices = services.filter((service) => isServiceBookable(service, services));
      const candidateServices = rules.intent === 'FALLBACK' ? [] : (() => {
        const references = new Set([provisionalContext.service_id,
          ...(provisionalContext.last_recommended_services || []).map((item) => typeof item === 'string' ? item : item?.serviceId)].filter(Boolean));
        const referenced = references.size
          ? recommendServices(activeServices.filter((service) => references.has(service.id)), provisionalContext, 5)
          : [];
        const ranked = recommendServices(activeServices, provisionalContext, 5);
        return [...referenced, ...ranked.filter((service) => !references.has(service.id))].slice(0, 5);
      })();
      chatDebug('[AI] request', { model: process.env.AI_MODEL || null, messageCount: history.length + 1,
        candidateServiceCount: candidateServices.length });
      aiCriteria = await requestAiCriteria(message, provisionalContext, categories, process.env, fetch, {
        history, ruleIntent: rules.intent, candidateServices,
      });
    } catch (error) {
      chatDebug('[AI] request failed', { code: error?.code || 'AI_PROVIDER_ERROR' });
      aiCriteria = null;
    }
  }
  const context = rules.reset ? emptyChatContext() : mergeChatContext(previousContext, rules, aiCriteria);
  chatDebug('[AI] decision', { intent: aiCriteria?.intent || rules.intent, receivedReply: Boolean(aiCriteria?.assistant_reply) });
  const result = { type: 'text', text: '', quickReplies: [], actions: [], serviceRefs: [], bookingRefs: [] };
  const priceDate = context.preferred_date || businessNow().date;
  const currentSales = holidaySales.list();
  const quoteFor = (service, duration) => calculateDomainPrice({ service, duration: Number(duration), serviceDate: priceDate,
    campaigns: currentSales, evaluatedAt: new Date().toISOString() });
  const activeServices = services.filter((service) => isServiceBookable(service, services)).map((service) => ({ ...service,
    price: quoteFor(service, service.duration).finalPrice,
    variants: (service.variants?.length ? service.variants : [{ duration: service.duration, price: service.price }])
      .map((variant) => ({ ...variant, price: quoteFor(service, variant.duration).finalPrice })),
  }));
  const chosenService = activeServices.find((service) => service.id === context.service_id) || null;

  if (rules.reset || context.intent === 'GREETING') {
    context.conversation_state = 'greeting';
    context.booking_state = 'idle';
    result.text = 'Xin chào! 🌸 Bạn đang muốn thư giãn, chăm sóc da hay tìm dịch vụ theo ngân sách?';
    result.quickReplies = [
      { label: 'Cần thư giãn', value: 'Cần thư giãn' }, { label: 'Chăm sóc da', value: 'Chăm sóc da' },
      { label: 'Massage body', value: 'Massage body' }, { label: 'Tư vấn thêm', value: 'Tư vấn thêm' },
    ];
  } else if (context.intent === 'HUMAN_HANDOFF' || context.intent === 'CONTACT_SUPPORT') {
    context.conversation_state = 'support_handoff';
    context.booking_state = 'human_handoff';
    result.text = 'Mình sẽ đưa bạn đến trang liên hệ của Serenity để gửi lời nhắn cho đội ngũ tư vấn.';
    result.actions = [{ label: 'Liên hệ Serenity Spa', href: '#/contact' }];
  } else if (context.intent === 'BUSINESS_HOURS' || context.intent === 'SPA_INFORMATION') {
    const settings = getRecord('settings', 'main') || {};
    const lines = [settings.spaName || 'Serenity Spa & Wellness'];
    if (settings.address) lines.push(`Địa chỉ: ${settings.address}`);
    if (settings.openTime && settings.closeTime) lines.push(`Giờ hoạt động: ${settings.openTime}–${settings.closeTime}`);
    if (settings.phone) lines.push(`Điện thoại: ${settings.phone}`);
    result.text = lines.join('\n');
    result.actions = [{ label: 'Mở trang liên hệ', href: '#/contact' }];
  } else if (context.intent === 'PROMOTION_INQUIRY') {
    const today = businessNow().date;
    chatDebug('[TOOL] searchPromotions', { date: today });
    const promotions = parseRows('promotions').filter((promotion) => promotion.active === true
      && (!promotion.startDate || promotion.startDate <= today)
      && validDate(promotion.expiresAt) && promotion.expiresAt >= today
      && !(Number(promotion.usageLimit) > 0 && Number(promotion.usedCount) >= Number(promotion.usageLimit)));
    chatDebug('[TOOL RESULT] searchPromotions', { count: promotions.length, promotionIds: promotions.map((item) => item.id) });
    const sales = currentSales.filter((sale) => sale.enabled && sale.serviceDateFrom <= priceDate && sale.serviceDateTo >= priceDate);
    const saleLines = sales.slice(0, 5).map((sale) => `• ${sale.name}: giảm ${sale.discountType === 'percent' ? `${sale.percentageBps / 100}%` : formatVND(sale.fixedAmountVnd)}${sale.maxDiscountVnd ? `, tối đa ${formatVND(sale.maxDiscountVnd)}` : ''}${sale.scopeType === 'all' ? ' cho toàn bộ dịch vụ' : ' cho dịch vụ/danh mục được chỉ định'}.`);
    result.text = sales.length || promotions.length
      ? [`Ưu đãi cho ngày sử dụng ${priceDate}:`, ...saleLines,
        ...(promotions.length ? ['Mã giảm giá (xét điều kiện tại lúc đặt lịch):', ...promotions.slice(0, 5).map((item) => `• ${item.code}: ${item.description || 'Xem điều kiện áp dụng khi đặt lịch.'}`)] : []),
        'Sale lễ tự áp dụng cho dịch vụ phù hợp; chọn một sale có lợi nhất, sau đó cộng thêm voucher hợp lệ trên giá niêm yết. Không cộng nhiều sale.'].join('\n')
      : `Mình chưa tìm thấy ưu đãi phù hợp cho ngày sử dụng ${priceDate}.`;
  } else if (context.intent === 'BOOKING_STATUS') {
    if (actor?.role !== 'customer') {
      result.text = 'Để bảo vệ thông tin cá nhân, bạn cần đăng nhập tài khoản khách hàng để xem lịch hẹn của mình.';
      result.actions = [{ label: 'Đăng nhập', href: '#/login' }];
    } else {
      const bookings = parseRows('bookings').filter((booking) => booking.userId === actor.id)
        .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)).slice(-5).reverse();
      if (!bookings.length) result.text = 'Tài khoản của bạn hiện chưa có lịch hẹn nào.';
      else {
        result.type = 'booking_status';
        result.text = 'Đây là các lịch hẹn gần đây trong tài khoản của bạn:';
        result.bookingRefs = bookings.map((booking) => booking.id);
      }
      result.actions = [{ label: 'Mở lịch của tôi', href: '#/my-bookings' }];
    }
  } else if (context.intent === 'BOOKING_CANCEL_REQUEST') {
    context.conversation_state = 'booking_management_handoff';
    result.text = actor?.role === 'customer'
      ? 'Bạn có thể xem điều kiện và hủy hoặc đổi lịch trong trang Lịch của tôi. Hệ thống sẽ áp dụng đúng thời hạn và xác nhận hiện có.'
      : 'Đăng nhập tài khoản khách hàng để quản lý lịch hẹn của bạn. Mình không thể hủy lịch khi chưa xác thực quyền sở hữu.';
    result.actions = [{ label: actor?.role === 'customer' ? 'Mở lịch của tôi' : 'Đăng nhập', href: actor?.role === 'customer' ? '#/my-bookings' : '#/login' }];
  } else if (context.intent === 'BOOKING_REQUEST') {
    context.booking_state = 'handoff';
    if (!chosenService) {
      result.text = 'Bạn muốn đặt dịch vụ nào? Mình có thể tìm dịch vụ phù hợp trước, sau đó mở quy trình đặt lịch hiện có.';
      const recommendations = recommendServices(activeServices, context, 3);
      if (recommendations.length) {
        result.type = 'service_cards';
        result.serviceRefs = recommendations.map((service) => ({ serviceId: service.id, duration: service.duration }));
      }
    } else {
      const card = serviceCard(chosenService, context);
      if ((context.budget_min != null || context.budget_max != null) && !card) {
        result.text = `Mức giá hiện tại của ${chosenService.name} nằm ngoài khoảng ngân sách bạn chọn. Mình có thể tìm dịch vụ khác phù hợp hơn.`;
        result.quickReplies = [{ label: 'Bỏ ngân sách', value: 'Bỏ ngân sách' }];
      } else {
        result.text = `Bạn có thể tiếp tục đặt ${chosenService.name}${card ? ` (${card.duration} phút)` : ''} trong quy trình đặt lịch hiện có. Hệ thống sẽ kiểm tra lại giá và khung giờ trước khi ghi nhận.`;
        result.actions = [{ label: 'Tiếp tục đặt lịch', href: safeServiceRoute(chosenService.id, card?.duration || chosenService.duration, context.preferred_date) }];
      }
    }
  } else if (context.intent === 'AVAILABILITY_CHECK') {
    context.booking_state = 'availability_check';
    if (!chosenService) {
      context.conversation_state = 'awaiting_availability_service';
      result.text = 'Bạn muốn kiểm tra lịch trống cho dịch vụ nào? Chọn một dịch vụ bên dưới hoặc gửi tên dịch vụ.';
      const recommendations = recommendServices(activeServices, context, 3);
      result.type = recommendations.length ? 'service_cards' : 'text';
      result.serviceRefs = recommendations.map((service) => ({ serviceId: service.id, duration: service.duration }));
    } else if (!context.preferred_date) {
      context.conversation_state = 'awaiting_availability_date';
      result.text = `Bạn muốn kiểm tra ${chosenService.name} vào ngày nào?`;
      result.quickReplies = [{ label: 'Hôm nay', value: 'Hôm nay' }, { label: 'Ngày mai', value: 'Ngày mai' }];
    } else {
      const variants = [...(chosenService.variants || []), { duration: chosenService.duration }].map((item) => Number(item.duration));
      const duration = variants.includes(Number(context.desired_duration)) ? Number(context.desired_duration) : Number(chosenService.duration);
      chatDebug('[TOOL] checkAvailability', { serviceId: chosenService.id, date: context.preferred_date,
        time: context.preferred_time, duration });
      const available = availableChatSlots(chosenService, context.preferred_date, duration);
      const matches = context.preferred_time ? available.filter((slot) => slot.startTime === context.preferred_time) : available;
      chatDebug('[TOOL RESULT] checkAvailability', { serviceId: chosenService.id, date: context.preferred_date, count: matches.length });
      if (context.preferred_time && !matches.length) {
        context.conversation_state = 'awaiting_availability_time';
        result.text = `Khung ${context.preferred_time} ngày ${context.preferred_date} hiện không còn phù hợp. Bạn có thể chọn một giờ trống khác:`;
        result.quickReplies = [...new Set(available.map((slot) => slot.startTime))].slice(0, 5).map((time) => ({ label: time, value: time }));
      } else if (context.preferred_time && matches.length) {
        const slot = matches[0];
        context.employee_preference = slot.staffId;
        context.desired_duration = duration;
        context.conversation_state = 'booking_handoff';
        context.booking_state = 'handoff';
        result.text = `${chosenService.name} còn khung ${slot.startTime} ngày ${slot.date} với ${slot.staffName}. Lịch sẽ được kiểm tra lại trước khi xác nhận.`;
        result.actions = [{ label: 'Tiếp tục đặt lịch', href: safeServiceRoute(chosenService.id, duration, slot.date, slot.startTime, slot.staffId) }];
      } else if (!available.length) {
        context.conversation_state = 'awaiting_availability_date';
        result.text = `Mình chưa tìm thấy khung giờ trống cho ${chosenService.name} vào ${context.preferred_date}. Bạn có thể chọn ngày khác.`;
        result.quickReplies = [{ label: 'Ngày mai', value: 'Ngày mai' }];
      } else {
        context.conversation_state = 'awaiting_availability_time';
        const options = [...new Set(available.map((slot) => slot.startTime))].slice(0, 5);
        result.text = `Các giờ còn trống cho ${chosenService.name} vào ${context.preferred_date}: ${options.join(', ')}. Chọn giờ để tiếp tục.`;
        result.quickReplies = options.map((time) => ({ label: time, value: time }));
      }
    }
  } else if (context.intent === 'HEALTH_SAFETY') {
    result.text = 'Mình không thể chẩn đoán hoặc khẳng định một liệu trình an toàn cho tình trạng sức khỏe. Bạn nên trao đổi với chuyên viên y tế; đội ngũ Serenity có thể tư vấn thông tin dịch vụ chung.';
    result.actions = [{ label: 'Liên hệ nhân viên', href: '#/contact' }];
  } else if (context.intent === 'FALLBACK' || context.intent === 'OUT_OF_SCOPE') {
    context.conversation_state = 'general_question';
    result.text = aiAttempted
      ? 'Hiện trợ lý AI đang gặp sự cố tạm thời. Bạn có thể thử lại sau một chút.'
      : 'Trợ lý AI chưa được cấu hình để trả lời câu hỏi này. Bạn có thể thử lại sau hoặc hỏi mình về dịch vụ Serenity Spa.';
  } else if (chosenService && ['SERVICE_DETAILS', 'PRICE_INQUIRY'].includes(context.intent)) {
    const card = serviceCard(chosenService, context);
    if ((context.budget_max != null || context.budget_min != null) && !card) {
      result.text = `Mức giá hiện tại của ${chosenService.name} không nằm trong khoảng ngân sách bạn đã chọn. Mình có thể tìm lựa chọn khác phù hợp hơn.`;
    } else {
      result.type = 'service_cards';
      result.text = explicitServiceSelection
        ? `Bạn đã chọn ${chosenService.name}. Mình lấy giá và thời lượng mới nhất từ danh mục dịch vụ để bạn xem trước khi đặt lịch.`
        : `${chosenService.name} — giá và thời lượng dưới đây lấy từ danh mục dịch vụ hiện tại.`;
      result.serviceRefs = card ? [{ serviceId: card.id, duration: card.duration }] : [];
    }
  } else if (context.service_category && !context.service_focus && context.budget_max == null && context.budget_min == null && !context.desired_duration) {
    context.conversation_state = 'awaiting_budget';
    result.text = 'Mình sẽ giúp bạn tìm dịch vụ phù hợp. Bạn có thể chọn mức ngân sách trước nhé!';
    result.quickReplies = [
      { label: 'Dưới 300.000đ', value: 'Dưới 300.000đ' },
      { label: '300.000đ – 500.000đ', value: '300.000đ – 500.000đ' },
      { label: 'Trên 500.000đ', value: 'Trên 500.000đ' },
    ];
  } else if (['SERVICE_DISCOVERY', 'SERVICE_RECOMMENDATION', 'SERVICE_DETAILS', 'PRICE_INQUIRY', 'BUDGET_FILTER', 'DURATION_FILTER'].includes(context.intent)) {
    chatDebug('[TOOL] searchServices', { category: context.service_category, focus: context.service_focus,
      budgetMin: context.budget_min,
      budgetMax: context.budget_max, duration: context.desired_duration, sortBy: context.sort_by || 'relevance' });
    const recommendations = recommendServices(activeServices, context, 3);
    context.exclude_service_id = null;
    chatDebug('[TOOL RESULT] searchServices', { count: recommendations.length, serviceIds: recommendations.map((service) => service.id) });
    if (recommendations.length) {
      result.type = 'service_cards';
      result.text = context.budget_max != null
        ? `Mình tìm được ${recommendations.length} lựa chọn từ dịch vụ đang hoạt động, trong mức ngân sách bạn đưa ra.`
        : 'Đây là một số dịch vụ hiện có gần với nhu cầu của bạn. Bạn có thể xem chi tiết, kiểm tra lịch hoặc tiếp tục đặt lịch.';
      result.serviceRefs = recommendations.map((service) => ({ serviceId: service.id, duration: service.duration }));
    } else {
      context.conversation_state = 'recommendations';
      result.text = 'Mình chưa tìm thấy dịch vụ đang hoạt động khớp tất cả tiêu chí bạn chọn. Bạn có thể bỏ mức ngân sách hoặc chọn thời lượng khác để thử lại.';
      result.quickReplies = [{ label: 'Bỏ ngân sách', value: 'Bỏ ngân sách' }, { label: 'Tư vấn thêm', value: 'Tư vấn thêm' }];
    }
  } else {
    context.conversation_state = 'general_question';
    result.text = aiAttempted
      ? 'Hiện trợ lý AI đang gặp sự cố tạm thời. Bạn có thể thử lại sau một chút.'
      : 'Mình chưa hiểu rõ ý bạn. Bạn có thể nói cụ thể hơn một chút được không?';
  }

  if (result.type === 'service_cards' && result.serviceRefs.length) {
    context.last_recommended_services = result.serviceRefs.slice(0, 5);
  }
  if (explicitServiceSelection && result.serviceRefs.some((reference) => reference.serviceId === context.service_id)) {
    result.selectedServiceId = context.service_id;
  }
  const generatedIntents = new Set(['GREETING', 'SERVICE_DISCOVERY', 'SERVICE_RECOMMENDATION', 'SERVICE_DETAILS',
    'PRICE_INQUIRY', 'BUDGET_FILTER', 'DURATION_FILTER', 'FALLBACK', 'OUT_OF_SCOPE']);
  const aiReply = String(aiCriteria?.assistant_reply || '').trim();
  const aiUsed = Boolean(aiReply && generatedIntents.has(context.intent));
  if (aiUsed) result.text = aiReply;
  chatDebug('[AI FINAL]', { type: result.type, serviceCount: result.serviceRefs.length, aiUsed, aiFailed: aiAttempted && !aiReply });
  return { context, reply: result, aiUsed, aiFailed: aiAttempted && !aiReply };
}

function createChatSession(request, response) {
  const actor = actorFrom(request);
  const identity = chatIdentity(request, response, actor);
  q.expireChatConversations.run(Date.now());
  let conversation = findChatConversation(identity);
  if (!conversation) conversation = createChatConversation(identity);
  return { actor, identity, conversation };
}

async function createBackup() {
  const file = await createSqliteBackup(db, BACKUP_DIR);
  const snapshot = new DatabaseSync(file, { readOnly: true });
  try { assertSqliteIntegrity(snapshot); } finally { snapshot.close(); }
  q.setMeta.run('last_backup_date', new Date().toISOString().slice(0, 10));
  return file;
}
async function backupIfDue() {
  const today = new Date().toISOString().slice(0, 10);
  if (q.meta.get('last_backup_date')?.value !== today) await createBackup();
}

async function routeApi(request, response, url) {
  const method = request.method || 'GET';
  const pathname = url.pathname;
  if (method === 'GET' && pathname === '/api/health') return respond(response, 200, { ok: true, version: 1 });
  if (method === 'GET' && pathname === '/api/payment/config') return respond(response, 200, { payment: publicPaymentConfig() });
  if (method === 'POST' && pathname === '/api/payments/sepay/webhook') {
    if (!paymentOperations.authenticateWebhook(request.headers.authorization)) {
      throw new HttpError(401, 'Webhook SePay chưa được xác thực.', 'SEPAY_WEBHOOK_UNAUTHORIZED');
    }
    const body = await readBody(request, 32 * 1024);
    const result = paymentOperations.handleWebhook(body);
    await backupIfDue();
    return respond(response, 200, result);
  }
  if (method === 'GET' && pathname === '/api/admin/payments/reconciliation') {
    requireActor(request, ['admin']);
    return respond(response, 200, paymentOperations.reconciliation());
  }
  if (method === 'POST' && pathname === '/api/admin/payments/reconcile-unmatched') {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const body = await readBody(request, 16 * 1024);
    const updated = paymentOperations.linkUnmatchedTransaction({
      providerTransactionId: body.providerTransactionId,
      bookingId: body.bookingId,
      actor,
    });
    await backupIfDue();
    return respond(response, 200, { booking: updated });
  }
  if (method === 'POST' && pathname === '/api/admin/payments/issue-refund') {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const body = await readBody(request, 16 * 1024);
    const updated = paymentOperations.createIssueRefund({
      providerTransactionId: body.providerTransactionId,
      amount: body.amount,
      recipient: body.recipient,
      note: body.note,
      actor,
    });
    await backupIfDue();
    return respond(response, 201, { booking: updated, refundRequest: updated.refundRequest });
  }
  const refundCompleteRoute = pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/refund-complete$/);
  if (method === 'POST' && refundCompleteRoute) {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const id = decodeURIComponent(refundCompleteRoute[1]);
    const body = await readBody(request, 16 * 1024);
    const booking = getRecord('bookings', id);
    if (!booking) throw new HttpError(404, 'Không tìm thấy lịch hẹn.', 'NOT_FOUND');
    const updated = paymentOperations.markRefundComplete(booking, { referenceCode: body.referenceCode, note: body.note, actor });
    transaction(() => {
      saveRecord('bookings', updated);
      nextVersion('bookings');
      withAudit(actor, 'booking.refund.completed', id, { amount: updated.refundRequest.amount,
        referenceCode: updated.refundRequest.referenceCode });
    });
    await backupIfDue();
    return respond(response, 200, { booking: updated, refundRequest: updated.refundRequest });
  }
  const packageImageId = pathname.match(/^\/api\/package-images\/([0-9a-f-]{36})$/i)?.[1];
  if (method === 'GET' && packageImageId) {
    const image = q.packageImage.get(packageImageId);
    if (!image) throw new HttpError(404, 'Không tìm thấy ảnh gói trị liệu.', 'PACKAGE_IMAGE_NOT_FOUND');
    const bytes = Buffer.from(image.data);
    response.writeHead(200, {
      'Content-Type': image.mime_type,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    return response.end(bytes);
  }
  const therapyImageId = pathname.match(/^\/api\/therapy-images\/([0-9a-f-]{36})$/i)?.[1];
  if (method === 'GET' && therapyImageId) {
    const image = q.therapyImage.get(therapyImageId);
    if (!image) throw new HttpError(404, 'Không tìm thấy ảnh liệu trình.', 'THERAPY_IMAGE_NOT_FOUND');
    const bytes = Buffer.from(image.data);
    response.writeHead(200, {
      'Content-Type': image.mime_type,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    return response.end(bytes);
  }
  if (method === 'POST' && pathname === '/api/admin/package-images') {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const mimeType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (!['image/webp', 'image/jpeg', 'image/png'].includes(mimeType)) {
      throw new HttpError(415, 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.', 'PACKAGE_IMAGE_TYPE_INVALID');
    }
    const bytes = await readBinaryBody(request);
    if (!hasImageSignature(bytes, mimeType)) throw new HttpError(400, 'Nội dung tệp không khớp định dạng ảnh.', 'PACKAGE_IMAGE_INVALID');
    const id = randomUUID();
    transaction(() => {
      q.insertPackageImage.run(id, mimeType, bytes, new Date().toISOString());
      withAudit(actor, 'package-image.uploaded', null, { imageId: id, mimeType, sizeBytes: bytes.length });
    });
    await backupIfDue();
    return respond(response, 201, { imageUrl: `/api/package-images/${id}` });
  }
  if (method === 'POST' && pathname === '/api/admin/therapy-images') {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const mimeType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (!['image/webp', 'image/jpeg', 'image/png'].includes(mimeType)) {
      throw new HttpError(415, 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.', 'THERAPY_IMAGE_TYPE_INVALID');
    }
    const bytes = await readBinaryBody(request);
    if (!hasImageSignature(bytes, mimeType)) throw new HttpError(400, 'Nội dung tệp không khớp định dạng ảnh.', 'THERAPY_IMAGE_INVALID');
    const id = randomUUID();
    transaction(() => {
      q.insertTherapyImage.run(id, mimeType, bytes, new Date().toISOString());
      withAudit(actor, 'therapy-image.uploaded', null, { imageId: id, mimeType, sizeBytes: bytes.length });
    });
    await backupIfDue();
    return respond(response, 201, { imageUrl: `/api/therapy-images/${id}` });
  }
  if (method === 'GET' && pathname === '/api/music') {
    return respond(response, 200, await getMusicLibrary());
  }
  const uploadedMusicId = pathname.match(/^\/api\/music\/files\/(upload-[0-9a-f-]{36})$/i)?.[1];
  if ((method === 'GET' || method === 'HEAD') && uploadedMusicId) {
    const uploaded = readMusicJson('music_uploaded_tracks_v1', []);
    const track = (Array.isArray(uploaded) ? uploaded : []).find((item) => item?.id === uploadedMusicId);
    const file = track?.storageName ? path.resolve(MUSIC_DIRECTORY, track.storageName) : null;
    const fileInfo = file && file.startsWith(`${MUSIC_DIRECTORY}${path.sep}`) ? await stat(file).catch(() => null) : null;
    if (!fileInfo?.isFile()) throw new HttpError(404, 'Không tìm thấy tệp nhạc.', 'MUSIC_FILE_NOT_FOUND');
    return serveAudioFile(request, response, file, fileInfo);
  }
  if (method === 'POST' && pathname === '/api/music/import') {
    assertOrigin(request);
    const actor = requireActor(request, ['admin', 'staff']);
    const mimeType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (!['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(mimeType)) {
      throw new HttpError(415, 'Chỉ hỗ trợ tệp MP3.', 'MUSIC_FILE_TYPE_INVALID');
    }
    let filename = '';
    try { filename = decodeURIComponent(String(request.headers['x-music-filename'] || '')).trim(); }
    catch { filename = ''; }
    const baseName = path.basename(filename).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!baseName || !/\.mp3$/i.test(baseName)) throw new HttpError(400, 'Tệp tải lên phải có đuôi .mp3.', 'MUSIC_FILENAME_INVALID');
    const bytes = await readMusicBody(request);
    if (!hasMp3Signature(bytes)) throw new HttpError(400, 'Nội dung tệp không phải MP3 hợp lệ.', 'MUSIC_FILE_INVALID');
    const id = `upload-${randomUUID()}`;
    const storageName = `${id}.mp3`;
    const targetFile = path.join(MUSIC_DIRECTORY, storageName);
    const tempFile = `${targetFile}.${randomUUID()}.tmp`;
    await writeFile(tempFile, bytes);
    let handle;
    try {
      handle = await open(tempFile, 'r+');
      await handle.sync();
    } finally {
      await handle?.close();
    }
    await rename(tempFile, targetFile);
    const title = baseName.replace(/\.mp3$/i, '').trim() || id;
    const createdAt = new Date().toISOString();
    const record = { id, title, originalName: baseName, storageName, sizeBytes: bytes.length, createdAt, uploadedBy: actor.id };
    try {
      transaction(() => {
        const uploaded = readMusicJson('music_uploaded_tracks_v1', []);
        const nextUploaded = [...(Array.isArray(uploaded) ? uploaded : []), record];
        q.setMeta.run('music_uploaded_tracks_v1', JSON.stringify(nextUploaded));
        withAudit(actor, 'music.imported', null, { trackId: id, title, sizeBytes: bytes.length });
      });
    } catch (error) {
      await unlink(targetFile).catch(() => {});
      throw error;
    }
    await backupIfDue();
    return respond(response, 201, {
      track: {
        id,
        title,
        filename: baseName,
        url: `/api/music/files/${id}`,
        source: 'uploaded',
        sizeBytes: bytes.length,
        createdAt,
      },
    });
  }
  if (method === 'PUT' && pathname === '/api/music/playlist') {
    assertOrigin(request);
    const actor = requireActor(request, ['admin', 'staff']);
    const body = await readBody(request, 64 * 1024);
    if (!Array.isArray(body.trackIds) || body.trackIds.length > 500 || body.trackIds.some((id) => typeof id !== 'string')) {
      throw new HttpError(400, 'Danh sách bài hát không hợp lệ.', 'MUSIC_PLAYLIST_INVALID');
    }
    const expected = Number(request.headers['if-match']);
    const library = await getMusicLibrary();
    if (!Number.isInteger(expected) || expected !== library.revision) {
      throw new HttpError(409, 'Danh sách phát vừa được cập nhật ở thiết bị khác.', 'MUSIC_PLAYLIST_CONFLICT');
    }
    const validIds = new Set(library.tracks.map((track) => track.id));
    const playlistIds = [];
    for (const id of body.trackIds) {
      if (!validIds.has(id)) throw new HttpError(400, 'Danh sách phát có bài hát không tồn tại.', 'MUSIC_TRACK_NOT_FOUND');
      if (!playlistIds.includes(id)) playlistIds.push(id);
    }
    let revision = library.revision;
    transaction(() => {
      const currentRevision = Number(q.meta.get('music_playlist_revision_v1')?.value) || 0;
      if (expected !== currentRevision) {
        throw new HttpError(409, 'Danh sách phát vừa được cập nhật ở thiết bị khác.', 'MUSIC_PLAYLIST_CONFLICT');
      }
      revision = currentRevision + 1;
      q.setMeta.run('music_playlist_ids_v1', JSON.stringify(playlistIds));
      q.setMeta.run('music_playlist_revision_v1', String(revision));
      withAudit(actor, 'music.playlist.updated', null, { count: playlistIds.length, revision });
    });
    await backupIfDue();
    return respond(response, 200, { playlistIds, revision });
  }
  if (method === 'GET' && pathname === '/api/services') {
    try {
      return respond(response, 200, queryPublicServiceCatalog({
        searchParams: url.searchParams, services: parseRows('services'), categories: parseRows('categories'),
        campaigns: holidaySales.list({ publicOnly: true }), evaluatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      if (error instanceof ServiceCatalogQueryError) throw new HttpError(400, error.message, error.code);
      throw error;
    }
  }
  if (method === 'POST' && pathname === '/api/pricing/quote') {
    assertOrigin(request);
    const body = await readBody(request, 16 * 1024);
    return respond(response, 200, { pricing: holidaySales.price(body) });
  }
  if (pathname === '/api/admin/holiday-sales' && ['GET', 'POST'].includes(method)) {
    const actor = requireActor(request, ['admin']);
    if (method === 'GET') return respond(response, 200, { sales: holidaySales.list({ query: url.searchParams.get('q') || '' }) });
    assertOrigin(request);
    const body = await readBody(request, 64 * 1024);
    const result = holidaySales.save(body.sale, actor, { requestId: body.requestId });
    await backupIfDue();
    return respond(response, result.replayed ? 200 : 201, result);
  }
  const saleRoute = pathname.match(/^\/api\/admin\/holiday-sales\/([^/]+)$/);
  if (saleRoute && method === 'PATCH') {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const body = await readBody(request, 64 * 1024);
    const result = holidaySales.save(body.patch, actor, { id: decodeURIComponent(saleRoute[1]), expectedRevision: body.expectedRevision, requestId: body.requestId });
    await backupIfDue();
    return respond(response, 200, result);
  }
  if (method === 'GET' && pathname === '/api/admin/site-content') {
    requireActor(request, ['admin']);
    return respond(response, 200, siteContent.list());
  }
  if (method === 'GET' && pathname.startsWith('/api/site-pages/')) {
    const slug = decodeURIComponent(pathname.slice('/api/site-pages/'.length));
    const page = siteContent.getPage(slug, { publicOnly: true });
    if (!page) throw new HttpError(404, 'Không tìm thấy trang ưu đãi đang được xuất bản.', 'NOT_FOUND');
    return respond(response, 200, { page });
  }
  if (method === 'POST' && pathname === '/api/admin/site-pages/promotion') {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const body = await readBody(request, 32 * 1024);
    const result = siteContent.createPromotionPage(body.page, actor, { requestId: body.requestId });
    await backupIfDue();
    return respond(response, result.replayed ? 200 : 201, result);
  }
  const sitePageRoute = pathname.match(/^\/api\/admin\/site-pages\/([^/]+)$/);
  if (sitePageRoute && method === 'PATCH') {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const body = await readBody(request, 32 * 1024);
    const result = siteContent.updatePromotionPage(decodeURIComponent(sitePageRoute[1]), body.patch, actor,
      { expectedRevision: body.expectedRevision, requestId: body.requestId });
    await backupIfDue();
    return respond(response, 200, result);
  }
  if (pathname === '/api/admin/site-menu' && method === 'POST') {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const body = await readBody(request, 16 * 1024);
    const result = siteContent.createMenuLink(body.menuItem, actor, { requestId: body.requestId });
    await backupIfDue();
    return respond(response, result.replayed ? 200 : 201, result);
  }
  const siteMenuRoute = pathname.match(/^\/api\/admin\/site-menu\/([^/]+)$/);
  if (siteMenuRoute && method === 'PATCH') {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const body = await readBody(request, 16 * 1024);
    const result = siteContent.updateMenuLink(decodeURIComponent(siteMenuRoute[1]), body.patch, actor,
      { expectedRevision: body.expectedRevision, requestId: body.requestId });
    await backupIfDue();
    return respond(response, 200, result);
  }
  if (pathname === '/api/admin/agent/conversations' && ['GET', 'POST', 'DELETE'].includes(method)) {
    const actor = requireActor(request, ['admin']);
    if (method === 'GET') return respond(response, 200, { conversations: agentHistory.list(actor.id), retentionDays: AGENT_HISTORY_RETENTION_DAYS });
    assertOrigin(request);
    if (method === 'POST') return respond(response, 201, { conversation: agentHistory.create(actor.id) });
    if ([...adminAgentPendingConversations].some((key) => key.startsWith(`${actor.id}:`))) {
      throw new HttpError(409, 'Có yêu cầu Agent đang xử lý. Hãy đợi hoàn tất trước khi xóa lịch sử.', 'CONVERSATION_BUSY');
    }
    const result = agentHistory.remove(actor.id);
    for (const key of adminAgentConversations.keys()) if (key.startsWith(`${actor.id}:`)) adminAgentConversations.delete(key);
    return respond(response, 200, result);
  }
  const agentConversationRoute = pathname.match(/^\/api\/admin\/agent\/conversations\/([a-zA-Z0-9_-]{12,80})$/);
  if (agentConversationRoute && ['GET', 'DELETE'].includes(method)) {
    const actor = requireActor(request, ['admin']);
    const id = agentConversationRoute[1];
    const memoryKey = `${actor.id}:${id}`;
    if (method === 'GET') {
      const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : null;
      return respond(response, 200, { ...agentHistory.read(actor.id, id, { before }), busy: adminAgentPendingConversations.has(memoryKey) });
    }
    assertOrigin(request);
    if (adminAgentPendingConversations.has(memoryKey)) throw new HttpError(409, 'Hội thoại đang xử lý yêu cầu. Hãy đợi hoàn tất trước khi xóa.', 'CONVERSATION_BUSY');
    const result = agentHistory.remove(actor.id, id);
    adminAgentConversations.delete(memoryKey);
    return respond(response, 200, result);
  }
  if (method === 'POST' && pathname === '/api/admin/agent/messages') {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const body = await readBody(request, 16 * 1024);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const conversationId = String(body.conversationId || '');
    if (!message || message.length > 1200) throw new HttpError(400, 'Tin nhắn phải có từ 1 đến 1.200 ký tự.', 'MESSAGE_INVALID');
    if (!/^[a-zA-Z0-9_-]{12,80}$/.test(conversationId)) throw new HttpError(400, 'Phiên trò chuyện không hợp lệ. Hãy tải lại trang quản trị.', 'CONVERSATION_INVALID');
    const requestId = body.requestId || randomUUID();
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(requestId)) throw new HttpError(400, 'Mã yêu cầu agent không hợp lệ.', 'REQUEST_ID_REQUIRED');
    const receiptKey = `admin-agent-request:${actor.id}:${requestId}`;
    const memoryKey = `${actor.id}:${conversationId}`;
    const messageHash = createHash('sha256').update(JSON.stringify([conversationId, message])).digest('hex');
    agentHistory.prune();
    const savedReceipt = q.meta.get(receiptKey);
    if (savedReceipt) {
      const receipt = JSON.parse(savedReceipt.value);
      if (receipt.messageHash !== messageHash) throw new HttpError(409, 'Mã yêu cầu đã dùng cho nội dung khác.', 'REQUEST_CONFLICT');
      if (receipt.deleted) throw new HttpError(410, 'Lịch sử yêu cầu đã bị xóa hoặc hết hạn. Lệnh cũ sẽ không được thực hiện lại.', 'REQUEST_HISTORY_DELETED');
      return respond(response, 200, receipt.response);
    }
    if (adminAgentPendingRequests.has(receiptKey)) throw new HttpError(409, 'Yêu cầu này vẫn đang xử lý. Vui lòng thử lại cùng nội dung.', 'REQUEST_IN_PROGRESS');
    if (adminAgentPendingConversations.has(memoryKey)) throw new HttpError(409, 'Hội thoại đang có yêu cầu xử lý. Hãy đợi kết quả trước khi gửi lệnh tiếp theo.', 'CONVERSATION_BUSY');
    enforceChatRateLimit(`${actor.id}:admin-agent`, Date.now(), 10);
    agentHistory.begin(actor.id, conversationId, requestId, messageHash, message);
    const rememberReceipt = (payload) => agentHistory.finish(actor.id, conversationId, requestId, messageHash,
      payload.quotes?.length ? { ...payload, reply: managerRescheduleReply(payload.quotes) } : payload);
    if (!isSpaManagerAgentConfigured(process.env)) {
      agentHistory.markFailed(actor.id, requestId, 'Agent quản lý chưa được cấu hình AI trên máy chủ.', 'AI_NOT_CONFIGURED');
      throw new HttpError(503, 'Agent quản lý chưa được cấu hình AI trên máy chủ.', 'AI_NOT_CONFIGURED');
    }
    pruneAdminAgentConversations();
    const previous = adminAgentConversations.get(memoryKey);
    const extractedContacts = extractAdminAgentContacts(message);
    const hasNewContact = Boolean(extractedContacts.phone || extractedContacts.email);
    const savedContacts = previous && Date.now() - Number(previous.privateContactsUpdatedAt || 0) < 10 * 60 * 1000
      ? previous.privateContacts || { phone: '', email: '' }
      : { phone: '', email: '' };
    const privateContacts = {
      phone: extractedContacts.phone || savedContacts.phone || '',
      email: extractedContacts.email || savedContacts.email || '',
    };
    const privateContactsUpdatedAt = hasNewContact ? Date.now() : previous?.privateContactsUpdatedAt || Date.now();
    if (hasNewContact) {
      const contactRef = privateContacts;
      const expiresAt = privateContactsUpdatedAt;
      const expiryTimer = setTimeout(() => {
        contactRef.phone = '';
        contactRef.email = '';
        const current = adminAgentConversations.get(memoryKey);
        if (current?.privateContactsUpdatedAt === expiresAt) current.privateContacts = { phone: '', email: '' };
      }, 10 * 60 * 1000);
      expiryTimer.unref();
    }
    const agentContext = { conversationId, privateContacts, requestId, actions: [], quotes: [], siteChanges: [] };
    const safeMessage = redactChatText(message);
    let result;
    adminAgentPendingRequests.add(receiptKey);
    adminAgentPendingConversations.add(memoryKey);
    try {
      result = await runSpaManagerAgent({
        message: `Current business date in Asia/Ho_Chi_Minh: ${businessNow().date}. Use this date for relative dates such as tomorrow.\nAdmin request: ${safeMessage}`,
        history: agentHistory.history(actor.id, conversationId),
        executeManagerTool: (name, args) => executeManagerBookingTool(name, args, requireActor(request, ['admin']), agentContext),
        executeAuditorTool: executeAuditorBookingTool,
      });
    } catch (error) {
      if (agentContext.actions.length || agentContext.quotes.length || agentContext.siteChanges.length) {
        return respond(response, 200, rememberReceipt({ reply: 'Máy chủ đã xử lý các mục bên dưới. AI chưa hoàn tất phần diễn giải; hãy kiểm tra kết quả đã xác minh và báo giá cần xác nhận.',
          conversationId, actions: agentContext.actions, quotes: agentContext.quotes, siteChanges: agentContext.siteChanges }));
      }
      const failures = {
        AI_NOT_CONFIGURED: 'Agent quản lý chưa được cấu hình AI trên máy chủ.',
        AI_QUOTA_EXCEEDED: 'Hạn mức Gemini cho model hiện tại đã hết (429). Hãy kiểm tra quota/billing hoặc thử lại khi hạn mức được đặt lại.',
        AI_RATE_LIMITED: 'Gemini đang giới hạn số lượt gọi. Vui lòng thử lại sau.',
        AI_PROVIDER_UNAVAILABLE: 'Gemini hiện đang quá tải hoặc tạm thời không khả dụng. Vui lòng thử lại sau.',
        AI_PROVIDER_AUTH_ERROR: 'Gemini từ chối xác thực. Hãy kiểm tra API key đang cấu hình trên máy chủ.',
        AI_PROVIDER_TIMEOUT: 'AI chưa trả lời trong thời gian cho phép. Hãy thử lại; không phải do nội dung lệnh bị từ chối.',
        AI_NETWORK_ERROR: 'Máy chủ chưa kết nối được tới AI. Hãy kiểm tra kết nối mạng rồi thử lại.',
        AI_MODEL_NOT_FOUND: 'Model AI đang cấu hình không tồn tại hoặc tài khoản không được sử dụng model này.',
        AI_PROVIDER_REQUEST_INVALID: 'Nhà cung cấp AI từ chối cấu hình yêu cầu. Cần kiểm tra cấu hình model và công cụ trên máy chủ.',
        AGENT_OUTPUT_LIMIT: 'AI đã chạm giới hạn phản hồi nên chưa hoàn tất yêu cầu. Hãy chia yêu cầu thành từng bước nhỏ hơn.',
        AGENT_EMPTY_RESPONSE: 'AI trả về phản hồi trống. Hãy thử lại sau.',
        AGENT_TOOL_LIMIT: 'AI đề xuất quá nhiều thao tác cùng lúc. Hãy chia yêu cầu thành từng bước nhỏ hơn.',
        AGENT_TURN_LIMIT: 'Agent đã hết số vòng xử lý cho yêu cầu này. Hãy kiểm tra kết quả đã lưu trước khi gửi lệnh tiếp theo.',
        AGENT_TIMEOUT: 'Agent chưa hoàn tất yêu cầu trong thời gian cho phép. Hãy thử lại sau.',
      };
      const code = Object.hasOwn(failures, error?.message) ? error.message : 'AGENT_UNAVAILABLE';
      const failure = new HttpError(503, failures[code] || 'Agent quản lý đang bận hoặc AI chưa phản hồi. Vui lòng thử lại.', code);
      agentHistory.markFailed(actor.id, requestId, failure.message, code);
      console.warn('[spa-manager-agent] request failed', code);
      throw failure;
    } finally {
      adminAgentPendingRequests.delete(receiptKey);
      adminAgentPendingConversations.delete(memoryKey);
    }
    adminAgentConversations.set(memoryKey, {
      privateContacts,
      privateContactsUpdatedAt,
      updatedAt: Date.now(),
    });
    pruneAdminAgentConversations();
    return respond(response, 200, rememberReceipt({ reply: result.reply, conversationId, actions: agentContext.actions, quotes: agentContext.quotes, siteChanges: agentContext.siteChanges }));
  }

  if (method === 'GET' && pathname === '/api/chat/session') {
    const { actor, conversation } = createChatSession(request, response);
    let context = emptyChatContext();
    try { context = JSON.parse(conversation.context || '{}'); } catch { /* A malformed legacy context resets safely. */ }
    return respond(response, 200, { conversationId: conversation.id, context,
      messages: chatMessagesFor(conversation.id, actor), aiAvailable: chatAiAvailable() });
  }
  if (method === 'POST' && pathname === '/api/chat/reset') {
    assertOrigin(request);
    const actor = actorFrom(request);
    const identity = chatIdentity(request, response, actor);
    enforceChatRateLimit(`${identity.rateKey}:reset`, Date.now(), 5);
    const current = findChatConversation(identity);
    if (current) q.endChatConversation.run(new Date().toISOString(), current.id);
    const conversation = createChatConversation(identity);
    return respond(response, 201, { conversationId: conversation.id, context: emptyChatContext(),
      messages: chatMessagesFor(conversation.id, actor), aiAvailable: chatAiAvailable() });
  }
  if (method === 'POST' && pathname === '/api/chat/messages') {
    assertOrigin(request);
    const actor = actorFrom(request);
    const identity = chatIdentity(request, response, actor);
    enforceChatRateLimit(identity.rateKey);
    const body = await readBody(request, 12 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Tin nhắn chưa hợp lệ.', 'VALIDATION');
    if (typeof body.conversationId !== 'string' || body.conversationId.length > 100) throw new HttpError(400, 'Phiên hội thoại không hợp lệ.', 'CHAT_SESSION_INVALID');
    if (typeof body.message !== 'string') throw new HttpError(400, 'Tin nhắn cần ở dạng văn bản.', 'VALIDATION');
    const message = body.message.trim();
    if (!message) throw new HttpError(400, 'Vui lòng nhập nội dung trước khi gửi.', 'CHAT_EMPTY_MESSAGE');
    if (message.length > CHAT_MAX_MESSAGE_LENGTH) throw new HttpError(413, `Tin nhắn tối đa ${CHAT_MAX_MESSAGE_LENGTH} ký tự.`, 'CHAT_MESSAGE_TOO_LONG');
    if (body.serviceId !== undefined && (typeof body.serviceId !== 'string' || body.serviceId.length > 120)) {
      throw new HttpError(400, 'Dịch vụ được chọn chưa hợp lệ.', 'INVALID_REQUEST');
    }
    if (body.serviceDuration !== undefined && (typeof body.serviceDuration !== 'number'
      || !Number.isInteger(body.serviceDuration) || body.serviceDuration < 15 || body.serviceDuration > 480
      || !body.serviceId)) {
      throw new HttpError(400, 'Thời lượng dịch vụ được chọn chưa hợp lệ.', 'INVALID_DURATION');
    }
    const conversation = q.chatConversationById.get(body.conversationId);
    if (!ownsChatConversation(conversation, identity)) throw new HttpError(404, 'Không tìm thấy phiên hội thoại. Hãy bắt đầu cuộc trò chuyện mới.', 'CHAT_SESSION_NOT_FOUND');
    let context;
    try { context = JSON.parse(conversation.context || '{}'); } catch { context = emptyChatContext(); }
    let services;
    let categories;
    let history;
    try {
      services = parseRows('services').map(normalizeServiceRecord);
      categories = parseRows('categories').filter((category) => category.active !== false);
      history = q.chatMessages.all(conversation.id, 8).reverse()
        .map((row) => ({ role: row.role, content: row.content }));
    } catch (error) {
      chatErrorLog('load service context', error);
      throw new HttpError(503, 'Mình chưa thể tải danh sách dịch vụ lúc này.', 'DATABASE_ERROR');
    }
    const preferredServiceId = body.serviceId === undefined ? null : body.serviceId;
    if (preferredServiceId && !services.some((service) => service.id === preferredServiceId && service.active !== false)) {
      throw new HttpError(404, 'Dịch vụ đã chọn không còn hoạt động.', 'SERVICE_NOT_FOUND');
    }
    if (preferredServiceId && body.serviceDuration !== undefined) {
      const selected = services.find((service) => service.id === preferredServiceId);
      const variants = [...(selected.variants || []), { duration: selected.duration }];
      if (!variants.some((variant) => Number(variant.duration) === body.serviceDuration)) {
        throw new HttpError(400, 'Thời lượng này không có trong dịch vụ đã chọn.', 'INVALID_DURATION');
      }
      context.desired_duration = body.serviceDuration;
    }
    let chatResult;
    try {
      chatResult = await buildChatReply(message, context, actor, identity, services, categories, history,
        preferredServiceId, conversation.id);
    } catch (error) {
      chatErrorLog('process message', error);
      throw new HttpError(503, 'Mình chưa thể xử lý yêu cầu lúc này. Bạn thử lại sau một chút nhé.', 'CHAT_PROCESSING_ERROR');
    }
    const { context: nextContext, reply, aiUsed, aiFailed } = chatResult;
    const updatedAt = new Date().toISOString();
    let userRow;
    let assistantRow;
    try {
      transaction(() => {
        userRow = persistChatMessage(conversation.id, 'user', 'text', redactChatText(message));
        assistantRow = persistChatMessage(conversation.id, 'assistant', reply.type, reply.text,
          { ...reply, pricingServiceDate: nextContext.preferred_date || businessNow().date });
        q.updateChatConversation.run(JSON.stringify(nextContext), updatedAt, Date.now() + CHAT_TTL_MS, conversation.id);
        q.pruneChatMessages.run(conversation.id, conversation.id);
      });
    } catch (error) {
      chatErrorLog('persist messages', error);
      throw new HttpError(503, 'Mình chưa thể lưu cuộc trò chuyện lúc này. Bạn thử lại sau một chút nhé.', 'DATABASE_ERROR');
    }
    return respond(response, 200, { conversationId: conversation.id, context: nextContext, aiUsed, aiFailed,
      messages: [chatMessageView(userRow, actor), chatMessageView(assistantRow, actor)] });
  }
  if (method === 'GET' && pathname === '/api/bootstrap') return respond(response, 200, collectionSnapshot(actorFrom(request)));
  if (method === 'GET' && pathname === '/api/auth/session') return respond(response, 200, { user: actorFrom(request) });

  if (method === 'GET' && pathname === '/api/admin/staff-invites') {
    requireActor(request, ['admin']);
    const now = Date.now();
    const invites = new Map(q.staffInvites.all().map((invite) => [invite.staff_id, invite]));
    const accounts = new Map(parseRows('users').filter((user) => user.role === 'staff').map((user) => [user.staffId, user]));
    const staff = parseRows('staff').map((person) => {
      const invite = invites.get(person.id);
      const account = accounts.get(person.id);
      const invitationPending = invite && !invite.accepted_at && Date.parse(invite.expires_at) > now;
      const status = account && account.active !== false ? 'active'
        : invitationPending ? 'pending' : account ? 'inactive' : invite ? 'expired' : 'none';
      const email = invite && !invite.accepted_at ? invite.email : account?.email || invite?.email || '';
      return { staffId: person.id, name: person.name, email, status,
        expiresAt: invite?.expires_at || null };
    });
    return respond(response, 200, { invitations: staff });
  }

  if (method === 'GET' && pathname === '/api/auth/staff-invite') {
    const token = url.searchParams.get('token') || '';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invite = token ? q.staffInviteByToken.get(tokenHash) : null;
    if (!invite || invite.accepted_at || Date.parse(invite.expires_at) <= Date.now()) {
      throw new HttpError(410, 'Lời mời không còn hiệu lực hoặc đã được sử dụng.', 'INVITE_INVALID');
    }
    const staff = getRecord('staff', invite.staff_id);
    if (!staff || staff.active === false) throw new HttpError(410, 'Hồ sơ nhân viên không còn hoạt động.', 'INVITE_INVALID');
    return respond(response, 200, { invitation: { name: staff.name, email: invite.email, expiresAt: invite.expires_at } });
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(request);
    const email = String(body.email || '').trim().toLowerCase();
    const attemptKey = `${request.socket.remoteAddress || 'local'}:${email}`;
    const history = (loginAttempts.get(attemptKey) || []).filter((time) => Date.now() - time < 15 * 60 * 1000);
    if (history.length >= 8) throw new HttpError(429, 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.', 'LOGIN_RATE_LIMIT');
    const user = parseRows('users').find((item) => item.email.toLowerCase() === email && item.active !== false);
    const supplied = typeof body.password === 'string' ? scryptSync(body.password, user?.passwordSalt || 'invalid-user', 64).toString('hex') : '';
    if (!user || !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(user.passwordHash, 'hex'))) {
      history.push(Date.now()); loginAttempts.set(attemptKey, history);
      throw new HttpError(401, 'Gmail hoặc mật khẩu không chính xác. Vui lòng nhập lại.', 'AUTH_FAILED');
    }
    loginAttempts.delete(attemptKey);
    createSession(user.id, response);
    return respond(response, 200, { user: safeUser(user) });
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    const token = cookieValue(request, 'serenity.sid');
    if (token) q.deleteSession.run(createHash('sha256').update(token).digest('hex'));
    clearSessionCookie(response);
    return respond(response, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = await readBody(request);
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = normalizeVietnamPhone(body.phone);
    const password = String(body.password || '');
    if (name.length < 2 || name.length > 60 || !/^\S+@\S+\.\S+$/.test(email) || !isVietnamPhone(phone) || !isStrongPassword(password)) {
      throw new HttpError(400, 'Thông tin đăng ký chưa hợp lệ. Mật khẩu cần tối thiểu 8 ký tự, có ít nhất 1 chữ số và 1 ký tự đặc biệt.', 'VALIDATION');
    }
    if (parseRows('users').some((user) => user.email.toLowerCase() === email)) throw new HttpError(409, 'Email này đã được sử dụng.', 'DUPLICATE_EMAIL');
    if (parseRows('users').some((user) => user.phone === phone)) throw new HttpError(409, 'Số điện thoại này đã được sử dụng.', 'DUPLICATE_PHONE');
    const reservedInvite = q.staffInvitesByEmail.all(email).find((invite) => !invite.accepted_at && Date.parse(invite.expires_at) > Date.now());
    if (reservedInvite) throw new HttpError(409, 'Email này đang có lời mời nhân viên. Hãy mở liên kết kích hoạt trong email.', 'STAFF_INVITE_PENDING');
    const salt = randomBytes(16).toString('hex');
    const user = { id: `usr_${randomUUID()}`, name, email, phone, role: 'customer', active: true,
      passwordSalt: salt, passwordHash: scryptSync(password, salt, 64).toString('hex'), createdAt: new Date().toISOString() };
    transaction(() => { saveRecord('users', user); nextVersion('users'); });
    createSession(user.id, response);
    return respond(response, 201, { user: safeUser(user) });
  }

  if (method === 'POST' && pathname === '/api/admin/staff-invites') {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const body = await readBody(request);
    const staffId = String(body.staffId || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const staff = getRecord('staff', staffId);
    if (!staff || staff.active === false) throw new HttpError(404, 'Không tìm thấy chuyên viên đang hoạt động.', 'STAFF_INVALID');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Vui lòng nhập địa chỉ email hợp lệ.', 'VALIDATION');

    const users = parseRows('users');
    const existingStaffAccount = users.find((user) => user.role === 'staff' && user.staffId === staff.id);
    if (existingStaffAccount && existingStaffAccount.active !== false) throw new HttpError(409, 'Chuyên viên này đã có tài khoản hoạt động.', 'STAFF_ACCOUNT_EXISTS');
    const emailOwner = users.find((user) => user.email.toLowerCase() === email);
    if (emailOwner && emailOwner.id !== existingStaffAccount?.id) throw new HttpError(409, 'Email này đã được dùng cho một tài khoản khác.', 'DUPLICATE_EMAIL');
    const otherInvite = q.staffInvitesByEmail.all(email).find((invite) => invite.staff_id !== staff.id && !invite.accepted_at && Date.parse(invite.expires_at) > Date.now());
    if (otherInvite) throw new HttpError(409, 'Email này đang được dùng trong lời mời của một chuyên viên khác.', 'DUPLICATE_EMAIL');

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    transaction(() => {
      q.upsertStaffInvite.run(staff.id, email, tokenHash, actor.id, createdAt, expiresAt);
      withAudit(actor, 'staff.invite.created', null, { staffId: staff.id, email, expiresAt });
    });
    const baseOrigin = request.headers.origin ? new URL(request.headers.origin).origin : `http://${request.headers.host || 'localhost:3001'}`;
    const invitationUrl = new URL('/moi-nhan-vien', baseOrigin);
    invitationUrl.hash = `token=${encodeURIComponent(token)}`;
    return respond(response, 201, { invitation: { staffId: staff.id, name: staff.name, email, createdAt, expiresAt }, invitationUrl: invitationUrl.href });
  }

  if (method === 'POST' && pathname === '/api/auth/staff-invite/accept') {
    assertOrigin(request);
    const body = await readBody(request);
    const token = String(body.token || '');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invite = token ? q.staffInviteByToken.get(tokenHash) : null;
    if (!invite || invite.accepted_at || Date.parse(invite.expires_at) <= Date.now()) {
      throw new HttpError(410, 'Lời mời không còn hiệu lực hoặc đã được sử dụng.', 'INVITE_INVALID');
    }
    if (!isStrongPassword(body.password)) throw new HttpError(400, 'Mật khẩu cần tối thiểu 8 ký tự, có ít nhất 1 chữ số và 1 ký tự đặc biệt.', 'VALIDATION');
    const phone = normalizeVietnamPhone(body.phone);
    if (!isVietnamPhone(phone)) throw new HttpError(400, 'Vui lòng nhập số điện thoại Việt Nam hợp lệ.', 'VALIDATION');
    const staff = getRecord('staff', invite.staff_id);
    if (!staff || staff.active === false) throw new HttpError(410, 'Hồ sơ nhân viên không còn hoạt động.', 'INVITE_INVALID');

    const users = parseRows('users');
    const staffAccount = users.find((user) => user.role === 'staff' && user.staffId === staff.id);
    if (staffAccount && staffAccount.active !== false) throw new HttpError(409, 'Tài khoản nhân viên đã được kích hoạt.', 'STAFF_ACCOUNT_EXISTS');
    const emailOwner = users.find((user) => user.email.toLowerCase() === invite.email);
    if (emailOwner && emailOwner.id !== staffAccount?.id) throw new HttpError(409, 'Email này đã được dùng cho một tài khoản khác.', 'DUPLICATE_EMAIL');
    const phoneOwner = users.find((user) => user.phone === phone && user.id !== staffAccount?.id);
    if (phoneOwner) throw new HttpError(409, 'Số điện thoại này đã được dùng cho một tài khoản khác.', 'DUPLICATE_PHONE');

    const now = new Date().toISOString();
    const passwordSalt = randomBytes(16).toString('hex');
    const user = {
      ...(staffAccount || {}), id: staffAccount?.id || `usr_${randomUUID()}`, name: staff.name,
      email: invite.email, phone, role: 'staff', staffId: staff.id, active: true,
      passwordSalt, passwordHash: scryptSync(body.password, passwordSalt, 64).toString('hex'),
      createdAt: staffAccount?.createdAt || now, emailVerifiedAt: now, updatedAt: now,
    };
    transaction(() => {
      const result = q.acceptStaffInvite.run(now, staff.id, tokenHash);
      if (Number(result.changes) !== 1) throw new HttpError(410, 'Lời mời đã được sử dụng hoặc không còn hiệu lực.', 'INVITE_INVALID');
      saveRecord('users', user);
      nextVersion('users');
      withAudit(user, 'staff.invite.accepted', null, { staffId: staff.id, email: invite.email });
    });
    createSession(user.id, response);
    return respond(response, 201, { user: safeUser(user) });
  }

  if (method === 'PATCH' && pathname === '/api/auth/profile') {
    assertOrigin(request);
    const actor = requireActor(request);
    const body = await readBody(request);
    const current = getRecord('users', actor.id);
    const name = String(body.name ?? current.name).trim();
    const email = String(body.email ?? current.email).trim().toLowerCase();
    const phone = normalizeVietnamPhone(body.phone ?? current.phone);
    if (name.length < 2 || name.length > 60 || !/^\S+@\S+\.\S+$/.test(email) || !isVietnamPhone(phone)) throw new HttpError(400, 'Thông tin hồ sơ chưa hợp lệ.', 'VALIDATION');
    const users = parseRows('users');
    if (users.some((user) => user.id !== actor.id && user.email.toLowerCase() === email)) throw new HttpError(409, 'Email này đã được sử dụng.', 'DUPLICATE_EMAIL');
    if (users.some((user) => user.id !== actor.id && user.phone === phone)) throw new HttpError(409, 'Số điện thoại này đã được sử dụng.', 'DUPLICATE_PHONE');
    const updated = { ...current, name, email, phone, updatedAt: new Date().toISOString() };
    transaction(() => { saveRecord('users', updated); nextVersion('users'); });
    return respond(response, 200, { user: safeUser(updated) });
  }

  if (method === 'POST' && pathname === '/api/auth/change-password') {
    assertOrigin(request);
    const actor = requireActor(request);
    const body = await readBody(request);
    const current = getRecord('users', actor.id);
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!oldPassword) {
      throw new HttpError(400, 'Vui lòng nhập mật khẩu hiện tại.', 'VALIDATION', { oldPassword: 'Vui lòng nhập mật khẩu hiện tại.' });
    }
    const currentHash = scryptSync(oldPassword, current.passwordSalt, 64).toString('hex');
    if (!timingSafeEqual(Buffer.from(currentHash, 'hex'), Buffer.from(current.passwordHash, 'hex'))) {
      throw new HttpError(401, 'Mật khẩu hiện tại không chính xác.', 'AUTH_FAILED', { oldPassword: 'Mật khẩu hiện tại không chính xác.' });
    }
    if (!isStrongPassword(newPassword)) {
      throw new HttpError(400, 'Mật khẩu mới cần tối thiểu 8 ký tự, có ít nhất 1 chữ số và 1 ký tự đặc biệt.', 'VALIDATION', {
        newPassword: 'Mật khẩu mới cần tối thiểu 8 ký tự, có ít nhất 1 chữ số và 1 ký tự đặc biệt.',
      });
    }
    if (body.confirmPassword !== undefined && newPassword !== String(body.confirmPassword || '')) {
      throw new HttpError(400, 'Mật khẩu xác nhận không khớp.', 'VALIDATION', { confirmPassword: 'Mật khẩu xác nhận không khớp.' });
    }
    if (oldPassword === newPassword) {
      throw new HttpError(400, 'Mật khẩu mới phải khác mật khẩu hiện tại.', 'VALIDATION', { newPassword: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
    }
    const salt = randomBytes(16).toString('hex');
    transaction(() => {
      saveRecord('users', {
        ...current,
        passwordSalt: salt,
        passwordHash: scryptSync(newPassword, salt, 64).toString('hex'),
        updatedAt: new Date().toISOString(),
      });
      nextVersion('users');
      withAudit(actor, 'auth.password.changed', null, { userId: actor.id });
    });
    return respond(response, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/auth/forgot-password/request') {
    assertOrigin(request);
    const body = await readBody(request);
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw new HttpError(400, 'Vui lòng nhập địa chỉ email hợp lệ.', 'VALIDATION', { email: 'Vui lòng nhập địa chỉ email hợp lệ.' });
    }
    q.deleteExpiredPasswordResetOtps.run(Date.now());
    const user = parseRows('users').find((item) => item.email?.toLowerCase() === email && item.active !== false);
    if (!user) {
      throw new HttpError(404, 'Không tìm thấy tài khoản hoạt động với địa chỉ email này.', 'USER_NOT_FOUND', {
        email: 'Không tìm thấy tài khoản hoạt động với địa chỉ email này.',
      });
    }
    const otp = String(randomInt(100000, 1000000));
    const otpHash = scryptSync(otp, email, 64).toString('hex');
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const createdAt = new Date().toISOString();

    try {
      await sendPasswordResetOtpEmail({ to: user.email, name: user.name, otp, expiresInMinutes: 10 });
    } catch (error) {
      const code = error.code === 'SMTP_NOT_CONFIGURED' ? 'SMTP_NOT_CONFIGURED' : 'SMTP_SEND_FAILED';
      throw new HttpError(503, error.message || 'Không thể gửi email mã OTP lúc này.', code);
    }

    transaction(() => {
      q.upsertPasswordResetOtp.run(email, user.id, otpHash, expiresAt, createdAt);
      withAudit(user, 'auth.password_reset.otp_sent', null, { email, expiresAt: new Date(expiresAt).toISOString() });
    });

    return respond(response, 200, {
      ok: true,
      email: user.email,
      expiresInSeconds: 600,
      message: 'Mã xác thực OTP gồm 6 chữ số đã được gửi tới email của bạn.',
    });
  }

  if (method === 'POST' && pathname === '/api/auth/forgot-password/reset') {
    assertOrigin(request);
    const body = await readBody(request);
    const email = String(body.email || '').trim().toLowerCase();
    const otp = String(body.otp || '').trim();
    const newPassword = String(body.newPassword || '');
    const confirmPassword = body.confirmPassword !== undefined ? String(body.confirmPassword || '') : newPassword;

    const fieldErrors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fieldErrors.email = 'Vui lòng nhập địa chỉ email hợp lệ.';
    if (!/^\d{6}$/.test(otp)) fieldErrors.otp = 'Mã OTP phải gồm đúng 6 chữ số.';
    if (!isStrongPassword(newPassword)) {
      fieldErrors.newPassword = 'Mật khẩu mới cần tối thiểu 8 ký tự, có ít nhất 1 chữ số và 1 ký tự đặc biệt.';
    } else if (newPassword !== confirmPassword) {
      fieldErrors.confirmPassword = 'Mật khẩu xác nhận không khớp.';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new HttpError(400, Object.values(fieldErrors)[0], 'VALIDATION', fieldErrors);
    }

    q.deleteExpiredPasswordResetOtps.run(Date.now());
    const otpRecord = q.passwordResetOtpByEmail.get(email);
    if (!otpRecord || otpRecord.expires_at <= Date.now()) {
      q.deletePasswordResetOtp.run(email);
      throw new HttpError(400, 'Mã OTP không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã mới.', 'OTP_INVALID', {
        otp: 'Mã OTP không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã mới.',
      });
    }
    if (Number(otpRecord.attempts) >= 5) {
      q.deletePasswordResetOtp.run(email);
      throw new HttpError(429, 'Bạn đã nhập sai mã OTP quá 5 lần. Vui lòng yêu cầu gửi lại mã mới.', 'OTP_MAX_ATTEMPTS', {
        otp: 'Bạn đã nhập sai mã OTP quá 5 lần. Vui lòng yêu cầu gửi lại mã mới.',
      });
    }

    const suppliedHash = scryptSync(otp, email, 64).toString('hex');
    if (!timingSafeEqual(Buffer.from(suppliedHash, 'hex'), Buffer.from(otpRecord.otp_hash, 'hex'))) {
      q.incrementPasswordResetOtpAttempts.run(email);
      throw new HttpError(400, 'Mã xác thực OTP không chính xác.', 'OTP_INVALID', {
        otp: 'Mã xác thực OTP không chính xác.',
      });
    }

    const user = getRecord('users', otpRecord.user_id) || parseRows('users').find((item) => item.email?.toLowerCase() === email);
    if (!user || user.active === false) {
      q.deletePasswordResetOtp.run(email);
      throw new HttpError(404, 'Tài khoản không tồn tại hoặc đã ngừng hoạt động.', 'USER_NOT_FOUND');
    }

    const salt = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    transaction(() => {
      saveRecord('users', {
        ...user,
        passwordSalt: salt,
        passwordHash: scryptSync(newPassword, salt, 64).toString('hex'),
        updatedAt: now,
      });
      nextVersion('users');
      q.deletePasswordResetOtp.run(email);
      q.deleteUserSessions.run(user.id);
      withAudit(user, 'auth.password_reset.completed', null, { email });
    });

    loginAttempts.delete(`${request.socket.remoteAddress || 'local'}:${email}`);
    return respond(response, 200, {
      ok: true,
      message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.',
    });
  }

  if (method === 'GET' && pathname === '/api/bookings') {
    const actor = actorFrom(request);
    if (actor?.role === 'admin') return respond(response, 200, { bookings: parseRows('bookings') });
    if (actor?.role === 'customer') return respond(response, 200, { bookings: parseRows('bookings').filter((booking) => booking.userId === actor.id).map(visibleCustomerBooking) });
    if (actor?.role === 'staff') return respond(response, 200, { bookings: parseRows('bookings').filter((booking) => booking.staffId === actor.staffId).map((booking) => visibleBooking(booking, actor)) });
    const phone = normalizeVietnamPhone(url.searchParams.get('phone'));
    if (!isVietnamPhone(phone)) return respond(response, 200, { bookings: [] });
    return respond(response, 200, { bookings: parseRows('bookings').filter((booking) => booking.userId == null && booking.customerPhone === phone).map(visibleCustomerBooking) });
  }

  const bookingInvoiceRoute = pathname.match(/^\/api\/bookings\/([^/]+)\/invoice$/);
  if (method === 'GET' && bookingInvoiceRoute) {
    const actor = requireActor(request, ['admin', 'customer']);
    const id = decodeURIComponent(bookingInvoiceRoute[1]);
    const booking = getRecord('bookings', id);
    if (!booking || (actor.role === 'customer' && booking.userId !== actor.id)) {
      throw new HttpError(404, 'Không tìm thấy hóa đơn thanh toán.', 'NOT_FOUND');
    }
    if (!booking.invoiceSnapshot && booking.paymentStatus !== 'paid') {
      throw new HttpError(409, 'Hóa đơn chỉ có sau khi thanh toán được xác nhận đầy đủ.', 'INVOICE_NOT_READY');
    }
    const firstPayment = (booking.paymentRecords || []).find((record) => record.type === 'payment' && record.refundable !== false);
    const invoiceSnapshot = booking.invoiceSnapshot || {
      number: `HD-${booking.code || booking.id}`,
      issuedAt: booking.paymentPaidAt || firstPayment?.at || booking.updatedAt || booking.createdAt,
      customer: { name: booking.customerName || '', phone: booking.customerPhone || '', email: booking.customerEmail || '' },
      booking: {
        code: booking.code || '', serviceName: booking.serviceName || '', date: booking.date || '',
        startTime: booking.startTime || '', endTime: booking.endTime || '', duration: Number(booking.duration) || 0,
        staffName: booking.staffName || '', roomNumber: booking.roomNumber || null,
        originalPrice: Number(booking.originalPrice) || 0, discountAmount: Number(booking.discountAmount) || 0,
        total: Number(booking.finalPrice) || 0,
      },
      payment: {
        method: firstPayment?.method === 'cash' ? 'Tiền mặt' : firstPayment?.method === 'bank' ? 'Chuyển khoản ngân hàng' : 'Thanh toán',
        amount: Number(firstPayment?.amount) || Number(booking.finalPrice) || 0,
        reference: String(firstPayment?.reference || booking.paymentCode || booking.code || ''),
        paidAt: firstPayment?.at || booking.paymentPaidAt || booking.updatedAt || booking.createdAt,
      },
    };
    const settings = getRecord('settings', 'main') || {};
    return respond(response, 200, { invoice: {
      ...invoiceSnapshot,
      merchant: {
        name: settings.spaName || 'Serenity Spa & Wellness',
        address: settings.address || '', phone: settings.phone || '', email: settings.email || '',
      },
    } });
  }

  const bookingPaymentRoute = pathname.match(/^\/api\/bookings\/([^/]+)\/payment$/);
  if (method === 'GET' && bookingPaymentRoute) {
    const actor = requireActor(request);
    if (!['admin', 'customer'].includes(actor.role)) throw new HttpError(403, 'Tài khoản không có quyền xem thanh toán.', 'FORBIDDEN');
    const id = decodeURIComponent(bookingPaymentRoute[1]);
    const booking = getRecord('bookings', id);
    if (!booking || (actor.role === 'customer' && booking.userId !== actor.id)) throw new HttpError(404, 'Không tìm thấy lịch thanh toán.', 'NOT_FOUND');
    const expiredCount = paymentOperations.expirePendingPayments();
    const current = getRecord('bookings', id) || booking;
    if (expiredCount) await backupIfDue();
    const mayPay = current.status === 'Pending' && current.paymentStatus === 'awaiting_payment'
      && Date.parse(current.paymentExpiresAt || '') > Date.now();
    const adjustment = current.reschedulePaymentRequest;
    const adjustmentMayPay = adjustment && Date.parse(adjustment.expiresAt || '') > Date.now();
    const instructions = adjustmentMayPay
      ? paymentInstructions(current, process.env, { amount: adjustment.amount, expiresAt: adjustment.expiresAt })
      : mayPay ? paymentInstructions(current) : null;
    return respond(response, 200, { payment: paymentOperations.paymentStatusFor(current), instructions });
  }

  if (method === 'POST' && pathname === '/api/bookings') {
    assertOrigin(request);
    const actor = actorFrom(request);
    if (!actor) throw new HttpError(401, 'Vui lòng đăng nhập tài khoản trước khi đặt lịch.', 'UNAUTHORIZED');
    if (actor.role === 'staff') throw new HttpError(403, 'Tài khoản nhân viên không thể đặt lịch khách.', 'FORBIDDEN');
    if (!['customer', 'admin'].includes(actor.role)) throw new HttpError(403, 'Tài khoản không có quyền đặt lịch.', 'FORBIDDEN');
    const body = await readBody(request);
    const created = await createBookingForActor(body, actor);
    return respond(response, created.status, { booking: created.booking, payment: paymentInstructions(created.booking) });
  }

  const rescheduleRoute = pathname.match(/^\/api\/bookings\/([^/]+)\/reschedule\/(quote|confirm)$/);
  if (method === 'POST' && rescheduleRoute) {
    assertOrigin(request);
    const body = await readBody(request, 16 * 1024);
    const id = decodeURIComponent(rescheduleRoute[1]);
    const actor = actorFrom(request);
    const result = rescheduleRoute[2] === 'quote' ? holidaySales.prepareReschedule(id, body, actor) : holidaySales.confirmReschedule(id, body, actor);
    if (rescheduleRoute[2] === 'confirm') await backupIfDue();
    const payment = result.paymentRequired ? paymentInstructions(result.booking, process.env, {
      amount: result.paymentAmount, expiresAt: result.paymentExpiresAt,
    }) : null;
    const safeResult = actor?.role === 'admin' ? result : {
      ...result, ...(result.booking ? { booking: visibleCustomerBooking(result.booking) } : {}),
      ...(result.refundRequest ? { refundRequest: visibleCustomerRefund(result.refundRequest) } : {}),
    };
    return respond(response, 200, { ...safeResult, payment });
  }
  const bookingRoute = pathname.match(/^\/api\/bookings\/([^/]+)\/(status|cancel|reschedule)$/);
  if (bookingRoute && ['PATCH', 'POST'].includes(method)) {
    assertOrigin(request);
    const id = decodeURIComponent(bookingRoute[1]);
    const action = bookingRoute[2];
    const body = await readBody(request);
    let booking = getRecord('bookings', id);
    if (!booking) throw new HttpError(404, 'Không tìm thấy lịch hẹn.', 'NOT_FOUND');
    if (booking.reschedulePaymentRequest
      && Date.parse(booking.reschedulePaymentRequest.expiresAt || '') <= Date.now()) {
      paymentOperations.expirePendingPayments();
      booking = getRecord('bookings', id) || booking;
    }
    const actor = actorFrom(request);
    if (action === 'status') {
      if (!actor || !['admin', 'staff'].includes(actor.role) || (actor.role === 'staff' && actor.staffId !== booking.staffId)) throw new HttpError(403, 'Bạn không có quyền cập nhật lịch này.', 'FORBIDDEN');
      if (booking.reschedulePaymentRequest) throw new HttpError(409, 'Đang chờ thanh toán chênh lệch; hãy đợi mã hết hạn trước khi đổi trạng thái lịch.', 'RESCHEDULE_PAYMENT_PENDING');
      const nextStatus = String(body.status || '');
      if (!STATUSES.has(nextStatus)) throw new HttpError(400, 'Trạng thái lịch không hợp lệ.', 'STATUS_INVALID');
      const transitions = { Pending: ['Confirmed', 'Cancelled'], Confirmed: ['CheckedIn', 'Cancelled', 'NoShow'], CheckedIn: ['Completed'], Completed: [], Cancelled: [], NoShow: [] };
      if (!transitions[booking.status]?.includes(nextStatus)) throw new HttpError(409, `Không thể chuyển từ ${booking.status} sang ${nextStatus}.`, 'STATUS_INVALID');
      if (nextStatus === 'Cancelled' && booking.refundRequest?.status === 'pending') throw new HttpError(409, 'Đơn đang có yêu cầu hoàn tiền cần xử lý trước khi hủy.', 'REFUND_PENDING');
      if (nextStatus === 'Confirmed' && booking.paymentCode && booking.paymentStatus !== 'paid') {
        throw new HttpError(409, 'Lịch đặt QR chỉ được xác nhận sau khi SePay ghi nhận đủ tiền.', 'PAYMENT_REQUIRED');
      }
      if (nextStatus === 'NoShow' && absoluteMinute(businessNow().date, fromMin(businessNow().minutes)) < absoluteMinute(booking.date, booking.startTime)) throw new HttpError(409, 'Chỉ ghi nhận vắng mặt sau giờ hẹn.', 'TOO_EARLY');
      const now = new Date().toISOString();
      const updated = { ...booking, status: nextStatus, updatedAt: now,
        statusHistory: [...(booking.statusHistory || []), { status: nextStatus, at: now, by: actor.id, reason: String(body.reason || '').slice(0, 300) }],
        ...(nextStatus === 'Cancelled' ? { cancelledAt: now, cancelReason: String(body.reason || '').slice(0, 300) } : {}),
        ...(nextStatus === 'Completed' ? { completedAt: now } : {}),
        ...(nextStatus === 'CheckedIn' ? { checkedInAt: now } : {}),
        ...(nextStatus === 'NoShow' ? { noShowAt: now } : {}),
      };
      transaction(() => {
        if (nextStatus === 'Cancelled') paymentOperations.releaseCouponForUnpaidBooking(booking);
        saveRecord('bookings', updated); nextVersion('bookings');
        withAudit(actor, `booking.${nextStatus.toLowerCase()}`, id, { from: booking.status, to: nextStatus, reason: updated.cancelReason || '' });
      });
      await backupIfDue();
      return respond(response, 200, { booking: visibleBooking(updated, actor) });
    }
    if (action === 'cancel') {
      const isOwner = actor?.role === 'customer' && booking.userId === actor.id;
      const guestPhone = normalizeVietnamPhone(body.phone);
      const isGuest = !actor && !booking.userId && guestPhone && booking.customerPhone === guestPhone;
      if (actor?.role !== 'admin' && !isOwner && !isGuest) throw new HttpError(403, 'Bạn không có quyền hủy lịch hẹn này.', 'FORBIDDEN');
      if (booking.reschedulePaymentRequest) throw new HttpError(409, 'Đang chờ thanh toán chênh lệch dời lịch. Vui lòng chờ mã hết hạn rồi thử hủy lại.', 'RESCHEDULE_PAYMENT_PENDING');
      if (!['Pending', 'Confirmed'].includes(booking.status)) throw new HttpError(409, 'Lịch này không còn ở trạng thái có thể hủy.', 'STATUS_INVALID');
      if (booking.refundRequest?.status === 'pending') throw new HttpError(409, 'Đơn đang có yêu cầu hoàn tiền cần xử lý trước khi hủy.', 'REFUND_PENDING');
      const settings = getRecord('settings', 'main') || {};
      const now = businessNow();
      const limit = Number(settings.cancelBeforeHours ?? 2) * 60;
      if (absoluteMinute(booking.date, booking.startTime) - absoluteMinute(now.date, fromMin(now.minutes)) < limit) throw new HttpError(409, `Cần hủy trước giờ hẹn tối thiểu ${limit / 60} tiếng.`, 'CANCEL_TOO_LATE');
      const records = Array.isArray(booking.paymentRecords) ? booking.paymentRecords : [];
      const collected = records.filter((record) => record.type !== 'refund' && record.refundable !== false).reduce((sum, record) => sum + Number(record.amount || 0), 0);
      const refunded = records.filter((record) => record.type === 'refund').reduce((sum, record) => sum + Number(record.amount || 0), 0);
      const paidAmount = Math.max(0, collected - refunded);
      let refundRequest = null;
      if (paidAmount > 0) {
        const recipient = body.refundRecipient;
        const bankName = String(recipient?.bankName || '').trim().slice(0, 80);
        const accountHolder = String(recipient?.accountHolder || '').trim().toUpperCase().slice(0, 80);
        const accountNumber = String(recipient?.accountNumber || '').replace(/\D/g, '');
        if (!bankName || !/^[\p{L} ]{5,80}$/u.test(accountHolder) || !/^\d{6,19}$/.test(accountNumber)) {
          throw new HttpError(400, 'Để hoàn tiền, vui lòng nhập ngân hàng, số tài khoản và tên chủ tài khoản hợp lệ.', 'REFUND_RECIPIENT_INVALID');
        }
        refundRequest = {
          id: `rfd_${randomUUID()}`,
          kind: 'customer_cancellation_50',
          amount: Math.round(paidAmount / 2),
          paidAmount,
          status: 'pending',
          requestedAt: new Date().toISOString(),
          recipient: { bankName, accountHolder, accountNumber },
          note: 'Hoàn 50% số tiền thực nhận theo chính sách hủy lịch.',
        };
      }
      const cancelledAt = new Date().toISOString();
      const updated = { ...booking, status: 'Cancelled',
        ...(booking.paymentStatus === 'awaiting_payment' ? { paymentStatus: 'cancelled' } : {}),
        ...(refundRequest ? { refundRequest } : {}),
        cancelReason: 'Khách hàng yêu cầu hủy lịch.', cancelledAt, updatedAt: cancelledAt,
        statusHistory: [...(booking.statusHistory || []), { status: 'Cancelled', at: cancelledAt, by: actor?.id || 'guest', reason: 'Khách hàng yêu cầu hủy lịch.' }] };
      transaction(() => {
        paymentOperations.releaseCouponForUnpaidBooking(booking);
        saveRecord('bookings', updated); nextVersion('bookings');
        withAudit(actor, 'booking.cancelled', id, { reason: updated.cancelReason,
          refundAmount: refundRequest?.amount || 0, refundRecipientLast4: refundRequest?.recipient.accountNumber.slice(-4) || null });
      });
      await backupIfDue();
      return respond(response, 200, { booking: actor?.role === 'admin' ? updated : visibleCustomerBooking(updated) });
    }
    if (action === 'reschedule') {
      holidaySales.authorize(booking, actor, body.phone);
      throw new HttpError(428, 'Hãy lấy báo giá và bấm Xác nhận thay đổi giá để dời lịch.', 'QUOTE_REQUIRED');
    }
  }

  const paymentRoute = pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/payments$/);
  if (method === 'POST' && paymentRoute) {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const id = decodeURIComponent(paymentRoute[1]);
    const body = await readBody(request);
    const booking = getRecord('bookings', id);
    if (!booking) throw new HttpError(404, 'Không tìm thấy lịch hẹn.', 'NOT_FOUND');
    const type = String(body.type || '');
    const amount = Number(body.amount);
    const methodName = String(body.method || '');
    if (!['deposit', 'payment', 'refund'].includes(type)) throw new HttpError(400, 'Loại giao dịch không hợp lệ.', 'PAYMENT_TYPE_INVALID');
    if (type === 'refund') throw new HttpError(409, 'Hoàn tiền theo chính sách 50% phải được ghi nhận trong tab Đối Soát QR / Hoàn Tiền.', 'REFUND_FLOW_REQUIRED');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'Số tiền phải là số nguyên dương theo VND.', 'PAYMENT_AMOUNT_INVALID');
    if (!['cash', 'bank', 'momo', 'card', 'other'].includes(methodName)) throw new HttpError(400, 'Phương thức thanh toán không hợp lệ.', 'PAYMENT_METHOD_INVALID');
    const records = Array.isArray(booking.paymentRecords) ? booking.paymentRecords : [];
    const collected = records.filter((record) => record.type !== 'refund').reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const refunded = records.filter((record) => record.type === 'refund').reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const outstanding = Number(booking.finalPrice || 0) - (collected - refunded);
    if (type === 'refund' && amount > collected - refunded) throw new HttpError(409, 'Số hoàn không được vượt quá tiền đã thu còn lại.', 'REFUND_EXCEEDS_PAID');
    if (type !== 'refund' && amount > outstanding) throw new HttpError(409, 'Số thu vượt quá số tiền khách còn phải trả.', 'PAYMENT_EXCEEDS_TOTAL');
    const entry = {
      id: `pay_${randomUUID()}`, type, amount, method: methodName,
      reference: String(body.reference || '').trim().slice(0, 120),
      note: String(body.note || '').trim().slice(0, 300),
      at: new Date().toISOString(), recordedBy: actor.id,
    };
    const updated = { ...booking, paymentRecords: [...records, entry], updatedAt: new Date().toISOString() };
    transaction(() => { saveRecord('bookings', updated); nextVersion('bookings'); withAudit(actor, `booking.payment.${type}`, id, { amount, method: methodName }); });
    await backupIfDue();
    return respond(response, 201, { booking: updated, payment: entry });
  }

  if (method === 'PUT' && pathname.startsWith('/api/admin/collections/')) {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const collection = decodeURIComponent(pathname.slice('/api/admin/collections/'.length));
    if (!ADMIN_COLLECTIONS.has(collection)) throw new HttpError(404, 'Danh mục dữ liệu không được hỗ trợ.', 'NOT_FOUND');
    const body = await readBody(request, collection === 'staff' ? 8 * 1024 * 1024 : 1024 * 1024);
    if (!Array.isArray(body.records) || body.records.length > 1000 || body.records.some((record) => !record || typeof record.id !== 'string')) throw new HttpError(400, 'Danh sách dữ liệu không hợp lệ.', 'VALIDATION');
    const expected = Number(request.headers['if-match']);
    const current = versionOf(collection);
    if (!Number.isInteger(expected) || expected !== current) throw new HttpError(409, 'Dữ liệu đã được thay đổi ở thiết bị khác. Vui lòng tải lại rồi thử lại.', 'VERSION_CONFLICT');
    if (collection === 'services') validateServiceCollection(body.records);
    transaction(() => {
      q.deleteCollection.run(collection);
      for (const record of body.records) q.insert.run(collection, record.id, JSON.stringify(record));
      const version = nextVersion(collection);
      withAudit(actor, `collection.${collection}.updated`, null, { count: body.records.length, version });
    });
    await backupIfDue();
    return respond(response, 200, { version: versionOf(collection) });
  }

  if ((method === 'POST' || method === 'GET') && pathname.startsWith('/api/admin/backup')) {
    requireActor(request, ['admin']);
    const file = await createBackup();
    if (method === 'POST') return respond(response, 201, { name: path.basename(file), createdAt: new Date().toISOString() });
    response.writeHead(200, { 'Content-Type': 'application/vnd.sqlite3', 'Content-Disposition': `attachment; filename="${path.basename(file)}"`, 'Content-Length': String((await stat(file)).size) });
    return createReadStream(file).pipe(response);
  }

  if (method === 'POST' && pathname === '/api/contacts') {
    assertOrigin(request);
    const body = await readBody(request);
    const contact = { id: `ct_${randomUUID()}`, name: String(body.name || '').trim().slice(0, 80), phone: normalizeVietnamPhone(body.phone),
      email: String(body.email || '').trim(), subject: String(body.subject || 'Tư vấn liệu trình').trim().slice(0, 120), message: String(body.message || '').trim().slice(0, 2000),
      status: 'new', createdAt: new Date().toISOString() };
    if (contact.name.length < 2 || !isVietnamPhone(contact.phone) || contact.message.length < 10) throw new HttpError(400, 'Thông tin liên hệ chưa hợp lệ.', 'VALIDATION');
    transaction(() => { saveRecord('contacts', contact); nextVersion('contacts'); });
    return respond(response, 201, { contact });
  }

  if (method === 'PATCH' && pathname.startsWith('/api/admin/contacts/')) {
    assertOrigin(request);
    const actor = requireActor(request, ['admin']);
    const id = decodeURIComponent(pathname.slice('/api/admin/contacts/'.length).replace(/\/status$/, ''));
    const body = await readBody(request);
    const current = getRecord('contacts', id);
    if (!current) throw new HttpError(404, 'Không tìm thấy tin nhắn liên hệ.', 'NOT_FOUND');
    const status = String(body.status || '');
    if (!['new', 'contacted', 'closed'].includes(status)) throw new HttpError(400, 'Trạng thái liên hệ không hợp lệ.', 'VALIDATION');
    const updated = { ...current, status, updatedAt: new Date().toISOString() };
    transaction(() => { saveRecord('contacts', updated); nextVersion('contacts'); withAudit(actor, 'contact.status', id, { status }); });
    return respond(response, 200, { contact: updated });
  }

  if (method === 'POST' && pathname === '/api/favorites/toggle') {
    assertOrigin(request);
    const actor = requireActor(request, ['customer']);
    const body = await readBody(request);
    const service = getRecord('services', String(body.serviceId || ''));
    if (!service || service.active === false) throw new HttpError(404, 'Dịch vụ không còn hoạt động.', 'SERVICE_INVALID');
    const current = parseRows('favorites').find((item) => item.userId === actor.id && item.serviceId === service.id);
    let favorited;
    transaction(() => {
      if (current) { removeRecord('favorites', current.id); favorited = false; }
      else { saveRecord('favorites', { id: `fav_${randomUUID()}`, userId: actor.id, serviceId: service.id, createdAt: new Date().toISOString() }); favorited = true; }
      nextVersion('favorites');
    });
    await backupIfDue();
    return respond(response, 200, { favorited });
  }

  if (method === 'POST' && pathname === '/api/reviews') {
    assertOrigin(request);
    const actor = requireActor(request, ['customer']);
    const body = await readBody(request);
    const booking = getRecord('bookings', String(body.bookingId || ''));
    const rating = Number(body.rating);
    const comment = String(body.comment || '').trim().slice(0, 1000);
    if (!booking || booking.userId !== actor.id || booking.status !== 'Completed') throw new HttpError(403, 'Chỉ có thể đánh giá lịch đã hoàn tất thuộc tài khoản này.', 'REVIEW_NOT_ALLOWED');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Số sao phải từ 1 đến 5.', 'VALIDATION');
    if (parseRows('reviews').some((review) => review.bookingId === booking.id)) throw new HttpError(409, 'Lịch hẹn này đã được đánh giá.', 'DUPLICATE_REVIEW');
    const review = { id: `rev_${randomUUID()}`, bookingId: booking.id, serviceId: booking.serviceId, userId: actor.id,
      userName: actor.name, rating, comment, status: 'visible', createdAt: new Date().toISOString() };
    const service = getRecord('services', booking.serviceId);
    if (!service) throw new HttpError(404, 'Không tìm thấy dịch vụ của lịch hẹn.', 'SERVICE_INVALID');
    const previousCount = Math.max(0, Number(service.reviewsCount) || 0);
    const newCount = previousCount + 1;
    const newRating = previousCount ? (Number(service.rating || 0) * previousCount + rating) / newCount : rating;
    transaction(() => {
      saveRecord('reviews', review); nextVersion('reviews');
      saveRecord('services', { ...service, rating: Number(newRating.toFixed(1)), reviewsCount: newCount, updatedAt: new Date().toISOString() });
      nextVersion('services');
      withAudit(actor, 'review.created', booking.id, { rating });
    });
    await backupIfDue();
    return respond(response, 201, { review, service: getRecord('services', service.id) });
  }

  throw new HttpError(404, 'Không tìm thấy API.', 'NOT_FOUND');
}

function serveAudioFile(request, response, file, fileInfo) {
  const total = fileInfo.size;
  const headers = {
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  };
  const range = String(request.headers.range || '');
  if (range.startsWith('bytes=')) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2])) {
      response.writeHead(416, { ...headers, 'Content-Range': `bytes */${total}` }).end();
      return;
    }
    const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(total - 1, Number(match[2])) : total - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= total || end < start) {
      response.writeHead(416, { ...headers, 'Content-Range': `bytes */${total}` }).end();
      return;
    }
    response.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(end - start + 1),
    });
    if (request.method === 'HEAD') return response.end();
    createReadStream(file, { start, end }).on('error', (error) => response.destroy(error)).pipe(response);
    return;
  }
  response.writeHead(200, { ...headers, 'Content-Length': String(total) });
  if (request.method === 'HEAD') return response.end();
  createReadStream(file).on('error', (error) => response.destroy(error)).pipe(response);
}

async function serveStatic(request, response, url) {
  const file = resolvePublicAsset(url.pathname, ROOT);
  const fileInfo = file ? await stat(file).catch((error) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }) : null;
  if (!fileInfo?.isFile()) { response.writeHead(404).end('Not Found'); return; }
  const extension = path.extname(file).toLowerCase();
  if (extension === '.mp3') return serveAudioFile(request, response, file, fileInfo);
  response.writeHead(200, { 'Content-Type': MIME[extension] || 'application/octet-stream', 'Cache-Control': ['.html', '.js', '.css', '.json'].includes(extension) ? 'no-cache' : 'public, max-age=3600' });
  if (request.method === 'HEAD') return response.end();
  createReadStream(file).on('error', (error) => response.destroy(error)).pipe(response);
}

export const server = createServer(HTTP_SERVER_OPTIONS, async (request, response) => {
  try {
    let url;
    try { url = new URL(request.url || '/', `http://${request.headers.host || `localhost:${PORT}`}`); }
    catch { throw new HttpError(400, 'Địa chỉ yêu cầu không hợp lệ.', 'INVALID_URL'); }
    let proxyAuthorized = false;
    if (process.env.NODE_ENV === 'production'
      && url.pathname.startsWith('/api/')
      && !['/api/health', '/api/payments/sepay/webhook'].includes(url.pathname)) {
      const expected = String(process.env.SERENITY_PROXY_TOKEN || '');
      const provided = String(request.headers['x-serenity-proxy-token'] || '');
      const expectedBytes = Buffer.from(expected);
      const providedBytes = Buffer.from(provided);
      if (expectedBytes.length < 32 || expectedBytes.length !== providedBytes.length
        || !timingSafeEqual(expectedBytes, providedBytes)) {
        return respond(response, 403, { error: 'Yêu cầu API không được ủy quyền.', code: 'PROXY_UNAUTHORIZED' });
      }
      proxyAuthorized = true;
    }
    const origin = request.headers.origin;
    if (origin && url.pathname.startsWith('/api/')) {
      if (!isAllowedOrigin(origin, request)) return respond(response, 403, { error: 'Nguồn gửi yêu cầu không được cho phép.', code: 'ORIGIN_REJECTED' });
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-Match, X-Music-Filename');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      response.setHeader('Vary', 'Origin');
    }
    if (url.pathname.startsWith('/api/')) {
      const address = clientAddressForRequest({ proxyAuthorized,
        proxyClientIp: request.headers['x-serenity-client-ip'], remoteAddress: request.socket?.remoteAddress });
      const rate = apiRateLimiter.consume(address);
      response.setHeader('X-RateLimit-Limit', String(API_RATE_LIMIT));
      response.setHeader('X-RateLimit-Remaining', String(rate.remaining));
      if (!rate.allowed) return respond(response, 429, { error: 'Bạn gửi yêu cầu quá nhanh. Vui lòng thử lại sau.', code: 'API_RATE_LIMIT' }, { 'Retry-After': String(rate.retryAfterSeconds) });
      if (request.method === 'OPTIONS') return response.writeHead(204).end();
      return await routeApi(request, response, url);
    }
    if (request.method === 'GET' || request.method === 'HEAD') return await serveStatic(request, response, url);
    return respond(response, 405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error instanceof AppError ? 400 : 500;
    if (!(error instanceof HttpError) && !(error instanceof AppError)) console.error('[serenity-api]', error);
    return respond(response, status, { error: error.message || 'Có lỗi máy chủ.', code: error.code || 'SERVER_ERROR',
      ...(error.fields ? { fields: error.fields } : {}) });
  }
});
server.maxConnections = 1000;
server.maxHeadersCount = 100;

export function startServer() {
  const aiConfigured = isAiConfigured(process.env);
  const provider = String(process.env.AI_PROVIDER || '').toLowerCase();
  console.log(`[AI] ${provider === 'gemini' ? 'Gemini' : 'AI'} configured: ${aiConfigured ? 'YES' : 'NO'}${aiConfigured ? ` · model: ${process.env.AI_MODEL}` : ''}`);
  server.listen(PORT, HOST, () => console.log(`Serenity shared app/API đang chạy tại http://localhost:${PORT}/ (host ${HOST})`));
  backupIfDue().catch((error) => console.error('[backup]', error));
  const timer = setInterval(() => {
    try { agentHistory.prune(); } catch (error) { console.error('[agent-history-cleanup]', error); }
    backupIfDue().catch((error) => console.error('[backup]', error));
  }, 60 * 60 * 1000);
  timer.unref();
  const expirePaymentsSafely = () => {
    try {
      const expiredCount = paymentOperations.expirePendingPayments();
      if (expiredCount) backupIfDue().catch((error) => console.error('[payment-expiry-backup]', error));
    } catch (error) {
      console.error('[payment-expiry]', error);
    }
  };
  expirePaymentsSafely();
  const paymentExpiryTimer = setInterval(expirePaymentsSafely, 5000);
  paymentExpiryTimer.unref();
  const completeDueSafely = () => {
    try {
      const completedCount = completeDueBookings();
      if (completedCount) backupIfDue().catch((error) => console.error('[backup]', error));
    } catch (error) {
      console.error('[booking-auto-complete]', error);
    }
  };
  completeDueSafely();
  const completionTimer = setInterval(completeDueSafely, 60 * 1000);
  completionTimer.unref();
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) startServer();
