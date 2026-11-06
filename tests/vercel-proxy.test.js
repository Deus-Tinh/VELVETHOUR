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
