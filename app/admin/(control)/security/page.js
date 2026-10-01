import { getCurrentAdmin, findByEmail } from '@/lib/admin-auth';
import { requireSuperadmin } from '@/lib/api-helpers';
import AdminTwoFactorForm from '@/components/AdminTwoFactorForm';

export const dynamic = 'force-dynamic';

// STAGE 3 — control-room security. Server-side gate mirrors the other admin
// pages (requireSuperadmin on top of the layout's forbidden()); the 2FA
// enrollment state is read live from admin_users and passed to the client form.
export default async function AdminSecurityPage() {
  const admin = await getCurrentAdmin();
  await requireSuperadmin();
  const full = await findByEmail(admin.email).catch(() => null);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Security</h1>
        <p className="mt-1 text-sm text-gray-600">
          Two-factor authentication for the control room. Enroll at least one platform admin so a
          leaked credential alone can&apos;t open a whole-workspace session.
        </p>
      </div>
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <AdminTwoFactorForm enabled={Boolean(full?.otp_enabled)} email={admin.email} />
      </section>
    </div>
  );
}