import crypto from 'crypto';
import { getPool, query, insert, parseJson } from '@/lib/db';

/**
 * DB-backed background job queue (MVP).
 *
 * This module is the ONLY storage-touching seam for jobs. If Redis/BullMQ is
 * adopted later, reimplement these functions behind the same signatures:
 *   enqueue        ≈ Queue.add(name, data, { jobId/hash, attempts })
 *   claimNext      ≈ worker.nextJob()
 *   reportProgress ≈ job.updateProgress(pct) + active staleness tracking
 *   complete       ≈ job.moveToCompleted(result)
 *   fail           ≈ job.moveToFailed(err)  (honors attempts → retry/terminal)
 *   retry          ≈ job.retry()
 *   requestCancel  ≈ job.remove() for queued / a cancel flag for running
 *   get/list       ≈ job / queue.getJobs()
 * UI + handlers stay untouched; only the worker bootstrap changes.
 */

export const JOB_STATUSES = Object.freeze(['queued', 'running', 'completed', 'failed', 'cancelled']);
const TERMINAL = `('completed','failed','cancelled')`;

/** Stable hash of (type, params) for duplicate protection. */
export function dedupHash(type, params) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ t: String(type || ''), p: params || {} }))
    .digest('hex');
}

/**
 * Enqueue a job. If an identical queued/running job already exists for the same
 * account and dedupParams, the existing job is returned instead ({ duplicate: true }).
 */
export async function enqueue({ type, payload = {}, dedupParams = null, maxAttempts = 3, createdBy = null, accountId = null }) {
  const dk = dedupParams == null ? null : dedupHash(type, dedupParams);
  if (dk) {
    const dup = await query(
      `SELECT id, status FROM background_jobs
        WHERE type = ? AND dedup_key = ? AND account_id = ? AND status IN ('queued','running') LIMIT 1`,
      [String(type), dk, accountId != null ? Number(accountId) : null]
    );
    if (dup[0]) return { id: dup[0].id, duplicate: true, status: dup[0].status };
  }
  const id = await insert(
    `INSERT INTO background_jobs (type, status, attempts, max_attempts, payload, dedup_key, created_by, account_id)
     VALUES (?, 'queued', 0, ?, ?, ?, ?, ?)`,
    [String(type), Math.max(1, Math.floor(Number(maxAttempts) || 3)),
     JSON.stringify(payload ?? {}), dk, createdBy || null,
     accountId != null ? Number(accountId) : null]
  );
  return { id, duplicate: false, status: 'queued' };
}

/**
 * Atomically claim the oldest queued job (SKIP LOCKED so multiple workers never
 * grab the same row). A queued job that was asked to cancel is cancelled here
 * instead of being run. Returns the claimed job id, or null when empty.
 */
