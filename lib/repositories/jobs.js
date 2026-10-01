import crypto from 'crypto';
import { query, insert } from '@/lib/db';
import { PROBLEM_TYPE_KEYS } from '@/lib/constants';

/**
 * Search queries (saved discovery configurations) + search jobs.
 *
 * Job lifecycle: queued -> running -> completed | failed
 * with attempts, progress, error_message and timestamps, plus duplicate
 * protection: an identical active (queued/running) job for the SAME account is
 * returned instead of being re-created.
 * Multi-tenant: search_queries and search_jobs both carry account_id.
 */

export async function createSearchQuery({ account_id, query_name, query_text = '', keywords = null, industry = null,
                                          location = null, platform = null, minimum_followers = null,
                                          business_maturity = 'any', problem_categories = [],
                                          required_contact_type = null, created_by = null }) {
  const cats = (problem_categories || []).filter((c) => PROBLEM_TYPE_KEYS.includes(c));
  return insert(
    `INSERT INTO search_queries
       (account_id, query_name, query_text, keywords, industry, location, platform, minimum_followers,
        business_maturity, problem_categories, required_contact_type, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [Number(account_id) || null, String(query_name).slice(0, 200), String(query_text || '').slice(0, 300),
     keywords ? String(keywords).slice(0, 2000) : null,
     industry, location, platform,
     minimum_followers ? Math.max(0, Math.floor(Number(minimum_followers))) : null,
     ['any', 'small', 'established', 'mature'].includes(business_maturity) ? business_maturity : 'any',
     JSON.stringify(cats),
     ['email', 'phone', 'whatsapp', 'social'].includes(required_contact_type) ? required_contact_type : null,
     created_by]
  );
}

export async function listQueries(accountId, limit = 20) {
  return query(
    `SELECT * FROM search_queries WHERE account_id = ? AND status != 'archived'
      ORDER BY created_at DESC LIMIT ${Number(limit)}`,
    [Number(accountId)]
  );
}

/** Stable hash of provider+filters for duplicate protection. */
export function dedupHash(provider, filters) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ p: String(provider || ''), f: filters || {} }))
    .digest('hex');
}

/**
 * Create a job in 'queued' state for the account. If an identical queued/running
 * job for the SAME account exists, returns { jobId, duplicate: true }.
 */
export async function createQueuedSearchJob({ account_id, search_query_id, provider, dedup_key }) {
  const existing = await query(
    `SELECT id FROM search_jobs WHERE account_id = ? AND dedup_hash = ? AND status IN ('queued','running') LIMIT 1`,
    [Number(account_id) || null, dedup_key]
  );
  if (existing[0]) return { jobId: existing[0].id, duplicate: true };

  const id = await insert(
    `INSERT INTO search_jobs (account_id, search_query_id, provider, dedup_hash, status, progress)
     VALUES (?, ?, ?, ?, 'queued', 0)`,
    [Number(account_id) || null, Number(search_query_id), String(provider), dedup_key]
  );
  return { jobId: id, duplicate: false };
}

export async function startJob(accountId, jobId) {
  await query(
    `UPDATE search_jobs SET status = 'running', started_at = NOW(), attempts = attempts + 1
      WHERE id = ? AND account_id = ?`,
    [Number(jobId), Number(accountId)]
  );
  await setProgress(accountId, jobId, 5);
}

export async function setProgress(accountId, jobId, progress) {
  await query('UPDATE search_jobs SET progress = LEAST(100, ?) WHERE id = ? AND account_id = ?', [
    Math.max(0, Math.floor(Number(progress) || 0)), Number(jobId), Number(accountId),
  ]);
}

/** Set the current real pipeline stage (discovery flow) along with its progress. */
export async function setJobStage(accountId, jobId, stage, progress) {
  await query(
    'UPDATE search_jobs SET stage = ?, progress = LEAST(100, ?) WHERE id = ? AND account_id = ?',
    [String(stage).slice(0, 40), Math.max(0, Math.floor(Number(progress) || 0)), Number(jobId), Number(accountId)]
  );
}

/** Persist the final summarised outcome (only written on completion). */
export async function saveResultSummary(accountId, jobId, summary) {
  await query('UPDATE search_jobs SET result_summary = ? WHERE id = ? AND account_id = ?', [
    JSON.stringify(summary), Number(jobId), Number(accountId),
  ]);
}

export async function completeJob(accountId, jobId, finalProgress = 100) {
  await query(
    `UPDATE search_jobs SET status = 'completed', progress = ?, completed_at = NOW()
      WHERE id = ? AND account_id = ?`,
    [Math.min(100, Math.max(0, Math.floor(Number(finalProgress)))), Number(jobId), Number(accountId)]
  );
}

export async function failJob(accountId, jobId, error) {
  await query(
    `UPDATE search_jobs SET status = 'failed', error_message = ?, completed_at = NOW()
      WHERE id = ? AND account_id = ?`,
    [String(error).slice(0, 600), Number(jobId), Number(accountId)]
  );
}

export async function getJob(accountId, jobId) {
  const rows = await query(
    'SELECT * FROM search_jobs WHERE id = ? AND account_id = ?',
    [Number(jobId), Number(accountId)]
  );
  return rows[0] || null;
}

/**
 * Discovery runs for the /discover "Recent runs" table and the Settings
 * activity count. Reads the REAL pipeline's job store (`background_jobs`,
 * written by lib/jobs/queue.js) — NOT the search_jobs/search_queries pair
 * above, which only self-test's isolated unit path still writes to; the
 * actual discovery pipeline has written to background_jobs since migration
 * 015 and never touches search_jobs, so querying search_jobs here always
 * returned an empty list regardless of how many runs actually completed.
 */
export async function listJobs(accountId, limit = 25) {
  return query(
    `SELECT id, status, stage, progress, payload, result, error, created_at
       FROM background_jobs
      WHERE account_id = ? AND type = 'DISCOVERY'
      ORDER BY created_at DESC LIMIT ${Number(limit)}`,
    [Number(accountId)]
  );
}