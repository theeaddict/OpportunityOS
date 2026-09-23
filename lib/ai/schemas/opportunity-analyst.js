import { SchemaBuilder, nonEmpty, strArray, num01 } from './util.js';
import { MONEY_MECHANISM_KEYS } from '@/lib/constants';

export const ANALYST_STATUSES = ['OPPORTUNITY_FOUND', 'NO_STRONG_OPPORTUNITY'];

/** OPPORTUNITY_ANALYST_AGENT output schema. */
export const opportunityAnalystSchema = {
  name: 'opportunity_analyst',

  describe() {
    return `{
  "status": "OPPORTUNITY_FOUND" | "NO_STRONG_OPPORTUNITY",
  "problem": string,
  "opportunity": string,
  "why_it_matters": string (WHY this opportunity exists),
  "money_mechanism_key": one of the allowed money-mechanism keys,
  "money_mechanism": string (HOW money is made or saved — a mechanism, never an amount),
  "evidence_support": string (WHAT evidence supports it),
  "uncertain": string (WHAT remains uncertain),
  "required_assumptions": [{ "name": string, "description": string }],
  "confidence": 0..1,
  "evidence_ids": number[] (evidence that supports this),
  "reasoning_summary": string
}
Allowed money_mechanism_key values: ${MONEY_MECHANISM_KEYS.join(', ')}
If the evidence is insufficient you MUST return status NO_STRONG_OPPORTUNITY with
short reasoning_summary and empty/other fields kept minimal. Never invent facts.`;
  },

  validate(data) {
    const b = new SchemaBuilder(this.name);
    if (!b.require(data && typeof data === 'object', 'response must be a JSON object')) return b.result(null);

    const status = String(data.status || '').toUpperCase();
    if (!b.require(ANALYST_STATUSES.includes(status), `status must be ${ANALYST_STATUSES.join(' | ')}`)) {
      return b.result(null);
    }
    if (!b.require(nonEmpty(data.reasoning_summary, 3000), 'reasoning_summary is required')) {
      return b.result(null);
    }

    const evidenceIds = Array.isArray(data.evidence_ids) ? data.evidence_ids.map(Number).filter(Boolean) : [];

    if (status === 'NO_STRONG_OPPORTUNITY') {
      return b.result({
        status,
        problem: opt_(data.problem),
        opportunity: opt_(data.opportunity),
        why_it_matters: opt_(data.why_it_matters),
        money_mechanism: null,
        money_mechanism_key: null,
        evidence_support: null,
        uncertain: null,
        required_assumptions: assumptions(data.required_assumptions, b, true),
        confidence: num01(data.confidence, 0.2),
        evidence_ids: evidenceIds,
        reasoning_summary: String(data.reasoning_summary).slice(0, 3000),
      });
    }

    for (const field of ['problem', 'opportunity', 'why_it_matters', 'money_mechanism']) {
      b.require(nonEmpty(data[field], 4000), `${field} is required when status is OPPORTUNITY_FOUND`);
    }
    const mech = String(data.money_mechanism_key || '');
    if (!b.require(MONEY_MECHANISM_KEYS.includes(mech), 'money_mechanism_key must be one of the allowed values')) {
      return b.result(null);
    }
    if (!b.require(nonEmpty(data.evidence_support, 3000), 'evidence_support is required (WHAT evidence supports it)')) {
      return b.result(null);
    }
    if (!b.require(nonEmpty(data.uncertain, 3000), 'uncertain is required (WHAT remains uncertain)')) {
      return b.result(null);
    }
    if (!b.require(evidenceIds.length > 0, 'evidence_ids required — every claim must reference provided evidence')) {
      return b.result(null);
    }

    return b.result({
      status,
      problem: String(data.problem).slice(0, 4000),
      opportunity: String(data.opportunity).slice(0, 4000),
      why_it_matters: String(data.why_it_matters).slice(0, 4000),
      money_mechanism: String(data.money_mechanism).slice(0, 500),
      money_mechanism_key: mech,
      evidence_support: String(data.evidence_support).slice(0, 3000),
      uncertain: String(data.uncertain).slice(0, 3000),
      required_assumptions: assumptions(data.required_assumptions, b, false),
      confidence: num01(data.confidence),
      evidence_ids: evidenceIds,
      reasoning_summary: String(data.reasoning_summary).slice(0, 3000),
    });
  },
};

function assumptions(v, b, allowEmpty) {
  const out = [];
  const arr = Array.isArray(v) ? v : [];
  let i = 0;
  for (const a of arr) {
    if (!a || !nonEmpty(a.name, 80)) { b.require(false, `required_assumptions[${i}].name required`); i++; continue; }
    out.push({ name: String(a.name).slice(0, 80), description: nonEmpty(a.description, 500) ? String(a.description).slice(0, 500) : '' });
    i++;
  }
  return out;
}

function opt_(v) {
  return typeof v === 'string' && v.trim() ? v.slice(0, 4000) : null;
}
