import { aiProvider } from '@/lib/ai/provider';
import { businessResearchSchema } from '@/lib/ai/schemas';
import { buildBusinessResearchPrompt } from '@/lib/ai/prompts/business-research.js';
import { runLoggedJob } from '@/lib/ai/jobs';

/**
 * BUSINESS_RESEARCH_AGENT
 * Input:  { business, sourceContent, evidence, userId }
 * Output: { ok, data?: full research profile, jobId }
 */
export async function runBusinessResearchAgent({ business, sourceContent = null, evidence, userId = null, accountId = null }) {
  return runLoggedJob({
    agent: 'BUSINESS_RESEARCH_AGENT',
    account_id: accountId,
    business_id: business.id,
    user_id: userId,
    input: { evidence_ids: (evidence || []).map((e) => e.id), has_source_content: Boolean(sourceContent) },
    run: () => {
      const { system, user } = buildBusinessResearchPrompt({ business, sourceContent, evidence });
      return aiProvider.generateStructured({ system, user, schema: businessResearchSchema });
    },
  });
}
