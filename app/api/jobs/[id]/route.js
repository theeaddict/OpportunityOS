import { get } from '@/lib/jobs/queue';
import { requireAccount, jsonOk, handleRouteError } from '@/lib/api-helpers';

/**
 * Live status for any background job — the generic poll endpoint. Progress and
 * stage come straight from the real background_jobs row; a job never reports
 * 'completed' until its handler has actually finished.
 */
export async function GET(request, { params }) {
  try {
    const user = await requireAccount();
    const { id } = await params;
    const job = await get(Number(id), user.account_id);
    if (!job) return Response.json({ ok: false, error: 'Job not found' }, { status: 404 });
    return jsonOk({
      job_id: job.id,
      type: job.type,
      status: job.status,
      stage: job.stage || null,
      progress: job.progress,
      attempts: job.attempts,
      max_attempts: job.max_attempts,
      error: job.error || null,
      result: job.result,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}