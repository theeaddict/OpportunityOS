import { problemLabel } from '@/lib/constants';
import { legacyMechanismForProblem } from './scenarios';

/**
 * Deterministic rule-based analyzer.
 *
 * 1. Candidate problem DETECTION from accepted evidence signals (gates which
 *    opportunities even get proposed — weak evidence means NO opportunity).
 * 2. Fallback ANALYSIS refinement when no LLM provider is configured. Never
 *    pretends to be AI: opportunities are stamped analysis_provider='rules'.
 */

const RULES = [
  {
    problem_type: 'wholesale_ordering',
    mechanism: 'additional_sales',
    requires: [['wholesale_operations', 'phone_whatsapp_published', 'public_phone_published'], ['no_online_ordering']],
    any_of_first: true,
    problem: 'Bulk/contractor buyers appear to order by phone or messaging with no self-service wholesale channel.',
    opportunity: 'A wholesale ordering portal could let contractors reorder in minutes without staff involvement, capturing repeat volume that currently leaks to faster-responding competitors.',
    why_it_matters: 'Wholesale orders are typically larger and more frequent than retail; friction in reordering puts this recurring revenue at risk and consumes owner time on every repeat purchase.',
    money_mechanism: 'Additional wholesale orders captured per month + staff hours released from manual order-taking',
    signals: ['wholesale_operations', 'phone_whatsapp_published', 'public_phone_published', 'no_online_ordering'],
  },
  {
    problem_type: 'manual_ordering',
    mechanism: 'faster_order_processing',
    requires: [['phone_whatsapp_published', 'public_phone_published', 'active_social_commerce']],
    any_of_first: true,
    problem: 'Orders appear to be handled conversationally (calls/messages) rather than through a structured ordering flow.',
    opportunity: 'A simple ordering flow (catalogue + order form or lightweight storefront) could convert after-hours demand and remove order-taking from busy staff.',
    why_it_matters: 'Conversational ordering loses details, slows responses outside working hours and makes order history invisible — each missed or misheard order is lost revenue.',
    money_mechanism: 'Additional orders converted outside working hours + fewer fulfillment errors',
    signals: ['phone_whatsapp_published', 'public_phone_published', 'active_social_commerce', 'no_online_ordering'],
  },
  {
    problem_type: 'lost_sales',
    mechanism: 'additional_sales',
    requires: [['unanswered_enquiries', 'no_online_ordering'], ['multiple_channels']],
    any_of_first: true,
    statement_fallback: true,
    problem: 'Demand signals exist across channels but there is no always-available way to convert them into orders.',
    opportunity: 'An always-on self-serve path (online catalogue/booking) would convert demand the business already generates but currently misses.',
    why_it_matters: 'Enquiries that arrive outside business hours or during busy periods currently have nowhere to go.',
    money_mechanism: 'Previously-missed enquiries converted into paying orders',
    signals: ['unanswered_enquiries', 'no_online_ordering', 'active_social_commerce'],
  },
  {
    problem_type: 'poor_conversion',
    mechanism: 'higher_conversion',
    requires: [['no_public_website']],
    problem: 'The business has a confirmed public listing and real customer activity but no website or self-service page of any kind.',
    opportunity: 'A simple website or booking/ordering page would capture the people who are already searching for this business online and currently land on nothing beyond a map pin.',
    why_it_matters: 'Anyone who searches for the business by name or nearby finds a listing with no way to see services, hours, or place an order — that demand quietly goes to whichever competitor has something to click through to.',
    money_mechanism: 'Search-driven enquiries and orders that currently have nowhere to land',
    signals: ['no_public_website'],
  },
  {
    problem_type: 'manual_booking',
    mechanism: 'reduced_missed_bookings',
    requires: [['no_booking_system']],
    problem: 'Appointments appear to be arranged manually by phone/message with no online booking.',
    opportunity: 'Online booking with automatic reminders could fill idle slots, cut no-shows and capture after-hours demand.',
    why_it_matters: 'Manual booking misses after-hours demand and creates no-shows without reminders; both directly reduce billable capacity.',
    money_mechanism: 'More booked appointments per week + reduced no-shows',
    signals: ['no_booking_system'],
  },
  {
    problem_type: 'inventory_problems',
    mechanism: 'reduced_stock_outs',
    requires: [['manual_stock_tracking', 'inventory_complexity']],
    any_of_first: true,
    problem: 'Stock appears to be tracked manually despite a complex inventory.',
    opportunity: 'Live stock tracking with low-stock alerts could prevent stock-outs on fast movers and free cash tied up in slow movers.',
    why_it_matters: 'Manual stock tracking leads to stock-outs on fast movers and cash tied up in slow movers — both are direct margin losses.',
    money_mechanism: 'Avoided stock-out losses + reduced excess-stock holding',
    signals: ['manual_stock_tracking', 'inventory_complexity'],
  },
  {
    problem_type: 'multi_branch_management',
    mechanism: 'reduced_administrative_labor',
    requires: [['multiple_branches', 'no_reporting']],
    any_of_first: false,
    problem: 'Multiple locations appear to operate without consolidated reporting or shared systems.',
    opportunity: 'A shared system with consolidated reporting would surface underperforming branches early and pool purchasing decisions.',
    why_it_matters: 'Without consolidated visibility across branches, slow-moving locations hide until they have already lost customers, and purchasing power is fragmented.',
    money_mechanism: 'Earlier intervention on weak branches + consolidated purchasing savings',
    signals: ['multiple_branches', 'no_reporting'],
  },
  {
    problem_type: 'delivery_management',
    mechanism: 'better_capacity_utilization',
    requires: [['delivery_operations', 'delivery_coordination_pain']],
    any_of_first: false,
    problem: 'Own delivery operations appear to be coordinated ad-hoc.',
    opportunity: 'A dispatch board with rider assignment and proof of delivery could cut late/failed deliveries and their refund costs.',
    why_it_matters: 'Ad-hoc dispatch causes late or failed deliveries, refund requests and repeat support calls — all expensive forms of churn.',
    money_mechanism: 'Fewer refunds/redeliveries + retained customers',
    signals: ['delivery_operations', 'delivery_coordination_pain'],
  },
  {
    problem_type: 'quotation_management',
    mechanism: 'higher_conversion',
    requires: [['slow_quote_turnaround', 'high_value_products']],
    any_of_first: true,
    problem: 'Quotes appear to be prepared manually per enquiry, slowing response times.',
    opportunity: 'Templated quote generation could cut response time from days to hours — often decisive in high-value sales.',
    why_it_matters: 'In high-value sales the first professional quote usually wins; slow manual quoting hands orders to faster competitors.',
    money_mechanism: 'Higher quote win-rate on existing enquiry volume',
    signals: ['slow_quote_turnaround', 'high_value_products'],
  },
  {
    problem_type: 'payment_reconciliation',
    mechanism: 'better_payment_reconciliation',
    requires: [['cash_reconciliation_gaps']],
    problem: 'Payments appear to be reconciled manually with known gaps.',
    opportunity: 'Automatic payment matching could stop silent revenue leakage and reclaim admin hours that scale with volume.',
    why_it_matters: 'Unreconciled payments leak revenue silently and consume admin hours that scale linearly with transaction volume.',
    money_mechanism: 'Leakage recovered + admin hours saved',
    signals: ['cash_reconciliation_gaps'],
  },
  {
    problem_type: 'customer_retention',
    mechanism: 'higher_repeat_purchase',
    requires: [['no_customer_records', 'repeat_customer_mentions']],
    any_of_first: true,
    problem: 'There appear to be no structured customer records to support follow-up and repeat sales.',
    opportunity: 'A simple customer database with follow-up reminders could turn one-time buyers into scheduled repeat revenue.',
    why_it_matters: 'Businesses with evident repeat custom leave money on the table when no one tracks who bought what and when a check-in is due.',
    money_mechanism: 'Increased repeat-purchase rate on the existing customer base',
    signals: ['no_customer_records', 'repeat_customer_mentions'],
  },
  {
    problem_type: 'customer_service',
    mechanism: 'higher_conversion',
    requires: [['unanswered_enquiries']],
    problem: 'Customer enquiries show signs of going unanswered during busy periods.',
    opportunity: 'A shared enquiry queue would prevent messages from being dropped and make response times visible.',
    why_it_matters: 'Every unanswered enquiry is a competitor\u2019s opportunity; a shared queue prevents messages from being dropped.',
    money_mechanism: 'Enquiries rescued from being dropped',
    signals: ['unanswered_enquiries'],
  },
  {
    problem_type: 'order_tracking',
    mechanism: 'faster_order_processing',
    requires: [['order_tracking_pain']],
    problem: 'Customers and staff appear to struggle to track where orders are in fulfilment.',
    opportunity: 'Order status tracking would cut status-enquiry workload and catch stuck orders before customers complain.',
    why_it_matters: 'Without a status view, mistakes compound during busy periods and status enquiries consume staff time.',
    money_mechanism: 'Staff hours saved + fewer compensation refunds for stuck orders',
    signals: ['order_tracking_pain'],
  },
];

