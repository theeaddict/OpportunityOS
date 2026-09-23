import { requireSuperadmin, HttpError, handleRouteError, jsonOk, readJson } from '@/lib/api-helpers';
import { getAccount, updateAccount, listPlans } from '@/lib/repositories/accounts';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Move an account between billing plans (internal / free / pro). The plan
// must already exist in billing_plans — the control room never creates plans,
// it only assigns them. Superadmin-gated like every /api/admin route.
export async function PATCH(request, { params }) {
  try {
    const user = await requireSuperadmin();
    const { id } = await params;
    const accountId = Number(id);
    const account = await getAccount(accountId);
    if (!account) throw new HttpError(404, 'Account not found');

    const body = await readJson(request);
    const plan_code = String(body.plan_code || '').trim();
    if (!plan_code) throw new HttpError(400, 'plan_code is required');

    const plans = await listPlans();
    if (!plans.some((p) => p.code === plan_code)) {
      throw new HttpError(400, `Unknown plan: ${plan_code}`);
    }
    if (plan_code === account.plan_code) return jsonOk({ id: accountId, plan_code });

    await updateAccount(accountId, { plan_code });
    await audit('admin.account_plan_changed', {
      entity_type: 'account',
      entity_id: accountId,
      admin_user_id: user.id,
      account_id: accountId,
      metadata: { name: account.name, from: account.plan_code, to: plan_code },
    });
    return jsonOk({ id: accountId, plan_code });
  } catch (err) {
    return handleRouteError(err);
  }
}