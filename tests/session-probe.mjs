import { Readable } from 'node:stream';

const { server } = await import('../server/server.js');
const handler = server.listeners('request')[0];

async function call(method, url, body, cookie = '') {
  const incoming = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(incoming, { method, url, headers: { host: 'localhost:3001', cookie }, socket: { remoteAddress: 'session-restart-test' } });
  const outgoing = { headers: {}, status: 0, body: '', setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.entries(headers).forEach(([name, value]) => this.setHeader(name, value)); return this; },
    end(value = '') { this.body = value; return this; } };
  await handler(incoming, outgoing);
  return { status: outgoing.status, payload: outgoing.body ? JSON.parse(outgoing.body) : {}, cookie: outgoing.headers['set-cookie'] || '' };
}

if (process.argv[2] === 'login') {
  const result = await call('POST', '/api/auth/login', {
    email: 'khach@example.invalid', password: process.env.SERENITY_TEST_CUSTOMER_PASSWORD,
  });
  console.log(JSON.stringify({ status: result.status, userId: result.payload.user?.id, cookie: result.cookie.split(';')[0] }));
} else if (process.argv[2] === 'session') {
  const result = await call('GET', '/api/auth/session', undefined, process.env.SERENITY_TEST_SESSION_COOKIE || '');
  console.log(JSON.stringify({ status: result.status, userId: result.payload.user?.id, role: result.payload.user?.role }));
} else {
  throw new Error('Expected session probe mode: login or session.');
}
