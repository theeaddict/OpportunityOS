import { updatePipeline } from '@/lib/repositories/financial';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import { audit } from '@/lib/audit';
import { requireAccount, HttpError, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { isMember } from '@/lib/accounts/roles';

export async function PATCH(request, { params }) {
  try {
    const user = await requireAccount();
    const { id } = await params;
    const opportunityId = Number(id);
    const existing = await opportunitiesRepo.findById(user.account_id, opportunityId);
    if (!existing) return Response.json({ ok: false, error: 'Opportunity not found' }, { status: 404 });
    if (isMember(user) && existing.assignee_id != user.id) {
      throw new HttpError(403, 'You do not have permission to do this');
    }

    const body = await readJson(request);

    // Status change via pipeline (creates events + updates probability).
    if (body.status && body.status !== existing.status) {
      try {
        await updatePipeline(user.account_id, opportunityId, body.status, {
          notes: body.notes ? String(body.notes).slice(0, 400) : null,
          actor_user_id: user.id,
          project_value: body.project_value != null ? Number(body.project_value) : null,
          project_currency: body.project_currency || null,
        });
      } catch (inner) {
        return Response.json({ ok: false, error: inner.message }, { status: 400 });
      }
      await audit('opportunity.status_changed', {
        entity_type: 'opportunities', entity_id: opportunityId,
        metadata: { from: existing.status, to: body.status }, user_id: user.id, account_id: user.account_id,
      });
    }

    // Update project value without changing status.
    if (body.project_value != null && !body.status) {
      await opportunitiesRepo.updateProjectValue(user.account_id, opportunityId, Number(body.project_value), body.project_currency || 'KES');
    }

    // Update notes without changing status.
    if (body.notes != null && !body.status) {
      await opportunitiesRepo.updateNotes(user.account_id, opportunityId, String(body.notes).slice(0, 5000));
    }

    // Update next action.
    if (body.next_action != null && !body.status) {
      await opportunitiesRepo.updateNextAction(user.account_id, opportunityId, String(body.next_action).slice(0, 300));
    }

    const updated = await opportunitiesRepo.findById(user.account_id, opportunityId);
    return jsonOk({ id: opportunityId, status: updated.status });
  } catch (err) {
    return handleRouteError(err);
  }
}