export function detectCandidateProblems(signals, evidenceBySignal) {
  const candidates = [];
  for (const rule of RULES) {
    const [firstSet, secondSet] = rule.requires;
    const match = (set) => (rule.any_of_first === false ? set.every((k) => signals[k]) : set.some((k) => signals[k]));
    const hasFirst = match(firstSet);
    const hasSecond = !secondSet || match(secondSet);
    if (!hasFirst || !hasSecond) continue;

    // Supporting evidence rows for transparency
    const supporting = [];
    for (const key of rule.signals) {
      for (const ev of evidenceBySignal[key] || []) supporting.push(ev);
    }
    if (!supporting.length) continue;

    const avgConf = supporting.reduce((s, e) => s + Number(e.confidence_score), 0) / supporting.length;
    if (avgConf < 0.4) continue; // too weak to propose — say NO rather than invent

    const mechanism = rule.mechanism || legacyMechanismForProblem(rule.problem_type) || 'additional_sales';

    candidates.push({
      problem_type: rule.problem_type,
      problem_label: problemLabel(rule.problem_type),
      title: `${problemLabel(rule.problem_type)} at a growing business`,
      problem: rule.problem,
      opportunity_text: rule.opportunity,
      why_it_matters: rule.why_it_matters,
      money_mechanism: rule.money_mechanism,
      money_mechanism_key: mechanism,
      explanation: buildExplanation({
        problem_type: rule.problem_type,
        problem: rule.problem,
        opportunity: rule.opportunity,
        why_it_matters: rule.why_it_matters,
        money_mechanism: rule.money_mechanism,
        mechanism,
        supporting,
        avgConf,
      }),
      supporting_evidence_ids: [...new Set(supporting.map((e) => e.id))],
      severity: Math.round(2 + avgConf * 3), // 2..5 based on confidence
      signal_confidence: avgConf,
    });
  }
  return candidates;
}

