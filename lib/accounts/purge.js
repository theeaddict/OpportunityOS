/**
 * Account purge (control-room "Delete account").
 *
 * Hard-deletes one tenant workspace and every piece of data that belongs to it,
 * in a single transaction, in a dependency-safe order:
 *   * `businesses` cascades business_sources/business_contacts/business_evidence,
 *     opportunities (and through opportunities: assumptions, evidence, solutions,
 *     outreach_messages, pipeline_events, activity_log, financial_scenarios) and ai_jobs.
 *   * `solutions` cascades solution_problems/solution_industries.
 *   * `search_queries` cascades search_jobs.
 *   * `users` cascades sessions; remaining user FKs (audit_logs etc.) are SET NULL.
 *   * `accounts` cascades account_usage.
 *
 * `audit_logs` for the account are deliberately KEPT — the platform keeps a
 * history of what the admin did, including the purge itself.
 */

import { getPool } from '@/lib/db';

const ACCOUNT_SCOPED_NON_CASCADING = [
  'discover_schedules',
  'background_jobs',
  'app_settings',
];

/**
 * Permanently delete an account and all its data. Returns
 * `{ id, name, member_count }` for the audit trail, or null if the account
 * does not exist (nothing is deleted).
 */
export async function purgeAccount(accountId) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    const account = await getAccountInTx(conn, accountId);
    if (!account) {
      await conn.rollback();
      return null;
    }

    // Root tables — every child row is removed by ON DELETE CASCADE.
    await conn.execute('DELETE FROM businesses WHERE account_id = ?', [accountId]);
    await conn.execute('DELETE FROM solutions WHERE account_id = ?', [accountId]);
    await conn.execute('DELETE FROM search_queries WHERE account_id = ?', [accountId]);

    // Tables that carry account_id but have no FK to a cascading parent.
    for (const table of ACCOUNT_SCOPED_NON_CASCADING) {
      await conn.execute(`DELETE FROM ${table} WHERE account_id = ?`, [accountId]);
    }

    const [{ affectedRows: members }] = await conn.execute(
      'DELETE FROM users WHERE account_id = ?',
      [accountId]
    );

    await conn.execute('DELETE FROM accounts WHERE id = ?', [accountId]);

    await conn.commit();
    return {
      id: account.id,
      name: account.name,
      member_count: Number(members || 0),
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function getAccountInTx(conn, accountId) {
  const [rows] = await conn.execute('SELECT id, name FROM accounts WHERE id = ?', [accountId]);
  return rows[0] || null;
}