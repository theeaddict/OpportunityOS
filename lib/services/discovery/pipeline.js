import * as jobsQueue from '@/lib/jobs/queue';
import * as businessesRepo from '@/lib/repositories/businesses';
import * as evidenceRepo from '@/lib/repositories/evidence';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import { getScoreThresholds } from '@/lib/repositories/settings';
import { incrementUsage } from '@/lib/accounts/usage';
import { runSearch, importCandidates } from './index.js';
import { detectOpportunities, analyzeOpportunity } from '@/lib/services/analysis';
import { runAutomatedResearch } from '@/lib/services/research/run';
import { getRawProvider } from '@/lib/services/research';

/**
 * One-click "Find opportunities" pipeline.
 *
 * Runs the whole lifecycle inside a DISCOVERY background job and writes REAL
 * progress to background_jobs (stage + progress from actual milestones — never
 * a fake animation). Stages:
 *   discovering → researching → checking_contacts → analyzing →
 *   identifying_opportunities → calculating_scenarios → matching_solutions → ranking
 *
 * The returned summary ("N businesses researched / N with evidence on file /
 * N strong opportunities") is computed from the real DB state at the end and is
 * stored as the job's result by the worker. The worker marks the job completed.
 *
 * Cancellation is honored between businesses at safe points: if a cancel was
 * requested, the run stops and returns its partial tally; the worker then flips
 * the job to 'cancelled' instead of 'completed'.
 */

