'use client';

import Link from 'next/link';
import { Card, ScoreBadge, StatusBadge, ProblemTag, fmtMoney, EmptyState } from '@/components/ui';
import { moneyMechanismLabel } from '@/lib/constants';

function moneyLine(opportunity) {
  const s = opportunity.scenario;
  if (!s) return null;
  const low = s.impactLow != null ? s.impactLow : null;
  const high = s.impactHigh != null ? s.impactHigh : null;
  return {
    label: String(s.scenarioType).replaceAll('_', ' '),
    range: low != null && high != null ? `${fmtMoney(low, s.currency)} – ${fmtMoney(high, s.currency)}` : 'Estimate pending',
    period: s.period === 'monthly' ? '/ month' : '/ year',
  };
}

export default function OpportunityFeedCard({ opportunity }) {
  const s = opportunity.scenario;
  const ml = moneyLine(opportunity);
  const mechanism = opportunity.money_mechanism_key
    ? moneyMechanismLabel(opportunity.money_mechanism_key)
    : (opportunity.money_mechanism || '').replaceAll('_', ' ');

  const what = [opportunity.business_description, opportunity.business_industry, opportunity.business_city]
    .filter(Boolean).join(' · ');

  const confidence = opportunity.confidence_score != null
    ? `${Math.round(Number(opportunity.confidence_score) * 100)}% confident`
    : null;
  const evidenceCount = opportunity.evidence_count != null
    ? `${opportunity.evidence_count} evidence item${opportunity.evidence_count === 1 ? '' : 's'}`
    : null;

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start gap-3">
        <ScoreBadge score={opportunity.opportunity_score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={`/opportunities/${opportunity.id}`} className="truncate font-semibold text-gray-900 hover:text-blue-700">
              {opportunity.business_name}
            </Link>
{opportunity.score_category && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                {opportunity.score_category}
              </span>
            )}
          </div>
          {what && <p className="mt-0.5 line-clamp-1 text-xs text-gray-400">{what}</p>}
        </div>
      </div>

      <p className="mt-2 text-sm text-gray-800"><span className="text-xs font-semibold uppercase tracking-wide text-gray-400">The problem</span><br />{opportunity.problem}</p>

      {s && (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Money at stake</p>
          <p className="text-base font-bold text-emerald-800">
            {ml.range}<span className="text-sm font-semibold text-emerald-600">{ml.period}</span>
          </p>
          <p className="text-xs text-emerald-700">
            {[mechanism, ml.label].filter(Boolean).join(' · ')}
          </p>
        </div>
      )}

      {opportunity.why_it_matters && (
        <p className="mt-2 line-clamp-2 text-xs text-gray-500"><span className="font-medium text-gray-600">Why it matters:</span> {opportunity.why_it_matters}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        {confidence && <span className="font-medium text-gray-700">{confidence}</span>}
        {evidenceCount && <span>{evidenceCount}</span>}
        {opportunity.recommended_solution_name && (
          <span>Solution: <span className="font-medium text-gray-700">{opportunity.recommended_solution_name}</span></span>
        )}
        {opportunity.project_value_high != null && (
          <span>Charge <span className="font-medium text-gray-700">
            {fmtMoney(opportunity.project_value_low, opportunity.project_value_currency)}–{fmtMoney(opportunity.project_value_high, opportunity.project_value_currency)}
          </span></span>
        )}
        {opportunity.hasWhatsapp && (
          <span className="inline-flex items-center gap-1 font-medium text-green-700">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> WhatsApp
          </span>
        )}
      </div>

      {opportunity.next_action && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          <span className="font-semibold">Next action:</span> {opportunity.next_action}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <div className="flex items-center gap-1.5">
          <ProblemTag type={opportunity.problem_type} />
          <StatusBadge status={opportunity.status} />
        </div>
        <Link
          href={`/opportunities/${opportunity.id}`}
          className="ml-auto rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
        >
          Review opportunity
        </Link>
      </div>
    </Card>
  );
}

export function OpportunityFeed({ feed }) {
  if (!feed?.length) {
    return (
      <EmptyState
        title="No money-making opportunities identified yet"
        hint="Tell us what you can deliver and where to look — we'll research real businesses and surface the opportunities worth pursuing."
      />
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {feed.map((o) => <OpportunityFeedCard key={o.id} opportunity={o} />)}
    </div>
  );
}