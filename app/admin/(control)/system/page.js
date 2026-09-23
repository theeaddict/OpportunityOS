import { requireSuperadmin } from '@/lib/api-helpers';
import SystemHealthClient from '@/components/SystemHealthClient';

export const dynamic = 'force-dynamic';

// STAGE 3 — system health. Server gate on top of the layout's forbidden()
// check; every value is read fresh at render/request time via the superadmin
// API so the control room always reflects the live platform state.
export default async function AdminSystemPage() {
  await requireSuperadmin();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">System health</h1>
        <p className="mt-1 text-sm text-gray-600">
          Live platform status: database, background worker, job queue, and connected providers.
        </p>
      </div>
      <SystemHealthClient />
    </div>
  );
}