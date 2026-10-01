/**
 * Unit tests for bbox filter validation and the multi-provider merge path
 * (lib/services/discovery/index.js). No live network calls — each case is
 * constructed so providers short-circuit before ever fetching (empty
 * keyword, or explicitly unconfigured), matching how the real functions
 * already guard themselves.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFilters, runAllSearches } from '../lib/services/discovery/index.js';

test('normalizeFilters accepts a valid bbox', () => {
  const f = normalizeFilters({ industry: 'Furniture', bbox: { south: -1.4, north: -1.2, west: 36.7, east: 36.9 } });
  assert.deepEqual(f.bbox, { south: -1.4, north: -1.2, west: 36.7, east: 36.9 });
});

test('normalizeFilters rejects an inverted or out-of-range bbox rather than passing it through', () => {
  assert.equal(normalizeFilters({ bbox: { south: -1.2, north: -1.4, west: 36.7, east: 36.9 } }).bbox, null, 'south >= north must be rejected');
  assert.equal(normalizeFilters({ bbox: { south: -1.4, north: -1.2, west: 36.9, east: 36.7 } }).bbox, null, 'west >= east must be rejected');
  assert.equal(normalizeFilters({ bbox: { south: -1.4, north: -1.2, west: 200, east: 210 } }).bbox, null, 'out-of-range longitude must be rejected');
});

test('normalizeFilters treats a missing/malformed bbox as absent, not an error', () => {
  assert.equal(normalizeFilters({}).bbox, null);
  assert.equal(normalizeFilters({ bbox: 'not an object' }).bbox, null);
  assert.equal(normalizeFilters({ bbox: { south: 'x', north: -1.2, west: 36.7, east: 36.9 } }).bbox, null);
});

test('runAllSearches never throws and returns [] when a search has no keyword (each provider short-circuits)', async () => {
  const result = await runAllSearches({});
  assert.deepEqual(result, []);
});