/**
 * Build the structured 4-part explanation the detection engine must produce:
 *   why_exists       — WHY this opportunity exists
 *   evidence_support — WHAT evidence supports it
 *   money_impact     — HOW money could be affected
 *   uncertain        — WHAT remains uncertain
 */
export function buildExplanation({ problem_type, problem, opportunity, why_it_matters, money_mechanism, mechanism, supporting, avgConf }) {
  const cited = [...new Set(supporting.map((e) => e.signal_key))].filter(Boolean);
  return {
    why_exists: why_it_matters || problem,
    evidence_support: `Evidence points to ${problem.toLowerCase()} across ` +
      `${cited.length || 1} independent signal${cited.length === 1 ? '' : 's'} ` +
      `${cited.length ? `(${cited.join(', ')})` : ''}, with average confidence ${Math.round(avgConf * 100)}%.`,
    money_impact: money_mechanism,
    uncertain: `The ${mechanism.replaceAll('_', ' ')} magnitude depends on assumptions not yet confirmed with the business (volumes, order values, current waste/leakage). These are illustrative until confirmed.`,
  };
}

/** Reject an opportunity whose supporting evidence is too weak to stand. */
export function shouldRejectCandidate(candidate) {
  if (!candidate) return { reject: true, reason: 'no candidate' };
  if (candidate.signal_confidence < 0.4) {
    return { reject: true, reason: 'evidence too weak to propose' };
  }
  if (!candidate.money_mechanism_key) {
    return { reject: true, reason: 'no plausible financial mechanism' };
  }
  return { reject: false };
}

