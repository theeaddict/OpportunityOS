import { enqueue, list } from '@/lib/jobs/queue';
import { isJobType, JOB_TYPE_LABELS, JOB_TYPE_KEYS } from '@/lib/jobs/registry';
import { audit } from '@/lib/audit';
import { requireAccount, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { enforce } from '@/lib/rate-limit';
import { assertWithinLimit } from '@/lib/accounts/usage';

export async function GET(request) {
  try {
    const user = await requireAccount();
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    const status = url.searchParams.get('status');
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 25)));
    const jobs = await list({
      type: type && isJobType(type) ? type.toUpperCase() : null,
      status: status || null,
      accountId: user.account_id,
      limit,
    });
    return jsonOk({ jobs, job_types: JOB_TYPE_KEYS, job_type_labels: JOB_TYPE_LABELS });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Enqueue a typed background job: { type, payload, dedupParams, maxAttempts }.
 * The job runs via the worker and records real progress under ~/jobs.
 */
export async function POST(request) {
  try {
    const user = await requireAccount();
    enforce(request, { limit: 30, windowMs: 60 * 60_000, key: 'job-enqueue' });
    const body = await readJson(request);
    const type = String(body.type || '').toUpperCase();
    if (!isJobType(type)) {
      return Response.json({ ok: false, error: `Unknown job type "${type}". Supported: ${JOB_TYPE_KEYS.join(', ')}` }, { status: 400 });
    }
    // Plan caps depend on what the job will consume once it runs.
    if (type === 'DISCOVERY') {
      await assertWithinLimit(user.account_id, 'researches');
      await assertWithinLimit(user.account_id, 'opportunities');
    } else if (type === 'RESEARCH') {
      await assertWithinLimit(user.account_id, 'researches');
    } else if (type === 'OPPORTUNITY_ANALYSIS') {
      if (!(body.payload && body.payload.skipAi)) {
        await assertWithinLimit(user.account_id, 'ai_analyses');
      }
    } else if (type === 'DEMO_GENERATION') {
      await assertWithinLimit(user.account_id, 'demo_generations');
    }
    const { id, duplicate } = await enqueue({
      type,
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
      dedupParams: body.dedupParams ? body.dedupParams : null,
      maxAttempts: body.maxAttempts ? Number(body.maxAttempts) : 3,
      createdBy: user.id,
      accountId: user.account_id,
    });
    await audit('job.enqueued', {
      entity_type: 'background_jobs', entity_id: id,
      metadata: { type, duplicate }, user_id: user.id, account_id: user.account_id,
    }).catch(() => {});
    return jsonOk({ job_id: id, type, duplicate, status: 'queued', progress: 0 });
  } catch (err) {
    return handleRouteError(err);
  }
}