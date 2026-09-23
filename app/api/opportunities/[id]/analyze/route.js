import { analyzeOpportunity } from '@/lib/services/analysis';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import * as financialRepo from '@/lib/repositories/financial';
import { audit } from '@/lib/audit';
import { requireAccount, HttpError, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { isMember } from '@/lib/accounts/roles';
import { enforce } from '@/lib/rate-limit';
import { assertWithinLimit } from '@/lib/accounts/usage';

export async function POST(request, { params }) {
  try {
    const user = await requireAccount();
    enforce(request, { limit: 60, windowMs: 60 * 60_000, key: 'analyze' });
    const { id } = await params;
    const opportunityId = Number(id);
    const existing = await opportunitiesRepo.findById(user.account_id, opportunityId);
    if (!existing) return Response.json({ ok: false, error: 'Opportunity not found' }, { status: 404 });
    if (isMember(user) && existing.assignee_id != user.id) {
      throw new HttpError(403, 'You do not have permission to do this');
    }
    const body = await readJson(request);
    const overrides = body.scenario_overrides || {};
    const skipAi = Boolean(body.skipAi);
    if (!skipAi) await assertWithinLimit(user.account_id, 'ai_analyses');

    try {
      const result = await analyzeOpportunity(user.account_id, opportunityId, user.id, overrides, { skipAi });
      if (result.verdict === 'NO_STRONG_OPPORTUNITY') {
        await audit('opportunity.no_strong_opportunity', {
          entity_type: 'opportunities', entity_id: opportunityId,
          metadata: { job_id: result.jobId }, user_id: user.id, account_id: user.account_id,
        });
        return jsonOk({
          verdict: 'NO_STRONG_OPPORTUNITY',
          reasoning: result.reasoning,
          note: 'The AI analyst judged the evidence insufficient. No scores were changed.',
        });
      }
      const scenarios = await financialRepo.listScenarios(user.account_id, opportunityId);
      await audit('opportunity.analyzed', {
        entity_type: 'opportunities', entity_id: opportunityId,
        metadata: { provider: result.provider, score: result.score }, user_id: user.id, account_id: user.account_id,
      });
      return jsonOk({
        provider: result.provider,
        opportunity_score: result.score,
        confidence_score: result.confidence_score,
        factors: result.factors,
        score_category: result.category,
        subscores: result.subscores || null,
        reasons: result.reasons || null,
        verdict: result.verdict,
        scenarios,
        disclaimer: result.bundle.disclaimer,
        matches: result.matches.slice(0, 5).map((m) => ({
          solution_id: m.solution_id,
          name: m.name,
          recommended: Boolean(m.recommended),
          fit_score: m.fit_score,
          problem_fit: m.problem_fit,
          industry_fit: m.industry_fit,
          technical_fit: m.technical_fit,
          commercial_fit: m.commercial_fit,
          why: m.why || null,
          project_value: m.project_value,
        })),
      });
    } catch (inner) {
      if (/Add evidence/.test(inner.message)) {
        return Response.json({ ok: false, error: inner.message }, { status: 400 });
      }
      throw inner;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
