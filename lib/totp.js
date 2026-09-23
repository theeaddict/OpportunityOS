import crypto from 'crypto';

// RFC 6238 time-based one-time passwords using only the standard library —
// ported from BiasharaOS internal/totp (deliberately no new dependency).
// Standard TOTP parameters: HMAC-SHA1, 6 digits, 30s period, ±1 step skew.

const PERIOD = 30;
const DIGITS = 6;
const SECRET_BYTES = 20; // 160 bits — RFC 4226 recommended minimum for HMAC-SHA1

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Alphabet for backup codes: unambiguous uppercase letters + digits (no 0/1/O/I/L).
const BACKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const BACKUP_LENGTH = 10;
const BACKUP_COUNT = 10;

export function generateSecret() {
  const b = crypto.randomBytes(SECRET_BYTES);
  let out = '';
  for (const byte of b) out += BASE32_ALPHABET[(byte >> 3) & 0x1f];
  out += BASE32_ALPHABET[(b[b.length - 1] & 0x07) << 2];
  return out;
}

function decodeBase32(input) {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`invalid base32 char: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function code(secret, counter) {
  const key = decodeBase32(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter), 0);

  const mac = crypto.createHmac('sha1', key);
  mac.update(buf);
  const sum = mac.digest();

  const offset = sum[sum.length - 1] & 0x0f;
  const truncated =
    ((sum[offset] & 0x7f) << 24) |
    (sum[offset + 1] << 16) |
    (sum[offset + 2] << 8) |
    sum[offset + 3];

  return String(truncated % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** URI for authenticator apps (QR / tappable otpauth link). */
export function totpUri(secret, issuer, accountName) {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${accountName}`)}?${params.toString()}`;
}

/** Current valid code for a secret (tests / operator tooling). */
export function totpNow(secret) {
  return code(secret, Math.floor(Date.now() / 1000 / PERIOD));
}

/** Validate a 6-digit code against the secret, allowing ±1 step of skew. */
export function validateTotp(secret, userCode) {
  const c = String(userCode || '').trim();
  if (c.length !== DIGITS || !/^\d+$/.test(c)) return false;
  const now = Math.floor(Date.now() / 1000 / PERIOD);
  for (let counter = now - 1; counter <= now + 1; counter++) {
    const want = code(secret, counter);
    if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(c))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Backup codes (recovery when the authenticator app is lost)
// ---------------------------------------------------------------------------

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function generateBackupCodes({ count = BACKUP_COUNT, length = BACKUP_LENGTH } = {}) {
  const codes = [];
  const seen = new Set();
  while (codes.length < count) {
    let s = '';
    for (let i = 0; i < length; i++) {
      s += BACKUP_ALPHABET[crypto.randomInt(BACKUP_ALPHABET.length)];
    }
    if (seen.has(s)) continue;
    seen.add(s);
    codes.push(s);
  }
  return codes;
}

/** Store only hashes so a DB leak can't be replayed as codes. */
export function hashBackupCodes(codes) {
  return codes.map(sha256Hex);
}

/**
 * Verify a backup code against the stored SHA-256 hashes.
 * Returns the zero-based index of the matching hash (for one-time consumption)
 * or -1 when no match.
 */
export function findBackupCode(storedCodes, userCode) {
  const c = String(userCode || '').trim();
  if (!c) return -1;
  const digest = sha256Hex(c);
  return (Array.isArray(storedCodes) ? storedCodes : []).indexOf(digest);
}