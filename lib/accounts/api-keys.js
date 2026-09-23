import { query, insert } from '@/lib/db';
import { randomBytes, createHash } from 'crypto';

const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomString(len) {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += ALPHA[bytes[i] % ALPHA.length];
  return out;
}

/** Generate a full platform API key: `oppo_live_<40 alnum>`. */
export function generateApiKey() {
  const secret = randomString(40);
  return `oppo_live_${secret}`;
}

export function hashApiKey(fullKey) {
  return createHash('sha256').update(String(fullKey)).digest('hex');
}

export function keyPrefix(fullKey) {
  return String(fullKey).slice(0, 20) + '…';
}

/** Create a key record. The FULL key is only ever returned here (shown once). */
export async function createApiKey({ account_id, name, rate_limit_hour = null, created_by = null }) {
  const fullKey = generateApiKey();
  const id = await insert(
    `INSERT INTO api_keys (account_id, name, key_prefix, key_hash, status, rate_limit_hour, created_by)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    [
      Number(account_id),
      String(name || '').slice(0, 80),
      keyPrefix(fullKey),
      hashApiKey(fullKey),
      rate_limit_hour != null ? Number(rate_limit_hour) : null,
      created_by != null ? Number(created_by) : null,
    ]
  );
  return { id, full_key: fullKey };
}

export function listApiKeys(accountId = null) {
  const where = accountId != null ? 'WHERE k.account_id = ?' : '';
  const params = accountId != null ? [Number(accountId)] : [];
  return query(
    `SELECT k.id, k.account_id, k.name, k.key_prefix, k.status, k.rate_limit_hour,
            k.last_used_at, k.created_at, a.name AS account_name
       FROM api_keys k JOIN accounts a ON a.id = k.account_id
      ${where} ORDER BY k.created_at DESC, k.id DESC`,
    params
  );
}

export async function getApiKey(id) {
  const rows = await query('SELECT * FROM api_keys WHERE id = ?', [Number(id)]);
  return rows[0] || null;
}

/** Set a key's status to 'revoked' (soft delete — history is kept). */
export async function revokeApiKey(id) {
  const res = await query(
    `UPDATE api_keys SET status = 'revoked', updated_at = NOW() WHERE id = ?`,
    [Number(id)]
  );
  return Number(res.affectedRows || 0);
}

/** Mark a key as used (for the last_used_at column). */
export async function touchApiKey(id) {
  await query('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [Number(id)]).catch(() => {});
}

/** Resolve an ingest request's plains full key to { account_id, key } or null. */
export async function findAccountByApiKey(fullKey) {
  const rows = await query(
    `SELECT id, account_id, name, status, rate_limit_hour
       FROM api_keys WHERE key_hash = ? AND status = 'active'`,
    [hashApiKey(fullKey)]
  );
  const row = rows[0] || null;
  if (!row) return null;
  touchApiKey(row.id);
  return { account_id: Number(row.account_id), key_id: Number(row.id), name: row.name };
}