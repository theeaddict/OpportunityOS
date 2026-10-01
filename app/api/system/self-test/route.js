import { requireUser, requireSuperadmin } from '@/lib/api-helpers';
import { isAtLeast } from '@/lib/accounts/roles';
import * as businessesRepo from '@/lib/repositories/businesses';
import * as evidenceRepo from '@/lib/repositories/evidence';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import * as financialRepo from '@/lib/repositories/financial';
import * as solutionsRepo from '@/lib/repositories/solutions';
import * as outreachRepo from '@/lib/repositories/outreach';
import * as jobsRepo from '@/lib/repositories/jobs';
import { normalizeBusinessName, normalizePhone, normalizeWebsite, normalizeSocialHandle, inferContactType } from '@/lib/normalize';
import { parseRobots, htmlToText } from '@/lib/services/research/polite-fetcher';
import { PROBLEM_TYPE_KEYS, SCORE_WEIGHTS, MONEY_MECHANISMS, MONEY_MECHANISM_KEYS, DEFAULT_SCORE_THRESHOLDS } from '@/lib/constants';
import { buildScenariosByMechanism, midpointAnnualPotential, SCENARIO_TEMPLATES, computeFinancialScenario, buildFinancialScenariosForMechanism, FINANCIAL_SCENARIOS, FINANCIAL_SCENARIO_KEYS } from '@/lib/services/analysis/scenarios';
import { shouldRejectCandidate } from '@/lib/services/analysis/rules-analyzer';
import { matchSolutions } from '@/lib/services/analysis/matching';
import { computeScore, buildScoreReasons, classifyScore, abilityToPayFactor } from '@/lib/services/analysis/scoring';

export const dynamic = 'force-dynamic';

/**
 * Repository self-test. Admin-only; exercises every required repository
 * function against the live database with throwaway records and cleans up.
 * Run: curl -b session -X POST http://localhost:3000/api/system/self-test | jq
 */
