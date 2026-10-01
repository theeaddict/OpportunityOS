import { login, recordFailedLogin, resetLoginThrottle, throttleStatus } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { handleRouteError, readJson, HttpError } from '@/lib/api-helpers';
import { enforce, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  let email = '';
  const ip = clientIp(request);
  try {
    enforce(request, { limit: 10, windowMs: 15 * 60_000, key: 'login' });
    const body = await readJson(request);
    email = String(body.email || '').trim().toLowerCase();

    // Per-identifier lockout (BiasharaOS LoginThrottle parity): checked before
    // any scrypt work so a locked account burns no CPU and responds 429.
    const status = throttleStatus(email, ip);
    if (status.locked) {
      const err = new HttpError(429, 'Too many login attempts. Try again in 15 minutes.');
      err.retryAfterMs = status.remainingMs;
      return handleRouteError(err);
    }

    const userId = await login(email, String(body.password || ''), { code: body.code });
    resetLoginThrottle(email, ip);
    await audit('user.login', { entity_type: 'user', entity_id: userId });
    return Response.json({ ok: true });
  } catch (err) {
    if (err.code === '2FA_REQUIRED') {
      return Response.json({ ok: false, error: err.message, code: 'two_factor_required' }, { status: 401 });
    }
    if (err.code === '2FA_INVALID') {
      if (email) recordFailedLogin(email, ip);
      return Response.json({ ok: false, error: err.message, code: 'two_factor_invalid' }, { status: 401 });
    }
    if (/Invalid email or password/.test(err.message) && email) {
      recordFailedLogin(email, ip);
      return Response.json({ ok: false, error: err.message }, { status: 401 });
    }
    return handleRouteError(err);
  }
}