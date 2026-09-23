import { requireSuperadmin, HttpError, handleRouteError, jsonOk } from '@/lib/api-helpers';
import { getAccountDetail } from '@/lib/accounts/admin-reports';

export const dynamic = 'force-dynamic';

// Control-room detail for one account: profile + member list + plan limits +
// current usage. Superadmin-gated like every /api/admin route.
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