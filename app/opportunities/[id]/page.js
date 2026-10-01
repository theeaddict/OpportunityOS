import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import * as financialRepo from '@/lib/repositories/financial';
import * as outreachRepo from '@/lib/repositories/outreach';
import * as businessesRepo from '@/lib/repositories/businesses';
import { MONEY_MECHANISMS, SCORE_CATEGORIES } from '@/lib/constants';
import { hasVerifiedContact, isRejectedOpportunity, runQualityChecks } from '@/lib/services/gating';
import { ScenarioEditor } from '@/components/OpportunityPanels';
import OutreachEngine from '@/components/OutreachEngine';
import DemoConcept from '@/components/DemoConcept';
import { AnalyzeControl, PipelineControl } from '@/components/OpportunityControls';
import { ProvenanceTag, ProvenanceLegend } from '@/components/ProvenanceTags';
import ActivityTimeline from '@/components/ActivityTimeline';
import { Card, PageHeader, ScoreBadge, StatusBadge, ProblemTag, ClaimBadge, fmtMoney } from '@/components/ui';

export const dynamic = 'force-dynamic';

const FACTOR_LABELS = [
  ['evidence_strength_score', 'Evidence strength'],
  ['problem_severity_score', 'Problem severity'],
  ['money_potential_score', 'Money potential'],
  ['solution_fit_score', 'Solution fit'],
  ['business_maturity_score', 'Business maturity'],
  ['ability_to_pay_score', 'Ability to pay'],
  ['contactability_score', 'Contactability'],
  ['operational_complexity_score', 'Operational complexity (lower is better)'],
];

/** Largest illustrative scenario by annualized midpoint — the money at stake. */
function bestScenario(scenarios) {
  let best = null;
  let bestMid = -Infinity;
  for (const s of scenarios || []) {
    const lo = s.impact_low != null ? Number(s.impact_low) : (s.base_value != null ? Number(s.base_value) : 0);
    const hi = s.impact_high != null ? Number(s.impact_high) : (s.base_value != null ? Number(s.base_value) : 0);
    let mid = (lo + hi) / 2;
    if (s.period === 'monthly') mid *= 12;
    if (mid > bestMid) { bestMid = mid; best = { ...s, low: lo, high: hi }; }
  }
  return best;
}

const CLAIM_PROVENANCE = { FACT: 'fact', INFERENCE: 'inference', HYPOTHESIS: 'hypothesis' };
const AUTHOR_IDENTITY = { rules: 'rule engine', llm: 'AI', none: 'not analyzed' };

