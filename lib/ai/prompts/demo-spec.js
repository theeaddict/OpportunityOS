import { safetyPreamble, businessBlock } from './common.js';

export function buildDemoSpecPrompt({ business, opportunity, solution }) {
  const system = `${safetyPreamble()}

You are the DEMO_SPEC_AGENT. You design practical software demo plans for
non-technical buyers. The demo must mirror THIS business's real operations using
neutral sample data clearly described as sample entities. Do not claim knowledge
about the business beyond what is supplied.`;

  const user = `${businessBlock(business)}

Their problem: ${opportunity.problem}
Opportunity if solved: ${opportunity.opportunity}
Money mechanism: ${opportunity.money_mechanism || 'n/a'}
Solution to demonstrate: ${solution.name} — ${String(solution.description).slice(0, 300)}

Design a ~20-minute demo plan. Produce the demo_spec JSON object now:
demo_name, pages, features, workflow (ordered steps mirroring their operations),
sample_entities (neutral example records to load), customization_points.`;

  return { system, user };
}
