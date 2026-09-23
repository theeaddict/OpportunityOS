import { inferContactType, normalizePhone } from '@/lib/normalize';

/**
 * ContactProvider implementation #1: normalizes and classifies contacts that
 * arrive from discovery candidates or manual entry.
 *
 * CONTACT RULES (enforced here and in the repository):
 *  - a source EXPLICITLY identifying a number as WhatsApp
 *      -> contact_type 'whatsapp', verification_status 'verified_public_whatsapp'
 *  - a phone number whose WhatsApp status is not confirmed
 *      -> contact_type 'phone',   verification_status 'phone_only'
 *  - PHONE_ONLY is never converted to WhatsApp automatically
 */
export const manualContactProvider = {
  id: 'manual-classifier',
  label: 'Built-in contact classifier',

  async extract(candidate) {
    const out = [];
    for (const c of candidate.contacts || []) {
      const value = String(c.value ?? c.contact_value ?? c.contactValue ?? '').trim();
      if (!value) continue;

      const hint = c.contactType || c.contact_type;
      let type = inferContactType(value, typeof hint === 'string' ? hint : undefined);
      let status = c.verification_status || c.verificationStatus || null;

      if (/whatsapp/i.test(String(c.label || c.contact_label || '')) || c.whatsappConfirmed === true || c.whatsapp_confirmed === true
          || status === 'source_published' || status === 'user_confirmed') {
        // The source/operator EXPLICITLY identified this number as WhatsApp
        // (via label, a confirmed flag, or an explicit source_published /
        // user_confirmed verification status).
        type = 'whatsapp';
        status = 'verified_public_whatsapp';
      } else if (type === 'whatsapp') {
        // Claimed WhatsApp without explicit source confirmation is not accepted
        // as verified; downgrade to an unverified whatsapp row only when the
        // operator-configured source asserts it, otherwise treat as phone-only.
        if ((c.sourceUrl || c.source_url) && (c.sourceAsserted || c.source_asserted)) {
          status = 'verified_public_whatsapp';
        } else {
          type = 'phone';
          status = 'phone_only';
        }
      }

      if (!status) {
        if (type === 'phone') status = 'phone_only';
        else if (c.sourceUrl || c.source_url) status = 'source_published';
        else status = 'unverified';
      }
      if (type === 'phone' && !['user_confirmed', 'source_published'].includes(status)) {
        status = 'phone_only';
      }

      out.push({
        contactType: type,
        contactValue: value,
        normalized:
          type === 'phone' || type === 'whatsapp' ? normalizePhone(value)
          : ['social', 'website_form'].includes(type) ? value.toLowerCase()
          : value.toLowerCase(),
        isPublic: 1,
        verificationStatus: status,
        confidenceScore: Math.min(1, Math.max(0, Number(c.confidence ?? c.confidenceScore ?? c.confidence_score ?? 0.5))),
        sourceUrl: c.sourceUrl || c.source_url || null,
      });
    }

    if (candidate.email && !out.some((o) => o.contactValue.toLowerCase() === String(candidate.email).toLowerCase())) {
      out.push({
        contactType: 'email',
        contactValue: String(candidate.email).trim(),
        normalized: String(candidate.email).trim().toLowerCase(),
        isPublic: 1,
        verificationStatus: candidate.source?.source_url ? 'source_published' : 'unverified',
        confidenceScore: 0.6,
        sourceUrl: candidate.source?.source_url || null,
      });
    }
    return out;
  },
};
