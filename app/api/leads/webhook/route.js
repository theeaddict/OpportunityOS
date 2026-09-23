import { requireAccount, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { getAccount } from '@/lib/repositories/accounts';
import { ingestLeads } from '@/lib/services/discovery';
import { enqueue } from '@/lib/jobs/queue';
import { audit } from '@/lib/audit';
import { enforce } from '@/lib/rate-limit';
import { assertWithinLimit } from '@/lib/accounts/usage';
import { findAccountByApiKey } from '@/lib/accounts/api-keys';

const TOKEN = process.env.OPPORTUNITYOS_INGEST_TOKEN || null;
const INGEST_ACCOUNT_RAW = process.env.OPPORTUNITYOS_INGEST_ACCOUNT_ID || '';
const INGEST_ACCOUNT_ID = Number(INGEST_ACCOUNT_RAW);
if (TOKEN && (!INGEST_ACCOUNT_RAW || !Number.isInteger(INGEST_ACCOUNT_ID) || INGEST_ACCOUNT_ID <= 0)) {
  throw new Error('OPPORTUNITYOS_INGEST_TOKEN is set but OPPORTUNITYOS_INGEST_ACCOUNT_ID is missing or invalid');
}

async function accountFromAuth(request) {
  // Platform-issued API key (control room) takes precedence.
  const api = request.headers.get('x-opportunityos-api-key') || request.headers.get('x-api-key');
  if (api) {
    const found = await findAccountByApiKey(api);
    if (found) return { account_id: found.account_id, client: 'api_key', name: found.name };
    return { client: 'api_key', invalid: true };
  }
  // Legacy operator token (scoped to exactly one account; never trust client headers).
  const auth = request.headers.get('x-opportunityos-token');
  if (auth && TOKEN && auth === TOKEN) {
    return { account_id: INGEST_ACCOUNT_ID, client: 'token' };
  }
  return null;
}

/**
 * POST /api/leads/webhook — real-time lead ingestion.
 *
 * Accepts the same candidate shape as the discovery providers (see
 * lib/services/discovery) inside `{ results: [ ... ] }`. Candidates are
 * normalized + deduped immediately, and a DISCOVERY background job is enqueued
 * with the resulting business ids so analysis starts in real time (no periodic
 * scan needed). Businesses that already exist receive any NEW evidence from
 * this batch (e.g. a fresh social post) and are re-processed, not skipped.
 *
 * Auth: an operator token (OPPORTUNITYOS_INGEST_TOKEN) via
 * X-Opportunityos-Token + X-Opportunityos-Account headers, OR a signed-in
 * session.
 */
export async function POST(request) {
  try {
    const auth = await accountFromAuth(request);
    if (auth?.invalid) {
      return Response.json({ ok: false, error: 'Invalid API key' }, { status: 401 });
    }
    const user = auth ? null : await requireAccount();
    const accountId = auth ? auth.account_id : user.account_id;
    if (auth && auth.client !== 'session') {
      const acct = await getAccount(auth.account_id);
      if (!acct) return Response.json({ ok: false, error: 'Unknown account' }, { status: 401 });
      if (acct.status !== 'active') {
        return Response.json({ ok: false, error: 'Account suspended' }, { status: 403 });
      }
    }

    enforce(request, { limit: 600, windowMs: 60 * 60_000, key: 'leads-ingest' });

    const body = await readJson(request);
    const candidates = Array.isArray(body.results) ? body.results : [];
    if (!candidates.length) {
      return Response.json({ ok: false, error: 'No leads in request (send { results: [...] })' }, { status: 400 });
    }

    const outcomes = await ingestLeads(accountId, candidates, { userId: (user && user.id) ?? null });

    const created = outcomes.filter((o) => o.status === 'created');
    const updated = outcomes.filter((o) => o.status === 'updated');
    const duplicates = outcomes.filter((o) => o.status === 'duplicate');
    const errors = outcomes.filter((o) => o.status === 'error');

    const toProcess = [...new Set(
      [...created, ...updated]
        .map((o) => Number(o.business_id))
        .filter((n) => Number.isFinite(n) && n > 0)
    )];

    let jobId = null;
    let jobDuplicate = false;
    if (toProcess.length) {
      // Plan caps before analysis work is enqueued for these leads.
      await assertWithinLimit(accountId, 'researches', toProcess.length);
      await assertWithinLimit(accountId, 'opportunities');
      const { id, duplicate } = await enqueue({
        type: 'DISCOVERY',
        payload: { provider: 'managed', businessIds: toProcess, filters: { query: null }, webhook: true },
        dedupParams: null, // live leads must never be collapsed into an already-running scan
        createdBy: (user && user.id) ?? null,
        accountId,
      });
      jobId = id;
      jobDuplicate = duplicate;
    }

    await audit('leads.ingested', {
      metadata: {
        ingested: outcomes.length,
        created: created.length,
        updated: updated.length,
        client: auth?.client || 'session',
        client_name: auth?.name || null,
      },
      user_id: (user && user.id) ?? null,
      account_id: accountId,
    });

    return jsonOk({
      ingested: outcomes.length,
      created: created.length,
      updated: updated.length,
      duplicates: duplicates.length,
      errors: errors.map((e) => ({ name: e.name, error: e.error })),
      processing: toProcess.length,
      job_id: jobId,
      job_duplicate: jobDuplicate,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}