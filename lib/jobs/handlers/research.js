import { runAutomatedResearch } from '@/lib/services/research/run';

export const RESEARCH_HANDLER = {
  type: 'RESEARCH',
  label: 'Automated business research',
  cancellable: false,
  async run(job, ctx) {
    const { businessId } = job.payload || {};
    if (!businessId) throw new Error('RESEARCH requires businessId in the payload');
    ctx.reportProgress(10, 'researching');
    const result = await runAutomatedResearch(job.account_id, Number(businessId), job.created_by ?? null);
    ctx.reportProgress(90, 'saving_evidence');
    return { business_id: Number(businessId), ...result };
  },
};