import { aiProvider } from '@/lib/ai/provider';
import { createSolutionMatchingSchema } from '@/lib/ai/schemas';
import { buildSolutionMatchingPrompt } from '@/lib/ai/prompts/solution-matching.js';
import { runLoggedJob } from '@/lib/ai/jobs';

/**
 * SOLUTION_MATCHING_AGENT
 * Input:  { business, opportunity, candidates (from the library), userId }
 * Output: { ok, data?{recommended_solution, alternative_solutions, fit_score}, jobId }
 *
 * The agent can only pick ids present in `candidates`; the schema enforces it.
 */
export async function runSolutionMatchingAgent({ business, opportunity, candidates, userId = null, accountId = null }) {
  const allowedIds = candidates.map((c) => c.id);
  return runLoggedJob({
    agent: 'SOLUTION_MATCHING_AGENT',
    account_id: accountId,
    business_id: business.id,
    opportunity_id: opportunity.id,
    user_id: userId,
    input: { candidate_ids: allowedIds, problem_type: opportunity.problem_type },
    run: () => {
      const { system, user } = buildSolutionMatchingPrompt({ business, opportunity, candidates });
      return aiProvider.generateStructured({
        system, user,
        schema: createSolutionMatchingSchema(allowedIds),
      });
    },
  });
}
