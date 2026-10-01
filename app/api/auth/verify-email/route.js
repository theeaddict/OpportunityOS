import * as usersRepo from '@/lib/repositories/users';
import { consumeToken } from '@/lib/repositories/auth-tokens';
import { audit } from '@/lib/audit';
import { handleRouteError, readJson, jsonOk, HttpError } from '@/lib/api-helpers';
import { enforce } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    enforce(request, { limit: 20, windowMs: 15 * 60_000, key: 'verify-email' });
    const body = await readJson(request);
    const userId = await consumeToken(body.token, 'email_verify');
    if (!userId) throw new HttpError(400, 'This verification link is invalid or has expired.');
    await usersRepo.markEmailVerified(userId);
    await audit('user.email_verified', { entity_type: 'user', entity_id: userId, user_id: userId }).catch(() => {});
    return jsonOk({ message: 'Email verified.' });
  } catch (err) {
    return handleRouteError(err);
  }
}
