import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, proxyApiRequest } from '../functions/api/[[path]].js';

const env = { SERENITY_API_ORIGIN: 'https://api.pages.tdt.dev', SERENITY_PROXY_TOKEN: 'local-test-token-that-is-not-a-secret' };

test('Pages proxy forwards API method, path, query, body, cookie and proxy authentication', async () => {
  const request = new Request('https://serenity.pages.dev/api/bookings?include=payment', {
    method: 'POST',
    headers: { origin: 'https://serenity.pages.dev', cookie: 'serenity.sid=test-session', 'content-type': 'application/json',
      'cf-connecting-ip': '198.51.100.27', 'x-serenity-client-ip': '203.0.113.99', 'x-forwarded-host': 'attacker.example' },
    body: JSON.stringify({ serviceId: 'test-service' }),
  });
  let forwarded;
  const response = await proxyApiRequest(request, env, async (url, options) => {
    forwarded = { url: String(url), options };
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'content-type': 'application/json' } });
  });

  assert.equal(forwarded.url, 'https://api.pages.tdt.dev/api/bookings?include=payment');
  assert.equal(forwarded.options.method, 'POST');
  assert.equal(forwarded.options.headers.get('cookie'), 'serenity.sid=test-session');
  assert.equal(forwarded.options.headers.get('x-serenity-proxy-token'), env.SERENITY_PROXY_TOKEN);
  assert.equal(forwarded.options.headers.get('origin'), 'https://serenity.pages.dev');
  assert.equal(forwarded.options.headers.get('x-forwarded-host'), 'serenity.pages.dev');
  assert.equal(forwarded.options.headers.get('x-serenity-client-ip'), '198.51.100.27', 'the edge IP replaces any client-supplied value');
  assert.deepEqual(JSON.parse(await new Response(forwarded.options.body).text()), { serviceId: 'test-service' });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.has('x-serenity-proxy-token'), false);
});

test('Pages proxy preserves multiple Set-Cookie headers and handles HEAD without a response body', async () => {
  const login = new Request('https://serenity.pages.dev/api/auth/login', { method: 'GET' });
  const response = await proxyApiRequest(login, env, async () => new Response(null, {
    status: 200,
    headers: [['set-cookie', 'first=1; Path=/; HttpOnly'], ['set-cookie', 'second=2; Path=/; HttpOnly']],
  }));
  assert.deepEqual(response.headers.getSetCookie(), ['first=1; Path=/; HttpOnly', 'second=2; Path=/; HttpOnly']);

  const head = new Request('https://serenity.pages.dev/api/health', { method: 'HEAD' });
  const headResponse = await proxyApiRequest(head, env, async (_url, options) => {
    assert.equal(options.body, undefined);
    return new Response('health', { status: 200 });
  });
  assert.equal(await headResponse.text(), '');
});

test('Pages proxy rejects cross-origin writes, path escapes and arbitrary upstreams', async () => {
  const crossOrigin = new Request('https://serenity.pages.dev/api/bookings', {
    method: 'POST', headers: { origin: 'https://attacker.example' }, body: '{}',
  });
  assert.equal((await proxyApiRequest(crossOrigin, env, async () => assert.fail('must not forward'))).status, 403);

  assert.equal((await onRequest({ request: new Request('https://serenity.pages.dev/admin'), env })).status, 404);
  await assert.rejects(() => proxyApiRequest(new Request('https://serenity.pages.dev/api/health'), {
    ...env, SERENITY_API_ORIGIN: 'https://attacker.example',
  }), /fixed HTTPS API origin/);
  for (const SERENITY_API_ORIGIN of ['http://api.pages.tdt.dev', 'https://api.pages.tdt.dev:444', 'https://user@api.pages.tdt.dev']) {
    await assert.rejects(() => proxyApiRequest(new Request('https://serenity.pages.dev/api/health'), {
      ...env, SERENITY_API_ORIGIN,
    }), /fixed HTTPS API origin/);
  }
  assert.equal((await proxyApiRequest(new Request('https://serenity.pages.dev/api/health'), {
    ...env, SERENITY_PROXY_TOKEN: 'too-short',
  })).status, 503);
});
