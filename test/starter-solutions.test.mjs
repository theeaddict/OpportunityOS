/** Starter solution library — pure tests, no DB/network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_SOLUTIONS } from '../lib/solutions/starter-catalog.js';
import { PROBLEM_TYPE_KEYS } from '../lib/constants.js';
import { matchSolutions } from '../lib/services/analysis/matching.js';

const asLibrary = () => STARTER_SOLUTIONS.map((s, i) => ({
  id: i + 1,
  name: s.name,
  description: s.description,
  currency: 'KES',
  features: s.features,
  solves_problem_types: s.problems,
  industries: s.industries,
  project_value: { low: s.price[0], base: s.price[1], high: s.price[2] },
}));

test('every starter uses valid problem keys, has ordered pricing, and a unique name', () => {
  const names = new Set();
  for (const s of STARTER_SOLUTIONS) {
    assert.ok(!names.has(s.name), `duplicate ${s.name}`);
    names.add(s.name);
    assert.ok(s.problems.length >= 2 || s.name === 'Customer Support Desk', s.name);
    for (const p of s.problems) assert.ok(PROBLEM_TYPE_KEYS.includes(p), `${s.name}: unknown problem ${p}`);
    const [lo, base, hi] = s.price;
    assert.ok(lo > 0 && lo <= base && base <= hi, `${s.name} pricing`);
    assert.match(s.description, /Starter template/, 'must be labelled as an editable template');
  }
});

test('together the starters cover every problem type the platform can detect', () => {
  const covered = new Set(STARTER_SOLUTIONS.flatMap((s) => s.problems));
  const missing = PROBLEM_TYPE_KEYS.filter((k) => !covered.has(k));
  assert.deepEqual(missing, [], `no starter solves: ${missing.join(', ')}`);
});

test('every problem type gets at least one match from the starter library (solution fit > 0)', () => {
  const lib = asLibrary();
  for (const problem of PROBLEM_TYPE_KEYS) {
    const m = matchSolutions(lib, { business: { industry: 'Mobile Phone' }, problem_type: problem, signals: {} });
    assert.ok(m.length > 0, `no match for ${problem}`);
    assert.ok(m[0].fit_score >= 45, `${problem}: best fit ${m[0].fit_score}`);
  }
});

test('OpenStreetMap categories count as retail for industry fit', () => {
  const lib = asLibrary().filter((s) => s.name === 'Inventory & Stock Management');
  for (const industry of ['Mobile Phone', 'Electronics', 'Supermarket', 'Hardware']) {
    const [m] = matchSolutions(lib, { business: { industry }, problem_type: 'inventory_problems', signals: {} });
    assert.ok(m.industry_fit >= 90, `${industry}: industry_fit ${m.industry_fit}`);
  }
  const [other] = matchSolutions(lib, { business: { industry: 'Hotel' }, problem_type: 'inventory_problems', signals: {} });
  assert.ok(other.industry_fit < 60, 'an unrelated industry must not be credited as retail');
});
