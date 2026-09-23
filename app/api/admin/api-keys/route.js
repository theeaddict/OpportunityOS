import { requireSuperadmin, HttpError, handleRouteError, jsonOk, readJson } from '@/lib/api-helpers';
import { listApiKeys, createApiKey } from '@/lib/accounts/api-keys';
import { getAccount } from '@/lib/repositories/accounts';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// List every API key issued by the platform (any account) for the control room.
export async function GET() {
  try {
    await requireSuperadmin();
    const keys = await listApiKeys();
    return jsonOk({ keys });
  } catch (err) {
    return handleRouteError(err);
  }
}

// Issue a new API key for a tenant account. The full secret is returned exactly
// once — the admin must copy it immediately (only a hash is stored).
export async function POST(request) {
  try {
    const admin = await requireSuperadmin();
    const body = await readJson(request);

    const account_id = Number(body.account_id);
    const name = String(body.name || '').trim();
    if (!Number.isInteger(account_id) || account_id <= 0) {
      throw new HttpError(400, 'account_id is required');
    }
    if (!name) throw new HttpError(400, 'name is required');

    const account = await getAccount(account_id);
    if (!account) throw new HttpError(404, 'Account not found');

    const rate_limit_hour =
      body.rate_limit_hour == null || body.rate_limit_hour === ''
        ? null
        : Number(body.rate_limit_hour);
    if (rate_limit_hour != null && (!Number.isInteger(rate_limit_hour) || rate_limit_hour <= 0)) {
      throw new HttpError(400, 'rate_limit_hour must be a positive integer or blank');
    }

    const created = await createApiKey({ account_id, name, rate_limit_hour, created_by: admin.id });
    await audit('admin.api_key_issued', {
      entity_type: 'api_key',
      entity_id: created.id,
      admin_user_id: admin.id,
      account_id,
      metadata: { name, account: account.name, prefix: created.full_key.slice(0, 20) },
    });
    return jsonOk({ key: created }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}