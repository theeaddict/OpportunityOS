import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import * as businessesRepo from '@/lib/repositories/businesses';
import * as solutionsRepo from '@/lib/repositories/solutions';
import { generateDemoSpec } from '@/lib/services/demo/index.js';
import { audit } from '@/lib/audit';
import { incrementUsage } from '@/lib/accounts/usage';

export const DEMO_GENERATION_HANDLER = {
  type: 'DEMO_GENERATION',
  label: 'Concept demo generation',
  cancellable: false,
  async run(job, ctx) {
    const { opportunityId } = job.payload || {};
    if (!opportunityId) throw new Error('DEMO_GENERATION requires opportunityId in the payload');

    ctx.reportProgress(20, 'loading_context');
    const opp = await opportunitiesRepo.findById(job.account_id, Number(opportunityId));
    if (!opp) throw new Error('Opportunity not found');
    const business = await businessesRepo.findBusiness(job.account_id, opp.business_id);
    const links = await opportunitiesRepo.solutionLinks(job.account_id, Number(opportunityId));
    const bestLink = links.find((l) => l.recommended) || links[0];
    const solution = bestLink ? await solutionsRepo.findById(job.account_id, bestLink.solution_id) : null;
    if (!solution) throw new Error('Match a solution first (run analysis before generating a demo)');

    ctx.reportProgress(60, 'building_demo_spec');
    // Template-based concept demo — every output clearly labeled CONCEPT DEMO,
    // all sample data fictional.
    const spec = generateDemoSpec({ business, opportunity: opp, solution });

    ctx.reportProgress(90, 'saving_demo_spec');
    // Usage tracking: one demo generated this period (request boundary asserts the limit).
    await incrementUsage(job.account_id, 'demo_generations', 1).catch(() => {});
    await audit('demo_spec.generated', {
      account_id: job.account_id,
      entity_type: 'opportunities', entity_id: Number(opportunityId),
      metadata: { provider: 'template', industry: spec.industry, via: 'background_job' },
      user_id: job.created_by ?? null,
    }).catch(() => {});

    return { opportunity_id: Number(opportunityId), spec };
  },
};