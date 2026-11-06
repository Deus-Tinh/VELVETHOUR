import { proxyApiRequest } from '../functions/api/[[path]].js';

// Vercel only routes single-segment paths to api/[...path].js outside Next.js,
// so vercel.json rewrites every /api/* request here and passes the original
// sub-path in this query parameter.
export const ROUTED_PATH_PARAM = '__serenity_path';

/** Rebuild the browser's original /api/... URL from the Vercel rewrite. */
export function originalApiRequest(request) {
  const url = new URL(request.url);
  if (url.searchParams.has(ROUTED_PATH_PARAM)) {
    const routed = url.searchParams.get(ROUTED_PATH_PARAM).replace(/^\/+/, '');
    url.searchParams.delete(ROUTED_PATH_PARAM);
    url.pathname = routed ? `/api/${routed}` : '/api';
  }
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? request.body : undefined,
    ...(hasBody ? { duplex: 'half' } : {}),
    redirect: 'manual',
  });
}

export function proxyRequest(request, env = process.env, fetcher = fetch) {
  return proxyApiRequest(originalApiRequest(request), {
    SERENITY_API_ORIGIN: env.SERENITY_API_ORIGIN || '',
    SERENITY_PROXY_TOKEN: env.SERENITY_PROXY_TOKEN,
  }, (url, options) => fetcher(url, options.body ? { ...options, duplex: 'half' } : options));
}

const handler = (request) => proxyRequest(request);
export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
