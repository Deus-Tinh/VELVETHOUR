import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { apiRateLimitFromEnv, clientAddressForRequest, createApiRateLimiter, HTTP_SERVER_OPTIONS, resolvePublicAsset } from '../server/httpProtection.js';

test('rolling budget rejects request 31, recovers after expiry, and cannot burst across a fixed boundary', () => {
  let time = 999;
  const limiter = createApiRateLimiter({ now: () => time });
  for (let i = 0; i < 30; i++) assert.equal(limiter.consume('127.0.0.1').allowed, true);
  assert.deepEqual(limiter.consume('127.0.0.1'), { allowed: false, remaining: 0, retryAfterSeconds: 1 });
  time = 1000;
  assert.equal(limiter.consume('127.0.0.1').allowed, false);
  time = 1999;
  assert.equal(limiter.consume('127.0.0.1').allowed, true);
});

test('different peers have independent budgets; IPv4-mapped IPv6 shares the same budget', () => {
  const limiter = createApiRateLimiter({ limit: 1 });
  assert.equal(limiter.consume('127.0.0.1').allowed, true);
  assert.equal(limiter.consume('::ffff:127.0.0.1').allowed, false);
  assert.equal(limiter.consume('127.0.0.2').allowed, true);
});

test('only an authenticated proxy may supply a valid client IP for rate-limit identity', () => {
  assert.equal(clientAddressForRequest({ proxyAuthorized: true, proxyClientIp: '198.51.100.7', remoteAddress: '10.0.0.1' }), '198.51.100.7');
  assert.equal(clientAddressForRequest({ proxyAuthorized: true, proxyClientIp: '2001:db8::7', remoteAddress: '10.0.0.1' }), '2001:db8::7');
  assert.equal(clientAddressForRequest({ proxyAuthorized: true, proxyClientIp: 'not-an-ip', remoteAddress: '10.0.0.1' }), '10.0.0.1');
  assert.equal(clientAddressForRequest({ proxyAuthorized: false, proxyClientIp: '198.51.100.7', remoteAddress: '10.0.0.1' }), '10.0.0.1');
});

test('tracking capacity is bounded and recovers without evicting active limits', () => {
  let time = 0;
  const limiter = createApiRateLimiter({ limit: 1, maxKeys: 2, now: () => time });
  limiter.consume('a'); limiter.consume('b');
  assert.equal(limiter.consume('c').allowed, false);
  assert.equal(limiter.size, 2);
  for (let i = 0; i < 100; i++) assert.equal(limiter.consume('a').allowed, false);
  assert.equal(limiter.size, 2);
  time = 1000;
  assert.equal(limiter.consume('c').allowed, true);
  assert.equal(limiter.size, 1);
});

test('invalid budgets fail closed at startup', () => {
  assert.equal(apiRateLimitFromEnv({}), 30);
  for (const value of ['0', '-1', '', 'NaN', '1.5', '10001']) {
    assert.throws(() => apiRateLimitFromEnv({ SERENITY_API_RATE_LIMIT: value }));
  }
  assert.throws(() => createApiRateLimiter({ maxKeys: 0 }));
});

test('static allowlist denies secrets, internal sources, encoded dotfiles and Windows traversal', () => {
  const root = path.resolve('test-public-root');
  for (const pathname of ['/.env', '/%2eenv', '/package.json', '/server/server.js', '/docs/LOAD_TEST_LAB.md',
    '/assets/../../.env', '/assets/.secret', '/assets/%2e%2e/.env', '/assets/..%5c..%5c.env', '/assets/%00.js', '/assets/%zz']) {
    assert.equal(resolvePublicAsset(pathname, root), null, pathname);
  }
  assert.equal(resolvePublicAsset('/', root), path.join(root, 'index.html'));
  assert.equal(resolvePublicAsset('/assets/js/app.js', root), path.join(root, 'assets', 'js', 'app.js'));
  assert.equal(resolvePublicAsset('/tests/index.html', root), path.join(root, 'tests', 'index.html'));
  for (const pathname of ['/dich-vu', '/lieu-trinh', '/dich-vu/stone-massage', '/dat-lich?date=2026-11-04', '/uu-dai/uu-dai-le']) {
    assert.equal(resolvePublicAsset(pathname.split('?')[0], root), path.join(root, 'index.html'), pathname);
  }
  for (const pathname of ['/api/health', '/unknown', '/.env']) assert.equal(resolvePublicAsset(pathname, root), null, pathname);
});

