import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import * as businessesRepo from '@/lib/repositories/businesses';
import * as evidenceRepo from '@/lib/repositories/evidence';
import * as solutionsRepo from '@/lib/repositories/solutions';
import * as capabilitiesRepo from '@/lib/repositories/capabilities';
import { matchSolutions } from '@/lib/services/analysis/matching';

export const SOLUTION_MATCHING_HANDLER = {
  type: 'SOLUTION_MATCHING',
  label: 'Solution matching & ranking',
  cancellable: false,
  async run(job, ctx) {
    const { opportunityId } = job.payload || {};
    if (!opportunityId) throw new Error('SOLUTION_MATCHING requires opportunityId in the payload');

    const opp = await opportunitiesRepo.findById(job.account_id, Number(opportunityId));
    if (!opp) throw new Error('Opportunity not found');
    const business = await businessesRepo.findBusiness(job.account_id, opp.business_id);
    const signals = await evidenceRepo.signalsForBusiness(job.account_id, opp.business_id);
    const activeSolutions = await solutionsRepo.list({ accountId: job.account_id });
    const profile = job.created_by
      ? await capabilitiesRepo.getCapabilities(job.created_by).catch(() => null)
      : null;

    ctx.reportProgress(40, 'scoring_solution_fit');
    const matches = matchSolutions(activeSolutions, {
      business,
      problem_type: opp.problem_type,
      signals,
      profile,
    });

    if (matches.length) {
      const ranked = matches.slice(0, 5).map((m, i) => ({ ...m, recommended: i === 0 }));
      await opportunitiesRepo.replaceSolutionMatches(job.account_id, Number(opportunityId), ranked);
    }

    ctx.reportProgress(90, 'saving_matches');
    return {
      opportunity_id: Number(opportunityId),
      matches: matches.slice(0, 5).map((m) => ({
        solution_id: m.solution_id,
        name: m.name,
        fit_score: m.fit_score,
        recommended: Boolean(m.recommended),
        project_value: m.project_value,
        why: m.why || null,
      })),
    };
  },
};