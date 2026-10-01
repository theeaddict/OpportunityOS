import * as solutionsRepo from '@/lib/repositories/solutions';
import { audit } from '@/lib/audit';
import { requireAccount, requireRole, jsonOk, handleRouteError } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * Load the starter solution library into the caller's workspace. Idempotent:
 * existing solutions (including edited starters) are never overwritten.
 */
export async function POST() {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin');
    const added = await solutionsRepo.seedStarterSolutions(user.account_id);
    await audit('solution.starter_loaded', {
      entity_type: 'solution', metadata: { added }, user_id: user.id, account_id: user.account_id,
    }).catch(() => {});
    return jsonOk({ added });
  } catch (err) {
    return handleRouteError(err);
  }
}
