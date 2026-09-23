import { aiProvider } from '@/lib/ai/provider';
import { demoSpecSchema } from '@/lib/ai/schemas';
import { buildDemoSpecPrompt } from '@/lib/ai/prompts/demo-spec.js';
import { runLoggedJob } from '@/lib/ai/jobs';

/**
 * DEMO_SPEC_AGENT
 * Input:  { business, opportunity, solution, userId }
 * Output: { ok, data?{demo_name, pages, features, workflow, sample_entities,
 *                     customization_points}, jobId }
 */
export async function runDemoSpecAgent({ business, opportunity, solution, userId = null, accountId = null }) {
  return runLoggedJob({
    agent: 'DEMO_SPEC_AGENT',
    account_id: accountId,
    business_id: business.id,
    opportunity_id: opportunity.id,
    user_id: userId,
    input: { solution_slug: solution.slug },
    run: () => {
      const { system, user } = buildDemoSpecPrompt({ business, opportunity, solution });
      return aiProvider.generateStructured({ system, user, schema: demoSpecSchema });
    },
  });
}
