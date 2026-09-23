import { requestCancel } from '@/lib/jobs/queue';
import { audit } from '@/lib/audit';
import { requireAccount, jsonOk, handleRouteError } from '@/lib/api-helpers';

/**
 * Cancel a job where safe. Queued jobs cancel immediately; running jobs are
 * flagged and stop at their next safe point (handlers check the flag) before
 * being marked 'cancelled' — never 'completed' with partial work.
 */
export async function POST(request, { params }) {
  try {
    const user = await requireAccount();
    const { id } = await params;
    const outcome = await requestCancel(Number(id), user.account_id);
    await audit('job.cancel_requested', {
      entity_type: 'background_jobs', entity_id: Number(id),
      metadata: outcome, user_id: user.id, account_id: user.account_id,
    }).catch(() => {});
    return jsonOk({ ...outcome });
  } catch (err) {
    return handleRouteError(err);
  }
}