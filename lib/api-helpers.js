import { getCurrentUser } from '@/lib/auth';
import { getCurrentAdmin } from '@/lib/admin-auth';
import { isAtLeast } from '@/lib/accounts/roles';

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, 'Not signed in');
  if (user.status === 'suspended') throw new HttpError(403, 'Account suspended');
  return user;
}

/**
 * Every tenant-owned resource sits inside an account. Returns the signed-in
 * user with a guaranteed account_id (every SaaS role belongs to an account).
 */
export async function requireAccount() {
  const user = await requireUser();
  if (!user.account_id) throw new HttpError(403, 'No workspace account found for this user');
  if (user.status === 'suspended') throw new HttpError(403, 'Account suspended');
  return user;
}

/**
 * Role gate: throws 403 unless the user's role level is >= minRole
 * (e.g. requireRole(user, 'admin') allows OWNER and ADMIN, not MEMBER).
 */
export function requireRole(user, minRole = 'user') {
  if (!isAtLeast(user, minRole)) {
    throw new HttpError(403, 'You do not have permission to do this');
  }
  return user;
}

/**
 * Platform-tier gate for the /admin/* control room. Reads the SEPARATE
 * administrator identity (admin_users + oos_admin_session), never the tenant
 * users table — the whole-system admin is no longer a flag on an account
 * member row. Every /admin page AND API route goes through this, so access
 * control is enforced server-side, never just hidden in the UI.
 */
export async function requireSuperadmin() {
  const admin = await getCurrentAdmin();
  if (!admin) throw new HttpError(401, 'Administrator sign-in required');
  if (!admin.is_active) throw new HttpError(403, 'Admin account disabled');
  return admin;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function jsonOk(data, status = 200) {
  return Response.json({ ok: true, ...data }, { status });
}

export function handleRouteError(err) {
  if (err instanceof HttpError) {
    const headers = err.status === 429 && err.retryAfterMs != null
      ? { 'Retry-After': String(Math.ceil(err.retryAfterMs / 1000)) }
      : undefined;
    return Response.json({ ok: false, error: err.message }, { status: err.status, headers });
  }
  // 500s: log the detail server-side; never leak SQL/path internals to clients.
  console.error('[api]', err);
  return Response.json({ ok: false, error: 'Server error' }, { status: 500 });
}

const MAX_BODY_BYTES = 1 << 20; // 1 MB — BiasharaOS MaxBodyBytes parity

export async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  try {
    const length = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new HttpError(413, 'Request body too large');
    }
    const body = await request.text();
    if (body.length > maxBytes) throw new HttpError(413, 'Request body too large');
    try {
      return body ? JSON.parse(body) : {};
    } catch {
      return {};
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    return {};
  }
}
