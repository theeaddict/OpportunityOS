import { redirect } from 'next/navigation';
import { forbidden } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import AdminShell from '@/components/AdminShell';

export const dynamic = 'force-dynamic';

// Server-side gate for the whole /admin/* route group. Renders a 403 page
// for any signed-in user without the superadmin flag and redirects guests
// to login. Backs up the API-layer enforcement (every /admin/api route also
// calls requireSuperadmin()) so the control room is never just "hidden UI".
export default async function AdminLayout({ children }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');
  if (!user.is_superadmin) forbidden();
  return <AdminShell user={user}>{children}</AdminShell>;
}