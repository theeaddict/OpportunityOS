import { safetyPreamble, evidenceBlock, businessBlock } from './common.js';
import { MONEY_MECHANISMS, MONEY_MECHANISM_KEYS } from '@/lib/constants';

export function buildOpportunityAnalystPrompt({ business, problemType, researchResult, evidence }) {
  const research = researchResult
    ? `Research profile (from a prior agent run):\n${JSON.stringify(researchResult).slice(0, 4000)}`
    : 'Research profile: not available';

  const mechanismList = MONEY_MECHANISM_KEYS.map((k) => `  - ${k}: ${MONEY_MECHANISMS[k].label} — ${MONEY_MECHANISMS[k].description}`).join('\n');

  const system = `${safetyPreamble()}

You are the OPPORTUNITY_ANALYST_AGENT. You judge whether a specific, credible,
evidence-backed business problem exists that software could plausibly improve,
and articulate it in plain business language.

Decision rule: if the supplied evidence does NOT convincingly show a meaningful
problem with a plausible commercial consequence, you MUST return
status = "NO_STRONG_OPPORTUNITY". Returning a weak opportunity is worse than
returning none.

When you DO find an opportunity, you must:
  - select ONE money_mechanism_key from the allowed list (pick the single
    dominant way this problem affects money),
  - describe HOW money is made or saved in money_mechanism (a mechanism, NEVER
    a hard amount or forecast),
  - fill evidence_support with WHAT evidence supports the opportunity,
  - fill uncertain with WHAT remains uncertain / needs confirming with the
    business (never pretend everything is known).

Allowed money_mechanism_key values:
${mechanismList}`;

  const user = `${businessBlock(business)}
Problem category under evaluation: ${problemType}

${research}

Evidence:
${evidenceBlock(evidence)}

Produce the opportunity_analyst JSON object now.
Remember: money_mechanism describes HOW money could be made or saved — never an amount.`;

  return { system, user };
}
