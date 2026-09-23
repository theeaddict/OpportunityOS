import { requireAccount, requireRole, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { getScoreThresholds, setScoreThresholds } from '@/lib/repositories/settings';

export async function GET(request) {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin');
    return jsonOk({ score_thresholds: await getScoreThresholds(user.account_id) });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request) {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin');
    const body = await readJson(request);
    const score_thresholds = await setScoreThresholds(user.account_id, body.score_thresholds || {}, user.id);
    return jsonOk({ score_thresholds });
  } catch (err) {
    return handleRouteError(err);
  }
}
