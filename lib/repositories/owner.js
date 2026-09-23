import { query, insert } from '@/lib/db';
import { OWNER_GOAL_KEYS } from '@/lib/owner/goals.js';
import { parseJson } from '@/lib/db';

/** Business Owner Mode profile persistence. */

const JSON_ARRAY = (v) => {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  try {
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

function parseJsonObj(v, fallback = null) {
  try {
    if (v == null || v === '') return fallback;
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch {
    return fallback;
  }
}

function rowToProfile(row) {
  if (!row) return null;
  const strategy = parseJsonObj(row.strategy, null);
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    business_name: row.business_name || '',
    sell_what: row.sell_what || '',
    location: row.location || '',
    ideal_customers: row.ideal_customers || '',
    goals: JSON_ARRAY(row.goals),
    strategy,
    updated_at: row.updated_at,
  };
}

export async function getOwnerProfile(userId) {
  const rows = await query(
    'SELECT * FROM owner_profiles WHERE user_id = ? LIMIT 1',
    [Number(userId)]
  );
  return rowToProfile(rows[0]);
}

/**
 * Save the owner's answers (upsert by user). `strategyFilters` may be passed in
 * pre-rebuilt; if omitted the stored strategy is kept as-is.
 */
export async function saveOwnerProfile(userId, data = {}) {
  const goals = (Array.isArray(data.goals) ? data.goals : [])
    .filter((g) => OWNER_GOAL_KEYS.includes(g))
    .slice(0, OWNER_GOAL_KEYS.length);
  const profile = {
    business_name: String(data.business_name || '').trim().slice(0, 200) || 'My business',
    sell_what: String(data.sell_what || '').trim().slice(0, 500),
    location: String(data.location || '').trim().slice(0, 200),
    ideal_customers: String(data.ideal_customers || '').trim().slice(0, 2000),
    goals,
  };
  let strategy = parseJsonObj(data.strategy, null);
  if (!strategy) {
    const { buildStrategy } = await import('@/lib/owner/strategy.js');
    strategy = buildStrategy(profile).strategy;
  }

  const insertSql = `INSERT INTO owner_profiles
      (user_id, business_name, sell_what, location, ideal_customers, goals, strategy)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       business_name = VALUES(business_name), sell_what = VALUES(sell_what),
       location = VALUES(location), ideal_customers = VALUES(ideal_customers),
       goals = VALUES(goals), strategy = VALUES(strategy)`;

  await query(insertSql, [
    Number(userId),
    profile.business_name,
    profile.sell_what,
    profile.location,
    profile.ideal_customers,
    JSON.stringify(profile.goals),
    JSON.stringify(strategy),
  ]);
  return getOwnerProfile(userId);
}

/** The owner's own runs (type DISCOVERY started from Owner Mode). */
export async function ownerJobs(userId, limit = 8) {
  const rows = await query(
    `SELECT id, type, status, attempts, max_attempts, result, progress, stage,
            error, created_at, completed_at
       FROM background_jobs
      WHERE created_by = ? AND type = 'DISCOVERY'
        AND JSON_EXTRACT(payload, '$.owner_run') = 1
      ORDER BY id DESC LIMIT ?`,
    [Number(userId), Math.max(1, Math.floor(Number(limit) || 8))]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    type: r.type,
    status: r.status,
    attempts: Number(r.attempts),
    max_attempts: Number(r.max_attempts),
    result: parseJson(r.result, null),
    progress: Number(r.progress || 0),
    stage: r.stage,
    error: r.error,
    created_at: r.created_at,
    completed_at: r.completed_at,
  }));
}

export async function ownerJobById(userId, jobId) {
  const rows = await query(
    `SELECT id, type, status, attempts, max_attempts, payload, result, progress, stage,
            error, created_at, completed_at
       FROM background_jobs
      WHERE id = ? AND created_by = ? AND JSON_EXTRACT(payload, '$.owner_run') = 1
      LIMIT 1`,
    [Number(jobId), Number(userId)]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    type: r.type,
    status: r.status,
    attempts: Number(r.attempts),
    max_attempts: Number(r.max_attempts),
    payload: parseJson(r.payload, {}),
    result: parseJson(r.result, null),
    progress: Number(r.progress || 0),
    stage: r.stage,
    error: r.error,
    created_at: r.created_at,
    completed_at: r.completed_at,
  };
}