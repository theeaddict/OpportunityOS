import { query, insert } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { getCurrentAdmin } from '@/lib/admin-auth';

/**
 * Append-only audit trail. Auditing must never break the request.
 * Attributable to a tenant user (user_id), a platform administrator
 * (admin_user_id), or neither (system/token paths).
 */
export async function audit(action, { entity_type = null, entity_id = null, metadata = {}, user_id = null, account_id = null, admin_user_id = null } = {}) {
  let uid = user_id;
  let acct = account_id;
  let aid = admin_user_id;
  if (!uid && !aid) {
    const admin = await getCurrentAdmin().catch(() => null);
    if (admin) {
      aid = admin.id;
    } else {
      const user = await getCurrentUser().catch(() => null);
      uid = user?.id || null;
      if (acct == null) acct = user?.account_id || null;
    }
  }
  await insert(
    'INSERT INTO audit_logs (user_id, account_id, admin_user_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uid, acct != null ? Number(acct) : null, aid != null ? Number(aid) : null, action, entity_type, entity_id ? Number(entity_id) : null, JSON.stringify(metadata || {})]
  ).catch(() => {});
}
