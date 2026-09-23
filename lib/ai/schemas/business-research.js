import { SchemaBuilder, nonEmpty, strArray, optStr, num01 } from './util.js';

export const CLAIM_TYPES = ['FACT', 'INFERENCE', 'HYPOTHESIS'];

function claimList(data, key, defaultType, b) {
  const out = [];
  let i = 0;
  for (const f of Array.isArray(data[key]) ? data[key] : []) {
    if (!f || typeof f !== 'object' || !nonEmpty(f.text, 2000)) {
      b.require(false, `${key}[${i}].text required`);
      i++; continue;
    }
    const ids = Array.isArray(f.evidence_ids) ? f.evidence_ids.map(Number).filter(Boolean) : [];
    if (!ids.length) {
      b.require(false, `${key}[${i}] must cite evidence_ids (never make claims without evidence)`);
      i++; continue;
    }
    const ct = String(f.claim_type || defaultType).toUpperCase();
    if (!CLAIM_TYPES.includes(ct)) {
      b.require(false, `${key}[${i}].claim_type must be one of ${CLAIM_TYPES.join('|')}`);
      i++; continue;
    }
    out.push({
      claim_type: ct,
      text: String(f.text).slice(0, 2000),
      evidence_ids: ids,
      confidence: num01(f.confidence),
    });
    i++;
  }
  return out;
}

/** BUSINESS_RESEARCH_AGENT output schema. */
export const businessResearchSchema = {
  name: 'business_research',

  describe() {
    return `{
  "business_model": "2-4 sentences on how the business appears to make money",
  "products": ["..."], "services": ["..."], "customer_types": ["..."],
  "sales_channels": ["..."], "ordering_channels": ["..."], "booking_channels": ["..."],
  "delivery_model": "string or unknown", "wholesale_model": "string or unknown",
  "operational_signals": [{ "signal": "...", "interpretation": "...",
                            "claim_type": "FACT|INFERENCE|HYPOTHESIS", "evidence_ids": [id] }],
  "business_maturity_signals": [{ "signal": "...", "assessment": "...", "evidence_ids": [id] }],
  "facts": [{ "text": "...", "evidence_ids": [id], "confidence": 0..1 }],
  "inferences": [{ same shape as facts }],
  "unknowns": ["..."]
}
Every fact/inference/operational_signal MUST cite at least one provided evidence id.
Anything not supported by evidence belongs in "unknowns". Never invent numbers.`;
  },

  validate(data) {
    const b = new SchemaBuilder(this.name);
    if (!b.require(data && typeof data === 'object', 'response must be a JSON object')) return b.result(null);

    const value = {
      business_model: nonEmpty(data.business_model, 4000) ? String(data.business_model) : '',
      products: strArray(data.products) || [],
      services: strArray(data.services) || [],
      customer_types: strArray(data.customer_types) || [],
      sales_channels: strArray(data.sales_channels) || [],
      ordering_channels: strArray(data.ordering_channels) || [],
      booking_channels: strArray(data.booking_channels) || [],
      delivery_model: optStr(data.delivery_model, 1000) || 'unknown',
      wholesale_model: optStr(data.wholesale_model, 1000) || 'unknown',
      operational_signals: [],
      business_maturity_signals: [],
      facts: [],
      inferences: [],
      unknowns: strArray(data.unknowns) || [],
    };

    if (!value.business_model) b.require(false, 'business_model is required');

    for (const arr of ['products', 'services', 'customer_types', 'sales_channels', 'ordering_channels', 'booking_channels']) {
      if (!(value[arr].length)) {
        b.require(false, `${arr} must be a non-empty array of strings (use ["unknown"] when genuinely unknown)`);
      }
    }

    let oi = 0;
    for (const s of Array.isArray(data.operational_signals) ? data.operational_signals : []) {
      const ids = s && Array.isArray(s.evidence_ids) ? s.evidence_ids.map(Number).filter(Boolean) : [];
      if (!s || !nonEmpty(s.signal, 300) || !ids.length ||
          !CLAIM_TYPES.includes(String(s.claim_type || '').toUpperCase())) {
        b.require(false, `operational_signals[${oi}] requires signal, valid claim_type and evidence_ids`);
      } else {
        value.operational_signals.push({
          signal: String(s.signal).slice(0, 300),
          interpretation: optStr(s.interpretation, 1000),
          claim_type: String(s.claim_type).toUpperCase(),
          evidence_ids: ids,
        });
      }
      oi++;
    }

    let mi = 0;
    for (const m of Array.isArray(data.business_maturity_signals) ? data.business_maturity_signals : []) {
      const ids = m && Array.isArray(m.evidence_ids) ? m.evidence_ids.map(Number).filter(Boolean) : [];
      if (!m || !nonEmpty(m.signal, 300) || !ids.length) {
        b.require(false, `business_maturity_signals[${mi}] requires signal and evidence_ids`);
      } else {
        value.business_maturity_signals.push({
          signal: String(m.signal).slice(0, 300),
          assessment: optStr(m.assessment, 500),
          evidence_ids: ids,
        });
      }
      mi++;
    }

    value.facts = claimList(data, 'facts', 'FACT', b);
    value.inferences = claimList(data, 'inferences', 'INFERENCE', b);

    return b.result(value);
  },
};
