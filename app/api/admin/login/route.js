import {
  adminLogin, createAdminSession, adminThrottleStatus, adminRecordFailedLogin, adminResetThrottle,
} from '@/lib/admin-auth';
import { audit } from '@/lib/audit';
import { handleRouteError, readJson, HttpError } from '@/lib/api-helpers';
import { enforce, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Admin login — SEPARATE from /api/auth/login (tenant users). Issues the
// oos_admin_session + oos_admin_csrf cookie pair against admin_users; a
// tenant login can never produce an admin session and vice versa.
export async function POST(request) {
  let email = '';
  const ip = clientIp(request);
  try {
    enforce(request, { limit: 10, windowMs: 15 * 60_000, key: 'admin-login' });
    const body = await readJson(request);
    email = String(body.email || '').trim().toLowerCase();
    if (!email || !body.password) throw new HttpError(400, 'Email and password are required');

    // Per-identifier lockout (tenant-parity): checked before any scrypt work so
    // a locked admin account burns no CPU and responds 429. The per-IP enforce()
    // above is an extra layer, not a replacement.
    const status = adminThrottleStatus(email, ip);
    if (status.locked) {
      const err = new HttpError(429, 'Too many login attempts. Try again in 15 minutes.');
      err.retryAfterMs = status.remainingMs;
      return handleRouteError(err);
    }

    const admin = await adminLogin(email, String(body.password || ''), { code: body.code });
    adminResetThrottle(email, ip);
    await createAdminSession(admin.id);
    await audit('admin.login', { entity_type: 'admin', entity_id: admin.id });
    return Response.json({ ok: true });
  } catch (err) {
    if (err.code === '2FA_REQUIRED') {
      return Response.json({ ok: false, error: err.message, code: 'two_factor_required' }, { status: 401 });
    }
    if (err.code === '2FA_INVALID') {
      if (email) adminRecordFailedLogin(email, ip);
      return Response.json({ ok: false, error: err.message, code: 'two_factor_invalid' }, { status: 401 });
    }
    if (/Invalid admin email or password/.test(err.message)) {
      if (email) adminRecordFailedLogin(email, ip);
      return Response.json({ ok: false, error: err.message }, { status: 401 });
    }
    if (err instanceof HttpError && err.status === 429) return handleRouteError(err);
    return handleRouteError(err);
  }
}