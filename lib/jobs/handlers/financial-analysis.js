import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import * as financialRepo from '@/lib/repositories/financial';
import { buildFinancialScenariosForMechanism, flattenTriples, legacyMechanismForProblem } from '@/lib/services/analysis/scenarios';

export const FINANCIAL_ANALYSIS_HANDLER = {
  type: 'FINANCIAL_ANALYSIS',
  label: 'Financial scenario analysis',
  cancellable: false,
  async run(job, ctx) {
    const { opportunityId, scenarioOverrides = {} } = job.payload || {};
    if (!opportunityId) throw new Error('FINANCIAL_ANALYSIS requires opportunityId in the payload');

    const opp = await opportunitiesRepo.findById(job.account_id, Number(opportunityId));
    if (!opp) throw new Error('Opportunity not found');
    if (!opp.opportunity_explanation && !opp.money_mechanism_key) {
      throw new Error('Run opportunity analysis first so a money mechanism is on file');
    }

    const mechanismKey = opp.money_mechanism_key
      || legacyMechanismForProblem(opp.problem_type)
      || 'additional_sales';

    ctx.reportProgress(30, 'building_scenarios');
    // Deterministic Financial Opportunity Engine — application code, NOT AI.
    const bundle = buildFinancialScenariosForMechanism(mechanismKey, flattenTriples(scenarioOverrides || {}));
    await financialRepo.replaceAssumptions(job.account_id, Number(opportunityId), bundle.assumptions);
    await financialRepo.replaceScenarios(job.account_id, Number(opportunityId), bundle.scenarios);

    ctx.reportProgress(90, 'persisting_scenarios');
    return {
      opportunity_id: Number(opportunityId),
      mechanism: mechanismKey,
      scenario_ids: bundle.scenarios.map((s) => s.id).filter(Boolean),
      disclaimer: bundle.disclaimer,
    };
  },
};