/** Origin validation for direct requests and reverse-proxied requests. */
export function isAllowedOrigin(origin, request) {
  let originHost;
  try { originHost = new URL(origin).host.toLowerCase(); }
  catch { return false; }

  // Reverse proxies such as Dev Tunnels may replace Host with the local
  // upstream address while forwarding the public host in X-Forwarded-Host.
  return [request.headers.host, request.headers['x-forwarded-host']].some((value) =>
    String(value || '').split(',').some((host) => host.trim().toLowerCase() === originHost));
}
