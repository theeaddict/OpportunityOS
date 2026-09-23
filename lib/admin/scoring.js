/**
 * Scoring configuration for the superadmin control room (STAGE 4).
 *
 * Distinction between the two layers:
 *   - accounts save their OWN thresholds in app_settings (workspace operators
 *     already do this via /api/settings/score-thresholds);
 *   - the control room edits the PLATFORM defaults (platform_settings), which
 *     is what every account WITHOUT an override inherits. Both are enforced in
 *     lib/services/analysis/scoring.js at scoring time.
 */

import { SCORE_WEIGHTS, SCORE_CATEGORIES } from '@/lib/constants';
import { query } from '@/lib/db';
import { getPlatformScoreThresholds } from '@/lib/repositories/settings';

const J = (s) => (typeof s === 'string' ? JSON.parse(s) : s);

export async function listScoreConfiguration() {
  const [defaults, overrideRows] = await Promise.all([
    getPlatformScoreThresholds(),
    query(
      `SELECT a.id, a.name, s."value"
         FROM app_settings s JOIN accounts a ON a.id = s.account_id
        WHERE s."key" = 'score_thresholds'
        ORDER BY a.id`
    ),
  ]);
  return {
    weights: SCORE_WEIGHTS,
    categories: SCORE_CATEGORIES,
    defaults,
    accounts_overriding: overrideRows.map((r) => ({
      account_id: Number(r.id),
      name: r.name,
      score_thresholds: J(r.value),
    })),
  };
}