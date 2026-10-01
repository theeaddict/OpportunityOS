const VERIFIED_STATUSES = new Set([
  'verified_public_whatsapp',
  'phone_only',
  'source_published',
  'user_confirmed',
]);

export function hasVerifiedContact(contacts) {
  return (contacts || []).some(
    (c) => c && c.contact_value && c.verification_status != null && VERIFIED_STATUSES.has(c.verification_status),
  );
}

export function isRejectedOpportunity(opportunity) {
  return opportunity != null && opportunity.score_category === 'REJECT';
}

/**
 * An opportunity is "pursuable" when it has actually been scored and has not
 * been classified REJECT. Used alongside isRejectedOpportunity to keep REJECT
 * and never-scored rows out of primary results lists.
 */
export function isPursuableOpportunity(opportunity) {
  return opportunity != null
    && opportunity.opportunity_score != null
    && opportunity.score_category !== 'REJECT';
}

const WHATSAPP_VERIFIED_STATUSES = new Set(['verified_public_whatsapp', 'user_confirmed']);

/**
 * Quality Control checklist — a final, VISIBLE pass before a lead is treated
 * as outreach-ready. Most of these are already enforced elsewhere (evidence
 * gating in rules-analyzer.js, the WhatsApp-never-guessed rule at the DB
 * write layer, the capability gate marking NOT_A_SERVICE_FIT) — this doesn't
 * replace those, it makes them visible as an explicit list so a human
 * reviewing a lead can see exactly what was verified, instead of trusting an
 * opaque score. Pure/read-only: never writes anything, never blocks a page
 * from rendering — a failed check is information, not a hard stop (the
 * existing REJECT/contact gates already stop outreach generation itself).
 *
 * @returns {{ checks: Array<{key,label,pass,detail}>, passed: boolean }}
 */
export function runQualityChecks({ opportunity, business, evidenceRows = [], contacts = [], messages = [] }) {
  const checks = [];

  checks.push({
    key: 'has_evidence',
    label: 'Has at least one piece of evidence',
    pass: evidenceRows.length > 0,
    detail: `${evidenceRows.length} evidence row${evidenceRows.length === 1 ? '' : 's'} linked`,
  });

  const factRows = evidenceRows.filter((e) => String(e.claim_type).toUpperCase() === 'FACT');
  checks.push({
    key: 'has_directly_observed_fact',
    label: 'At least one directly-observed fact (not built on inference alone)',
    pass: factRows.length > 0,
    detail: factRows.length > 0 ? `${factRows.length} FACT-labeled row${factRows.length === 1 ? '' : 's'}` : 'Every claim here is INFERENCE/HYPOTHESIS',
  });

  const unsourced = evidenceRows.filter((e) => !e.source_name && !e.source_url);
  checks.push({
    key: 'every_claim_has_a_source',
    label: 'Every claim has a named source',
    pass: evidenceRows.length > 0 && unsourced.length === 0,
    detail: unsourced.length > 0 ? `${unsourced.length} row(s) with no source on file` : 'All sourced',
  });

  checks.push({
    key: 'clears_evidence_bar',
    label: 'Evidence clears the scoring bar (not REJECT)',
    pass: !isRejectedOpportunity(opportunity),
    detail: opportunity?.score_category || 'not yet scored',
  });

  checks.push({
    key: 'has_verified_contact',
    label: 'Has a publicly verified contact',
    pass: hasVerifiedContact(contacts),
    detail: contacts.length ? `${contacts.length} contact(s) on file` : 'No contact on file',
  });

  const whatsappContacts = contacts.filter((c) => c.contact_type === 'whatsapp');
  const unverifiedWhatsapp = whatsappContacts.filter((c) => !WHATSAPP_VERIFIED_STATUSES.has(c.verification_status));
  checks.push({
    key: 'whatsapp_never_guessed',
    label: 'No WhatsApp number treated as such without explicit confirmation',
    pass: unverifiedWhatsapp.length === 0,
    detail: whatsappContacts.length ? `${whatsappContacts.length} WhatsApp contact(s), all explicitly confirmed` : 'No WhatsApp contact on file',
  });

  checks.push({
    key: 'solution_matches_capability',
    label: 'Proposed solution is one you can actually deliver',
    pass: opportunity?.status !== 'not_a_service_fit',
    detail: opportunity?.status === 'not_a_service_fit' ? 'Marked NOT_A_SERVICE_FIT by the capability gate' : 'Within your enabled solutions',
  });

  if (messages.length > 0) {
    const name = String(business?.name || '').trim();
    const genericMessages = name ? messages.filter((m) => !String(m.message_text || '').includes(name)) : [];
    checks.push({
      key: 'outreach_names_the_business',
      label: 'Generated outreach actually names this business (not generic boilerplate)',
      pass: genericMessages.length === 0,
      detail: genericMessages.length > 0 ? `${genericMessages.length} message(s) never mention "${name}"` : 'Every message names the business',
    });
  }

  return { checks, passed: checks.every((c) => c.pass) };
}