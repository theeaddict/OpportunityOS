import { requireSuperadmin } from '@/lib/api-helpers';
import BillingPlansClient from '@/components/BillingPlansClient';

export const dynamic = 'force-dynamic';

// STAGE 9 — billing plans. Server gate on top of the /admin/* layout; the
// plans themselves are managed from the client via the superadmin API.
export default async function AdminPlansPage() {
  await requireSuperadmin();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing plans</h1>
        <p className="mt-1 text-sm text-gray-600">
          Every usage tier the platform offers — limits, price, and visibility. Accounts are moved between these
          tiers from the Accounts page; changes here apply to every account on the plan.
        </p>
      </div>
      <BillingPlansClient />
    </div>
  );
}