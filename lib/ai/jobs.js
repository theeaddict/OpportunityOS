/**
 * AI job logging — application-owned audit of every model invocation.
 * Records: job ID, agent, model, duration, status. Never logs API keys.
 */

import crypto from 'crypto';
import { query, insert } from '@/lib/db';

export const AGENT_JOB_TYPES = {
  BUSINESS_RESEARCH_AGENT: 'research_interpretation',
  OPPORTUNITY_ANALYST_AGENT: 'opportunity_analysis',
  SOLUTION_MATCHING_AGENT: 'solution_matching',
  OUTREACH_AGENT: 'outreach_draft',
  DEMO_SPEC_AGENT: 'demo_specification',
};

/**
 * Wrap an agent run with ai_jobs lifecycle logging.
 * run() -> provider-style result { ok, data?, reason?, error?, meta? }
 */
export async function runLoggedJob({ agent, account_id = null, business_id = null, opportunity_id = null, user_id = null, input, run }) {
  if (!Object.keys(AGENT_JOB_TYPES).includes(agent)) throw new Error(`Unknown agent: ${agent}`);
  const inputHash = crypto.createHash('sha256').update(JSON.stringify(input || {})).digest('hex');

  const jobId = await insert(
    `INSERT INTO ai_jobs (account_id, job_type, business_id, opportunity_id, user_id, status, attempts, input_hash)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [account_id ? Number(account_id) : null, AGENT_JOB_TYPES[agent],
     business_id ? Number(business_id) : null,
     opportunity_id ? Number(opportunity_id) : null, user_id || null, inputHash]
  );

  // Not configured is recorded explicitly — the app never pretends to have run.
  const { aiProvider } = await import('@/lib/ai/provider.js');
  if (!aiProvider.isConfigured()) {
    await query(
      "UPDATE ai_jobs SET status = 'skipped_no_provider', completed_at = NOW(), error_message = ? WHERE id = ?",
      ['AI_API_KEY / AI_MODEL not configured', jobId]
    );
    return { jobId, ok: false, reason: 'not_configured' };
  }

  await query("UPDATE ai_jobs SET status = 'running', started_at = NOW(), attempts = attempts + 1 WHERE id = ?", [jobId]);
  const info = aiProvider.info();
  await query('UPDATE ai_jobs SET provider = ?, model = ? WHERE id = ?', [info.provider, info.model, jobId]);

  const result = await run();
  const durationMs = result.meta?.duration_ms ?? null;

  if (result.ok) {
    await query(
      "UPDATE ai_jobs SET status = 'completed', output_json = ?, completed_at = NOW() WHERE id = ?",
      [JSON.stringify(truncate(result.data)), jobId]
    );
    return { jobId, ok: true, data: result.data, meta: result.meta };
  }

  await query(
    "UPDATE ai_jobs SET status = ?, error_message = ?, completed_at = NOW() WHERE id = ?",
    [result.reason === 'not_configured' ? 'skipped_no_provider' : 'failed',
     String(result.error || result.reason || 'unknown').slice(0, 600), jobId]
  );
  return { jobId, ok: false, reason: result.reason, error: result.error };
}

function truncate(value, max = 60_000) {
  const s = JSON.stringify(value);
  if (s && s.length > max) return { truncated: true, preview: s.slice(0, max) };
  return value;
}

export async function listJobs({ accountId = null, limit = 50 } = {}) {
  return query(
    `SELECT * FROM (
       SELECT id, job_type AS agent_job, business_id, opportunity_id, provider, model,
              status, attempts,
              TIMESTAMPDIFF(SECOND, started_at, completed_at) AS duration_seconds,
              created_at, completed_at, error_message
         FROM ai_jobs
        ${accountId != null ? 'WHERE account_id = ?' : ''}
        ORDER BY id DESC LIMIT ${Number(limit)}
     ) t ORDER BY id DESC`,
    accountId != null ? [Number(accountId)] : []
  );
}
