import { redirect } from 'next/navigation';
import { forbidden } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/admin-auth';
import AdminShell from '@/components/AdminShell';

export const dynamic = 'force-dynamic';

// Server-side gate for the whole /admin/* route group, backed by the SEPARATE
// administrator identity (admin_users + oos_admin_session) — never the tenant
// users table. Renders a 403 page for a signed-in admin whose account is
// disabled and redirects everyone else to the dedicated /admin/login. Backs up
// the API-layer enforcement (every /api/admin route also calls
// requireSuperadmin()) so the control room is never just "hidden UI".
export default async function AdminLayout({ children }) {
  const admin = await getCurrentAdmin().catch(() => null);
  if (!admin) redirect('/admin/login');
  if (!admin.is_active) forbidden();
  return <AdminShell admin={admin}>{children}</AdminShell>;
}