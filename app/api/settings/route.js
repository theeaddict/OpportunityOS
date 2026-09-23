import { getSettingsSummary } from '@/lib/repositories/settings';
import * as usersRepo from '@/lib/repositories/users';
import { requireAccount, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { isNonEmptyString } from '@/lib/validation';

export async function GET() {
  try {
    const user = await requireAccount();
    const [summary, twoFactorEnabled] = await Promise.all([
      getSettingsSummary(user.account_id),
      usersRepo.getTwoFactorStatus(user.id),
    ]);
    return jsonOk({ ...summary, two_factor_enabled: twoFactorEnabled, user });
  } catch (err) {
    return handleRouteError(err);
  }
}

// Update the signed-in user's profile.
export async function PATCH(request) {
  try {
    const user = await requireAccount();
    const body = await readJson(request);
    if (!isNonEmptyString(body.name, 120)) return Response.json({ ok: false, error: 'Name required' }, { status: 400 });
    await usersRepo.updateProfile(user.id, {
      name: body.name.trim(),
    });
    return jsonOk({ id: user.id });
  } catch (err) {
    return handleRouteError(err);
  }
}