/**
 * Refine an existing opportunity without AI. Same shape as the LLM task output
 * so downstream scoring/matching behaves identically either way.
 */
export function rulesRefinement(opportunity, evidenceRows) {
  return {
    problem_statement: opportunity.problem,
    why_it_matters: opportunity.why_it_matters,
    reasoning_claims: evidenceRows.slice(0, 4).map((e) => ({
      claim_type: e.claim_type === 'FACT' ? 'inference' : String(e.claim_type).toLowerCase(),
      title: `Based on: ${String(e.evidence_text).slice(0, 80)}`,
      summary: e.source_excerpt_summary || String(e.evidence_text).slice(0, 160),
    })),
    solution_capabilities: [],
    outreach_angle: null,
    next_action: 'Call or message to confirm how this process works today before proposing anything.',
    _note: 'Generated by the deterministic rule engine (no LLM configured).',
  };
}

// Template fallbacks when no LLM is configured.
export function templateOutreach({ business, opportunity, scenarioSentence }) {
  const lines = [
    'Hello,',
    '',
    `I was looking at ${business.name}${business.location ? ` in ${business.location}` : ''} and noticed: ${opportunity.problem}`,
    '',
    opportunity.why_it_matters,
    '',
    scenarioSentence || '',
    '',
    'If useful, I can show you what a fix would look like in a 20-minute walkthrough — no obligation.',
    '',
    'Best regards,',
  ];
  return {
    subject: `Idea for ${business.name}: ${problemLabel(opportunity.problem_type).toLowerCase()}`,
    body: lines.filter((l) => l !== '').join('\n').replace('\n\n\n', '\n\n'),
    claims_used: [],
    _note: 'Template-generated (no LLM configured). Review before sending.',
  };
}

export function templateDemoSpec(business, opportunity, solution) {
  return {
    demo_name: `${solution.name} — ${business.name}`,
    pages: [
      'Login & home dashboard',
      `Core workflow screen (${String(solution.solves_problem_types?.[0] || opportunity.problem_type).replaceAll('_', ' ')})`,
      'Owner reports view',
    ],
    features: [
      `${solution.name}: ${String(solution.description).slice(0, 120)}`,
      'Mobile-friendly data entry for staff',
      'Daily summary for the owner',
    ],
    workflow: [
      'Recap their current process and confirm our understanding',
      'Walk the same process through the system, end to end',
      'Show the owner view: open items, alerts, daily totals',
      'Discuss setup, training and timeline',
    ],
    sample_entities: [
      { name: 'Sample customer/order records', description: 'Clearly fictional example data mirroring a typical day' },
      { name: 'Sample products/services', description: 'Representative of their industry, not copied from their catalogue' },
    ],
    customization_points: [
      'Fields and terminology matched to their vocabulary',
      'Reports shaped around the numbers they actually track',
    ],
    _note: 'Template-generated (no LLM configured).',
  };
}
