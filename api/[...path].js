import { proxyApiRequest } from '../functions/api/[[path]].js';

async function proxyRequest(request) {
  const env = {
    SERENITY_API_ORIGIN: process.env.SERENITY_API_ORIGIN || '',
    SERENITY_PROXY_TOKEN: process.env.SERENITY_PROXY_TOKEN,
  };

  return proxyApiRequest(request, env, (url, options) => {
    const fetchOptions = { ...options };
    if (fetchOptions.body && !['GET', 'HEAD'].includes(fetchOptions.method)) {
      fetchOptions.duplex = 'half';
    }
    return fetch(url, fetchOptions);
  });
}

export const GET = proxyRequest;
export const HEAD = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const OPTIONS = proxyRequest;
