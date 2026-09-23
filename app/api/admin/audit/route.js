import { requireSuperadmin, handleRouteError, jsonOk } from '@/lib/api-helpers';
import { auditOverview } from '@/lib/admin/audit-report';

export const dynamic = 'force-dynamic';

function param(searchParams, key) {
  const v = searchParams.get(key);
  return v == null || v === '' ? null : v;
}

// Append-only audit trail for the superadmin control room (STAGE 6).
// System-wide read — gated here like every /api/admin route. Read-only.
export async function GET(request) {
  try {
    await requireSuperadmin();
    const { searchParams } = new URL(request.url);
    const overview = await auditOverview({
      action: param(searchParams, 'action'),
      entity_type: param(searchParams, 'entity_type'),
      limit: Number(param(searchParams, 'limit') || 200),
    });
    return jsonOk({ audit: overview });
  } catch (err) {
    return handleRouteError(err);
  }
}