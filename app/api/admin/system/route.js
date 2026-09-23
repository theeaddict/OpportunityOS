import { requireSuperadmin, handleRouteError, jsonOk } from '@/lib/api-helpers';
import { systemHealth } from '@/lib/admin/system-health';

export const dynamic = 'force-dynamic';

// System health for the superadmin control room (STAGE 3). System-wide read
// across the platform — gated here at the API layer like every /api/admin route.
export async function GET() {
  try {
    await requireSuperadmin();
    const health = await systemHealth();
    return jsonOk({ health });
  } catch (err) {
    return handleRouteError(err);
  }
}