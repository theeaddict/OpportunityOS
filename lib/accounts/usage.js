/**
 * Per-account usage + plan limits (subscription-ready tracking, no billing).
 * Usage is period-based ('YYYY-MM'); counters reset implicitly because each
 * period has its own row. NULL limit means unlimited (internal plan).
 */

import { query } from '@/lib/db';
import { HttpError } from '@/lib/api-helpers';
import { getAccount } from '@/lib/repositories/accounts';

export const USAGE_COLUMNS = {
  researches: 'researches_used',
  opportunities: 'opportunities_used',
  ai_analyses: 'ai_analyses_used',
  demo_generations: 'demo_generations_used',
};

export const USAGE_KEYS = {
  researches_used: 'researches',
  opportunities_used: 'opportunities',
  ai_analyses_used: 'ai_analyses',
  demo_generations_used: 'demo_generations',
};

export function currentPeriod(d = new Date()) {
  const dt = d instanceof Date ? d : new Date();
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getUsage(accountId) {
  const period = currentPeriod();
  const rows = await query(
    'SELECT * FROM account_usage WHERE account_id = ? AND period = ?',
    [Number(accountId), period]
  );
  const row = rows[0] || {};
  return {
    account_id: Number(accountId),
    period,
    researches: Number(row.researches_used || 0),
    opportunities: Number(row.opportunities_used || 0),
    ai_analyses: Number(row.ai_analyses_used || 0),
    demo_generations: Number(row.demo_generations_used || 0),
    users: Number(row.users_used || 0),
  };
}

export async function incrementUsage(accountId, key, units = 1) {
  const column = USAGE_COLUMNS[key];
  if (!column || !USAGE_KEYS[column]) return;
  const period = currentPeriod();
  const n = Math.max(0, Math.floor(Number(units) || 0));
  if (!n) return;
  await query(
    `INSERT INTO account_usage (account_id, period, ${column})
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE ${column} = ${column} + VALUES(${column})`,
    [Number(accountId), period, n]
  ).catch(() => {});
}

export async function getAccountLimits(accountId) {
  const acct = await getAccount(accountId);
  const code = (acct && acct.plan_code) || 'free';
  const rows = await query(
    `SELECT code, name, limit_researches, limit_opportunities,
            limit_ai_analyses, limit_demo_generations, limit_users, limit_watches
       FROM billing_plans WHERE code = ?`,
    [code]
  );
  const p = rows[0] || null;
  return {
    plan: code,
    plan_name: p?.name || code,
    status: acct?.status || 'active',
    limits: {
      researches: p?.limit_researches ?? null,
      opportunities: p?.limit_opportunities ?? null,
      ai_analyses: p?.limit_ai_analyses ?? null,
      demo_generations: p?.limit_demo_generations ?? null,
      users: p?.limit_users ?? null,
      watches: p?.limit_watches ?? null,
    },
  };
}

/** Read-only status for a usage key: { used, limit, allowed }. */
export async function usageStatus(accountId, key) {
  const usage = await getUsage(accountId);
  const { limits } = await getAccountLimits(accountId);
  const used = Number(usage[key] || 0);
  const limit = limits[key] ?? null;
  return { used, limit, allowed: limit == null || used < limit };
}

/**
 * Throw 403 unless the account is under its plan limit for `key`.
 * Used at the request boundary BEFORE enqueuing expensive work.
 */
export async function assertWithinLimit(accountId, key, units = 1) {
  const { used, limit, allowed } = await usageStatus(accountId, key);
  if (!allowed) {
    const label = key.replaceAll('_', ' ');
    throw new HttpError(
      403,
      `Plan limit reached for ${label} (${used}/${limit} this month). Upgrade or wait for the next period.`
    );
  }
  return { used, limit };
}

/**
 * Active recurring discovery "watch" schedules vs the plan cap. Unlike the
 * period-based counters above this is a concurrent cap: a paused watch
 * (enabled = 0) does not consume capacity.
 */
export async function watchLimitStatus(accountId) {
  const { limits } = await getAccountLimits(accountId);
  const rows = await query(
    'SELECT COUNT(*) AS n FROM discover_schedules WHERE account_id = ? AND enabled = 1',
    [Number(accountId)]
  );
  const used = Number(rows[0]?.n || 0);
  const limit = limits.watches ?? null;
  return { used, limit, allowed: limit == null || used < limit };
}

/** Throw 403 when the account already has the plan's maximum active watches. */
export async function assertWithinWatchLimit(accountId) {
  const { used, limit, allowed } = await watchLimitStatus(accountId);
  if (!allowed) {
    throw new HttpError(
      403,
      `Plan limit reached for active watches (${used}/${limit}). Pause some watches or upgrade.`
    );
  }
  return { used, limit };
}