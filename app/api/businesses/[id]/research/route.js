import * as businessesRepo from '@/lib/repositories/businesses';
import { runAutomatedResearch, getCoverage } from '@/lib/services/research/run';
import { getResearchProvider } from '@/lib/services/research';
import { requireAccount, jsonOk, handleRouteError } from '@/lib/api-helpers';
import { enforce } from '@/lib/rate-limit';
import { assertWithinLimit } from '@/lib/accounts/usage';

// GET: research coverage + manual checklist + candidate findings.
export async function GET(request, { params }) {
  try {
    const user = await requireAccount();
    const { id } = await params;
    const businessId = Number(id);
    const business = await businessesRepo.findBusiness(user.account_id, businessId);
    if (!business) return Response.json({ ok: false, error: 'Business not found' }, { status: 404 });
    const provider = getResearchProvider();
    const [coverage, candidates] = await Promise.all([
      getCoverage(user.account_id, businessId),
      provider.candidatesFor(business),
    ]);
    return jsonOk({ coverage, checklist: provider.checklist, candidates });
  } catch (err) {
    return handleRouteError(err);
  }
}

// POST: run the automated research provider (website fetch / configured API).
export async function POST(request, { params }) {
  try {
    const user = await requireAccount();
    enforce(request, { limit: 30, windowMs: 60 * 60_000, key: 'research' });
    await assertWithinLimit(user.account_id, 'researches');
    const { id } = await params;
    try {
      const result = await runAutomatedResearch(user.account_id, Number(id), user.id);
      return jsonOk({ result });
    } catch (inner) {
      if (/Research provider failed/.test(inner.message)) {
        return Response.json({ ok: false, error: inner.message }, { status: 502 });
      }
      throw inner;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
