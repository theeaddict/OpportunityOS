import { aiProvider } from '@/lib/ai/provider';
import { outreachSchema } from '@/lib/ai/schemas';
import { buildOutreachPrompt } from '@/lib/ai/prompts/outreach.js';
import { runLoggedJob } from '@/lib/ai/jobs';

/**
 * OUTREACH_AGENT
 * Input:  { business, evidence (FACT/INFERENCE only), opportunity, solution?, userId }
 * Output: { ok, data?{short_whatsapp, normal_whatsapp, professional_whatsapp}, jobId }
 */
export async function runOutreachAgent({ business, opportunity, solution = null, evidence, userId = null, accountId = null }) {
  return runLoggedJob({
    agent: 'OUTREACH_AGENT',
    account_id: accountId,
    business_id: business.id,
    opportunity_id: opportunity.id,
    user_id: userId,
    input: { evidence_ids: (evidence || []).map((e) => e.id) },
    run: () => {
      const { system, user } = buildOutreachPrompt({ business, opportunity, solution, evidence });
      return aiProvider.generateStructured({ system, user, schema: outreachSchema });
    },
  });
}
