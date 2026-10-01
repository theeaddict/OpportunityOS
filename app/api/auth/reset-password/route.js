import * as usersRepo from '@/lib/repositories/users';
import { consumeToken } from '@/lib/repositories/auth-tokens';
import { hashPassword, destroyAllSessionsForUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { handleRouteError, readJson, jsonOk, HttpError } from '@/lib/api-helpers';
import { enforce } from '@/lib/rate-limit';
import { passwordPolicyError } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    enforce(request, { limit: 10, windowMs: 15 * 60_000, key: 'reset-password' });
    const body = await readJson(request);
    const problem = passwordPolicyError(body.password);
    if (problem) throw new HttpError(400, problem);

    const userId = await consumeToken(body.token, 'password_reset');
    if (!userId) throw new HttpError(400, 'This reset link is invalid or has expired. Request a new one.');

    await usersRepo.updatePassword(userId, hashPassword(body.password));
    // Following the emailed link proves control of the inbox.
    await usersRepo.markEmailVerified(userId);
    // Anyone holding an old session (including whoever knew the old password) is signed out.
    await destroyAllSessionsForUser(userId);
    await audit('user.password_reset', { entity_type: 'user', entity_id: userId, user_id: userId }).catch(() => {});
    return jsonOk({ message: 'Password updated. You can sign in now.' });
  } catch (err) {
    return handleRouteError(err);
  }
}
