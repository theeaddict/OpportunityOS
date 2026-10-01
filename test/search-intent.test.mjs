/**
 * Unit tests for the free-text -> search-filters parser (lib/services/
 * discovery/intent.js) that powers the Discover page's "describe it" box.
 * Pure function, no DB/network, run via `node --test test/`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchIntent } from '../lib/services/discovery/intent.js';

test('parses an indirect furniture/upholstery description with no industry word', () => {
  const text = `Find business with problems that need fixing with tech find their WhatsApp number then
    write a message specifically for them. The message should be like this (Hi Kings Interiors & Decor,
    when sofas are coming in for makeovers and repairs, each job occupies workshop space until it moves
    through assessment, fabric selection, payment, production, finishing and delivery. I could build a
    system where every sofa has its own job record, photos, quotation, fabric details, payment,
    production stage and delivery status, giving you a clear view of what is in the workshop.)`;
  const result = parseSearchIntent(text);
  assert.equal(result.industry, 'Furniture');
  assert.ok(result.problem_categories.includes('quotation_management'));
  assert.ok(result.problem_categories.includes('production_tracking'));
  assert.ok(result.problem_categories.includes('payment_reconciliation'));
});

test('does not mistake a platform name for a location', () => {
  const result = parseSearchIntent('Find businesses in TikTok with booking problems');
  assert.equal(result.location, null);
});

test('extracts an explicit "in <City>" location', () => {
  const result = parseSearchIntent('Hair salons in Nairobi that only book by phone');
  assert.equal(result.industry, 'Hair Salon');
  assert.equal(result.location, 'Nairobi');
  assert.ok(result.problem_categories.includes('manual_booking'));
});

test('falls back to a known-city match with no "in X" phrase', () => {
  const result = parseSearchIntent('Restaurants around Mombasa struggling with online ordering');
  assert.equal(result.industry, 'Restaurant');
  assert.equal(result.location, 'Mombasa');
  assert.ok(result.problem_categories.includes('manual_ordering'));
});

test('empty input returns nulls, never throws', () => {
  assert.deepEqual(parseSearchIntent(''), { industry: null, location: null, problem_categories: [] });
  assert.deepEqual(parseSearchIntent(undefined), { industry: null, location: null, problem_categories: [] });
});

test('no industry/location keywords found returns nulls rather than a wrong guess', () => {
  const result = parseSearchIntent('I want to make more money somehow');
  assert.equal(result.industry, null);
  assert.equal(result.location, null);
});
