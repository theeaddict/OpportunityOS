import { requireSuperadmin } from '@/lib/api-helpers';
import CustomerCareClient from '@/components/CustomerCareClient';

export const dynamic = 'force-dynamic';

// STAGE 10 — customer-care contacts. Server gate on top of the /admin/* layout;
// contacts are recorded/updated/deleted from the client via the superadmin API.
export default async function AdminCustomerCarePage() {
  await requireSuperadmin();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Customer care</h1>
        <p className="mt-1 text-sm text-gray-600">
          Platform-level records of who to reach for each tenant account — owners, billing contacts, or handoff
          notes. Flag a contact with <span className="font-medium">reach out</span> to keep it on top of the list.
        </p>
      </div>
      <CustomerCareClient />
    </div>
  );
}