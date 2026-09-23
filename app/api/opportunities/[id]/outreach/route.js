import { generateDraft } from '@/lib/services/outreach';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import * as businessesRepo from '@/lib/repositories/businesses';
import { audit } from '@/lib/audit';
import { requireAccount, HttpError, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { isMember } from '@/lib/accounts/roles';
import { enforce } from '@/lib/rate-limit';
import { hasVerifiedContact, isRejectedOpportunity } from '@/lib/services/gating';

// Generate a new draft for this opportunity.
export async function POST(request, { params }) {
  try {
    const user = await requireAccount();
    enforce(request, { limit: 20, windowMs: 60 * 60_000, key: 'outreach-generate' });
    const { id } = await params;
    const opportunityId = Number(id);
    const existing = await opportunitiesRepo.findById(user.account_id, opportunityId);
    if (!existing) return Response.json({ ok: false, error: 'Opportunity not found' }, { status: 404 });
    if (isMember(user) && existing.assignee_id != user.id) {
      throw new HttpError(403, 'You do not have permission to do this');
    }
    if (isRejectedOpportunity(existing)) {
      return Response.json(
        { ok: false, error: 'This opportunity is scored REJECT — outreach is disabled until the score improves.' },
        { status: 409 },
      );
    }
    const business = await businessesRepo.findBusiness(user.account_id, existing.business_id);
    const contacts = business ? await businessesRepo.listContacts(user.account_id, business.id) : [];
    if (!hasVerifiedContact(contacts)) {
      return Response.json(
        { ok: false, error: 'Link a verified public contact on the business before generating outreach' },
        { status: 409 },
      );
    }
    try {
      const result = await generateDraft({ accountId: user.account_id, opportunityId, userId: user.id });
      await audit('outreach.generated', {
        entity_type: 'opportunities', entity_id: opportunityId,
        metadata: { message_ids: result.messageIds, generated_by: result.generatedBy }, user_id: user.id, account_id: user.account_id,
      });
      return jsonOk({ message_ids: result.messageIds, generated_by: result.generatedBy });
    } catch (inner) {
      if (/needs at least one FACT/.test(inner.message) || /No linked evidence/.test(inner.message)) {
        return Response.json({ ok: false, error: inner.message }, { status: 400 });
      }
      throw inner;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
