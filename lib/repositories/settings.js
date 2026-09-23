import { query } from '@/lib/db';
import { providerInfo } from '@/lib/ai/provider';
import { listProviders as listDiscoveryProviders } from '@/lib/services/discovery';
import { DEFAULT_SCORE_THRESHOLDS } from '@/lib/constants';
import { HttpError } from '@/lib/api-helpers';

const J = (s) => (typeof s === 'string' ? JSON.parse(s) : s);

const SCORE_THRESHOLD_KEYS = ['hot', 'high', 'medium', 'low', 'reject'];

export async function getSettingsSummary(accountId) {
  return {
    ai: providerInfo(),
    discovery_providers: listDiscoveryProviders(),
    score_thresholds: await getScoreThresholds(accountId),
  };
}

/**
 * Platform-level scoring defaults (superadmin control room). Every account
 * that has NOT saved its own app_settings override inherits these; the static
 * DEFAULT_SCORE_THRESHOLDS remain the built-in floor beneath them.
 */
export async function getPlatformScoreThresholds() {
  const rows = await query(
    `SELECT "value" FROM platform_settings WHERE "key" = 'score_thresholds' LIMIT 1`
  );
  const stored = rows[0] ? J(rows[0].value) : null;
  return { ...DEFAULT_SCORE_THRESHOLDS, ...(stored || {}) };
}

/**
 * Persist the platform scoring defaults. Values are clamped to 0-100 and must
 * stay monotonic (hot ≥ high ≥ medium ≥ low ≥ reject) so classifyScore keeps
 * mapping a score to the right bucket — a non-monotonic set is rejected rather
 * than stored. Only the superadmin control room calls this.
 */
export async function setPlatformScoreThresholds(next, userId = null) {
  const clean = {};
  for (const k of SCORE_THRESHOLD_KEYS) {
    const v = next[k];
    if (v === undefined || v === '' || v == null) continue;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new HttpError(400, `${k} must be a number between 0 and 100`);
    }
    clean[k] = n;
  }
  const stored = await getPlatformScoreThresholds();
  const merged = { ...stored, ...clean };
  for (let i = 0; i < SCORE_THRESHOLD_KEYS.length - 1; i++) {
    if (merged[SCORE_THRESHOLD_KEYS[i]] < merged[SCORE_THRESHOLD_KEYS[i + 1]]) {
      throw new HttpError(
        400,
        `Thresholds must be ordered hot ≥ high ≥ medium ≥ low ≥ reject (${SCORE_THRESHOLD_KEYS[i]} = ${merged[SCORE_THRESHOLD_KEYS[i]]} < ${SCORE_THRESHOLD_KEYS[i + 1]} = ${merged[SCORE_THRESHOLD_KEYS[i + 1]]})`
      );
    }
  }
  await query(
    `INSERT INTO platform_settings ("key", "value", updated_by)
     VALUES ('score_thresholds', ?, ?)
     ON CONFLICT ("key") DO UPDATE
       SET "value" = EXCLUDED."value", updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(merged), Number(userId) || null]
  );
  return getPlatformScoreThresholds();
}

/**
 * Read the configurable opportunity-score category thresholds for a workspace.
 * Resolution chain: account override → platform defaults → built-in constants.
 */
export async function getScoreThresholds(accountId) {
  const rows = await query(
    "SELECT `value` FROM app_settings WHERE account_id = ? AND `key` = 'score_thresholds' LIMIT 1",
    [Number(accountId)]
  );
  const stored = rows[0] ? J(rows[0].value) : null;
  const platform = await getPlatformScoreThresholds();
  return { ...platform, ...(stored || {}) };
}

/** Persist the configurable opportunity-score category thresholds for a workspace. */
export async function setScoreThresholds(accountId, next, userId = null) {
  const clean = {};
  for (const k of ['hot', 'high', 'medium', 'low', 'reject']) {
    if (next[k] !== undefined && next[k] !== '' && next[k] != null) {
      clean[k] = Math.min(100, Math.max(0, Math.round(Number(next[k]))));
    }
  }
  await query(
    `INSERT INTO app_settings (account_id, \`key\`, \`value\`, updated_by)
     VALUES (?, 'score_thresholds', ?, ?)
     ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_by = VALUES(updated_by)`,
    [Number(accountId), JSON.stringify({ ...DEFAULT_SCORE_THRESHOLDS, ...clean }), Number(userId) || null]
  );
  return getScoreThresholds(accountId);
}