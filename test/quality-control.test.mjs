/**
 * Unit tests for the Quality Control checklist (lib/services/gating.js
 * runQualityChecks) — a consolidated, visible pre-outreach checklist.
 * Pure function, no DB/network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runQualityChecks } from '../lib/services/gating.js';

function baseArgs(overrides = {}) {
  return {
    opportunity: { score_category: 'HOT', status: 'new' },
    business: { name: 'Steve’s Touch' },
    evidenceRows: [
      { claim_type: 'FACT', source_name: 'Business website', source_url: 'https://x.test' },
    ],
    contacts: [{ contact_type: 'phone', contact_value: '+254700000000', verification_status: 'phone_only' }],
    messages: [],
    ...overrides,
  };
}

test('a well-evidenced, verified opportunity passes every check', () => {
  const { checks, passed } = runQualityChecks(baseArgs());
  assert.equal(passed, true);
  assert.ok(checks.every((c) => c.pass));
});

test('fails "has_evidence" and "has_directly_observed_fact" when there is no evidence at all', () => {
  const { checks, passed } = runQualityChecks(baseArgs({ evidenceRows: [] }));
  assert.equal(passed, false);
  const byKey = Object.fromEntries(checks.map((c) => [c.key, c.pass]));
  assert.equal(byKey.has_evidence, false);
  assert.equal(byKey.has_directly_observed_fact, false);
});

test('fails "has_directly_observed_fact" when every claim is inference/hypothesis', () => {
  const { checks } = runQualityChecks(baseArgs({
    evidenceRows: [{ claim_type: 'INFERENCE', source_name: 'Reviews' }],
  }));
  const byKey = Object.fromEntries(checks.map((c) => [c.key, c.pass]));
  assert.equal(byKey.has_evidence, true);
  assert.equal(byKey.has_directly_observed_fact, false);
});

test('fails "every_claim_has_a_source" when a row has no source at all', () => {
  const { checks } = runQualityChecks(baseArgs({
    evidenceRows: [{ claim_type: 'FACT' }], // no source_name/source_url
  }));
  const byKey = Object.fromEntries(checks.map((c) => [c.key, c.pass]));
  assert.equal(byKey.every_claim_has_a_source, false);
});

test('fails "clears_evidence_bar" for a REJECT-scored opportunity', () => {
  const { checks, passed } = runQualityChecks(baseArgs({ opportunity: { score_category: 'REJECT', status: 'new' } }));
  assert.equal(passed, false);
  assert.equal(checks.find((c) => c.key === 'clears_evidence_bar').pass, false);
});

test('fails "has_verified_contact" with no contacts on file', () => {
  const { checks } = runQualityChecks(baseArgs({ contacts: [] }));
  assert.equal(checks.find((c) => c.key === 'has_verified_contact').pass, false);
});

test('fails "whatsapp_never_guessed" if a whatsapp contact somehow lacks explicit confirmation', () => {
  const { checks } = runQualityChecks(baseArgs({
    contacts: [{ contact_type: 'whatsapp', contact_value: '+254700000000', verification_status: 'unverified' }],
  }));
  assert.equal(checks.find((c) => c.key === 'whatsapp_never_guessed').pass, false);
});

test('passes "whatsapp_never_guessed" for an explicitly confirmed WhatsApp contact', () => {
  const { checks } = runQualityChecks(baseArgs({
    contacts: [{ contact_type: 'whatsapp', contact_value: '+254700000000', verification_status: 'verified_public_whatsapp' }],
  }));
  assert.equal(checks.find((c) => c.key === 'whatsapp_never_guessed').pass, true);
});

test('fails "solution_matches_capability" when the capability gate rejected it', () => {
  const { checks } = runQualityChecks(baseArgs({ opportunity: { score_category: 'HOT', status: 'not_a_service_fit' } }));
  assert.equal(checks.find((c) => c.key === 'solution_matches_capability').pass, false);
});

test('outreach check is only included when messages exist, and fails on generic boilerplate', () => {
  const withNoMessages = runQualityChecks(baseArgs());
  assert.equal(withNoMessages.checks.some((c) => c.key === 'outreach_names_the_business'), false);

  const withGeneric = runQualityChecks(baseArgs({ messages: [{ message_text: 'Hi, I noticed your business is growing.' }] }));
  assert.equal(withGeneric.checks.find((c) => c.key === 'outreach_names_the_business').pass, false);

  const withSpecific = runQualityChecks(baseArgs({ messages: [{ message_text: 'Hi Steve’s Touch, when clients book via DM...' }] }));
  assert.equal(withSpecific.checks.find((c) => c.key === 'outreach_names_the_business').pass, true);
});
