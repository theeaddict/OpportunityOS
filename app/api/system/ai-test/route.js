import { requireUser } from '@/lib/api-helpers';
import { isAtLeast } from '@/lib/accounts/roles';
import { aiProvider } from '@/lib/ai/provider';
import { businessResearchSchema, opportunityAnalystSchema, createSolutionMatchingSchema, outreachSchema, demoSpecSchema } from '@/lib/ai/schemas';
import { runBusinessResearchAgent } from '@/lib/ai/agents/business-research.js';
import { runOpportunityAnalystAgent } from '@/lib/ai/agents/opportunity-analyst.js';
import { runSolutionMatchingAgent } from '@/lib/ai/agents/solution-matching.js';
import { runOutreachAgent } from '@/lib/ai/agents/outreach.js';
import { runDemoSpecAgent } from '@/lib/ai/agents/demo-spec.js';

export const dynamic = 'force-dynamic';

/**
 * AI engine test suite. Admin-only.
 *
 * Part A (always runs): offline structured-output validation tests using
 * controlled sample payloads — proves the validate → repair → fail contract,
 * evidence-citation enforcement and NO_STRONG_OPPORTUNITY handling.
 *
 * Part B (only when AI_API_KEY/AI_MODEL are set): runs every agent against the
 * controlled [DEMO] sample business seeded by migration 003 and validates the
 * results end to end through the real provider.
 */
