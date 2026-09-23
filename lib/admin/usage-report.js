/**
 * Platform-wide usage overview for the superadmin control room (STAGE 5).
 *
 * Reads every tenant's current-period counters (account_usage) against the
 * plan limits (billing_plans) — no account_id scoping, only reachable behind
 * requireSuperadmin() at the API layer. Billing is not implemented yet, so
 * "cost" is surfaced as used-vs-limit with over/near-limit flags.
 */

import { query } from '@/lib/db';
import { currentPeriod } from '@/lib/accounts/usage';

const METRICS = [
  { key: 'researches', column: 'researches_used', limit: null },
  { key: 'opportunities', column: 'opportunities_used', limit: null },
  { key: 'ai_analyses', column: 'ai_analyses_used', limit: null },
  { key: 'demo_generations', column: 'demo_generations_used', limit: null },
  { key: 'users', column: 'users_used', limit: null },
];

const LIMIT_COLUMNS = {
  researches: 'limit_researches',
  opportunities: 'limit_opportunities',
  ai_analyses: 'limit_ai_analyses',
  demo_generations: 'limit_demo_generations',
  users: 'limit_users',
};

export async function usageOverview() {
  const period = currentPeriod();
  const [accounts, usageRows, planRows] = await Promise.all([
    query('SELECT id, name, plan_code, status FROM accounts ORDER BY id'),
    query('SELECT * FROM account_usage WHERE period = ?', [period]),
    query('SELECT * FROM billing_plans'),
  ]);

  const usageBy = new Map(usageRows.map((u) => [Number(u.account_id), u]));
  const planBy = new Map(planRows.map((p) => [p.code, p]));

  const totals = {};
  const accountsList = [];
  const planUsed = {};

  for (const a of accounts) {
    const id = Number(a.id);
    const row = usageBy.get(id) || {};
    const plan = planBy.get(a.plan_code) || null;
    const metrics = {};

    for (const m of METRICS) {
      const used = Number(row[m.column] || 0);
      const limitCol = LIMIT_COLUMNS[m.key];
      const limit = plan ? plan[limitCol] : null;
      const parsedLimit = limit == null ? null : Number(limit);
      const pct = parsedLimit == null ? null : parsedLimit ? Math.round((used / parsedLimit) * 100) : used ? 100 : 0;
      metrics[m.key] = { used, limit: parsedLimit, pct };
      totals[m.key] = (totals[m.key] || 0) + used;
    }

    const overLimit = METRICS.some((m) => metrics[m.key].limit != null && metrics[m.key].used > metrics[m.key].limit);
    const nearLimit = !overLimit && METRICS.some((m) => metrics[m.key].limit != null && metrics[m.key].pct >= 80);

    accountsList.push({
      id,
      name: a.name,
      plan_code: a.plan_code,
      plan_name: plan?.name || a.plan_code,
      status: a.status,
      usage: metrics,
      over_limit: overLimit,
      near_limit: nearLimit,
    });

    if (!planUsed[a.plan_code]) planUsed[a.plan_code] = { accounts: 0, over_limit: 0, usage: {} };
    planUsed[a.plan_code].accounts += 1;
    if (overLimit) planUsed[a.plan_code].over_limit += 1;
    for (const m of METRICS) {
      planUsed[a.plan_code].usage[m.key] = (planUsed[a.plan_code].usage[m.key] || 0) + metrics[m.key].used;
    }
  }

  const plans = planRows.map((p) => {
    const used = planUsed[p.code] || { accounts: 0, over_limit: 0, usage: {} };
    const limits = {};
    for (const m of METRICS) limits[m.key] = p[LIMIT_COLUMNS[m.key]] == null ? null : Number(p[LIMIT_COLUMNS[m.key]]);
    return {
      code: p.code,
      name: p.name,
      accounts: used.accounts,
      over_limit_accounts: used.over_limit,
      limits,
      usage: used.usage,
    };
  });

  return {
    period,
    generated_at: new Date().toISOString(),
    billing_implemented: false,
    totals,
    accounts: accountsList,
    plans,
    flags: {
      over_limit: accountsList.filter((a) => a.over_limit).length,
      near_limit: accountsList.filter((a) => a.near_limit).length,
    },
  };
}