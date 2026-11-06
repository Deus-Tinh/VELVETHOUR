import net from 'node:net';
import tls from 'node:tls';

let customTransport = null;

export function setMailTransportForTests(transport) {
  customTransport = typeof transport === 'function' ? transport : null;
}

export function smtpConfigFromEnv(env = process.env) {
  const host = String(env.SMTP_HOST || '').trim();
  const port = Number(env.SMTP_PORT || 465);
  const secureRaw = String(env.SMTP_SECURE ?? '').trim().toLowerCase();
  const secure = secureRaw ? secureRaw === 'true' || secureRaw === '1' : port === 465;
  const allowPlaintext = String(env.SMTP_ALLOW_PLAINTEXT ?? '').trim().toLowerCase() === 'true';
  const user = String(env.SMTP_USER || '').trim();
  const pass = String(env.SMTP_PASS || '');
  const from = String(env.SMTP_FROM || user || 'Serenity Spa <no-reply@serenityspa.local>').trim();
  const timeoutMs = Number(env.SMTP_TIMEOUT_MS || 15000);
  return { host, port, secure, allowPlaintext, user, pass, from, timeoutMs };
}

export function isSmtpConfigured(env = process.env) {
  if (customTransport) return true;
  const cfg = smtpConfigFromEnv(env);
  return Boolean(cfg.host && cfg.port > 0 && cfg.user && cfg.pass);
}

function extractAddress(value) {
  const match = String(value || '').match(/<([^>]+)>/);
  return (match ? match[1] : String(value || '')).trim();
}

function encodeMimeHeader(text) {
  return `=?UTF-8?B?${Buffer.from(String(text || ''), 'utf8').toString('base64')}?=`;
}

function createResponseReader(socket) {
  let buffer = '';
  let pendingResolve = null;
  let pendingReject = null;
  const lines = [];

  const flushIfComplete = () => {
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx === -1) break;
      const rawLine = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      lines.push(rawLine);
      if (/^\d{3}(?: |$)/.test(rawLine) && pendingResolve) {
        const code = Number(rawLine.slice(0, 3));
        const message = lines.splice(0, lines.length).join('\n');
        const resolve = pendingResolve;
        pendingResolve = null;
        pendingReject = null;
        resolve({ code, message });
        break;
      }
    }
  };

  const onData = (chunk) => {
    buffer += chunk.toString('utf8');
    flushIfComplete();
  };
  const onError = (err) => {
    if (pendingReject) {
      const reject = pendingReject;
      pendingResolve = null;
      pendingReject = null;
      reject(err);
    }
  };
  const onClose = () => {
    if (pendingReject) {
      const reject = pendingReject;
      pendingResolve = null;
      pendingReject = null;
      reject(new Error('Kết nối SMTP đã đóng đột ngột.'));
    }
  };

  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);

  return {
    readResponse() {
      return new Promise((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
        flushIfComplete();
      });
    },
    detach() {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    },
  };
}

async function sendCommand(socket, reader, command, expectedPrefixes = [2, 3]) {
  socket.write(`${command}\r\n`);
  const response = await reader.readResponse();
  const prefix = Math.floor(response.code / 100);
  if (!expectedPrefixes.includes(prefix)) {
    const error = new Error(`SMTP error (${response.code}): ${response.message}`);
    error.smtpCode = response.code;
    throw error;
  }
  return response;
}

