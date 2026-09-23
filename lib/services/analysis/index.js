import { query } from '@/lib/db';
import * as businessesRepo from '@/lib/repositories/businesses';
import * as evidenceRepo from '@/lib/repositories/evidence';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import * as financialRepo from '@/lib/repositories/financial';
import * as solutionsRepo from '@/lib/repositories/solutions';
import * as capabilitiesRepo from '@/lib/repositories/capabilities';
import { runBusinessResearchAgent } from '@/lib/ai/agents/business-research.js';
import { runOpportunityAnalystAgent } from '@/lib/ai/agents/opportunity-analyst.js';
import { runSolutionMatchingAgent } from '@/lib/ai/agents/solution-matching.js';
import { detectCandidateProblems, rulesRefinement, shouldRejectCandidate, buildExplanation } from './rules-analyzer';
import { matchSolutions } from './matching';
import { buildFinancialScenariosForMechanism, flattenTriples, midpointAnnualPotential, moneyPotentialFactor, legacyMechanismForProblem } from './scenarios';
import { MONEY_MECHANISMS, MONEY_MECHANISM_KEYS, problemLabel } from '@/lib/constants';
import { incrementUsage } from '@/lib/accounts/usage';
import { HttpError } from '@/lib/api-helpers';
import {
  computeScore, evidenceStrengthFactor, maturityFactor, abilityToPayFactor,
  contactabilityFactor, severityFactor, complexityFactor, countMaturitySignals,
} from './scoring';

// Domain vocabulary used ONLY by the narrative sanity guardrail. An AI narrative
// that references words from a clearly different industry than the business being
// analysed must not overwrite the existing/rules narrative (e.g. a mock or LLM
// answer about "furniture orders" for a restaurant).
const DOMAIN_KEYWORDS = [
  'furniture', 'woodwork', 'cabinet', 'workshop', 'restaurant', 'cafe', 'coffee', 'diner',
  'hotel', 'lodging', 'hostel', 'hospitality', 'salon', 'barber', 'spa', 'gym', 'fitness',
  'clinic', 'dental', 'dentist', 'medical', 'hospital', 'pharmacy', 'school', 'college',
  'academy', 'wholesale', 'retail', 'boutique', 'soap', 'fashion', 'garment', 'logistics',
  'delivery', 'courier', 'manufacturing', 'factory', 'production', 'farm', 'bakery',
  'butchery', 'auto', 'garage', 'showroom',
];

function wordsOf(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 3),
  );
}

/**
 * Basic guardrail, not a rewrite of the AI pipeline: a narrative proposed for
 * persistence (problem/opportunity/why_it_matters) is rejected when it contains
 * a domain keyword absent from the business's industry, its existing narrative,
 * and the evidence on file — i.e. it reads like it was written for a different
 * business/industry. Returns { ok, offending }.
 */
function narrativeSanity({ analyst, business, opportunity, evidence }) {
  const reference = wordsOf(`${business?.industry || ''} ${opportunity.problem || ''} ${opportunity.opportunity || ''} ${opportunity.why_it_matters || ''}`);
  for (const e of evidence || []) {
    for (const t of wordsOf(`${e.evidence_text} ${e.source_excerpt_summary || ''}`)) {
      if (t) reference.add(t);
    }
  }
  const suspect = wordsOf(`${analyst?.data?.problem || ''} ${analyst?.data?.opportunity || ''} ${analyst?.data?.why_it_matters || ''}`);
  for (const t of suspect) {
    if (DOMAIN_KEYWORDS.includes(t) && !reference.has(t)) return { ok: false, offending: t };
  }
  return { ok: true };
}

/**
 * Step 1: propose opportunities from accepted evidence (deterministic gate).
 * Weak evidence ⇒ no proposal. Every proposal cites its supporting evidence and
 * carries a money mechanism + structured explanation. Rejected candidates are
 * returned so the caller can record why nothing was proposed.
 */
