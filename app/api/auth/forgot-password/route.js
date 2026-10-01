import * as usersRepo from '@/lib/repositories/users';
import { sendPasswordResetEmail } from '@/lib/auth-emails';
import { audit } from '@/lib/audit';
import { handleRouteError, readJson, jsonOk } from '@/lib/api-helpers';
import { enforce, rateLimit } from '@/lib/rate-limit';
import { isEmail } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * Always answers the same way whether or not the address has an account, and
 * does the same amount of visible work (the email is sent in the background),
 * so this endpoint can't be used to find out who is registered.
 */
export async function POST(request) {
  try {
    enforce(request, { limit: 5, windowMs: 60 * 60_000, key: 'forgot-password' });
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    const generic = jsonOk({ message: 'If that email has an account, a reset link is on its way.' });
    if (!isEmail(email)) return generic;

    // Per-address cap so nobody can use us to flood someone's inbox.
    if (!rateLimit(`forgot-password:email:${email}`, { limit: 3, windowMs: 60 * 60_000 }).ok) return generic;

    const user = await usersRepo.findByEmail(email);
    if (user) {
      sendPasswordResetEmail(user).catch(() => {});
      await audit('user.password_reset_requested', { entity_type: 'user', entity_id: user.id, user_id: user.id, account_id: user.account_id }).catch(() => {});
    }
    return generic;
  } catch (err) {
    return handleRouteError(err);
  }
}
