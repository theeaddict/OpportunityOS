import { requireUser, handleRouteError, jsonOk, HttpError } from '@/lib/api-helpers';
import { sendVerificationEmail } from '@/lib/auth-emails';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const user = await requireUser({ allowUnverified: true });
    if (user.email_verified_at) return jsonOk({ already_verified: true });
    if (!rateLimit(`resend-verification:${user.id}`, { limit: 3, windowMs: 60 * 60_000 }).ok) {
      throw new HttpError(429, 'Too many requests — try again in an hour.');
    }
    sendVerificationEmail(user).catch(() => {});
    return jsonOk({ message: 'Verification email sent.' });
  } catch (err) {
    return handleRouteError(err);
  }
}
