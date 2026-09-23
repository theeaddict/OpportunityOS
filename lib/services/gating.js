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