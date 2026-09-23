import { adminLogin, createAdminSession } from '@/lib/admin-auth';
import { audit } from '@/lib/audit';
import { handleRouteError, readJson, HttpError } from '@/lib/api-helpers';
import { enforce } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Admin login — SEPARATE from /api/auth/login (tenant users). Issues the
// oos_admin_session + oos_admin_csrf cookie pair against admin_users; a
// tenant login can never produce an admin session and vice versa.
export async function POST(request) {
  let email = '';
  try {
    enforce(request, { limit: 10, windowMs: 15 * 60_000, key: 'admin-login' });
    const body = await readJson(request);
    email = String(body.email || '').trim().toLowerCase();
    if (!email || !body.password) throw new HttpError(400, 'Email and password are required');

    const admin = await adminLogin(email, String(body.password || ''));
    await createAdminSession(admin.id);
    await audit('admin.login', { entity_type: 'admin', entity_id: admin.id });
    return Response.json({ ok: true });
  } catch (err) {
    if (/Invalid admin email or password|disabled/.test(err.message)) {
      return Response.json({ ok: false, error: err.message }, { status: 401 });
    }
    if (err instanceof HttpError && err.status === 429) return handleRouteError(err);
    return handleRouteError(err);
  }
}