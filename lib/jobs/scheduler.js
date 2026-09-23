/**
 * Recurring discovery scheduler.
 *
 * A light tick (runs inside the same long-lived Node process as the background
 * worker) that turns due `discover_schedules` rows into DISCOVERY background
 * jobs. It only enqueues; the worker pipeline does all the real work.
 *
 * Failure policy: a due schedule is advanced forward first (so a transient
 * enqueue failure never causes an immediate hot loop), and each scheduled run
 * is independently wrapped.
 */
import { getPool } from '@/lib/db';
import { enqueue } from '@/lib/jobs/queue';
import { usageStatus } from '@/lib/accounts/usage';

const M = 'lib/jobs/scheduler.js';

let timer = null;

export function startScheduler({ pollMs = 15_000 } = {}) {
  if (timer) return;
  const tick = async () => {
    try {
      await runDue();
    } catch (err) {
      console.error(`[${M}] scheduler tick failed:`, err?.message || err);
    }
    timer = setTimeout(tick, pollMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  };
  tick();
}

export function stopScheduler() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export async function runDue() {
  const pool = getPool();
  const conn = await pool.getConnection();
  let due = [];
  try {
    await conn.beginTransaction();
    const [schedules] = await conn.query(
      `SELECT * FROM discover_schedules
        WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= NOW())
        ORDER BY next_run_at ASC
        LIMIT 10
        FOR UPDATE`
    );
    for (const s of schedules) {
      const interval = Math.max(1, Number(s.interval_minutes) || 60);
      await conn.execute(
        'UPDATE discover_schedules SET next_run_at = ?, last_run_at = NOW() WHERE id = ?',
        [new Date(Date.now() + interval * 60000), Number(s.id)]
      );
    }
    await conn.commit();
    due = schedules;
  } catch (err) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw err;
  } finally {
    conn.release();
  }

  for (const s of due) {
    let filters = {};
    try { filters = typeof s.filters_json === 'string' ? JSON.parse(s.filters_json) : (s.filters_json || {}); } catch { filters = {}; }
    // Plan caps: a scheduled scan consumes researches (+ opportunity creation).
    // The schedule's next_run_at was already advanced, so a skipped run simply
    // waits for the next interval instead of hammering.
    try {
      const researches = await usageStatus(Number(s.account_id), 'researches');
      const opportunities = await usageStatus(Number(s.account_id), 'opportunities');
      if (!researches.allowed || !opportunities.allowed) {
        console.error(
          `[${M}] schedule ${s.id} skipped: plan limit reached `
          + `(researches ${researches.used}/${researches.limit}, opportunities ${opportunities.used}/${opportunities.limit}).`
        );
        continue;
      }
    } catch (err) {
      console.error(`[${M}] schedule ${s.id} limit check failed:`, err?.message || err);
    }
    try {
      await enqueue({
        type: 'DISCOVERY',
        payload: { provider: String(s.provider || 'manual'), filters, schedule_id: Number(s.id) },
        dedupParams: null, // each run is a fresh scan; do not collapse scheduled runs
        createdBy: s.created_by != null ? Number(s.created_by) : null,
        accountId: Number(s.account_id),
      });
    } catch (err) {
      console.error(`[${M}] failed to enqueue schedule ${s.id}:`, err?.message || err);
    }
  }
}