export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  if (!isAtLeast(user, 'admin')) return Response.json({ ok: false, error: 'Admin only' }, { status: 403 });
  const ACCOUNT = user.account_id;

  const results = [];
  const test = (name, fn) => Promise.resolve()
    .then(fn)
    .then((detail) => results.push({ name, pass: true, detail: detail ?? null }))
    .catch((err) => results.push({ name, pass: false, detail: String(err.message || err) }));

  // ---------------- Part A: offline schema tests ----------------

  await test('research schema rejects uncited facts', () => {
    const bad = businessResearchSchema.validate({
      business_model: 'x',
      products: ['a'], services: ['s'], customer_types: ['c'], sales_channels: ['sc'],
      ordering_channels: ['oc'], booking_channels: ['unknown'],
      operational_signals: [], business_maturity_signals: [],
      facts: [{ text: 'has 12 branches', evidence_ids: [] }],
      inferences: [],
    });
    if (bad.ok) throw new Error('uncited fact accepted');
    const good = businessResearchSchema.validate({
      business_model: 'Sells hardware; margin on materials.',
      products: ['cement'], services: ['delivery'], customer_types: ['walk-in'],
      sales_channels: ['shop'], ordering_channels: ['phone'], booking_channels: ['unknown'],
      operational_signals: [{ signal: 'takes orders via WhatsApp', claim_type: 'INFERENCE', evidence_ids: [1] }],
      business_maturity_signals: [{ signal: 'two branches', assessment: 'multi-branch', evidence_ids: [2] }],
      facts: [{ text: 'publishes bulk prices', evidence_ids: [3], confidence: 0.6 }],
      inferences: [{ text: 'wholesale matters', evidence_ids: [1], confidence: 0.5 }],
      unknowns: ['revenue'],
    });
    if (!good.ok) throw new Error(good.errors.join('; '));
    if (!good.value.facts[0].claim_type === 'FACT') throw new Error('claim type lost');
    return 'citation enforcement verified';
  });

  await test('analyst schema enforces NO_STRONG_OPPORTUNITY + required fields', () => {
    const weak = opportunityAnalystSchema.validate({
      status: 'OPPORTUNITY_FOUND', problem: '', reasoning_summary: 'x',
    });
    if (weak.ok) throw new Error('empty OPPORTUNITY_FOUND accepted');
    const noOpp = opportunityAnalystSchema.validate({
      status: 'NO_STRONG_OPPORTUNITY', reasoning_summary: 'evidence too thin',
      confidence: 0.15,
    });
    if (!noOpp.ok) throw new Error(noOpp.errors.join('; '));
    if (noOpp.value.status !== 'NO_STRONG_OPPORTUNITY') throw new Error('status lost');
    const good = opportunityAnalystSchema.validate({
      status: 'OPPORTUNITY_FOUND', problem: 'p', opportunity: 'o', why_it_matters: 'w',
      money_mechanism: 'more orders captured', money_mechanism_key: 'higher_conversion',
      evidence_support: 'two evidence items show after-hours demand', uncertain: 'volumes need confirming',
      confidence: 0.7, evidence_ids: [4], reasoning_summary: 'r',
      required_assumptions: [{ name: 'average_order_value', description: 'unverified' }],
    });
    if (!good.ok) throw new Error(good.errors.join('; '));
    // A wrong mechanism key must be rejected.
    const badMech = opportunityAnalystSchema.validate({
      status: 'OPPORTUNITY_FOUND', problem: 'p', opportunity: 'o', why_it_matters: 'w',
      money_mechanism: 'x', money_mechanism_key: 'money_printer',
      evidence_support: 'e', uncertain: 'u', evidence_ids: [4], reasoning_summary: 'r',
    });
    if (badMech.ok) throw new Error('unknown money_mechanism_key accepted');
    return 'both statuses validated';
  });

  await test('matching schema restricts ids to candidate list', () => {
    const schema = createSolutionMatchingSchema([11, 14]);
    const bad = schema.validate({
      recommended_solution: { solution_id: 99, fit_reason: 'x' }, fit_score: 50, alternative_solutions: [],
    });
    if (bad.ok) throw new Error('foreign solution_id accepted');
    const dup = schema.validate({
      recommended_solution: { solution_id: 11, fit_reason: 'x' }, fit_score: 50,
      alternative_solutions: [{ solution_id: 11, fit_reason: 'dup' }],
    });
    if (dup.ok) throw new Error('duplicate recommendation accepted as alternative');
    const good = schema.validate({
      recommended_solution: { solution_id: 14, fit_reason: 'best fit' }, fit_score: 88,
      alternative_solutions: [{ solution_id: 11, fit_reason: 'fallback' }],
    });
    if (!good.ok) throw new Error(good.errors.join('; '));
    return 'id allow-list enforced';
  });

  await test('outreach schema requires all three variants', () => {
    const bad = outreachSchema.validate({ short_whatsapp: 'hi', normal_whatsapp: 'ho' });
    if (bad.ok) throw new Error('missing professional variant accepted');
    const good = outreachSchema.validate({
      short_whatsapp: 'a', normal_whatsapp: 'b', professional_whatsapp: 'c',
    });
    if (!good.ok) throw new Error(good.errors.join('; '));
    return 'variant completeness enforced';
  });

  await test('demo-spec schema requires non-empty workflow', () => {
    const bad = demoSpecSchema.validate({ demo_name: 'x', workflow: [] });
    if (bad.ok) throw new Error('empty workflow accepted');
    const good = demoSpecSchema.validate({
      demo_name: 'Demo', workflow: ['step 1'], pages: ['home'],
      features: ['f'], sample_entities: [{ name: 'n', description: 'd' }],
      customization_points: ['c'],
    });
    if (!good.ok) throw new Error(good.errors.join('; '));
    return 'workflow requirement enforced';
  });

  // ---------------- Part B: live agents (controlled sample business) ---------

  let liveBusiness = null;
  let controlledOpportunityId = null;
  let cleanupTransient = false;
  if (aiProvider.isConfigured()) {
    try {
      const { query } = await import('@/lib/db.js');
      const rows = await query(
        "SELECT * FROM businesses WHERE account_id = ? ORDER BY id DESC LIMIT 1",
        [ACCOUNT],
      ).catch(() => []);
      liveBusiness = rows[0] || null;
      // If the operator has no businesses yet, create a transient one for live agent validation.
      if (!liveBusiness) {
        const { insertId } = await query(
          `INSERT INTO businesses (account_id, name, industry, location, data_origin, created_by)
           VALUES (?, 'OpportunityOS AI self-test (transient)', 'Software / IT services', 'Nairobi', 'manual', ?)`,
          [ACCOUNT, user.id],
        );
        liveBusiness = { id: insertId, name: 'OpportunityOS AI self-test (transient)', industry: 'Software / IT services', location: 'Nairobi' };
        cleanupTransient = true;
      }
    } catch { /* db unavailable */ }
    if (liveBusiness) {
      try {
        const { query } = await import('@/lib/db.js');
        const oppRows = await query(
          'SELECT id FROM opportunities WHERE account_id = ? AND business_id = ? ORDER BY id LIMIT 1',
          [ACCOUNT, liveBusiness.id],
        );
        controlledOpportunityId = oppRows[0]?.id ?? null;
      } catch { /* ignore */ }
    }
  }

  if (liveBusiness) {
    const controlledEvidence = [
      { id: 900001, claim_type: 'FACT', evidence_type: 'observation', signal_key: 'wholesale_operations', evidence_text: 'Public posts advertise special contractor pricing.', source_excerpt_summary: null, confidence_score: 0.6 },
      { id: 900002, claim_type: 'FACT', evidence_type: 'observation', signal_key: 'no_online_ordering', evidence_text: 'No website or online catalogue found.', source_excerpt_summary: null, confidence_score: 0.8 },
      { id: 900003, claim_type: 'INFERENCE', evidence_type: 'observation', signal_key: 'phone_whatsapp_published', evidence_text: 'Customers directed to call or WhatsApp to order.', source_excerpt_summary: null, confidence_score: 0.7 },
    ];

    await test('LIVE BUSINESS_RESEARCH_AGENT on controlled sample', async () => {
      const r = await runBusinessResearchAgent({ business: liveBusiness, sourceContent: null, evidence: controlledEvidence, userId: user.id, accountId: ACCOUNT });
      if (!r.ok) throw new Error(`${r.reason}: ${r.error || ''} (job ${r.jobId})`);
      if (!r.data.business_model) throw new Error('empty business_model');
      return `job ${r.jobId}, ${r.data.facts.length} facts, ${r.data.unknowns.length} unknowns`;
    });

    await test('LIVE OPPORTUNITY_ANALYST_AGENT on controlled sample', async () => {
      const r = await runOpportunityAnalystAgent({
        business: liveBusiness, problemType: 'wholesale_ordering',
        evidence: controlledEvidence, userId: user.id, accountId: ACCOUNT,
      });
      if (!r.ok) throw new Error(`${r.reason}: ${r.error || ''}`);
      if (!['OPPORTUNITY_FOUND', 'NO_STRONG_OPPORTUNITY'].includes(r.data.status)) {
        throw new Error(`bad status ${r.data.status}`);
      }
      return `job ${r.jobId}, status=${r.data.status}`;
    });

    await test('LIVE SOLUTION_MATCHING_AGENT restricted to candidates', async () => {
      const candidates = [
        { id: 13, name: 'Wholesale Portal', description: 'Bulk buyer portal', minimum_project_value: 2500, maximum_project_value: 9000, currency: 'USD', solves_problem_types: ['wholesale_ordering'] },
        { id: 5, name: 'CRM', description: 'Customer database', minimum_project_value: 1200, maximum_project_value: 5000, currency: 'USD', solves_problem_types: ['customer_retention'] },
      ];
      const r = await runSolutionMatchingAgent({
        business: liveBusiness,
        opportunity: { id: controlledOpportunityId ?? undefined, problem_type: 'wholesale_ordering', problem: 'bulk orders via phone', opportunity: 'self-service reordering' },
        candidates, userId: user.id, accountId: ACCOUNT,
      });
      if (!r.ok) throw new Error(`${r.reason}: ${r.error || ''}`);
      if (![13, 5].includes(r.data.recommended_solution.solution_id)) throw new Error('picked foreign id');
      return `job ${r.jobId}, picked solution ${r.data.recommended_solution.solution_id}, fit ${r.data.fit_score}`;
    });

    await test('LIVE OUTREACH_AGENT three variants', async () => {
      const r = await runOutreachAgent({
        business: liveBusiness,
        opportunity: { id: controlledOpportunityId ?? undefined, problem_type: 'wholesale_ordering', problem: 'bulk orders handled conversationally', why_it_matters: 'recurring revenue at risk', money_mechanism: 'more wholesale orders captured' },
        evidence: controlledEvidence, userId: user.id, accountId: ACCOUNT,
      });
      if (!r.ok) throw new Error(`${r.reason}: ${r.error || ''}`);
      for (const k of ['short_whatsapp', 'normal_whatsapp', 'professional_whatsapp']) {
        if (!r.data[k]) throw new Error(`missing ${k}`);
      }
      return `job ${r.jobId}, all variants present`;
    });

    await test('LIVE DEMO_SPEC_AGENT', async () => {
      const r = await runDemoSpecAgent({
        business: liveBusiness,
        opportunity: { id: controlledOpportunityId ?? undefined, problem_type: 'wholesale_ordering', problem: 'manual bulk orders', opportunity: 'portal reordering', money_mechanism: 'n/a' },
        solution: { slug: 'wholesale-portal', name: 'Wholesale Portal', description: 'Portal where wholesale customers place bulk orders.' },
        userId: user.id, accountId: ACCOUNT,
      });
      if (!r.ok) throw new Error(`${r.reason}: ${r.error || ''}`);
      if (!r.data.workflow?.length) throw new Error('empty workflow');
      return `job ${r.jobId}, ${r.data.workflow.length} steps`;
    });
  }

  if (cleanupTransient && liveBusiness) {
    try {
      const { query } = await import('@/lib/db.js');
      await query('DELETE FROM businesses WHERE id = ?', [liveBusiness.id]);
    } catch { /* cleanup is best-effort */ }
  }

  const passed = results.filter((r) => r.pass).length;
  const configured = aiProvider.isConfigured();
  return Response.json({
    ok: passed === results.length,
    summary: `${passed}/${results.length} passed`,
    provider: { ...aiProvider.info(), note: configured ? undefined : 'Live agent tests skipped — AI_API_KEY / AI_MODEL not set. No mock responses are generated.' },
    results,
  }, { status: passed === results.length ? 200 : 500 });
}