test('Vercel rewrites app paths to index without rewriting API requests', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const sources = config.rewrites.map((rewrite) => rewrite.source);
  for (const route of ['/dich-vu', '/lieu-trinh', '/dat-lich', '/ve-chung-toi', '/lien-he', '/lich-cua-toi',
    '/admin', '/nhan-vien', '/dang-nhap', '/dang-ky', '/moi-nhan-vien', '/dich-vu/:serviceId', '/uu-dai/:slug']) {
    assert.ok(sources.includes(route), `Missing Vercel SPA rewrite for ${route}`);
  }
  assert.ok(sources.every((source) => !source.startsWith('/api')), 'API proxy paths must remain untouched');
});

const directory = await mkdtemp(path.join(tmpdir(), 'serenity-http-protection-'));
process.env.SERENITY_DB_PATH = path.join(directory, 'test.sqlite');
process.env.SERENITY_API_RATE_LIMIT = '3';
const { server } = await import('../server/server.js');
const handler = server.listeners('request')[0];
async function request(url, { address = '192.0.2.1', headers = {}, method = 'GET' } = {}) {
  const incoming = Readable.from([]);
  Object.assign(incoming, { method, url, headers: { host: 'localhost:3001', ...headers }, socket: { remoteAddress: address } });
  const outgoing = new Writable({ write(chunk, _encoding, callback) { this.body += chunk.toString(); callback(); } });
  Object.assign(outgoing, {
    headers: {}, status: 0, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, responseHeaders = {}) { this.status = status; for (const [name, value] of Object.entries(responseHeaders)) this.setHeader(name, value); return this; },
  });
  await handler(incoming, outgoing);
  await finished(outgoing);
  return outgoing;
}

test('HTTP integration blocks before routing, shares the API budget, and ignores forged forwarded IPs', async () => {
  const directPage = await request('/dich-vu?date=2026-11-04');
  assert.equal(directPage.status, 200);
  assert.match(directPage.headers['content-type'], /text\/html/);
  assert.match(directPage.body, /<title>/);
  assert.equal((await request('/unknown-page')).status, 404);
  assert.equal((await request('/api/health')).status, 200);
  assert.equal((await request('/api/services')).status, 200);
  assert.equal((await request('/api/auth/session')).status, 200);
  const rejected = await request('/api/health', { headers: { 'x-forwarded-for': '192.0.2.99' } });
  assert.equal(rejected.status, 429);
  assert.equal(JSON.parse(rejected.body).code, 'API_RATE_LIMIT');
  assert.equal(rejected.headers['retry-after'], '1');
  assert.equal(rejected.headers['x-ratelimit-remaining'], '0');
  assert.equal((await request('/api/health', { address: '192.0.2.2' })).status, 200);
});

test('preflight is covered and secret paths are HTTP 404 without returning contents', async () => {
  const options = { address: '192.0.2.3', method: 'OPTIONS' };
  for (let i = 0; i < 3; i++) assert.equal((await request('/api/health', options)).status, 204);
  assert.equal((await request('/api/health', options)).status, 429);
  for (const pathname of ['/.env', '/%2eenv', '/server/server.js', '/package.json']) {
    const result = await request(pathname);
    assert.equal(result.status, 404);
    assert.equal(result.body, 'Not Found');
  }
});

test('real HTTP server has bounded header/request timeouts and connection limits', () => {
  assert.equal(server.headersTimeout, HTTP_SERVER_OPTIONS.headersTimeout);
  assert.equal(server.requestTimeout, HTTP_SERVER_OPTIONS.requestTimeout);
  assert.equal(server.connectionsCheckingInterval, 1000);
  assert.equal(server.maxConnections, 1000);
  assert.equal(server.maxHeadersCount, 100);
});

test('directory and malformed Host requests return client errors instead of escaping the handler', async () => {
  for (const pathname of ['/assets/', '/assets/js/', '/tests/']) {
    assert.equal((await request(pathname)).status, 404);
  }
  const malformed = await request('/', { headers: { host: '[invalid' } });
  assert.equal(malformed.status, 400);
  assert.equal(JSON.parse(malformed.body).code, 'INVALID_URL');
});
