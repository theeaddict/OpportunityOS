/**
 * Research coverage — which business aspects have evidence-backed findings and
 * which remain unknown. Drives the "Research incomplete" UI state: the platform
 * shows what is missing instead of inventing information.
 */

export const RESEARCH_ASPECTS = [
  { key: 'what_they_sell', label: 'What they sell', signals: ['inventory_complexity', 'high_value_products'] },
  { key: 'services', label: 'Services', signals: [] },
  { key: 'pricing_signals', label: 'Pricing signals', signals: [] },
  { key: 'locations_branches', label: 'Locations / branches', signals: ['multiple_branches'] },
  { key: 'ordering_process', label: 'Ordering process', signals: ['no_online_ordering', 'online_ordering', 'phone_whatsapp_published', 'public_phone_published'] },
  { key: 'booking_process', label: 'Booking process', signals: ['no_booking_system', 'existing_digital_systems'] },
  { key: 'delivery', label: 'Delivery', signals: ['delivery_operations', 'delivery_coordination_pain'] },
  { key: 'wholesale', label: 'Wholesale', signals: ['wholesale_operations'] },
  { key: 'online_sales', label: 'Online sales', signals: ['active_social_commerce', 'existing_website', 'no_public_website'] },
  { key: 'social_commerce', label: 'Social-commerce behavior', signals: ['active_social_commerce'] },
  { key: 'customer_interactions', label: 'Customer interactions', signals: ['unanswered_enquiries', 'repeat_customer_mentions', 'no_customer_records'] },
  { key: 'operational_complexity', label: 'Operational complexity', signals: ['high_transaction_volume', 'multiple_channels', 'team_employees'] },
  { key: 'business_maturity', label: 'Business maturity', signals: ['established_history', 'professional_premises', 'corporate_customers'] },
];

/**
 * @param {Array} evidenceRows — business_evidence rows (signal_key, claim_type…)
 * @param {object|null} researchProfile — BUSINESS_RESEARCH_AGENT output, if any
 */
export function computeResearchCoverage(evidenceRows, researchProfile = null) {
  const covered = new Set();
  for (const row of evidenceRows) {
    if (!row.signal_key) continue;
    for (const aspect of RESEARCH_ASPECTS) {
      if (aspect.signals.includes(row.signal_key)) covered.add(aspect.key);
    }
    // Text-based fallbacks for aspects without signal keys
    const t = String(row.evidence_text || '').toLowerCase();
    if (/price|ksh|kes|tzs|ugx|\$/.test(t)) covered.add('pricing_signals');
    if (/service|repair|install|maintenance/.test(t)) covered.add('services');
    if (/deliver|rider|dispatch/.test(t)) covered.add('delivery');
    if (/wholesale|bulk|contractor/.test(t)) covered.add('wholesale');
    if (/order|checkout|cart/.test(t)) covered.add('ordering_process');
    if (/book|appointment|reservation/.test(t)) covered.add('booking_process');
    if (/branch|location|visit us/.test(t)) covered.add('locations_branches');
    if (/instagram|facebook|tiktok|dm|social/.test(t)) covered.add('social_commerce');
    if (/customer|review|enquir/.test(t)) covered.add('customer_interactions');
    if (/team|staff|hiring|employees/.test(t)) covered.add('operational_complexity');
    if (/since \d{4}|established|years of experience/.test(t)) covered.add('business_maturity');
    if (/sell|stock|supply|offer/.test(t)) covered.add('what_they_sell');
    if (/website|online store|e-commerce/.test(t)) covered.add('online_sales');
  }

  // The AI research profile covers descriptive aspects when present.
  if (researchProfile) {
    for (const k of ['products', 'services']) {
      if (Array.isArray(researchProfile[k]) && researchProfile[k].length) {
        covered.add(k === 'products' ? 'what_they_sell' : 'services');
      }
    }
    if (researchProfile.delivery_model && researchProfile.delivery_model !== 'unknown') covered.add('delivery');
    if (researchProfile.wholesale_model && researchProfile.wholesale_model !== 'unknown') covered.add('wholesale');
    if (Array.isArray(researchProfile.ordering_channels) && researchProfile.ordering_channels.length) covered.add('ordering_process');
    if (Array.isArray(researchProfile.booking_channels) && researchProfile.booking_channels.length) covered.add('booking_process');
    if (Array.isArray(researchProfile.sales_channels) && researchProfile.sales_channels.length) covered.add('online_sales');
    if (Array.isArray(researchProfile.customer_types) && researchProfile.customer_types.length) covered.add('customer_interactions');
  }

  const missing = RESEARCH_ASPECTS.filter((a) => !covered.has(a.key)).map((a) => a.label);
  return {
    complete: missing.length === 0,
    coveredCount: RESEARCH_ASPECTS.length - missing.length,
    total: RESEARCH_ASPECTS.length,
    missing,
  };
}
