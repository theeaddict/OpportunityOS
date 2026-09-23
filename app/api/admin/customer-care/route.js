import { requireSuperadmin, HttpError, handleRouteError, jsonOk, readJson } from '@/lib/api-helpers';
import { listCareContacts, createCareContact } from '@/lib/accounts/customer-care';
import { getAccount } from '@/lib/repositories/accounts';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Control-room view of every customer-care contact across the platform.
export async function GET() {
  try {
    await requireSuperadmin();
    const contacts = await listCareContacts();
    return jsonOk({ contacts });
  } catch (err) {
    return handleRouteError(err);
  }
}

// Record a customer-care contact for an account.
export async function POST(request) {
  try {
    const admin = await requireSuperadmin();
    const body = await readJson(request);

    const account_id = Number(body.account_id);
    const name = String(body.name || '').trim();
    if (!Number.isInteger(account_id) || account_id <= 0) {
      throw new HttpError(400, 'account_id is required');
    }
    if (!name) throw new HttpError(400, 'name is required');

    const account = await getAccount(account_id);
    if (!account) throw new HttpError(404, 'Account not found');

    const email = String(body.email || '').trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, 'email must be a valid address');
    }

    const id = await createCareContact({
      account_id,
      name,
      role: String(body.role || '').trim() || null,
      email,
      phone: String(body.phone || '').trim() || null,
      notes: String(body.notes || '').trim() || null,
      reach_out: body.reach_out === true,
      created_by: admin.id,
    });
    await audit('admin.care_contact_created', {
      entity_type: 'customer_care_contact',
      entity_id: id,
      admin_user_id: admin.id,
      account_id,
      metadata: { name, email, reach_out: body.reach_out === true },
    });
    const contact = await listCareContacts();
    return jsonOk({ contact: contact.find((c) => c.id === id) || { id } }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}