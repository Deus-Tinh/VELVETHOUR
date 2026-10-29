/**
 * SHA-256 đồng bộ (thuần JS) dùng để băm mật khẩu tài khoản DEMO.
 * LƯU Ý: đây chỉ nhằm không lưu plaintext trong LocalStorage; KHÔNG phải bảo mật thực.
 * Hằng số K và H được sinh từ căn bậc 2/3 của các số nguyên tố (đúng đặc tả FIPS 180-4).
 */
const PRIMES = [];
for (let n = 2; PRIMES.length < 64; n++) {
  if (PRIMES.every((p) => n % p !== 0)) PRIMES.push(n);
}
const frac = (x) => x - Math.floor(x);
const K = PRIMES.map((p) => Math.floor(frac(Math.cbrt(p)) * 2 ** 32) >>> 0);
const H0 = PRIMES.slice(0, 8).map((p) => Math.floor(frac(Math.sqrt(p)) * 2 ** 32) >>> 0);
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256(message) {
  const bytes = Array.from(new TextEncoder().encode(message));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 2 ** 32);
  const lo = bitLen >>> 0;
  for (const v of [hi, lo]) bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);

  const h = H0.slice();
  const w = new Array(64);
  for (let i = 0; i < bytes.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      const j = i + t * 4;
      w[t] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, idx) => { h[idx] = (h[idx] + v) >>> 0; });
  }
  return h.map((v) => v.toString(16).padStart(8, '0')).join('');
}

export function hashPassword(password, salt) {
  return sha256(`${salt}:${password}`);
}
