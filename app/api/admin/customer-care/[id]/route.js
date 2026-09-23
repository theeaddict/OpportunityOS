import { requireSuperadmin, HttpError, handleRouteError, jsonOk, readJson } from '@/lib/api-helpers';
import { getCareContact, updateCareContact, deleteCareContact } from '@/lib/accounts/customer-care';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Update contact details or the "reach out" flag.
export async function PATCH(request, { params }) {
  try {
    const admin = await requireSuperadmin();
    const { id } = await params;
    const existing = await getCareContact(id);
    if (!existing) throw new HttpError(404, 'Contact not found');

    const body = await readJson(request);
    const fields = {};
    if (body.name !== undefined) fields.name = body.name;
    if (body.role !== undefined) fields.role = body.role;
    if (body.email !== undefined) fields.email = body.email;
    if (body.phone !== undefined) fields.phone = body.phone;
    if (body.notes !== undefined) fields.notes = body.notes;
    if (body.reach_out !== undefined) fields.reach_out = body.reach_out === true;

    if (Object.keys(fields).length === 0) return jsonOk({ contact: existing });

    await updateCareContact(existing.id, fields);
    await audit('admin.care_contact_updated', {
      entity_type: 'customer_care_contact',
      entity_id: existing.id,
      admin_user_id: admin.id,
      account_id: existing.account_id,
      metadata: { name: existing.name, fields: Object.keys(fields) },
    });
    const contact = await getCareContact(existing.id);
    return jsonOk({ contact });
  } catch (err) {
    return handleRouteError(err);
  }
}

// Remove a customer-care contact.
export async function DELETE(request, { params }) {
  try {
    const admin = await requireSuperadmin();
    const { id } = await params;
    const existing = await getCareContact(id);
    if (!existing) throw new HttpError(404, 'Contact not found');

    const affected = await deleteCareContact(existing.id);
    if (!affected) throw new HttpError(404, 'Contact not found');
    await audit('admin.care_contact_deleted', {
      entity_type: 'customer_care_contact',
      entity_id: existing.id,
      admin_user_id: admin.id,
      account_id: existing.account_id,
      metadata: { name: existing.name },
    });
    return jsonOk({ deleted: existing.id });
  } catch (err) {
    return handleRouteError(err);
  }
}