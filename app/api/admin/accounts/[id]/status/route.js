import { requireSuperadmin, HttpError, handleRouteError, jsonOk, readJson } from '@/lib/api-helpers';
import { getAccount, updateAccount } from '@/lib/repositories/accounts';
import { destroySessionsForAccount } from '@/lib/auth';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Suspend / reactivate an account. Only 'active' and 'suspended' are legal
// (matches chk_accounts_status). Gated at the API layer by requireSuperadmin().
export async function POST(request, { params }) {
  try {
    const user = await requireSuperadmin();
    const { id } = await params;
    const accountId = Number(id);
    const account = await getAccount(accountId);
    if (!account) throw new HttpError(404, 'Account not found');

    const body = await readJson(request);
    const status = body.status;
    if (status !== 'active' && status !== 'suspended') {
      throw new HttpError(400, 'status must be active or suspended');
    }
    if (status === account.status) return jsonOk({ id: accountId, status });

    await updateAccount(accountId, { status });
    // Suspension must be immediate: drop every tenant session belonging to the
    // account so a suspended workspace can't keep operating through saved cookies.
    if (status === 'suspended') await destroySessionsForAccount(accountId);
    await audit(status === 'suspended' ? 'admin.account_suspended' : 'admin.account_reactivated', {
      entity_type: 'account',
      entity_id: accountId,
      admin_user_id: user.id,
      account_id: accountId,
      metadata: { name: account.name },
    });
    return jsonOk({ id: accountId, status });
  } catch (err) {
    return handleRouteError(err);
  }
}