/**
 * System-wide account reports for the superadmin control room (STAGE 2).
 * These deliberately read across EVERY tenant — no account_id scoping — and
 * are only reachable behind requireSuperadmin() at the API layer, mirroring
 * the page gate in the /admin/* layout.
 */

import { query } from '@/lib/db';
import { listAccounts, listUsers } from '@/lib/repositories/accounts';
import { currentPeriod } from '@/lib/accounts/usage';
import { getUsage, getAccountLimits } from '@/lib/accounts/usage';

export async function listPlanCodes() {
  const rows = await query('SELECT code, name FROM billing_plans ORDER BY code');
  return rows.map((r) => ({ code: r.code, name: r.name }));
}

function usageFromRow(row = {}) {
  return {
    researches: Number(row.researches_used || 0),
    opportunities: Number(row.opportunities_used || 0),
    ai_analyses: Number(row.ai_analyses_used || 0),
    demo_generations: Number(row.demo_generations_used || 0),
    users: Number(row.users_used || 0),
  };
}

function limitsFromRow(row = {}) {
  return {
    researches: row.limit_researches ?? null,
    opportunities: row.limit_opportunities ?? null,
    ai_analyses: row.limit_ai_analyses ?? null,
    demo_generations: row.limit_demo_generations ?? null,
    users: row.limit_users ?? null,
    watches: row.limit_watches ?? null,
  };
}

/**
 * Every account with member count + current-period usage + plan limits, in a
 * single read pass (no N+1). `plans` lists the codes a superadmin may move an
 * account onto (validated again server-side on the PATCH route).
 */
export async function listAccountsWithUsage() {
  const [accounts, usageRows, countRows, planRows, planNames] = await Promise.all([
    listAccounts(),
    query(
      `SELECT account_id, researches_used, opportunities_used, ai_analyses_used,
              demo_generations_used, users_used
         FROM account_usage WHERE period = ?`,
      [currentPeriod()]
    ),
    query('SELECT account_id, COUNT(*) AS n FROM users GROUP BY account_id'),
    query('SELECT * FROM billing_plans'),
    listPlanCodes(),
  ]);
  const usageBy = new Map(usageRows.map((u) => [Number(u.account_id), u]));
  const countBy = new Map(countRows.map((c) => [Number(c.account_id), Number(c.n)]));
  const limitBy = new Map(planRows.map((p) => [p.code, p]));

  return {
    plans: planNames,
    accounts: accounts.map((a) => {
      const id = Number(a.id);
      return {
        id,
        name: a.name,
        plan_code: a.plan_code,
        plan_name: planNames.find((p) => p.code === a.plan_code)?.name || a.plan_code,
        status: a.status,
        created_at: a.created_at,
        member_count: countBy.get(id) || 0,
        usage: usageFromRow(usageBy.get(id)),
        limits: limitsFromRow(limitBy.get(a.plan_code)),
      };
    }),
  };
}

/** Full control-room detail for one account: profile + users + limits + usage. */
export async function getAccountDetail(id) {
  const account = await listAccountsById(id);
  if (!account) return null;
  const [usage, limits, users] = await Promise.all([
    getUsage(id),
    getAccountLimits(id),
    listUsers(id),
  ]);
  return {
    account: {
      id: Number(account.id),
      name: account.name,
      plan_code: account.plan_code,
      status: account.status,
      created_at: account.created_at,
    },
    usage,
    limits,
    users: users.map((u) => ({
      id: Number(u.id),
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
    })),
  };
}

async function listAccountsById(id) {
  const rows = await query('SELECT * FROM accounts WHERE id = ?', [Number(id)]);
  return rows[0] || null;
}