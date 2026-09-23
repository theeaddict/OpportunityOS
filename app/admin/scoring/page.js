import { requireSuperadmin } from '@/lib/api-helpers';
import ScoringClient from '@/components/ScoringClient';

export const dynamic = 'force-dynamic';

// STAGE 4 — scoring thresholds. Server gate on top of the layout's
// forbidden() check; all values are read fresh via the superadmin API.
export default async function AdminScoringPage() {
  await requireSuperadmin();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Scoring thresholds</h1>
        <p className="mt-1 text-sm text-gray-600">
          Platform defaults for the opportunity scoring engine. Workspaces that haven&apos;t set their own
          thresholds inherit these at classification time.
        </p>
      </div>
      <ScoringClient />
    </div>
  );
}