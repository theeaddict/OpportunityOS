import { requireSuperadmin } from '@/lib/api-helpers';
import AuditClient from '@/components/AuditClient';

export const dynamic = 'force-dynamic';

// STAGE 6 — audit log. Server gate on top of the layout's forbidden() check;
// entries are read fresh via the superadmin API.
export default async function AdminAuditPage() {
  await requireSuperadmin();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit log</h1>
        <p className="mt-1 text-sm text-gray-600">
          Append-only trail of actions across the platform — logins, runs, admin changes and everything in
          between, newest first.
        </p>
      </div>
      <AuditClient />
    </div>
  );
}