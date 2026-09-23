import { query, insert } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

/** Append-only audit trail. Auditing must never break the request. */
export async function audit(action, { entity_type = null, entity_id = null, metadata = {}, user_id = null, account_id = null } = {}) {
  let uid = user_id;
  let acct = account_id;
  if (!uid) {
    const user = await getCurrentUser().catch(() => null);
    uid = user?.id || null;
    if (acct == null) acct = user?.account_id || null;
  }
  await insert(
    'INSERT INTO audit_logs (user_id, account_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)',
    [uid, acct != null ? Number(acct) : null, action, entity_type, entity_id ? Number(entity_id) : null, JSON.stringify(metadata || {})]
  ).catch(() => {});
}

export async function listAudit({ limit = 100 } = {}) {
  return query(
    `SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC LIMIT ${Number(limit)}`
  );
}
