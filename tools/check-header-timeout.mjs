import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { writeFile } from 'node:fs/promises';

// Four incomplete headers, fixed loopback target, fifteen-second hard stop.
const results = await Promise.all(Array.from({ length: 4 }, (_, index) => new Promise((resolve, reject) => {
  const started = performance.now();
  let response = '';
  const socket = createConnection({ host: '127.0.0.1', port: 3001 });
  const deadline = setTimeout(() => {
    socket.destroy();
    reject(new Error(`Socket ${index} did not close within 15 seconds.`));
  }, 15_000);
  socket.on('connect', () => socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Lab: '));
  socket.on('data', (chunk) => { response += chunk.toString(); });
  socket.on('error', (error) => { clearTimeout(deadline); reject(error); });
  socket.on('close', () => {
    clearTimeout(deadline);
    const elapsedMs = performance.now() - started;
    try {
      assert.match(response, /^HTTP\/1\.1 408 /);
      assert.ok(elapsedMs >= 9_000 && elapsedMs < 14_000, `Unexpected timeout: ${elapsedMs} ms`);
      resolve({ socket: index + 1, status: 408, closedAfterMs: Math.round(elapsedMs) });
    } catch (error) { reject(error); }
  });
})));
const health = await fetch('http://127.0.0.1:3001/api/health', { signal: AbortSignal.timeout(3000), redirect: 'error' });
assert.equal(health.status, 200);
const report = { target: '127.0.0.1:3001', checkedAt: new Date().toISOString(), maxSockets: 4, hardDeadlineMs: 15_000, results, healthAfter: 200 };
await writeFile(new URL('../docs/load-lab/header-timeout.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
