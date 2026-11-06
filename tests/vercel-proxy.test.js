import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyRequest, ROUTED_PATH_PARAM } from '../api/proxy.js';

const env = { SERENITY_API_ORIGIN: 'https://serenity-api.onrender.com', SERENITY_PROXY_TOKEN: 'local-test-token-that-is-not-a-secret' };
const site = 'https://serenityspavn.vercel.app';

/** Simulate what vercel.json does: /api/<path>?q -> /api/proxy?__serenity_path=<path>&q */
function rewritten(pathAndQuery, init = {}) {
  const original = new URL(pathAndQuery, site);
  const url = new URL('/api/proxy', site);
  url.searchParams.set(ROUTED_PATH_PARAM, original.pathname.replace(/^\/api\/?/, ''));
  for (const [key, value] of original.searchParams) url.searchParams.append(key, value);
  return new Request(url, init);
}

function capture() {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response('{"ok":true}', { status: 200, headers: [['content-type', 'application/json'], ['set-cookie', 'serenity.sid=abc; Path=/; HttpOnly']] });
  };
  return { calls, fetcher };
}

test('multi-segment auth paths reach the backend with their original path, body and cookies', async () => {
  for (const path of ['/api/auth/login', '/api/auth/register', '/api/auth/logout', '/api/auth/forgot-password']) {
    const { calls, fetcher } = capture();
    const body = JSON.stringify({ email: 'khach@example.invalid', password: 'Test123!' });
    const response = await proxyRequest(rewritten(path, {
      method: 'POST', body, duplex: 'half',
      headers: { origin: site, cookie: 'serenity.sid=old', 'content-type': 'application/json' },
    }), env, fetcher);
    assert.equal(response.status, 200, path);
    assert.equal(calls[0].url, `${env.SERENITY_API_ORIGIN}${path}`);
    assert.equal(calls[0].options.headers.get('cookie'), 'serenity.sid=old');
    assert.equal(calls[0].options.headers.get('x-forwarded-host'), 'serenityspavn.vercel.app');
    assert.equal(await new Response(calls[0].options.body).text(), body);
    assert.deepEqual(response.headers.getSetCookie(), ['serenity.sid=abc; Path=/; HttpOnly']);
  }
});

test('GET session lookups keep their query string and drop the routing parameter', async () => {
  const { calls, fetcher } = capture();
  await proxyRequest(rewritten('/api/auth/me?fresh=1'), env, fetcher);
  assert.equal(calls[0].url, `${env.SERENITY_API_ORIGIN}/api/auth/me?fresh=1`);
});

test('a direct request without the rewrite parameter keeps its own /api path', async () => {
  const { calls, fetcher } = capture();
  await proxyRequest(new Request(`${site}/api/health`), env, fetcher);
  assert.equal(calls[0].url, `${env.SERENITY_API_ORIGIN}/api/health`);
});

test('routing parameter cannot escape the /api prefix', async () => {
  const { calls, fetcher } = capture();
  const url = new URL('/api/proxy', site);
  url.searchParams.set(ROUTED_PATH_PARAM, '../admin');
  const response = await proxyRequest(new Request(url), env, fetcher);
  assert.equal(response.status, 404);
  assert.equal(calls.length, 0);
});

// --- Chatbot path routing tests ---

test('chat/session, chat/messages, chat/reset are routed to backend via Vercel proxy', async () => {
  for (const [method, path, body] of [
    ['GET',  '/api/chat/session',  undefined],
    ['POST', '/api/chat/messages', JSON.stringify({ conversationId: 'abc', message: 'Xin chào' })],
    ['POST', '/api/chat/reset',    '{}'],
  ]) {
    const { calls, fetcher } = capture();
    const init = method === 'GET'
      ? { headers: { origin: site, cookie: 'serenity.sid=s1' } }
      : { method, body, duplex: 'half', headers: { origin: site, cookie: 'serenity.sid=s1', 'content-type': 'application/json' } };
    const response = await proxyRequest(rewritten(path, init), env, fetcher);
    assert.equal(response.status, 200, `${method} ${path}`);
    assert.equal(calls[0].url, `${env.SERENITY_API_ORIGIN}${path}`, `URL for ${path}`);
  }
});

// --- Client IP extraction tests ---

test('x-real-ip is used as x-serenity-client-ip when cf-connecting-ip is absent (Vercel)', async () => {
  const { calls, fetcher } = capture();
  await proxyRequest(rewritten('/api/chat/session', {
    headers: { origin: site, 'x-real-ip': '203.0.113.42' },
  }), env, fetcher);
  assert.equal(calls[0].options.headers.get('x-serenity-client-ip'), '203.0.113.42');
  // x-real-ip must not be forwarded upstream (stripped to prevent spoofing)
  assert.equal(calls[0].options.headers.get('x-real-ip'), null);
});

test('cf-connecting-ip takes priority over x-real-ip and x-forwarded-for', async () => {
  const { calls, fetcher } = capture();
  await proxyRequest(rewritten('/api/chat/session', {
    headers: {
      origin: site,
      'cf-connecting-ip': '198.51.100.7',
      'x-real-ip': '10.0.0.1',
      'x-forwarded-for': '172.16.0.5, 10.0.0.1',
    },
  }), env, fetcher);
  assert.equal(calls[0].options.headers.get('x-serenity-client-ip'), '198.51.100.7', 'cf-connecting-ip wins');
  assert.equal(calls[0].options.headers.get('x-real-ip'), null, 'x-real-ip stripped');
  assert.equal(calls[0].options.headers.get('x-forwarded-for'), null, 'x-forwarded-for stripped');
});

test('first entry of x-forwarded-for is used when neither cf-connecting-ip nor x-real-ip present', async () => {
  const { calls, fetcher } = capture();
  await proxyRequest(rewritten('/api/auth/login', {
    method: 'POST', body: '{}', duplex: 'half',
    headers: { origin: site, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.99, 10.0.0.2' },
  }), env, fetcher);
  assert.equal(calls[0].options.headers.get('x-serenity-client-ip'), '203.0.113.99');
  assert.equal(calls[0].options.headers.get('x-forwarded-for'), null, 'x-forwarded-for stripped from upstream');
});

test('no IP headers present leaves x-serenity-client-ip unset', async () => {
  const { calls, fetcher } = capture();
  await proxyRequest(rewritten('/api/chat/session', {
    headers: { origin: site },
  }), env, fetcher);
  assert.equal(calls[0].options.headers.get('x-serenity-client-ip'), null);
});
