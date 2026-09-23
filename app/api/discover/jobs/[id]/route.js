import { get } from '@/lib/jobs/queue';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import { isPursuableOpportunity } from '@/lib/services/gating';
import { requireAccount, jsonOk, handleRouteError } from '@/lib/api-helpers';

/**
 * Live status for a discovery (DISCOVERY background) job. The client polls
 * while the pipeline runs; progress/stage come straight from the real
 * background_jobs row — never fabricated.
 */
export async function GET(request, { params }) {
  try {
    const user = await requireAccount();
    const { id } = await params;
    const job = await get(Number(id), user.account_id);
    if (!job) return Response.json({ ok: false, error: 'Job not found' }, { status: 404 });

    const summary = job.result;
    let results = [];
    if (job.status === 'completed' && summary?.opportunity_ids?.length) {
      results = await opportunitiesRepo.listByIds(user.account_id, summary.opportunity_ids);
      // Keep REJECT / never-scored opportunities out of the primary results list.
      results = results.filter(isPursuableOpportunity);
    }

    return jsonOk({
      job_id: job.id,
      status: job.status,
      stage: job.stage || null,
      progress: job.progress,
      error: job.error || null,
      summary,
      results,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}