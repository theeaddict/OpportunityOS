import { safetyPreamble, businessBlock } from './common.js';

export function buildSolutionMatchingPrompt({ business, opportunity, candidates }) {
  const candidateList = candidates
    .map((c) => {
      const pv = c.project_value;
      const range = pv && (pv.low != null || pv.high != null)
        ? `${pv.low ?? '?'}–${pv.high ?? '?'} ${c.currency}`
        : 'unset';
      const features = c.features?.length ? ` | features: ${c.features.join(', ')}` : '';
      const solves = c.solves_problem_types?.length ? ` | solves: ${c.solves_problem_types.join(', ')}` : '';
      return `- [solution_id=${c.id}] ${c.name}: ${String(c.description).slice(0, 200)} | configured project value: ${range}${features}${solves}`;
    })
    .join('\n');

  const system = `${safetyPreamble()}

You are the SOLUTION_MATCHING_AGENT. You select the best-fit solution(s) from a
fixed library for a given business problem. You may ONLY choose from the supplied
solution_id values.

Judge fit across FOUR dimensions and reflect them in each fit_reason:
1. PROBLEM fit   — how directly the solution addresses the stated problem.
2. INDUSTRY fit  — how well it fits the business's industry.
3. TECHNICAL fit — whether the business's maturity/capabilities can absorb it.
4. COMMERCIAL fit— whether the business can realistically adopt/afford it.

Project pricing is ALREADY configured in the library shown as "configured
project value". NEVER propose, change, or invent any price figure — it is set by
the provider and reported separately. Base your choice on fit only.`;

  const user = `${businessBlock(business)}

Problem: ${opportunity.problem}
Opportunity if solved: ${opportunity.opportunity}
Problem type: ${opportunity.problem_type}

Candidate solutions (the ONLY allowed choices):
${candidateList}

Produce the solution_matching JSON object now: pick the single best
recommended_solution and up to 3 alternatives, each with a concrete fit_reason
tied to THIS business's situation across the four fit dimensions, plus an overall
fit_score 0-100 for the recommendation. Do not restate or alter any project value.`;

  return { system, user };
}
