import { analyzeOpportunity } from '@/lib/services/analysis';

export const OPPORTUNITY_ANALYSIS_HANDLER = {
  type: 'OPPORTUNITY_ANALYSIS',
  label: 'Full opportunity analysis',
  cancellable: false,
  async run(job, ctx) {
    const { opportunityId, scenarioOverrides = {}, skipAi = false } = job.payload || {};
    if (!opportunityId) throw new Error('OPPORTUNITY_ANALYSIS requires opportunityId in the payload');

    // skipAi:false (default) runs the AI analyst when configured; without a key
    // the rules fallback is used and the opportunity is stamped 'rules'.
    const result = await analyzeOpportunity(
      job.account_id,
      Number(opportunityId),
      job.created_by ?? null,
      scenarioOverrides || {},
      {
        skipAi: Boolean(skipAi),
        onProgress: (pct, stage) => ctx.reportProgress(pct, stage),
      }
    );
    return {
      opportunity_id: Number(opportunityId),
      verdict: result.verdict,
      provider: result.provider,
      score: result.score ?? null,
      confidence_score: result.confidence_score ?? null,
      category: result.category ?? null,
      annual_midpoint: result.annualMidpoint ?? null,
      match_count: (result.matches || []).length,
      jobId: result.jobId ?? null,
    };
  },
};