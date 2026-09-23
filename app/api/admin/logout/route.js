import { destroyAdminSession, getCurrentAdmin } from '@/lib/admin-auth';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Admin logout — clears the oos_admin_session pair (the Tenant /api/auth/logout
// only clears the user's oos_session). Idempotent for an empty admin session.
export async function POST() {
  try {
    const admin = await getCurrentAdmin();
    await destroyAdminSession();
    if (admin) await audit('admin.logout', { entity_type: 'admin', entity_id: admin.id });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: 'Logout failed' }, { status: 500 });
  }
}