import { pipelineKanban, pipelineMetrics } from '@/lib/repositories/financial';
import { requireAccount, jsonOk, handleRouteError } from '@/lib/api-helpers';

export async function GET() {
  try {
    const user = await requireAccount();
    const [kanban, metrics] = await Promise.all([
      pipelineKanban({ accountId: user.account_id, memberUserId: user.role === 'member' ? user.id : null }),
      pipelineMetrics(user.account_id),
    ]);
    return jsonOk({ kanban, metrics });
  } catch (err) {
    return handleRouteError(err);
  }
}
