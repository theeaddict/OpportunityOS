import * as outreachRepo from '@/lib/repositories/outreach';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import * as businessesRepo from '@/lib/repositories/businesses';
import { generateDraft, approveMessage, markSent, advanceMessage } from '@/lib/services/outreach';
import { audit } from '@/lib/audit';
import { requireAccount, HttpError, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { isMember } from '@/lib/accounts/roles';
import { enforce } from '@/lib/rate-limit';
import { hasVerifiedContact, isRejectedOpportunity } from '@/lib/services/gating';

const LIFECYCLE_ACTIONS = ['approve', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost', 'opted_out'];

// Edit draft text / approve / advance lifecycle (Personalized Outreach Engine).
// "sent" (legacy) and "contacted" both require approved=1 AND a public contact.
export async function PATCH(request, { params }) {
  try {
    const user = await requireAccount();
    enforce(request, { limit: 120, windowMs: 60 * 60_000, key: 'outreach-actions' });
    const { id } = await params;
    const messageId = Number(id);
    const existing = await outreachRepo.findById(user.account_id, messageId);
    if (!existing) return Response.json({ ok: false, error: 'Message not found' }, { status: 404 });
    const guardOpportunity = await opportunitiesRepo.findById(user.account_id, existing.opportunity_id);
    if (isMember(user) && guardOpportunity && guardOpportunity.assignee_id != user.id) {
      throw new HttpError(403, 'You do not have permission to do this');
    }

    const body = await readJson(request);

    // Same gate as the draft-generation route — enforce it at the API, not just
    // in the UI. No approve/lifecycle/sent/edit activity on REJECT-scored
    // opportunities or without a verified public contact. Recording an opt-out
    // is always allowed: it is a recipient stop, not outreach.
    if (body.lifecycle_status !== 'opted_out') {
      if (isRejectedOpportunity(guardOpportunity)) {
        return Response.json(
          { ok: false, error: 'This opportunity is scored REJECT — outreach is disabled until the score improves.' },
          { status: 409 },
        );
      }
      const business = guardOpportunity ? await businessesRepo.findBusiness(user.account_id, guardOpportunity.business_id) : null;
      const contacts = business ? await businessesRepo.listContacts(user.account_id, business.id) : [];
      if (!hasVerifiedContact(contacts)) {
        return Response.json(
          { ok: false, error: 'Link a verified public contact on the business before generating outreach' },
          { status: 409 },
        );
      }
    }

    if (body.lifecycle_status && LIFECYCLE_ACTIONS.includes(body.lifecycle_status)) {
      try {
        const res = await advanceMessage(user.account_id, messageId, body.lifecycle_status, user.id);
        if (res.stopped) {
          await audit('outreach.opted_out', {
            entity_type: 'outreach_messages', entity_id: messageId, user_id: user.id, account_id: user.account_id,
          });
        } else {
          await audit(`outreach.${res.lifecycle_status}`, {
            entity_type: 'outreach_messages', entity_id: messageId, user_id: user.id, account_id: user.account_id,
          });
        }
        const updated = await outreachRepo.findById(user.account_id, messageId);
        const opportunity = await opportunitiesRepo.findById(user.account_id, updated.opportunity_id);
        return jsonOk({
          id: messageId,
          approved: Boolean(updated.approved),
          sent_status: updated.sent_status,
          lifecycle_status: updated.lifecycle_status,
          contacted_at: updated.contacted_at,
          opted_out_at: updated.opted_out_at,
          stopped: Boolean(res.stopped),
          opportunity_status: opportunity?.status || null,
        });
      } catch (inner) {
        return Response.json({ ok: false, error: inner.message }, { status: inner instanceof HttpError ? inner.status : 400 });
      }
    }

    if (body.message_text !== undefined || body.approved !== undefined) {
      await outreachRepo.updateDraft(user.account_id, messageId, {
        message_text: body.message_text !== undefined ? String(body.message_text).slice(0, 8000) : existing.message_text,
        approved: body.approved !== undefined ? Boolean(body.approved) : Boolean(existing.approved),
      });
      if (body.approved) {
        await approveMessage(user.account_id, messageId).catch(() => {});
      }
    }

    if (body.sent_status === 'sent') {
      try {
        if (!existing.approved && !body.approved) throw new Error('Approve the message before marking it as sent');
        await approveMessage(user.account_id, messageId).catch(() => {});
        await markSent(user.account_id, messageId, user.id);
      } catch (inner) {
        return Response.json({ ok: false, error: inner.message }, { status: inner instanceof HttpError ? inner.status : 400 });
      }
    }

    const updated = await outreachRepo.findById(user.account_id, messageId);
    const opportunity = await opportunitiesRepo.findById(user.account_id, updated.opportunity_id);
    return jsonOk({
      id: messageId, approved: Boolean(updated.approved), sent_status: updated.sent_status,
      lifecycle_status: updated.lifecycle_status, opportunity_status: opportunity?.status || null,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
