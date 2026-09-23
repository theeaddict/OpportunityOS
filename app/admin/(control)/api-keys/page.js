import { requireSuperadmin } from '@/lib/api-helpers';
import ApiKeysClient from '@/components/ApiKeysClient';

export const dynamic = 'force-dynamic';

// STAGE 10 — API keys. Server gate on top of the /admin/* layout; keys are
// issued/revoked from the client via the superadmin API. The full secret shows
// only once.
export default async function AdminApiKeysPage() {
  await requireSuperadmin();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">API keys</h1>
        <p className="mt-1 text-sm text-gray-600">
          Platform-issued credentials that let a tenant account push data into the system
          (e.g. the leads webhook) without a browser session. The secret is shown once at issuance.
        </p>
      </div>
      <ApiKeysClient />
    </div>
  );
}