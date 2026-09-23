import { requireAccount, requireRole, HttpError, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { isAtLeast } from '@/lib/accounts/roles';
import * as accountsRepo from '@/lib/repositories/accounts';
import * as usersRepo from '@/lib/repositories/users';
import { getUsage, getAccountLimits } from '@/lib/accounts/usage';
import { isEmail, isNonEmptyString, passwordPolicyError } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireAccount();
    const [usage, limits, team] = await Promise.all([
      getUsage(user.account_id),
      getAccountLimits(user.account_id),
      accountsRepo.listUsers(user.account_id),
    ]);
    return jsonOk({
      user,
      usage,
      plan: limits.plan,
      plan_name: limits.plan_name,
      status: limits.status,
      limits: limits.limits,
      team,
      canManage: isAtLeast(user, 'admin'),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

// Create a team member (OWNER/ADMIN only). Members cannot create users.
export async function POST(request) {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin');
    const body = await readJson(request);

    const name = String(body.name || '').trim();
    if (!isNonEmptyString(name, 120)) return Response.json({ ok: false, error: 'Name required' }, { status: 400 });
    if (!isEmail(body.email)) return Response.json({ ok: false, error: 'Valid email required' }, { status: 400 });
    const email = body.email.trim().toLowerCase();
    const password = String(body.password || '');
    if (!isNonEmptyString(password, 200)) {
      return Response.json({ ok: false, error: 'Password required' }, { status: 400 });
    }
    const pwProblem = passwordPolicyError(password);
    if (pwProblem) return Response.json({ ok: false, error: pwProblem }, { status: 400 });

    const existing = await usersRepo.findByEmail(email);
    if (existing) return Response.json({ ok: false, error: 'A user with this email already exists' }, { status: 409 });

    const { limits } = await getAccountLimits(user.account_id);
    if (limits.users != null) {
      const n = await accountsRepo.countUsers(user.account_id);
      if (n >= limits.users) {
        throw new HttpError(403, `Plan limit reached for team members (${n}/${limits.users}). Upgrade or remove a member first.`);
      }
    }

    const role = body.role === 'admin' ? 'admin' : 'member';
    const id = await accountsRepo.createUserInAccount({ account_id: user.account_id, name, email, password, role });
    return jsonOk({ id });
  } catch (err) {
    return handleRouteError(err);
  }
}