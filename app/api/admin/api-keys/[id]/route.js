import { requireSuperadmin, HttpError, handleRouteError, jsonOk } from '@/lib/api-helpers';
import { getApiKey, revokeApiKey } from '@/lib/accounts/api-keys';
import { getAccount } from '@/lib/repositories/accounts';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Revoke a single API key (matches the "API keys" control-room row action).
export async function POST(request, { params }) {
  try {
    const admin = await requireSuperadmin();
    const { id } = await params;
    const key = await getApiKey(id);
    if (!key) throw new HttpError(404, 'API key not found');
    if (key.status !== 'active') return jsonOk({ id: key.id, status: key.status });

    await revokeApiKey(key.id);
    const account = await getAccount(key.account_id).catch(() => null);
    await audit('admin.api_key_revoked', {
      entity_type: 'api_key',
      entity_id: key.id,
      admin_user_id: admin.id,
      account_id: key.account_id,
      metadata: { name: key.name, account: account?.name || key.account_id },
    });
    return jsonOk({ id: key.id, status: 'revoked' });
  } catch (err) {
    return handleRouteError(err);
  }
}