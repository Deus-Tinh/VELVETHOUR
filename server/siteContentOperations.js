import { createHash, randomUUID } from 'node:crypto';

export const SITE_PAGE_TEMPLATE = 'holiday-offer-v1';
export const SITE_MENU_ROUTES = Object.freeze({
  home: { label: 'Trang chủ', href: '#/' },
  services: { label: 'Dịch vụ', href: '#/packages' },
  booking: { label: 'Đặt lịch', href: '#/booking' },
  about: { label: 'Về chúng tôi', href: '#/about' },
  contact: { label: 'Liên hệ', href: '#/contact' },
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
const digest = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const text = (value) => typeof value === 'string' ? value.trim() : '';

export function createSiteContentOperations({ db, transaction, nextVersion, withAudit, businessNow, HttpError }) {
  const fail = (status, message, code) => { throw new HttpError(status, message, code); };
  const admin = (actor) => { if (actor?.role !== 'admin') fail(403, 'Chỉ Admin được quản lý trang và menu.', 'FORBIDDEN'); };

  function boundedString(value, field, max, { required = false } = {}) {
    const result = text(value);
    if (result.length > max || (required && !result)) fail(400, `Trường ${field} chưa hợp lệ.`, 'VALIDATION');
    return result;
  }

  function normalizeContent(input, { partial = false, current = {} } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Nội dung trang ưu đãi chưa hợp lệ.', 'VALIDATION');
    const allowed = new Set(['eyebrow', 'subtitle', 'body', 'highlights', 'conditions', 'ctaLabel']);
    if (Object.keys(input).some((key) => !allowed.has(key))) fail(400, 'Nội dung chỉ được dùng các trường của mẫu trang ưu đãi.', 'VALIDATION');
    const merged = { ...current, ...input };
    const result = {
      eyebrow: boundedString(merged.eyebrow || '', 'nhãn đầu trang', 50),
      subtitle: boundedString(merged.subtitle || '', 'mô tả ngắn', 240, { required: true }),
      body: boundedString(merged.body || '', 'nội dung', 1600, { required: true }),
      conditions: boundedString(merged.conditions || '', 'điều kiện', 1200),
      ctaLabel: boundedString(merged.ctaLabel || 'Đặt lịch ưu đãi', 'nút đặt lịch', 50, { required: true }),
      highlights: merged.highlights ?? [],
    };
    if (!Array.isArray(result.highlights) || result.highlights.length > 6
      || result.highlights.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 140)) {
      fail(400, 'Điểm nổi bật phải có tối đa 6 dòng, mỗi dòng không quá 140 ký tự.', 'VALIDATION');
    }
    result.highlights = result.highlights.map((item) => item.trim());
    if (partial && !Object.hasOwn(input, 'highlights')) result.highlights = current.highlights || [];
    return result;
  }

  function normalizeSlug(value, title) {
    const source = text(value) || text(title);
    const slug = source.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
    if (slug.length < 3) fail(400, 'Đường dẫn cần có ít nhất 3 ký tự chữ hoặc số.', 'SLUG_INVALID');
    if (value && (value !== slug || !/^[a-z0-9](?:[a-z0-9-]{1,68}[a-z0-9])$/.test(value))) {
      fail(400, 'Đường dẫn chỉ gồm chữ thường, số và dấu gạch nối.', 'SLUG_INVALID');
    }
    return slug;
  }

  function menuView(row, page = null) {
    const route = row.target_type === 'route' ? SITE_MENU_ROUTES[row.route_key] : null;
    return {
      id: row.id, label: row.label, targetType: row.target_type, routeKey: row.route_key,
      pageId: row.page_id, pageSlug: page?.slug || null,
      targetHref: route?.href || (page ? `#/pages/${page.slug}` : null),
      enabled: row.enabled === 1, position: row.position, revision: row.revision,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  function pageView(row, { publicOnly = false } = {}) {
    if (!row) return null;
    const page = {
      id: row.id, slug: row.slug, title: row.title, templateId: row.template_id,
      content: JSON.parse(row.content_json), campaignId: row.campaign_id,
      status: row.status, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    };
    if (!publicOnly) {
      page.createdBy = row.created_by;
      page.updatedBy = row.updated_by;
    }
    return page;
  }

  function campaignForPage(campaignId) {
    if (!campaignId) return null;
    const row = db.prepare(`SELECT id, name, occasion, service_date_from, service_date_to, discount_type,
      percentage_bps, fixed_amount_vnd, max_discount_vnd, scope_type FROM holiday_sales WHERE id = ?`).get(campaignId);
    return row ? { id: row.id, name: row.name, occasion: row.occasion,
      serviceDateFrom: row.service_date_from, serviceDateTo: row.service_date_to,
      discountType: row.discount_type, percentageBps: row.percentage_bps,
      fixedAmountVnd: row.fixed_amount_vnd, maxDiscountVnd: row.max_discount_vnd, scopeType: row.scope_type } : null;
  }

  function campaignIsPublic(campaignId) {
    if (!campaignId) return true;
    const row = db.prepare('SELECT enabled, service_date_to FROM holiday_sales WHERE id = ?').get(campaignId);
    return Boolean(row?.enabled && row.service_date_to >= businessNow().date);
  }

  function getPageRow(slugOrId) {
    return db.prepare('SELECT * FROM site_pages WHERE id = ? OR slug = ?').get(slugOrId, slugOrId) || null;
  }

  function list({ publicOnly = false } = {}) {
    let rows = db.prepare('SELECT * FROM site_pages ORDER BY updated_at DESC, id').all();
    if (publicOnly) rows = rows.filter((row) => row.status === 'published' && campaignIsPublic(row.campaign_id));
    const pages = rows.map((row) => ({ ...pageView(row, { publicOnly }), campaign: campaignForPage(row.campaign_id) }));
    const pageById = new Map(pages.map((page) => [page.id, page]));
    let menuRows = db.prepare('SELECT * FROM site_menu_items ORDER BY position, created_at, id').all();
    if (publicOnly) menuRows = menuRows.filter((row) => row.target_type === 'route'
      || (row.enabled === 1 && pageById.get(row.page_id)?.status === 'published'));
    const menuItems = menuRows.map((row) => menuView(row, pageById.get(row.page_id)));
    return { pages, menuItems };
  }

  function getPage(slug, { publicOnly = true } = {}) {
    if (typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{1,68}[a-z0-9])$/.test(slug)) return null;
    const row = getPageRow(slug);
    if (!row || (publicOnly && (row.status !== 'published' || !campaignIsPublic(row.campaign_id)))) return null;
    return { ...pageView(row, { publicOnly }), campaign: campaignForPage(row.campaign_id) };
  }

  function idempotentWrite(actor, operation, requestId, input, work) {
    admin(actor);
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(requestId)) {
      fail(400, 'Cần mã yêu cầu để tránh tạo thay đổi trùng.', 'REQUEST_ID_REQUIRED');
    }
    const requestKey = `${actor.id}:${requestId}`;
    const inputHash = digest({ operation, input });
    return transaction(() => {
      const previous = db.prepare('SELECT input_hash, response_json FROM site_content_requests WHERE request_key = ?').get(requestKey);
      if (previous) {
        if (previous.input_hash !== inputHash) fail(409, 'Mã yêu cầu đã được dùng cho thao tác khác.', 'REQUEST_CONFLICT');
        return { ...JSON.parse(previous.response_json), replayed: true };
      }
      const result = work();
      db.prepare('INSERT INTO site_content_requests(request_key, input_hash, response_json) VALUES (?,?,?)')
        .run(requestKey, inputHash, JSON.stringify(result));
      return { ...result, replayed: false };
    });
  }

  function createPromotionPage(input, actor, { requestId } = {}) {
    admin(actor);
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !['title', 'slug', 'menuLabel', 'content', 'campaignId'].includes(key))) {
      fail(400, 'Thông tin trang ưu đãi chưa hợp lệ.', 'VALIDATION');
    }
    const title = boundedString(input.title, 'tiêu đề', 120, { required: true });
    const content = normalizeContent(input.content);
    const menuLabel = boundedString(input.menuLabel || title, 'tên mục menu', 60, { required: true });
    const campaignId = input.campaignId == null || input.campaignId === '' ? null : boundedString(input.campaignId, 'chiến dịch', 120, { required: true });
    if (campaignId) {
      const campaign = db.prepare('SELECT enabled, service_date_to FROM holiday_sales WHERE id = ?').get(campaignId);
      if (!campaign?.enabled || campaign.service_date_to < businessNow().date) {
        fail(400, 'Trang chỉ được gắn với chiến dịch sale đang bật và chưa kết thúc.', 'CAMPAIGN_INVALID');
      }
    }
    const requestedSlug = input.slug ? normalizeSlug(input.slug, title) : null;
    const now = new Date().toISOString();
    const id = `page_${randomUUID()}`;
    let slug = requestedSlug || normalizeSlug('', title);
    if (!requestedSlug) slug = `${slug.slice(0, 48)}-${randomUUID().slice(0, 8)}`;
    const page = { id, slug, title, templateId: SITE_PAGE_TEMPLATE, content, campaignId,
      status: 'published', revision: 1, createdAt: now, updatedAt: now, createdBy: actor.id, updatedBy: actor.id };
    const menuItem = { id: `menu_${randomUUID()}`, label: menuLabel, targetType: 'page', routeKey: null,
      pageId: id, pageSlug: slug, targetHref: `#/pages/${slug}`, enabled: true,
      position: Number(db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM site_menu_items').get().next),
      revision: 1, createdAt: now, updatedAt: now };
    return idempotentWrite(actor, 'create_promotion_page', requestId, { title, slug: requestedSlug, menuLabel, content, campaignId }, () => {
      if (requestedSlug && db.prepare('SELECT 1 FROM site_pages WHERE slug = ?').get(slug)) fail(409, 'Đường dẫn trang đã được sử dụng.', 'SLUG_CONFLICT');
      db.prepare(`INSERT INTO site_pages(id,slug,title,template_id,content_json,campaign_id,status,revision,created_at,updated_at,created_by,updated_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, slug, title, SITE_PAGE_TEMPLATE, JSON.stringify(content), campaignId, 'published', 1, now, now, actor.id, actor.id);
      db.prepare(`INSERT INTO site_menu_items(id,label,target_type,route_key,page_id,enabled,position,revision,created_at,updated_at,created_by,updated_by)
        VALUES (?,?, 'page', NULL, ?, 1, ?, 1, ?, ?, ?, ?)`).run(menuItem.id, menuLabel, id, menuItem.position, now, now, actor.id, actor.id);
      nextVersion('siteContent');
      withAudit(actor, 'site_page.created', id, { slug, title, campaignId, menuItemId: menuItem.id });
      return { page: { ...page, createdBy: undefined, updatedBy: undefined }, menuItem, verified: true };
    });
  }

  function updatePromotionPage(idOrSlug, patch, actor, { expectedRevision, requestId } = {}) {
    admin(actor);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)
      || Object.keys(patch).some((key) => !['title', 'content', 'status', 'menuLabel'].includes(key)) || !Object.keys(patch).length) {
      fail(400, 'Các trường sửa trang ưu đãi không hợp lệ.', 'VALIDATION');
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail(400, 'Cần phiên bản trang hợp lệ.', 'VERSION_REQUIRED');
    const before = getPageRow(idOrSlug);
    if (!before) fail(404, 'Không tìm thấy trang ưu đãi.', 'NOT_FOUND');
    const title = Object.hasOwn(patch, 'title') ? boundedString(patch.title, 'tiêu đề', 120, { required: true }) : before.title;
    const content = Object.hasOwn(patch, 'content') ? normalizeContent(patch.content, { partial: true, current: JSON.parse(before.content_json) }) : JSON.parse(before.content_json);
    const status = Object.hasOwn(patch, 'status') ? patch.status : before.status;
    if (!['draft', 'published'].includes(status)) fail(400, 'Trạng thái trang không hợp lệ.', 'VALIDATION');
    const menuLabel = Object.hasOwn(patch, 'menuLabel') ? boundedString(patch.menuLabel, 'tên mục menu', 60, { required: true }) : null;
    const now = new Date().toISOString();
    return idempotentWrite(actor, 'update_promotion_page', requestId, { idOrSlug, patch, expectedRevision }, () => {
      const current = getPageRow(idOrSlug);
      if (current.revision !== expectedRevision) fail(409, 'Trang đã được cập nhật. Hãy đọc lại trước khi sửa.', 'VERSION_CONFLICT');
      const revision = current.revision + 1;
      db.prepare(`UPDATE site_pages SET title=?,content_json=?,status=?,revision=?,updated_at=?,updated_by=? WHERE id=?`)
        .run(title, JSON.stringify(content), status, revision, now, actor.id, current.id);
      let menuChanged = false;
      if (status === 'draft') {
        menuChanged = db.prepare('UPDATE site_menu_items SET enabled=0,revision=revision+1,updated_at=?,updated_by=? WHERE page_id=? AND enabled=1')
          .run(now, actor.id, current.id).changes > 0;
      }
      if (menuLabel !== null) {
        const result = db.prepare('UPDATE site_menu_items SET label=?,revision=revision+1,updated_at=?,updated_by=? WHERE page_id=?')
          .run(menuLabel, now, actor.id, current.id);
        menuChanged ||= result.changes > 0;
      }
      nextVersion('siteContent');
      const updated = getPageRow(current.id);
      const menu = db.prepare('SELECT * FROM site_menu_items WHERE page_id=?').get(current.id);
      withAudit(actor, 'site_page.updated', current.id, { before: pageView(current), after: pageView(updated), menuChanged });
      return { page: pageView(updated), menuItem: menu ? menuView(menu, pageView(updated)) : null, verified: true };
    });
  }

  function createMenuLink(input, actor, { requestId } = {}) {
    admin(actor);
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !['label', 'routeKey', 'enabled'].includes(key))) {
      fail(400, 'Mục menu chỉ được trỏ tới tuyến trang có sẵn.', 'VALIDATION');
    }
    const label = boundedString(input.label, 'tên mục menu', 60, { required: true });
    const routeKey = input.routeKey;
    if (!Object.hasOwn(SITE_MENU_ROUTES, routeKey)) fail(400, 'Trang đích không nằm trong danh sách tuyến được hỗ trợ.', 'ROUTE_INVALID');
    const enabled = input.enabled === undefined ? true : input.enabled;
    if (typeof enabled !== 'boolean') fail(400, 'Trạng thái mục menu không hợp lệ.', 'VALIDATION');
    const now = new Date().toISOString();
    const id = `menu_${randomUUID()}`;
    return idempotentWrite(actor, 'create_menu_link', requestId, { label, routeKey, enabled }, () => {
      if (db.prepare('SELECT 1 FROM site_menu_items WHERE route_key=?').get(routeKey)) fail(409, 'Tuyến trang này đã có trong menu.', 'MENU_TARGET_EXISTS');
      const position = Number(db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM site_menu_items').get().next);
      db.prepare(`INSERT INTO site_menu_items(id,label,target_type,route_key,page_id,enabled,position,revision,created_at,updated_at,created_by,updated_by)
        VALUES (?,?, 'route', ?, NULL, ?, ?, 1, ?, ?, ?, ?)`).run(id, label, routeKey, Number(enabled), position, now, now, actor.id, actor.id);
      nextVersion('siteContent');
      const row = db.prepare('SELECT * FROM site_menu_items WHERE id=?').get(id);
      const menuItem = menuView(row);
      withAudit(actor, 'site_menu.created', id, { menuItem });
      return { menuItem, verified: true };
    });
  }

  function updateMenuLink(id, patch, actor, { expectedRevision, requestId } = {}) {
    admin(actor);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)
      || Object.keys(patch).some((key) => !['label', 'enabled', 'position'].includes(key)) || !Object.keys(patch).length) {
      fail(400, 'Các trường sửa mục menu không hợp lệ.', 'VALIDATION');
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail(400, 'Cần phiên bản menu hợp lệ.', 'VERSION_REQUIRED');
    const before = db.prepare('SELECT * FROM site_menu_items WHERE id=?').get(id);
    if (!before) fail(404, 'Không tìm thấy mục menu.', 'NOT_FOUND');
    const label = Object.hasOwn(patch, 'label') ? boundedString(patch.label, 'tên mục menu', 60, { required: true }) : before.label;
    const enabled = Object.hasOwn(patch, 'enabled') ? patch.enabled : before.enabled === 1;
    const position = Object.hasOwn(patch, 'position') ? patch.position : before.position;
    if (typeof enabled !== 'boolean' || !Number.isSafeInteger(position) || position < 0 || position > 10000) fail(400, 'Trạng thái hoặc thứ tự menu không hợp lệ.', 'VALIDATION');
    return idempotentWrite(actor, 'update_menu_link', requestId, { id, patch, expectedRevision }, () => {
      const current = db.prepare('SELECT * FROM site_menu_items WHERE id=?').get(id);
      if (current.revision !== expectedRevision) fail(409, 'Mục menu đã được cập nhật. Hãy đọc lại trước khi sửa.', 'VERSION_CONFLICT');
      const now = new Date().toISOString();
      db.prepare('UPDATE site_menu_items SET label=?,enabled=?,position=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=?')
        .run(label, Number(enabled), position, now, actor.id, id);
      nextVersion('siteContent');
      const after = db.prepare('SELECT * FROM site_menu_items WHERE id=?').get(id);
      const page = after.page_id ? pageView(getPageRow(after.page_id)) : null;
      const menuItem = menuView(after, page);
      withAudit(actor, 'site_menu.updated', id, { before: menuView(current), after: menuItem });
      return { menuItem, verified: true };
    });
  }

  return { list, getPage, createPromotionPage, updatePromotionPage, createMenuLink, updateMenuLink };
}
