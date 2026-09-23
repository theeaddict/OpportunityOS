import { DISCOVERY_HANDLER } from './handlers/discovery.js';
import { RESEARCH_HANDLER } from './handlers/research.js';
import { AI_RESEARCH_HANDLER } from './handlers/ai-research.js';
import { OPPORTUNITY_ANALYSIS_HANDLER } from './handlers/opportunity-analysis.js';
import { FINANCIAL_ANALYSIS_HANDLER } from './handlers/financial-analysis.js';
import { SOLUTION_MATCHING_HANDLER } from './handlers/solution-matching.js';
import { OUTREACH_GENERATION_HANDLER } from './handlers/outreach-generation.js';
import { DEMO_GENERATION_HANDLER } from './handlers/demo-generation.js';

/**
 * Job type registry: maps every supported background job type to the handler
 * that performs the real work (progress updates are driven by the handler at
 * genuine milestones — the worker never injects fake progress).
 */
export const JOB_HANDLERS = {
  DISCOVERY: DISCOVERY_HANDLER,
  RESEARCH: RESEARCH_HANDLER,
  AI_RESEARCH: AI_RESEARCH_HANDLER,
  OPPORTUNITY_ANALYSIS: OPPORTUNITY_ANALYSIS_HANDLER,
  FINANCIAL_ANALYSIS: FINANCIAL_ANALYSIS_HANDLER,
  SOLUTION_MATCHING: SOLUTION_MATCHING_HANDLER,
  OUTREACH_GENERATION: OUTREACH_GENERATION_HANDLER,
  DEMO_GENERATION: DEMO_GENERATION_HANDLER,
};

export const JOB_TYPE_KEYS = Object.freeze(Object.keys(JOB_HANDLERS));

export const JOB_TYPE_LABELS = Object.fromEntries(
  Object.entries(JOB_HANDLERS).map(([key, h]) => [key, h.label])
);

export function getHandler(type) {
  return JOB_HANDLERS[String(type || '').toUpperCase()] || null;
}

export function isJobType(type) {
  return Boolean(getHandler(type));
}