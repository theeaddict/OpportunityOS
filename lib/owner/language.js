/**
 * Business Owner Mode — plain-language phrasing.
 *
 * Translates internal engine state (stages, statuses, scores) into sentences a
 * business owner recognises. Nothing about agents, prompts, APIs, evidence
 * models or scoring algorithms appears here.
 */

import { problemLabel } from '@/lib/constants.js';

const STAGE_MESSAGES = {
  starting: 'Getting everything ready…',
  discovering: 'Looking for businesses that could be a good fit…',
  researching: 'Learning how each business operates…',
  checking_contacts: 'Finding the best way to reach each one…',
  analyzing: 'Checking what each business is dealing with…',
  identifying_opportunities: 'Spotting the most promising chances…',
  matching_solutions: 'Matching your offer to their needs…',
  calculating_scenarios: 'Working out how much this could be worth…',
  ranking: 'Ranking the choices from best to weakest…',
  saving_evidence: 'Keeping a record of what was found…',
  saving_matches: 'Recording the best options…',
};

export function stageMessage(stage) {
  return STAGE_MESSAGES[stage] || 'Working on it…';
}

export function statusMessage(status, progress, stage, error) {
  switch (status) {
    case 'queued':
      return 'In the queue — this usually takes under a minute.';
    case 'running':
      return stageMessage(stage) || 'Working on it…';
    case 'completed':
      return 'Done!';
    case 'failed':
      return 'Something went wrong and we could not finish. Please try again.';
    case 'cancelled':
      return 'You stopped this run. No one has been contacted.';
    default:
      return '';
  }
}

export function progressLabel(status, progress) {
  if (status === 'completed') return 'Complete';
  if (status === 'failed') return 'Could not finish';
  if (status === 'cancelled') return 'Stopped';
  return `${Math.max(0, Math.min(100, Number(progress) || 0))}%`;
}

/** Friendly priority from the internal score category. */
export function priorityFor(category) {
  const map = {
    HOT: { label: 'High priority', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    HIGH: { label: 'High priority', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    MEDIUM: { label: 'Medium priority', tone: 'text-blue-700 bg-blue-50 border-blue-200' },
    LOW: { label: 'Lower priority', tone: 'text-amber-700 bg-amber-50 border-amber-200' },
    REJECT: { label: 'Needs more checking', tone: 'text-gray-600 bg-gray-50 border-gray-200' },
  };
  return map[category] || { label: 'Medium priority', tone: 'text-blue-700 bg-blue-50 border-blue-200' };
}

function clean(str, max = 300) {
  return String(str || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Build one plain result card for an owner.
 * opp is a rich opportunity row (see opportunities.listByIds); the profile and
 * goal provide the owner's plain context.
 */
export function ownerResultItem(opp) {
  const why = clean(opp.why_it_matters || opp.problem, 280);
  const problem = opp.problem_type ? problemLabel(opp.problem_type) : null;
  const priority = priorityFor(opp.score_category || (opp.opportunity_score != null ? null : 'REJECT'));

  return {
    id: Number(opp.id),
    business_name: stripDemoTag(opp.business_name),
    business_location: opp.business_location || null,
    business_industry: opp.business_industry || null,
    priority,
    problem,
    why,
    score: opp.opportunity_score != null ? Number(opp.opportunity_score) : null,
  };
}

export function stripDemoTag(name) {
  return String(name || '').replace(/^\[DEMO\]\s*/i, '');
}

/**
 * A friendly, review-before-send message draft grounded in the owner's own
 * words and the customer's situation. It makes no specific product claims —
 * the owner fills in the details when they personalise it.
 */
export function ownerMessage({ customerName, ownerBusiness, ownerLocation, goal, why }) {
  const pitch = goal?.pitch || 'help businesses like yours grow in practical ways';
  const lines = [
    `Hi ${stripDemoTag(customerName) || 'there'},`,
    '',
    `We're ${clean(ownerBusiness, 120) || 'a local business'}${ownerLocation ? ` based around ${clean(ownerLocation, 60)}` : ''}, and we help businesses like yours ${pitch}.`,
  ];
  const note = clean(why, 220);
  if (note) lines.push(`\nFrom what's publicly available, ${note[0].toUpperCase()}${note.slice(1)}`);
  lines.push('\nIf you are open to a quick chat, I would love to share a few ideas — no pressure at all.');
  lines.push('\nWould you like me to send you a few specifics?');
  return lines.join('\n');
}