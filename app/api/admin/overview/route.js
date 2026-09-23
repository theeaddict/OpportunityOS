import { requireSuperadmin } from '@/lib/api-helpers';
import { handleRouteError, jsonOk } from '@/lib/api-helpers';
import { listAccounts } from '@/lib/repositories/accounts';

// System-wide overview for the superadmin control room. NOT scoped to any
// account_id — listAccounts() reads every tenant. Access enforced here at the
// API layer (403 for any signed-in non-superadmin, 401 unsigned), so even a
// client hitting the endpoint directly can't bypass the page gate.
export async function GET() {
  try {
    const user = await requireSuperadmin();
    const accounts = await listAccounts();
    return jsonOk({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        is_superadmin: user.is_superadmin,
      },
      system: {
        accounts: accounts.length,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}