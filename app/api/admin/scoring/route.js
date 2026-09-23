import { requireSuperadmin, handleRouteError, jsonOk, readJson } from '@/lib/api-helpers';
import { getPlatformScoreThresholds, setPlatformScoreThresholds } from '@/lib/repositories/settings';
import { listScoreConfiguration } from '@/lib/admin/scoring';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Update the platform scoring defaults that every account without its own
// override inherits. Validated (0-100, monotonic hot≥high≥medium≥low≥reject)
// and audited. Superadmin-gated at the API layer.
// Read the full scoring configuration (weights, categories, platform default
// thresholds, and the accounts overriding them). Superadmin-gated; surfaced
// system-wide. Read-only, no audit row.
export async function GET() {
  try {
    await requireSuperadmin();
    const scoring = await listScoreConfiguration();
    return jsonOk({ scoring });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PUT(request) {
  try {
    const user = await requireSuperadmin();
    const body = await readJson(request);
    const before = await getPlatformScoreThresholds();
    const score_thresholds = await setPlatformScoreThresholds(
      body.thresholds || body.score_thresholds || {},
      user.id
    );
    await audit('admin.scoring_defaults_updated', {
      entity_type: 'platform',
      user_id: user.id,
      account_id: user.account_id ?? null,
      metadata: { from: before, to: score_thresholds },
    });
    return jsonOk({ score_thresholds });
  } catch (err) {
    return handleRouteError(err);
  }
}