export async function sendSmtpMail({ to, subject, text, html }, env = process.env) {
  if (customTransport) {
    return customTransport({ to, subject, text, html });
  }

  const cfg = smtpConfigFromEnv(env);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    const err = new Error('Máy chủ chưa cấu hình SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS) trong .env để gửi email OTP.');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }

  const connectSocket = () => new Promise((resolve, reject) => {
    const socket = cfg.secure
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }, () => resolve(socket))
      : net.connect({ host: cfg.host, port: cfg.port }, () => resolve(socket));
    socket.setTimeout(cfg.timeoutMs, () => {
      socket.destroy(new Error('Hết thời gian kết nối máy chủ SMTP.'));
    });
    socket.once('error', reject);
  });

  let socket = await connectSocket();
  let reader = createResponseReader(socket);

  try {
    const greeting = await reader.readResponse();
    if (Math.floor(greeting.code / 100) !== 2) {
      throw new Error(`SMTP greeting failed (${greeting.code}): ${greeting.message}`);
    }

    await sendCommand(socket, reader, 'EHLO serenityspa.local', [2]);

    if (!cfg.secure && !cfg.allowPlaintext) {
      await sendCommand(socket, reader, 'STARTTLS', [2]);
      reader.detach();
      socket = await new Promise((resolve, reject) => {
        const tlsSocket = tls.connect({ socket, servername: cfg.host }, () => resolve(tlsSocket));
        tlsSocket.setTimeout(cfg.timeoutMs, () => {
          tlsSocket.destroy(new Error('Hết thời gian nâng cấp STARTTLS.'));
        });
        tlsSocket.once('error', reject);
      });
      reader = createResponseReader(socket);
      await sendCommand(socket, reader, 'EHLO serenityspa.local', [2]);
    }

    await sendCommand(socket, reader, 'AUTH LOGIN', [3]);
    await sendCommand(socket, reader, Buffer.from(cfg.user, 'utf8').toString('base64'), [3]);
    await sendCommand(socket, reader, Buffer.from(cfg.pass, 'utf8').toString('base64'), [2]);

    const fromAddr = extractAddress(cfg.from);
    const toAddr = extractAddress(to);
    await sendCommand(socket, reader, `MAIL FROM:<${fromAddr}>`, [2]);
    await sendCommand(socket, reader, `RCPT TO:<${toAddr}>`, [2]);
    await sendCommand(socket, reader, 'DATA', [3]);

    const boundary = `serenity_${Date.now().toString(36)}`;
    const headers = [
      `From: ${cfg.from}`,
      `To: <${toAddr}>`,
      `Subject: ${encodeMimeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ];
    const bodyLines = [
      ...headers,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(String(text || ''), 'utf8').toString('base64'),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(String(html || text || ''), 'utf8').toString('base64'),
      `--${boundary}--`,
      '.',
    ];

    await sendCommand(socket, reader, bodyLines.join('\r\n'), [2]);
    await sendCommand(socket, reader, 'QUIT', [2]).catch(() => {});
    return { ok: true };
  } finally {
    reader.detach();
    socket.destroy();
  }
}

export async function sendPasswordResetOtpEmail({ to, name, otp, expiresInMinutes = 10 }, env = process.env) {
  const displayName = name || to;
  const subject = `[Serenity Spa] Mã xác thực OTP khôi phục mật khẩu: ${otp}`;
  const text = [
    `Xin chào ${displayName},`,
    '',
    'Bạn vừa yêu cầu đặt lại mật khẩu tài khoản tại Serenity Spa & Wellness.',
    `Mã xác thực OTP của bạn là: ${otp}`,
    `Mã có hiệu lực trong vòng ${expiresInMinutes} phút. Tuyệt đối không chia sẻ mã này cho bất kỳ ai.`,
    '',
    'Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email này.',
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e7ded4;border-radius:12px;background:#ffffff;color:#1e293b;">
      <h2 style="margin:0 0 12px;color:#8e6e3f;">Serenity Spa &amp; Wellness</h2>
      <p style="margin:0 0 14px;">Xin chào <strong>${String(displayName).replace(/[&<>"']/g, '')}</strong>,</p>
      <p style="margin:0 0 16px;line-height:1.6;">Bạn vừa yêu cầu khôi phục mật khẩu tài khoản. Vui lòng nhập mã OTP gồm 6 chữ số bên dưới để đặt lại mật khẩu mới:</p>
      <div style="text-align:center;margin:20px 0;padding:16px;background:#faf8f5;border:1px dashed #8e6e3f;border-radius:8px;font-size:28px;font-weight:700;letter-spacing:6px;color:#8e6e3f;">
        ${otp}
      </div>
      <p style="margin:0 0 10px;font-size:13px;color:#64748b;">Mã có hiệu lực trong <strong>${expiresInMinutes} phút</strong>. Tuyệt đối không chia sẻ mã này cho bất kỳ ai.</p>
      <p style="margin:0;font-size:13px;color:#64748b;">Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>
    </div>
  `;

  return sendSmtpMail({ to, subject, text, html }, env);
}
