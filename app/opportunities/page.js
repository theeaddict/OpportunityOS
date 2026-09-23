import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import { query } from '@/lib/db';
import { PageHeader, Card, ScoreBadge, StatusBadge, ProblemTag, EmptyState, fmtMoney } from '@/components/ui';
import { OPPORTUNITY_STATUSES, moneyMechanismLabel } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/** Annualized midpoint of the largest illustrative scenario per opportunity. */
async function bestScenarios(accountId, ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await query(
    `SELECT fs.opportunity_id, fs.period, fs.impact_low, fs.impact_high, fs.currency,
            fs.scenario_type
       FROM financial_scenarios fs
       JOIN opportunities o ON o.id = fs.opportunity_id AND o.account_id = ?
      WHERE fs.opportunity_id IN (${placeholders}) AND fs.is_illustrative = 1
      ORDER BY fs.id`,
    [Number(accountId), ...ids]
  );
  const map = new Map();
  for (const s of rows) {
    const low = Number(s.impact_low || 0);
    const high = Number(s.impact_high || 0);
    let mid = (low + high) / 2;
    if (s.period === 'monthly') mid *= 12;
    const existing = map.get(s.opportunity_id);
    if (!existing || mid > existing.mid) {
      map.set(s.opportunity_id, {
        mid,
        low,
        high,
        currency: s.currency || 'KES',
        period: s.period,
        scenarioType: s.scenario_type,
      });
    }
  }
  return map;
}

export default async function OpportunitiesPage({ searchParams }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');
  const { status = '' } = await searchParams;
  const memberUserId = user.role === 'member' ? user.id : null;
  const [opportunities, all] = await Promise.all([
    opportunitiesRepo.list({ accountId: user.account_id, memberUserId, status }),
    opportunitiesRepo.list({ accountId: user.account_id, memberUserId }),
  ]);

  const counts = {};
  for (const o of all) counts[o.status] = (counts[o.status] || 0) + 1;

  const scenarios = await bestScenarios(user.account_id, opportunities.map((o) => o.id));

  return (
    <>
      <PageHeader title="Opportunities" subtitle="Evidence-backed money-making opportunities, ranked by impact and confidence." />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href="/opportunities" className={`rounded-full px-3 py-1 text-xs font-medium ${!status ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'}`}>
          All ({all.length})
        </Link>
        {Object.entries(OPPORTUNITY_STATUSES).filter(([k]) => counts[k]).map(([k, label]) => (
          <Link key={k} href={`/opportunities?status=${k}`} className={`rounded-full px-3 py-1 text-xs font-medium ${status === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'}`}>
            {label} ({counts[k]})
          </Link>
        ))}
      </div>

      {opportunities.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {opportunities.map((o) => {
            const money = scenarios.get(o.id);
            const what = [o.business_description, o.business_industry].filter(Boolean).join(' · ');
            const mechanism = o.money_mechanism_key
              ? moneyMechanismLabel(o.money_mechanism_key)
              : (o.money_mechanism || '').replaceAll('_', ' ');
            return (
              <Link key={o.id} href={`/opportunities/${o.id}`} className="block">
                <Card className="p-4 transition hover:border-emerald-300 hover:shadow">
                  <div className="flex items-start gap-3">
                    <ScoreBadge score={o.opportunity_score} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate font-semibold text-gray-900">{o.business_name}</p>
                        {o.score_category && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">{o.score_category}</span>
                        )}
                      </div>
                      {what && <p className="mt-0.5 line-clamp-1 text-xs text-gray-400">{what}</p>}
                      <p className="mt-1.5 line-clamp-2 text-sm text-gray-700">{o.problem}</p>
                    </div>
                  </div>

                  {money && (
                    <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-800">
                      {fmtMoney(money.low, money.currency)} – {fmtMoney(money.high, money.currency)}
                      <span className="text-xs font-semibold text-emerald-600">{money.period === 'monthly' ? ' / month' : ' / year'}</span>
                      {mechanism && <span className="ml-1.5 text-xs font-medium text-emerald-700">· {mechanism}</span>}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    <ProblemTag type={o.problem_type} />
                    <StatusBadge status={o.status} />
                    {o.confidence_score != null && (
                      <span className="font-medium text-gray-700">{Math.round(Number(o.confidence_score) * 100)}% confident</span>
                    )}
                    {o.evidence_count != null && <span>{o.evidence_count} evidence items</span>}
                    {o.project_value_high != null && (
                      <span>Charge <span className="font-medium text-gray-700">{fmtMoney(o.project_value_low)}–{fmtMoney(o.project_value_high)}</span></span>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No opportunities here" hint="Detect problems from a business's evidence, or find new opportunities on the Discover page." />
      )}
    </>
  );
}