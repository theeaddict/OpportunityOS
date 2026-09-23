import { requireSuperadmin } from '@/lib/api-helpers';
import UsageClient from '@/components/UsageClient';

export const dynamic = 'force-dynamic';

// STAGE 5 — usage & cost. Server gate on top of the layout's forbidden()
// check; all values are read fresh via the superadmin API.
export default async function AdminUsagePage() {
  await requireSuperadmin();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Usage &amp; cost</h1>
        <p className="mt-1 text-sm text-gray-600">
          Current-period usage across every workspace against each plan&apos;s limits. Billing is not
          wired up yet — these counters and limits exist so usage can be surfaced and enforced.
        </p>
      </div>
      <UsageClient />
    </div>
  );
}