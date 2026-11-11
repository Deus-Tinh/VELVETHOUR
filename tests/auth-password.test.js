import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

test('End-to-end virtual email account + local TCP SMTP test server receives 6-digit OTP and resets password', async () => {
  setMailTransportForTests(null);
  const net = await import('node:net');

  const receivedRawMessages = [];
  const receivedRecipients = [];
  const smtpServer = net.createServer((socket) => {
    let inDataMode = false;
    let dataBuffer = '';
    let authStep = 0;
    socket.write('220 virtual-mail.local ESMTP Ready\r\n');

    let lineBuffer = '';
    socket.on('data', (chunk) => {
      lineBuffer += chunk.toString('utf8');
      while (true) {
        const idx = lineBuffer.indexOf('\r\n');
        if (idx === -1) break;
        const line = lineBuffer.slice(0, idx);
        lineBuffer = lineBuffer.slice(idx + 2);

        if (inDataMode) {
          if (line === '.') {
            inDataMode = false;
            receivedRawMessages.push(dataBuffer);
            dataBuffer = '';
            socket.write('250 2.0.0 OK: queued as VIRTUAL-OTP-01\r\n');
          } else {
            dataBuffer += `${line}\n`;
          }
          continue;
        }

        if (/^EHLO\b/i.test(line)) {
          socket.write('250-virtual-mail.local\r\n250 AUTH LOGIN\r\n');
        } else if (/^AUTH LOGIN$/i.test(line)) {
          authStep = 1;
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (authStep === 1) {
          authStep = 2;
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else if (authStep === 2) {
          authStep = 0;
          socket.write('235 2.7.0 Authentication successful\r\n');
        } else if (/^MAIL FROM:/i.test(line)) {
          socket.write('250 2.1.0 Ok\r\n');
        } else if (/^RCPT TO:/i.test(line)) {
          receivedRecipients.push(line);
          socket.write('250 2.1.5 Ok\r\n');
        } else if (/^DATA$/i.test(line)) {
          inDataMode = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (/^QUIT$/i.test(line)) {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });

  await new Promise((resolve) => smtpServer.listen(0, '127.0.0.1', resolve));
  const smtpPort = smtpServer.address().port;

  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtpPort);
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_ALLOW_PLAINTEXT = 'true';
  process.env.SMTP_USER = 'virtual-mailer@serenityspa.local';
  process.env.SMTP_PASS = 'VirtualSmtpPass2026@';
  process.env.SMTP_FROM = 'Serenity Spa <virtual-mailer@serenityspa.local>';

  try {
    // 1. Tạo tài khoản khách hàng bằng email ảo
    const virtualEmail = 'khach.ao.otp@virtual-mail.test';
    const registerRes = await request('POST', '/api/auth/register', {
      name: 'Khách Mail Ảo',
      phone: '0978123456',
      email: virtualEmail,
      password: 'OldVirtualPass1@',
    });
    assert.equal(registerRes.status, 201);
    assert.equal(registerRes.body.user.email, virtualEmail);

    // Emulate a legacy imported account with inconsistent casing and whitespace.
    const legacyDb = new DatabaseSync(process.env.SERENITY_DB_PATH);
    try {
      const row = legacyDb.prepare('SELECT payload FROM collection_records WHERE collection = ? AND id = ?')
        .get('users', registerRes.body.user.id);
      assert.ok(row, 'Registered account must exist in the isolated test database');
      const legacyUser = JSON.parse(row.payload);
      legacyUser.email = `  ${virtualEmail.toUpperCase()}  `;
      legacyDb.prepare('UPDATE collection_records SET payload = ? WHERE collection = ? AND id = ?')
        .run(JSON.stringify(legacyUser), 'users', registerRes.body.user.id);
    } finally {
      legacyDb.close();
    }

    // 2. Gửi yêu cầu Quên mật khẩu -> Server kết nối tới máy chủ SMTP TCP giả lập cục bộ
    const otpReqRes = await request('POST', '/api/auth/forgot-password/request', {
      email: virtualEmail,
    });
    assert.equal(otpReqRes.status, 200);
    assert.equal(otpReqRes.body.ok, true);
    assert.equal(otpReqRes.body.email, virtualEmail, 'Legacy stored email must be normalized in the response');
    assert.equal(receivedRawMessages.length, 1, 'Virtual SMTP server must receive 1 MIME email');
    assert.deepEqual(receivedRecipients, [`RCPT TO:<${virtualEmail}>`], 'SMTP recipient must use the normalized email');

    // 3. Giải mã nội dung MIME base64 từ hòm thư ảo để lấy mã OTP 6 chữ số
    const rawMime = receivedRawMessages[0];
    const base64Blocks = [...rawMime.matchAll(/Content-Transfer-Encoding: base64\n\n([A-Za-z0-9+/=]+)/g)];
    assert.ok(base64Blocks.length >= 1, 'MIME payload contains base64 body');
    const decodedPlainText = Buffer.from(base64Blocks[0][1], 'base64').toString('utf8');
    const otpMatch = decodedPlainText.match(/\b(\d{6})\b/);
    assert.ok(otpMatch, 'Decoded email from virtual inbox must contain 6-digit OTP');
    const otpCode = otpMatch[1];

    // 4. Đặt lại mật khẩu mới bằng mã OTP vừa nhận từ mail ảo
    const newVirtualPass = 'NewVirtualPass2026@';
    const resetRes = await request('POST', '/api/auth/forgot-password/reset', {
      email: virtualEmail,
      otp: otpCode,
      newPassword: newVirtualPass,
      confirmPassword: newVirtualPass,
    });
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.ok, true);

    // 5. Đăng nhập lại với mật khẩu mới
    const loginNewRes = await request('POST', '/api/auth/login', {
      email: virtualEmail,
      password: newVirtualPass,
    });
    assert.equal(loginNewRes.status, 200);
    assert.equal(loginNewRes.body.user.email, virtualEmail);
  } finally {
    await new Promise((resolve) => smtpServer.close(resolve));
  }
});

