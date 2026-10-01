/**
 * Unit tests for the multi-query search strategy + expansion
 * (lib/services/discovery/query-strategy.js). Pure logic — searchWithExpansion
 * is exercised with a fake searchFn, never a real provider/network call.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueryVariants, searchWithExpansion } from '../lib/services/discovery/query-strategy.js';

test('buildQueryVariants adds generic modifiers to a short industry term', () => {
  const variants = buildQueryVariants({ industry: 'furniture' });
  assert.deepEqual(variants, ['furniture', 'furniture workshop', 'furniture company', 'furniture shop', 'furniture services']);
});

test('buildQueryVariants leaves a multi-word description alone (no nonsense suffixes)', () => {
  const variants = buildQueryVariants({ query: 'Furniture and upholstery workshops in Nairobi' });
  assert.deepEqual(variants, ['Furniture and upholstery workshops in Nairobi']);
});

test('buildQueryVariants returns [] for nothing to search', () => {
  assert.deepEqual(buildQueryVariants({}), []);
});

test('searchWithExpansion stops once minResults is reached, without trying further variants', async () => {
  const tried = [];
  const searchFn = async ({ query }) => {
    tried.push(query);
    return [{ name: 'A', source: { external_identifier: 'x:1' } }, { name: 'B', source: { external_identifier: 'x:2' } }];
  };
  const { candidates, queriesTried } = await searchWithExpansion(searchFn, { industry: 'furniture' }, { minResults: 2 });
  assert.equal(candidates.length, 2);
  assert.equal(queriesTried.length, 1, 'must not try a second variant once minResults is already met');
});

test('searchWithExpansion tries further variants when short on results, and dedupes across them', async () => {
  const responses = {
    furniture: [{ name: 'A', source: { external_identifier: 'x:1' } }],
    'furniture workshop': [
      { name: 'A', source: { external_identifier: 'x:1' } }, // same business, found again — must not duplicate
      { name: 'B', source: { external_identifier: 'x:2' } },
    ],
  };
  const searchFn = async ({ query }) => responses[query] || [];
  const { candidates, queriesTried } = await searchWithExpansion(searchFn, { industry: 'furniture' }, { minResults: 2 });
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((c) => c.name), ['A', 'B']);
  assert.equal(queriesTried.length, 2);
});

test('searchWithExpansion gives up after maxVariants even if minResults is never reached', async () => {
  const searchFn = async () => [];
  const { candidates, queriesTried } = await searchWithExpansion(searchFn, { industry: 'furniture' }, { minResults: 50, maxVariants: 2 });
  assert.equal(candidates.length, 0);
  assert.equal(queriesTried.length, 2);
});

test('searchWithExpansion survives one variant throwing — the others still run', async () => {
  const searchFn = async ({ query }) => {
    if (query === 'furniture') throw new Error('provider outage');
    return [{ name: 'B', source: { external_identifier: 'x:2' } }];
  };
  const { candidates } = await searchWithExpansion(searchFn, { industry: 'furniture' }, { minResults: 1 });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, 'B');
});
