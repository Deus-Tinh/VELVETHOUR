import path from 'node:path';
import { isIP } from 'node:net';
import { isSpaPath } from '../assets/js/core/spaRouter.js';

export const HTTP_SERVER_OPTIONS = Object.freeze({
  headersTimeout: 10_000,
  requestTimeout: 30_000,
  connectionsCheckingInterval: 1_000,
  keepAliveTimeout: 5_000,
  maxHeaderSize: 16 * 1024,
});

export function apiRateLimitFromEnv(env = process.env) {
  const value = Number(env.SERENITY_API_RATE_LIMIT ?? 30);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error('SERENITY_API_RATE_LIMIT must be an integer between 1 and 10000.');
  }
  return value;
}

// Trust the Pages-provided client IP only after the request has passed the
// shared proxy-token check. Direct callers always use the TCP peer address.
export function clientAddressForRequest({ proxyAuthorized = false, proxyClientIp = '', remoteAddress = '' } = {}) {
  const candidate = String(proxyClientIp || '').trim();
  if (proxyAuthorized && isIP(candidate)) return candidate;
  return String(remoteAddress || 'unknown');
}

// One rolling window per TCP peer, shared across all API routes. Do not trust X-Forwarded-For.
// State is process-local; multi-process deployments need a shared limiter at the proxy/store.
export function createApiRateLimiter({ limit = 30, windowMs = 1000, maxKeys = 10_000, now = () => performance.now() } = {}) {
  for (const value of [limit, windowMs, maxKeys]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Rate limiter options must be positive integers.');
  }
  const buckets = new Map();
  let nextSweep = 0;
  const sweep = (time) => {
    for (const [key, timestamps] of buckets) {
      if (timestamps.at(-1) <= time - windowMs) buckets.delete(key);
    }
    nextSweep = time + windowMs;
  };
  return {
    get size() { return buckets.size; },
    consume(address = 'unknown') {
      const time = now();
      if (time >= nextSweep) sweep(time);
      const key = address.replace(/^::ffff:/i, '');
      let timestamps = buckets.get(key);
      if (!timestamps) {
        if (buckets.size >= maxKeys) {
          sweep(time);
          if (buckets.size >= maxKeys) return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(windowMs / 1000) };
        }
        timestamps = [];
        buckets.set(key, timestamps);
      }
      while (timestamps.length && timestamps[0] <= time - windowMs) timestamps.shift();
      if (timestamps.length >= limit) {
        return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((timestamps[0] + windowMs - time) / 1000)) };
      }
      timestamps.push(time);
      return { allowed: true, remaining: limit - timestamps.length };
    },
  };
}

// The repository root contains .env and internal sources. Only browser assets are public.
export function resolvePublicAsset(encodedPathname, root) {
  let pathname;
  try { pathname = decodeURIComponent(encodedPathname); } catch { return null; }
  if (pathname.includes('\\') || pathname.split('/').some((segment) => segment.startsWith('.')) || pathname.includes('\0')) return null;
  if (pathname === '/') pathname = '/index.html';
  else if (isSpaPath(pathname)) pathname = '/index.html';
  if (pathname !== '/index.html' && !pathname.startsWith('/assets/') && !pathname.startsWith('/mp3/') && !pathname.startsWith('/tests/')) return null;
  const file = path.resolve(root, `.${pathname}`);
  return file.startsWith(`${root}${path.sep}`) ? file : null;
}
