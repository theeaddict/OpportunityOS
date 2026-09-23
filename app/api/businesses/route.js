import * as businessesRepo from '@/lib/repositories/businesses';
import { audit } from '@/lib/audit';
import { requireAccount, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { isNonEmptyString, optionalString } from '@/lib/validation';

export async function GET(request) {
  try {
    const user = await requireAccount();
    const q = new URL(request.url).searchParams.get('q') || '';
    return jsonOk({ businesses: await businessesRepo.list({ accountId: user.account_id, q }) });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request) {
  try {
    const user = await requireAccount();
    const body = await readJson(request);
    if (!isNonEmptyString(body.name, 200)) {
      return Response.json({ ok: false, error: 'Business name required' }, { status: 400 });
    }

    // Dedup: normalized name / website / phone.
    const { businessId, created } = await businessesRepo.findOrCreateBusiness(user.account_id, {
      name: body.name.trim(),
      industry: optionalString(body.industry, 120),
      description: optionalString(body.description, 4000),
      location: optionalString(body.location, 160),
      country: optionalString(body.country, 120),
      website: optionalString(body.website, 500),
      phone: optionalString(body.phone, 40),
      data_origin: 'manual',
      created_by: user.id,
    });
    if (created) {
      await businessesRepo.addSource({
        account_id: user.account_id,
        business_id: businessId,
        source_type: 'manual_entry',
        source_name: `Manual entry by ${user.name}`,
        source_url: null,
        external_identifier: null,
      });
    }
    await audit(created ? 'business.created' : 'business.duplicate', {
      entity_type: 'businesses', entity_id: businessId,
      metadata: { name: body.name }, user_id: user.id, account_id: user.account_id,
    });
    return jsonOk({ id: businessId, created }, created ? 201 : 200);
  } catch (err) {
    return handleRouteError(err);
  }
}
