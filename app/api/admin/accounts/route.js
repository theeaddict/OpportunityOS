import { requireSuperadmin, handleRouteError, jsonOk } from '@/lib/api-helpers';
import { listAccountsWithUsage } from '@/lib/accounts/admin-reports';

export const dynamic = 'force-dynamic';

// System-wide account list for the control room (STAGE 2). Reads across every
// tenant and is gated at the API layer — requireSuperadmin() (401 unsigned,
// 403 for any non-superadmin), independent of the page-level gate.
export async function GET() {
  try {
    await requireSuperadmin();
    const { accounts, plans } = await listAccountsWithUsage();
    return jsonOk({ accounts, plans });
  } catch (err) {
    return handleRouteError(err);
  }
}