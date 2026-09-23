import { runDiscoveryPipeline } from '@/lib/services/discovery/pipeline';

export const DISCOVERY_HANDLER = {
  type: 'DISCOVERY',
  label: 'Opportunity discovery run',
  cancellable: true,
  async run(job, ctx) {
    const { provider = 'manual', filters = {}, searchQueryId = null, owner_run = false, businessIds = null } = job.payload || {};
    const result = await runDiscoveryPipeline(job.account_id, provider, filters, {
      jobId: job.id,
      userId: job.created_by ?? null,
      searchQueryId,
      bypassCapabilities: Boolean(owner_run),
      businessIds,
    });
    return result;
  },
};