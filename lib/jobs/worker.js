import {
  claimNext, complete, fail, get, isCancelRequested, reportProgress,
} from './queue.js';
import { getHandler } from './registry.js';

/**
 * Background worker: a single-long-poll loop that claims queued jobs and runs
 * their handlers. One job at a time keeps the MVP predictable; concurrency can
 * be raised later by spawning more workers (claimNext is SKIP LOCKED safe).
 *
 * Rules honored here:
 *   - progress/stage come only from handler reportProgress() calls.
 *   - a job is 'completed' ONLY when its handler returned successfully.
 *   - a running job asked to cancel is flipped to 'cancelled' when its handler
 *     returns (handlers check isCancelRequested() at safe points).
 *   - failures are recorded and the job retried while attempts < max_attempts.
 */

// Worker liveness lives on globalThis, NOT in module scope: Next dev (Turbopack)
// can materialize this module in separate instances for the instrumentation
// bootstrap and for request handlers. The control room's system-health read
// must observe the SAME worker the instrumentation started, so the state
// crosses module boundaries via the process-global registry.
const store = globalThis.__oosWorkerState || (globalThis.__oosWorkerState = { worker: null, startedAt: null });

export function startWorker({ pollMs = 750 } = {}) {
  if (store.worker) return store.worker;
  store.worker = { stopped: false, loop: null };
  store.startedAt = new Date().toISOString();

  const tick = async () => {
    if (store.worker.stopped) return;
    try {
      await processOne();
    } catch (err) {
      console.error('[background-jobs] worker error:', err?.message || err);
    }
    store.worker.loop = setTimeout(tick, Math.max(250, Math.floor(Number(pollMs) || 750)));
    if (typeof store.worker.loop?.unref === 'function') store.worker.loop.unref();
  };

  tick();
  return store.worker;
}

export function stopWorker() {
  if (store.worker) store.worker.stopped = true;
}

/** Control-room liveness: has the background worker been started this process? */
export function workerStatus() {
  return {
    running: Boolean(store.worker && !store.worker.stopped),
    started_at: store.startedAt,
  };
}

async function processOne() {
  const id = await claimNext();
  if (!id) return;
  const job = await get(id);
  if (!job) return;

  // Cancelled while queued is handled in claimNext; re-check before running.
  if (await isCancelRequested(id)) {
    await complete(id, { cancelled: true });
    return;
  }

  const handler = getHandler(job.type);
  if (!handler) {
    await fail(id, new Error(`No handler registered for job type "${job.type}"`));
    return;
  }

  const ctx = {
    job,
    reportProgress: (pct, stage) => reportProgress(id, pct, stage),
    isCancelRequested: () => isCancelRequested(id),
  };
  let result = {};
  try {
    result = (await handler.run(job, ctx)) ?? {};
  } catch (err) {
    await fail(id, err);
    return;
  }

  // Cancellation requested mid-run: record whatever real work happened, then
  // mark the job cancelled (never completed — the work was interrupted).
  if (await isCancelRequested(id)) {
    const { query } = await import('@/lib/db');
    await query('UPDATE background_jobs SET result = ?, completed_at = NOW() WHERE id = ?', [
      JSON.stringify({ ...result, interrupted: true, cancelled: true }), id,
    ]).catch(() => {});
    await query("UPDATE background_jobs SET status = 'cancelled' WHERE id = ?", [id]).catch(() => {});
    return;
  }

  await complete(id, result);
}