export async function POST() {
  // Platform-operator tool: it creates/deletes accounts and users, so a
  // workspace admin (which every self-serve signup is) must not reach it. It
  // needs BOTH a platform-admin session and a workspace session to run against.
  const platformAdmin = await requireSuperadmin().catch(() => null);
  if (!platformAdmin) return Response.json({ ok: false, error: 'Platform administrator sign-in required' }, { status: 403 });
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  if (!isAtLeast(user, 'admin')) return Response.json({ ok: false, error: 'Admin only' }, { status: 403 });
  const ACCOUNT = user.account_id;

  const results = [];
  let createdIds = {};
const test = (name, fn) => fn()
    .then((detail) => results.push({ name, pass: true, detail }))
    .catch((err) => results.push({ name, pass: false, detail: String(err.message || err) }));

function sumDefault([ev, pr, mo, sf, ma, ap, cx, ca]) {
  return ev * SCORE_WEIGHTS.evidence_strength + pr * SCORE_WEIGHTS.problem_severity
    + mo * SCORE_WEIGHTS.money_potential + sf * SCORE_WEIGHTS.solution_fit
    + ma * SCORE_WEIGHTS.business_maturity + ap * SCORE_WEIGHTS.ability_to_pay
    + cx * SCORE_WEIGHTS.operational_complexity + ca * SCORE_WEIGHTS.contactability;
}

// Assert the full required output shape + the computed low/base/high values.
  const expectCalc = (s, low, base, high, key) => {
    if (!s) throw new Error('scenario is null');
    for (const field of ['scenario_name', 'formula', 'assumptions', 'low_value', 'high_value', 'currency', 'period', 'is_illustrative']) {
      if (!(field in s)) throw new Error(`missing output field: ${field}`);
    }
    if (!Array.isArray(s.assumptions) || !s.assumptions.length) throw new Error('no assumptions in output');
    if (s.scenario_key !== key) throw new Error(`key ${s.scenario_key} != ${key}`);
    if (s.low_value !== low) throw new Error(`${key} low=${s.low_value} expected ${low}`);
    if (s.base_value !== base) throw new Error(`${key} base=${s.base_value} expected ${base}`);
    if (s.high_value !== high) throw new Error(`${key} high=${s.high_value} expected ${high}`);
  };

  const stamp = `selftest-${Date.now()}`;

  // --- Normalisation ---
  await test('normalizeBusinessName strips suffixes/punctuation', async () => {
    const a = normalizeBusinessName('Jua Hardware & Building Supplies Ltd');
    const b = normalizeBusinessName('jua hardware building supplies');
    if (a !== b) throw new Error(`'${a}' != '${b}'`);
    return a;
  });

  await test('normalizePhone produces E.164-style value', async () => {
    const p = normalizePhone('+254 (0)700-000-001');
    if (p !== '+2540700000001'.slice(0, p.length) && !/^\+\d+$/.test(p)) throw new Error(p);
    if (normalizeWebsite('https://WWW.Example.com/path/') !== 'example.com/path') {
      throw new Error(normalizeWebsite('https://WWW.Example.com/path/'));
    }
    if (inferContactType('info@x.co') !== 'email') throw new Error('email inference failed');
    return p;
  });

  await test('normalizeSocialHandle extracts platform + handle', async () => {
    const fb = normalizeSocialHandle('https://www.facebook.com/jua-hardware');
    if (!fb || fb.platform !== 'facebook') throw new Error(JSON.stringify(fb));
    if (fb.normalized !== 'facebook:jua-hardware') throw new Error(fb.normalized);
    const ig = normalizeSocialHandle('https://instagram.com/teststore', 'instagram');
    if (!ig || ig.platform !== 'instagram') throw new Error(JSON.stringify(ig));
    const same = normalizeSocialHandle('https://fb.com/jua-hardware', 'facebook');
    if (!same || same.normalized !== fb.normalized) throw new Error('alias fb.com should normalize to the same id as facebook.com');
    return `fb=${fb.normalized} ig=${ig.normalized}`;
  });

  // --- Business CRUD + dedup ---
  await test('createBusiness + findBusiness', async () => {
    const id = await businessesRepo.createBusiness({
      account_id: ACCOUNT,
      name: `${stamp} Test Traders Ltd`, industry: 'Retail', location: 'Testville',
      website: `https://www.${stamp}.example/`, phone: '+254 711 222 333',
    });
    const found = await businessesRepo.findBusiness(ACCOUNT, id);
    if (!found || found.normalized_name !== normalizeBusinessName(`${stamp} Test Traders`)) {
      throw new Error(`normalized_name=${found?.normalized_name}`);
    }
    if (found.phone_normalized !== '+254711222333') throw new Error(found.phone_normalized);
    createdIds.business = id;
    return `id=${id}`;
  });

  await test('dedup: findOrCreateBusiness returns existing on same name', async () => {
    const r = await businessesRepo.findOrCreateBusiness(ACCOUNT, { name: `${stamp} Test Traders PLC` });
    if (r.created) throw new Error('created a duplicate!');
    createdIds.duplicateId = r.id;
    return 'duplicate detected';
  });

  await test('addSource with external identifier', async () => {
    createdIds.source = await businessesRepo.addSource({
      account_id: ACCOUNT,
      business_id: createdIds.business, source_type: 'web_directory',
      source_name: `${stamp} directory`, source_url: `https://${stamp}.example/src`,
      external_identifier: `${stamp}-ext-1`,
    });
    return `source_id=${createdIds.source}`;
  });

  // --- Contact verification rules ---
  await test('addContact normalizes phone + dedupes', async () => {
    const id1 = await businessesRepo.addContact({
      account_id: ACCOUNT,
      business_id: createdIds.business, contact_type: 'phone',
      contact_value: '+254 711 222 333', verification_status: 'source_published',
      confidence_score: 0.8, source_id: createdIds.source,
    });
    const id2 = await businessesRepo.addContact({
      account_id: ACCOUNT,
      business_id: createdIds.business, contact_type: 'phone',
      contact_value: '+254711222333', verification_status: 'user_confirmed',
      confidence_score: 0.9,
    });
    if (id1 !== id2) throw new Error(`not deduped: ${id1} vs ${id2}`);
    return 'phone normalized and deduped';
  });

  await test('whatsapp without source_published or user_confirmed is rejected', async () => {
    try {
      await businessesRepo.addContact({
        account_id: ACCOUNT,
        business_id: createdIds.business, contact_type: 'whatsapp',
        contact_value: '+254 711 999 888', verification_status: 'unverified',
      });
      throw new Error('should have been rejected');
    } catch (err) {
      if (!/WhatsApp/.test(err.message)) throw err;
      return 'correctly rejected unverified whatsapp';
    }
  });

  await test('whatsapp with source_published becomes verified_public_whatsapp', async () => {
    const cid = await businessesRepo.addContact({
      account_id: ACCOUNT,
      business_id: createdIds.business, contact_type: 'whatsapp',
      contact_value: '+254 711 999 888', verification_status: 'source_published',
      confidence_score: 0.9,
    });
    const rows = await businessesRepo.listContacts(ACCOUNT, createdIds.business);
    const wa = rows.find((r) => r.id === cid);
    if (!wa) throw new Error('contact not found');
    if (wa.verification_status !== 'verified_public_whatsapp') {
      throw new Error(`status=${wa.verification_status} (expected verified_public_whatsapp)`);
    }
    return 'source_published -> verified_public_whatsapp';
  });

  await test('phone without explicit whatsapp status becomes phone_only', async () => {
    const cid = await businessesRepo.addContact({
      account_id: ACCOUNT,
      business_id: createdIds.business, contact_type: 'phone',
      contact_value: '+254 700 111 222', verification_status: 'unverified',
      confidence_score: 0.5,
    });
    const rows = await businessesRepo.listContacts(ACCOUNT, createdIds.business);
    const ph = rows.find((r) => r.id === cid);
    if (!ph) throw new Error('contact not found');
    if (ph.verification_status !== 'phone_only') {
      throw new Error(`status=${ph.verification_status} (expected phone_only)`);
    }
    return 'unverified phone -> phone_only';
  });

  // --- Evidence ---
  await test('addEvidence with claim types + signalsForBusiness', async () => {
    createdIds.evidence = [];
    for (const [ct, sig] of [['FACT', 'no_online_ordering'], ['INFERENCE', 'phone_whatsapp_published']]) {
      createdIds.evidence.push(await evidenceRepo.addEvidence({
        account_id: ACCOUNT,
        business_id: createdIds.business, evidence_type: 'observation', claim_type: ct,
        signal_key: sig, evidence_text: `${stamp} evidence (${ct})`,
        source_excerpt_summary: 'excerpt', confidence_score: 0.75, captured_by: user.id,
      }));
    }
    const signals = await evidenceRepo.signalsForBusiness(ACCOUNT, createdIds.business);
    if (!signals.no_online_ordering) throw new Error('signal missing');
    if (signals.no_online_ordering.max_confidence !== 0.75) throw new Error('confidence mismatch');
    return '2 evidence rows, signals aggregated';
  });

  await test('unconfirmed HYPOTHESIS never drives signal detection', async () => {
    // A high-confidence hypothesis must be stored but must NOT contribute to
    // the signals that drive automatic opportunity detection.
    createdIds.hypothesis = await evidenceRepo.addEvidence({
      account_id: ACCOUNT,
      business_id: createdIds.business, evidence_type: 'observation', claim_type: 'HYPOTHESIS',
      signal_key: 'from_hypothesis_only', evidence_text: `${stamp} unconfirmed hypothesis`,
      source_excerpt_summary: 'hunch', confidence_score: 0.99, captured_by: user.id,
    });
    const signals = await evidenceRepo.signalsForBusiness(ACCOUNT, createdIds.business);
    if (signals.from_hypothesis_only) throw new Error('hypothesis leaked into signals');
    const bySignal = await evidenceRepo.evidenceBySignal(ACCOUNT, createdIds.business);
    if (bySignal.from_hypothesis_only) throw new Error('hypothesis leaked into evidenceBySignal');
    const stored = await evidenceRepo.findById(ACCOUNT, createdIds.hypothesis);
    if (stored.claim_type !== 'HYPOTHESIS') throw new Error(`claim_type mangled: ${stored.claim_type}`);
    // Same signal key arriving as FACT still counts (detection is evidence-driven).
    createdIds.evidence.push(await evidenceRepo.addEvidence({
      account_id: ACCOUNT,
      business_id: createdIds.business, evidence_type: 'observation', claim_type: 'FACT',
      signal_key: 'from_hypothesis_only', evidence_text: `${stamp} confirmed fact`,
      confidence_score: 0.8, captured_by: user.id,
    }));
    const signals2 = await evidenceRepo.signalsForBusiness(ACCOUNT, createdIds.business);
    if (!signals2.from_hypothesis_only) throw new Error('FACT signal should count after hypothesis exclusion');
    return 'hypothesis stored but excluded from detection signals; FACT still counts';
  });

  // --- Opportunity + scoring ---
  await test('createOpportunity + attachEvidence + per-dimension scoring (canonical round-once overall)', async () => {
    const oppId = await opportunitiesRepo.createOpportunity({
      account_id: ACCOUNT,
      business_id: createdIds.business, title: `${stamp} opportunity`,
      problem_type: 'manual_ordering',
      problem: 'test problem', opportunity: 'test opportunity text',
      why_it_matters: 'test why', money_mechanism: 'test mechanism', created_by: user.id,
    });
    createdIds.opportunity = oppId;
    await opportunitiesRepo.attachEvidence(ACCOUNT, oppId, createdIds.evidence[1], 0.9);
    const linked = await opportunitiesRepo.linkedEvidence(ACCOUNT, oppId);
    if (!linked.length || Number(linked[0].relevance_score) !== 0.9) throw new Error('attachEvidence failed');
    const { score, category, subscores, reasons } = await opportunitiesRepo.updateAnalysis(ACCOUNT, oppId, {
      evidence_strength: 90,  // 18/20
      problem_severity: 93,    // 14/15
      money_potential: 100,    // 15/15
      solution_fit: 100,       // 15/15
      business_maturity: 90,   // 9/10
      ability_to_pay: 90,      // 9/10
      operational_complexity: 90, // 9/10 (since >70 default DB default)
      contactability: 100,     // 5/5
      confidence_score: 0.90, next_action: 'test action',
      analysis_provider: 'rules',
    });
    // Canonical scoring: the badge AND the narrative "Overall" reason both equal the
    // UNROUNDED weighted sum rounded once (never a sum of per-dimension rounded
    // values). Floating-point drift is fine as long as both stay identical.
    const expected = Math.round(sumDefault([90, 93, 100, 100, 90, 90, 90, 100]));
    if (score !== expected) throw new Error(`score ${score} != ${expected}`);
    if (category !== 'HOT') throw new Error(`expected HOT, got ${category}`);
    const overallReason = reasons.find((r) => r.dimension === 'overall');
    if (!overallReason) throw new Error('overall reason missing');
    if (overallReason.score !== score) throw new Error(`overall reason score ${overallReason.score} != badge ${score}`);
    if (!subscores.find((s) => s.output === 'evidence_score' && s.score === 18 && s.max === 20)) throw new Error('evidence out-of subscore wrong');
    if (!overallReason.reason.includes(`${expected}/100`)) throw new Error('overall reason missing score');
    const row = await opportunitiesRepo.findById(ACCOUNT, oppId);
    if (row.evidence_strength_score !== 90 || row.score_category !== 'HOT' || !row.score_reasons) throw new Error('columns not persisted');
    return `score=${score} (HOT), reasons persisted`;
  });

  await test('scoring classification + custom thresholds + follower is capped support', async () => {
    const hot = classifyScore(90, DEFAULT_SCORE_THRESHOLDS);
    if (hot.label !== 'HOT' || hot.min !== 90) throw new Error('classify boundary');
    const med = classifyScore(66, DEFAULT_SCORE_THRESHOLDS);
    if (med.label !== 'MEDIUM' || med.min !== 65) throw new Error(`66 should be MEDIUM, got ${med.label}`);
    if (classifyScore(64, DEFAULT_SCORE_THRESHOLDS).label !== 'LOW') throw new Error('64 should be LOW');
    if (classifyScore(49, DEFAULT_SCORE_THRESHOLDS).label !== 'REJECT') throw new Error('49 should be REJECT');
    // configurable thresholds: raising the HIGH bound re-bins an 85 from HIGH to MEDIUM
    if (classifyScore(85, { ...DEFAULT_SCORE_THRESHOLDS, high: 90 }).label !== 'MEDIUM') throw new Error('raising high must re-bin 85 to MEDIUM');
    // follower count is only a capped supporting signal in the commercial dimension
    const baseAp = abilityToPayFactor({}, null);
    const withFollowers = abilityToPayFactor({}, null, 999999);
    if (withFollowers <= baseAp) throw new Error('follower count should nudge commercial evidence');
    if (withFollowers - baseAp > 5) throw new Error(`follower support must be bounded (got +${withFollowers - baseAp})`);
    return `HOT=90, default->MEDIUM, thresholds raise REJECT, follower cap ok`;
  });

  await test('problem_type keys match PROBLEM_TYPE_KEYS constant', async () => {
    if (!Array.isArray(PROBLEM_TYPE_KEYS) || PROBLEM_TYPE_KEYS.length < 15) {
      throw new Error(`only ${PROBLEM_TYPE_KEYS?.length} problem types`);
    }
    if (!PROBLEM_TYPE_KEYS.includes('manual_ordering')) throw new Error('manual_ordering missing');
    if (!PROBLEM_TYPE_KEYS.includes('lost_sales')) throw new Error('lost_sales missing');
    return `${PROBLEM_TYPE_KEYS.length} problem types`;
  });

  // --- Solution matching ---
  await test('matchSolution persists project values', async () => {
    const sols = await solutionsRepo.list({ accountId: ACCOUNT, activeOnly: true });
    if (!sols.length) throw new Error('solution library empty');
    createdIds.solution = sols[0].id;
    await opportunitiesRepo.replaceSolutionMatches(ACCOUNT, createdIds.opportunity, [
      { solution_id: createdIds.solution, fit_score: 88, reason: 'self-test match',
        recommended: true,
        project_value_low: sols[0].minimum_project_value,
        project_value_high: sols[0].maximum_project_value },
    ]);
    const links = await opportunitiesRepo.solutionLinks(ACCOUNT, createdIds.opportunity);
    if (!links[0].recommended || links[0].fit_score !== 88) throw new Error('match not stored');
    return `matched ${links[0].solution_name}`;
  });

  // --- Solution matching engine: 4-fit scoring, recommended vs alternatives ---
  await test('matchSolutions returns 4 fit dimensions + project value + why, ranked', async () => {
    const sols = await solutionsRepo.list({ accountId: ACCOUNT, activeOnly: true });
    if (sols.length < 5) throw new Error('need >= 5 active solutions');
    const ranked = matchSolutions(sols, {
      business: { industry: 'Retail' },
      problem_type: 'manual_ordering',
      signals: { existing_digital_systems: true, high_transaction_volume: true },
      capabilities: ['order tracking', 'inventory'],
    });
    if (!ranked.length) throw new Error('no matches returned');
    const top = ranked[0];
    for (const f of ['problem_fit', 'industry_fit', 'technical_fit', 'commercial_fit']) {
      if (typeof top[f] !== 'number' || top[f] < 0 || top[f] > 100) throw new Error(`${f} invalid: ${top[f]}`);
    }
    if (typeof top.fit_score !== 'number') throw new Error('fit_score missing');
    if (!top.project_value || typeof top.project_value.low !== 'number') throw new Error('project_value missing');
    if (!top.why || typeof top.why !== 'string') throw new Error('why missing');
    const sorted = ranked.every((m, i) => i === 0 || ranked[i - 1].fit_score >= m.fit_score);
    if (!sorted) throw new Error('not sorted by fit_score desc');
    return `top=${top.name} fit=${top.fit_score} problem=${top.problem_fit} industry=${top.industry_fit} technical=${top.technical_fit} commercial=${top.commercial_fit}`;
  });

  await test('recommended ranks first; alternatives follow; top has best problem fit', async () => {
    const sols = await solutionsRepo.list({ accountId: ACCOUNT, activeOnly: true });
    const ranked = matchSolutions(sols, { business: { industry: 'Retail' }, problem_type: 'manual_ordering', signals: {} });
    if (!ranked.length) throw new Error('no matches');
    const recommended = ranked[0];
    const direct = ranked.find((m) => {
      const s = sols.find((x) => x.id === m.solution_id);
      return s && (s.solves_problem_types || []).includes('manual_ordering');
    });
    if (direct && direct.solution_id !== recommended.solution_id) {
      // Direct solvers must rank above adjacent solvers
      if (recommended.problem_fit < direct.problem_fit) throw new Error('a direct solver outranks the recommendation');
    }
    if (ranked.length < 2) throw new Error('no alternatives found');
    if (ranked[1].fit_score > recommended.fit_score) throw new Error('alternative outranks recommended');
    return `recommended=${ranked[0].name} alternatives=${ranked.length - 1}`;
  });

  await test('project value comes from configured solution pricing (never invented)', async () => {
    const sols = await solutionsRepo.list({ accountId: ACCOUNT, activeOnly: true });
    const s = sols.find((x) => x.slug === 'order-management');
    if (!s) throw new Error('order-management solution missing');
    const ranked = matchSolutions([s], { business: { industry: 'Retail' }, problem_type: 'manual_ordering', signals: {} });
    if (!ranked.length) throw new Error('no match for order-management');
    const m = ranked[0];
    if (m.project_value.low !== Number(s.project_value.low)) throw new Error(`low ${m.project_value.low} != config ${s.project_value.low}`);
    if (m.project_value.base !== Number(s.project_value.base)) throw new Error(`base ${m.project_value.base} != config ${s.project_value.base}`);
    if (m.project_value.high !== Number(s.project_value.high)) throw new Error(`high ${m.project_value.high} != config ${s.project_value.high}`);
    return `order-management KES ${m.project_value.low}/${m.project_value.base}/${m.project_value.high}`;
  });

  await test('canonical library seeded with configurable project pricing', async () => {
    const sols = await solutionsRepo.all(ACCOUNT);
    if (sols.length < 21) throw new Error(`expected >=21 solutions, got ${sols.length}`);
    const om = sols.find((x) => x.slug === 'order-management');
    if (!om) throw new Error('order-management missing');
    if (om.name !== 'Order Management') throw new Error(`name ${om.name}`);
    if (Number(om.project_value.low) !== 80000 || Number(om.project_value.base) !== 120000 || Number(om.project_value.high) !== 200000) {
      throw new Error(`order-management pricing ${JSON.stringify(om.project_value)}`);
    }
    if (om.currency !== 'KES') throw new Error(`currency ${om.currency}`);
    if (om.demo_template !== 'ts-order-management') throw new Error(`demo ${om.demo_template}`);
    if (!Array.isArray(om.features) || !om.features.length) throw new Error('features missing');
    return `${sols.length} solutions seeded incl Order Management 80k/120k/200k KES`;
  });

  await test('library CRUD: create/update/activate a solution with all fields', async () => {
    const sols = solutionsRepo;
    const id = await sols.createSolution({
      account_id: ACCOUNT,
      name: `Self-test Widget ${stamp}`, description: 'test solution',
      currency: 'KES', active: true,
      features: ['feature one', 'feature two'], demo_template: 'ts-widget',
      project_value_low: 30000, project_value_base: 45000, project_value_high: 70000,
      problem_types: ['manual_ordering'], industries: ['Retail'],
    });
    if (!id) throw new Error('create returned no id');
    createdIds.solutionCrud = id;
    let s = await sols.findById(ACCOUNT, id);
    if (s.name !== `Self-test Widget ${stamp}`) throw new Error('name not stored');
    if (Number(s.project_value.base) !== 45000 || Number(s.project_value.high) !== 70000) throw new Error('pricing not stored');
    if ((s.features || []).length !== 2) throw new Error('features not stored');
    if (!(s.solves_problem_types || []).includes('manual_ordering')) throw new Error('problems not stored');
    if (!(s.industries || []).includes('Retail')) throw new Error('industries not stored');
    await sols.updateSolution(ACCOUNT, id, { active: false, project_value_base: 50000 });
    s = await sols.findById(ACCOUNT, id);
    if (Number(s.active) !== 0) throw new Error('activate toggle failed');
    if (Number(s.project_value.base) !== 50000) throw new Error('base update failed');
    const inactiveList = await sols.list({ accountId: ACCOUNT, activeOnly: true });
    if (inactiveList.some((x) => x.id === id)) throw new Error('inactive solution still active');
    await sols.updateSolution(ACCOUNT, id, { active: true });
    return `created #${id} low/base/high+features+demo stored, toggle ok`;
  });

  await test('solutionLink persists 4-fit sub-scores + base project value', async () => {
    const sols = await solutionsRepo.list({ accountId: ACCOUNT, activeOnly: true });
    const s = sols.find((x) => x.slug === 'delivery-management') || sols[0];
    await opportunitiesRepo.replaceSolutionMatches(ACCOUNT, createdIds.opportunity, [
      {
        solution_id: s.id, fit_score: 80, recommended: true,
        problem_fit: 90, industry_fit: 75, technical_fit: 70, commercial_fit: 85,
        why: 'directly addresses the problem for the retail market',
        project_value: { low: 70000, base: 110000, high: 190000 },
      },
    ]);
    const links = await opportunitiesRepo.solutionLinks(ACCOUNT, createdIds.opportunity);
    const link = links.find((l) => l.solution_id === s.id);
    if (!link) throw new Error('link not found');
    if (link.problem_fit !== 90 || link.industry_fit !== 75 || link.technical_fit !== 70 || link.commercial_fit !== 85) {
      throw new Error(`sub-scores not stored ${JSON.stringify({ pf: link.problem_fit, if: link.industry_fit, tf: link.technical_fit, cf: link.commercial_fit })}`);
    }
    if (Number(link.project_value_base) !== 110000) throw new Error(`base ${link.project_value_base}`);
    if (!/directly addresses/.test(link.reason || '')) throw new Error('why not stored as reason');
    return `link ${link.solution_name} sub-scores + base persisted`;
  });

  // --- Financial ---
  await test('assumptions + createFinancialScenario with low/base/high triples', async () => {
    await financialRepo.replaceAssumptions(ACCOUNT, createdIds.opportunity, [
      { assumption_name: 'average_order_value', assumption_value: 30000, assumption_low: 20000, assumption_high: 40000, unit: 'currency', confidence: 0.3 },
      { assumption_name: 'monthly_enquiries', assumption_value: 200, assumption_low: 100, assumption_high: 300, unit: 'enquiries', confidence: 0.3 },
    ]);
    await financialRepo.createFinancialScenario({
      account_id: ACCOUNT,
      opportunity_id: createdIds.opportunity, scenario_type: 'improved_conversion',
      scenario_name: 'Improved conversion', formula_description: 'monthly_enquiries × conversion_improvement × average_order_value',
      low_value: 40000, base_value: 300000, high_value: 960000, impact_low: 40000, impact_high: 960000, period: 'monthly',
      assumptions_json: { monthly_enquiries: { low: 100, base: 200, high: 300 }, average_order_value: { low: 20000, base: 30000, high: 40000 } },
      is_illustrative: 1,
    });
    const scenarios = await financialRepo.listScenarios(ACCOUNT, createdIds.opportunity);
    if (!scenarios.length || !scenarios[0].is_illustrative) throw new Error('scenario missing/not illustrative');
    if (Number(scenarios[0].base_value) !== 300000) throw new Error(`base_value=${scenarios[0].base_value}`);
    if (scenarios[0].scenario_name !== 'Improved conversion') throw new Error('scenario_name not stored');
    const assumptions = await financialRepo.listAssumptions(ACCOUNT, createdIds.opportunity);
    if (assumptions.length !== 2) throw new Error(`assumptions=${assumptions.length}`);
    const aov = assumptions.find((a) => a.assumption_name === 'average_order_value');
    if (Number(aov.assumption_low) !== 20000 || Number(aov.assumption_high) !== 40000) throw new Error('low/high assumption not stored');
    return 'scenario + 2 assumptions with low/base/high stored';
  });

  // --- Deterministic financial engine: one test per calculation ---
  await test('engine: additional_revenue = additional_customers × average_order_value', async () => {
    const s = computeFinancialScenario('additional_revenue', {
      additional_customers: { low: 4, base: 8, high: 12 },
      average_order_value: { low: 20000, base: 30000, high: 40000 },
    });
    expectCalc(s, 80000, 240000, 480000, 'additional_revenue');
    return 'low 80k / base 240k / high 480k';
  });

  await test('engine: improved_conversion = enquiries × conversion × AOV', async () => {
    const s = computeFinancialScenario('improved_conversion', {
      monthly_enquiries: { low: 100, base: 200, high: 300 },
      conversion_improvement: { low: 0.02, base: 0.05, high: 0.08 },
      average_order_value: { low: 20000, base: 30000, high: 40000 },
    });
    expectCalc(s, 40000, 300000, 960000, 'improved_conversion');
    return 'low 40k / base 300k / high 960k';
  });

  await test('engine: repeat_sales = customers × repeat-rate × AOV', async () => {
    const s = computeFinancialScenario('repeat_sales', {
      existing_customers: { low: 200, base: 500, high: 800 },
      repeat_rate_improvement: { low: 0.02, base: 0.05, high: 0.08 },
      average_order_value: { low: 20000, base: 30000, high: 40000 },
    });
    expectCalc(s, 80000, 750000, 2560000, 'repeat_sales');
    return 'low 80k / base 750k / high 2.56m';
  });

  await test('engine: labor_savings = hours_saved × hourly_cost', async () => {
    const s = computeFinancialScenario('labor_savings', {
      hours_saved: { low: 10, base: 30, high: 60 },
      hourly_cost: { low: 200, base: 500, high: 800 },
    });
    expectCalc(s, 2000, 15000, 48000, 'labor_savings');
    return 'low 2k / base 15k / high 48k';
  });

  await test('engine: reduced_stock_loss = stock_loss × reduction', async () => {
    const s = computeFinancialScenario('reduced_stock_loss', {
      estimated_stock_loss: { low: 10000, base: 30000, high: 60000 },
      reduction_percentage: { low: 0.1, base: 0.2, high: 0.35 },
    });
    expectCalc(s, 1000, 6000, 21000, 'reduced_stock_loss');
    return 'low 1k / base 6k / high 21k';
  });

  await test('engine: capacity_utilization = bookings × booking_value', async () => {
    const s = computeFinancialScenario('capacity_utilization', {
      additional_bookings: { low: 5, base: 15, high: 30 },
      average_booking_value: { low: 3000, base: 6000, high: 10000 },
    });
    expectCalc(s, 15000, 90000, 300000, 'capacity_utilization');
    return 'low 15k / base 90k / high 300k';
  });

  await test('engine: refuses to create a scenario when a required assumption is missing', async () => {
    const s = computeFinancialScenario('improved_conversion', {
      monthly_enquiries: { low: 100, base: 200, high: 300 },
      conversion_improvement: { low: 0.02, base: 0.05, high: 0.08 },
      // average_order_value omitted
    });
    if (s !== null) throw new Error('scenario created despite missing required assumption');
    const b = buildFinancialScenariosForMechanism('higher_conversion', {
      mechanism: { monthly_enquiries: { low: 100, base: 200, high: 300 } },
    });
    if (b.scenarios.length !== 0) throw new Error('missing assumptions produced a scenario');
    return 'no scenario when assumptions missing';
  });

  await test('engine: mechanism mapping produces canonical supported scenarios', async () => {
    const keys = new Set(FINANCIAL_SCENARIO_KEYS);
    for (const k of Object.keys(FINANCIAL_SCENARIOS)) {
      const s = FINANCIAL_SCENARIOS[k];
      if (!s.name || !s.formula || !Array.isArray(s.assumptions) || !s.assumptions.length) throw new Error(`bad def ${k}`);
      if (!['monthly', 'annual'].includes(s.period)) throw new Error(`bad period ${k}`);
    }
    // Every supported scenario key is used by at least one mechanism.
    const used = new Set();
    for (const def of Object.values(FINANCIAL_SCENARIOS)) used.add(def.name);
    const b = buildFinancialScenariosForMechanism('additional_sales');
    if (!b.scenarios.length) throw new Error('additional_sales should map to additional_revenue');
    if (b.scenarios[0].scenario_key !== 'additional_revenue') throw new Error(`mapped ${b.scenarios[0].scenario_key}`);
    return `${keys.size} canonical scenarios defined`;
  });

  // --- Pipeline ---
  await test('updatePipeline records transitions', async () => {
    await financialRepo.updatePipeline(ACCOUNT, createdIds.opportunity, 'qualified', { notes: 'self-test', actor_user_id: user.id });
    await financialRepo.updatePipeline(ACCOUNT, createdIds.opportunity, 'contacted', { notes: 'self-test send', actor_user_id: user.id });
    const events = await financialRepo.eventsForOpportunity(ACCOUNT, createdIds.opportunity);
    if (events.length < 2) throw new Error(`events=${events.length}`);
    const row = await opportunitiesRepo.findById(ACCOUNT, createdIds.opportunity);
    if (row.status !== 'contacted') throw new Error(row.status);
    return 'status + event trail verified';
  });

  // --- Outreach ---
  await test('createOutreach approval guard via service rules', async () => {
    const msgId = await outreachRepo.createOutreach({
      account_id: ACCOUNT,
      opportunity_id: createdIds.opportunity, message_type: 'email',
      message_text: `${stamp} draft`, generation_status: 'generated', approved: 0,
    });
    createdIds.message = msgId;
    const msg = await outreachRepo.findById(ACCOUNT, msgId);
    if (msg.approved) throw new Error('draft must start unapproved');
    await outreachRepo.updateDraft(ACCOUNT, msgId, { message_text: `${stamp} edited`, approved: 1 });
    const updated = await outreachRepo.findById(ACCOUNT, msgId);
    if (!updated.approved) throw new Error('approval not saved');
    return 'draft -> approved flow works';
  });

  // --- Jobs lifecycle (v2 queued) ---
  await test('search query + queued job lifecycle + dedup', async () => {
    const qid = await jobsRepo.createSearchQuery({
      account_id: ACCOUNT,
      query_name: stamp, query_text: 'hardware stores', location: 'Nairobi',
      keywords: 'tools, lumber', required_contact_type: 'whatsapp',
      problem_categories: ['lost_sales'], created_by: user.id,
    });
    createdIds.searchQuery = qid;
    const dedup_key = jobsRepo.dedupHash('manual', { query: 'hardware stores', industry: null, location: 'Nairobi' });
    const { jobId: jid, duplicate } = await jobsRepo.createQueuedSearchJob({
      account_id: ACCOUNT,
      search_query_id: qid, provider: 'manual', dedup_key,
    });
    if (duplicate) throw new Error('first job should not be duplicate');
    // Same key again -> duplicate
    const dup = await jobsRepo.createQueuedSearchJob({ account_id: ACCOUNT, search_query_id: qid, provider: 'manual', dedup_key });
    if (!dup.duplicate) throw new Error('second call should be duplicate');
    await jobsRepo.startJob(ACCOUNT, jid);
    const running = await jobsRepo.getJob(ACCOUNT, jid);
    if (running.status !== 'running') throw new Error(`status=${running.status}`);
    if (running.attempts < 1) throw new Error('attempts not incremented');
    await jobsRepo.setProgress(ACCOUNT, jid, 75);
    await jobsRepo.completeJob(ACCOUNT, jid);
    const job = await jobsRepo.getJob(ACCOUNT, jid);
    if (!job || job.status !== 'completed' || job.progress !== 100) throw new Error(JSON.stringify(job));
    return `job ${jid} completed; duplicate protection works`;
  });

  await test('failJob persists error message', async () => {
    const dedup_key = jobsRepo.dedupHash('manual', { query: 'fail-test' });
    const { jobId: fid } = await jobsRepo.createQueuedSearchJob({
      account_id: ACCOUNT,
      search_query_id: createdIds.searchQuery, provider: 'manual', dedup_key,
    });
    await jobsRepo.startJob(ACCOUNT, fid);
    await jobsRepo.failJob(ACCOUNT, fid, new Error('test failure'));
    const failed = await jobsRepo.getJob(ACCOUNT, fid);
    if (failed.status !== 'failed') throw new Error(`status=${failed.status}`);
    if (!failed.error_message || !failed.error_message.includes('test failure')) {
      throw new Error(`error_message=${failed.error_message}`);
    }
    return 'failJob stores error';
  });

  // --- Robots.txt parser ---
  await test('parseRobots extracts rules correctly', async () => {
    const txt = 'User-agent: *\nDisallow: /admin\nDisallow: /private/\n\nUser-agent: Googlebot\nAllow: /\n\nSitemap: https://example.com/sitemap.xml';
    const rules = parseRobots(txt);
    // allowed() takes a pathname (politeFetch passes URL().pathname)
    if (!rules.allowed('/about')) throw new Error('public page blocked');
    if (rules.allowed('/admin')) throw new Error('/admin not blocked');
    if (rules.allowed('/admin/settings')) throw new Error('/admin/* not blocked');
    if (rules.allowed('/private/data')) throw new Error('/private/ not blocked');
    if (!rules.allowed('/robots.txt')) throw new Error('robots.txt itself should be allowed');
    return 'disallow/allow prefix matching correct';
  });

  await test('htmlToText strips tags and collapses whitespace', async () => {
    const out = htmlToText('<p>Hello  <b>world</b></p>\n<!-- skip -->\n<script>bad</script>');
    if (out.includes('<')) throw new Error(`still contains HTML: ${out}`);
    if (!out.includes('Hello')) throw new Error('text missing');
    if (out.includes('bad')) throw new Error('script tag leaked');
    return 'clean text extraction';
  });

  await test('PROBLEM_TYPE_KEYS + SCORE_WEIGHTS integrity', async () => {
    const sum = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.01) throw new Error(`weights sum=${sum}`);
    if (Object.keys(SCORE_WEIGHTS).length !== 8) throw new Error('expected 8 scoring factors');
    if (!Array.isArray(PROBLEM_TYPE_KEYS) || !PROBLEM_TYPE_KEYS.every((k) => typeof k === 'string')) {
      throw new Error('PROBLEM_TYPE_KEYS should be an array of strings');
    }
    return `${PROBLEM_TYPE_KEYS.length} problem types, weights sum=${sum.toFixed(2)}`;
  });

  await test('higher_conversion mechanism math + annualisation', async () => {
    const bundle = buildScenariosByMechanism('higher_conversion', {
      higher_conversion: { monthly_enquiries: 100, conversion_improvement: 0.05, average_order_value: 40000 },
    });
    const sc = bundle.scenarios.find((s) => s.scenario_key === 'improved_conversion');
    if (!sc) throw new Error('no improved_conversion scenario');
    // single future values -> low = base = high = 100 × 0.05 × 40000 = 200,000
    if (sc.low_value !== 200000 || sc.base_value !== 200000 || sc.high_value !== 200000) {
      throw new Error(`values ${sc.low_value}/${sc.base_value}/${sc.high_value}`);
    }
    const annual = midpointAnnualPotential(bundle.scenarios);
    // (200,000 + 200,000)/2 × 12 months = 2,400,000 / year
    if (annual !== 2400000) throw new Error(`annual midpoint=${annual}`);
    return `100×0.05×40000 → 200,000/mo, annual midpoint=${annual}`;
  });

  await test('every MONEY_MECHANISM_KEY maps to existing scenario templates', async () => {
    const templateKeys = Object.keys(SCENARIO_TEMPLATES);
    const missing = [];
    for (const key of MONEY_MECHANISM_KEYS) {
      for (const s of (MONEY_MECHANISMS[key]?.scenarios || [])) {
        if (!templateKeys.includes(s)) missing.push(`${key}->${s}`);
      }
    }
    if (missing.length) throw new Error(`unmapped scenarios: ${missing.join(', ')}`);
    return `${MONEY_MECHANISM_KEYS.length} mechanisms mapped`;
  });

  await test('shouldRejectCandidate gates weak / mechanism-less candidates', async () => {
    if (shouldRejectCandidate(null).reject !== true) throw new Error('null not rejected');
    const weak = shouldRejectCandidate({ signal_confidence: 0.2, money_mechanism_key: 'additional_sales' });
    if (!weak.reject) throw new Error('weak candidate accepted');
    const noMech = shouldRejectCandidate({ signal_confidence: 0.9, money_mechanism_key: null });
    if (!noMech.reject) throw new Error('mechanism-less candidate accepted');
    const good = shouldRejectCandidate({ signal_confidence: 0.8, money_mechanism_key: 'higher_conversion' });
    if (good.reject) throw new Error('valid candidate rejected');
    return 'weak + no-mechanism rejected, valid accepted';
  });

  await test('saveExplanation + getExplanation round-trip incl. mechanism', async () => {
    await opportunitiesRepo.saveExplanation(ACCOUNT, createdIds.opportunity, {
      why_exists: 'why',
      evidence_support: 'evidence',
      money_impact: 'impact',
      uncertain: 'uncertain',
      money_mechanism_key: 'higher_repeat_purchase',
    });
    const exp = await opportunitiesRepo.getExplanation(ACCOUNT, createdIds.opportunity);
    if (!exp || exp.evidence_support !== 'evidence') throw new Error('round-trip failed');
    if (exp.money_impact !== 'impact' || exp.uncertain !== 'uncertain') throw new Error('fields lost');
    return `mechanism=${exp.money_mechanism_key}, fields round-tripped`;
  });

  // ---- tenant isolation: a second account's rows are invisible to account 1 ----
  await test('tenant isolation: second-account rows invisible to account 1 queries', async () => {
    const accountsRepo = await import('@/lib/repositories/accounts');
    let phase = 'createAccount';
    const step = (label, fn) => fn().catch((e) => { throw new Error(`${label}: ${e.message}`); });
    const acct2Id = await step('createAccount', () =>
      accountsRepo.createAccount({ name: `Self-test isolation ${stamp}`, plan_code: 'free', created_by: user.id }));
    phase = 'createUserInAccount';
    const uid2 = await step(phase, () => accountsRepo.createUserInAccount({
      account_id: acct2Id,
      name: 'Isolation Tester', email: `iso-${stamp}@example.test`,
      password: `iso-${stamp}-pw`, role: 'owner',
    }));
    try {
      phase = 'createBusiness';
      const biz2 = await step(phase, () => businessesRepo.createBusiness({
        account_id: acct2Id, name: `${stamp} Isolated Traders`, industry: 'Retail', location: 'Elsewhere',
      }));
      // Account 1 must NOT see account 2's business
      phase = 'business list isolation';
      const visibleToAcct1 = await step(phase, () => businessesRepo.list({ accountId: ACCOUNT, limit: 500 }));
      if (visibleToAcct1.some((b) => Number(b.id) === Number(biz2))) throw new Error('business leaked across accounts');
      phase = 'findBusiness isolation';
      if (await step(phase, () => businessesRepo.findBusiness(ACCOUNT, biz2))) throw new Error('findBusiness crossed accounts');
      // And account 2 DOES see it in its own scope
      phase = 'own-account business lookup';
      const inOwn = await step(phase, () => businessesRepo.findBusiness(acct2Id, biz2));
      if (!inOwn || Number(inOwn.id) !== Number(biz2)) throw new Error('own-account lookup failed');

      // Solution catalog isolation (including the per-account slug unique)
      phase = 'createSolution';
      const sol2 = await step(phase, () => solutionsRepo.createSolution({
        account_id: acct2Id, name: `Isolated Widget ${stamp}`, description: 'iso', currency: 'KES',
        active: true, project_value_low: 30000, project_value_base: 40000, project_value_high: 60000,
        problem_types: ['manual_ordering'], industries: ['Retail'],
      }));
      phase = 'findById isolation';
      if (await step(phase, () => solutionsRepo.findById(ACCOUNT, sol2))) throw new Error('solution leaked across accounts');

      // Opportunity isolation (findById + list)
      phase = 'createOpportunity';
      const opp2 = await step(phase, () => opportunitiesRepo.createOpportunity({
        account_id: acct2Id, business_id: biz2, title: `${stamp} iso opp`,
        problem_type: 'manual_ordering', problem: 'p', opportunity: 'o', why_it_matters: 'w',
      }));
      phase = 'opp findById isolation';
      if (await step(phase, () => opportunitiesRepo.findById(ACCOUNT, opp2))) throw new Error('opportunity leaked across accounts');
      phase = 'opp list isolation';
      const acct1Opps = await step(phase, () => opportunitiesRepo.list({ accountId: ACCOUNT, limit: 500 }));
      if (acct1Opps.some((o) => Number(o.id) === Number(opp2))) throw new Error('opportunity list leaked across accounts');

      // Scenario isolation
      phase = 'createFinancialScenario';
      await step(phase, () => financialRepo.createFinancialScenario({
        account_id: acct2Id, opportunity_id: opp2, scenario_type: 'additional_revenue',
        formula_description: 'iso', impact_low: 100, impact_high: 200, period: 'annual', is_illustrative: 1,
      }));
      phase = 'scenario list isolation';
      if ((await step(phase, () => financialRepo.listScenarios(ACCOUNT, opp2))).length) throw new Error('scenario leaked across accounts');
      phase = 'own-account scenario lookup';
      if (!(await step(phase, () => financialRepo.listScenarios(acct2Id, opp2))).length) throw new Error('own-account scenario missing');

      // Cleanup account 2 rows
      phase = 'cleanup matches';
      await step(phase, () => opportunitiesRepo.replaceSolutionMatches(acct2Id, opp2, []));
      phase = 'cleanup business';
      await step(phase, () => businessesRepo.deleteBusiness(acct2Id, biz2));
      phase = 'cleanup solution';
      await step(phase, () => solutionsRepo.deleteSolution(acct2Id, sol2));
      return `business/opp/solution/scenario of account ${acct2Id} isolated from account ${ACCOUNT}`;
    } finally {
      const { query } = await import('@/lib/db');
      await query('DELETE FROM users WHERE id = ?', [uid2]).catch(() => {});
      await query('DELETE FROM accounts WHERE id = ?', [acct2Id]).catch(() => {});
    }
  });

  // ---- cleanup of throwaway records (cascades to evidence/opps/messages) ----
  if (createdIds.business) {
    await businessesRepo.deleteBusiness(ACCOUNT, createdIds.business).catch((e) =>
      results.push({ name: 'cleanup', pass: false, detail: String(e.message || e) })
    );
  }
  if (createdIds.solutionCrud) {
    await solutionsRepo.deleteSolution(ACCOUNT, createdIds.solutionCrud).catch((e) =>
      results.push({ name: 'cleanup', pass: false, detail: String(e.message || e) })
    );
  }
  if (createdIds.searchQuery) {
    // The search query (and its search_jobs, ON DELETE CASCADE) are throwaway
    // test fixtures from the jobs-lifecycle + failJob tests.
    const { query } = await import('@/lib/db');
    await query('DELETE FROM search_queries WHERE id = ?', [createdIds.searchQuery]).catch((e) =>
      results.push({ name: 'cleanup', pass: false, detail: String(e.message || e) })
    );
  }

  const passed = results.filter((r) => r.pass).length;
  return Response.json({
    ok: passed === results.length,
    summary: `${passed}/${results.length} passed`,
    results,
  }, { status: passed === results.length ? 200 : 500 });
}
