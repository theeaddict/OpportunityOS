import { logActivity } from '@/lib/repositories/financial';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import { requireAccount, HttpError, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { isMember } from '@/lib/accounts/roles';

export async function POST(request) {
  try {
    const user = await requireAccount();
    const body = await readJson(request);
    const opportunityId = Number(body.opportunity_id);
    if (!opportunityId) return Response.json({ ok: false, error: 'opportunity_id required' }, { status: 400 });

    const existing = await opportunitiesRepo.findById(user.account_id, opportunityId);
    if (!existing) return Response.json({ ok: false, error: 'Opportunity not found' }, { status: 404 });
    if (isMember(user) && existing.assignee_id != user.id) {
      throw new HttpError(403, 'You do not have permission to do this');
    }

    await logActivity({
      account_id: user.account_id,
      opportunity_id: opportunityId,
      activity_type: body.activity_type || 'note',
      title: body.title || null,
      detail: body.detail || null,
      metadata: body.metadata || null,
      actor_user_id: user.id,
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