export async function runDiscoveryPipeline(accountId, providerId, filters, { jobId, userId, bypassCapabilities = false, businessIds: providedIds = null, searchQueryId = null }) {
  await jobsQueue.reportProgress(jobId, 5, 'starting');
  let researched = 0;
  let withEvidence = 0;
  let manualFollowUp = 0;
  const opportunityIds = new Set();

  let businessIds;
  if (Array.isArray(providedIds) && providedIds.length) {
    // Leads already ingested (webhook/feed) — skip search/import and process the
    // given businesses directly. This is the real-time path: as soon as a lead
    // arrives, its analysts run without waiting for a whole scan.
    businessIds = [...new Set(providedIds.map((b) => Number(b)).filter((n) => Number.isFinite(n) && n > 0))];
    if (!businessIds.length) {
      await jobsQueue.reportProgress(jobId, 95, 'ranking');
      return { businesses_researched: 0, with_evidence: 0, strong_opportunities: 0, manual_follow_up: 0, opportunity_ids: [] };
    }
    const kept = await businessesRepo.findByIds(accountId, businessIds);
    businessIds = kept.map((b) => Number(b.id));
    if (!businessIds.length) {
      await jobsQueue.reportProgress(jobId, 95, 'ranking');
      return { businesses_researched: 0, with_evidence: 0, strong_opportunities: 0, manual_follow_up: 0, opportunity_ids: [] };
    }
  } else {
    // ---- Stage 1: discovering -------------------------------------------------
    await jobsQueue.reportProgress(jobId, 8, 'discovering');
    const candidates = await runSearch(providerId, filters);
    if (!candidates.length) {
      await jobsQueue.reportProgress(jobId, 95, 'ranking');
      return { businesses_researched: 0, with_evidence: 0, strong_opportunities: 0, manual_follow_up: 0, opportunity_ids: [] };
    }

    // ---- Stage 2: importing / researching the found businesses ---------------
    await jobsQueue.reportProgress(jobId, 16, 'researching');
    const importOutcomes = await importCandidates(accountId, candidates, { userId });
    businessIds = [...new Set(
      importOutcomes
        .filter((o) => o.business_id != null && !o.error)
        .map((o) => Number(o.business_id))
    )];
    // Track candidates flagged as needing manual contact follow-up (e.g. an OSM
    // listing with no public phone/website) so the run summary can surface them.
    manualFollowUp = importOutcomes.filter((o) => o.needs_manual_follow_up).length;
  }
  const total = businessIds.length;
  researched = total;
  // Usage tracking: count businesses researched this period (clamped at limits;
  // enforcement happens at the request boundary before enqueue).
  await incrementUsage(accountId, 'researches', researched).catch(() => {});

  let done = 0;
  for (const businessId of businessIds) {
    if (await jobsQueue.isCancelRequested(jobId)) {
      return { cancelled: true, businesses_researched: researched, with_evidence: withEvidence, strong_opportunities: 0, manual_follow_up: manualFollowUp, opportunity_ids: [...opportunityIds] };
    }
    // Research: ensure evidence is on file; providers persist candidate evidence
    // at import, manual businesses keep whatever evidence the operator recorded.
    try {
      const hadEvidence = await ensureResearched(accountId, businessId, userId);
      if (hadEvidence) withEvidence += 1;
    } catch {
      /* a single business failing research must not sink the run */
    }
    done += 1;
    await jobsQueue.reportProgress(jobId, 14 + Math.round((done / Math.max(1, total)) * 26), 'researching');
  }

  // ---- Stages 3-6: contacts → analyze → identify → scenarios ---------------
  await jobsQueue.reportProgress(jobId, 45, 'checking_contacts');
  done = 0;
  for (const businessId of businessIds) {
    if (await jobsQueue.isCancelRequested(jobId)) {
      return { cancelled: true, businesses_researched: researched, with_evidence: withEvidence, strong_opportunities: 0, manual_follow_up: manualFollowUp, opportunity_ids: [...opportunityIds] };
    }
    try {
      const detection = await detectOpportunities(accountId, businessId, userId, { bypassCapabilities });
      for (const id of detection.created) opportunityIds.add(Number(id));

      // Analyse only opportunities that haven't been scored yet (real work when
      // there is actually something new to rank).
      const existing = await opportunitiesRepo.findByBusiness(accountId, businessId);
      for (const opp of existing) {
        if (opp.opportunity_score == null) {
          try {
            const r = await analyzeOpportunity(accountId, opp.id, userId, {}, { skipAi: true });
            if (r.score != null && !r.verdict?.startsWith('NO_STRONG')) opportunityIds.add(Number(opp.id));
          } catch { /* analyse per-opportunity; never fail the run */ }
        } else {
          opportunityIds.add(Number(opp.id));
        }
      }
    } catch {
      /* detection/analysis per business is guarded */
    }
    done += 1;
    const prog = 45 + Math.round((done / Math.max(1, total)) * 40);
    await jobsQueue.reportProgress(jobId, prog, 'analyzing');
  }
  await jobsQueue.reportProgress(jobId, 82, 'identifying_opportunities');

  // ---- Stages 7-8: matching + ranking ---------------------------------------
  await jobsQueue.reportProgress(jobId, 88, 'matching_solutions');
  const ids = [...opportunityIds];
  let strong = 0;
  if (ids.length) {
    // Ranking is computable from the already-scored engine output.
    await jobsQueue.reportProgress(jobId, 94, 'ranking');
    const thresholds = await getScoreThresholds(accountId).catch(() => null);
    const strongAt = thresholds?.high ?? 80;
    const placed = await opportunitiesRepo.listByIds(accountId, ids);
    strong = placed.filter((o) => o.opportunity_score != null && o.opportunity_score >= strongAt).length;
  } else {
    await jobsQueue.reportProgress(jobId, 94, 'ranking');
  }

  await jobsQueue.reportProgress(jobId, 98, 'ranking');
  return {
    businesses_researched: researched,
    with_evidence: withEvidence,
    strong_opportunities: strong,
    manual_follow_up: manualFollowUp,
    opportunity_ids: ids,
  };
}

/** Ensure a business has evidence; returns whether it ended with evidence. */
async function ensureResearched(accountId, businessId, userId) {
  const business = await businessesRepo.findBusiness(accountId, businessId);
  if (!business) return false;

  const [countBefore, signalsBefore] = await Promise.all([
    evidenceRepo.countResearchEvidenceForBusiness(accountId, businessId),
    evidenceRepo.signalsForBusiness(accountId, businessId),
  ]);
  if (Object.keys(signalsBefore).length > 0) return countBefore > 0;

  // A provider listing can be genuine evidence without containing analysis
  // signals. If the business has its own website, enrich it once from public
  // pages so detection has usable, source-backed facts/inferences. Businesses
  // without a website can still be researched when the active research provider
  // does not depend on one (e.g. an operator's licensed directory/search API) —
  // only the website crawler requires a site to look at.
  const researchProvider = getRawProvider();
  const canResearchWithoutWebsite = researchProvider.id !== 'website';
  if (business.website || canResearchWithoutWebsite) {
    try {
      await runAutomatedResearch(accountId, businessId, userId, { trackUsage: false });
    } catch {
      // Listing evidence still counts as evidence; an unreachable website should
      // not sink the whole discovery run.
    }
  }

  const countAfter = await evidenceRepo.countResearchEvidenceForBusiness(accountId, businessId);
  return countAfter > 0;
}
