import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/admin-auth';
import AdminLoginForm from '@/components/AdminLoginForm';

export const dynamic = 'force-dynamic';

// Dedicated admin sign-in — the only page under /admin reachable without an
// oos_admin_session. Distinct from the tenant /login (users table): this flow
// authenticates against admin_users and issues the separate admin cookie pair.
export default async function AdminLoginPage() {
  const admin = await getCurrentAdmin().catch(() => null);
  if (admin) redirect('/admin');
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="text-center text-2xl font-bold tracking-tight">
          <span className="text-red-700">Opportunity</span>OS{' '}
          <span className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white">
            Control room
          </span>
        </p>
        <p className="mt-1 text-center text-sm text-gray-500">Whole-system administrator sign-in</p>
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <AdminLoginForm />
        </div>
      </div>
    </div>
  );
}