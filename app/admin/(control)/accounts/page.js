import { requireSuperadmin } from '@/lib/api-helpers';
import AccountsClient from '@/components/AccountsClient';

export const dynamic = 'force-dynamic';

// STAGE 2 — accounts. The /admin/* layout already gates is_superadmin with
// forbidden(); re-checking here (and again on every API call) keeps access
// control at the server layer rather than relying on the shell being hidden.
export default async function AdminAccountsPage() {
  await requireSuperadmin();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        <p className="mt-1 text-sm text-gray-600">
          Every tenant workspace on the platform — plan, status, members, and this month&apos;s usage against plan limits.
          Suspend/reactivate and plan changes are superadmin-only and audited.
        </p>
      </div>
      <AccountsClient />
    </div>
  );
}