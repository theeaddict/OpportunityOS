/**
 * Unit tests for the "deep scraping" evidence additions:
 *   - Google review content -> signal-tagged evidence (google-places.js)
 *   - website-finder.js's search-based website lookup, gated + host-filtered
 *
 * Pure function-level (no DB, no live network — fetch is monkey-patched where
 * needed) so these run standalone via `node --test test/`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapResult } from '../lib/services/discovery/providers/google-places.js';
import { isConfigured, findWebsite } from '../lib/services/research/website-finder.js';

function findSignal(evidence, key) {
  return evidence.filter((e) => e.signal_key === key);
}

// ---------------------------------------------------------------------------
// Google review evidence
// ---------------------------------------------------------------------------

const place = { place_id: 'p1', name: 'Joe\'s Diner' };

test('google-places: a low-rated review complaining about no response becomes unanswered_enquiries evidence', () => {
  const details = {
    url: 'https://maps.google.com/?cid=1',
    reviews: [{ rating: 2, text: 'Called three times and they never answer the phone.', relative_time_description: 'a month ago' }],
  };
  const candidate = mapResult(place, details);
  const hits = findSignal(candidate.evidence, 'unanswered_enquiries');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].claim_type, 'INFERENCE');
  assert.equal(hits[0].evidence_type, 'customer_review');
  assert.ok(hits[0].confidence < 0.9, 'a single review must carry lower confidence than a website fact');
});

test('google-places: a high-rated review mentioning regular custom becomes repeat_customer_mentions evidence', () => {
  const details = {
    url: 'https://maps.google.com/?cid=2',
    reviews: [{ rating: 5, text: 'I have been coming here for years, always great service.' }],
  };
  const candidate = mapResult(place, details);
  assert.equal(findSignal(candidate.evidence, 'repeat_customer_mentions').length, 1);
});

test('google-places: pain phrasing in a HIGH-rated review is not read as a complaint', () => {
  const details = {
    url: 'https://maps.google.com/?cid=3',
    reviews: [{ rating: 5, text: 'They never answer... because they are too busy serving everyone, best food ever!' }],
  };
  const candidate = mapResult(place, details);
  assert.equal(findSignal(candidate.evidence, 'unanswered_enquiries').length, 0,
    'pain signals must only be read from reviews rated <=3, regardless of phrasing');
});

test('google-places: no reviews field produces no review evidence and does not throw', () => {
  const candidate = mapResult(place, { url: 'https://maps.google.com/?cid=4' });
  assert.equal(candidate.evidence.filter((e) => e.evidence_type === 'customer_review').length, 0);
});

test('google-places: the same signal is cited once even if multiple reviews mention it', () => {
  const details = {
    url: 'https://maps.google.com/?cid=5',
    reviews: [
      { rating: 1, text: 'They never answer the phone, so frustrating.' },
      { rating: 2, text: 'No response no reply ever, avoid.' },
    ],
  };
  const candidate = mapResult(place, details);
  assert.equal(findSignal(candidate.evidence, 'unanswered_enquiries').length, 1);
});

// ---------------------------------------------------------------------------
// Website finder
// ---------------------------------------------------------------------------

test('website-finder: not configured without both env vars, and never calls fetch', async () => {
  delete process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
  delete process.env.GOOGLE_CUSTOM_SEARCH_CX;
  assert.equal(isConfigured(), false);

  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return original ? original() : null; };
  try {
    const result = await findWebsite({ name: 'Joe\'s Diner', location: 'Nairobi' });
    assert.equal(result, null);
    assert.equal(called, false, 'must short-circuit before ever making a network call');
  } finally {
    globalThis.fetch = original;
  }
});

test('website-finder: excludes social/directory hosts and picks the first real business domain', async () => {
  process.env.GOOGLE_CUSTOM_SEARCH_API_KEY = 'test-key';
  process.env.GOOGLE_CUSTOM_SEARCH_CX = 'test-cx';
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      items: [
        { link: 'https://www.facebook.com/joesdiner' },
        { link: 'https://www.tripadvisor.com/Restaurant_Review-joes-diner' },
        { link: 'https://www.joesdiner.co.ke/' },
      ],
    }),
  });
  try {
    const result = await findWebsite({ name: 'Joe\'s Diner', location: 'Nairobi' });
    assert.equal(result, 'https://www.joesdiner.co.ke/');
  } finally {
    globalThis.fetch = original;
    delete process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
    delete process.env.GOOGLE_CUSTOM_SEARCH_CX;
  }
});

test('website-finder: returns null (never throws) when all results are excluded hosts', async () => {
  process.env.GOOGLE_CUSTOM_SEARCH_API_KEY = 'test-key';
  process.env.GOOGLE_CUSTOM_SEARCH_CX = 'test-cx';
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ items: [{ link: 'https://www.instagram.com/joesdiner' }] }),
  });
  try {
    assert.equal(await findWebsite({ name: 'Joe\'s Diner' }), null);
  } finally {
    globalThis.fetch = original;
    delete process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
    delete process.env.GOOGLE_CUSTOM_SEARCH_CX;
  }
});

test('website-finder: a network failure resolves to null instead of throwing', async () => {
  process.env.GOOGLE_CUSTOM_SEARCH_API_KEY = 'test-key';
  process.env.GOOGLE_CUSTOM_SEARCH_CX = 'test-cx';
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    assert.equal(await findWebsite({ name: 'Joe\'s Diner' }), null);
  } finally {
    globalThis.fetch = original;
    delete process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
    delete process.env.GOOGLE_CUSTOM_SEARCH_CX;
  }
});
