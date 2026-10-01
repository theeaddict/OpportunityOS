import crypto from 'node:crypto';
import { query, insert } from '@/lib/db';

/**
 * One-time email tokens (password reset, email verification). Only the SHA-256
 * hash is stored. Consuming is atomic: the row is claimed with a conditional
 * UPDATE, so a token can never be used twice, even by two parallel requests.
 */

const hash = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

/** Creates a token and returns the RAW value to email. Older unused tokens of the same purpose are revoked. */
export async function createToken(userId, purpose, ttlMinutes) {
  await query(
    'UPDATE auth_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = ? AND used_at IS NULL',
    [Number(userId), purpose]
  );
  const raw = crypto.randomBytes(32).toString('hex');
  await insert(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES (?, ?, ?, NOW() + (? * INTERVAL '1 minute'))`,
    [Number(userId), purpose, hash(raw), Number(ttlMinutes)]
  );
  return raw;
}

/** Returns the user id if the token is valid, unused and unexpired — and burns it. Otherwise null. */
export async function consumeToken(raw, purpose) {
  if (typeof raw !== 'string' || !/^[0-9a-f]{64}$/.test(raw)) return null;
  const rows = await query(
    'SELECT id, user_id FROM auth_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > NOW()',
    [hash(raw), purpose]
  );
  const row = rows[0];
  if (!row) return null;
  const res = await query('UPDATE auth_tokens SET used_at = NOW() WHERE id = ? AND used_at IS NULL', [row.id]);
  return res.affectedRows === 1 ? Number(row.user_id) : null;
}
