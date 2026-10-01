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
// 12 chars over a 32-symbol alphabet ≈ 2^60 — brute force is out of reach even
// at high offline hash throughput (elevated from the prior 2^50).
const BACKUP_LENGTH = 12;
const BACKUP_COUNT = 10;

// Storage prefix marking the hardened format. Entries WITHOUT the prefix are
// legacy unsalted SHA-256 digests and stay verifiable (see findBackupCode).
const BACKUP_PREFIX = 'bc1$';

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

/**
 * Store only hashes so a DB leak can't be replayed as codes. Each code is
 * scrypt-hashed with its own random 16-byte salt (same KDF cost as the password
 * hashes, matching lib/scrypt hashPassword), so a leaked digest table yields
 * nothing — no salt reuse and no fast hash an attacker could precompute.
 */
export function hashBackupCodes(codes) {
  return codes.map((code) => {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(code), salt, 64, { N: 16384, r: 8, p: 1 });
    return `${BACKUP_PREFIX}${salt.toString('base64')}$${hash.toString('base64')}`;
  });
}

/**
 * Verify a backup code against the stored hashes. Returns the zero-based index
 * of the matching entry (for one-time consumption) or -1 when no match.
 *
 * Timing: the loop always runs over every stored entry (no early return) and
 * each candidate compare is constant-time, so response time reveals neither
 * HOW MANY codes remain nor WHERE a match is — a correct-entry probe is
 * indistinguishable from a wrong one. Legacy unsalted SHA-256 entries (written
 * before the hardened format shipped) and unknown/malformed entries are handled
 * in-place without skipping work.
 */
export function findBackupCode(storedCodes, userCode) {
  const c = String(userCode || '').trim();
  if (!c) return -1;
  const list = Array.isArray(storedCodes) ? storedCodes : [];
  const matched = [];
  for (let i = 0; i < list.length; i++) {
    const entry = String(list[i] || '');
    let ok = false;
    if (entry.startsWith(BACKUP_PREFIX)) {
      const parts = entry.slice(BACKUP_PREFIX.length).split('$');
      if (parts.length === 2) {
        const salt = Buffer.from(parts[0], 'base64');
        const want = Buffer.from(parts[1], 'base64');
        const got = crypto.scryptSync(c, salt, 64, { N: 16384, r: 8, p: 1 });
        ok = want.length === got.length && crypto.timingSafeEqual(want, got);
      } else {
        // Malformed hardened entry — equalize cost with a fresh scrypt burn so
        // the response is never fast enough to fingerprint the row.
        crypto.scryptSync(c, crypto.randomBytes(16), 64, { N: 16384, r: 8, p: 1 });
      }
    } else if (entry.length === 64 && /^[0-9a-f]{64}$/.test(entry)) {
      // Legacy format: unsalted SHA-256 hex (pre-harden digests). Still
      // verified constant-time against the stored digest.
      const want = Buffer.from(entry, 'hex');
      const got = Buffer.from(sha256Hex(c), 'hex');
      ok = crypto.timingSafeEqual(want, got);
    } else {
      // Unknown entry — burn the same scrypt cost to keep timing uniform.
      crypto.scryptSync(c, crypto.randomBytes(16), 64, { N: 16384, r: 8, p: 1 });
    }
    if (ok) matched.push(i);
  }
  return matched.length ? matched[0] : -1;
}