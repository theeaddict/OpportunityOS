import * as jobsRepo from '@/lib/repositories/jobs';
import * as schedulesRepo from '@/lib/repositories/discover-schedules';
import { parseJson } from '@/lib/db';
import { enqueue, get, list } from '@/lib/jobs/queue';
import { listProviders, getDiscoveryProvider, normalizeFilters, defaultProvider } from '@/lib/services/discovery';
import { importCandidates } from '@/lib/services/discovery';
import { audit } from '@/lib/audit';
import { assertWithinLimit } from '@/lib/accounts/usage';
import { requireAccount, requireRole, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { enforce } from '@/lib/rate-limit';

export async function GET() {
  try {
    const user = await requireAccount();
    const jobs = await list({ type: 'DISCOVERY', accountId: user.account_id, limit: 10 });
    const schedules = (await schedulesRepo.listSchedules(user.account_id)).map((s) => ({
      ...s,
      filters: parseJson(s.filters_json, {}),
    }));
    return jsonOk({
      providers: listProviders(),
      jobs,
      schedules,
      saved_queries: await jobsRepo.listQueries(user.account_id, 10),
      webhook_path: '/api/leads/webhook',
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Run the one-click discovery pipeline. Enqueues a DISCOVERY background job
 * (idempotent via dedup) and returns immediately; the client polls
 * /api/discover/jobs/[id] for real progress (stage + progress) and fires the
 * results when complete. The worker runs the pipeline and the job is completed
 * only when the whole run is finished.
 */
export async function POST(request) {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin'); // runs spend researches + opportunities allowance
    enforce(request, { limit: 30, windowMs: 60 * 60_000, key: 'discover' });
    // Plan caps before any expensive work is enqueued (researches + the
    // opportunity creation that a run performs during analysis).
    await assertWithinLimit(user.account_id, 'researches');
    await assertWithinLimit(user.account_id, 'opportunities');
    const body = await readJson(request);
    const providerId = getDiscoveryProvider(body.provider) ? body.provider : defaultProvider();
    const filters = normalizeFilters(body);
    if (!filters.industry && !filters.query) {
      return Response.json({ ok: false, error: 'Tell us what industry (or keywords) to look at' }, { status: 400 });
    }
    // Fold "solutions you can provide" into the stored keywords so it biases search.
    const keywordBlob = [filters.keywords, filters.solutions].filter(Boolean).join(', ');

    const queryId = await jobsRepo.createSearchQuery({
      account_id: user.account_id,
      query_name: `${providerId}: ${(filters.query || filters.industry).slice(0, 80)}`,
      query_text: filters.query,
      keywords: keywordBlob,
      industry: filters.industry,
      location: filters.location,
      platform: filters.platform,
      minimum_followers: filters.minimumAudience,
      business_maturity: filters.businessMaturity,
      problem_categories: filters.problemCategories,
      required_contact_type: filters.requiredContactType,
      created_by: user.id,
    });

    // Duplicate protection: an identical queued/running job is returned instead.
    const { id, duplicate } = await enqueue({
      type: 'DISCOVERY',
      payload: { provider: providerId, filters, searchQueryId: queryId },
      dedupParams: { provider: providerId, filters },
      createdBy: user.id,
      accountId: user.account_id,
    });

    if (duplicate) {
      const existing = await get(id, user.account_id);
      return jsonOk({
        job_id: id, started: true, duplicate: true,
        status: existing?.status || 'queued', stage: existing?.stage || null,
        progress: existing?.progress ?? 0,
      });
    }

    return jsonOk({ job_id: id, started: true, duplicate: false, status: 'queued', stage: null, progress: 0 });
  } catch (err) {
    return handleRouteError(err);
  }
}

// Import confirmed candidates (normalization + dedup happen server-side).
export async function PUT(request) {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin'); // importing candidates creates account-wide businesses
    const body = await readJson(request);
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    if (!candidates.length) return Response.json({ ok: false, error: 'No businesses selected' }, { status: 400 });
    const outcomes = await importCandidates(user.account_id, candidates, { userId: user.id });
    const created = outcomes.filter((o) => o.status === 'created').length;
    await audit('discovery.imported', { metadata: { created }, user_id: user.id, account_id: user.account_id });
    return jsonOk({ outcomes });
  } catch (err) {
    return handleRouteError(err);
  }
}