export async function detectOpportunities(accountId, businessId, userId, options = {}) {
  const business = await businessesRepo.findBusiness(accountId, businessId);
  if (!business) throw new HttpError(404, 'Business not found');

  const [signals, evidenceBySignal] = await Promise.all([
    evidenceRepo.signalsForBusiness(accountId, businessId),
    evidenceRepo.evidenceBySignal(accountId, businessId),
  ]);
  const candidates = detectCandidateProblems(signals, evidenceBySignal);

  const created = [];
  const skipped = [];
  const rejected = [];
  // Business Owner Mode runs bypass the software-provider capability gate.
  const capabilityProfile = userId && !options.bypassCapabilities
    ? await capabilitiesRepo.getCapabilities(userId)
    : null;
  const gating = Boolean(capabilityProfile && capabilityProfile.enabled_solutions.length);

  for (const c of candidates) {
    const verdict = shouldRejectCandidate(c);
    if (verdict.reject) { rejected.push({ problem_type: c.problem_type, reason: verdict.reason }); continue; }

    const existing = await opportunitiesRepo.findByBusinessAndProblem(accountId, businessId, c.problem_type);
    if (existing) {
      skipped.push({ problem_type: c.problem_type, reason: 'already exists' });
      continue;
    }
    const id = await opportunitiesRepo.createOpportunity({
      account_id: accountId,
      business_id: businessId,
      title: `${business.name}: ${c.problem_label}`,
      problem_type: c.problem_type,
      problem: c.problem,
      opportunity: c.opportunity_text,
      why_it_matters: c.why_it_matters,
      money_mechanism: c.money_mechanism,
      money_mechanism_key: c.money_mechanism_key,
    });
    await opportunitiesRepo.saveExplanation(accountId, id, c.explanation);
    for (const eid of c.supporting_evidence_ids) {
      await opportunitiesRepo.attachEvidence(accountId, id, eid, c.signal_confidence);
    }
    const pre = await preMatch(accountId, id, business, c.problem_type, signals, capabilityProfile);

    // Capability gate: detected, but the user cannot serve it.
    if (gating && !pre.matches.length) {
      await opportunitiesRepo.markNotAServiceFit(
        accountId,
        id,
        `Business "${business.name}" shows the "${problemLabel(c.problem_type)}" problem, but none of the enabled capabilities in "My Capabilities" can deliver it.`
      );
      rejected.push({ problem_type: c.problem_type, reason: 'not_a_service_fit' });
      continue;
    }
    created.push(id);
  }
  if (created.length) await incrementUsage(accountId, 'opportunities', created.length).catch(() => {});
  return { created, skipped, rejected };
}

async function preMatch(accountId, opportunityId, business, problemType, signals, capabilityProfile) {
  const activeSolutions = await solutionsRepo.list({ accountId });
  const matches = matchSolutions(activeSolutions, {
    business,
    problem_type: problemType,
    signals,
    profile: capabilityProfile,
  });
  if (matches.length) {
    await opportunitiesRepo.replaceSolutionMatches(
      accountId,
      opportunityId,
      matches.slice(0, 5).map((m, i) => ({ ...m, recommended: i === 0 }))
    );
  }
  return { matches: matches.slice(0, 5) };
}

/**
 * Step 2: full opportunity analysis.
 *
 * AI IS MANDATORY when configured:
 *   - OPPORTUNITY_ANALYST_AGENT judges the evidence (may answer NO_STRONG_OPPORTUNITY)
 *   - SOLUTION_MATCHING_AGENT picks from the pre-filtered candidate list
 * Deterministic engines (scoring, scenarios, rule matching) remain application
 * code and always run. Without an API key the rules fallback is used and the
 * opportunity is stamped analysis_provider='rules' — never presented as AI.
 */
