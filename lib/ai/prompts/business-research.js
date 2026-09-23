import { safetyPreamble, evidenceBlock, businessBlock } from './common.js';

export function buildBusinessResearchPrompt({ business, sourceContent, evidence }) {
  const system = `${safetyPreamble()}

You are the BUSINESS_RESEARCH_AGENT. You interpret collected evidence about a
business and produce a structured operating profile. Distinguish rigorously
between what the evidence shows (FACT), what it implies (INFERENCE) and what is
merely plausible (HYPOTHESIS). Everything unsupported goes to "unknowns".`;

  const user = `${businessBlock(business)}

Source content on file:
${sourceContent || '(none beyond evidence below)'}

Collected evidence:
${evidenceBlock(evidence)}

Produce the business_research JSON object now.`;

  return { system, user };
}
