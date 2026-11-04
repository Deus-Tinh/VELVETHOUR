export const STAFF_INVITE_TOKEN_KEY = 'serenity.staffInviteToken';

const LOCAL_BASE_URL = 'https://serenity.local/';
const LEGACY_ROUTE_PATHS = new Map([
  ['/', '/'],
  ['/home', '/'],
  ['/packages', '/dich-vu'],
  ['/services', '/lieu-trinh'],
  ['/booking', '/dat-lich'],
  ['/about', '/ve-chung-toi'],
  ['/contact', '/lien-he'],
  ['/my-bookings', '/lich-cua-toi'],
  ['/admin', '/admin'],
  ['/staff', '/nhan-vien'],
  ['/login', '/dang-nhap'],
  ['/register', '/dang-ky'],
]);

const ROUTE_TITLES = new Map([
  ['/', 'Serenity Spa & Wellness'],
  ['/dich-vu', 'Dịch Vụ | Serenity Spa'],
  ['/lieu-trinh', 'Liệu Trình | Serenity Spa'],
  ['/dat-lich', 'Đặt Lịch | Serenity Spa'],
  ['/ve-chung-toi', 'Về Chúng Tôi | Serenity Spa'],
  ['/lien-he', 'Liên Hệ | Serenity Spa'],
  ['/lich-cua-toi', 'Lịch Của Tôi | Serenity Spa'],
  ['/admin', 'Quản Trị | Serenity Spa'],
  ['/nhan-vien', 'Nhân Viên | Serenity Spa'],
  ['/dang-nhap', 'Đăng Nhập | Serenity Spa'],
  ['/dang-ky', 'Đăng Ký | Serenity Spa'],
  ['/moi-nhan-vien', 'Kích Hoạt Tài Khoản | Serenity Spa'],
]);

export function normalizeSpaPath(pathname = '/') {
  const path = String(pathname || '/');
  const rooted = path.startsWith('/') ? path : `/${path}`;
  return rooted.replace(/\/+$/, '') || '/';
}

export function isSpaPath(pathname = '/') {
  const path = normalizeSpaPath(pathname);
  return ROUTE_TITLES.has(path)
    || path === '/dich-vu'
    || /^\/dich-vu\/[^/]+$/.test(path)
    || /^\/uu-dai\/[a-z0-9-]+$/i.test(path);
}

export function titleForSpaPath(pathname = '/') {
  const path = normalizeSpaPath(pathname);
  if (ROUTE_TITLES.has(path)) return ROUTE_TITLES.get(path);
  if (/^\/dich-vu\/[^/]+$/.test(path)) return 'Dịch Vụ | Serenity Spa';
  if (/^\/uu-dai\/[a-z0-9-]+$/i.test(path)) return 'Ưu Đãi | Serenity Spa';
  return ROUTE_TITLES.get('/');
}

export function routeFromLegacyHash(hash) {
  const value = String(hash || '');
  if (!value.startsWith('#/')) return null;

  let url;
  try { url = new URL(value.slice(1), LOCAL_BASE_URL); } catch { return null; }
  const legacyPath = normalizeSpaPath(url.pathname);

  if (legacyPath === '/staff-invite') {
    return {
      pathname: '/moi-nhan-vien',
      search: '',
      staffInviteToken: url.searchParams.get('token') || null,
    };
  }

  const detailMatch = legacyPath.match(/^\/services\/([^/]+)$/i);
  if (detailMatch) return { pathname: `/dich-vu/${detailMatch[1]}`, search: url.search, staffInviteToken: null };

  const promotionMatch = legacyPath.match(/^\/pages\/([a-z0-9-]+)$/i);
  if (promotionMatch) return { pathname: `/uu-dai/${promotionMatch[1]}`, search: url.search, staffInviteToken: null };

  const pathname = LEGACY_ROUTE_PATHS.get(legacyPath);
  return pathname ? { pathname, search: url.search, staffInviteToken: null } : null;
}