export async function analyzeOpportunity(accountId, opportunityId, userId, scenarioOverrides = {}, options = {}) {
  const opportunity = await opportunitiesRepo.findById(accountId, opportunityId);
  if (!opportunity) throw new HttpError(404, 'Opportunity not found');
  const business = await businessesRepo.findBusiness(accountId, opportunity.business_id);
  const evidence = await opportunitiesRepo.linkedEvidence(accountId, opportunityId);
  if (!evidence.length) throw new HttpError(400, 'Add evidence before analyzing');
  const contacts = await businessesRepo.listContacts(accountId, business.id);
  const signals = await evidenceRepo.signalsForBusiness(accountId, business.id);
  // A verified public website is a maturity/credibility signal even when no
  // provider happened to attach a signal_key to it — feed it into matching and
  // scoring (never into opportunity DETECTION, which stays evidence-only).
  if (business?.website_normalized && business?.contact_verified && !signals.existing_website) {
    signals.existing_website = { support_count: 1, max_confidence: 1, avg_confidence: 0.9 };
  }
  const skipAi = Boolean(options.skipAi);
  // Optional progress reporter for background jobs — mirrors REAL milestones of
  // the work below, never a fabricated percentage.
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  onProgress?.(15, 'checking_evidence');

  // --- mandatory AI judgment when configured (skippable for batch pipelines) ---
  const researchJob = skipAi ? null : await latestResearch(accountId, business.id);
  const analyst = skipAi
    ? { ok: false, reason: 'skipped', data: null, jobId: null }
    : await runOpportunityAnalystAgent({
        business, problemType: opportunity.problem_type,
        researchResult: researchJob?.data ?? null,
        evidence, userId, opportunityId, accountId,
      });
  onProgress?.(40, 'analyst_judgment');

  // Mechanism: prefer one already stored, else a sensible default for the problem.
  let mechanismKey = opportunity.money_mechanism_key
    || legacyMechanismForProblem(opportunity.problem_type)
    || 'additional_sales';

  let provider = 'rules';
  let analystVerdict = null;
  let refinement;

  if (analyst.ok && analyst.data.status === 'OPPORTUNITY_FOUND') {
    provider = 'llm';
    analystVerdict = 'found';
    // Guardrail on the narrative write path: refuse to persist a problem /
    // opportunity / why_it_matters from the analyst when it references a domain
    // (e.g. "furniture orders") that appears nowhere in the business's industry,
    // its existing narrative, or the evidence on file — it was written for a
    // different business/industry. Keep the existing/rules-derived narrative and
    // mechanism, and log the rejection. This is not a rewrite of the AI pipeline.
    const guard = narrativeSanity({ analyst, business, opportunity, evidence });
    if (!guard.ok) {
      console.warn(`[analysis] suspect AI narrative for opportunity ${opportunityId}: offending term "${guard.offending}" not in business/evidence vocabulary — keeping existing/rules-derived narrative`);
      refinement = rulesRefinement({ ...opportunity }, evidence);
    } else {
      // Normalise AI mechanism to a known key when valid, and adopt it for scenarios.
      const aiMech = analyst.data.money_mechanism_key && MONEY_MECHANISM_KEYS.includes(analyst.data.money_mechanism_key)
        ? analyst.data.money_mechanism_key
        : mechanismKey;
      mechanismKey = aiMech;
      refinement = {
        problem_statement: analyst.data.problem,
        why_it_matters: analyst.data.why_it_matters,
        reasoning_claims: [],
        solution_capabilities: [],
        outreach_angle: null,
        next_action: null,
        _note: 'AI analyst',
      };
      // Refine the analyst-owned narrative fields (evidence links are untouched).
      await opportunitiesRepo.updateOpportunityText(accountId, opportunityId, {
        problem: analyst.data.problem,
        opportunity: analyst.data.opportunity,
        why_it_matters: analyst.data.why_it_matters,
        money_mechanism: moneyMechanismText(aiMech, analyst.data.money_mechanism),
        money_mechanism_key: aiMech,
      });
      await opportunitiesRepo.saveExplanation(accountId, opportunityId, {
        why_exists: analyst.data.why_it_matters,
        evidence_support: analyst.data.evidence_support || analyst.data.reasoning_summary,
        money_impact: analyst.data.money_mechanism || moneyMechanism(aiMech),
        uncertain: analyst.data.uncertain || '',
        money_mechanism_key: aiMech,
      });
    }
  } else if (analyst.ok && analyst.data.status === 'NO_STRONG_OPPORTUNITY') {
    // Do NOT score or refine — record the honest verdict.
    await opportunitiesRepo.updateAnalysis(accountId, opportunityId, {
      confidence_score: Math.min(0.35, Number(analyst.data.confidence ?? 0.2)),
      next_action: `AI analyst verdict: NO_STRONG_OPPORTUNITY — ${String(analyst.data.reasoning_summary || '').slice(0, 200)}`,
      analysis_provider: 'llm',
    });
    return { provider: 'llm', verdict: 'NO_STRONG_OPPORTUNITY', reasoning: analyst.data.reasoning_summary, jobId: analyst.jobId };
  } else {
    refinement = rulesRefinement(
      { ...opportunity, ...(analyst.reason === 'not_configured' ? {} : {}) },
      evidence
    );
    // Rules fallback: ensure the opportunity carries a mechanism + explanation.
    if (!opportunity.money_mechanism_key) {
      await opportunitiesRepo.updateOpportunityText(accountId, opportunityId, {
        problem: opportunity.problem,
        opportunity: opportunity.opportunity,
        why_it_matters: opportunity.why_it_matters,
        money_mechanism: opportunity.money_mechanism || moneyMechanism(mechanismKey),
        money_mechanism_key: mechanismKey,
      });
    }
    if (!opportunity.opportunity_explanation) {
      await opportunitiesRepo.saveExplanation(accountId, opportunityId, buildExplanation({
        problem_type: opportunity.problem_type,
        problem: opportunity.problem,
        opportunity: opportunity.opportunity,
        why_it_matters: opportunity.why_it_matters,
        money_mechanism: opportunity.money_mechanism || moneyMechanism(mechanismKey),
        mechanism: mechanismKey,
        supporting: evidence,
        avgConf: evidence.reduce((s, e) => s + Number(e.confidence_score), 0) / (evidence.length || 1),
      }));
    }
  }

  // --- solution matching: deterministic 4-fit shortlist + AI selection ---
  // Deterministic fit sub-scores and project value always come from the engine
  // and the configured library pricing. The AI (when configured) only re-orders /
  // picks the best fit among the pre-filtered candidates and explains WHY.
  const activeSolutions = await solutionsRepo.list({ accountId });
  const capabilityProfile = await capabilitiesRepo.getCapabilities(userId).catch(() => null);
  const shortlist = matchSolutions(activeSolutions, {
    business,
    problem_type: opportunity.problem_type,
    signals,
    capabilities: refinement.solution_capabilities || [],
    profile: capabilityProfile,
  }).slice(0, 8);

  let matches = shortlist;
  if (!skipAi && shortlist.length >= 2) {
    const matcher = await runSolutionMatchingAgent({
      business,
      opportunity: { ...opportunity },
      accountId,
      candidates: shortlist.map((m) => {
        const s = activeSolutions.find((x) => x.id === m.solution_id);
        return {
          id: m.solution_id, name: m.name, description: s?.description || '',
          features: s?.features || [], demo_template: s?.demo_template || null,
          project_value: m.project_value, currency: m.currency,
          solves_problem_types: s?.solves_problem_types || [],
        };
      }),
      userId,
    });
    if (matcher.ok) {
      const rec = matcher.data.recommended_solution;
      const altById = Object.fromEntries(matcher.data.alternative_solutions.map((a) => [a.solution_id, a]));
      const withWhy = (id, whyOverride) => {
        const base = shortlist.find((m) => m.solution_id === id);
        if (!base) return null;
        return { ...base, why: whyOverride || base.why };
      };
      const recommended = withWhy(rec.solution_id, rec.fit_reason);
      matches = recommended
        ? [
            { ...recommended, fit_score: matcher.data.fit_score, recommended: true },
            ...matcher.data.alternative_solutions
              .map((a) => withWhy(a.solution_id, a.fit_reason))
              .filter(Boolean)
              .map((m) => ({ ...m, recommended: false })),
            ...shortlist
              .filter((m) => m.solution_id !== rec.solution_id && !altById[m.solution_id])
              .map((m) => ({ ...m, recommended: false })),
          ].slice(0, 5)
        : shortlist;
      if (matches[0]) matches[0].recommended = true;
    }
  }

  if (matches.length) {
    matches.slice(0, 5).forEach((m, i) => { m.recommended = i === 0; });
    await opportunitiesRepo.replaceSolutionMatches(accountId, opportunityId, matches.slice(0, 5));
  }
  const best = matches[0] || null;
  // Factor the FULL recommended solution row (published min/max project span)
  // into ability-to-pay and complexity — the match summary alone lacks them.
  if (best) {
    const resolved = await solutionsRepo.findById(accountId, Number(best.solution_id)).catch(() => null);
    if (resolved) {
      best.minimum_project_value = resolved.minimum_project_value;
      best.maximum_project_value = resolved.maximum_project_value;
    }
  }
  onProgress?.(70, 'matching_solutions');

  // --- financial scenarios (always deterministic app code, never AI) ---
  // Business impact is computed here from low/base/high assumption triples via
  // the canonical Financial Opportunity Engine. PROJECT VALUE is kept separate
  // and comes only from the solution library (opportunity_solutions).
  const bundle = buildFinancialScenariosForMechanism(mechanismKey, flattenTriples(scenarioOverrides));
  await financialRepo.replaceAssumptions(accountId, opportunityId, bundle.assumptions);
  await financialRepo.replaceScenarios(accountId, opportunityId, bundle.scenarios);
  const annualMidpoint = midpointAnnualPotential(bundle.scenarios);
  onProgress?.(85, 'calculating_scenarios');

  // --- scoring (deterministic; stored in dedicated columns) ---
  const confidenceScore = Math.round(
    (evidence.reduce((s, e) => s + Number(e.confidence_score), 0) / (evidence.length || 1)) * 100
  ) / 100;
  const confidence = Number.isFinite(confidenceScore)
    ? Math.min(1, Math.max(0.05, Number(confidenceScore)))
    : 1;
  const factorValues = {
    evidence_strength: evidenceStrengthFactor(evidence),
    problem_severity: severityFactor(opportunity.problem_type),
    money_potential: Math.round(moneyPotentialFactor(annualMidpoint) * confidence),
    solution_fit: best ? Math.min(100, best.fit_score) : 0,
    business_maturity: maturityFactor(signals),
    ability_to_pay: abilityToPayFactor(signals, best, business?.followers ?? null),
    operational_complexity: complexityFactor(best),
    contactability: contactabilityFactor(contacts),
  };
  // Follower count is deliberately a tiny, capped supporting signal inside the
  // commercial (ability-to-pay) factor — it never stands alone or dominates.
  const { score, category, breakdown, subscores, reasons } =
    await opportunitiesRepo.updateAnalysis(accountId, opportunityId, {
      ...factorValues,
      confidence_score: confidenceScore,
      next_action: refinement.next_action || null,
      analysis_provider: provider,
    }, {
      annualMidpoint,
      confidence: confidence,
      maturitySignals: countMaturitySignals(signals),
      followers: business?.followers ?? null,
      recommendedSolution: best,
      business,
    });

  onProgress?.(95, 'scoring');
  if (!skipAi) await incrementUsage(accountId, 'ai_analyses', 1).catch(() => {});
  return {
    provider,
    verdict: analystVerdict ? 'OPPORTUNITY_FOUND' : 'RULES_FALLBACK',
    refinement, bundle, annualMidpoint, matches, score,
    factors: factorValues, confidence_score: confidenceScore,
    category, subscores, reasons,
    jobId: analyst.jobId,
  };
}

