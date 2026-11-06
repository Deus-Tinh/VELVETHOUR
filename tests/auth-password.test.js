import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { setMailTransportForTests } from '../server/mailer.js';
import { DEFAULT_STAFF_ADMIN_PASSWORD, DEFAULT_MANAGED_USERS } from '../assets/js/data/seed.js';

const directory = await mkdtemp(path.join(tmpdir(), 'serenity-auth-password-'));
process.env.SERENITY_DB_PATH = path.join(directory, 'test.sqlite');
process.env.SERENITY_API_RATE_LIMIT = '10000';
const { server } = await import('../server/server.js');
const handler = server.listeners('request')[0];

async function request(method, url, body, cookie = '') {
  const payload = body === undefined ? null : JSON.stringify(body);
  const incoming = Readable.from(payload ? [Buffer.from(payload)] : []);
  Object.assign(incoming, {
    method,
    url,
    headers: {
      host: 'localhost:3001',
      origin: 'http://localhost:3001',
      ...(payload ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}),
      ...(cookie ? { cookie } : {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
  });
  const outgoing = new Writable({
    write(chunk, _encoding, callback) {
      this.body += chunk.toString();
      callback();
    },
  });
  Object.assign(outgoing, {
    headers: {},
    status: 0,
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(status, responseHeaders = {}) {
      this.status = status;
      for (const [name, value] of Object.entries(responseHeaders)) {
        this.setHeader(name, value);
      }
      return this;
    },
  });
  await handler(incoming, outgoing);
  await finished(outgoing);
  const rawSetCookie = outgoing.headers['set-cookie'];
  const setCookieList = Array.isArray(rawSetCookie) ? rawSetCookie : (rawSetCookie ? [rawSetCookie] : []);
  const sessionCookie = setCookieList.map((item) => item.split(';')[0]).join('; ');
  return {
    status: outgoing.status,
    body: outgoing.body ? JSON.parse(outgoing.body) : null,
    cookie: sessionCookie || cookie,
  };
}

test.after(() => {
  setMailTransportForTests(null);
});

test('All managed Admin and 4 Staff accounts log in with shared default password Tinh211006@', async () => {
  assert.equal(DEFAULT_STAFF_ADMIN_PASSWORD, 'Tinh211006@');
  assert.equal(DEFAULT_MANAGED_USERS.length, 5);

  for (const managed of DEFAULT_MANAGED_USERS) {
    const loginRes = await request('POST', '/api/auth/login', {
      email: managed.email,
      password: DEFAULT_STAFF_ADMIN_PASSWORD,
    });
    assert.equal(loginRes.status, 200, `Login should succeed for ${managed.email}`);
    assert.equal(loginRes.body.user.email, managed.email);
    assert.equal(loginRes.body.user.role, managed.role);
    if (managed.staffId) {
      assert.equal(loginRes.body.user.staffId, managed.staffId);
    }
  }
});

test('Change password validates current password, confirmPassword, and updates credentials', async () => {
  const loginRes = await request('POST', '/api/auth/login', {
    email: 'linh@example.invalid',
    password: DEFAULT_STAFF_ADMIN_PASSWORD,
  });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.cookie;
  const userId = loginRes.body.user.id;

  const mismatchRes = await request('POST', '/api/auth/change-password', {
    userId,
    oldPassword: DEFAULT_STAFF_ADMIN_PASSWORD,
    newPassword: 'NewPassword2026@',
    confirmPassword: 'MismatchPassword2026@',
  }, cookie);
  assert.equal(mismatchRes.status, 400);

  const samePasswordRes = await request('POST', '/api/auth/change-password', {
    userId,
    oldPassword: DEFAULT_STAFF_ADMIN_PASSWORD,
    newPassword: DEFAULT_STAFF_ADMIN_PASSWORD,
    confirmPassword: DEFAULT_STAFF_ADMIN_PASSWORD,
  }, cookie);
  assert.equal(samePasswordRes.status, 400);

  const changeRes = await request('POST', '/api/auth/change-password', {
    userId,
    oldPassword: DEFAULT_STAFF_ADMIN_PASSWORD,
    newPassword: 'NewPassword2026@',
    confirmPassword: 'NewPassword2026@',
  }, cookie);
  assert.equal(changeRes.status, 200);
  assert.equal(changeRes.body.ok, true);

  const oldLoginRes = await request('POST', '/api/auth/login', {
    email: 'linh@example.invalid',
    password: DEFAULT_STAFF_ADMIN_PASSWORD,
  });
  assert.equal(oldLoginRes.status, 401);

  const newLoginRes = await request('POST', '/api/auth/login', {
    email: 'linh@example.invalid',
    password: 'NewPassword2026@',
  });
  assert.equal(newLoginRes.status, 200);
});

test('Forgot password sends 6-digit OTP email and resets password with valid OTP', async () => {
  const sentEmails = [];
  setMailTransportForTests(async (mail) => {
    sentEmails.push(mail);
  });

  const reqOtpRes = await request('POST', '/api/auth/forgot-password/request', {
    email: 'vy@example.invalid',
  });
  assert.equal(reqOtpRes.status, 200);
  assert.equal(reqOtpRes.body.ok, true);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'vy@example.invalid');

  const otpMatch = sentEmails[0].text.match(/\b(\d{6})\b/);
  assert.ok(otpMatch, 'Email body should include a 6-digit OTP code');
  const otp = otpMatch[1];

  const wrongOtpRes = await request('POST', '/api/auth/forgot-password/reset', {
    email: 'vy@example.invalid',
    otp: otp === '000000' ? '999999' : '000000',
    newPassword: 'ResetPassword2026@',
    confirmPassword: 'ResetPassword2026@',
  });
  assert.equal(wrongOtpRes.status, 400);

  const resetRes = await request('POST', '/api/auth/forgot-password/reset', {
    email: 'vy@example.invalid',
    otp,
    newPassword: 'ResetPassword2026@',
    confirmPassword: 'ResetPassword2026@',
  });
  assert.equal(resetRes.status, 200);
  assert.equal(resetRes.body.ok, true);

  const reuseOtpRes = await request('POST', '/api/auth/forgot-password/reset', {
    email: 'vy@example.invalid',
    otp,
    newPassword: 'AnotherPassword2026@',
    confirmPassword: 'AnotherPassword2026@',
  });
  assert.equal(reuseOtpRes.status, 400);

  const loginAfterReset = await request('POST', '/api/auth/login', {
    email: 'vy@example.invalid',
    password: 'ResetPassword2026@',
  });
  assert.equal(loginAfterReset.status, 200);
  assert.equal(loginAfterReset.body.user.staffId, 'st-03');
});