export async function claimNext() {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id, cancel_requested FROM background_jobs
        WHERE status = 'queued' ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    const row = rows[0];
    if (!row) {
      await conn.rollback();
      return null;
    }
    if (row.cancel_requested) {
      await conn.execute(
        `UPDATE background_jobs SET status = 'cancelled', cancel_requested = 0, completed_at = NOW()
          WHERE id = ?`,
        [row.id]
      );
      await conn.commit();
      return null;
    }
    await conn.execute(
      `UPDATE background_jobs
         SET status = 'running', attempts = attempts + 1, started_at = NOW(), error = NULL
       WHERE id = ? AND status = 'queued'`,
      [row.id]
    );
    await conn.commit();
    return row.id;
  } catch (err) {
    try { await conn.rollback(); } catch { /* conn may already be released */ }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Report REAL progress. Handlers call this only at milestones of actual work;
 * the worker never fabricates progress values.
 */
export async function reportProgress(id, progress, stage = null) {
  const pct = Math.max(0, Math.min(100, Math.floor(Number(progress) || 0)));
  const stageStr = stage ? String(stage).slice(0, 60) : null;
  await query(
    `UPDATE background_jobs SET progress = ?, stage = COALESCE(?, stage) WHERE id = ?`,
    [pct, stageStr, Number(id)]
  );
}

/** Mark a job completed with its final result. Only called when work is done. */
export async function complete(id, result = {}) {
  await query(
    `UPDATE background_jobs
        SET status = 'completed', progress = 100, result = ?, error = NULL,
            cancel_requested = 0, completed_at = NOW()
      WHERE id = ?`,
    [JSON.stringify(result ?? {}), Number(id)]
  );
}

/** Mark a job failed. Requeues for a retry while attempts < max_attempts. */
export async function fail(id, error) {
  const job = await get(id);
  if (!job) return;
  const msg = String(error?.message || error || 'unknown').slice(0, 2000);
  if (Number(job.attempts) >= Number(job.max_attempts || 3)) {
    await query(
      `UPDATE background_jobs SET status = 'failed', error = ?, cancel_requested = 0, completed_at = NOW()
        WHERE id = ?`,
      [msg, Number(id)]
    );
  } else {
    await query(
      `UPDATE background_jobs SET status = 'queued', error = ?, cancel_requested = 0 WHERE id = ?`,
      [msg, Number(id)]
    );
  }
}

/**
 * Request cancellation where safe: queued jobs cancel immediately; running jobs
 * get a cancel_requested flag their handler checks at safe points (the worker
 * flips them to 'cancelled' when the handler returns). Terminal jobs are left
 * alone.
 */
export async function requestCancel(id, accountId = null) {
  const rows = await query(
    'SELECT status FROM background_jobs WHERE id = ?' + (accountId != null ? ' AND account_id = ?' : ''),
    accountId != null ? [Number(id), Number(accountId)] : [Number(id)]
  );
  const job = rows[0];
  if (!job) return { ok: false, reason: 'not_found' };
  if (job.status !== 'queued' && job.status !== 'running') {
    return { ok: false, reason: `job is already ${job.status}` };
  }
  if (job.status === 'queued') {
    await query(
      `UPDATE background_jobs SET status = 'cancelled', cancel_requested = 0, completed_at = NOW()
        WHERE id = ? AND status = 'queued'` + (accountId != null ? ' AND account_id = ?' : ''),
      accountId != null ? [Number(id), Number(accountId)] : [Number(id)]
    );
    return { ok: true, cancelled: true, queued: true };
  }
  await query(
    "UPDATE background_jobs SET cancel_requested = 1 WHERE id = ? AND status = 'running'" + (accountId != null ? ' AND account_id = ?' : ''),
    accountId != null ? [Number(id), Number(accountId)] : [Number(id)]
  );
  return { ok: true, cancel_requested: true };
}

/** Whether a running job has been asked to stop (handlers check at safe points). */
export async function isCancelRequested(id) {
  const rows = await query('SELECT cancel_requested FROM background_jobs WHERE id = ?', [Number(id)]);
  return Boolean(rows[0]?.cancel_requested);
}

/** Human-initiated retry of a failed job: fresh attempt budget, straight back to queue. */
export async function retry(id, accountId = null) {
  const [result] = await getPool().execute(
    `UPDATE background_jobs
        SET status = 'queued', attempts = 0, error = NULL, cancel_requested = 0,
            started_at = NULL, completed_at = NULL
      WHERE id = ? AND status = 'failed'` + (accountId != null ? ' AND account_id = ?' : ''),
    accountId != null ? [Number(id), Number(accountId)] : [Number(id)]
  );
  return result.affectedRows > 0;
}

export async function get(id, accountId = null) {
  const rows = await query(
    'SELECT * FROM background_jobs WHERE id = ?' + (accountId != null ? ' AND account_id = ?' : ''),
    accountId != null ? [Number(id), Number(accountId)] : [Number(id)]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return { ...row, payload: parseJson(row.payload, {}), result: parseJson(row.result, null) };
}

export async function list({ type = null, status = null, accountId = null, limit = 25 } = {}) {
  const where = [];
  const params = [];
  if (type) { where.push('type = ?'); params.push(String(type)); }
  if (status) { where.push('status = ?'); params.push(String(status)); }
  if (accountId != null) { where.push('account_id = ?'); params.push(Number(accountId)); }
  return query(
    `SELECT * FROM background_jobs
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC LIMIT ${Math.max(1, Math.floor(Number(limit) || 25))}`,
    params
  );
}

export async function countsByStatus({ accountId = null } = {}) {
  return query(
    'SELECT status, COUNT(*) AS n FROM background_jobs' +
      (accountId != null ? ' WHERE account_id = ? GROUP BY status' : ' GROUP BY status'),
    accountId != null ? [Number(accountId)] : []
  );
}