import { generateDraft } from '@/lib/services/outreach';

export const OUTREACH_GENERATION_HANDLER = {
  type: 'OUTREACH_GENERATION',
  label: 'Personalized outreach draft',
  cancellable: false,
  async run(job, ctx) {
    const { opportunityId } = job.payload || {};
    if (!opportunityId) throw new Error('OUTREACH_GENERATION requires opportunityId in the payload');

    // Drafts are saved UNAPPROVED for human review — outreach is never sent
    // by a job, only approved and sent by a person.
    ctx.reportProgress(20, 'preparing_outreach');
    const result = await generateDraft({ accountId: job.account_id, opportunityId: Number(opportunityId), userId: job.created_by ?? null });
    return { opportunity_id: Number(opportunityId), ...result };
  },
};