function legacyLinkTarget(href, baseUrl) {
  const direct = routeFromLegacyHash(href);
  if (direct) return { ...direct, origin: new URL(baseUrl).origin };

  try {
    const url = new URL(href, baseUrl);
    if (!url.hash.startsWith('#/')) return null;
    const mapped = routeFromLegacyHash(url.hash);
    return mapped ? { ...mapped, origin: url.origin } : null;
  } catch {
    return null;
  }
}

export function cleanSpaHref(href, baseUrl = LOCAL_BASE_URL) {
  const value = String(href || '');
  const target = legacyLinkTarget(value, baseUrl);
  if (!target || target.staffInviteToken || target.origin !== new URL(baseUrl).origin) return value;
  return `${target.pathname}${target.search}`;
}

export function migrateLegacyHash(location = window.location, history = window.history, storage = window.sessionStorage) {
  const target = routeFromLegacyHash(location.hash);
  const pathname = normalizeSpaPath(location.pathname);
  const fragmentToken = pathname === '/moi-nhan-vien' && String(location.hash || '').startsWith('#token=')
    ? new URLSearchParams(String(location.hash).slice(1)).get('token')
    : null;
  if (!target && !fragmentToken) return false;

  const staffInviteToken = target?.staffInviteToken || fragmentToken;
  if (staffInviteToken) {
    try { storage?.setItem(STAFF_INVITE_TOKEN_KEY, staffInviteToken); }
    catch { return false; }
  }

  const nextPath = target ? `${target.pathname}${target.search}` : `${pathname}${location.search || ''}`;
  history.replaceState(history.state, '', nextPath);
  return true;
}

export function navigateTo(href, { replace = false } = {}) {
  if (typeof window === 'undefined') return false;
  const value = String(href || '');
  const target = legacyLinkTarget(value, window.location.href);
  let pathname;
  let search;
  let staffInviteToken = null;

  if (target) {
    if (target.origin !== window.location.origin) return false;
    ({ pathname, search, staffInviteToken } = target);
  } else {
    let url;
    try { url = new URL(value, window.location.href); } catch { return false; }
    if (url.origin !== window.location.origin) return false;
    ({ pathname, search } = url);
  }

  pathname = normalizeSpaPath(pathname);
  if (!isSpaPath(pathname)) return false;
  if (staffInviteToken) {
    try { window.sessionStorage.setItem(STAFF_INVITE_TOKEN_KEY, staffInviteToken); }
    catch { return false; }
  }

  const nextUrl = `${pathname}${search || ''}`;
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (nextUrl === currentUrl && !replace) return false;
  window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', nextUrl);
  if (typeof PopStateEvent !== 'undefined') window.dispatchEvent(new PopStateEvent('popstate'));
  else if (typeof Event !== 'undefined') window.dispatchEvent(new Event('popstate'));
  return true;
}

export function installSpaNavigation(onPopState) {
  const handleClick = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const origin = event.target instanceof Element ? event.target : event.target?.parentElement;
    const anchor = origin?.closest('a[href]');
    if (!anchor || anchor.hasAttribute('download')) return;
    const target = anchor.getAttribute('target');
    if (target && target.toLowerCase() !== '_self') return;

    const href = anchor.getAttribute('href') || '';
    if (href.startsWith('#') && !href.startsWith('#/')) return;
    const cleanedHref = cleanSpaHref(href, window.location.href);
    let url;
    try { url = new URL(cleanedHref, window.location.href); } catch { return; }
    if (url.origin !== window.location.origin || !isSpaPath(url.pathname)) return;

    if (navigateTo(href)) event.preventDefault();
  };

  document.addEventListener('click', handleClick);
  window.addEventListener('popstate', onPopState);
  const handleHashChange = () => {
    if (migrateLegacyHash()) onPopState();
  };
  window.addEventListener('hashchange', handleHashChange);
  return () => {
    document.removeEventListener('click', handleClick);
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('hashchange', handleHashChange);
  };
}
