import { retry } from '@/lib/jobs/queue';
import { audit } from '@/lib/audit';
import { requireAccount, jsonOk, handleRouteError } from '@/lib/api-helpers';

/**
 * Retry a failed job (human-initiated): the job goes straight back to the queue
 * with a fresh attempt budget.
 */
export async function POST(request, { params }) {
  try {
    const user = await requireAccount();
    const { id } = await params;
    const ok = await retry(Number(id), user.account_id);
    await audit('job.retried', {
      entity_type: 'background_jobs', entity_id: Number(id),
      metadata: { ok }, user_id: user.id, account_id: user.account_id,
    }).catch(() => {});
    if (!ok) return Response.json({ ok: false, error: 'Only failed jobs can be retried' }, { status: 400 });
    return jsonOk({ job_id: Number(id), status: 'queued' });
  } catch (err) {
    return handleRouteError(err);
  }
}