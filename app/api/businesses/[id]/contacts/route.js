import * as businessesRepo from '@/lib/repositories/businesses';
import { audit } from '@/lib/audit';
import { requireAccount, requireRole, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';

// Contacts: /api/businesses/[id]/contacts
export async function GET(request, { params }) {
  try {
    const user = await requireAccount();
    const { id } = await params;
    return jsonOk({ contacts: await businessesRepo.listContacts(user.account_id, Number(id)) });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request, { params }) {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin'); // contacts are account-wide data — OWNER/ADMIN only
    const { id } = await params;
    const businessId = Number(id);
    const business = await businessesRepo.findBusiness(user.account_id, businessId);
    if (!business) return Response.json({ ok: false, error: 'Business not found' }, { status: 404 });
    const body = await readJson(request);

    if (!body.contact_value) {
      return Response.json({ ok: false, error: 'Contact value required' }, { status: 400 });
    }

    // Optional provenance source row (CONTACT RULE: public details only).
    let sourceId = null;
    if (body.contact_source || body.source_url) {
      sourceId = await businessesRepo.addSource({
        account_id: user.account_id,
        business_id: businessId,
        source_type: 'web_directory',
        source_name: String(body.contact_source || 'Public listing').slice(0, 200),
        source_url: body.source_url || null,
      });
    }

    try {
      const contactId = await businessesRepo.addContact({
        account_id: user.account_id,
        business_id: businessId,
        contact_type: body.contact_type,
        contact_value: String(body.contact_value).slice(0, 320),
        is_public: body.is_public === undefined ? 1 : Boolean(body.is_public),
        verification_status: ['unverified', 'source_published', 'user_confirmed', 'invalid'].includes(body.verification_status)
          ? body.verification_status : 'unverified',
        confidence_score: body.confidence_score ?? 0.5,
        source_id: sourceId,
      });
      await audit('contact.created', { entity_type: 'business', entity_id: businessId, metadata: { contact_id: contactId }, user_id: user.id, account_id: user.account_id });
      return jsonOk({ id: contactId }, 201);
    } catch (inner) {
      if (/WhatsApp number/.test(inner.message)) {
        return Response.json({ ok: false, error: inner.message }, { status: 400 });
      }
      throw inner;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin'); // deleting a contact affects account-wide records
    const { id } = await params;
    const contactId = Number(new URL(request.url).searchParams.get('contact_id'));
    if (!contactId) return Response.json({ ok: false, error: 'contact_id required' }, { status: 400 });
    await businessesRepo.deleteContact(user.account_id, contactId);
    await audit('contact.deleted', { entity_type: 'business', entity_id: Number(id), metadata: { contact_id: contactId }, user_id: user.id, account_id: user.account_id });
    return jsonOk({ id: contactId });
  } catch (err) {
    return handleRouteError(err);
  }
}
