import { interpretResearch } from '@/lib/services/analysis';

export const AI_RESEARCH_HANDLER = {
  type: 'AI_RESEARCH',
  label: 'AI research interpretation',
  cancellable: false,
  async run(job, ctx) {
    const { businessId } = job.payload || {};
    if (!businessId) throw new Error('AI_RESEARCH requires businessId in the payload');
    ctx.reportProgress(10, 'preparing_evidence');

    const { aiProvider } = await import('@/lib/ai/provider.js');
    if (!aiProvider.isConfigured()) {
      return {
        business_id: Number(businessId),
        skipped: true,
        reason: 'not_configured',
        note: 'AI_API_KEY / AI_MODEL not configured — nothing was run.',
      };
    }

    ctx.reportProgress(40, 'running_agent');
    // Output is stored in ai_jobs and returned for human review — AI output is
    // never persisted as fact automatically.
    const result = await interpretResearch(job.account_id, Number(businessId), job.created_by ?? null);
    ctx.reportProgress(90, 'recording_result');
    return { business_id: Number(businessId), ...result };
  },
};