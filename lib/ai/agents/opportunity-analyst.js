import { aiProvider } from '@/lib/ai/provider';
import { opportunityAnalystSchema } from '@/lib/ai/schemas';
import { buildOpportunityAnalystPrompt } from '@/lib/ai/prompts/opportunity-analyst.js';
import { runLoggedJob } from '@/lib/ai/jobs';

/**
 * OPPORTUNITY_ANALYST_AGENT
 * Input:  { business, problemType, researchResult?, evidence, userId }
 * Output: { ok, data?{status: OPPORTUNITY_FOUND|NO_STRONG_OPPORTUNITY, ...}, jobId }
 */
export async function runOpportunityAnalystAgent({ business, problemType, researchResult = null, evidence, userId = null, accountId = null }) {
  const opportunity_id = arguments[0].opportunityId ?? null;
  return runLoggedJob({
    agent: 'OPPORTUNITY_ANALYST_AGENT',
    account_id: accountId,
    business_id: business.id,
    opportunity_id,
    user_id: userId,
    input: { problem_type: problemType, evidence_ids: (evidence || []).map((e) => e.id) },
    run: () => {
      const { system, user } = buildOpportunityAnalystPrompt({ business, problemType, researchResult, evidence });
      return aiProvider.generateStructured({ system, user, schema: opportunityAnalystSchema });
    },
  });
}
