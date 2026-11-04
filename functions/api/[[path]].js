const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function configuredOrigin(env) {
  let target;
  try { target = new URL(String(env.SERENITY_API_ORIGIN || '')); }
  catch { throw new Error('SERENITY_API_ORIGIN is missing or invalid.'); }

  const localDevelopment = env.ENVIRONMENT === 'development'
    && ['localhost', '127.0.0.1'].includes(target.hostname);
  if ((!localDevelopment && target.protocol !== 'https:')
    || (!localDevelopment && target.hostname !== 'serenityspa-37e2.onweeny.com')
    || (!localDevelopment && target.port)
    || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('SERENITY_API_ORIGIN must be the fixed HTTPS API origin https://serenityspa-37e2.onweeny.com.');
  }
  return target.origin;
}

export async function proxyApiRequest(request, env, fetcher = fetch) {
  const incoming = new URL(request.url);
  if (incoming.pathname !== '/api' && !incoming.pathname.startsWith('/api/')) {
    return new Response('Not Found', { status: 404 });
  }
  const origin = configuredOrigin(env);
  const proxyToken = String(env.SERENITY_PROXY_TOKEN || '');
  if (proxyToken.length < 32) return new Response('API proxy is not configured.', { status: 503 });

  if (request.headers.has('origin') && request.headers.get('origin') !== incoming.origin) {
    return new Response('Origin not allowed.', { status: 403 });
  }

  const upstreamUrl = new URL(`${incoming.pathname}${incoming.search}`, origin);
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName) || ['host', 'content-length', 'origin', 'x-forwarded-host',
      'cf-connecting-ip', 'x-serenity-client-ip'].includes(lowerName)) continue;
    headers.append(name, value);
  }
  const publicOrigin = request.headers.get('origin');
  if (publicOrigin) {
    headers.set('origin', publicOrigin);
    headers.set('x-forwarded-host', incoming.host);
  }
  headers.set('x-serenity-proxy-token', proxyToken);
  const edgeClientIp = request.headers.get('cf-connecting-ip');
  if (edgeClientIp) headers.set('x-serenity-client-ip', edgeClientIp);

  const response = await fetcher(upstreamUrl, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
  });
  const responseHeaders = new Headers();
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === 'set-cookie' || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    responseHeaders.append(name, value);
  }
  const cookies = response.headers.getSetCookie?.() || [];
  for (const cookie of cookies) responseHeaders.append('set-cookie', cookie);

  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export function onRequest({ request, env }) {
  return proxyApiRequest(request, env);
}
