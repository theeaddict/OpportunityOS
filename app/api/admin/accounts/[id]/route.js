import { requireSuperadmin, HttpError, handleRouteError, jsonOk, readJson } from '@/lib/api-helpers';
import { getAccountDetail } from '@/lib/accounts/admin-reports';
import { purgeAccount } from '@/lib/accounts/purge';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Control-room detail for one account: profile + member list + plan limits +
// current usage. Admin-gated like every /api/admin route.
export async function GET(request, { params }) {
  try {
    await requireSuperadmin();
    const { id } = await params;
    const detail = await getAccountDetail(Number(id));
    if (!detail) throw new HttpError(404, 'Account not found');
    return jsonOk(detail);
  } catch (err) {
    return handleRouteError(err);
  }
}

// Permanent deletion of a workspace. All account-scoped data is purged inside a
// transaction; the audit trail is kept. Only reachable by the platform admin.
export async function DELETE(request, { params }) {
  try {
    const admin = await requireSuperadmin();
    const { id } = await params;
    const accountId = Number(id);

    const body = await readJson(request);
    if (!body?.confirm) throw new HttpError(400, 'confirm: true is required');
    if (body.confirm !== true) throw new HttpError(400, 'confirm must be true');

    const purged = await purgeAccount(accountId);
    if (!purged) throw new HttpError(404, 'Account not found');

    await audit('admin.account_deleted', {
      entity_type: 'account',
      entity_id: accountId,
      admin_user_id: admin.id,
      account_id: accountId,
      metadata: {
        name: purged.name,
        member_count: purged.member_count,
      },
    });
    return jsonOk(purged);
  } catch (err) {
    return handleRouteError(err);
  }
}