/**
 * Unit tests for the "no public website" lead-quality signal.
 *
 * Problem: businesses with zero web presence produced NO evidence at all from
 * discovery or research, so they were silently invisible to the opportunity
 * pipeline (rejected as too-weak-evidence) even though "confirmed real
 * business, zero online presence" is itself a strong, honest signal. These
 * tests are pure function-level (no DB, no network, no mock servers) so they
 * run standalone via `node --test test/`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapResult } from '../lib/services/discovery/providers/google-places.js';
import { mapElement } from '../lib/services/discovery/providers/osm-overpass.js';
import { computeResearchCoverage } from '../lib/services/research/coverage.js';
import { detectCandidateProblems, shouldRejectCandidate } from '../lib/services/analysis/rules-analyzer.js';

function findSignal(evidence, key) {
  return evidence.find((e) => e.signal_key === key);
}

// ---------------------------------------------------------------------------
// Google Places
// ---------------------------------------------------------------------------

test('google-places: no_public_website asserted when Details was fetched and the listing is confirmed active', () => {
  const place = { place_id: 'p1', name: 'Joe\'s Diner', rating: 4.5, user_ratings_total: 82 };
  const details = { formatted_address: '1 Main St', url: 'https://maps.google.com/?cid=1' }; // no website field
  const candidate = mapResult(place, details);
  const noSite = findSignal(candidate.evidence, 'no_public_website');
  assert.ok(noSite, 'expected a no_public_website evidence row');
  assert.equal(noSite.claim_type, 'INFERENCE');
  assert.ok(noSite.confidence >= 0.4 && noSite.confidence < 0.9);
});

test('google-places: no no_public_website claim when Details was never fetched', () => {
  const place = { place_id: 'p2', name: 'Thin Listing', rating: 4.0, user_ratings_total: 5 };
  const candidate = mapResult(place, null); // GOOGLE_PLACES_FETCH_DETAILS=0 case
  assert.equal(findSignal(candidate.evidence, 'no_public_website'), undefined,
    'must not claim "no website" when the website field was never actually checked');
});

test('google-places: no no_public_website claim for a thin listing with no phone/rating', () => {
  const place = { place_id: 'p3', name: 'Unknown Place' };
  const details = { formatted_address: '2 Side St', url: 'https://maps.google.com/?cid=3' };
  const candidate = mapResult(place, details);
  assert.equal(findSignal(candidate.evidence, 'no_public_website'), undefined,
    'a listing with no independent confirmation of activity should not be asserted as "confirmed no website"');
});

test('google-places: existing_website wins, no_public_website is never asserted alongside it', () => {
  const place = { place_id: 'p4', name: 'Has A Site', rating: 4.8, user_ratings_total: 40 };
  const details = { website: 'https://example.com', url: 'https://maps.google.com/?cid=4' };
  const candidate = mapResult(place, details);
  assert.ok(findSignal(candidate.evidence, 'existing_website'));
  assert.equal(findSignal(candidate.evidence, 'no_public_website'), undefined);
});

// ---------------------------------------------------------------------------
// OSM Overpass
// ---------------------------------------------------------------------------

test('osm-overpass: no_public_website asserted for a phone-verified listing with no website tag', () => {
  const el = { type: 'node', id: 1, lat: 0, lon: 0, tags: { name: 'Bakery X', phone: '+1 555 0100', amenity: 'bakery' } };
  const candidate = mapElement(el, null);
  const noSite = findSignal(candidate.evidence, 'no_public_website');
  assert.ok(noSite, 'expected a no_public_website evidence row');
  assert.equal(noSite.claim_type, 'INFERENCE');
  assert.ok(noSite.confidence < 0.7, 'OSM tagging is less authoritative than Google Details, so confidence must stay lower');
});

test('osm-overpass: no no_public_website claim when neither phone nor website is tagged', () => {
  const el = { type: 'node', id: 2, lat: 0, lon: 0, tags: { name: 'Untagged Shop', amenity: 'shop' } };
  const candidate = mapElement(el, null);
  assert.equal(candidate.evidence.length, 0, 'no contact confirmation means no claims at all, not an assumed missing website');
});

test('osm-overpass: existing_website wins over no_public_website when a website tag is present', () => {
  const el = { type: 'node', id: 3, lat: 0, lon: 0, tags: { name: 'Has Site', phone: '+1 555 0101', website: 'https://example.org' } };
  const candidate = mapElement(el, null);
  assert.ok(findSignal(candidate.evidence, 'existing_website'));
  assert.equal(findSignal(candidate.evidence, 'no_public_website'), undefined);
});

// ---------------------------------------------------------------------------
// Coverage model
// ---------------------------------------------------------------------------

test('coverage: a confirmed-missing website still counts as covered (known answer), not "missing"', () => {
  const rows = [{ signal_key: 'no_public_website', evidence_text: 'no website found' }];
  const coverage = computeResearchCoverage(rows);
  assert.ok(!coverage.missing.includes('Online sales'));
});

// ---------------------------------------------------------------------------
// Rules engine — the actual opportunity this evidence should unlock
// ---------------------------------------------------------------------------

test('rules-analyzer: no_public_website alone is enough to propose a poor_conversion opportunity', () => {
  const signals = { no_public_website: true };
  const evidenceBySignal = {
    no_public_website: [{ id: 1, signal_key: 'no_public_website', confidence_score: 0.7 }],
  };
  const candidates = detectCandidateProblems(signals, evidenceBySignal);
  const candidate = candidates.find((c) => c.problem_type === 'poor_conversion');
  assert.ok(candidate, 'expected a poor_conversion candidate from no_public_website alone');
  assert.equal(shouldRejectCandidate(candidate).reject, false);
});

test('rules-analyzer: no signals at all still proposes nothing (regression guard)', () => {
  const candidates = detectCandidateProblems({}, {});
  assert.equal(candidates.length, 0);
});