async function latestResearch(accountId, businessId) {
  const rows = await query(
    `SELECT output_json FROM ai_jobs
      WHERE job_type = 'research_interpretation' AND business_id = ? AND account_id = ? AND status = 'completed'
      ORDER BY id DESC LIMIT 1`,
    [Number(businessId), Number(accountId)]
  );
  if (!rows[0]) return null;
  try {
    return { data: typeof rows[0].output_json === 'string' ? JSON.parse(rows[0].output_json) : rows[0].output_json };
  } catch {
    return null;
  }
}

function moneyMechanism(key) {
  return MONEY_MECHANISMS[key]?.label || key.replaceAll('_', ' ');
}

function moneyMechanismText(key, aiText) {
  const fallback = `${moneyMechanism(key)} — ${MONEY_MECHANISMS[key]?.description || 'a plausible commercial consequence of the evidence.'}`;
  return (aiText && String(aiText).trim()) ? String(aiText).slice(0, 500) : fallback;
}

/**
 * AI research profile via BUSINESS_RESEARCH_AGENT.
 * Output is stored in ai_jobs and returned for human review — never persisted
 * as fact automatically.
 */
export async function interpretResearch(accountId, businessId, userId) {
  const business = await businessesRepo.findBusiness(accountId, businessId);
  if (!business) throw new HttpError(404, 'Business not found');
  const evidenceRows = await evidenceRepo.listForBusiness(accountId, businessId);
  if (!evidenceRows.length) throw new HttpError(400, 'Collect some evidence first');
  const sourceContent = evidenceRows
    .map((e) => e.source_excerpt_summary || e.evidence_text)
    .join('\n')
    .slice(0, 8000);
  return runBusinessResearchAgent({ business, sourceContent, evidence: evidenceRows, userId, accountId });
}
