import { requireSuperadmin, handleRouteError, jsonOk } from '@/lib/api-helpers';
import { usageOverview } from '@/lib/admin/usage-report';

export const dynamic = 'force-dynamic';

// Platform-wide usage vs plan limits for the superadmin control room (STAGE 5).
// System-wide read across every tenant — gated here like every /api/admin route.
// Read-only, no audit row (mirrors the read paths on accounts/system/scoring).
export async function GET() {
  try {
    await requireSuperadmin();
    const usage = await usageOverview();
    return jsonOk({ usage });
  } catch (err) {
    return handleRouteError(err);
  }
}