function Section({ n, title, intro, children }) {
  return (
    <Card className="p-5">
      <header className="mb-4 border-b border-gray-100 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{n}</span>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        </div>
        {intro && <p className="mt-1 text-xs text-gray-500">{intro}</p>}
      </header>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function Row({ label, value, prov }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-3">
      <dt className="w-36 shrink-0 text-xs font-medium text-gray-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-gray-800">
        {value || <span className="text-gray-400">—</span>}
        {prov && <span className="ml-1.5 align-middle"><ProvenanceTag type={prov} /></span>}
      </dd>
    </div>
  );
}

export default async function OpportunityDetailPage({ params }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');
  const { id } = await params;
  const opportunityId = Number(id);
  const opportunity = await opportunitiesRepo.findById(user.account_id, opportunityId);
  if (!opportunity) notFound();
  if (user.role === 'member' && Number(opportunity.assignee_id) !== Number(user.id)) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-gray-600">This opportunity is not assigned to you.</p>
      </Card>
    );
  }

  const [business, evidence, solutionLinks, messages, events, activity, assumptions, scenarios, explanation, contacts, sources] = await Promise.all([
    businessesRepo.findBusiness(user.account_id, opportunity.business_id),
    opportunitiesRepo.linkedEvidence(user.account_id, opportunityId),
    opportunitiesRepo.solutionLinks(user.account_id, opportunityId),
    outreachRepo.listForOpportunity(user.account_id, opportunityId),
    financialRepo.eventsForOpportunity(user.account_id, opportunityId),
    financialRepo.activityForOpportunity(user.account_id, opportunityId),
    financialRepo.listAssumptions(user.account_id, opportunityId),
    financialRepo.listScenarios(user.account_id, opportunityId),
    opportunitiesRepo.getExplanation(user.account_id, opportunityId),
    businessesRepo.listContacts(user.account_id, opportunity.business_id),
    businessesRepo.listSources(user.account_id, opportunity.business_id),
  ]);

  const mechanism = opportunity.money_mechanism_key
    ? (MONEY_MECHANISMS[opportunity.money_mechanism_key] || null) : null;
  const categoryMeta = opportunity.score_category ? (SCORE_CATEGORIES[opportunity.score_category] || SCORE_CATEGORIES.REJECT) : null;

  const recommended = solutionLinks.find((l) => l.recommended) || solutionLinks[0] || null;
  const alternatives = recommended ? solutionLinks.filter((l) => l !== recommended) : [];

  let scoreReasons = [];
  if (opportunity.score_reasons) {
    try {
      scoreReasons = typeof opportunity.score_reasons === 'string' ? JSON.parse(opportunity.score_reasons) : opportunity.score_reasons;
    } catch { scoreReasons = []; }
  }

  const hypotheses = evidence.filter((e) => String(e.claim_type).toUpperCase() === 'HYPOTHESIS');
  const maturity = opportunity.business_maturity_score != null
    ? `${opportunity.business_maturity_score}/100`
    : (business.business_maturity_score != null ? `${business.business_maturity_score}/100` : null);

  const money = bestScenario(scenarios);
  const mechanismLabel = mechanism?.label || (opportunity.money_mechanism || '').replaceAll('_', ' ');
  const rejected = isRejectedOpportunity(opportunity);
  const hasVerifiedContactOnBusiness = hasVerifiedContact(contacts);
  const outreachGate =
    rejected
      ? 'This opportunity is scored REJECT — outreach is disabled until more evidence improves the score.'
      : !hasVerifiedContactOnBusiness
        ? 'Add a verified public contact on the business before generating outreach.'
        : null;
  const demoGate =
    rejected
      ? 'This opportunity is scored REJECT — demo generation is disabled until more evidence improves the score.'
      : !hasVerifiedContactOnBusiness
        ? 'Add a verified public contact on the business before generating a demo.'
        : null;
  const qc = runQualityChecks({ opportunity, business, evidenceRows: evidence, contacts, messages });

  return (
    <>
      <PageHeader
        title={opportunity.title}
        subtitle={
          <>
            <Link href={`/businesses/${opportunity.business_id}`} className="font-medium text-blue-600 hover:underline">{opportunity.business_name}</Link>
            {' — '}
            {[opportunity.business_industry, opportunity.business_location].filter(Boolean).join(', ')}
          </>
        }
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={opportunity.status} />
            <ProblemTag type={opportunity.problem_type} />
          </div>
        }
      />

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <div className={`rounded-xl p-4 ${money ? 'border border-emerald-200 bg-emerald-50' : 'border border-gray-200 bg-gray-50'}`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Money at stake</p>
          {money ? (
            <>
              <p className="mt-1 text-lg font-bold text-emerald-800">
                {fmtMoney(money.low, money.currency)} – {fmtMoney(money.high, money.currency)}
                <span className="text-xs font-semibold text-emerald-600">{money.period === 'monthly' ? ' / month' : ' / year'}</span>
              </p>
              <p className="text-xs text-emerald-700">{mechanismLabel}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-gray-500">Run the analysis to quantify the impact.</p>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">How confident are we</p>
          {opportunity.confidence_score != null ? (
            <p className="mt-1 text-lg font-bold text-gray-900">{Math.round(Number(opportunity.confidence_score) * 100)}%</p>
          ) : (
            <p className="mt-1 text-sm text-gray-500">Not scored yet.</p>
          )}
          {opportunity.score_category && (
            <p className="text-xs text-gray-600">{opportunity.score_category} · {categoryMeta?.hint || ''}</p>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">What you could deliver</p>
          {recommended ? (
            <>
              <p className="mt-1 text-sm font-bold text-gray-900">{recommended.solution_name} <span className="text-xs font-medium text-gray-500">(fit {recommended.fit_score}/100)</span></p>
              {recommended.project_value_low != null && (
                <p className="text-xs text-gray-600">
                  Charge {fmtMoney(recommended.project_value_low, recommended.solution_currency)} – {fmtMoney(recommended.project_value_high, recommended.solution_currency)}
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-gray-500">Run the analysis to match a solution.</p>
          )}
        </div>
      </div>

      {opportunity.next_action && (
        <p className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">How to approach:</span> {opportunity.next_action}
        </p>
      )}

      <div className="mb-6"><ProvenanceLegend /></div>

      <div className="space-y-6">
        {/* 1 · BUSINESS */}
        <Section n={1} title="Business" intro="What we know about the company behind this opportunity.">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Row label="Name" value={<Link href={`/businesses/${business.id}`} className="text-blue-600 hover:underline">{business.name}</Link>} prov="fact" />
            <Row label="What they do" value={<span className="line-clamp-3">
              {business.description
                ? business.description
                : <span className="text-gray-400">No description on file — add one on the business page.</span>}
            </span>} prov="fact" />
            <Row label="Industry" value={business.industry} prov="fact" />
            <Row label="Location" value={[business.location, business.country].filter(Boolean).join(', ')} prov="fact" />
            <Row label="Website" value={business.website
              ? <a href={business.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{business.website}</a>
              : null} prov="fact" />
            <Row label="Business maturity" value={maturity || 'Not assessed'} prov={maturity ? 'inference' : null} />
          </dl>

          {(sources.length > 0 || business.primary_social_platform) && (
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Social profiles &amp; sources</p>
              <ul className="mt-2 space-y-1 text-sm">
                {sources.filter((s) => /social|tiktok|instagram|facebook|linkedin|x|twitter/i.test(s.source_url || '') || /social/i.test(s.source_type || '')).map((s) => (
                  <li key={s.id}>
                    <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {s.source_name || s.source_url}
                    </a>
                    {s.source_type ? <span className="ml-1.5 text-xs text-gray-400">({String(s.source_type).replaceAll('_', ' ')})</span> : null}
                  </li>
                ))}
                {business.primary_social_platform && (
                  <li><span className="text-gray-600">{String(business.primary_social_platform).replaceAll('_', ' ')}</span> <ProvenanceTag type="fact" /></li>
                )}
                {sources.length === 0 && !business.primary_social_platform && <li className="text-gray-400">No social profiles recorded.</li>}
              </ul>
            </div>
          )}
        </Section>

        {/* 2 · OPPORTUNITY SCORE */}
        <Section n={2} title="Opportunity score" intro="Overall score plus how each of the eight weighted factors contributed. Provenance: FACT / INFERENCE.">
          <div className="flex flex-col gap-6 md:flex-row">
            <div className="w-full max-w-xs shrink-0 rounded-xl bg-gray-50 p-4 ring-1 ring-gray-200">
              <div className="flex items-center gap-3">
                <ScoreBadge score={opportunity.opportunity_score} />
                <div>
                  <p className="text-sm font-semibold text-gray-900">Overall score</p>
                  <p className="text-xs text-gray-500">Weighted across eight factors</p>
                  {opportunity.score_category && (
                    <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${categoryMeta?.color || 'bg-gray-400'}`}>
                      {opportunity.score_category}
                    </span>
                  )}
                </div>
              </div>
              {opportunity.confidence_score != null && (
                <p className="mt-3 text-xs text-gray-500">Confidence {Math.round(Number(opportunity.confidence_score) * 100)}%</p>
              )}
              <p className="mt-1 text-xs text-gray-400">Score generated by the {AUTHOR_IDENTITY[opportunity.analysis_provider] || 'rule'} — provenance INFERENCE.</p>
              <AnalyzeControl opportunity={opportunity} />
            </div>

            <div className="min-w-0 flex-1">
              <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {FACTOR_LABELS.map(([col, label]) => (
                  <div key={col} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
                    <dt className="text-gray-500">{label}</dt>
                    <dd className="font-semibold text-gray-800">{opportunity[col] ?? '–'}</dd>
                  </div>
                ))}
              </dl>

              {scoreReasons.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Why this score</p>
                  <ul className="space-y-2">
                    {scoreReasons.map((r) => (
                      <li key={r.dimension} className="rounded-lg border border-gray-100 bg-white p-2.5 text-sm">
                        <span className="font-medium text-gray-900">{r.title}</span>
                        {r.score != null && <span className="ml-1.5 text-xs text-gray-400">{r.score}{r.max ? `/${r.max}` : ''}</span>}
                        <p className="text-xs text-gray-600">{r.reason}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {explanation && (
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Explanation <ProvenanceTag type="inference" />
              </p>
              <p className="text-sm text-gray-800">{explanation.why_exists || opportunity.why_it_matters}</p>
            </div>
          )}
        </Section>

        {/* 3 · PROBLEM */}
        <Section n={3} title="Problem" intro="A plain-language statement of the problem, without technical jargon.">
          <div className="flex items-start gap-2">
            <ProvenanceTag type={explanation ? 'inference' : 'fact'} />
            <p className="text-sm text-gray-800">{opportunity.problem}</p>
          </div>
        </Section>

        {/* 4 · EVIDENCE */}
        <Section n={4} title="Evidence" intro="Every important claim, with its source, URL, claim type and confidence — so you can see exactly what is verified and how sure we are.">
          {evidence.length ? (
            <ul className="space-y-3">
              {evidence.map((e) => {
                const prov = CLAIM_PROVENANCE[String(e.claim_type).toUpperCase()] || 'inference';
                return (
                  <li key={e.id} className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <ClaimBadge claimType={e.claim_type} />
                      <ProvenanceTag type={prov} />
                      <span className="text-xs text-gray-500">{String(e.evidence_type).replaceAll('_', ' ')}</span>
                      {e.signal_key && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">{String(e.signal_key).replaceAll('_', ' ')}</span>}
                      <span className="ml-auto text-xs text-gray-400">confidence {Math.round(Number(e.confidence_score) * 100)}%</span>
                    </div>
                    <p className="mt-1.5 text-sm text-gray-800">{e.evidence_text}</p>
                    <div className="mt-2 grid gap-1 text-xs text-gray-500 sm:grid-cols-3">
                      <div><span className="font-medium text-gray-600">Source:</span> {e.source_name || '(unspecified)'}</div>
                      <div>
                        <span className="font-medium text-gray-600">URL:</span> {
                          e.source_url
                            ? <a href={e.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">link</a>
                            : <span className="text-gray-400">—</span>
                        }
                      </div>
                      <div><span className="font-medium text-gray-600">Claim type:</span> {String(e.claim_type).toLowerCase()}</div>
                    </div>
                    {e.source_excerpt_summary && (
                      <p className="mt-1 text-xs italic text-gray-500">Excerpt: {e.source_excerpt_summary}</p>
                    )}
                    <p className="mt-1 text-[11px] text-gray-400">Captured {String(e.captured_at || '').slice(0, 10)}{!e.captured_by && e.evidence_type === 'ai_interpretation' ? ' · AI-generated, pending human review' : ''}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No supporting evidence linked yet.</p>
          )}
        </Section>

        {/* 5 · WHY IT MATTERS */}
        <Section n={5} title="Why it matters" intro="The commercial consequence of the problem — why acting could be worth it.">
          <div className="flex items-start gap-2">
            <ProvenanceTag type="inference" />
            <p className="text-sm text-gray-800">{opportunity.why_it_matters}</p>
          </div>
          {explanation?.money_impact && (
            <div className="flex items-start gap-2">
              <ProvenanceTag type="inference" />
              <p className="text-sm text-gray-700">{explanation.money_impact}</p>
            </div>
          )}
        </Section>

        {/* 6 · MONEY OPPORTUNITY */}
        <Section n={6} title="Money opportunity" intro="The mechanism by which money is made or saved, the assumptions behind it and the illustrative scenario.">
          {mechanism ? (
            <div className="rounded-xl bg-blue-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold uppercase tracking-wide text-blue-700">{mechanism.label}</span>
                <ProvenanceTag type="assumption" />
              </div>
              <p className="mt-0.5 text-xs text-blue-800">{mechanism.description}</p>
              {opportunity.money_mechanism && <p className="mt-1.5 text-sm text-gray-800">{opportunity.money_mechanism}</p>}
            </div>
          ) : opportunity.money_mechanism ? (
            <p className="text-sm text-gray-700">{opportunity.money_mechanism}</p>
          ) : (
            <p className="text-sm text-gray-500">No money mechanism recorded. Run the analysis to establish one.</p>
          )}

          {assumptions.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Financial assumptions <ProvenanceTag type="assumption" />
              </p>
              <ul className="space-y-1.5">
                {assumptions.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 rounded-lg bg-gray-50 px-3 py-1.5 text-sm">
                    <span className="font-medium text-gray-800">{String(a.assumption_name).replaceAll('_', ' ')}</span>
                    <span className="text-gray-600">
                      low {fmtMoney(a.assumption_low ?? a.assumption_value, a.unit && /^[a-zA-Z]{3}$/.test(a.unit) ? a.unit : 'KES')}
                      {a.unit ? ` ${a.unit}` : ''} · base {assumptionValue(a)} · high {fmtMoney(a.assumption_high ?? a.assumption_value, a.unit && /^[a-zA-Z]{3}$/.test(a.unit) ? a.unit : 'KES')}
                    </span>
                    <span className="ml-auto text-xs text-gray-400">{a.source} · {Math.round(Number(a.confidence) * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Illustrative scenario <ProvenanceTag type="impact" />
            </p>
            {scenarios.length ? (
              <>
                <div className="mb-3 space-y-1.5">
                  {scenarios.map((s) => (
                    <div key={s.id} className="rounded-lg border border-rose-100 bg-rose-50/40 px-3 py-2 text-sm">
                      <span className="font-medium text-gray-900">{String(s.scenario_name || s.scenario_type).replaceAll('_', ' ')}</span>
                      <span className="ml-2 text-gray-600">
                        base {fmtMoney(s.base_value ?? s.impact_base, s.currency)}{s.period === 'monthly' ? ' / month' : ' / year'}
                      </span>
                      <span className="ml-2 text-xs text-gray-400">
                        low {fmtMoney(s.low_value ?? s.impact_low, s.currency)} · high {fmtMoney(s.high_value ?? s.impact_high, s.currency)}
                      </span>
                      <ProvenanceTag type="impact" />
                    </div>
                  ))}
                </div>
                <ScenarioEditor
                  opportunityId={opportunity.id}
                  scenarios={scenarios}
                  assumptions={assumptions}
                  disclaimer="Illustrative scenarios based on the stored assumptions — low/base/high are conservative / central / optimistic bounds, not forecasts. Financial figures here are labeled 'Potential business impact'."
                />
              </>
            ) : (
              <p className="text-sm text-gray-500">Run the analysis to build an illustrative financial scenario.</p>
            )}
          </div>
        </Section>

        {/* 7 · RECOMMENDED SOLUTION */}
        <Section n={7} title="Recommended solution" intro="The solution that fits this opportunity best, why, and an estimate of what it might cost to deliver.">
          {recommended ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-gray-900">{recommended.solution_name}</span>
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">fit {recommended.fit_score}/100</span>
                </div>
              </div>
              {recommended.solution_description && <p className="mt-1 text-sm text-gray-600">{recommended.solution_description}</p>}

              <div className="mt-3">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Why it fits</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  {[['Problem fit', recommended.problem_fit], ['Industry fit', recommended.industry_fit], ['Technical fit', recommended.technical_fit], ['Commercial fit', recommended.commercial_fit]].map(([l, v]) => (
                    <div key={l} className="flex items-center justify-between">
                      <dt className="text-gray-500">{l}</dt>
                      <dd className="font-semibold text-gray-800">{v != null ? `${v}/100` : '–'}</dd>
                    </div>
                  ))}
                </dl>
                {recommended.reason && <p className="mt-2 rounded bg-white/70 p-2 text-xs text-gray-700"><span className="font-semibold text-gray-900">Why: </span>{recommended.reason}</p>}
              </div>

              {recommended.solution_features && (
                <div className="mt-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Features required</p>
                  <div className="flex flex-wrap gap-1.5">
                    {String(recommended.solution_features).split(',').map((f) => f.trim()).filter(Boolean).map((f, i) => (
                      <span key={i} className="rounded bg-white px-2 py-0.5 text-xs text-gray-700 ring-1 ring-gray-200">{f}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ProvenanceTag type="estimate" />
                <span className="text-sm text-gray-500">Estimated project value:</span>
                <span className="text-base font-bold text-gray-900">
                  {recommended.project_value_low != null
                    ? `${fmtMoney(recommended.project_value_low, recommended.solution_currency)} – ${fmtMoney(recommended.project_value_high, recommended.solution_currency)} (base ${fmtMoney(recommended.project_value_base, recommended.solution_currency)})`
                    : '—'}
                </span>
              </div>
              <p className="mt-1 text-xs italic text-gray-400">This is the delivery estimate from the solution library, not a quotation, and not the client&apos;s benefit.</p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Run the analysis to match a recommended solution.</p>
          )}

          {alternatives.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Alternative solutions</p>
              <ul className="space-y-2">
                {alternatives.map((l) => (
                  <li key={l.id} className="rounded-lg bg-gray-50 p-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-800">{l.solution_name}</span>
                      <span className="shrink-0 text-xs text-gray-500">fit {l.fit_score}</span>
                    </div>
                    {l.reason && <p className="mt-0.5 text-xs text-gray-500">{l.reason}</p>}
                    {l.project_value_low != null && (
                      <p className="mt-0.5 text-xs text-gray-400">project value {fmtMoney(l.project_value_low, l.solution_currency)}–{fmtMoney(l.project_value_high, l.solution_currency)}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        {/* 8 · UNCERTAINTIES */}
        <Section n={8} title="Uncertainties" intro="What we don't know yet — flagged honestly so nothing is treated as more certain than it is.">
          <div className="flex items-start gap-2">
            <ProvenanceTag type="hypothesis" />
            <p className="text-sm text-gray-700">
              {explanation?.uncertain || 'The key unknown is how the business confirms the underlying assumptions (volumes, order values). These are illustrative until confirmed.'}
            </p>
          </div>
          {hypotheses.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Unconfirmed hypotheses in the evidence</p>
              <ul className="space-y-1.5">
                {hypotheses.map((h) => (
                  <li key={h.id} className="flex items-start gap-2 rounded-lg bg-violet-50/50 p-2.5 text-sm text-gray-700">
                    <ProvenanceTag type="hypothesis" />
                    <span>{h.evidence_text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {opportunity.next_action && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="font-semibold">Suggested next step to reduce uncertainty: </span>{opportunity.next_action}
            </div>
          )}
        </Section>

        {/* 9 · OUTREACH */}
        <Section n={9} title="Outreach" intro="Personalized outreach engine — evidence-based first-touch messages. Nothing is sent automatically; you review, approve and mark as contacted.">
          <OutreachEngine opportunityId={opportunity.id} initialMessages={outreachGate ? [] : messages} hasContact={hasVerifiedContactOnBusiness} disabledReason={outreachGate} />
        </Section>

        {/* 10 · DEMO */}
        <Section n={10} title="Demo" intro="Generate a concept demo spec you could build and walk the business through.">
          <DemoConcept opportunityId={opportunity.id} disabledReason={demoGate} />
        </Section>

        {/* 11 · PIPELINE */}
        <Section n={11} title="Pipeline" intro="Where this opportunity sits in the deal flow, its project value, probability and activity history.">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-500">Current status:</span>
                <StatusBadge status={opportunity.status} />
              </div>
              {opportunity.days_in_stage != null && (
                <p className="text-xs text-gray-500">{opportunity.days_in_stage} day{opportunity.days_in_stage === 1 ? '' : 's'} in this stage</p>
              )}
              {opportunity.next_action && (
                <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  <span className="font-semibold">Next action: </span>{opportunity.next_action}
                </div>
              )}
              <div className="rounded-lg border border-gray-200 p-3">
                <PipelineControl opportunity={opportunity} />
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Project value</p>
                {opportunity.project_value != null ? (
                  <p className="mt-1 text-lg font-bold text-gray-900">{fmtMoney(opportunity.project_value, opportunity.project_currency)}</p>
                ) : (
                  <p className="mt-1 text-sm text-gray-400">Not set — edit the opportunity to add project value.</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Probability</p>
                <p className="mt-1 text-lg font-bold text-indigo-700">{opportunity.probability != null ? `${opportunity.probability}%` : '—'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Weighted pipeline</p>
                <p className="mt-1 text-lg font-bold text-indigo-700">
                  {opportunity.weighted_pipeline != null ? fmtMoney(opportunity.weighted_pipeline, opportunity.project_currency) : '—'}
                </p>
              </div>
              {opportunity.notes && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Notes</p>
                  <p className="mt-1 text-sm text-gray-600">{opportunity.notes}</p>
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Activity timeline</p>
              <ActivityTimeline activities={activity} />
            </div>
          </div>
        </Section>

        {/* 12 · CONTACT */}
        <Section n={12} title="Contact" intro="The public business contact(s) we'd use for outreach, their verification status and source.">
          {contacts.length ? (
            <ul className="space-y-2">
              {contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-gray-200 p-3 text-sm">
                  <span className="w-24 uppercase tracking-wide text-gray-500">{String(c.contact_type).replaceAll('_', ' ')}</span>
                  <span className="font-semibold text-gray-900">{c.contact_value}</span>
                  <ProvenanceTag type="fact" />
                  <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>verification: <span className="font-medium text-gray-700">{String(c.verification_status).replaceAll('_', ' ')}</span></span>
                    <span>· confidence {Math.round(Number(c.confidence_score) * 100)}%</span>
                  </span>
                  <div className="w-full text-xs text-gray-400">
                    Source: {c.contact_source || '(unspecified)'}
                    {c.source_url && <> · <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">link</a></>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No public contact stored. Add one on the business before outreach — never invent contact details.</p>
          )}
          {contacts.some((c) => c.contact_type === 'whatsapp') && (
            <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              WhatsApp number is published/confirmed — safe to use for WhatsApp outreach.
            </p>
          )}
        </Section>

        <Section
          n={13}
          title="Quality control"
          intro="A final, explicit checklist before treating this as outreach-ready — most of these are already enforced elsewhere; this makes them visible rather than trusting an opaque score."
        >
          <div className={`rounded-lg px-3 py-2 text-sm font-medium ${qc.passed ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
            {qc.passed ? 'All checks passed.' : `${qc.checks.filter((c) => !c.pass).length} check(s) need attention.`}
          </div>
          <ul className="space-y-1.5">
            {qc.checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 shrink-0 ${c.pass ? 'text-emerald-600' : 'text-amber-600'}`}>{c.pass ? '✔' : '⚠'}</span>
                <span>
                  <span className="text-gray-800">{c.label}</span>
                  <span className="ml-1.5 text-xs text-gray-400">— {c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}

function assumptionValue(a) {
  const v = Number(a.assumption_value);
  const currency = a.unit && /^[a-zA-Z]{3}$/.test(a.unit) ? a.unit : 'KES';
  return fmtMoney(v, currency);
}
