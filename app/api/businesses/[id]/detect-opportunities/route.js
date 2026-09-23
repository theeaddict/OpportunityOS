import { detectOpportunities } from '@/lib/services/analysis';
import { audit } from '@/lib/audit';
import { requireAccount, jsonOk, handleRouteError } from '@/lib/api-helpers';
import { enforce } from '@/lib/rate-limit';
import { assertWithinLimit } from '@/lib/accounts/usage';

export async function POST(request, { params }) {
  try {
    const user = await requireAccount();
    enforce(request, { limit: 60, windowMs: 60 * 60_000, key: 'detect-opportunities' });
    await assertWithinLimit(user.account_id, 'opportunities');
    const { id } = await params;
    const businessId = Number(id);
    const result = await detectOpportunities(user.account_id, businessId, user.id);
    await audit('opportunity.detected', {
      entity_type: 'business', entity_id: businessId,
      detail: { created: result.created.length, rejected: result.rejected.length }, user_id: user.id, account_id: user.account_id,
    });
    if (result.rejected.length) {
      await audit('opportunity.rejected_weak', {
        entity_type: 'business', entity_id: businessId,
        detail: { rejected: result.rejected }, user_id: user.id, account_id: user.account_id,
      });
    }
    return jsonOk({
      created_count: result.created.length,
      created_ids: result.created,
      skipped: result.skipped,
      rejected: result.rejected,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
