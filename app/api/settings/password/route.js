import * as usersRepo from '@/lib/repositories/users';
import { requireAccount, jsonOk, HttpError, handleRouteError, readJson } from '@/lib/api-helpers';
import { hashPassword, verifyPasswordCredential } from '@/lib/auth';
import { passwordPolicyError, isNonEmptyString } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { enforce } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Change the signed-in user's own password. Requires the current password so
// a leaked session cookie alone can't rotate credentials.
export async function PATCH(request) {
  let email = '';
  try {
    enforce(request, { limit: 10, windowMs: 15 * 60_000, key: 'password-change' });
    const user = await requireAccount();
    email = String(user.email || '').toLowerCase();

    const body = await readJson(request);
    const currentPassword = String(body.current_password || '');
    const newPassword = String(body.new_password || '');

    if (!isNonEmptyString(currentPassword, 200)) {
      return Response.json({ ok: false, error: 'Current password required' }, { status: 400 });
    }
    const pwProblem = passwordPolicyError(newPassword);
    if (pwProblem) return Response.json({ ok: false, error: pwProblem }, { status: 400 });
    if (newPassword === currentPassword) {
      return Response.json({ ok: false, error: 'New password must be different from the current password' }, { status: 400 });
    }

    const verified = await verifyPasswordCredential(email, currentPassword);
    if (!verified) throw new HttpError(400, 'Current password is incorrect');

    await usersRepo.updatePassword(user.id, hashPassword(newPassword));
    await audit('user.password_changed', { entity_type: 'user', entity_id: user.id });
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}