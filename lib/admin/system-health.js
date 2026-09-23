/**
 * Platform health aggregate for the superadmin control room (STAGE 3).
 * Deliberately system-wide — DB ping, worker liveness, job queue sizes and
 * provider configuration are read across the platform, only reachable behind
 * requireSuperadmin() at the API layer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getPool, query } from '@/lib/db';
import { countsByStatus } from '@/lib/jobs/queue';
import { JOB_TYPE_KEYS } from '@/lib/jobs/registry';
import { workerStatus } from '@/lib/jobs/worker';
import { providerInfo } from '@/lib/ai/provider';
import { PROVIDERS } from '@/lib/services/discovery';

const STARTED_AT = Date.now();

let VERSION = 'unknown';
try {
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')
  );
  VERSION = pkg.version || 'unknown';
} catch {
  /* version is cosmetic — never break health on a read failure */
}

export function appHealth() {
  return {
    ok: true,
    version: VERSION,
    node_version: process.version,
    uptime_seconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    started_at: new Date(STARTED_AT).toISOString(),
    env: process.env.NODE_ENV || 'development',
    platform: process.platform,
  };
}

export async function dbHealth() {
  const started = Date.now();
  try {
    await getPool().query('SELECT 1');
    return { ok: true, backend: 'postgres', latency_ms: Date.now() - started, error: null };
  } catch (err) {
    return {
      ok: false,
      backend: 'postgres',
      latency_ms: Date.now() - started,
      error: String(err?.message || err),
    };
  }
}

export async function jobsHealth() {
  const counts = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  try {
    const rows = await countsByStatus();
    for (const r of rows) counts[r.status] = Number(r.n || 0);
  } catch {
    /* report zeroed counts rather than killing the whole health endpoint */
  }

  let staleRunning = 0;
  let staleRunningIds = [];
  let oldestQueuedAt = null;
  try {
    const stale = await query(
      `SELECT id FROM background_jobs
        WHERE status = 'running' AND EXTRACT(EPOCH FROM (NOW() - started_at)) > 1800
        ORDER BY started_at ASC LIMIT 20`
    );
    staleRunning = stale.length;
    staleRunningIds = stale.map((r) => Number(r.id));
    const oldest = await query(
      "SELECT MIN(created_at) AS t FROM background_jobs WHERE status = 'queued'"
    );
    oldestQueuedAt = oldest[0]?.t || null;
  } catch {
    /* same principle — a failed probe shouldn't 500 the control room */
  }

  const worker = workerStatus();
  return {
    worker,
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    stale_running: staleRunning,
    stale_running_ids: staleRunningIds,
    oldest_queued_at: oldestQueuedAt,
    registered_handlers: JOB_TYPE_KEYS.length,
    handler_types: JOB_TYPE_KEYS,
  };
}

export function providersHealth() {
  const ai = providerInfo();
  const discovery = Object.values(PROVIDERS)
    .filter((p) => p.available)
    .map((p) => ({ id: p.id, label: p.label }));
  return {
    ai: {
      configured: ai.configured,
      provider: ai.provider,
      model: ai.model,
      base_url: ai.base_url,
    },
    research: {
      configured: Boolean(process.env.RESEARCH_PROVIDER || process.env.RESEARCH_API_URL),
      provider: process.env.RESEARCH_PROVIDER || 'website',
    },
    discovery,
  };
}

export async function systemHealth() {
  const [db, jobs, providers, app] = await Promise.all([dbHealth(), jobsHealth(), providersHealth(), appHealth()]);
  const allOk = db.ok && jobs.worker.running;
  return { ok: allOk, generated_at: new Date().toISOString(), db, jobs, providers, app };
}

/** Shorthand health check used by orchestrators/uptime monitors (no superadmin gate). */
export async function publicLiveness() {
  const db = await dbHealth();
  return { ok: db.ok, db: db.ok, uptime_seconds: Math.floor((Date.now() - STARTED_AT) / 1000) };
}